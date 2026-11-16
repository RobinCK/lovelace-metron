import { HOUR } from '../../const';

export const NOMINAL_VOLTAGE = 230;

export type Level = 'ok' | 'caution' | 'warn';

export interface PowerRow {
  readonly start: number;
  readonly mean?: number | null;
  readonly max?: number | null;
}

export interface Peak {
  readonly value: number;
  readonly time: number;
}

export interface TodayStats {
  readonly energy?: number;
  readonly peak?: Peak;
}

export interface Imbalance {
  readonly high: number;
  readonly low: number;
  readonly spread: number;
}

export const phaseLimit = (
  breaker: number | undefined,
  limit: number | undefined,
  voltage: number | undefined,
  phases: number,
): number | undefined => {
  if (breaker !== undefined) return breaker * (voltage ?? NOMINAL_VOLTAGE);
  if (limit !== undefined && phases > 0) return (limit * 1000) / phases;

  return undefined;
};

export const totalLimit = (
  breaker: number | undefined,
  limit: number | undefined,
  phases: number,
): number | undefined => {
  if (limit !== undefined) return limit * 1000;
  if (breaker !== undefined) return breaker * NOMINAL_VOLTAGE * Math.max(1, phases);

  return undefined;
};

export const usage = (
  power: number | undefined,
  limit: number | undefined,
  current?: number,
  breaker?: number,
): number | undefined => {
  if (current !== undefined && breaker !== undefined && breaker > 0) {
    return Math.max(0, current) / breaker;
  }

  if (power === undefined || limit === undefined || limit <= 0) return undefined;

  return Math.max(0, power) / limit;
};

export const levelOf = (ratio: number | undefined, warning: number, critical: number): Level => {
  if (ratio === undefined) return 'ok';
  if (ratio * 100 >= critical) return 'warn';
  if (ratio * 100 >= warning) return 'caution';

  return 'ok';
};

export const imbalance = (powers: readonly (number | undefined)[]): Imbalance | undefined => {
  const known = powers.flatMap((power, index) => (power === undefined ? [] : [{ power, index }]));

  if (known.length < 2) return undefined;

  const sorted = [...known].sort((a, b) => b.power - a.power);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];

  if (!high || !low) return undefined;

  return { high: high.index, low: low.index, spread: high.power - low.power };
};

export const todayStats = (series: readonly (readonly PowerRow[])[], step: number): TodayStats => {
  const single = series.length === 1;
  const slots = new Map<number, { mean: number; max: number }>();

  for (const rows of series) {
    for (const row of rows) {
      if (row.mean === undefined || row.mean === null) continue;

      const slot = slots.get(row.start) ?? { mean: 0, max: 0 };
      const max = single ? (row.max ?? row.mean) : row.mean;

      slots.set(row.start, { mean: slot.mean + row.mean, max: slot.max + max });
    }
  }

  if (slots.size === 0) return {};

  let energy = 0;
  let peak: Peak | undefined;

  for (const [start, slot] of slots) {
    energy += (slot.mean / 1000) * (step / HOUR);

    if (!peak || slot.max > peak.value) peak = { value: slot.max, time: start };
  }

  return { energy, peak };
};

export const sumSeries = (
  series: readonly (readonly (number | undefined)[])[],
): (number | undefined)[] => {
  const length = Math.max(0, ...series.map((values) => values.length));

  return Array.from({ length }, (_, index) => {
    const values = series.map((values) => values[index]);

    if (values.some((value) => value === undefined)) return undefined;

    return values.reduce<number>((total, value) => total + (value ?? 0), 0);
  });
};
