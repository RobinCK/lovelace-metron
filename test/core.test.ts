import { describe, expect, it } from 'vitest';
import * as cfg from '../src/core/config';
import {
  formatEnergy,
  formatMonth,
  formatNumber,
  formatPower,
  formatTime,
  toFormatLocale,
} from '../src/core/format';
import { createLocalize } from '../src/core/i18n';
import { niceMax, quantile } from '../src/core/math';

const locale = toFormatLocale({ language: 'en', number_format: 'comma_decimal' }, 'en', {
  kW: 'kW',
});

describe('format', () => {
  it('formats power and energy with sensible units', () => {
    expect(formatPower(840, locale)).toEqual({ value: '840', unit: 'W' });
    expect(formatPower(9840, locale)).toEqual({ value: '9.84', unit: 'kW' });
    expect(formatEnergy(21.44, locale)).toEqual({ value: '21.4', unit: 'kWh' });
    expect(formatNumber(-0.001, 1, locale)).toBe('0.0');
  });

  it('uses translated units', () => {
    const uk = toFormatLocale({ language: 'uk' }, 'uk', { kW: 'кВт' });

    expect(formatPower(2060, uk)).toEqual({ value: '2,06', unit: 'кВт' });
  });

  it('names months in the card language whatever the time format', () => {
    const time = new Date(2026, 10, 15, 22, 5).getTime();
    const system = toFormatLocale({ language: 'en', time_format: 'system' }, 'en');
    const fixed = toFormatLocale({ language: 'en', time_format: '24' }, 'en');

    expect(system.timeLocale).toBe('en');
    expect(formatMonth(time, system, true)).toBe('November');
    expect(formatTime(time, fixed)).toBe('22:05');
  });
});

describe('i18n', () => {
  it('falls back to English and supports overrides', () => {
    const t = createLocalize('uk', { 'flow.home': 'Хата' });

    expect(t('flow.solar')).toBe('Сонце');
    expect(t('flow.home')).toBe('Хата');
    expect(createLocalize('de')('flow.solar')).toBe('Solar');
    expect(t('flow.from_solar', { value: 42 })).toBe('42 % від сонця');
  });
});

describe('config', () => {
  it('reads entity lists from strings and objects', () => {
    const items = cfg.entityItems(
      { list: ['sensor.a', { entity: 'sensor.b', name: 'B' }, { name: 'broken' }, 'nope'] },
      'list',
    );

    expect(items).toEqual([
      { entity: 'sensor.a', name: undefined, icon: undefined, color: undefined },
      { entity: 'sensor.b', name: 'B', icon: undefined, color: undefined },
    ]);
  });

  it('clamps numbers', () => {
    expect(cfg.number({ value: 150 }, 'value', 10, { max: 100 })).toBe(100);
    expect(cfg.number({ value: 'x' }, 'value', 10)).toBe(10);
  });
});

describe('math', () => {
  it('computes nice maxima and quantiles', () => {
    expect(niceMax(7.3)).toBe(8);
    expect(niceMax(0)).toBe(1);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

import { parseClock } from '../src/core/time';

describe('time', () => {
  it('parses clock values from the time selector', () => {
    expect(parseClock('17:00:00', 0)).toBe(1020);
    expect(parseClock('7:30', 0)).toBe(450);
    expect(parseClock('25:00', 60)).toBe(60);
  });
});
