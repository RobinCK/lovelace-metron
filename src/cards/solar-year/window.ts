import { addDays, startOfDay, startOfWeek } from '../../core/time';

export interface YearWindow {
  readonly start: number;
  readonly end: number;
}

const WEEK_DAYS = 7;

export const yearWindow = (
  now: number,
  weeks: number,
  firstDay: number,
  offset: number,
): YearWindow => {
  const start = addDays(startOfWeek(now, firstDay), (offset * weeks - (weeks - 1)) * WEEK_DAYS);

  if (offset < 0) return { start, end: addDays(start, weeks * WEEK_DAYS) };

  return { start, end: addDays(startOfDay(now), 1) };
};
