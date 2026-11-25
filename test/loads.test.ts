import { describe, expect, it } from 'vitest';
import { HOUR } from '../src/const';
import {
  DAYS,
  SLOT,
  SLOTS,
  daysStart,
  loadStats,
  seriesStart,
  sortLoads,
  sumDays,
} from '../src/cards/loads/loads-data';
import type { StatisticRow } from '../src/core/data/statistics';
import { addDays, startOfDay } from '../src/core/time';

const NOW = new Date(2026, 10, 25, 14, 7).getTime();

const slots = (from: number, count: number, mean: number): StatisticRow[] =>
  Array.from({ length: count }, (_, index) => ({
    start: from + index * SLOT,
    end: from + (index + 1) * SLOT,
    mean,
  }));

describe('loads', () => {
  it('integrates power since midnight and adds the live tail', () => {
    const midnight = startOfDay(NOW);
    const fine = slots(midnight, 12, 1200);
    const stats = loadStats({ power: 600, fine, counter: false, threshold: 3 }, NOW);
    const tail = (600 * (NOW - (midnight + HOUR))) / HOUR / 1000;

    expect(stats.today).toBeCloseTo(1.2 + tail, 5);
  });

  it('reads today from the energy counter and ignores a missing history', () => {
    const midnight = startOfDay(NOW);
    const hourly: StatisticRow[] = [
      { start: midnight - HOUR, end: midnight, change: 0.4, state: 10 },
      { start: midnight, end: midnight + HOUR, change: 0.5, state: 10.5 },
    ];

    expect(loadStats({ energy: 11, hourly, counter: true, threshold: 3 }, NOW).today).toBeCloseTo(
      1,
      5,
    );
    expect(loadStats({ energy: 11, counter: true, threshold: 3 }, NOW).today).toBeUndefined();
  });

  it('turns daily means into energy per day with today last', () => {
    const first = daysStart(NOW);
    const daily: StatisticRow[] = [
      { start: addDays(first, DAYS - 2), end: addDays(first, DAYS - 1), mean: 100 },
    ];
    const stats = loadStats({ power: 0, daily, counter: false, threshold: 3 }, NOW);

    expect(stats.days).toHaveLength(DAYS);
    expect(stats.days[DAYS - 2]).toBeCloseTo(2.4, 5);
    expect(stats.days[DAYS - 1]).toBe(stats.today);
  });

  it('finds the peak and how long the device runs', () => {
    const start = seriesStart(NOW);
    const fine = [...slots(start, SLOTS - 4, 2), ...slots(start + (SLOTS - 4) * SLOT, 3, 1800)];
    const stats = loadStats({ power: 1500, fine, counter: false, threshold: 3 }, NOW);

    expect(stats.peak?.value).toBe(1800);
    expect(stats.since).toBe(start + (SLOTS - 4) * SLOT);
    expect(stats.series.points[SLOTS - 1]).toBe(1500);
  });

  it('remembers the last run of an idle device', () => {
    const start = seriesStart(NOW);
    const fine = [...slots(start, 10, 900), ...slots(start + 10 * SLOT, SLOTS - 11, 1)];
    const stats = loadStats({ power: 1, fine, counter: false, threshold: 3 }, NOW);

    expect(stats.lastRun).toBe(start + 10 * SLOT);
    expect(stats.since).toBeUndefined();
  });

  it('sums the last days and sorts the loads', () => {
    expect(sumDays([1, undefined, 2, 3], 2)).toBe(5);
    expect(sumDays([undefined, undefined], 2)).toBeUndefined();

    const rows = [
      { name: 'Washer', power: 400, today: 0.2 },
      { name: 'Dryer', power: 2100, today: 0.1 },
      { name: 'Garden', today: 3 },
    ];

    expect(sortLoads(rows, 'power', 'en').map((row) => row.name)).toEqual([
      'Dryer',
      'Washer',
      'Garden',
    ]);
    expect(sortLoads(rows, 'today', 'en').map((row) => row.name)).toEqual([
      'Garden',
      'Washer',
      'Dryer',
    ]);
    expect(sortLoads(rows, 'name', 'en').map((row) => row.name)).toEqual([
      'Dryer',
      'Garden',
      'Washer',
    ]);
  });
});
