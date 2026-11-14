import { describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en';
import type { TranslationKey } from '../src/i18n/en';
import { UK } from '../src/i18n/uk';

const placeholders = (text: string | undefined): string[] =>
  [...(text ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

describe('translations', () => {
  const keys = Object.keys(EN) as TranslationKey[];

  it('translates every key into Ukrainian', () => {
    expect(keys.filter((key) => UK[key] === undefined)).toEqual([]);
  });

  it('keeps the same placeholders', () => {
    expect(
      keys.filter((key) => placeholders(EN[key]).join() !== placeholders(UK[key]).join()),
    ).toEqual([]);
  });
});
