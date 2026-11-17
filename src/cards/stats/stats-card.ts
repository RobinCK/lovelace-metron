import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
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
  formatWeekday,
} from '../../core/format';
import type { Localize, TranslationKey } from '../../core/i18n';
import { niceMax } from '../../core/math';
import { firstWeekday } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { gauge } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
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
  readonly start: number;
  readonly end: number;
  readonly empty: boolean;
}

type Context = CardContext<StatsCardConfig, StatsData>;

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

export class MetronStatsCard extends MetronCard<StatsCardConfig, StatsData> {
  static override maxSize: CardSize = 'medium';

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
    `,
  ];

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

    return {
      start: range.start,
      end: range.end,
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

    return html`
      ${header(this._title(context), data ? meta(this._range(context, data)) : nothing)}
      <div class="gauges" style=${context.size === 'auto' ? '' : 'margin:auto 0'}>
        ${this._percentGauge(
          context,
          t('energy.self_consumption'),
          selfConsumption(current),
          config.compare ? selfConsumption(previous) : undefined,
          'var(--m-solar)',
        )}
        ${this._percentGauge(
          context,
          t('energy.self_sufficiency'),
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
    label: string,
    value: number | undefined,
    previous: number | undefined,
    color: string,
  ): TemplateResult {
    const { config, t, locale } = context;
    const delta =
      value !== undefined && previous !== undefined ? (value - previous) * 100 : undefined;

    return html`<div class="gauge">
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

    return html`<div class="gauge">
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
    const items: {
      readonly key: TranslationKey;
      readonly value?: number;
      readonly tone: StatItem['tone'];
    }[] = [
      { key: 'stats.generation', value: balance.solar, tone: 'solar' },
      { key: 'stats.consumption', value: balance.home, tone: 'home' },
      { key: 'stats.import_total', value: balance.import, tone: 'grid' },
      { key: 'stats.export_total', value: balance.export, tone: 'grid' },
    ];

    return items
      .filter((item) => item.value !== undefined)
      .map((item) => {
        const energy = formatEnergy(item.value, locale, 1);

        return { label: t(item.key), value: energy.value, unit: energy.unit };
      });
  }
}
