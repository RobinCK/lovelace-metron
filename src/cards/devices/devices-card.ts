import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { energySince, hourlyChanges } from '../../core/data/energy';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticRow, StatisticsResult } from '../../core/data/statistics';
import { entityName, entityOf, formatEntity, readNumber } from '../../core/entities';
import { formatDuration, formatNumber, formatTime, unitText } from '../../core/format';
import { hourOfDay, startOfDay } from '../../core/time';
import { findEntities } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, stateIcon } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';

export interface DeviceConfig {
  readonly name?: string;
  readonly power?: string;
  readonly energy?: string;
  readonly icon?: string;
  readonly color?: string;
  readonly threshold?: number;
  readonly status?: string;
  readonly note?: string;
  readonly cycle: boolean;
}

export type DeviceSort = 'energy' | 'power' | 'none';

export interface DevicesCardConfig extends BaseConfig {
  readonly devices: readonly DeviceConfig[];
  readonly total_power?: string;
  readonly total_energy?: string;
  readonly threshold: number;
  readonly sparkline: boolean;
  readonly sort: DeviceSort;
  readonly show_unaccounted: boolean;
}

interface DevicesData {
  readonly start: number;
  readonly hourly: StatisticsResult;
  readonly fine: StatisticsResult;
}

type Context = CardContext<DevicesCardConfig, DevicesData>;

type Activity =
  | { readonly kind: 'running'; readonly since?: number }
  | { readonly kind: 'always' }
  | { readonly kind: 'finished'; readonly at: number }
  | { readonly kind: 'idle' };

interface DeviceRow {
  readonly device: DeviceConfig;
  readonly name: string;
  readonly color: string;
  readonly power?: number;
  readonly energy?: number;
  readonly hours: readonly (number | undefined)[];
  readonly activity: Activity;
}

const FIVE_MINUTES = 5 * MINUTE;
const ALWAYS_ON = 12 * HOUR;

const shade = (index: number): string =>
  `color-mix(in srgb, var(--m-home) ${Math.max(40, 100 - index * 10)}%, var(--m-muted))`;

const powerHours = (
  rows: readonly StatisticRow[] | undefined,
  start: number,
): (number | undefined)[] =>
  hourlyChanges(rows, start, 24, (row) =>
    row.mean === null || row.mean === undefined
      ? undefined
      : (row.mean * FIVE_MINUTES) / HOUR / 1000,
  );

const detectActivity = (
  rows: readonly StatisticRow[] | undefined,
  running: boolean,
  threshold: number,
  cycle: boolean,
  now: number,
): Activity => {
  const samples = rows ?? [];

  if (running) {
    const lastIdle = [...samples].reverse().find((row) => (row.mean ?? 0) <= threshold);

    if (!lastIdle) {
      const first = samples[0];

      return first && now - first.start >= ALWAYS_ON ? { kind: 'always' } : { kind: 'running' };
    }

    return { kind: 'running', since: lastIdle.end };
  }

  if (!cycle) return { kind: 'idle' };

  const lastActive = [...samples].reverse().find((row) => (row.mean ?? 0) > threshold);

  return lastActive ? { kind: 'finished', at: lastActive.end } : { kind: 'idle' };
};

