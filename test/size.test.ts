import { describe, expect, it } from 'vitest';
import {
  clampSize,
  contentHeight,
  isSizeSetting,
  rowsCardSize,
  rowsHeight,
  sizeRows,
  sizesBetween,
  tierOf,
} from '../src/core/size';

describe('card sizes', () => {
  it('matches the Home Assistant section grid', () => {
    expect(rowsHeight(3)).toBe(184);
    expect(rowsHeight(6)).toBe(376);
    expect(rowsHeight(9)).toBe(568);
    expect(rowsHeight(9)).toBe(rowsHeight(3) + 8 + rowsHeight(6));
    expect(rowsHeight(6)).toBe(rowsHeight(3) * 2 + 8);
  });

  it('converts rows to masonry card size', () => {
    expect(rowsCardSize(3)).toBe(4);
    expect(rowsCardSize(6)).toBe(8);
  });

  it('leaves room for padding and border', () => {
    expect(contentHeight('small')).toBe(150);
    expect(contentHeight('large')).toBe(534);
  });

  it('maps presets to rows', () => {
    expect(sizeRows('small')).toBe(3);
    expect(sizeRows('medium')).toBe(6);
    expect(sizeRows('large')).toBe(9);
    expect(sizeRows('auto')).toBeUndefined();
  });

  it('keeps a size within the card range', () => {
    expect(clampSize('small', 'medium', 'large')).toBe('medium');
    expect(clampSize('large', 'small', 'medium')).toBe('medium');
    expect(clampSize('medium', 'small', 'large')).toBe('medium');
    expect(clampSize('auto', 'medium', 'medium')).toBe('auto');
  });

  it('lists the sizes a card offers', () => {
    expect(sizesBetween('small', 'large')).toEqual(['small', 'medium', 'large']);
    expect(sizesBetween('small', 'medium')).toEqual(['small', 'medium']);
    expect(sizesBetween('medium', 'medium')).toEqual(['medium']);
  });

  it('picks the layout for a row count', () => {
    expect(tierOf(undefined)).toBe('auto');
    expect(tierOf(3)).toBe('small');
    expect(tierOf(5)).toBe('small');
    expect(tierOf(6)).toBe('medium');
    expect(tierOf(8)).toBe('medium');
    expect(tierOf(12)).toBe('large');
  });

  it('accepts only known settings', () => {
    expect(isSizeSetting('medium')).toBe(true);
    expect(isSizeSetting('auto')).toBe(true);
    expect(isSizeSetting('xlarge')).toBe(false);
    expect(isSizeSetting(6)).toBe(false);
  });
});
