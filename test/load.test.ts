import { describe, expect, it } from 'vitest';
import { MINUTE } from '../src/const';
import { assess, batteryBudget, powerOnTime } from '../src/cards/headroom/headroom';
import {
  imbalance,
  levelOf,
  phaseLimit,
  sumSeries,
  todayStats,
  totalLimit,
  usage,
} from '../src/cards/load/load';

describe('load limits', () => {
  it('takes the phase limit from the breaker or splits the input limit', () => {
    expect(phaseLimit(25, undefined, 230, 3)).toBe(5750);
    expect(phaseLimit(undefined, 15, undefined, 3)).toBe(5000);
    expect(phaseLimit(undefined, undefined, 230, 3)).toBeUndefined();
    expect(totalLimit(25, undefined, 3)).toBe(17250);
    expect(totalLimit(25, 15, 3)).toBe(15000);
  });

  it('prefers the current against the breaker', () => {
    expect(usage(4720, 5750, 20.5, 25)).toBeCloseTo(0.82);
    expect(usage(4720, 5750)).toBeCloseTo(0.821, 3);
    expect(usage(4720, undefined)).toBeUndefined();
  });

  it('grades the load', () => {
    expect(levelOf(0.5, 70, 90)).toBe('ok');
    expect(levelOf(0.82, 70, 90)).toBe('caution');
    expect(levelOf(0.95, 70, 90)).toBe('warn');
    expect(levelOf(undefined, 70, 90)).toBe('ok');
  });

  it('finds the most and the least loaded phases', () => {
    expect(imbalance([1210, 4720, 490])).toEqual({ high: 1, low: 2, spread: 4230 });
    expect(imbalance([1210, undefined])).toBeUndefined();
  });

  it('counts energy and the peak of today', () => {
    const step = 5 * MINUTE;
    const single = todayStats(
      [
        [
          { start: 0, mean: 1200, max: 3000 },
          { start: step, mean: 2400, max: 2600 },
        ],
      ],
      step,
    );
    const phases = todayStats(
      [[{ start: 0, mean: 1000, max: 5000 }], [{ start: 0, mean: 2000, max: 2500 }]],
      step,
    );

    expect(single.energy).toBeCloseTo(0.3);
    expect(single.peak).toEqual({ value: 3000, time: 0 });
    expect(phases.peak).toEqual({ value: 3000, time: 0 });
  });

  it('adds phase series minute by minute', () => {
    expect(
      sumSeries([
        [1, 2, undefined],
        [3, 4, 5],
      ]),
    ).toEqual([4, 6, undefined]);
  });
});

describe('outage headroom', () => {
  const phases = [
    { name: 'L1', power: 1400 },
    { name: 'L2', power: 3400 },
    { name: 'L3', power: 500 },
  ];

  it('works out the battery runtime and the margin to the power return', () => {
    const budget = batteryBudget(64, 10, 32, 5300, 175 * MINUTE);

    expect(budget?.energy).toBeCloseTo(17.28);
    expect((budget?.runtime ?? 0) / MINUTE).toBeCloseTo(195.6, 1);
    expect((budget?.margin ?? 0) / MINUTE).toBeCloseTo(20.6, 1);
  });

  it('checks the phase first and then the battery', () => {
    const budget = batteryBudget(64, 10, 32, 5300, 175 * MINUTE);
    const kettle = assess(
      { name: 'Kettle', power: 2200, phase: 2, minutes: 3 },
      phases,
      4000,
      budget,
      true,
    );
    const boiler = assess(
      { name: 'Boiler', power: 2000, phase: 3, minutes: 60 },
      phases,
      4000,
      budget,
      true,
    );
    const microwave = assess(
      { name: 'Microwave', power: 1200, phase: 1, minutes: 5 },
      phases,
      4000,
      budget,
      true,
    );
    const anywhere = assess(
      { name: 'Heater', power: 3000, minutes: 10 },
      phases,
      4000,
      budget,
      true,
    );

    expect(kettle).toMatchObject({ verdict: 'phase', phase: 1, free: 600 });
    expect(boiler.verdict).toBe('battery');
    expect(microwave.verdict).toBe('ok');
    expect(anywhere).toMatchObject({ verdict: 'ok', phase: 2 });
  });

  it('reads the power return as a time or as minutes', () => {
    const now = Date.parse('2026-11-16T18:05:00Z');

    expect(powerOnTime('2026-11-16T21:00:00Z', now)).toBe(Date.parse('2026-11-16T21:00:00Z'));
    expect(powerOnTime('55', now)).toBe(now + 55 * MINUTE);
    expect(powerOnTime('2026-11-16T17:00:00Z', now)).toBeUndefined();
    expect(powerOnTime('unknown', now)).toBeUndefined();
  });
});