export class MetronDevicesCard extends MetronCard<DevicesCardConfig, DevicesData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .shares {
        display: flex;
        gap: 2px;
        height: 8px;
        overflow: hidden;
        border-radius: 4px;
      }

      .shares span {
        min-width: 2px;
      }

      .table {
        display: flex;
        flex-direction: column;
      }

      .device {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) var(--spark, 72px) 44px 52px;
        column-gap: 10px;
        align-items: center;
        padding: 7px 0;
        border-top: 1px solid var(--m-line);
      }

      .device.headings {
        padding: 0 0 6px;
        border-top: none;
        font-size: 10px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .device.headings span:nth-child(n + 4) {
        text-align: right;
      }

      .badge {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: var(--m-panel);
        --mdc-icon-size: 18px;
      }

      .badge.dashed {
        background: none;
        box-shadow: inset 0 0 0 1px var(--m-line);
      }

      .who {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .who b {
        overflow: hidden;
        font-size: 13px;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .state {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .state i {
        flex-shrink: 0;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--m-muted);
      }

      .state.on i {
        background: var(--m-ok);
      }

      .state span {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .spark {
        display: flex;
        align-items: flex-end;
        gap: 1px;
        height: 20px;
      }

      .spark span {
        flex: 1 1 0;
        max-width: 2px;
        min-height: 2px;
        border-radius: 1px;
        background: var(--m-track);
      }

      .device .num.energy {
        font-weight: 600;
      }

      .totals {
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .totals b {
        font-family: var(--m-mono);
        font-weight: 400;
        color: var(--m-text);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.list(
        'devices',
        {
          name: { selector: { text: {} } },
          power: { selector: { entity: { filter: { domain: 'sensor', device_class: 'power' } } } },
          energy: {
            selector: { entity: { filter: { domain: 'sensor', device_class: 'energy' } } },
          },
          icon: { selector: { icon: {} } },
          color: { selector: { text: {} } },
          threshold: { selector: { number: { mode: 'box', unit_of_measurement: 'W' } } },
          status: { selector: { entity: {} } },
          note: { selector: { text: {} } },
          cycle: { selector: { boolean: {} } },
        },
        'name',
      ),
      form.grid(form.powerEntity('total_power'), form.energyEntity('total_energy')),
      form.grid(
        form.number('threshold', { min: 0, unit: 'W' }),
        form.select('sort', ['energy', 'power', 'none']),
      ),
      form.grid(form.toggle('sparkline'), form.toggle('show_unaccounted')),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return {
      devices: findEntities(hass, { deviceClass: 'power' }, 4).map((power) => ({ power })),
    };
  }

  protected parseConfig(raw: RawConfig): DevicesCardConfig {
    const devices = cfg.list(raw, 'devices', (item): DeviceConfig | undefined => {
      const power = cfg.entity(item, 'power') ?? cfg.entity(item, 'entity');
      const energy = cfg.entity(item, 'energy');

      if (!power && !energy) return undefined;

      return {
        name: cfg.text(item, 'name'),
        power,
        energy,
        icon: cfg.text(item, 'icon'),
        color: cfg.text(item, 'color'),
        threshold: cfg.optionalNumber(item, 'threshold'),
        status: cfg.entity(item, 'status'),
        note: cfg.text(item, 'note'),
        cycle: cfg.boolean(item, 'cycle', false),
      };
    });

    return {
      ...cfg.base(raw),
      devices,
      total_power: cfg.entity(raw, 'total_power'),
      total_energy: cfg.entity(raw, 'total_energy'),
      threshold: cfg.number(raw, 'threshold', 10, { min: 0 }),
      sparkline: cfg.boolean(raw, 'sparkline', true),
      sort: cfg.oneOf(raw, 'sort', ['energy', 'power', 'none'], 'energy'),
      show_unaccounted: cfg.boolean(raw, 'show_unaccounted', true),
    };
  }

  protected override missingOption(config: DevicesCardConfig): string | undefined {
    return config.devices.length === 0 ? 'devices' : undefined;
  }

  protected override trackedEntities(config: DevicesCardConfig): readonly (string | undefined)[] {
    return [
      config.total_power,
      config.total_energy,
      ...config.devices.flatMap((device) => [device.power, device.energy, device.status]),
    ];
  }

  protected override cardSize(config: DevicesCardConfig): number {
    return 2 + config.devices.length;
  }

  protected override async fetchData(
    config: DevicesCardConfig,
    hass: HomeAssistant,
  ): Promise<DevicesData> {
    const start = startOfDay(Date.now());
    const energyIds = [config.total_energy, ...config.devices.map((device) => device.energy)];
    const powerIds = [config.total_power, ...config.devices.map((device) => device.power)];
    const [hourly, fine] = await Promise.all([
      fetchStatistics(hass, {
        entityIds: energyIds.filter((id): id is string => id !== undefined),
        start: start - HOUR,
        period: 'hour',
        types: ['change', 'state'],
      }),
      fetchStatistics(hass, {
        entityIds: powerIds.filter((id): id is string => id !== undefined),
        start,
        period: '5minute',
        types: ['mean'],
      }),
    ]);

    return { start, hourly, fine };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, hass, t, locale } = context;
    const rows = this._rows(context);
    const sumEnergy = rows.reduce((total, row) => total + (row.energy ?? 0), 0);
    const sumPower = rows.reduce((total, row) => total + (row.power ?? 0), 0);
    const totalEnergy = this._totalEnergy(context) ?? sumEnergy;
    const totalPower = readNumber(hass, config.total_power, 'power') ?? sumPower;
    const unaccounted =
      config.show_unaccounted && (config.total_energy || config.total_power)
        ? {
            energy: config.total_energy ? Math.max(0, totalEnergy - sumEnergy) : undefined,
            power: config.total_power ? Math.max(0, totalPower - sumPower) : undefined,
          }
        : undefined;
    const kw = unitText('kW', locale);
    const kwh = unitText('kWh', locale);

    return html`
      ${header(
        config.title ?? t('devices.title'),
        html`<span class="totals"
          ><b>${formatNumber(totalEnergy, 1, locale)}</b> ${kwh} · ${t('devices.now')}
          <b>${formatNumber(totalPower / 1000, 2, locale)}</b> ${kw}</span
        >`,
      )}
      ${this._renderShares(rows, totalEnergy)}
      <div class="table" style="--spark:${config.sparkline ? '72px' : '0px'}">
        <div class="device headings">
          <span></span><span>${t('devices.device')}</span
          ><span>${config.sparkline ? '00–24' : ''}</span><span>${kw}</span><span>${kwh}</span>
        </div>
        ${rows.map((row) => this._renderRow(context, row))}
        ${unaccounted ? this._renderUnaccounted(context, unaccounted) : nothing}
      </div>
    `;
  }

  private _totalEnergy(context: Context): number | undefined {
    const { config, hass, data } = context;

    if (!config.total_energy) return undefined;

    const current = readNumber(hass, config.total_energy, 'energy');

    return data ? energySince(data.hourly.get(config.total_energy), data.start, current) : current;
  }

  private _rows(context: Context): DeviceRow[] {
    const { config, hass, data, now } = context;
    const start = data?.start ?? startOfDay(now);
    const rows = config.devices.map((device, index): DeviceRow => {
      const power = readNumber(hass, device.power, 'power');
      const currentEnergy = readNumber(hass, device.energy, 'energy');
      const fine = device.power ? data?.fine.get(device.power) : undefined;
      const hourly = device.energy ? data?.hourly.get(device.energy) : undefined;
      const threshold = device.threshold ?? config.threshold;
      let energy: number | undefined;
      let hours: (number | undefined)[];

      if (device.energy) {
        energy = data ? energySince(hourly, start, currentEnergy) : currentEnergy;
        hours = hourlyChanges(hourly, start, 24);

        const lastState = hourly?.[hourly.length - 1]?.state;
        const tail =
          currentEnergy !== undefined && lastState !== null && lastState !== undefined
            ? Math.max(0, currentEnergy - lastState)
            : 0;
        const current = hourOfDay(now);

        hours[current] = (hours[current] ?? 0) + tail;
      } else {
        hours = powerHours(fine, start);
        energy = data ? hours.reduce<number>((total, value) => total + (value ?? 0), 0) : undefined;
      }

      return {
        device,
        name: device.name ?? entityName(hass, device.power ?? device.energy),
        color: device.color ?? shade(index),
        power,
        energy,
        hours,
        activity: detectActivity(fine, (power ?? 0) > threshold, threshold, device.cycle, now),
      };
    });

    if (config.sort === 'none') return rows;

    const key = (row: DeviceRow): number =>
      (config.sort === 'power' ? row.power : row.energy) ?? Number.NEGATIVE_INFINITY;

    return [...rows].sort((a, b) => key(b) - key(a));
  }

  private _renderShares(
    rows: readonly DeviceRow[],
    total: number,
  ): TemplateResult | typeof nothing {
    if (total <= 0) return nothing;

    return html`<div class="shares" role="img">
      ${rows.map((row) => {
        const share = (row.energy ?? 0) / total;

        return share > 0.004
          ? html`<span style="width:${(share * 100).toFixed(2)}%;background:${row.color}"></span>`
          : nothing;
      })}
      <span style="flex:1 1 auto;background:var(--m-track)"></span>
    </div>`;
  }

  private _statusText(context: Context, row: DeviceRow): string {
    const { hass, t, locale, now } = context;
    const device = row.device;
    const activity = row.activity;
    let text: string;

    if (device.status && entityOf(hass, device.status)) {
      text = formatEntity(hass, device.status, locale).value;
    } else if (activity.kind === 'running') {
      text =
        activity.since === undefined
          ? t('devices.on')
          : t('devices.running', { duration: formatDuration((now - activity.since) / MINUTE, t) });
    } else if (activity.kind === 'always') {
      text = t('devices.always_on');
    } else if (activity.kind === 'finished') {
      text = t('devices.finished', { time: formatTime(activity.at, locale) });
    } else {
      text = t('devices.idle');
    }

    return device.note ? `${text} · ${device.note}` : text;
  }

  private _renderSpark(context: Context, row: DeviceRow): TemplateResult | typeof nothing {
    const { config, now } = context;

    if (!config.sparkline) return html`<span></span>`;

    const max = Math.max(0, ...row.hours.map((value) => value ?? 0));
    const current = hourOfDay(now);

    return html`<div class="spark" aria-hidden="true">
      ${row.hours.map((value, index) => {
        if (index > current || !value || max <= 0) return html`<span></span>`;

        return html`<span
          style="height:${Math.max(3, Math.round((value / max) * 20))}px;background:${row.color}"
        ></span>`;
      })}
    </div>`;
  }

  private _renderRow(context: Context, row: DeviceRow): TemplateResult {
    const { hass, locale, moreInfo } = context;
    const device = row.device;
    const active = row.activity.kind === 'running' || row.activity.kind === 'always';

    return html`<div
      class="device clickable"
      @click=${() => {
        moreInfo(device.power ?? device.energy);
      }}
    >
      <div class="badge">
        ${stateIcon(hass, device.power ?? device.energy, device.icon, row.color)}
      </div>
      <div class="who">
        <b>${row.name}</b>
        <span class="state ${active ? 'on' : ''}"
          ><i></i><span>${this._statusText(context, row)}</span></span
        >
      </div>
      ${this._renderSpark(context, row)}
      <span class="num"
        >${
          row.power === undefined || row.power <= 0
            ? '0'
            : formatNumber(row.power / 1000, 2, locale)
        }</span
      >
      <span class="num energy">${formatNumber(row.energy, 1, locale)}</span>
    </div>`;
  }

  private _renderUnaccounted(
    context: Context,
    unaccounted: { readonly energy?: number; readonly power?: number },
  ): TemplateResult {
    const { t, locale } = context;

    return html`<div class="device">
      <div class="badge dashed">
        <ha-icon icon="mdi:help-circle-outline" style="color:var(--m-muted)"></ha-icon>
      </div>
      <div class="who">
        <b>${t('devices.unaccounted')}</b>
        <span class="state"><span>${t('devices.unaccounted_hint')}</span></span>
      </div>
      <span></span>
      <span class="num"
        >${
          unaccounted.power === undefined ? '—' : formatNumber(unaccounted.power / 1000, 2, locale)
        }</span
      >
      <span class="num energy"
        >${unaccounted.energy === undefined ? '—' : formatNumber(unaccounted.energy, 1, locale)}</span
      >
    </div>`;
  }
}
