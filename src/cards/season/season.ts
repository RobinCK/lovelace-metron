import { addDays } from '../../core/time';

export interface SeasonBounds {
  readonly start: number;
  readonly end: number;
  readonly previousStart: number;
  readonly previousEnd: number;
}

const parseMonthDay = (value: string | undefined, fallback: [number, number]): [number, number] => {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(value?.trim() ?? '');

  if (!match) return fallback;

  const month = Number(match[1]);
  const day = Number(match[2]);

  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? [month, day] : fallback;
};

const at = (year: number, [month, day]: [number, number]): number =>
  new Date(year, month - 1, day).getTime();

export const seasonBounds = (now: number, startText?: string, endText?: string): SeasonBounds => {
  const startDay = parseMonthDay(startText, [10, 15]);
  const endDay = parseMonthDay(endText, [4, 30]);
  const year = new Date(now).getFullYear();
  const startYear = now >= at(year, startDay) ? year : year - 1;
  const start = at(startYear, startDay);
  const endYear = at(startYear, endDay) > start ? startYear : startYear + 1;
  const end = addDays(at(endYear, endDay), 1);

  return {
    start,
    end,
    previousStart: at(startYear - 1, startDay),
    previousEnd: addDays(at(endYear - 1, endDay), 1),
  };
};

export const projectRemaining = (
  thisToDate: number,
  lastToDate: number,
  lastRemaining: number,
): number => {
  if (lastToDate <= 0) return thisToDate + lastRemaining;

  const ratio = Math.min(3, Math.max(0.3, thisToDate / lastToDate));

  return thisToDate + lastRemaining * ratio;
};
