import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { HOUR, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { energySince } from '../../core/data/energy';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticRow, StatisticsResult } from '../../core/data/statistics';
import { areaName, entityName, entityOf, readNumber } from '../../core/entities';
import {
  formatDate,
  formatDuration,
  formatEnergy,
  formatNumber,
  formatPower,
  formatTime,
} from '../../core/format';
import type { SizeSetting } from '../../core/size';
import { findEntities } from '../../core/stub';
import { addDays, startOfDay } from '../../core/time';
import type { TranslationKey } from '../../i18n/en';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, empty, header, meta, stateIcon } from '../../ui/parts';
import type { Tick } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { elementHover, slotHover, tipHandler, tipLayer, tipValue } from '../../ui/tip';
import type { Tip } from '../../ui/tip';
import {
  DAYS,
  SLOT,
  SLOTS,
  daysStart,
  loadStats,
  seriesStart,
  sortLoads,
  sumDays,
} from './loads-data';
import type { LoadRange, LoadSort, LoadStats } from './loads-data';

export interface LoadConfig {
  readonly power: string;
  readonly energy?: string;
  readonly name?: string;
  readonly area?: string;
  readonly icon?: string;
  readonly color?: string;
}

export interface LoadsCardConfig extends BaseConfig {
  readonly devices: readonly LoadConfig[];
  readonly site_power?: string;
  readonly site_energy?: string;
  readonly sort: LoadSort;
  readonly active_only: boolean;
  readonly threshold: number;
}

interface LoadsData {
  readonly fine: StatisticsResult;
  readonly daily: StatisticsResult;
  readonly hourly: StatisticsResult;
}

type Context = CardContext<LoadsCardConfig, LoadsData>;

interface LoadRow {
  readonly index: number;
  readonly device: LoadConfig;
  readonly name: string;
  readonly area?: string;
  readonly power?: number;
  readonly today?: number;
  readonly available: boolean;
  readonly active: boolean;
  readonly color: string;
  readonly stats: LoadStats;
}

interface Site {
  readonly power?: number;
  readonly today?: number;
}

interface Segment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly row?: LoadRow;
}

const PALETTE: readonly string[] = [
  'var(--m-solar)',
  'var(--m-grid)',
  'var(--m-battery)',
  'var(--m-home)',
];

const QUIET = 'var(--m-muted)';

const SORTS: readonly LoadSort[] = ['power', 'today', 'name'];

const RANGES: readonly LoadRange[] = ['24h', '7d', '30d'];

const PLOT = 150;

const BAR_ROOM = 118;

const SPARK = 48;

const unavailable = (state: string | undefined): boolean =>
  state === undefined || state === 'unavailable' || state === 'unknown';

const merge = (...results: StatisticsResult[]): StatisticsResult => {
  const merged = new Map<string, readonly StatisticRow[]>();

  results.forEach((result) => {
    result.forEach((rows, id) => {
      merged.set(id, rows);
    });
  });

  return merged;
};

const stepPaths = (
  values: readonly (number | undefined)[],
  top: number,
): { readonly line: string; readonly area: string } => {
  const x = (index: number): string => ((index / values.length) * 1000).toFixed(1);
  const y = (value: number): string => (100 - (Math.max(0, value) / top) * 100).toFixed(2);
  let line = '';
  let area = '';
  let start: number | undefined;

  values.forEach((value, index) => {
    if (value === undefined) {
      if (start !== undefined) area += `V100H${x(start)}Z`;

      start = undefined;

      return;
    }

    if (start === undefined) {
      start = index;
      line += `M${x(index)},${y(value)}H${x(index + 1)}`;
      area += `M${x(index)},100V${y(value)}H${x(index + 1)}`;

      return;
    }

    line += `V${y(value)}H${x(index + 1)}`;
    area += `V${y(value)}H${x(index + 1)}`;
  });

  if (start !== undefined) area += `V100H${x(start)}Z`;

  return { line, area };
};

const downsample = (
  values: readonly (number | undefined)[],
  count: number,
): (number | undefined)[] => {
  const size = Math.ceil(values.length / count);

  return Array.from({ length: count }, (_, index) => {
    const slice = values
      .slice(index * size, (index + 1) * size)
      .filter((value): value is number => value !== undefined);

    return slice.length === 0 ? undefined : Math.max(...slice);
  });
};

export class MetronLoadsCard extends MetronCard<LoadsCardConfig, LoadsData> {
  static override properties: PropertyDeclarations = {
    _sort: { state: true },
    _activeOnly: { state: true },
    _open: { state: true },
    _range: { state: true },
    _peak: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      ha-card {
        container-type: inline-size;
      }

      ha-card > :not(.l-list) {
        flex-shrink: 0;
      }

      .l-site {
        font-size: 12px;
        text-align: right;
        color: var(--m-text-2);
      }

      .l-site b {
        font-family: var(--m-mono);
        font-weight: 500;
        color: var(--m-text);
      }

      .share-bar span {
        cursor: pointer;
      }

      .share-bar span.quiet {
        cursor: default;
      }

      .l-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        font-size: 12px;
        color: var(--m-text-2);
      }

