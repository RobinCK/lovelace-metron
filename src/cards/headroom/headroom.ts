import { HOUR, MINUTE } from '../../const';

export type Verdict = 'ok' | 'battery' | 'phase';

export interface PhaseLoad {
  readonly name: string;
  readonly power: number | undefined;
}

export interface ApplianceSpec {
  readonly name: string;
  readonly power: number;
  readonly phase?: number;
  readonly minutes: number;
}

export interface BatteryBudget {
  readonly energy: number;
  readonly load: number;
  readonly runtime?: number;
  readonly until?: number;
  readonly margin?: number;
}

export interface Assessment {
  readonly verdict: Verdict;
  readonly phase?: number;
  readonly free?: number;
  readonly cost?: number;
}

export const freeOn = (phase: PhaseLoad, limit: number): number =>
  Math.max(0, limit - Math.max(0, phase.power ?? 0));

export const batteryBudget = (
  soc: number | undefined,
  reserve: number,
  capacity: number | undefined,
  load: number,
  until: number | undefined,
): BatteryBudget | undefined => {
  if (soc === undefined || capacity === undefined) return undefined;

  const energy = Math.max(0, ((soc - reserve) / 100) * capacity);
  const runtime = load > 0 ? (energy / (load / 1000)) * HOUR : undefined;
  const margin = runtime !== undefined && until !== undefined ? runtime - until : undefined;

  return { energy, load, runtime, until, margin };
};

export const assess = (
  appliance: ApplianceSpec,
  phases: readonly PhaseLoad[],
  limit: number,
  budget: BatteryBudget | undefined,
  outage: boolean,
): Assessment => {
  const fixed = appliance.phase === undefined ? undefined : appliance.phase - 1;
  const indexes = fixed !== undefined && phases[fixed] ? [fixed] : phases.map((_, index) => index);
  const best = indexes
    .flatMap((index) => {
      const phase = phases[index];

      return phase ? [{ index, free: freeOn(phase, limit) }] : [];
    })
    .sort((a, b) => b.free - a.free)[0];

  if (!best) return { verdict: 'ok' };
  if (appliance.power > best.free) return { verdict: 'phase', phase: best.index, free: best.free };

  const cost =
    budget && budget.load > 0
      ? ((appliance.power * appliance.minutes) / budget.load) * MINUTE
      : undefined;

  if (outage && cost !== undefined && budget?.margin !== undefined && cost > budget.margin) {
    return { verdict: 'battery', phase: best.index, free: best.free, cost };
  }

  return { verdict: 'ok', phase: best.index, free: best.free, cost };
};

export const powerOnTime = (state: string | undefined, now: number): number | undefined => {
  if (state === undefined || state.trim() === '') return undefined;

  const minutes = Number(state);

  if (Number.isFinite(minutes)) return minutes > 0 ? now + minutes * MINUTE : undefined;

  const time = Date.parse(state);

  return Number.isFinite(time) && time > now ? time : undefined;
};
