import type { StatisticRow } from './statistics';

export const energySince = (
  rows: readonly StatisticRow[] | undefined,
  start: number,
  current: number | undefined,
): number | undefined => {
  const all = rows ?? [];
  const last = all[all.length - 1];

  if (!last) return current;

  const changes = all
    .filter((row) => row.start >= start)
    .reduce((total, row) => total + (row.change ?? 0), 0);
  const lastState = last.state;

  if (current === undefined || lastState === null || lastState === undefined) return changes;

  const reset = current < lastState * 0.5;

  return changes + (reset ? current : Math.max(0, current - lastState));
};

export const hourlyChanges = (
  rows: readonly StatisticRow[] | undefined,
  start: number,
  hours: number,
  pick: (row: StatisticRow) => number | null | undefined = (row) => row.change,
): (number | undefined)[] => {
  const values: (number | undefined)[] = Array.from({ length: hours }, () => undefined);

  for (const row of rows ?? []) {
    const index = Math.floor((row.start - start) / 3_600_000);
    const value = pick(row);

    if (index < 0 || index >= hours || value === null || value === undefined) continue;

    values[index] = (values[index] ?? 0) + value;
  }

  return values;
};