      .l-legend button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        color: inherit;
        cursor: pointer;
      }

      .l-legend button[disabled] {
        cursor: default;
      }

      .l-legend i {
        flex-shrink: 0;
        width: 8px;
        height: 8px;
        border-radius: 2px;
      }

      .l-legend em {
        overflow: hidden;
        font-style: normal;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .l-legend b {
        font-family: var(--m-mono);
        font-weight: 400;
        color: var(--m-text);
      }

      .l-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .seg {
        display: inline-flex;
        overflow: hidden;
        border-radius: 10px;
        background: var(--m-panel);
      }

      .seg button,
      .l-toggle {
        min-height: 34px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: none;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--m-text-2);
        cursor: pointer;
      }

      .seg button.on {
        background: var(--m-track);
        color: var(--m-text);
      }

      .l-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        box-shadow: inset 0 0 0 1px var(--m-line);
      }

      .l-toggle i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--m-muted);
      }

      .l-toggle.on {
        background: var(--m-track);
        color: var(--m-text);
      }

      .l-toggle.on i {
        background: var(--m-ok);
      }

      .l-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .l-list.scroll {
        flex: 1 1 0;
        min-height: 0;
        margin-right: -6px;
        padding-right: 6px;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
      }

      .l-row {
        position: relative;
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) ${SPARK + 16}px 108px;
        align-items: center;
        gap: 12px;
        min-height: 52px;
        flex-shrink: 0;
        padding: 6px 12px 6px 8px;
        overflow: hidden;
        border: 0;
        border-radius: 12px;
        background: var(--m-panel);
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .l-row:hover {
        background: color-mix(in srgb, var(--m-text) 8%, transparent);
      }

      .l-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        border-bottom: 2px solid var(--c);
        background: color-mix(in srgb, var(--c) 13%, transparent);
        pointer-events: none;
      }

      .l-row > :not(.l-fill) {
        position: relative;
      }

      .l-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: var(--m-panel);
        --mdc-icon-size: 20px;
        color: var(--m-muted);
      }

      .l-who {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .l-who b,
      .l-who small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .l-who b {
        font-size: 14px;
        font-weight: 500;
      }

      .l-who small,
      .l-value small {
        font-size: 11.5px;
        color: var(--m-text-2);
      }

      .l-row.idle .l-who b {
        color: var(--m-text-2);
      }

      .l-spark {
        width: 100%;
        height: 24px;
      }

      .l-spark path {
        fill: none;
        stroke-width: 1.4;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }

      .l-value {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        white-space: nowrap;
      }

      .l-value b {
        font-family: var(--m-mono);
        font-size: 16px;
        font-weight: 500;
      }

      .l-value b small {
        margin-left: 3px;
        font-family: inherit;
      }

      .l-row.idle .l-value b {
        color: var(--m-text-2);
      }

      .l-foot {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        color: var(--m-text-2);
      }

      .l-foot b {
        font-family: var(--m-mono);
        font-weight: 500;
        color: var(--m-text);
      }

      @container (max-width: 380px) {
        .l-row {
          grid-template-columns: 32px minmax(0, 1fr) 40px 96px;
          gap: 8px;
        }

        .l-icon {
          width: 32px;
          height: 32px;
        }
      }

      dialog.details {
        box-sizing: border-box;
        width: min(512px, calc(100vw - 24px));
        max-width: none;
        max-height: calc(100dvh - 24px);
        padding: 0;
        overflow: auto;
        border: 1px solid var(--m-line);
        border-radius: 20px;
        background: var(--ha-card-background, var(--card-background-color, #171b1f));
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
        color: var(--m-text);
        overscroll-behavior: contain;
      }

      dialog.details::backdrop {
        background: rgba(6, 8, 10, 0.72);
      }

      @media (max-width: 540px) {
        dialog.details {
          width: 100vw;
          max-height: 94dvh;
          margin: auto 0 0;
          border-radius: 20px 20px 0 0;
        }
      }

      .sheet {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 20px;
      }

      .d-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .d-icon,
      .d-btn {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 12px;
        background: var(--m-panel);
        color: var(--m-text);
        cursor: pointer;
      }

      .d-icon {
        border-radius: 14px;
        --mdc-icon-size: 24px;
      }

      .d-btn {
        width: 36px;
        --mdc-icon-size: 20px;
      }

      .d-btn:hover,
      .d-icon:hover {
        background: var(--m-track);
      }

      .d-who {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .d-who b {
        overflow: hidden;
        font-size: 18px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .d-who span {
        font-size: 13px;
        color: var(--m-text-2);
      }

      .d-hero {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
      }

      .d-value {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .d-value b {
        font-family: var(--m-mono);
        font-size: 46px;
        font-weight: 500;
        line-height: 1;
        letter-spacing: -0.02em;
      }

      .d-value small {
        font-size: 18px;
        color: var(--m-text-2);
      }

      .d-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 32px;
        padding: 0 12px;
        border-radius: 16px;
        background: var(--m-panel);
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
      }

      .d-status i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--m-muted);
      }

      .d-status.on i {
        background: var(--c);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 22%, transparent);
      }

      .d-chart {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .d-chart-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 13px;
        color: var(--m-text-2);
      }

      .d-chart-head .seg button {
        min-width: 52px;
      }

      .d-plot {
        position: relative;
        height: ${PLOT}px;
        touch-action: pan-y;
      }

      .d-plot svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .d-grid {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-line);
      }

      .d-grid.base {
        border-top-style: solid;
      }

      .d-max {
        position: absolute;
        top: 4px;
        left: 0;
        font-family: var(--m-mono);
        font-size: 11px;
        color: var(--m-muted);
      }

      .d-peak {
        position: absolute;
        width: 9px;
        height: 9px;
        margin: -5px 0 0 -5px;
        border: 2px solid var(--m-bg, var(--card-background-color, #171b1f));
        border-radius: 50%;
        background: var(--c);
        pointer-events: none;
      }

      .d-peak.focus {
        box-shadow: 0 0 0 6px color-mix(in srgb, var(--c) 28%, transparent);
      }

      .d-peak span {
        position: absolute;
        bottom: 12px;
        left: 50%;
        padding: 3px 8px;
        border-radius: 8px;
        background: var(--m-track);
        font-family: var(--m-mono);
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-text);
        transform: translateX(-50%);
      }

      .d-peak span.end {
        right: -4px;
        left: auto;
        transform: none;
      }

      .d-peak span.start {
        left: -4px;
        transform: none;
      }

      .d-bars {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-end;
        gap: var(--gap);
      }

      .d-bars div {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        min-width: 0;
      }

      .d-bars span {
        font-family: var(--m-mono);
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-text-2);
      }

      .d-bars i {
        width: 100%;
        border-radius: 4px 4px 0 0;
        background: var(--c);
        opacity: 0.45;
      }

      .d-bars i.today {
        opacity: 1;
      }

      .d-avg {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed color-mix(in srgb, var(--m-text) 45%, transparent);
        pointer-events: none;
      }

      .d-avg span {
        position: absolute;
        right: 0;
        bottom: 3px;
        padding: 1px 5px;
        border-radius: 5px;
        background: var(--m-bg);
        font-family: var(--m-mono);
        font-size: 10.5px;
        color: var(--m-text-2);
      }

      .d-tiles {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .d-tile {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 14px;
        border: 0;
        border-radius: 14px;
        background: var(--m-panel);
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }

      .d-tile:hover {
        background: var(--m-track);
      }

      .d-tile.on {
        box-shadow: inset 0 0 0 1.5px var(--c);
      }

      .d-tile small {
        font-size: 12px;
        color: var(--m-text-2);
      }

      .d-tile span {
        display: flex;
        align-items: baseline;
        gap: 5px;
        font-size: 13px;
        color: var(--m-text-2);
      }

      .d-tile b {
        font-family: var(--m-mono);
        font-size: 21px;
        font-weight: 500;
        line-height: 1;
        color: var(--m-text);
      }

      .d-tile em {
        margin-left: auto;
        font-size: 11.5px;
        font-style: normal;
      }

      .d-share {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 13px;
        color: var(--m-text-2);
      }

      .d-share div:first-child {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .d-share b {
        font-family: var(--m-mono);
        font-weight: 500;
        color: var(--m-text);
      }

      .d-meter {
        height: 6px;
        overflow: hidden;
        border-radius: 3px;
        background: var(--m-track);
      }

      .d-meter i {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: var(--c);
      }

      .d-entity {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 40px;
        padding: 0 12px;
        border: 0;
        border-radius: 12px;
        background: var(--m-panel);
        font-family: var(--m-mono);
        font-size: 12px;
        color: var(--m-text-2);
        cursor: pointer;
        --mdc-icon-size: 16px;
      }

      .d-entity span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .d-entity:hover {
        background: var(--m-track);
        color: var(--m-text);
      }
    `,
  ];

  declare _sort: LoadSort | undefined;
  declare _activeOnly: boolean | undefined;
  declare _open: number | undefined;
  declare _range: LoadRange;
  declare _peak: boolean;

  private _order: readonly number[] = [];

  constructor() {
    super();
    this._sort = undefined;
    this._activeOnly = undefined;
    this._open = undefined;
    this._range = '24h';
    this._peak = false;
  }

  static override configForm(): ConfigForm {
    return form.createForm([
      form.list(
        'devices',
        {
          power: {
            selector: { entity: { filter: { domain: 'sensor', device_class: 'power' } } },
            required: true,
          },
          energy: {
            selector: { entity: { filter: { domain: 'sensor', device_class: 'energy' } } },
          },
          name: { selector: { text: {} } },
          area: { selector: { text: {} } },
          icon: { selector: { icon: {} } },
          color: { selector: { text: {} } },
        },
        'name',
      ),
      form.grid(form.powerEntity('site_power'), form.energyEntity('site_energy')),
      form.grid(form.select('sort', SORTS), form.number('threshold', { min: 0, unit: 'W' })),
      form.toggle('active_only'),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return {
      devices: findEntities(hass, { deviceClass: 'power' }, 6).map((power) => ({ power })),
    };
  }

  protected parseConfig(raw: RawConfig): LoadsCardConfig {
    const devices = cfg.list(raw, 'devices', (item): LoadConfig | undefined => {
      const power = cfg.entity(item, 'power') ?? cfg.entity(item, 'entity');

      if (!power) return undefined;

      return {
        power,
        energy: cfg.entity(item, 'energy'),
        name: cfg.text(item, 'name'),
        area: cfg.text(item, 'area'),
        icon: cfg.text(item, 'icon'),
        color: cfg.text(item, 'color'),
      };
    });

    return {
      ...cfg.base(raw),
      devices,
      site_power: cfg.entity(raw, 'site_power'),
      site_energy: cfg.entity(raw, 'site_energy'),
      sort: cfg.oneOf(raw, 'sort', SORTS, 'power'),
      active_only: cfg.boolean(raw, 'active_only', false),
      threshold: cfg.number(raw, 'threshold', 3, { min: 0 }),
    };
  }

  protected override missingOption(config: LoadsCardConfig): string | undefined {
    return config.devices.length === 0 ? 'devices' : undefined;
  }

  protected override trackedEntities(config: LoadsCardConfig): readonly (string | undefined)[] {
    return [
      config.site_power,
      config.site_energy,
      ...config.devices.flatMap((device) => [device.power, device.energy]),
    ];
  }

  protected override cardSize(config: LoadsCardConfig): number {
    return 4 + config.devices.length;
  }

  protected override defaultSize(config: LoadsCardConfig): SizeSetting {
    return config.devices.length <= 3 ? 'medium' : 'large';
  }

  protected override async fetchData(
    config: LoadsCardConfig,
    hass: HomeAssistant,
  ): Promise<LoadsData> {
    const now = Date.now();
    const counters = [config.site_energy, ...config.devices.map((device) => device.energy)];
    const meters = config.devices.filter((device) => !device.energy).map((device) => device.power);
    const ids = (values: readonly (string | undefined)[]): string[] =>
      values.filter((id): id is string => id !== undefined);
    const [fine, dailyPower, dailyEnergy, hourly] = await Promise.all([
      fetchStatistics(hass, {
        entityIds: ids([config.site_power, ...config.devices.map((device) => device.power)]),
        start: seriesStart(now),
        period: '5minute',
        types: ['mean'],
      }),
      fetchStatistics(hass, {
        entityIds: meters,
        start: daysStart(now),
        period: 'day',
        types: ['mean'],
      }),
      fetchStatistics(hass, {
        entityIds: ids(counters),
        start: daysStart(now),
        period: 'day',
        types: ['change'],
      }),
      fetchStatistics(hass, {
        entityIds: ids(counters),
        start: startOfDay(now) - HOUR,
        period: 'hour',
        types: ['change', 'state'],
      }),
    ]);

    return { fine, daily: merge(dailyPower, dailyEnergy), hourly };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, hass, t, locale, size } = context;
    const rows = this._rows(context);
    const site = this._site(context);
    const metered = rows.reduce((total, row) => total + Math.max(0, row.power ?? 0), 0);
    const sort = this._sort ?? config.sort;
    const activeOnly = this._activeOnly ?? config.active_only;
    const visible = sortLoads(
      activeOnly ? rows.filter((row) => row.active) : rows,
      sort,
      hass.language,
    );
    const total = formatPower(metered, locale);
    const active = rows.filter((row) => row.active).length;
    const offline = rows.filter((row) => !row.available).length;
    const segments = this._segments(context, rows, metered, site.power);
    const small = size === 'small';
    const list = size === 'medium' || size === 'large' || size === 'auto';

    this._order = visible.map((row) => row.index);

    return html`
      ${header(
        config.title ?? t('loads.title'),
        meta(
          t('loads.counts', {
            active: String(active),
            idle: String(rows.length - active - offline),
            offline: String(offline),
          }),
        ),
      )}
      <div class="hero">
        <div class="hero-value">
          <span
            ><span class="big">${total.value}</span> <span class="unit">${total.unit}</span></span
          >
        </div>
        ${this._renderSiteShare(context, metered, site.power)}
      </div>
      ${this._renderBar(context, segments)}
      ${size === 'medium' ? nothing : this._renderLegend(context, segments, small)}
      ${list ? this._renderControls(context, sort, activeOnly) : nothing}
      ${list ? this._renderList(context, visible) : nothing}
      ${size === 'large' || size === 'auto' ? this._renderFoot(context, rows, site) : nothing}
      ${this._renderDialog(context, rows, site)}
    `;
  }

  private _rows(context: Context): LoadRow[] {
    const { config, hass, data, now } = context;
    const rows = config.devices.map((device, index) => {
      const available = !unavailable(entityOf(hass, device.power)?.state);
      const power = available ? readNumber(hass, device.power, 'power') : undefined;
      const stats = loadStats(
        {
          power,
          energy: readNumber(hass, device.energy, 'energy'),
          fine: data?.fine.get(device.power),
          daily: data?.daily.get(device.energy ?? device.power),
          hourly: device.energy ? data?.hourly.get(device.energy) : undefined,
          counter: device.energy !== undefined,
          threshold: config.threshold,
        },
        now,
      );

      return {
        index,
        device,
        name: device.name ?? entityName(hass, device.power),
        area: device.area ?? areaName(hass, device.power),
        power,
        today: data ? stats.today : undefined,
        available,
        active: (power ?? 0) > config.threshold,
        color: QUIET,
        stats,
      };
    });
    const ranked = rows
      .filter((row) => row.active)
      .sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
      .map((row) => row.index);

    return rows.map((row) => {
      const rank = ranked.indexOf(row.index);

      return {
        ...row,
        color: row.device.color ?? (rank >= 0 ? (PALETTE[rank] ?? QUIET) : QUIET),
      };
    });
  }

  private _site(context: Context): Site {
    const { config, hass, data, now } = context;
    const power = readNumber(hass, config.site_power, 'power');

    if (!data) return { power };

    if (config.site_energy) {
      const rows = data.hourly.get(config.site_energy);

      return {
        power,
        today: rows?.length
          ? energySince(rows, startOfDay(now), readNumber(hass, config.site_energy, 'energy'))
          : undefined,
      };
    }

    if (!config.site_power) return { power };

    return {
      power,
      today: loadStats(
        { power, fine: data.fine.get(config.site_power), counter: false, threshold: 0 },
        now,
      ).today,
    };
  }

  private _segments(
    context: Context,
    rows: readonly LoadRow[],
    metered: number,
    site: number | undefined,
  ): Segment[] {
    const { t } = context;
    const ranked = rows.filter((row) => row.active).sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
    const other = ranked.slice(PALETTE.length).reduce((total, row) => total + (row.power ?? 0), 0);
    const unmetered = site === undefined ? 0 : Math.max(0, site - metered);
    const segments: Segment[] = ranked.slice(0, PALETTE.length).map((row) => ({
      label: row.name,
      value: row.power ?? 0,
      color: row.color,
      row,
    }));

    if (other > 0) segments.push({ label: t('loads.other'), value: other, color: QUIET });
    if (unmetered > 0) {
      segments.push({ label: t('loads.unmetered'), value: unmetered, color: 'var(--m-track)' });
    }

    return segments;
  }

  private _segmentTip(context: Context, segment: Segment, total: number): Tip {
    const { locale } = context;

    return {
      title: segment.label,
      rows: [
        {
          label: tipValue(formatPower(segment.value, locale)),
          value: total > 0 ? `${formatNumber((segment.value / total) * 100, 0, locale)} %` : '—',
          color: segment.color,
        },
      ],
    };
  }

  private _renderSiteShare(
    context: Context,
    metered: number,
    site: number | undefined,
  ): TemplateResult | typeof nothing {
    const { t, locale } = context;

    if (site === undefined || site <= 0) return nothing;

    return html`<div class="l-site">
      ${t('loads.of_site', {
        value: formatNumber(Math.min(100, (metered / site) * 100), 0, locale),
      })}
      <b>${tipValue(formatPower(site, locale))}</b>
    </div>`;
  }

  private _renderBar(context: Context, segments: readonly Segment[]): TemplateResult {
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);

    return html`<div class="share-bar" role="img">
      ${
        segments.length === 0
          ? html`<span class="quiet" style="flex:1 1 auto;background:var(--m-track)"></span>`
          : segments.map((segment) => {
              const hover = elementHover(() => this._segmentTip(context, segment, total));

              return html`<span
                class=${segment.row ? '' : 'quiet'}
                style="flex:${segment.value} 1 0;background:${segment.color}"
                @pointermove=${hover.move}
                @pointerdown=${hover.move}
                @pointerleave=${hover.leave}
                @click=${() => {
                  if (segment.row) void this._show(segment.row.index);
                }}
              ></span>`;
            })
      }
    </div>`;
  }

  private _renderLegend(
    context: Context,
    segments: readonly Segment[],
    small: boolean,
  ): TemplateResult | typeof nothing {
    const { locale } = context;
    const shown = small ? segments.filter((segment) => segment.row).slice(0, 3) : segments;

    if (shown.length === 0) return nothing;

    return html`<div class="l-legend" data-drop="2">
      ${shown.map(
        (segment) =>
          html`<button
            ?disabled=${!segment.row}
            @click=${() => {
              if (segment.row) void this._show(segment.row.index);
            }}
          >
            <i style="background:${segment.color}"></i><em>${segment.label}</em
            ><b>${tipValue(formatPower(segment.value, locale))}</b>
          </button>`,
      )}
    </div>`;
  }

  private _renderControls(context: Context, sort: LoadSort, activeOnly: boolean): TemplateResult {
    const { t } = context;

    return html`<div class="l-controls">
      <div class="seg" role="group" aria-label=${t('editor.sort')}>
        ${SORTS.map(
          (key) =>
            html`<button
              class=${sort === key ? 'on' : ''}
              aria-pressed=${sort === key ? 'true' : 'false'}
              @click=${() => {
                this._sort = key;
              }}
            >
              ${t(`loads.sort_${key}`)}
            </button>`,
        )}
      </div>
      <button
        class="l-toggle ${activeOnly ? 'on' : ''}"
        aria-pressed=${activeOnly ? 'true' : 'false'}
        @click=${() => {
          this._activeOnly = !activeOnly;
        }}
      >
        <i></i>${t('loads.active_only')}
      </button>
    </div>`;
  }

  private _renderList(context: Context, rows: readonly LoadRow[]): TemplateResult {
    const { t, size } = context;
    const max = Math.max(0, ...rows.map((row) => row.power ?? 0));

    return html`<div class="l-list ${size === 'auto' ? '' : 'scroll'}">
      ${
        rows.length === 0
          ? empty(t('loads.nothing'))
          : rows.map((row) => this._renderRow(context, row, max))
      }
    </div>`;
  }

  private _renderRow(context: Context, row: LoadRow, max: number): TemplateResult {
    const { hass, t, locale } = context;
    const power = formatPower(row.available ? Math.max(0, row.power ?? 0) : undefined, locale);
    const width = row.active && max > 0 ? Math.max(1.5, ((row.power ?? 0) / max) * 100) : 0;

    return html`<button
      class="l-row ${row.active ? '' : 'idle'}"
      aria-label=${`${row.name}, ${tipValue(power)}`}
      @click=${() => {
        void this._show(row.index);
      }}
    >
      ${width > 0 ? html`<span class="l-fill" style="width:${width.toFixed(1)}%;--c:${row.color}"></span>` : nothing}
      <span class="l-icon"
        >${stateIcon(hass, row.device.power, row.device.icon, row.active ? row.color : undefined)}</span
      >
      <span class="l-who"><b>${row.name}</b><small>${row.area ?? ''}</small></span>
      ${this._renderSpark(row)}
      <span class="l-value">
        <b>${power.value}<small>${power.unit}</small></b>
        <small
          >${
            row.available
              ? t('loads.today_value', { value: tipValue(formatEnergy(row.today, locale, 2)) })
              : t('loads.unavailable')
          }</small
        >
      </span>
    </button>`;
  }

  private _renderSpark(row: LoadRow): TemplateResult {
    const values = downsample(row.stats.series.points, SPARK);
    const top = Math.max(1, ...values.map((value) => value ?? 0)) * 1.1;
    const paths = stepPaths(values, top);

    return html`<svg
      class="l-spark"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d=${paths.line} style="stroke:${row.active ? row.color : 'var(--m-muted)'}"></path>
    </svg>`;
  }

  private _renderFoot(context: Context, rows: readonly LoadRow[], site: Site): TemplateResult {
    const { t, locale } = context;
    const metered = rows.reduce((total, row) => total + (row.today ?? 0), 0);
    const energy = formatEnergy(metered, locale, 1);

    return html`<div class="l-foot" data-drop="1">
      <span>${t('loads.metered_today')}</span>
      <span
        ><b>${energy.value}</b> ${
          site.today === undefined
            ? energy.unit
            : t('loads.of_total', { total: tipValue(formatEnergy(site.today, locale, 1)) })
        }</span
      >
    </div>`;
  }

  private async _show(index: number): Promise<void> {
    this._open = index;
    await this.updateComplete;

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog.details');

    if (dialog && !dialog.open) dialog.showModal();
  }

  private _close(): void {
    this.renderRoot.querySelector<HTMLDialogElement>('dialog.details')?.close();
  }

  private _step(offset: number): void {
    const order = this._order;
    const position = order.indexOf(this._open ?? -1);

    if (order.length === 0) return;

    const next = order[(Math.max(0, position) + offset + order.length) % order.length];

    this._open = next;
    this._peak = false;
  }

  private _pick(range: LoadRange, peak = false): void {
    this._range = range;
    this._peak = peak;
  }

  private _renderDialog(context: Context, rows: readonly LoadRow[], site: Site): TemplateResult {
    const row = rows.find((item) => item.index === this._open);

    return html`<dialog
      class="details"
      @close=${() => {
        this._open = undefined;
        this._peak = false;
      }}
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) this._close();
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') this._step(-1);
        if (event.key === 'ArrowRight') this._step(1);
      }}
    >
      ${row ? this._renderDetails(context, row, site) : nothing}
    </dialog>`;
  }

  private _status(context: Context, row: LoadRow): string {
    const { t, locale, now } = context;

    if (!row.available) return t('loads.unavailable');

    if (row.active) {
      return row.stats.since === undefined
        ? t('loads.active')
        : t('loads.running', { duration: formatDuration((now - row.stats.since) / MINUTE, t) });
    }

    return row.stats.lastRun === undefined
      ? t('loads.idle')
      : t('loads.last_run', { time: formatTime(row.stats.lastRun, locale) });
  }

  private _renderDetails(context: Context, row: LoadRow, site: Site): TemplateResult {
    const { hass, t, locale, moreInfo } = context;
    const power = formatPower(row.available ? Math.max(0, row.power ?? 0) : undefined, locale);
    const accent = row.color === QUIET ? (row.device.color ?? 'var(--m-solar)') : row.color;
    const range = this._range;
    const openInHa = (): void => {
      this._close();
      moreInfo(row.device.power);
    };

    return html`<div class="sheet" style="--c:${accent}" @metron-tip=${tipHandler}>
      <div class="d-head">
        <button class="d-icon" title=${t('loads.open')} @click=${openInHa}>
          ${stateIcon(hass, row.device.power, row.device.icon, accent)}
        </button>
        <div class="d-who"><b>${row.name}</b><span>${row.area ?? ''}</span></div>
        ${
          this._order.length > 1
            ? html`<button
                  class="d-btn"
                  aria-label=${t('loads.previous')}
                  @click=${() => {
                    this._step(-1);
                  }}
                >
                  <ha-icon icon="mdi:chevron-left"></ha-icon></button
                ><button
                  class="d-btn"
                  aria-label=${t('loads.next')}
                  @click=${() => {
                    this._step(1);
                  }}
                >
                  <ha-icon icon="mdi:chevron-right"></ha-icon>
                </button>`
            : nothing
        }
        <button
          class="d-btn"
          aria-label=${t('common.close')}
          @click=${() => {
            this._close();
          }}
        >
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <div class="d-hero">
        <div class="d-value"><b>${power.value}</b><small>${power.unit}</small></div>
        <span class="d-status ${row.active ? 'on' : ''}"><i></i>${this._status(context, row)}</span>
      </div>
      <div class="d-chart">
        <div class="d-chart-head">
          <span>${range === '24h' ? t('loads.power_day') : t('loads.energy_days')}</span>
          <div class="seg" role="group">
            ${RANGES.map(
              (key) =>
                html`<button
                  class=${range === key ? 'on' : ''}
                  aria-pressed=${range === key ? 'true' : 'false'}
                  @click=${() => {
                    this._pick(key);
                  }}
                >
                  ${t(`loads.range_${key}`)}
                </button>`,
            )}
          </div>
        </div>
        ${range === '24h' ? this._renderLine(context, row) : this._renderBars(context, row, range)}
      </div>
      ${this._renderTiles(context, row)} ${this._renderShare(context, row, site)}
      <button class="d-entity" @click=${openInHa}>
        <span>${row.device.power}</span><ha-icon icon="mdi:open-in-new"></ha-icon>
      </button>
      ${tipLayer()}
    </div>`;
  }

  private _renderLine(context: Context, row: LoadRow): TemplateResult {
    const { t, locale } = context;
    const series = row.stats.series;
    const peak = row.stats.peak;
    const top = Math.max(1, peak?.value ?? 0) * 1.15;
    const paths = stepPaths(series.points, top);
    const hover = slotHover(SLOTS, (index) => {
      const value = series.points[index];

      if (value === undefined) return undefined;

      const from = series.start + index * SLOT;

      return {
        title: `${formatTime(from, locale)}–${formatTime(from + SLOT, locale)}`,
        rows: [{ label: row.name, value: tipValue(formatPower(value, locale)), color: row.color }],
      };
    });
    const peakIndex = peak ? Math.round((peak.at - series.start) / SLOT) : -1;
    const left = ((Math.min(SLOTS - 1, Math.max(0, peakIndex)) + 0.5) / SLOTS) * 100;
    const edge = left > 80 ? 'end' : left < 20 ? 'start' : '';

    return html`<div
        class="d-plot"
        @pointermove=${hover.move}
        @pointerdown=${hover.move}
        @pointerleave=${hover.leave}
      >
        <div class="d-grid" style="top:0"></div>
        <div class="d-grid" style="top:50%"></div>
        <div class="d-grid base" style="bottom:0"></div>
        <span class="d-max">${tipValue(formatPower(top, locale))}</span>
        <svg
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
          role="img"
          aria-label=${t('loads.power_day')}
        >
          <path d=${paths.area} style="fill:var(--c);opacity:0.16"></path>
          <path
            d=${paths.line}
            style="fill:none;stroke:var(--c);stroke-width:2;stroke-linejoin:round;vector-effect:non-scaling-stroke"
          ></path>
        </svg>
        ${
          peak && peak.value > 0
            ? html`<span
                class="d-peak ${this._peak ? 'focus' : ''}"
                style="left:${left.toFixed(2)}%;top:${(100 - (peak.value / top) * 100).toFixed(2)}%"
                >${
                  this._peak
                    ? html`<span class=${edge}
                        >${t('common.peak')} ${tipValue(formatPower(peak.value, locale))} ·
                        ${formatTime(peak.at, locale)}</span
                      >`
                    : nothing
                }</span
              >`
            : nothing
        }
      </div>
      ${axis(this._dayTicks(context, series.start))}`;
  }

  private _dayTicks(context: Context, start: number): Tick[] {
    const { t, locale } = context;
    const span = SLOTS * SLOT;
    const ticks: Tick[] = [];

    for (let time = startOfDay(start); time < start + span; time += 6 * HOUR) {
      const at = (time - start) / span;

      if (at > 0.04 && at < 0.92) ticks.push({ at, label: formatTime(time, locale) });
    }

    return [...ticks, { at: 1, label: t('common.now') }];
  }

  private _renderBars(context: Context, row: LoadRow, range: LoadRange): TemplateResult {
    const { t, locale, now } = context;
    const count = range === '7d' ? 7 : DAYS;
    const values = row.stats.days.slice(-count);
    const first = daysStart(now);
    const day = (index: number): number => addDays(first, DAYS - count + index);
    const max = Math.max(0.01, ...values.map((value) => value ?? 0));
    const past = values.slice(0, -1).filter((value): value is number => value !== undefined);
    const average = past.length > 0 ? past.reduce((sum, value) => sum + value, 0) / past.length : 0;
    const hover = slotHover(count, (index) => {
      const value = values[index];

      if (value === undefined) return undefined;

      return {
        title: formatDate(day(index), locale, { weekday: 'short', day: 'numeric', month: 'short' }),
        rows: [
          { label: row.name, value: tipValue(formatEnergy(value, locale, 2)), color: row.color },
        ],
      };
    });
    const ticks: Tick[] =
      range === '7d'
        ? values.map((_, index) => ({
            at: (index + 0.5) / count,
            label:
              index === count - 1
                ? t('common.today')
                : formatDate(day(index), locale, { weekday: 'short' }),
          }))
        : [0, 7, 14, 21]
            .map((index) => ({
              at: (index + 0.5) / count,
              label: formatDate(day(index), locale, { day: 'numeric', month: 'short' }),
            }))
            .concat({ at: 1, label: t('common.today') });

    return html`<div
        class="d-plot"
        @pointermove=${hover.move}
        @pointerdown=${hover.move}
        @pointerleave=${hover.leave}
      >
        <div class="d-grid base" style="bottom:0"></div>
        <div class="d-bars" style="--gap:${range === '7d' ? '12px' : '3px'}">
          ${values.map(
            (value, index) =>
              html`<div>
                ${
                  range === '7d' && value !== undefined
                    ? html`<span>${formatNumber(value, value >= 10 ? 1 : 2, locale)}</span>`
                    : nothing
                }
                <i
                  class=${index === count - 1 ? 'today' : ''}
                  style="height:${value === undefined ? 0 : Math.max(2, (value / max) * BAR_ROOM)}px"
                ></i>
              </div>`,
          )}
        </div>
        ${
          average > 0
            ? html`<div class="d-avg" style="bottom:${((average / max) * BAR_ROOM).toFixed(1)}px">
                <span
                  >${t('loads.average', { value: tipValue(formatEnergy(average, locale, 2)) })}</span
                >
              </div>`
            : nothing
        }
      </div>
      ${axis(ticks)}`;
  }

  private _renderTiles(context: Context, row: LoadRow): TemplateResult {
    const { t, locale } = context;
    const peak = row.stats.peak;
    const range = this._range;
    const tile = (
      label: TranslationKey,
      formatted: { readonly value: string; readonly unit: string },
      on: boolean,
      pick: () => void,
      note?: string,
    ): TemplateResult =>
      html`<button
        class="d-tile ${on ? 'on' : ''}"
        aria-pressed=${on ? 'true' : 'false'}
        @click=${pick}
      >
        <small>${t(label)}</small>
        <span
          ><b>${formatted.value}</b
          >${formatted.unit}${note ? html`<em>${note}</em>` : nothing}</span
        >
      </button>`;

    return html`<div class="d-tiles">
      ${tile(
        'common.today',
        formatEnergy(row.today, locale, 2),
        range === '24h' && !this._peak,
        () => {
          this._pick('24h');
        },
      )}
      ${tile(
        'loads.last_7',
        formatEnergy(sumDays(row.stats.days, 7), locale, 2),
        range === '7d',
        () => {
          this._pick('7d');
        },
      )}
      ${tile(
        'loads.last_30',
        formatEnergy(sumDays(row.stats.days, DAYS), locale, 1),
        range === '30d',
        () => {
          this._pick('30d');
        },
      )}
      ${tile(
        'loads.peak_day',
        formatPower(peak?.value, locale),
        range === '24h' && this._peak,
        () => {
          this._pick('24h', true);
        },
        peak ? formatTime(peak.at, locale) : undefined,
      )}
    </div>`;
  }

  private _renderShare(
    context: Context,
    row: LoadRow,
    site: Site,
  ): TemplateResult | typeof nothing {
    const { t, locale } = context;

    if (row.today === undefined || site.today === undefined || site.today <= 0) return nothing;

    const share = Math.min(1, row.today / site.today);

    return html`<div class="d-share">
      <div>
        <span>${t('loads.site_today')}</span>
        <b>${formatNumber(share * 100, share < 0.1 ? 1 : 0, locale)} %</b>
      </div>
      <div class="d-meter"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
      <span
        >${t('loads.share_of', {
          value: tipValue(formatEnergy(row.today, locale, 2)),
          total: tipValue(formatEnergy(site.today, locale, 1)),
        })}</span
      >
    </div>`;
  }
}
