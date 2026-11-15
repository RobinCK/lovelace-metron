import { css, html } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { overlap } from '../../core/data/history';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import {
  formatDate,
  formatNumber,
  formatSigned,
  formatTime,
  formatWeekday,
  unitText,
} from '../../core/format';
import type { Localize, TranslationKey } from '../../core/i18n';
import { firstWeekday } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, legend, meta } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  balanceOf,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
  selfConsumption,
  selfSufficiency,
} from '../shared/energy-sources';
import type { Balance, EnergyConfig } from '../shared/energy-sources';
import { fetchOutages } from '../shared/outages';
import { periodToDate } from '../stats/periods';
import type { PeriodKind, PeriodRange } from '../stats/periods';

export const COMPARE_METRICS = [
  'generation',
  'consumption',
  'import',
  'export',
  'self_sufficiency',
  'self_consumption',
  'gas',
  'outage',
] as const;

export type CompareMetric = (typeof COMPARE_METRICS)[number];

export interface WeekCompareCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly period: PeriodKind;
  readonly metrics: readonly CompareMetric[];
  readonly gas?: string;
  readonly grid_status?: string;
  readonly invert_grid_status: boolean;
  readonly scale: number;
}

interface Side {
  readonly balance: Balance;
  readonly gas?: number;
  readonly outage?: number;
}

interface CompareData {
  readonly range: PeriodRange;
  readonly current: Side;
  readonly previous: Side;
}

type Context = CardContext<WeekCompareCardConfig, CompareData>;

interface Row {
  readonly label: string;
  readonly unit: string;
  readonly last: string;
  readonly now: string;
  readonly change?: number;
  readonly text: string;
  readonly good: boolean;
}

interface MetricInfo {
  readonly label: TranslationKey;
  readonly higherIsBetter: boolean;
}

const METRICS: Readonly<Record<CompareMetric, MetricInfo>> = {
  generation: { label: 'compare.generation', higherIsBetter: true },
  consumption: { label: 'compare.consumption', higherIsBetter: false },
  import: { label: 'compare.import', higherIsBetter: false },
  export: { label: 'compare.export', higherIsBetter: true },
  self_sufficiency: { label: 'compare.self_sufficiency', higherIsBetter: true },
  self_consumption: { label: 'compare.self_consumption', higherIsBetter: true },
  gas: { label: 'compare.gas', higherIsBetter: false },
  outage: { label: 'compare.outage', higherIsBetter: false },
};

const TITLES: Readonly<Record<PeriodKind, TranslationKey>> = {
  day: 'compare.title_day',
  week: 'compare.title_week',
  month: 'compare.title_month',
  year: 'compare.title_year',
};

