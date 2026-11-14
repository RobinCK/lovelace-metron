import type { EnergySeries, Series } from './energy-sources';

export interface SplitSeries {
  readonly solar: Series;
  readonly battery: Series;
  readonly grid: Series;
}

const positive = (value: number): number => Math.max(0, value);

export const splitConsumption = (series: EnergySeries): SplitSeries => {
  const solar: (number | undefined)[] = [];
  const battery: (number | undefined)[] = [];
  const grid: (number | undefined)[] = [];

  series.home.forEach((home, index) => {
    if (home === undefined) {
      solar.push(undefined);
      battery.push(undefined);
      grid.push(undefined);

      return;
    }

    const fromGrid = Math.min(home, positive(series.import[index] ?? 0));
    const fromBattery = Math.min(home - fromGrid, positive(series.discharge[index] ?? 0));

    grid.push(fromGrid);
    battery.push(fromBattery);
    solar.push(positive(home - fromGrid - fromBattery));
  });

  return { solar, battery, grid };
};

export const splitProduction = (series: EnergySeries): SplitSeries => {
  const solar: (number | undefined)[] = [];
  const battery: (number | undefined)[] = [];
  const grid: (number | undefined)[] = [];

  series.solar.forEach((produced, index) => {
    if (produced === undefined) {
      solar.push(undefined);
      battery.push(undefined);
      grid.push(undefined);

      return;
    }

    const exported = Math.min(produced, positive(series.export[index] ?? 0));
    const charged = Math.min(produced - exported, positive(series.charge[index] ?? 0));

    grid.push(exported);
    battery.push(charged);
    solar.push(positive(produced - exported - charged));
  });

  return { solar, battery, grid };
};
