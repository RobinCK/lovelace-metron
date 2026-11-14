import type { HassEntity, HomeAssistant } from '../types/ha';

export type Quantity = 'power' | 'energy' | 'volume' | 'temperature' | 'percent' | 'raw';

const FACTORS: Readonly<Record<Quantity, Readonly<Partial<Record<string, number>>>>> = {
  power: { mW: 0.001, W: 1, kW: 1000, MW: 1_000_000 },
  energy: { Wh: 0.001, kWh: 1, MWh: 1000, GWh: 1_000_000 },
  volume: { 'm³': 1, m3: 1, L: 0.001, 'ft³': 0.0283168, ft3: 0.0283168, CCF: 2.83168 },
  temperature: {},
  percent: {},
  raw: {},
};

export const STATISTIC_UNITS: Readonly<Record<string, string>> = {
  energy: 'kWh',
  power: 'W',
  volume: 'm³',
  temperature: '°C',
};

const UNAVAILABLE = new Set(['unavailable', 'unknown', '']);

export const parseNumber = (state: string | undefined): number | undefined => {
  if (state === undefined || UNAVAILABLE.has(state.trim())) return undefined;

  const value = Number(state);

  return Number.isFinite(value) ? value : undefined;
};

export const unitFactor = (quantity: Quantity, unit: unknown): number => {
  if (typeof unit !== 'string') return 1;

  return FACTORS[quantity][unit] ?? 1;
};

const convertTemperature = (value: number, unit: unknown): number =>
  unit === '°F' ? ((value - 32) * 5) / 9 : value;

export const convert = (value: number, quantity: Quantity, unit: unknown): number => {
  if (quantity === 'temperature') return convertTemperature(value, unit);

  return value * unitFactor(quantity, unit);
};

export const entityOf = (
  hass: HomeAssistant,
  entityId: string | undefined,
): HassEntity | undefined => (entityId ? hass.states[entityId] : undefined);

export const readNumber = (
  hass: HomeAssistant,
  entityId: string | undefined,
  quantity: Quantity = 'raw',
): number | undefined => {
  const entity = entityOf(hass, entityId);

  if (!entity) return undefined;

  const value = parseNumber(entity.state);

  if (value === undefined) return undefined;

  return convert(value, quantity, entity.attributes.unit_of_measurement);
};

export const isAvailable = (hass: HomeAssistant, entityId: string | undefined): boolean => {
  const entity = entityOf(hass, entityId);

  return entity !== undefined && !UNAVAILABLE.has(entity.state);
};

const ON_STATES = new Set(['on', 'true', 'home', 'open', 'connected', 'grid on', '1']);

export const isOn = (hass: HomeAssistant, entityId: string | undefined): boolean | undefined => {
  const entity = entityOf(hass, entityId);

  if (!entity || UNAVAILABLE.has(entity.state)) return undefined;

  return ON_STATES.has(entity.state.toLowerCase());
};

export const entityName = (hass: HomeAssistant, entityId: string | undefined): string => {
  const entity = entityOf(hass, entityId);
  const name = entity?.attributes.friendly_name;

  return typeof name === 'string' ? name : (entityId ?? '');
};

export const attribute = <T>(
  hass: HomeAssistant,
  entityId: string | undefined,
  key: string,
): T | undefined => entityOf(hass, entityId)?.attributes[key] as T | undefined;
