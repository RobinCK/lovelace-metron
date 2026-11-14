import { median } from '../../core/math';

export interface StepChange {
  readonly index: number;
  readonly before: number;
  readonly after: number;
}

export const detectStep = (
  values: readonly (number | undefined)[],
  minimumSegment: number,
  threshold: number,
): StepChange | undefined => {
  let best: StepChange | undefined;

  for (let index = minimumSegment; index <= values.length - minimumSegment; index++) {
    const before = median(
      values.slice(0, index).filter((value): value is number => value !== undefined),
    );
    const after = median(
      values.slice(index).filter((value): value is number => value !== undefined),
    );

    if (before === undefined || after === undefined) continue;
    if (Math.abs(after - before) < threshold) continue;
    if (!best || Math.abs(after - before) > Math.abs(best.after - best.before))
      best = { index, before, after };
  }

  return best;
};
