import type { RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import {
  deviceClass,
  entityName,
  formatEntity,
  formatValue,
  isOn,
  readNumber,
} from '../../core/entities';
import type { Quantity } from '../../core/entities';
import { formatNumber, formatPower } from '../../core/format';
import type { FormatLocale, Formatted } from '../../core/format';
import type { Localize } from '../../core/i18n';
import { clamp } from '../../core/math';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ListField } from '../../ui/form';
import { colorOf } from '../../ui/parts';

export type ProgressStyle = 'bar' | 'segments';

export interface ItemConfig {
  readonly entity: string;
  readonly name?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly invert: boolean;
  readonly digits?: number;
  readonly secondary?: string;
  readonly secondary_label?: string;
  readonly power?: string;
  readonly invert_power: boolean;
  readonly direction: boolean;
  readonly progress?: string | number;
  readonly progress_max?: string | number;
  readonly progress_style?: ProgressStyle;
  readonly phases: readonly string[];
  readonly sparkline: boolean;
}

export interface PhaseView {
  readonly name: string;
  readonly color: string;
}

export interface ItemView {
  readonly name: string;
  readonly color: string;
  readonly value: Formatted;
  readonly secondary?: string;
  readonly secondaryColor?: string;
  readonly progress?: number;
  readonly progressStyle: ProgressStyle;
  readonly phases: readonly PhaseView[];
}

export const ITEM_LIST_FIELDS: Readonly<Record<string, ListField>> = {
  ...form.ITEM_FIELDS,
  secondary: { selector: { text: {} } },
  secondary_label: { selector: { text: {} } },
  power: { selector: { entity: { filter: { domain: 'sensor', device_class: 'power' } } } },
  direction: { selector: { boolean: {} } },
  invert: { selector: { boolean: {} } },
  progress: { selector: { text: {} } },
  progress_max: { selector: { text: {} } },
  sparkline: { selector: { boolean: {} } },
};

const POWER_IDLE = 20;

const entityOrNumber = (raw: RawConfig, key: string): string | number | undefined =>
  cfg.entity(raw, key) ?? cfg.optionalNumber(raw, key);

const quantityOf = (kind: string | undefined): Quantity => {
  if (kind === 'power') return 'power';
  if (kind === 'energy') return 'energy';

  return 'raw';
};

const resolveNumber = (
  hass: HomeAssistant,
  source: string | number | undefined,
): number | undefined => {
  if (typeof source === 'number') return source;

  return readNumber(hass, source, quantityOf(deviceClass(hass, source)));
};

export const parseItem = (raw: RawConfig): ItemConfig | undefined => {
  const entity = cfg.entity(raw, 'entity');

  if (!entity) return undefined;

  return {
    entity,
    name: cfg.text(raw, 'name'),
    icon: cfg.text(raw, 'icon'),
    color: cfg.text(raw, 'color'),
    invert: cfg.boolean(raw, 'invert', false),
    digits: cfg.optionalNumber(raw, 'digits'),
    secondary: cfg.text(raw, 'secondary'),
    secondary_label: cfg.text(raw, 'secondary_label'),
    power: cfg.entity(raw, 'power'),
    invert_power: cfg.boolean(raw, 'invert_power', false),
    direction: cfg.boolean(raw, 'direction', false),
    progress: entityOrNumber(raw, 'progress'),
    progress_max: entityOrNumber(raw, 'progress_max'),
    progress_style:
      raw.progress_style === 'bar' || raw.progress_style === 'segments'
        ? raw.progress_style
        : undefined,
    phases: cfg.list(raw, 'phases', (item) => cfg.entity(item, 'entity')),
    sparkline: cfg.boolean(raw, 'sparkline', false),
  };
};

export const itemEntities = (item: ItemConfig): (string | undefined)[] => [
  item.entity,
  item.power,
  typeof item.progress === 'string' ? item.progress : undefined,
  typeof item.progress_max === 'string' ? item.progress_max : undefined,
  item.secondary,
  ...item.phases,
];

