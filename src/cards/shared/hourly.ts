import { fetchStatistics } from '../../core/data/statistics';
import { deviceClass } from '../../core/entities';
import type { HomeAssistant } from '../../types/ha';
import { energySeries, fetchEnergyStatistics, resolveSources } from './energy-sources';
import type { EnergyConfig } from './energy-sources';

export interface HourSample {
  readonly time: number;
  readonly value: number;
  readonly max?: number;
}

const HOUR = 3_600_000;

export const fetchHourlyLoad = async (
  hass: HomeAssistant,
  entity: string | undefined,
  energy: EnergyConfig,
  start: number,
  end: number,
): Promise<HourSample[]> => {
  if (entity) {
    const power = deviceClass(hass, entity) !== 'energy';
    const result = await fetchStatistics(hass, {
      entityIds: [entity],
      start,
      end,
      period: 'hour',
      types: power ? ['mean', 'max'] : ['change'],
    });

    return (result.get(entity) ?? []).flatMap((row) => {
      const value = power ? row.mean : row.change;

      if (value === null || value === undefined) return [];

      return [
        {
          time: row.start,
          value: power ? value / 1000 : value,
          max: power && row.max !== null && row.max !== undefined ? row.max / 1000 : undefined,
        },
      ];
    });
  }

  const sources = await resolveSources(hass, energy);
  const statistics = await fetchEnergyStatistics(hass, sources, start, end, 'hour');
  const hours = Array.from(
    { length: Math.round((end - start) / HOUR) },
    (_, index) => start + index * HOUR,
  );
  const series = energySeries(statistics, sources, hours, end);

  return hours.flatMap((time, index) => {
    const value = series.home[index];

    return value === undefined ? [] : [{ time, value }];
  });
};

export const inWindow = (hour: number, from: number, to: number): boolean =>
  from <= to ? hour >= from && hour < to : hour >= from || hour < to;
