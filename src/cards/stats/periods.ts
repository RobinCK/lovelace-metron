import {
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from '../../core/time';

export type PeriodKind = 'day' | 'week' | 'month' | 'year';

export interface PeriodRange {
  readonly start: number;
  readonly end: number;
  readonly previousStart: number;
  readonly previousEnd: number;
}

const nextStart = (kind: PeriodKind, start: number): number => {
  if (kind === 'day') return addDays(start, 1);
  if (kind === 'week') return addDays(start, 7);
  if (kind === 'month') return addMonths(start, 1);

  return addMonths(start, 12);
};

const previousStartOf = (kind: PeriodKind, start: number): number => {
  if (kind === 'day') return addDays(start, -1);
  if (kind === 'week') return addDays(start, -7);
  if (kind === 'month') return addMonths(start, -1);

  return addMonths(start, -12);
};

export const periodStart = (kind: PeriodKind, time: number, firstWeekday = 1): number => {
  if (kind === 'day') return startOfDay(time);
  if (kind === 'week') return startOfWeek(time, firstWeekday);
  if (kind === 'month') return startOfMonth(time);

  return startOfYear(time);
};

export const periodToDate = (kind: PeriodKind, now: number, firstWeekday = 1): PeriodRange => {
  const start = periodStart(kind, now, firstWeekday);
  const previousStart = previousStartOf(kind, start);
  const elapsed = now - start;

  return {
    start,
    end: now,
    previousStart,
    previousEnd: Math.min(start, previousStart + elapsed),
  };
};

export const periodEnd = nextStart;
