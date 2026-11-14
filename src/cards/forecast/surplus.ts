export interface SurplusWindow {
  readonly from: number;
  readonly to: number;
  readonly peak: number;
  readonly energy: number;
}

export const surplusWindow = (
  production: readonly number[],
  load: readonly number[],
  threshold: number,
  slotHours = 1,
): SurplusWindow | undefined => {
  const surplus = production.map((value, index) => value - (load[index] ?? 0));
  const first = surplus.findIndex((value) => value >= threshold);

  if (first < 0) return undefined;

  let last = first;

  surplus.forEach((value, index) => {
    if (value >= threshold) last = index;
  });

  const inside = surplus.slice(first, last + 1);

  return {
    from: first,
    to: last + 1,
    peak: Math.max(...inside),
    energy: inside.reduce((sum, value) => sum + Math.max(0, value) * slotHours, 0),
  };
};
