import type { RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { bucketize, changeOf, fetchStatistics } from '../../core/data/statistics';
import type { StatisticPeriod, StatisticRow, StatisticsResult } from '../../core/data/statistics';
import { readNumber } from '../../core/entities';
import type { Quantity } from '../../core/entities';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { FormField } from '../../ui/form';

export const ENERGY_KEYS = ['solar', 'home', 'import', 'export', 'charge', 'discharge'] as const;

export type EnergyKey = (typeof ENERGY_KEYS)[number];

export type EnergySources = Readonly<Record<EnergyKey, readonly string[]>>;

export type Series = readonly (number | undefined)[];

export type EnergySeries = Readonly<Record<EnergyKey, Series>>;

export interface EnergyConfig {
  readonly entities: Readonly<Partial<Record<EnergyKey, readonly string[]>>>;
  readonly energy_dashboard: boolean;
}

export const ENERGY_OPTIONS: Readonly<Record<EnergyKey, string>> = {
  solar: 'solar_energy',
  home: 'home_energy',
  import: 'grid_import_energy',
  export: 'grid_export_energy',
  charge: 'battery_charge_energy',
  discharge: 'battery_discharge_energy',
};

interface EnergySourcePreference {
  readonly type?: string;
  readonly stat_energy_from?: string | null;
  readonly stat_energy_to?: string | null;
  readonly flow_from?: readonly { readonly stat_energy_from?: string | null }[];
  readonly flow_to?: readonly { readonly stat_energy_to?: string | null }[];
}

export interface EnergyPreferences {
  readonly energy_sources?: readonly EnergySourcePreference[];
  readonly device_consumption?: readonly {
    readonly stat_consumption: string;
    readonly name?: string;
  }[];
}

interface CachedPreferences {
  readonly time: number;
  readonly request: Promise<EnergyPreferences | undefined>;
}

const PREFERENCES_TTL = 10 * 60 * 1000;
const FALLBACK_KEY = {};
const preferencesCache = new WeakMap<object, CachedPreferences>();

export const DASHBOARD_ENERGY: EnergyConfig = { entities: {}, energy_dashboard: true };

export const parseEnergyConfig = (
  raw: RawConfig,
  keys: readonly EnergyKey[] = ENERGY_KEYS,
): EnergyConfig => {
  const entities: Partial<Record<EnergyKey, readonly string[]>> = {};

  for (const key of keys) {
    const ids = cfg.entityIds(raw, ENERGY_OPTIONS[key]);

    if (ids.length > 0) entities[key] = ids;
  }

  return {
    entities,
    energy_dashboard: keys.length < 2 || cfg.boolean(raw, 'energy_dashboard', true),
  };
};

export const energyFields = (keys: readonly EnergyKey[] = ENERGY_KEYS): FormField[] => {
  const fields = keys.map((key) => form.energyEntity(ENERGY_OPTIONS[key]));

  if (fields.length < 2) return fields;

  const rows = Array.from({ length: Math.ceil(fields.length / 2) }, (_, row) =>
    form.grid(...fields.slice(row * 2, row * 2 + 2)),
  );

  return [form.expandable('energy', ...rows, form.toggle('energy_dashboard'))];
};

export const fetchEnergyPreferences = (
  hass: HomeAssistant,
): Promise<EnergyPreferences | undefined> => {
  const key = hass.connection ?? FALLBACK_KEY;
  const cached = preferencesCache.get(key);

  if (cached && Date.now() - cached.time < PREFERENCES_TTL) return cached.request;

  const request = hass
    .callWS<EnergyPreferences>({ type: 'energy/get_prefs' })
    .catch((): undefined => undefined);

  preferencesCache.set(key, { time: Date.now(), request });

  return request;
};

const present = (values: readonly (string | null | undefined)[]): string[] =>
  values.filter((value): value is string => typeof value === 'string' && value !== '');

export const preferenceSources = (
  preferences: EnergyPreferences | undefined,
): Partial<Record<EnergyKey | 'gas', string[]>> => {
  const sources = preferences?.energy_sources ?? [];
  const ofType = (type: string): EnergySourcePreference[] =>
    sources.filter((source) => source.type === type);
  const grid = ofType('grid');
  const battery = ofType('battery');

  return {
    solar: present(ofType('solar').map((source) => source.stat_energy_from)),
    home: present(ofType('home').map((source) => source.stat_energy_to)),
    import: present(
      grid.flatMap((source) => [
        source.stat_energy_from,
        ...(source.flow_from ?? []).map((flow) => flow.stat_energy_from),
      ]),
    ),
    export: present(
      grid.flatMap((source) => [
        source.stat_energy_to,
        ...(source.flow_to ?? []).map((flow) => flow.stat_energy_to),
      ]),
    ),
    discharge: present(battery.map((source) => source.stat_energy_from)),
    charge: present(battery.map((source) => source.stat_energy_to)),
    gas: present(ofType('gas').map((source) => source.stat_energy_from)),
  };
};

export const resolveSources = async (
  hass: HomeAssistant,
  config: EnergyConfig,
  keys: readonly EnergyKey[] = ENERGY_KEYS,
): Promise<EnergySources> => {
  const explicit = config.entities;
  const missing = keys.some((key) => key !== 'home' && !explicit[key]);
  const fallback =
    config.energy_dashboard && missing ? preferenceSources(await fetchEnergyPreferences(hass)) : {};
  const pick = (key: EnergyKey): readonly string[] =>
    keys.includes(key) ? (explicit[key] ?? fallback[key] ?? []) : [];

  return {
    solar: pick('solar'),
    home: pick('home'),
    import: pick('import'),
    export: pick('export'),
    charge: pick('charge'),
    discharge: pick('discharge'),
  };
};

export const sourceIds = (sources: EnergySources): string[] => [
  ...new Set(ENERGY_KEYS.flatMap((key) => sources[key])),
];

export const hasSources = (sources: EnergySources): boolean => sourceIds(sources).length > 0;

export const fetchEnergyStatistics = (
  hass: HomeAssistant,
  sources: EnergySources,
  start: number,
  end: number,
  period: StatisticPeriod,
): Promise<StatisticsResult> =>
  fetchStatistics(hass, {
    entityIds: sourceIds(sources),
    start,
    end,
    period,
    types: ['change', 'state'],
  });

export const sumSeries = (series: readonly Series[], length: number): Series =>
  Array.from({ length }, (_, index) => {
    const values = series
      .map((item) => item[index])
      .filter((value): value is number => value !== undefined);

    return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0);
  });

