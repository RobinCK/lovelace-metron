import { HOUR, MINUTE } from '../../const';
import { energySince } from '../../core/data/energy';
import type { StatisticRow } from '../../core/data/statistics';
import { addDays, startOfDay } from '../../core/time';

export const SLOT = 5 * MINUTE;
export const SLOTS = 288;
export const DAYS = 30;

export type LoadSort = 'power' | 'today' | 'name';

export type LoadRange = '24h' | '7d' | '30d';

export interface LoadSeries {
  readonly start: number;
  readonly points: readonly (number | undefined)[];
}

export interface LoadPeak {
  readonly value: number;
  readonly at: number;
}

export interface LoadStats {
  readonly today?: number;
  readonly days: readonly (number | undefined)[];
  readonly series: LoadSeries;
  readonly peak?: LoadPeak;
  readonly since?: number;
  readonly lastRun?: number;
}

export interface LoadInput {
  readonly power?: number;
  readonly energy?: number;
  readonly fine?: readonly StatisticRow[];
  readonly daily?: readonly StatisticRow[];
  readonly hourly?: readonly StatisticRow[];
  readonly counter: boolean;
  readonly threshold: number;
}

export interface Sortable {
  readonly name: string;
  readonly power?: number;
  readonly today?: number;
}

export const seriesStart = (now: number): number =>
  Math.floor(now / SLOT) * SLOT - (SLOTS - 1) * SLOT;

export const daysStart = (now: number): number => addDays(startOfDay(now), -(DAYS - 1));

const seriesOf = (
  rows: readonly StatisticRow[],
  start: number,
  power: number | undefined,
): LoadSeries => {
  const points: (number | undefined)[] = Array.from({ length: SLOTS }, () => undefined);

  for (const row of rows) {
    const index = Math.floor((row.start - start) / SLOT);

    if (index < 0 || index >= SLOTS || row.mean === null || row.mean === undefined) continue;

    points[index] = row.mean;
  }

  if (power !== undefined) points[SLOTS - 1] = Math.max(0, power);

  return { start, points };
};

const integratedToday = (
  rows: readonly StatisticRow[],
  dayStart: number,
  power: number | undefined,
  now: number,
): number | undefined => {
  const today = rows.filter((row) => row.start >= dayStart);

  if (today.length === 0 && power === undefined) return undefined;

  const measured = today.reduce((total, row) => total + ((row.mean ?? 0) * SLOT) / HOUR / 1000, 0);
  const last = today.reduce((end, row) => Math.max(end, row.end), dayStart);
  const tail =
    power === undefined ? 0 : (Math.max(0, power) * Math.max(0, now - last)) / HOUR / 1000;

  return measured + tail;
};

const dailyValues = (
  rows: readonly StatisticRow[],
  first: number,
  counter: boolean,
  today: number | undefined,
): (number | undefined)[] =>
  Array.from({ length: DAYS }, (_, index) => {
    if (index === DAYS - 1) return today;

    const start = addDays(first, index);
    const end = addDays(first, index + 1);
    const row = rows.find((item) => item.start >= start && item.start < end);

    if (!row) return undefined;
    if (counter) return row.change ?? undefined;

    return row.mean === null || row.mean === undefined
      ? undefined
      : (row.mean * (end - start)) / HOUR / 1000;
  });

const peakOf = (series: LoadSeries, power: number | undefined, now: number): LoadPeak | undefined =>
  series.points.reduce<LoadPeak | undefined>(
    (peak, value, index) =>
      value !== undefined && value > (peak?.value ?? 0)
        ? { value, at: series.start + index * SLOT }
        : peak,
    power !== undefined && power > 0 ? { value: power, at: now } : undefined,
  );

export const loadStats = (input: LoadInput, now: number): LoadStats => {
  const dayStart = startOfDay(now);
  const fine = input.fine ?? [];
  const series = seriesOf(fine, seriesStart(now), input.power);
  const today = input.counter
    ? input.hourly?.length
      ? energySince(input.hourly, dayStart, input.energy)
      : undefined
    : integratedToday(fine, dayStart, input.power, now);
  const active = (input.power ?? 0) > input.threshold;
  const slots = [...fine].reverse();
  const quiet = active ? slots.find((row) => (row.mean ?? 0) <= input.threshold) : undefined;
  const busy = active ? undefined : slots.find((row) => (row.mean ?? 0) > input.threshold);

  return {
    today,
    days: dailyValues(input.daily ?? [], daysStart(now), input.counter, today),
    series,
    peak: peakOf(series, input.power, now),
    since: quiet?.end,
    lastRun: busy?.end,
  };
};

export const sumDays = (
  days: readonly (number | undefined)[],
  count: number,
): number | undefined => {
  const values = days.slice(-count).filter((value): value is number => value !== undefined);

  return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0);
};

export const sortLoads = <T extends Sortable>(
  rows: readonly T[],
  sort: LoadSort,
  language: string,
): T[] => {
  if (sort === 'name') return [...rows].sort((a, b) => a.name.localeCompare(b.name, language));

  const key = (row: T): number =>
    (sort === 'power' ? row.power : row.today) ?? Number.NEGATIVE_INFINITY;

  return [...rows].sort((a, b) => key(b) - key(a));
};
