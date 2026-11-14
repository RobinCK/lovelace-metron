import type { Series } from './energy-sources';

export const degreeDays = (temperatures: Series, base: number): number | undefined => {
  const known = temperatures.filter((value): value is number => value !== undefined);

  if (known.length === 0) return undefined;

  return known.reduce((sum, value) => sum + Math.max(0, base - value), 0);
};

export const specific = (
  consumption: number | undefined,
  days: number | undefined,
): number | undefined => {
  if (consumption === undefined || !days || days <= 0) return undefined;

  return consumption / days;
};