const clock = (hours: number): string => {
  const minutes = Math.round(hours * 60);

  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

const relative = (now: number | undefined, last: number | undefined): number | undefined => {
  if (now === undefined || last === undefined || Math.abs(last) < 1e-6) return undefined;

  return ((now - last) / Math.abs(last)) * 100;
};

export class MetronWeekCompareCard extends MetronCard<WeekCompareCardConfig, CompareData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) 52px 52px minmax(64px, 1fr) 60px;
        column-gap: 10px;
        align-items: center;
      }

      .grid.head {
        padding-bottom: 6px;
        border-bottom: 1px solid var(--m-line);
        font-size: 10px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .grid.head span:nth-child(2),
      .grid.head span:nth-child(3),
      .grid.head span:last-child {
        text-align: right;
      }

      .scale {
        display: flex;
        justify-content: space-between;
      }

      .grid.row {
        padding: 8px 0;
        border-bottom: 1px solid var(--m-line);
      }

      .metric {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .metric span:first-child {
        overflow: hidden;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .metric small {
        font-size: 10px;
        color: var(--m-muted);
      }

      .last {
        color: var(--m-muted);
      }

      .bar {
        position: relative;
        height: 8px;
        border-radius: 4px;
        background: var(--m-track);
      }

      .bar::after {
        position: absolute;
        top: -3px;
        bottom: -3px;
        left: 50%;
        width: 1px;
        background: var(--m-muted);
        content: '';
      }

      .bar i {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 4px;
      }

      .change {
        font-family: var(--m-mono);
        font-size: 12px;
        font-weight: 600;
        text-align: right;
        white-space: nowrap;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(
        form.select('period', ['day', 'week', 'month', 'year']),
        form.number('scale', { min: 10, max: 200, unit: '%' }),
      ),
      {
        name: 'metrics',
        selector: { select: { multiple: true, mode: 'list', options: [...COMPARE_METRICS] } },
      },
      form.grid(
        form.entity('gas', { domain: ['sensor'] }),
        form.entity('grid_status', {
          domain: ['binary_sensor', 'sensor', 'switch', 'input_boolean'],
        }),
      ),
      form.toggle('invert_grid_status'),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): WeekCompareCardConfig {
    const requested = Array.isArray(raw.metrics)
      ? raw.metrics.filter((item): item is CompareMetric =>
          (COMPARE_METRICS as readonly unknown[]).includes(item),
        )
      : [];
    const gas = cfg.entity(raw, 'gas');
    const gridStatus = cfg.entity(raw, 'grid_status');
    const metrics =
      requested.length > 0
        ? requested
        : COMPARE_METRICS.filter(
            (metric) =>
              metric !== 'self_consumption' &&
              (metric !== 'gas' || gas !== undefined) &&
              (metric !== 'outage' || gridStatus !== undefined),
          );

    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      period: cfg.oneOf(raw, 'period', ['day', 'week', 'month', 'year'], 'week'),
      metrics,
      gas,
      grid_status: gridStatus,
      invert_grid_status: cfg.boolean(raw, 'invert_grid_status', false),
      scale: cfg.number(raw, 'scale', 60, { min: 10, max: 200 }),
    };
  }

  protected override cardSize(config: WeekCompareCardConfig): number {
    return 2 + config.metrics.length;
  }

  protected override async fetchData(
    config: WeekCompareCardConfig,
    hass: HomeAssistant,
  ): Promise<CompareData> {
    const now = Date.now();
    const range = periodToDate(config.period, now, firstWeekday(hass.locale));
    const sources = await resolveSources(hass, config.energy);
    const granularity = config.period === 'day' ? 'hour' : 'day';
    const [current, previous, gas, outages] = await Promise.all([
      fetchEnergyStatistics(hass, sources, range.start - HOUR, range.end, granularity),
      fetchEnergyStatistics(hass, sources, range.previousStart, range.previousEnd, granularity),
      config.gas
        ? fetchStatistics(hass, {
            entityIds: [config.gas],
            start: range.previousStart,
            end: range.end,
            period: 'hour',
            types: ['change'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
      fetchOutages(
        hass,
        config.grid_status,
        config.invert_grid_status,
        range.previousStart,
        range.end,
      ),
    ]);
    const gasRows = config.gas ? gas.get(config.gas) : undefined;
    const gasBetween = (from: number, to: number): number | undefined =>
      gasRows === undefined
        ? undefined
        : gasRows
            .filter((row) => row.start >= from && row.start < to)
            .reduce((sum, row) => sum + (row.change ?? 0), 0);

    return {
      range,
      current: {
        balance: balanceOf(
          energySeries(current, sources, [range.start], range.end + 1, { hass, now }),
        ),
        gas: gasBetween(range.start, range.end),
        outage: config.grid_status ? overlap(outages, range.start, range.end) / HOUR : undefined,
      },
      previous: {
        balance: balanceOf(
          energySeries(previous, sources, [range.previousStart], range.previousEnd),
        ),
        gas: gasBetween(range.previousStart, range.previousEnd),
        outage: config.grid_status
          ? overlap(outages, range.previousStart, range.previousEnd) / HOUR
          : undefined,
      },
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t } = context;
    const rows = data ? config.metrics.flatMap((metric) => this._row(context, data, metric)) : [];

    return html`
      ${header(config.title ?? t(TITLES[config.period]), data ? meta(this._range(context, data.range)) : undefined)}
      <div>
        <div class="grid head">
          <span></span><span>${t('compare.previous')}</span><span>${t('compare.current')}</span>
          <span class="scale"
            ><span>−${config.scale} %</span><span>0</span><span>+${config.scale} %</span></span
          >
          <span>Δ</span>
        </div>
        ${
          data
            ? rows.map((row) => this._renderRow(context, row))
            : html`<div class="empty">${t('common.loading')}</div>`
        }
      </div>
      ${legend([
        { label: t('compare.better'), color: 'var(--m-ok)' },
        { label: t('compare.worse'), color: 'var(--m-warn)' },
      ])}
    `;
  }

  private _range(context: Context, range: PeriodRange): string {
    const { config, t, locale } = context;
    const day = (time: number): string => formatDate(time, locale, { day: 'numeric' });

    if (config.period === 'day') {
      return t('compare.range_day', { time: formatTime(range.end, locale) });
    }

    return t('compare.range', {
      from: formatWeekday(range.start, locale),
      to: formatWeekday(range.end, locale),
      time: formatTime(range.end, locale),
      current: `${day(range.start)}–${formatDate(range.end, locale)}`,
      previous: `${day(range.previousStart)}–${formatDate(range.previousEnd - 1, locale)}`,
    });
  }

  private _row(context: Context, data: CompareData, metric: CompareMetric): Row[] {
    const { t, locale } = context;
    const info = METRICS[metric];
    const kwh = unitText('kWh', locale);
    const energy = (pick: (balance: Balance) => number | undefined): Row[] => {
      const now = pick(data.current.balance);
      const last = pick(data.previous.balance);

      if (now === undefined && last === undefined) return [];

      return [
        this._numericRow(
          t,
          info,
          kwh,
          formatNumber(last, 1, locale),
          formatNumber(now, 1, locale),
          relative(now, last),
          locale,
        ),
      ];
    };

    if (metric === 'generation') return energy((balance) => balance.solar);
    if (metric === 'consumption') return energy((balance) => balance.home);
    if (metric === 'import') return energy((balance) => balance.import);
    if (metric === 'export') return energy((balance) => balance.export);

    if (metric === 'self_sufficiency' || metric === 'self_consumption') {
      const pick = metric === 'self_sufficiency' ? selfSufficiency : selfConsumption;
      const now = pick(data.current.balance);
      const last = pick(data.previous.balance);

      if (now === undefined && last === undefined) return [];

      const change = now !== undefined && last !== undefined ? (now - last) * 100 : undefined;

      return [
        {
          label: t(info.label),
          unit: '%',
          last: formatNumber(last === undefined ? undefined : last * 100, 0, locale),
          now: formatNumber(now === undefined ? undefined : now * 100, 0, locale),
          change,
          text:
            change === undefined
              ? '—'
              : t('stats.points', { value: formatSigned(change, 0, locale) }),
          good: (change ?? 0) >= 0,
        },
      ];
    }

    if (metric === 'gas') {
      const { gas: now } = data.current;
      const { gas: last } = data.previous;

      if (now === undefined && last === undefined) return [];

      return [
        this._numericRow(
          t,
          info,
          unitText('m³', locale),
          formatNumber(last, 1, locale),
          formatNumber(now, 1, locale),
          relative(now, last),
          locale,
        ),
      ];
    }

    const now = data.current.outage;
    const last = data.previous.outage;

    if (now === undefined && last === undefined) return [];

    return [
      this._numericRow(
        t,
        info,
        unitText('h', locale),
        last === undefined ? '—' : clock(last),
        now === undefined ? '—' : clock(now),
        relative(now, last),
        locale,
      ),
    ];
  }

  private _numericRow(
    t: Localize,
    info: MetricInfo,
    unit: string,
    last: string,
    now: string,
    change: number | undefined,
    locale: CardContext<WeekCompareCardConfig, CompareData>['locale'],
  ): Row {
    return {
      label: t(info.label),
      unit,
      last,
      now,
      change,
      text: change === undefined ? '—' : `${formatSigned(change, 0, locale)} %`,
      good: change === undefined ? true : info.higherIsBetter ? change >= 0 : change <= 0,
    };
  }

  private _renderRow(context: Context, row: Row): TemplateResult {
    const { config } = context;
    const width =
      row.change === undefined ? 0 : Math.min(50, (Math.abs(row.change) / config.scale) * 50);
    const left = (row.change ?? 0) >= 0 ? 50 : 50 - width;
    const neutral = row.change === undefined || Math.abs(row.change) < 0.5;
    const color = neutral ? 'var(--m-muted)' : row.good ? 'var(--m-ok)' : 'var(--m-warn)';

    return html`<div class="grid row">
      <div class="metric"><span>${row.label}</span><small>${row.unit}</small></div>
      <span class="num last">${row.last}</span>
      <span class="num">${row.now}</span>
      <div class="bar">
        <i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;background:${color}"></i>
      </div>
      <span class="change" style="color:${color}">${row.text}</span>
    </div>`;
  }
}
