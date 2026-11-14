import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { formatDate, formatMonth, formatNumber, formatSigned, unitText } from '../../core/format';
import type { TranslationKey } from '../../core/i18n';
import { addDays, addMonths, daysInMonth, startOfDay, startOfMonth } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, pill, stats } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  counterSeries,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveGas,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, Series } from '../shared/energy-sources';
import { parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';

export type BudgetMetric = 'import' | 'consumption' | 'gas';

export interface BudgetCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly budget?: Price;
  readonly metric: BudgetMetric;
  readonly gas: readonly string[];
  readonly height: number;
}

interface BudgetData {
  readonly start: number;
  readonly days: number;
  readonly daily: Series;
}

type Context = CardContext<BudgetCardConfig, BudgetData>;

const TITLES: Readonly<Record<BudgetMetric, TranslationKey>> = {
  import: 'budget.title_import',
  consumption: 'budget.title_consumption',
  gas: 'budget.title_gas',
};

const HATCH = (color: string): string =>
  `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 60%, transparent) 0 2px, color-mix(in srgb, ${color} 12%, transparent) 2px 5px)`;

export class MetronBudgetCard extends MetronCard<BudgetCardConfig, BudgetData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .summary {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
      }

      .plot {
        position: relative;
      }

      .columns {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        border-bottom: 1px solid var(--m-line);
      }

      .columns span {
        flex: 1 1 0;
        border-radius: 2px 2px 0 0;
      }

      .limit {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-warn);
      }

      .limit span {
        position: absolute;
        bottom: 2px;
        left: 0;
        font-family: var(--m-mono);
        font-size: 10px;
        color: var(--m-warn);
      }

      .plot svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }

      .today {
        position: absolute;
        top: 0;
        bottom: 0;
        border-left: 1px dashed var(--m-text-2);
      }

      .today b {
        position: absolute;
        top: 0;
        left: 4px;
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 500;
        white-space: nowrap;
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.grid(
        form.number('budget', { min: 0, step: 1 }),
        form.select('metric', ['import', 'consumption', 'gas']),
      ),
      form.entities('gas', { domain: ['sensor'], deviceClass: ['gas'] }),
      form.number('height', { min: 60, max: 240, unit: 'px' }),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { budget: 300 };
  }

  protected parseConfig(raw: RawConfig): BudgetCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      budget: parsePrice(raw, 'budget'),
      metric: cfg.oneOf(raw, 'metric', ['import', 'consumption', 'gas'], 'import'),
      gas: cfg.entityIds(raw, 'gas'),
      height: cfg.number(raw, 'height', 120, { min: 60, max: 240 }),
    };
  }

  protected override trackedEntities(config: BudgetCardConfig): readonly (string | undefined)[] {
    return [typeof config.budget === 'string' ? config.budget : undefined];
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override async fetchData(
    config: BudgetCardConfig,
    hass: HomeAssistant,
  ): Promise<BudgetData> {
    const now = Date.now();
    const start = startOfMonth(now);
    const end = addMonths(start, 1);
    const days = daysInMonth(start);
    const starts = Array.from({ length: days }, (_, index) => addDays(start, index));
    const live = { hass, now };

    if (config.metric === 'gas') {
      const ids = await resolveGas(hass, config.gas, config.energy.energy_dashboard);
      const statistics =
        ids.length > 0
          ? await fetchStatistics(hass, {
              entityIds: ids,
              start: start - DAY,
              end,
              period: 'day',
              types: ['change', 'state'],
            })
          : (new Map() as StatisticsResult);

      return { start, days, daily: counterSeries(statistics, ids, starts, end, live, 'volume') };
    }

    const sources = await resolveSources(hass, config.energy);
    const statistics = await fetchEnergyStatistics(hass, sources, start - DAY, end, 'day');
    const series = energySeries(statistics, sources, starts, end, live);

    return { start, days, daily: config.metric === 'import' ? series.import : series.home };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, t, locale, now } = context;
    const title =
      config.title ?? t(TITLES[config.metric], { month: formatMonth(now, locale, true) });
    const budget = priceOf(hass, config.budget);

    if (budget === undefined || budget <= 0) {
      return html`${header(title)}
        <div class="empty">${t('budget.no_budget')}</div>`;
    }

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const unit = unitText(config.metric === 'gas' ? 'm³' : 'kWh', locale);
    const todayIndex = Math.floor((startOfDay(now) - data.start) / DAY);
    const elapsed = Math.max(0.5, (now - data.start) / DAY);
    const used = data.daily
      .slice(0, todayIndex + 1)
      .reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const pace = used / elapsed;
    const projected = pace * data.days;
    const left = Math.max(0, data.days - elapsed);
    const allowed = left > 0 ? Math.max(0, (budget - used) / left) : 0;
    const cut = pace > 0 && allowed < pace ? 1 - allowed / pace : 0;
    const crossDay = used >= budget ? elapsed : pace > 0 ? budget / pace : Number.POSITIVE_INFINITY;
    const over = (projected / budget - 1) * 100;

    return html`
      ${header(
        title,
        pill(
          t('budget.forecast_pill', { value: formatSigned(over, 0, locale) }),
          over > 0 ? 'warn' : 'ok',
        ),
      )}
      <div class="summary">
        <span
          ><span class="big">${formatNumber(used, 1, locale)}</span
          ><span class="unit">
            ${t('budget.of', { value: formatNumber(budget, 0, locale), unit })}</span
          ></span
        >
        <div class="side-list">
          <div class="side-row">
            <span>${t('budget.month_forecast')}</span
            ><span>≈ <b>${formatNumber(projected, 0, locale)}</b> ${unit}</span>
          </div>
          <div class="side-row">
            <span>${t('budget.runs_out')}</span
            ><span
              ><b style="color:${crossDay <= data.days ? 'var(--m-warn)' : 'var(--m-ok)'}"
                >${
                  crossDay <= data.days
                    ? `≈ ${formatDate(addDays(data.start, Math.max(0, Math.ceil(crossDay) - 1)), locale)}`
                    : t('budget.never')
                }</b
              ></span
            >
          </div>
        </div>
      </div>
      ${this._renderPlot(context, data, budget, used, pace, todayIndex)}
      ${stats([
        {
          label: t('budget.pace'),
          value: formatNumber(pace, 1, locale),
          unit: t('history.per_day'),
        },
        {
          label: t('budget.allowed'),
          value: `≤ ${formatNumber(allowed, 1, locale)}`,
          unit: t('history.per_day'),
        },
        {
          label: t('budget.cut'),
          value: `${formatNumber(cut * 100, 0, locale)} %`,
          tone: cut > 0 ? 'warn' : 'ok',
        },
      ])}
    `;
  }

  private _renderPlot(
    context: Context,
    data: BudgetData,
    budget: number,
    used: number,
    pace: number,
    todayIndex: number,
  ): TemplateResult {
    const { config, t, locale, now } = context;
    const height = config.height;
    const scale = Math.max(budget * 1.3, pace * data.days * 1.05);
    const px = (value: number): string =>
      `${Math.max(1, (Math.min(value, scale) / scale) * height).toFixed(1)}px`;
    let sum = 0;
    const columns = data.daily.map((value, index) => {
      if (index <= todayIndex) {
        sum += value ?? 0;

        return html`<span style="height:${px(sum)};background:var(--m-grid)"></span>`;
      }

      const projected = used + pace * (index - todayIndex);

      return html`<span
        style="height:${px(projected)};background:${HATCH(projected > budget ? 'var(--m-warn)' : 'var(--m-grid)')}"
      ></span>`;
    });
    const limitTop = height - (budget / scale) * height;
    const todayFraction = (now - data.start) / (data.days * DAY);

    return html`<div class="section" style="gap:6px">
      <div class="plot" style="height:${height}px">
        <div class="columns" style="height:${height}px">${columns}</div>
        <div class="limit" style="top:${limitTop.toFixed(1)}px">
          <span>${t('budget.limit', { value: formatNumber(budget, 0, locale) })}</span>
        </div>
        <svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line
            x1="0"
            y1=${height}
            x2="100"
            y2=${limitTop}
            style="stroke:var(--m-text-2);stroke-opacity:0.5"
            stroke-dasharray="2 4"
            vector-effect="non-scaling-stroke"
          ></line>
        </svg>
        ${
          todayFraction > 0 && todayFraction < 1
            ? html`<div class="today" style="left:${(todayFraction * 100).toFixed(1)}%">
                <b>${formatDate(now, locale)}</b>
              </div>`
            : nothing
        }
      </div>
      ${axis(
        [
          { at: 0.5 / data.days, label: '1' },
          {
            at: (todayIndex + 0.5) / data.days,
            label: String(todayIndex + 1),
            color: 'var(--m-text)',
          },
          { at: (data.days - 0.5) / data.days, label: String(data.days) },
        ].filter(
          (tick, index, ticks) => index === 1 || Math.abs(tick.at - (ticks[1]?.at ?? 0)) > 0.08,
        ),
      )}
    </div>`;
  }
}
