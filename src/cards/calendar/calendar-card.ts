import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { DAY } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { overlap } from '../../core/data/history';
import type { Interval } from '../../core/data/history';
import { formatDate, formatMonth, formatNumber, formatWeekday, unitText } from '../../core/format';
import type { TranslationKey } from '../../core/i18n';
import {
  addDays,
  addMonths,
  firstWeekday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { ring } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { navigator, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { elementHover } from '../../ui/tip';
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
import type { Balance, EnergyConfig, EnergySeries } from '../shared/energy-sources';
import { fetchOutages } from '../shared/outages';

export const CALENDAR_METRICS = [
  'self_sufficiency',
  'self_consumption',
  'solar',
  'home',
  'import',
  'export',
] as const;

export type CalendarMetric = (typeof CALENDAR_METRICS)[number];

export interface CalendarCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly metric: CalendarMetric;
  readonly grid_status?: string;
  readonly invert_grid_status: boolean;
  readonly high: number;
  readonly low: number;
  readonly navigation: boolean;
}

interface CalendarData {
  readonly month: number;
  readonly gridStart: number;
  readonly series: EnergySeries;
  readonly outages: readonly Interval[];
  readonly empty: boolean;
}

type Context = CardContext<CalendarCardConfig, CalendarData>;

const PERCENT_METRICS = new Set<CalendarMetric>(['self_sufficiency', 'self_consumption']);

const TITLES: Readonly<Record<CalendarMetric, TranslationKey>> = {
  self_sufficiency: 'calendar.self_sufficiency',
  self_consumption: 'calendar.self_consumption',
  solar: 'calendar.solar',
  home: 'calendar.home',
  import: 'calendar.import',
  export: 'calendar.export',
};

const METRIC_COLORS: Readonly<Record<CalendarMetric, string>> = {
  self_sufficiency: 'var(--m-ok)',
  self_consumption: 'var(--m-ok)',
  solar: 'var(--m-solar)',
  home: 'var(--m-home)',
  import: 'var(--m-grid)',
  export: 'var(--m-battery)',
};

const balanceAt = (series: EnergySeries, index: number): Balance => ({
  solar: series.solar[index],
  home: series.home[index],
  import: series.import[index],
  export: series.export[index],
  charge: series.charge[index],
  discharge: series.discharge[index],
});

const metricValue = (metric: CalendarMetric, balance: Balance): number | undefined => {
  if (metric === 'self_sufficiency') return selfSufficiency(balance);
  if (metric === 'self_consumption') return selfConsumption(balance);

  return balance[metric];
};

export class MetronCalendarCard extends MetronCard<CalendarCardConfig, CalendarData> {
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

      .days {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 4px;
      }

      .weekday {
        font-size: 10px;
        text-align: center;
        color: var(--m-muted);
      }

      .day {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 4px 0;
        border-radius: 10px;
      }

      .day.today {
        background: var(--m-panel);
      }

      .day.other {
        opacity: 0.4;
      }

      .dial {
        position: relative;
        width: var(--ring, 36px);
        height: var(--ring, 36px);
      }

      .compact .day {
        padding: 2px 0;
      }

      .compact .dial b {
        font-size: 11px;
      }

      .dial b {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--m-mono);
        font-size: 12px;
        font-weight: 600;
      }

      .dial.unknown b {
        color: var(--m-muted);
      }

      .pct {
        min-height: 12px;
        font-family: var(--m-mono);
        font-size: 9px;
        color: var(--m-muted);
      }

      .mark {
        position: absolute;
        top: 4px;
        right: 6px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--m-warn);
      }

      .legend i.hollow {
        background: none;
        box-shadow: inset 0 0 0 1.5px var(--m-warn);
      }
    `,
  ];

  declare _offset: number;

  constructor() {
    super();
    this._offset = 0;
  }

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(form.select('metric', [...CALENDAR_METRICS]), form.toggle('navigation')),
      form.grid(
        form.number('high', { min: 0, max: 100, unit: '%' }),
        form.number('low', { min: 0, max: 100, unit: '%' }),
      ),
      form.grid(
        form.entity('grid_status', {
          domain: ['binary_sensor', 'sensor', 'switch', 'input_boolean'],
        }),
        form.toggle('invert_grid_status'),
      ),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): CalendarCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      metric: cfg.oneOf(raw, 'metric', CALENDAR_METRICS, 'self_sufficiency'),
      grid_status: cfg.entity(raw, 'grid_status'),
      invert_grid_status: cfg.boolean(raw, 'invert_grid_status', false),
      high: cfg.number(raw, 'high', 70, { min: 0, max: 100 }),
      low: cfg.number(raw, 'low', 40, { min: 0, max: 100 }),
      navigation: cfg.boolean(raw, 'navigation', true),
    };
  }

  protected override cardSize(): number {
    return 7;
  }

  protected override defaultSize(): SizeSetting {
    return 'large';
  }

  protected override async fetchData(
    config: CalendarCardConfig,
    hass: HomeAssistant,
  ): Promise<CalendarData> {
    const now = Date.now();
    const month = addMonths(startOfMonth(now), this._offset);
    const gridStart = startOfWeek(month, firstWeekday(hass.locale));
    const end = addMonths(month, 1);
    const sources = await resolveSources(hass, config.energy);
    const starts = Array.from({ length: Math.round((end - gridStart) / DAY) + 1 }, (_, index) =>
      addDays(gridStart, index),
    ).filter((start) => start < end);
    const [statistics, outages] = await Promise.all([
      fetchEnergyStatistics(hass, sources, gridStart - DAY, end, 'day'),
      fetchOutages(
        hass,
        config.grid_status,
        config.invert_grid_status,
        gridStart,
        Math.min(end, now),
      ),
    ]);

    return {
      month,
      gridStart,
      series: energySeries(statistics, sources, starts, end, { hass, now }),
      outages,
      empty: !hasSources(sources),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale, now } = context;
    const selected = addMonths(startOfMonth(now), this._offset);
    const ready = data?.month === selected;

    if (data?.empty) return html`<div class="empty">${t('energy.no_sources')}</div>`;

    const title =
      config.title === undefined || config.title === false
        ? t(TITLES[config.metric])
        : config.title;
    const label = `${formatMonth(selected, locale, true)} ${new Date(selected).getFullYear()}`;

    return html`
      <div class="top">
        <span class="eyebrow">${title}</span>
        ${
          config.navigation
            ? navigator({
                label,
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
            : html`<span class="meta">${label}</span>`
        }
      </div>
      ${ready ? this._renderMonth(context, data) : html`<div class="empty">${t('common.loading')}</div>`}
    `;
  }

  private _shift(delta: number): void {
    this._offset = Math.min(0, this._offset + delta);
    this.reload();
  }

  private _color(config: CalendarCardConfig, value: number | undefined): string {
    if (!PERCENT_METRICS.has(config.metric)) return METRIC_COLORS[config.metric];

    const percent = (value ?? 0) * 100;

    if (percent >= config.high) return 'var(--m-ok)';
    if (percent >= config.low) return 'var(--m-solar)';

    return 'var(--m-grid)';
  }

  private _renderMonth(context: Context, data: CalendarData): TemplateResult {
    const { config, locale, now, size, t } = context;
    const ringSize = size === 'medium' ? 24 : 36;
    const showText = size !== 'medium';
    const percent = PERCENT_METRICS.has(config.metric);
    const count = data.series.home.length;
    const values = Array.from({ length: count }, (_, index) =>
      metricValue(config.metric, balanceAt(data.series, index)),
    );
    const monthEnd = addMonths(data.month, 1);
    const max = Math.max(0, ...values.filter((value): value is number => value !== undefined));
    const today = startOfDay(now);
    const cells = Math.ceil(count / 7) * 7;
    const focus = Math.min(
      Math.max(0, Math.floor((startOfDay(now) - data.gridStart) / DAY)),
      count - 1,
    );
    const firstCell = size === 'small' ? Math.floor(focus / 7) * 7 : 0;
    const lastCell = size === 'small' ? firstCell + 7 : cells;
    const weekdays = Array.from({ length: 7 }, (_, index) =>
      formatWeekday(addDays(data.gridStart, index), locale),
    );

    return html`
      <div class="days ${size === 'medium' ? 'compact' : ''}" style="--ring:${ringSize}px">
        ${weekdays.map((day) => html`<span class="weekday">${day}</span>`)}
        ${Array.from({ length: lastCell - firstCell }, (_, offset) => {
          const index = firstCell + offset;
          const start = addDays(data.gridStart, index);

          if (index >= count || start >= monthEnd) return html`<span></span>`;

          const value = values[index];
          const future = start > now;
          const fraction =
            value === undefined ? undefined : percent ? value : max > 0 ? value / max : 0;
          const outage = overlap(data.outages, start, addDays(start, 1)) > 0;
          const isToday = start === today;
          const text =
            value === undefined || future
              ? ''
              : percent
                ? `${formatNumber(value * 100, 0, locale)} %${isToday ? '…' : ''}`
                : formatNumber(value, value >= 100 ? 0 : 1, locale);

          const hover = elementHover(() => ({
            title: formatDate(start, locale, { weekday: 'short', day: 'numeric', month: 'long' }),
            rows: [
              {
                label: t(TITLES[config.metric]),
                value:
                  future || text === ''
                    ? '—'
                    : percent
                      ? text
                      : `${text} ${unitText('kWh', locale)}`,
                color: this._color(config, value),
              },
              ...(outage
                ? [{ label: t('calendar.outage'), value: '', color: 'var(--m-warn)' }]
                : []),
            ],
          }));

          return html`<div
            class="day ${isToday ? 'today' : ''} ${start < data.month ? 'other' : ''}"
            @pointermove=${hover.move}
            @pointerdown=${hover.move}
            @pointerleave=${hover.leave}
          >
            ${outage ? html`<span class="mark"></span>` : nothing}
            <div class="dial ${value === undefined ? 'unknown' : ''}">
              ${ring(future ? undefined : fraction, this._color(config, value), ringSize, ringSize > 30 ? 4 : 3)}
              <b>${new Date(start).getDate()}</b>
            </div>
            ${showText ? html`<span class="pct">${text}</span>` : nothing}
          </div>`;
        })}
      </div>
      ${size === 'auto' || size === 'large' ? this._renderLegend(context) : nothing}
      ${size === 'small' ? nothing : stats(this._summary(context, data, values))}
    `;
  }

  private _renderLegend(context: Context): TemplateResult | typeof nothing {
    const { config, t } = context;
    const items: TemplateResult[] = [];

    if (PERCENT_METRICS.has(config.metric)) {
      items.push(
        html`<span><i style="--c:var(--m-ok);border-radius:50%"></i>≥ ${config.high} %</span>`,
        html`<span
          ><i style="--c:var(--m-solar);border-radius:50%"></i>${config.low}–${config.high} %</span
        >`,
        html`<span><i style="--c:var(--m-grid);border-radius:50%"></i>&lt; ${config.low} %</span>`,
      );
    }

    if (config.grid_status) {
      items.push(
        html`<span
          ><i style="--c:var(--m-warn);border-radius:50%"></i>${t('calendar.outage')}</span
        >`,
      );
    }

    return items.length > 0 ? html`<div class="legend" data-drop="1">${items}</div>` : nothing;
  }

  private _summary(
    context: Context,
    data: CalendarData,
    values: readonly (number | undefined)[],
  ): StatItem[] {
    const { config, t, locale, now } = context;
    const percent = PERCENT_METRICS.has(config.metric);
    const today = startOfDay(now);
    const monthEnd = addMonths(data.month, 1);
    const inMonth = values
      .map((value, index) => ({ value, start: addDays(data.gridStart, index) }))
      .filter((item) => item.start >= data.month && item.start < monthEnd);
    const complete = inMonth.filter(
      (item): item is { value: number; start: number } =>
        item.value !== undefined && item.start < today,
    );
    const best = complete.reduce<{ value: number; start: number } | undefined>(
      (found, item) => (!found || item.value > found.value ? item : found),
      undefined,
    );
    const items: StatItem[] = [];
    const firstIndex = Math.round((data.month - data.gridStart) / DAY);
    const slice = (key: keyof EnergySeries): (number | undefined)[] =>
      data.series[key].slice(firstIndex, firstIndex + inMonth.length);
    const month = balanceOf({
      solar: slice('solar'),
      home: slice('home'),
      import: slice('import'),
      export: slice('export'),
      charge: slice('charge'),
      discharge: slice('discharge'),
    });
    const monthValue = metricValue(config.metric, month);
    const unit = percent ? '%' : unitText('kWh', locale);

    items.push({
      label: percent ? t('calendar.month') : t('calendar.month_total'),
      value: formatNumber(
        monthValue === undefined ? undefined : percent ? monthValue * 100 : monthValue,
        percent ? 0 : 1,
        locale,
      ),
      unit,
    });

    if (best) {
      items.push({
        label: t('calendar.best'),
        value: formatNumber(percent ? best.value * 100 : best.value, percent ? 0 : 1, locale),
        unit,
        tone: 'ok',
        sub: formatDate(best.start, locale),
      });
    }

    if (config.grid_status) {
      const days = inMonth.filter(
        (item) =>
          item.start <= now && overlap(data.outages, item.start, addDays(item.start, 1)) > 0,
      ).length;

      items.push({
        label: t('calendar.outage_days'),
        value: String(days),
        tone: days > 0 ? 'warn' : 'ok',
      });
    }

    return items;
  }
}
