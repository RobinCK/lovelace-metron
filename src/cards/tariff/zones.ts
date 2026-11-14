import { parseClock } from '../../core/time';

export interface Zone {
  readonly from: number;
  readonly to: number;
  readonly factor: number;
}

export interface Plan {
  readonly name?: string;
  readonly zones: readonly Zone[];
}

export const zone = (from: string, to: string, factor: number): Zone => ({
  from: parseClock(from, 0),
  to: parseClock(to, 0),
  factor,
});

export const DEFAULT_PLANS: readonly Plan[] = [
  { zones: [zone('23:00', '07:00', 0.5)] },
  {
    zones: [zone('23:00', '07:00', 0.4), zone('08:00', '11:00', 1.5), zone('20:00', '22:00', 1.5)],
  },
];

export const contains = (item: Zone, minutes: number): boolean =>
  item.from <= item.to
    ? minutes >= item.from && minutes < item.to
    : minutes >= item.from || minutes < item.to;

export const factorAt = (plan: Plan, hour: number): number =>
  plan.zones.find((item) => contains(item, hour * 60 + 30))?.factor ?? 1;

export const bill = (plan: Plan, net: readonly number[], price: number): number =>
  net.reduce((sum, value, hour) => sum + value * factorAt(plan, hour), 0) * price;

export const nightFactor = (plan: Plan): number =>
  Math.min(1, ...plan.zones.map((item) => item.factor));

export const shiftedBill = (
  plan: Plan,
  net: readonly number[],
  price: number,
  loss: number,
): number => {
  const night = nightFactor(plan);
  const cheap = (hour: number): boolean => factorAt(plan, hour) <= night;
  const nightNet = net.reduce((sum, value, hour) => (cheap(hour) ? sum + value : sum), 0);
  const dayNet = net.reduce((sum, value, hour) => (cheap(hour) ? sum : sum + value), 0);

  return (
    (nightNet + Math.max(0, dayNet) * (1 + loss)) * night * price + Math.min(0, dayNet) * price
  );
};

export interface Segment {
  readonly from: number;
  readonly to: number;
  readonly factor: number;
}

export const segments = (plan: Plan): Segment[] => {
  const result: Segment[] = [];

  for (let hour = 0; hour < 24; hour++) {
    const factor = factorAt(plan, hour);
    const last = result[result.length - 1];

    if (last?.factor === factor && last.to === hour) {
      result[result.length - 1] = { ...last, to: hour + 1 };
    } else {
      result.push({ from: hour, to: hour + 1, factor });
    }
  }

  return result;
};
