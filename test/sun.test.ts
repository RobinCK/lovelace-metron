import { describe, expect, it } from 'vitest';
import { sunDay, sunElevation } from '../src/core/sun';

describe('sun', () => {
  it('computes sunrise, noon and sunset for Kyiv in November', () => {
    const day = sunDay(Date.UTC(2026, 10, 13, 10), 50.45, 30.52);
    const hours = (time: number | undefined): number =>
      time === undefined
        ? Number.NaN
        : new Date(time).getUTCHours() + new Date(time).getUTCMinutes() / 60;

    expect(hours(day.sunrise)).toBeGreaterThan(5);
    expect(hours(day.sunrise)).toBeLessThan(5.6);
    expect(hours(day.sunset)).toBeGreaterThan(14.2);
    expect(hours(day.sunset)).toBeLessThan(14.8);
    expect(hours(day.noon)).toBeCloseTo(9.8, 0);
  });

  it('peaks at solar noon', () => {
    const day = sunDay(Date.UTC(2026, 5, 21, 10), 50.45, 30.52);
    const noon = sunElevation(day.noon, 50.45, 30.52);

    expect(noon).toBeGreaterThan(62);
    expect(noon).toBeLessThan(64);
    expect(sunElevation(day.noon - 3 * 3_600_000, 50.45, 30.52)).toBeLessThan(noon);
  });
});
