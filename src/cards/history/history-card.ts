import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { DAY } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import {
  formatDate,
  formatEnergy,
  formatMonth,
  formatNumber,
  formatSigned,
} from '../../core/format';
import { niceMax } from '../../core/math';
import { addDays, addMonths, daysInMonth, startOfDay, startOfMonth } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { barChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, navigator, pill } from '../../ui/parts';
import type { Tick } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  hasSources,
  parseEnergyConfig,
  resolveSources,
  total,
} from '../shared/energy-sources';
import type { EnergyConfig, Series } from '../shared/energy-sources';
import { splitConsumption, splitProduction } from '../shared/split';
import type { SplitSeries } from '../shared/split';

export type HistoryMode = 'consumption' | 'production';

export interface HistoryCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly mode: HistoryMode;
  readonly navigation: boolean;
  readonly height: number;
}

interface HistoryData {
  readonly start: number;
  readonly days: number;
  readonly split: SplitSeries;
  readonly totals: Series;
  readonly previousAverage?: number;
  readonly empty: boolean;
}

type Context = CardContext<HistoryCardConfig, HistoryData>;

const sumAt = (split: SplitSeries, index: number): number | undefined => {
  const values = [split.solar[index], split.battery[index], split.grid[index]];

  if (values.every((value) => value === undefined)) return undefined;

  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
};

export class MetronHistoryCard extends MetronCard<HistoryCardConfig, HistoryData> {
  static override properties: PropertyDeclarations = {
    _offset: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .summary {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
      }

      .total {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }

      .bars {
        position: relative;
      }

      .avg {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-muted);
      }

