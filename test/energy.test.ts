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