const phaseColor = (hass: HomeAssistant, entityId: string): string => {
  const voltage = readNumber(hass, entityId);

  if (voltage !== undefined) {
    return voltage >= 207 && voltage <= 253 ? 'var(--m-ok)' : 'var(--m-warn)';
  }

  const on = isOn(hass, entityId);

  if (on === undefined) return 'var(--m-muted)';

  return on ? 'var(--m-ok)' : 'var(--m-warn)';
};

const progressOf = (
  hass: HomeAssistant,
  item: ItemConfig,
  value: number | undefined,
  kind: string | undefined,
): number | undefined => {
  if (item.progress_max !== undefined) {
    const current = item.progress === undefined ? value : resolveNumber(hass, item.progress);
    const max = resolveNumber(hass, item.progress_max);

    return current === undefined || !max ? undefined : clamp(current / max, 0, 1);
  }

  if (item.progress !== undefined) {
    const percent = resolveNumber(hass, item.progress);

    return percent === undefined ? undefined : clamp(percent / 100, 0, 1);
  }

  if (kind === 'battery' && value !== undefined) return clamp(value / 100, 0, 1);

  return undefined;
};

const powerNote = (
  hass: HomeAssistant,
  item: ItemConfig,
  t: Localize,
  locale: FormatLocale,
): string | undefined => {
  const raw = readNumber(hass, item.power, 'power');

  if (raw === undefined) return undefined;

  const watts = item.invert_power ? -raw : raw;
  const power = formatPower(Math.abs(watts), locale);

  if (watts < -POWER_IDLE) return `+${power.value} ${power.unit} · ${t('flow.charging')}`;
  if (watts > POWER_IDLE) return `−${power.value} ${power.unit} · ${t('flow.discharging')}`;

  return t('flow.idle');
};

const secondaryText = (
  hass: HomeAssistant,
  item: ItemConfig,
  progress: number | undefined,
  t: Localize,
  locale: FormatLocale,
): string | undefined => {
  const secondary = item.secondary;

  if (!secondary) return undefined;

  if (hass.states[secondary]) {
    const formatted = formatEntity(hass, secondary, locale);
    const label =
      item.secondary_label ??
      (deviceClass(hass, secondary) === 'energy' ? t('items.today') : undefined);
    const text = `${formatted.value}${formatted.unit ? ` ${formatted.unit}` : ''}`;

    return label ? `${label} ${text}` : text;
  }

  return secondary.replace(
    '{percent}',
    progress === undefined ? '—' : formatNumber(progress * 100, 0, locale),
  );
};

export const describeItem = (
  hass: HomeAssistant,
  item: ItemConfig,
  index: number,
  t: Localize,
  locale: FormatLocale,
): ItemView => {
  const kind = deviceClass(hass, item.entity);
  const raw = readNumber(hass, item.entity, quantityOf(kind));
  const value = raw === undefined ? undefined : item.invert ? -raw : raw;
  const color = colorOf(item.color, index);
  const progress = progressOf(hass, item, value, kind);
  const formatted =
    item.direction && value !== undefined
      ? formatValue(hass, item.entity, Math.abs(value), locale, item.digits)
      : formatEntity(hass, item.entity, locale, item.digits, item.invert);
  let secondary = secondaryText(hass, item, progress, t, locale);
  let secondaryColor: string | undefined;

  if (secondary === undefined && item.power) {
    secondary = powerNote(hass, item, t, locale);
    secondaryColor = color;
  }

  if (secondary === undefined && item.direction && value !== undefined) {
    const watts = kind === 'power' ? value : value * 1000;

    if (watts < -POWER_IDLE) secondary = `↗ ${t('flow.export')}`;
    if (watts > POWER_IDLE) secondary = `↙ ${t('flow.import')}`;

    secondaryColor = color;
  }

  return {
    name: item.name ?? entityName(hass, item.entity),
    color,
    value: formatted,
    secondary,
    secondaryColor,
    progress,
    progressStyle: item.progress_style ?? (kind === 'battery' ? 'segments' : 'bar'),
    phases: item.phases.map((phase, position) => ({
      name: `L${position + 1}`,
      color: phaseColor(hass, phase),
    })),
  };
};