      .avg span {
        position: absolute;
        right: 0;
        bottom: 2px;
        font-family: var(--m-mono);
        font-size: 10px;
        color: var(--m-muted);
      }
    `,
  ];

  declare _offset: number;

  constructor() {
    super();
    this._offset = 0;
  }

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.grid(form.select('mode', ['consumption', 'production']), form.toggle('navigation')),
      form.number('height', { min: 60, max: 240, unit: 'px' }),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): HistoryCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      mode: cfg.oneOf(raw, 'mode', ['consumption', 'production'], 'consumption'),
      navigation: cfg.boolean(raw, 'navigation', true),
      height: cfg.number(raw, 'height', 120, { min: 60, max: 240 }),
    };
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override async fetchData(
    config: HistoryCardConfig,
    hass: HomeAssistant,
  ): Promise<HistoryData> {
    const now = Date.now();
    const start = addMonths(startOfMonth(now), this._offset);
    const end = addMonths(start, 1);
    const previous = addMonths(start, -1);
    const days = daysInMonth(start);
    const sources = await resolveSources(hass, config.energy);
    const starts = Array.from({ length: days }, (_, index) => addDays(start, index));
    const [current, before] = await Promise.all([
      fetchEnergyStatistics(hass, sources, start - DAY, end, 'day'),
      fetchEnergyStatistics(hass, sources, previous, start, 'day'),
    ]);
    const series = energySeries(current, sources, starts, end, { hass, now });
    const previousSeries = energySeries(before, sources, [previous], start);
    const split = config.mode === 'production' ? splitProduction(series) : splitConsumption(series);
    const previousTotal = (
      config.mode === 'production' ? previousSeries.solar : previousSeries.home
    )[0];

    return {
      start,
      days,
      split,
      totals: starts.map((_, index) => sumAt(split, index)),
      previousAverage:
        previousTotal === undefined ? undefined : previousTotal / daysInMonth(previous),
      empty: !hasSources(sources),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale, now } = context;
    const selected = addMonths(startOfMonth(now), this._offset);
    const ready = data?.start === selected;

    if (data?.empty) return html`<div class="empty">${t('energy.no_sources')}</div>`;

    return html`
      <div class="top">
        <span class="eyebrow"
          >${
            config.title === undefined || config.title === false
              ? t(config.mode === 'production' ? 'history.production' : 'history.consumption')
              : config.title
          }</span
        >
        ${
          config.navigation
            ? navigator({
                label: formatMonth(selected, locale, true),
                previousLabel: t('history.previous_month'),
                nextLabel: t('history.next_month'),
                canNext: this._offset < 0,
                previous: () => {
                  this._shift(-1);
                },
                next: () => {
                  this._shift(1);
                },
              })
            : nothing
        }
      </div>
      ${ready ? this._renderContent(context, data) : html`<div class="empty">${t('common.loading')}</div>`}
    `;
  }

  private _shift(delta: number): void {
    this._offset = Math.min(0, this._offset + delta);
    this.reload();
  }

  private _renderContent(context: Context, data: HistoryData): TemplateResult {
    const { config, t, locale, now } = context;
    const today = startOfDay(now);
    const complete = data.totals.filter((_, index) => addDays(data.start, index) < today);
    const known = complete.filter((value): value is number => value !== undefined);
    const sum = total(data.totals);
    const average = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : undefined;
    const maxValue = known.length > 0 ? Math.max(...known) : undefined;
    const maxIndex = maxValue === undefined ? -1 : data.totals.indexOf(maxValue);
    const change =
      average !== undefined && data.previousAverage
        ? ((average - data.previousAverage) / data.previousAverage) * 100
        : undefined;
    const better = config.mode === 'production' ? (change ?? 0) >= 0 : (change ?? 0) <= 0;
    const formatted = formatEnergy(sum, locale, 1);
    const todayIndex = Math.floor((today - data.start) / DAY);
    const scale = niceMax(Math.max(1, ...known, ...data.totals.map((value) => value ?? 0)));
    const height = config.height;
    const opacity = (index: number): number => (index === todayIndex ? 0.55 : 1);
    const colors =
      config.mode === 'production'
        ? ['var(--m-home)', 'var(--m-battery)', 'var(--m-grid)']
        : ['var(--m-solar)', 'var(--m-battery)', 'var(--m-grid)'];
    const labels =
      config.mode === 'production'
        ? [t('history.self_used'), t('flow.battery'), t('energy.export')]
        : [t('flow.solar'), t('flow.battery'), t('flow.grid')];
    const parts = [data.split.solar, data.split.battery, data.split.grid];
    const todayDay = todayIndex >= 0 && todayIndex < data.days ? todayIndex + 1 : undefined;
    const days = [1, 8, 15, 22, data.days].filter(
      (day) => todayDay === undefined || Math.abs(day - todayDay) > 2,
    );
    const ticks: Tick[] = [...days, ...(todayDay === undefined ? [] : [todayDay])]
      .sort((a, b) => a - b)
      .map((day) => ({
        at: (day - 0.5) / data.days,
        label: String(day),
        color: day === todayDay ? 'var(--m-text)' : undefined,
      }));

    return html`
      <div class="summary">
        <div class="total">
          <span
            ><span class="big">${formatted.value}</span
            ><span class="unit"> ${formatted.unit}</span></span
          >
          ${
            change === undefined
              ? nothing
              : pill(
                  t('history.vs_previous', {
                    value: `${formatSigned(change, 0, locale)} %`,
                    month: formatMonth(addMonths(data.start, -1), locale),
                  }),
                  better ? 'ok' : 'warn',
                  false,
                )
          }
        </div>
        <div class="side-list">
          <div class="side-row">
            <span>${t('history.average')}</span
            ><span><b>${formatNumber(average, 1, locale)}</b> ${t('history.per_day')}</span>
          </div>
          ${
            maxValue === undefined
              ? nothing
              : html`<div class="side-row">
                  <span>${t('common.max')}</span
                  ><span
                    ><b>${formatNumber(maxValue, 1, locale)}</b> ·
                    ${formatDate(addDays(data.start, maxIndex), locale)}</span
                  >
                </div>`
          }
        </div>
      </div>
      <div class="section" style="gap:6px">
        <div class="bars">
          ${barChart(
            parts.map((values, index) => ({
              values,
              color: colors[index] ?? 'var(--m-text)',
              opacity,
            })),
            { height, max: scale, stacked: true, gap: 3, label: t('history.chart_label') },
          )}
          ${
            average === undefined
              ? nothing
              : html`<div class="avg" style="top:${((1 - average / scale) * height).toFixed(1)}px">
                  <span
                    >${t('history.avg_short', { value: formatNumber(average, 1, locale) })}</span
                  >
                </div>`
          }
        </div>
        ${axis(ticks)}
      </div>
      <div class="dot-legend" style="justify-content:flex-start;gap:18px">
        ${parts.map((values, index) => {
          const part = total(values) ?? 0;
          const share = sum ? (part / sum) * 100 : 0;

          return html`<span
            ><i style="background:${colors[index]};border-radius:2px"></i>${labels[index]}
            <b>${formatNumber(share, 0, locale)} %</b></span
          >`;
        })}
      </div>
    `;
  }
}
