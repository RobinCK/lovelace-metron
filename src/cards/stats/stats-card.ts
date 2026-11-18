import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { CardSize } from '../../core/size';
import * as cfg from '../../core/config';
import type { StatisticsResult } from '../../core/data/statistics';
import {
  formatDate,
  formatEnergy,
  formatMonth,
  formatNumber,
  formatSigned,
  formatTime,
  formatWeekday,
} from '../../core/format';
import type { Localize, TranslationKey } from '../../core/i18n';
import { niceMax } from '../../core/math';
import { addDays, addMonths, daysInMonth, firstWeekday } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { barChart, gauge, mirrorChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, meta, stats } from '../../ui/parts';
import type { StatItem, Tick } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { tipValue } from '../../ui/tip';
import type { Tip, TipRow } from '../../ui/tip';
import {
  balanceOf,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  hasSources,
  parseEnergyConfig,
  resolveSources,
  selfConsumption,
  selfSufficiency,
} from '../shared/energy-sources';
import type { Balance, EnergyConfig } from '../shared/energy-sources';
import { periodToDate } from './periods';
import type { PeriodKind } from './periods';

export interface StatsCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly period: PeriodKind;
  readonly compare: boolean;
}

interface StatsData {
  readonly current: Balance;
  readonly previous: Balance;
  readonly buckets: readonly Balance[];
  readonly starts: readonly number[];
  readonly start: number;
  readonly end: number;
  readonly empty: boolean;
}

type Context = CardContext<StatsCardConfig, StatsData>;

type EnergyMetric = 'solar' | 'home' | 'import' | 'export';

type Metric = 'self_consumption' | 'self_sufficiency' | 'net' | EnergyMetric;

const HOUR = 3_600_000;

const ENERGY_METRICS: Readonly<
  Record<EnergyMetric, { readonly label: TranslationKey; readonly color: string }>
> = {
  solar: { label: 'stats.generation', color: 'var(--m-solar)' },
  home: { label: 'stats.consumption', color: 'var(--m-home)' },
  import: { label: 'stats.import_total', color: 'var(--m-grid)' },
  export: { label: 'stats.export_total', color: 'var(--m-ok)' },
};

const PREVIOUS_KEYS: Readonly<Record<PeriodKind, TranslationKey>> = {
  day: 'stats.vs_day',
  week: 'stats.vs_week',
  month: 'stats.vs_month',
  year: 'stats.vs_year',
};

const netOf = (balance: Balance): number | undefined => {
  if (balance.import === undefined && balance.export === undefined) return undefined;

  return (balance.import ?? 0) - (balance.export ?? 0);
};

const metricValue = (metric: Metric, balance: Balance): number | undefined => {
  if (metric === 'self_consumption') return selfConsumption(balance);
  if (metric === 'self_sufficiency') return selfSufficiency(balance);
  if (metric === 'net') return netOf(balance);

  return balance[metric];
};

const bucketStarts = (period: PeriodKind, start: number): number[] => {
  if (period === 'day') {
    const hours = Math.round((addDays(start, 1) - start) / HOUR);

    return Array.from({ length: hours }, (_, index) => start + index * HOUR);
  }

  if (period === 'week') return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  if (period === 'month') {
    return Array.from({ length: daysInMonth(start) }, (_, index) => addDays(start, index));
  }

  return Array.from({ length: 12 }, (_, index) => addMonths(start, index));
};

export class MetronStatsCard extends MetronCard<StatsCardConfig, StatsData> {
  static override maxSize: CardSize = 'medium';

