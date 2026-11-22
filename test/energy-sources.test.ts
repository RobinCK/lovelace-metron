import { describe, expect, it } from 'vitest';
import {
  balanceOf,
  energySeries,
  preferenceSources,
  selfConsumption,
  selfSufficiency,
} from '../src/cards/shared/energy-sources';
import type { EnergySources } from '../src/cards/shared/energy-sources';
import { splitConsumption } from '../src/cards/shared/split';
import { periodToDate } from '../src/cards/stats/periods';
import type { StatisticRow } from '../src/core/data/statistics';

const DAY = 86_400_000;
const start = new Date(2026, 10, 1).getTime();

const rows = (values: readonly number[]): StatisticRow[] =>
  values.map((change, index) => ({
    start: start + index * DAY,
    end: start + (index + 1) * DAY,
    change,
  }));

const sources: EnergySources = {
  solar: ['sensor.solar'],
  home: [],
  import: ['sensor.import'],
  export: ['sensor.export'],
  charge: ['sensor.charge'],
  discharge: ['sensor.discharge'],
};

const statistics = new Map([
  ['sensor.solar', rows([30, 10])],
  ['sensor.import', rows([2, 12])],
  ['sensor.export', rows([10, 0])],
  ['sensor.charge', rows([8, 2])],
  ['sensor.discharge', rows([6, 4])],
]);

describe('energy series', () => {
  it('derives home consumption from the balance', () => {
    const series = energySeries(statistics, sources, [start, start + DAY], start + 2 * DAY);

    expect(series.home).toEqual([20, 24]);
  });

  it('computes self-sufficiency and self-consumption', () => {
    const balance = balanceOf(energySeries(statistics, sources, [start], start + 2 * DAY));

    expect(balance.home).toBe(44);
    expect(selfSufficiency(balance)).toBeCloseTo(1 - 14 / 44);
    expect(selfConsumption(balance)).toBeCloseTo(1 - 10 / 40);
  });

  it('splits consumption by source', () => {
    const series = energySeries(statistics, sources, [start, start + DAY], start + 2 * DAY);
    const split = splitConsumption(series);

    expect(split.grid).toEqual([2, 12]);
    expect(split.battery).toEqual([6, 4]);
    expect(split.solar).toEqual([12, 8]);
  });
});

describe('energy dashboard preferences', () => {
  it('maps sources to statistic ids', () => {
    const mapped = preferenceSources({
      energy_sources: [
        { type: 'solar', stat_energy_from: 'sensor.pv' },
        {
          type: 'grid',
          flow_from: [{ stat_energy_from: 'sensor.in' }],
          flow_to: [{ stat_energy_to: 'sensor.out' }],
        },
        { type: 'battery', stat_energy_from: 'sensor.bat_out', stat_energy_to: 'sensor.bat_in' },
        { type: 'gas', stat_energy_from: 'sensor.gas' },
      ],
    });

    expect(mapped).toEqual({
      solar: ['sensor.pv'],
      home: [],
      import: ['sensor.in'],
      export: ['sensor.out'],
      discharge: ['sensor.bat_out'],
      charge: ['sensor.bat_in'],
      gas: ['sensor.gas'],
    });
  });
});

describe('energy dashboard preferences since 2026.11', () => {
  it('reads the flat grid source and the home meter', () => {
    const mapped = preferenceSources({
      energy_sources: [
        { type: 'grid', stat_energy_from: 'sensor.in', stat_energy_to: 'sensor.out' },
        { type: 'home', stat_energy_to: 'sensor.house' },
        { type: 'solar', stat_energy_from: 'sensor.pv' },
      ],
    });

    expect(mapped.import).toEqual(['sensor.in']);
    expect(mapped.export).toEqual(['sensor.out']);
    expect(mapped.home).toEqual(['sensor.house']);
  });
});

describe('periods', () => {
  it('compares the same part of the previous month', () => {
    const now = new Date(2026, 10, 13, 12).getTime();
    const range = periodToDate('month', now);

    expect(new Date(range.start).getDate()).toBe(1);
    expect(new Date(range.previousStart).getMonth()).toBe(9);
    expect(range.previousEnd - range.previousStart).toBe(range.end - range.start);
  });
});
