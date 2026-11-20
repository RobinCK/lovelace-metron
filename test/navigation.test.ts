import { describe, expect, it } from 'vitest';
import { profileWindow } from '../src/cards/profile/window';
import { yearWindow } from '../src/cards/solar-year/window';

const at = (year: number, month: number, day: number, hour = 0): number =>
  new Date(year, month - 1, day, hour).getTime();

describe('period windows', () => {
  const now = at(2026, 11, 20, 15);

  it('takes the load profile from the whole weeks before today and steps by them', () => {
    const current = profileWindow(now, 12, 0);
    const earlier = profileWindow(now, 12, -1);

    expect(current.start).toBe(at(2026, 8, 28));
    expect(current.end).toBe(at(2026, 11, 20));
    expect(earlier.start).toBe(at(2026, 6, 5));
    expect(earlier.end).toBe(current.start);
  });

  it('ends the solar year today and steps back by whole windows', () => {
    const current = yearWindow(now, 52, 1, 0);
    const earlier = yearWindow(now, 52, 1, -1);

    expect(current.start).toBe(at(2025, 11, 24));
    expect(current.end).toBe(at(2026, 11, 21));
    expect(earlier.start).toBe(at(2024, 11, 25));
    expect(earlier.end).toBe(current.start);
  });
});