  static override properties: PropertyDeclarations = {
    _focus: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .gauges {
        display: grid;
        grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
        gap: 8px;
      }

      .gauge {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 0;
        text-align: center;
      }

      .dial {
        position: relative;
        display: flex;
        justify-content: center;
        width: 100%;
      }

      .dial svg {
        max-width: 100%;
        height: auto;
      }

      .dial-value {
        position: absolute;
        right: 0;
        bottom: 6px;
        left: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        line-height: 1.1;
      }

      .dial-value b {
        font-family: var(--m-mono);
        font-size: 22px;
        font-weight: 500;
      }

      .dial-value small {
        font-size: 10px;
        color: var(--m-muted);
      }

      .ends {
        display: flex;
        justify-content: space-between;
        width: 100%;
        font-family: var(--m-mono);
        font-size: 9px;
        color: var(--m-muted);
      }

      .gauge-label {
        font-size: 12px;
        color: var(--m-text-2);
      }

      .delta {
        font-size: 11px;
      }

      .gauge.clickable:hover .gauge-label {
        color: var(--m-text);
      }

      .detail {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .detail > .shrink {
        display: flex;
        flex-direction: column;
      }

      .detail-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
        font-size: 12px;
        color: var(--m-text-2);
      }

      .detail-head b {
        font-family: var(--m-mono);
        font-size: 14px;
        font-weight: 500;
        color: var(--m-text);
      }

      .detail-head button {
        margin-left: auto;
        padding: 0 2px;
        border: 0;
        background: none;
        font: inherit;
        font-size: 16px;
        line-height: 1;
        color: var(--m-muted);
        cursor: pointer;
      }

      .detail-head button:hover {
        color: var(--m-text);
      }
    `,
  ];

  declare _focus: Metric | undefined;

  constructor() {
    super();
    this._focus = undefined;
  }

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(form.select('period', ['day', 'week', 'month', 'year']), form.toggle('compare')),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): StatsCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      period: cfg.oneOf(raw, 'period', ['day', 'week', 'month', 'year'], 'month'),
      compare: cfg.boolean(raw, 'compare', true),
    };
  }

  protected override cardSize(): number {
    return 4;
  }

  protected override async fetchData(
    config: StatsCardConfig,
    hass: HomeAssistant,
  ): Promise<StatsData> {
    const now = Date.now();
    const range = periodToDate(config.period, now, firstWeekday(hass.locale));
    const sources = await resolveSources(hass, config.energy);
    const granularity = config.period === 'day' ? 'hour' : 'day';
    const [current, previous] = await Promise.all([
      fetchEnergyStatistics(hass, sources, range.start - 3_600_000, range.end, granularity),
      config.compare
        ? fetchEnergyStatistics(hass, sources, range.previousStart, range.previousEnd, granularity)
        : Promise.resolve<StatisticsResult>(new Map()),
    ]);

    const starts = bucketStarts(config.period, range.start);
    const series = energySeries(current, sources, starts, range.end + 1, { hass, now });

    return {
      start: range.start,
      end: range.end,
      starts,
      buckets: starts.map((_, index) => ({
        solar: series.solar[index],
        home: series.home[index],
        import: series.import[index],
        export: series.export[index],
        charge: series.charge[index],
        discharge: series.discharge[index],
      })),
      current: balanceOf(
        energySeries(current, sources, [range.start], range.end + 1, { hass, now }),
      ),
      previous: balanceOf(
        energySeries(previous, sources, [range.previousStart], range.previousEnd),
      ),
      empty: !hasSources(sources),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t } = context;

    if (data?.empty) return html`<div class="empty">${t('energy.no_sources')}</div>`;

    const current = data?.current ?? {};
    const previous = data?.previous ?? {};
    const focus = data ? this._focus : undefined;

    if (data && focus) {
      return html`
        ${header(this._title(context), meta(this._range(context, data)))}
        ${this._renderDetail(context, data, focus)}
        ${context.size === 'small' ? nothing : stats(this._totals(context, current))}
      `;
    }

    return html`
      ${header(this._title(context), data ? meta(this._range(context, data)) : nothing)}
      <div class="gauges" style=${context.size === 'auto' ? '' : 'margin:auto 0'}>
        ${this._percentGauge(
          context,
          'self_consumption',
          selfConsumption(current),
          config.compare ? selfConsumption(previous) : undefined,
          'var(--m-solar)',
        )}
        ${this._percentGauge(
          context,
          'self_sufficiency',
          selfSufficiency(current),
          config.compare ? selfSufficiency(previous) : undefined,
          'var(--m-home)',
        )}
        ${this._netGauge(context, current, previous)}
      </div>
      ${context.size === 'small' ? nothing : stats(this._totals(context, current))}
    `;
  }

  private _gaugeSize(context: Context): number {
    return context.size === 'small' ? 84 : 112;
  }

  private _title(context: Context): string {
    const { config, t, locale, now } = context;

    if (config.title !== undefined && config.title !== false) return config.title;

    const label: Readonly<Record<PeriodKind, string>> = {
      day: t('common.today').toLowerCase(),
      week: t('common.this_week').toLowerCase(),
      month: formatMonth(now, locale, true),
      year: String(new Date(now).getFullYear()),
    };

    return t('stats.title', { period: label[config.period] });
  }

  private _range(context: Context, data: StatsData): string {
    const { config, locale } = context;

    if (config.period === 'day') return formatWeekday(data.start, locale);

    const from = formatDate(data.start, locale, { day: 'numeric' });
    const to = formatDate(data.end, locale);

    return `${from}–${to}`;
  }

  private _delta(
    t: Localize,
    config: StatsCardConfig,
    text: string,
    change: number,
    higherIsBetter: boolean,
  ): TemplateResult {
    const neutral = Math.abs(change) < 0.5;
    const good = higherIsBetter ? change > 0 : change < 0;
    const color = neutral ? 'var(--m-muted)' : good ? 'var(--m-ok)' : 'var(--m-warn)';

    return html`<span class="delta" style="color:${color}"
      >${text} ${t(PREVIOUS_KEYS[config.period])}</span
    >`;
  }

  private _percentGauge(
    context: Context,
    metric: 'self_consumption' | 'self_sufficiency',
    value: number | undefined,
    previous: number | undefined,
    color: string,
  ): TemplateResult {
    const { config, t, locale } = context;
    const label = t(`energy.${metric}`);
    const delta =
      value !== undefined && previous !== undefined ? (value - previous) * 100 : undefined;

    return html`<div class="gauge clickable" @click=${() => this._open(metric)}>
      <div class="dial">
        ${gauge(value, color, { size: this._gaugeSize(context), stroke: 9 })}
        <div class="dial-value">
          <span
            ><b>${formatNumber(value === undefined ? undefined : value * 100, 0, locale)}</b
            ><small> %</small></span
          >
        </div>
      </div>
      ${context.size === 'small' ? nothing : html`<div class="ends"><span>0</span><span>100</span></div>`}
      <span class="gauge-label">${label}</span>
      ${
        delta === undefined || context.size === 'small'
          ? nothing
          : this._delta(
              t,
              config,
              t('stats.points', { value: formatSigned(delta, 0, locale) }),
              delta,
              true,
            )
      }
    </div>`;
  }

  private _netGauge(context: Context, current: Balance, previous: Balance): TemplateResult {
    const { config, t, locale } = context;
    const net = netOf(current);
    const before = netOf(previous);
    const span = niceMax(Math.max(1, Math.abs(net ?? 0), Math.abs(before ?? 0)) * 1.15);
    const fraction = net === undefined ? undefined : 0.5 + net / span / 2;
    const exporting = net !== undefined && net < 0;
    const color = exporting ? 'var(--m-ok)' : 'var(--m-grid)';
    const change =
      net !== undefined && before !== undefined && Math.abs(before) > 0.01
        ? ((net - before) / Math.abs(before)) * 100
        : undefined;
    const value = formatEnergy(net === undefined ? undefined : Math.abs(net), locale, 1);

    return html`<div class="gauge clickable" @click=${() => this._open('net')}>
      <div class="dial">
        ${gauge(fraction, color, {
          size: this._gaugeSize(context),
          stroke: 9,
          origin: 0.5,
          marker: true,
        })}
        <div class="dial-value"><b>${value.value}</b><small>${value.unit}</small></div>
      </div>
      ${
        context.size === 'small'
          ? nothing
          : html`<div class="ends">
              <span>${t('stats.export')}</span><span>${t('stats.import')}</span>
            </div>`
      }
      <span class="gauge-label"
        >${exporting ? t('stats.net_to_grid') : t('stats.net_from_grid')}</span
      >
      ${
        change === undefined || !config.compare || context.size === 'small'
          ? nothing
          : this._delta(t, config, `${formatSigned(change, 0, locale)} %`, change, false)
      }
    </div>`;
  }

  private _totals(context: Context, balance: Balance): StatItem[] {
    const { t, locale } = context;
    const metrics: readonly EnergyMetric[] = ['solar', 'home', 'import', 'export'];

    return metrics
      .filter((metric) => balance[metric] !== undefined)
      .map((metric) => {
        const energy = formatEnergy(balance[metric], locale, 1);

        return {
          label: t(ENERGY_METRICS[metric].label),
          value: energy.value,
          unit: energy.unit,
          active: this._focus === metric,
          onClick: () => {
            this._open(metric);
          },
        };
      });
  }

  private _open(metric: Metric): void {
    this._focus = this._focus === metric ? undefined : metric;
  }

  private _metricLabel(context: Context, metric: Metric): string {
    const { t, data } = context;

    if (metric === 'self_consumption' || metric === 'self_sufficiency') {
      return t(`energy.${metric}`);
    }

    if (metric === 'net') {
      return (netOf(data?.current ?? {}) ?? 0) < 0
        ? t('stats.net_to_grid')
        : t('stats.net_from_grid');
    }

    return t(ENERGY_METRICS[metric].label);
  }

  private _metricText(context: Context, metric: Metric, value: number | undefined): string {
    const { locale } = context;

    if (metric === 'self_consumption' || metric === 'self_sufficiency') {
      return value === undefined ? '—' : `${formatNumber(value * 100, 0, locale)} %`;
    }

    return tipValue(formatEnergy(value === undefined ? undefined : Math.abs(value), locale, 1));
  }

  private _renderDetail(context: Context, data: StatsData, metric: Metric): TemplateResult {
    const { t, size } = context;
    const small = size === 'small';
    const height = small ? 72 : 200;
    const values = data.buckets.map((balance) => metricValue(metric, balance));
    const frame = {
      height,
      fill: small ? 24 : 72,
      gap: 2,
      label: this._metricLabel(context, metric),
      tip: (index: number) => this._tip(context, data, metric, index),
    };
    const chart =
      metric === 'net'
        ? mirrorChart(
            values.map((value) => (value === undefined ? undefined : Math.max(0, value))),
            values.map((value) => (value === undefined ? undefined : Math.max(0, -value))),
            { ...frame, upColor: 'var(--m-grid)', downColor: 'var(--m-ok)' },
          )
        : barChart(
            [
              {
                values,
                color:
                  metric === 'self_consumption'
                    ? 'var(--m-solar)'
                    : metric === 'self_sufficiency'
                      ? 'var(--m-home)'
                      : ENERGY_METRICS[metric].color,
              },
            ],
            {
              ...frame,
              max: metric === 'self_consumption' || metric === 'self_sufficiency' ? 1 : undefined,
            },
          );

    return html`<div class="detail shrink">
      <div class="detail-head">
        <span>${this._metricLabel(context, metric)}</span>
        <b>${this._metricText(context, metric, metricValue(metric, data.current))}</b>
        <button
          title=${t('common.close')}
          aria-label=${t('common.close')}
          @click=${() => {
            this._focus = undefined;
          }}
        >
          ×
        </button>
      </div>
      <div class="shrink">${chart}</div>
      ${axis(this._ticks(context, data))}
    </div>`;
  }

  private _ticks(context: Context, data: StatsData): Tick[] {
    const { config, locale } = context;
    const count = data.starts.length;

    if (config.period === 'day') {
      return [0, 6, 12, 18, 24].map((hour) => ({
        at: hour / count,
        label: String(hour).padStart(2, '0'),
      }));
    }

    if (config.period === 'week') {
      return data.starts.map((start, index) => ({
        at: (index + 0.5) / count,
        label: formatDate(start, locale, { weekday: 'short' }),
      }));
    }

    if (config.period === 'month') {
      return [1, 8, 15, 22, 29]
        .filter((day) => day <= count)
        .map((day) => ({ at: (day - 0.5) / count, label: String(day) }));
    }

    return [0, 3, 6, 9].map((month) => ({
      at: (month + 0.5) / count,
      label: formatMonth(data.starts[month] ?? data.start, locale),
    }));
  }

  private _bucketTitle(context: Context, data: StatsData, index: number): string {
    const { config, locale } = context;
    const start = data.starts[index] ?? data.start;

    if (config.period === 'day') {
      return `${formatTime(start, locale)}–${formatTime(start + HOUR, locale)}`;
    }

    if (config.period === 'year') return formatMonth(start, locale, true);

    return formatDate(start, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  private _tip(context: Context, data: StatsData, metric: Metric, index: number): Tip | undefined {
    const { t, locale } = context;
    const balance = data.buckets[index];
    const value = balance ? metricValue(metric, balance) : undefined;

    if (!balance || value === undefined) return undefined;

    const energy = (label: TranslationKey, amount: number | undefined, color?: string): TipRow[] =>
      amount === undefined
        ? []
        : [{ label: t(label), value: tipValue(formatEnergy(amount, locale, 2)), color }];
    const rows: TipRow[] =
      metric === 'self_consumption'
        ? [
            {
              label: t('energy.self_consumption'),
              value: this._metricText(context, metric, value),
              color: 'var(--m-solar)',
            },
            ...energy('stats.generation', balance.solar),
            ...energy('stats.export_total', balance.export),
          ]
        : metric === 'self_sufficiency'
          ? [
              {
                label: t('energy.self_sufficiency'),
                value: this._metricText(context, metric, value),
                color: 'var(--m-home)',
              },
              ...energy('stats.consumption', balance.home),
              ...energy('stats.import_total', balance.import),
            ]
          : metric === 'net'
            ? [
                ...energy('stats.import_total', balance.import, 'var(--m-grid)'),
                ...energy('stats.export_total', balance.export, 'var(--m-ok)'),
              ]
            : energy(ENERGY_METRICS[metric].label, value, ENERGY_METRICS[metric].color);

    return { title: this._bucketTitle(context, data, index), rows };
  }
}
