import { median } from '../../core/math';

export type Grid = readonly (readonly (number | undefined)[])[];

export const normalize = (
  values: readonly (number | undefined)[],
  kwp: number,
): (number | undefined)[] =>
  values.map((value) => (value === undefined || kwp <= 0 ? undefined : value / kwp));

export const yieldDeviation = (yields: readonly number[], kwps: readonly number[]): number[] => {
  const specific = yields.map((value, index) => value / (kwps[index] || 1));
  const middle = median(specific) ?? 0;

  return specific.map((value) => (middle > 0 ? value / middle - 1 : 0));
};

export const dipCounts = (
  days: readonly Grid[],
  kwps: readonly number[],
  threshold: number,
  minimum = 0.05,
): number[][] => {
  const strings = kwps.length;
  const slots = days[0]?.[0]?.length ?? 0;
  const counts = Array.from({ length: strings }, () => Array.from({ length: slots }, () => 0));

  for (const day of days) {
    for (let slot = 0; slot < slots; slot++) {
      const normalized = kwps.map((kwp, index) => {
        const value = day[index]?.[slot];

        return value === undefined || kwp <= 0 ? undefined : value / kwp;
      });
      const known = normalized.filter((value): value is number => value !== undefined);
      const middle = median(known);

      if (middle === undefined || middle < minimum || known.length < 2) continue;

      normalized.forEach((value, index) => {
        if (value !== undefined && value < middle * (1 - threshold)) {
          const row = counts[index];

          if (row) row[slot] = (row[slot] ?? 0) + 1;
        }
      });
    }
  }

  return counts;
};

export interface Window {
  readonly from: number;
  readonly to: number;
  readonly days: number;
}

export const repeatingWindow = (counts: readonly number[], minimum: number): Window | undefined => {
  let best: Window | undefined;
  let start = -1;

  for (let slot = 0; slot <= counts.length; slot++) {
    const active = slot < counts.length && (counts[slot] ?? 0) >= minimum;

    if (active && start < 0) start = slot;

    if (!active && start >= 0) {
      const days = Math.max(...counts.slice(start, slot));

      if (!best || slot - start > best.to - best.from) best = { from: start, to: slot, days };

      start = -1;
    }
  }

  return best;
};
