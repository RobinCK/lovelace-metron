import { HOUR } from '../../const';
import {
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from '../../core/time';

export const BAR_PERIODS = ['hour', 'day', 'week', 'month'] as const;

export type BarPeriod = (typeof BAR_PERIODS)[number];

export interface BarWindow {
  readonly start: number;
  readonly end: number;
  readonly starts: readonly number[];
}

const WEEK_DAYS = 7;

const windowStart = (period: BarPeriod, now: number, offset: number, weeks: number): number => {
  if (period === 'hour') return addDays(startOfDay(now), offset);
  if (period === 'day') return addMonths(startOfMonth(now), offset);
  if (period === 'week') {
    return addDays(startOfWeek(now, 1), (offset * weeks - (weeks - 1)) * WEEK_DAYS);
  }

  return addMonths(startOfYear(now), offset * 12);
};

const windowEnd = (period: BarPeriod, start: number, weeks: number): number => {
  if (period === 'hour') return addDays(start, 1);
  if (period === 'day') return addMonths(start, 1);
  if (period === 'week') return addDays(start, weeks * WEEK_DAYS);

  return addMonths(start, 12);
};

const nextStart = (period: BarPeriod, time: number): number => {
  if (period === 'hour') return time + HOUR;
  if (period === 'day') return addDays(time, 1);
  if (period === 'week') return addDays(time, WEEK_DAYS);

  return addMonths(time, 1);
};

export const barWindow = (
  period: BarPeriod,
  now: number,
  offset: number,
  weeks: number,
): BarWindow => {
  const start = windowStart(period, now, offset, weeks);
  const end = windowEnd(period, start, weeks);
  const starts: number[] = [];

  for (let time = start; time < end; time = nextStart(period, time)) {
    starts.push(time);
  }

  return { start, end, starts };
};

export const currentIndex = (window: BarWindow, now: number): number => {
  if (now < window.start || now >= window.end) return -1;

  let index = -1;

  window.starts.forEach((start, position) => {
    if (start <= now) index = position;
  });

  return index;
};