export const tailOf = (
  rows: readonly StatisticRow[] | undefined,
  current: number | undefined,
): number => {
  const last = rows?.[rows.length - 1];
  const state = last?.state;

  if (current === undefined || state === null || state === undefined) return 0;
  if (current < state * 0.5) return current;

  return Math.max(0, current - state);
};

export interface LiveTail {
  readonly hass: HomeAssistant;
  readonly now: number;
}

const entitySeries = (
  stats: StatisticsResult,
  entityId: string,
  starts: readonly number[],
  end: number,
  live: LiveTail | undefined,
  quantity: Quantity = 'energy',
): Series => {
  const rows = stats.get(entityId);
  const values = bucketize(rows, starts, changeOf, 'sum', end);

  if (!live || live.now < (starts[0] ?? 0) || live.now >= end) return values;

  const index = starts.reduce(
    (found, start, position) => (start <= live.now ? position : found),
    0,
  );
  const tail = tailOf(rows, readNumber(live.hass, entityId, quantity));

  if (tail <= 0) return values;

  return values.map((value, position) => (position === index ? (value ?? 0) + tail : value));
};

export const deriveHome = (series: Omit<EnergySeries, 'home'>, length: number): Series =>
  Array.from({ length }, (_, index) => {
    const parts = [
      series.solar[index],
      series.import[index],
      series.discharge[index],
      series.export[index],
      series.charge[index],
    ];

    if (parts.every((part) => part === undefined)) return undefined;

    const [solar = 0, imported = 0, discharge = 0, exported = 0, charge = 0] = parts;

    return Math.max(0, solar + imported + discharge - exported - charge);
  });

export const energySeries = (
  stats: StatisticsResult,
  sources: EnergySources,
  starts: readonly number[],
  end: number,
  live?: LiveTail,
): EnergySeries => {
  const length = starts.length;
  const build = (key: EnergyKey): Series =>
    sumSeries(
      sources[key].map((id) => entitySeries(stats, id, starts, end, live)),
      length,
    );
  const partial = {
    solar: build('solar'),
    import: build('import'),
    export: build('export'),
    charge: build('charge'),
    discharge: build('discharge'),
  };

  return {
    ...partial,
    home: sources.home.length > 0 ? build('home') : deriveHome(partial, length),
  };
};

export const total = (series: Series): number | undefined => {
  const values = series.filter((value): value is number => value !== undefined);

  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0);
};

export interface Balance {
  readonly solar?: number;
  readonly home?: number;
  readonly import?: number;
  readonly export?: number;
  readonly charge?: number;
  readonly discharge?: number;
}

export const balanceOf = (series: EnergySeries): Balance => ({
  solar: total(series.solar),
  home: total(series.home),
  import: total(series.import),
  export: total(series.export),
  charge: total(series.charge),
  discharge: total(series.discharge),
});

export const selfSufficiency = (balance: Balance): number | undefined => {
  if (balance.home === undefined || balance.home <= 0 || balance.import === undefined) {
    return undefined;
  }

  return Math.min(1, Math.max(0, 1 - balance.import / balance.home));
};

export const selfConsumption = (balance: Balance): number | undefined => {
  if (balance.solar === undefined || balance.solar <= 0 || balance.export === undefined) {
    return undefined;
  }

  return Math.min(1, Math.max(0, 1 - balance.export / balance.solar));
};

export const counterSeries = (
  stats: StatisticsResult,
  ids: readonly string[],
  starts: readonly number[],
  end: number,
  live?: LiveTail,
  quantity: Quantity = 'energy',
): Series =>
  sumSeries(
    ids.map((id) => entitySeries(stats, id, starts, end, live, quantity)),
    starts.length,
  );

export const resolveGas = async (
  hass: HomeAssistant,
  explicit: readonly string[],
  useDashboard = true,
): Promise<string[]> => {
  if (explicit.length > 0 || !useDashboard) return [...explicit];

  return preferenceSources(await fetchEnergyPreferences(hass)).gas ?? [];
};
