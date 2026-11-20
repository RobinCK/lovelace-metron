import { addDays, startOfDay } from '../../core/time';

export interface ProfileWindow {
  readonly start: number;
  readonly end: number;
}

const WEEK_DAYS = 7;

export const profileWindow = (now: number, weeks: number, offset: number): ProfileWindow => {
  const end = addDays(startOfDay(now), offset * weeks * WEEK_DAYS);

  return { start: addDays(end, -weeks * WEEK_DAYS), end };
};
