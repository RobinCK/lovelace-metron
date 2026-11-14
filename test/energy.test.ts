import { describe, expect, it } from 'vitest';
import { energySince, hourlyChanges } from '../src/core/data/energy';
import type { StatisticRow } from '../src/core/data/statistics';

const HOUR = 3_600_000;
const start = Date.UTC(2026, 10, 13);

const row = (hour: number, change: number, state: number): StatisticRow => ({
  start: start + hour * HOUR,
  end: start + (hour + 1) * HOUR,
  change,
  state,
});

describe('energySince', () => {
  it('adds the unfinished hour to completed hours of a lifetime counter', () => {
    const rows = [row(-1, 0.4, 1000), row(0, 0.5, 1000.5), row(1, 1.5, 1002)];

    expect(energySince(rows, start, 1002.3)).toBeCloseTo(2.3);
  });

  it('handles a daily counter reset at midnight', () => {
    const rows = [row(-1, 0.4, 24.6)];

    expect(energySince(rows, start, 0.8)).toBeCloseTo(0.8);
  });

  it('falls back to the current state without statistics', () => {
    expect(energySince([], start, 5)).toBe(5);
  });
});

describe('hourlyChanges', () => {
  it('places changes into hour slots', () => {
    const values = hourlyChanges([row(0, 0.5, 1), row(2, 1, 2)], start, 4);

    expect(values).toEqual([0.5, undefined, 1, undefined]);
  });
});

import { simulateYear, sunShape } from '../src/cards/expansion/model';

describe('expansion model', () => {
  const months = Array.from({ length: 12 }, (_, index) => ({
    days: 30,
    generation: 600 + index * 50,
    consumption: 900,
    shape: sunShape(10 + (index % 6), 12.5),
  }));
  const settings = {
    basePv: 10,
    loadShape: Array.from({ length: 24 }, (_, hour) => (hour > 6 && hour < 23 ? 1.5 : 0.6)),
    usable: 0.8,
    efficiency: 0.95,
  };

  it('normalizes the production shape', () => {
    expect(sunShape(9, 12).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('imports less with more panels and a bigger battery', () => {
    const now = simulateYear(months, { pv: 10, battery: 10 }, settings);
    const larger = simulateYear(months, { pv: 15, battery: 20 }, settings);

    expect(larger.imported).toBeLessThan(now.imported);
    expect(larger.selfSufficiency).toBeGreaterThan(now.selfSufficiency);
    expect(larger.generated).toBeCloseTo(now.generated * 1.5, 6);
  });
});
