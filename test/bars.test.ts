import { describe, expect, it } from 'vitest';
import { barWindow, currentIndex } from '../src/cards/bars/windows';

const at = (year: number, month: number, day: number, hour = 0): number =>
  new Date(year, month - 1, day, hour).getTime();

describe('bar windows', () => {
  const now = at(2026, 11, 17, 21);

  it('shows the hours of a day and steps by days', () => {
    const today = barWindow('hour', now, 0, 13);
    const before = barWindow('hour', now, -1, 13);

    expect(today.start).toBe(at(2026, 11, 17));
    expect(today.end).toBe(at(2026, 11, 18));
    expect(before.start).toBe(at(2026, 11, 16));
    expect(currentIndex(today, now)).toBe(today.starts.indexOf(at(2026, 11, 17, 21)));
    expect(currentIndex(before, now)).toBe(-1);
  });

  it('shows the days of a month', () => {
    const month = barWindow('day', now, 0, 13);
    const previous = barWindow('day', now, -1, 13);

    expect(month.starts).toHaveLength(30);
    expect(month.starts[0]).toBe(at(2026, 11, 1));
    expect(previous.starts).toHaveLength(31);
    expect(previous.start).toBe(at(2026, 10, 1));
    expect(currentIndex(month, now)).toBe(16);
  });

  it('ends the week window with the current week and steps by the whole window', () => {
    const weeks = barWindow('week', now, 0, 4);
    const earlier = barWindow('week', now, -1, 4);

    expect(weeks.starts).toHaveLength(4);
    expect(weeks.starts[3]).toBe(at(2026, 11, 16));
    expect(weeks.start).toBe(at(2026, 10, 26));
    expect(earlier.end).toBe(weeks.start);
    expect(currentIndex(weeks, now)).toBe(3);
  });

  it('shows the months of a year', () => {
    const year = barWindow('month', now, 0, 13);
    const previous = barWindow('month', now, -1, 13);

    expect(year.starts).toHaveLength(12);
    expect(year.start).toBe(at(2026, 1, 1));
    expect(previous.start).toBe(at(2025, 1, 1));
    expect(currentIndex(year, now)).toBe(10);
  });
});
