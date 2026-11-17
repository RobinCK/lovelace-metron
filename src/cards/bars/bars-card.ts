import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { bucketize, changeOf, fetchStatistics } from '../../core/data/statistics';
import type { StatisticRow } from '../../core/data/statistics';
import { attribute, deviceClass, entityName, readNumber } from '../../core/entities';
import type { Quantity } from '../../core/entities';
import {
  autoDigits,
  formatDate,
  formatMonth,
  formatNumber,
  formatSigned,
  formatTime,
  unitText,
} from '../../core/format';
import type { Formatted } from '../../core/format';
import { niceMax } from '../../core/math';
import type { CardSize, SizeSetting } from '../../core/size';
import { addDays, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { barChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, colorOf, navigator, pill } from '../../ui/parts';
import type { Tick } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { tipValue } from '../../ui/tip';
import type { Tip } from '../../ui/tip';
import { tailOf, total } from '../shared/energy-sources';
import type { Series } from '../shared/energy-sources';
import { BAR_PERIODS, barWindow, currentIndex } from './windows';
import type { BarPeriod, BarWindow } from './windows';

export interface BarsCardConfig extends BaseConfig {
  readonly entity?: string;
  readonly period: BarPeriod;
  readonly weeks: number;
  readonly color?: string;
  readonly unit?: string;
  readonly digits?: number;
  readonly navigation: boolean;
  readonly compare: boolean;
  readonly height: number;
}

interface BarsData {
  readonly start: number;
  readonly values: Series;
  readonly previous?: number;
}

type Context = CardContext<BarsCardConfig, BarsData>;

const DEFAULT_COLORS: Readonly<Record<string, string>> = {
  gas: 'var(--m-gas)',
  energy: 'var(--m-home)',
  water: 'var(--m-cold)',
};

const quantityOf = (hass: HomeAssistant, entityId: string | undefined): Quantity =>
  deviceClass(hass, entityId) === 'energy' ? 'energy' : 'raw';

const rowsBefore = (rows: readonly StatisticRow[] | undefined, end: number): number | undefined => {
  const values = (rows ?? [])
    .filter((row) => row.start < end)
    .map(changeOf)
    .filter((value): value is number => value !== null && value !== undefined);

  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0);
};

const withTail = (values: Series, index: number, tail: number): Series =>
  index < 0 || tail <= 0
    ? values
    : values.map((value, position) => (position === index ? (value ?? 0) + tail : value));

export class MetronBarsCard extends MetronCard<BarsCardConfig, BarsData> {
  static override maxSize: CardSize = 'large';

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

      .top .eyebrow {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        cursor: pointer;
      }

      .bars {
        position: relative;
      }

      .avg {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-muted);
        pointer-events: none;
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

  static override configForm(): ConfigForm {
    return form.createForm([
      form.entity('entity', { domain: ['sensor'] }, true),
      form.grid(form.select('period', BAR_PERIODS), form.number('weeks', { min: 2, max: 52 })),
      form.grid(form.text('color'), form.text('unit')),
      form.grid(form.number('digits', { min: 0, max: 3 }), form.toggle('navigation')),
      form.grid(form.toggle('compare'), form.number('height', { min: 60, max: 320, unit: 'px' })),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { period: 'day' };
  }

  protected parseConfig(raw: RawConfig): BarsCardConfig {
    const digits = cfg.optionalNumber(raw, 'digits');

    return {
      ...cfg.base(raw),
      entity: cfg.entity(raw, 'entity'),
      period: cfg.oneOf(raw, 'period', BAR_PERIODS, 'day'),
      weeks: Math.round(cfg.number(raw, 'weeks', 13, { min: 2, max: 52 })),
      color: cfg.text(raw, 'color'),
      unit: cfg.text(raw, 'unit'),
      digits: digits === undefined ? undefined : Math.min(3, Math.max(0, Math.round(digits))),
      navigation: cfg.boolean(raw, 'navigation', true),
      compare: cfg.boolean(raw, 'compare', true),
      height: cfg.number(raw, 'height', 140, { min: 60, max: 320 }),
    };
  }

  protected override missingOption(config: BarsCardConfig): string | undefined {
    return config.entity ? undefined : 'entity';
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override defaultSize(): SizeSetting {
    return 'medium';
  }

  protected override trackedEntities(config: BarsCardConfig): readonly (string | undefined)[] {
    return [config.entity];
  }

  protected override async fetchData(
    config: BarsCardConfig,
    hass: HomeAssistant,
  ): Promise<BarsData> {
    const entityId = config.entity ?? '';
    const now = Date.now();
    const window = barWindow(config.period, now, this._offset, config.weeks);
    const previous = barWindow(config.period, now, this._offset - 1, config.weeks);
    const request = { entityIds: [entityId], period: config.period, units: { energy: 'kWh' } };
    const [current, before] = await Promise.all([
      fetchStatistics(hass, {
        ...request,
        start: window.start,
        end: window.end,
        types: ['change', 'state'],
      }),
      config.compare
        ? fetchStatistics(hass, {
            ...request,
            start: previous.start,
            end: previous.end,
            types: ['change'],
          })
        : Promise.resolve(undefined),
    ]);
    const rows = current.get(entityId);
    const index = currentIndex(window, now);
    const tail =
      index < 0 ? 0 : tailOf(rows, readNumber(hass, entityId, quantityOf(hass, entityId)));
    const elapsed = index < 0 ? previous.end : previous.start + (now - window.start);

    return {
      start: window.start,
      values: withTail(bucketize(rows, window.starts, changeOf, 'sum', window.end), index, tail),
      previous: before ? rowsBefore(before.get(entityId), elapsed) : undefined,
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, now } = context;
    const window = barWindow(config.period, now, this._offset, config.weeks);
    const ready = data?.start === window.start;

    return html`
      <div class="top">
        <span class="eyebrow">${this._title(context)}</span>
        ${config.navigation ? this._renderNavigator(context, window) : nothing}
      </div>
      ${
        ready
          ? this._renderContent(context, window, data)
          : html`<div class="empty">${t('common.loading')}</div>`
      }
    `;
  }

  private _title(context: Context): string {
    const { config, hass, t } = context;

    if (config.title !== undefined && config.title !== false) return config.title;

    return `${entityName(hass, config.entity)} · ${t(`bars.by_${config.period}`)}`;
  }

  private _unit(context: Context): string {
    const { config, hass, locale } = context;

    if (config.unit) return config.unit;
    if (quantityOf(hass, config.entity) === 'energy') return unitText('kWh', locale);

    const unit = attribute<string>(hass, config.entity, 'unit_of_measurement');

    return typeof unit === 'string' ? unitText(unit, locale) : '';
  }

  private _format(context: Context, value: number | undefined, small = false): Formatted {
    const digits = context.config.digits ?? (value === undefined ? 0 : autoDigits(value));

    return {
      value: formatNumber(value, small ? Math.min(digits, 1) : digits, context.locale),
      unit: this._unit(context),
    };
  }

  private _color(context: Context): string {
    const { config, hass } = context;

    if (config.color) return colorOf(config.color);

    return DEFAULT_COLORS[deviceClass(hass, config.entity) ?? ''] ?? 'var(--m-grid)';
  }

  private _windowLabel(context: Context, window: BarWindow): string {
    const { config, locale } = context;

    if (config.period === 'hour') {
      return formatDate(window.start, locale, { weekday: 'short', day: 'numeric', month: 'short' });
    }

    if (config.period === 'day') {
      return formatDate(window.start, locale, { month: 'long', year: 'numeric' });
    }

    if (config.period === 'week') {
      return `${formatDate(window.start, locale)} – ${formatDate(window.end - DAY, locale)}`;
    }

    return formatDate(window.start, locale, { year: 'numeric' });
  }

  private _renderNavigator(context: Context, window: BarWindow): TemplateResult {
    const { t } = context;

    return navigator({
      label: this._windowLabel(context, window),
      previousLabel: t('bars.previous'),
      nextLabel: t('bars.next'),
      resetLabel: t('bars.current'),
      canNext: this._offset < 0,
      previous: () => {
        this._shift(-1);
      },
      next: () => {
        this._shift(1);
      },
      reset: () => {
        this._offset = 0;
        this.reload();
      },
    });
  }

  private _shift(delta: number): void {
    this._offset = Math.min(0, this._offset + delta);
    this.reload();
  }

  private _comparison(context: Context, window: BarWindow): string {
    const { config, locale, now, t } = context;
    const previous = barWindow(config.period, now, this._offset - 1, config.weeks);

    if (config.period === 'hour') return formatDate(previous.start, locale);
    if (config.period === 'day') return formatMonth(previous.start, locale, true);
    if (config.period === 'week') return t('bars.previous_weeks', { count: String(config.weeks) });

    return formatDate(window.start - DAY, locale, { year: 'numeric' });
  }

  private _renderContent(context: Context, window: BarWindow, data: BarsData): TemplateResult {
    const { config, size, t, locale, now, moreInfo } = context;
    const small = size === 'small';
    const index = currentIndex(window, now);
    const complete = data.values.filter((_, position) => index < 0 || position < index);
    const known = complete.filter((value): value is number => value !== undefined);
    const sum = total(data.values);
    const average = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : undefined;
    const maxValue = known.length > 0 ? Math.max(...known) : undefined;
    const maxIndex = maxValue === undefined ? -1 : data.values.indexOf(maxValue);
    const change =
      sum !== undefined && data.previous
        ? ((sum - data.previous) / data.previous) * 100
        : undefined;
    const formatted = this._format(context, sum);
    const values = data.values.map((value) => value ?? 0);
    const scale = niceMax(Math.max(0.1, ...values));
    const height = small ? 18 : size === 'medium' ? 156 : size === 'large' ? 300 : config.height;
    const color = this._color(context);
    const perBar = t(`bars.per_${config.period}`);

    return html`
      <div class="summary">
        <div
          class="total"
          @click=${() => {
            moreInfo(config.entity);
          }}
        >
          <span
            ><span class="big">${formatted.value}</span
            ><span class="unit"> ${formatted.unit}</span></span
          >
          ${
            change === undefined || !config.compare
              ? nothing
              : pill(
                  t('bars.vs', {
                    value: `${formatSigned(change, 0, locale)} %`,
                    label: this._comparison(context, window),
                  }),
                  change <= 0 ? 'ok' : 'warn',
                  false,
                )
          }
        </div>
        ${
          small
            ? nothing
            : html`<div class="side-list">
                <div class="side-row">
                  <span>${t('history.average')}</span
                  ><span
                    ><b>${this._format(context, average, true).value}</b>
                    ${formatted.unit}${perBar}</span
                  >
                </div>
                ${
                  maxValue === undefined
                    ? nothing
                    : html`<div class="side-row">
                        <span>${t('common.max')}</span
                        ><span
                          ><b>${this._format(context, maxValue, true).value}</b> ·
                          ${this._barLabel(context, window.starts[maxIndex] ?? window.start)}</span
                        >
                      </div>`
                }
              </div>`
        }
      </div>
      <div class="section shrink" style="gap:6px">
        <div class="bars shrink">
          ${barChart(
            [
              {
                values: data.values,
                color,
                opacity: (position: number) => (position === index ? 0.55 : 1),
              },
            ],
            {
              height,
              fill: small ? 10 : Math.round(height * 0.7),
              max: scale,
              gap: 3,
              radius: 2,
              label: t('bars.chart_label'),
              tip: (position) => this._tip(context, window, data, position, color),
            },
          )}
          ${
            average === undefined || small
              ? nothing
              : html`<div class="avg" style="top:${((1 - average / scale) * 100).toFixed(1)}%">
                  <span
                    >${t('history.avg_short', { value: this._format(context, average, true).value })}</span
                  >
                </div>`
          }
        </div>
        ${small ? nothing : axis(this._ticks(context, window, index))}
      </div>
    `;
  }

  private _barLabel(context: Context, start: number): string {
    const { config, locale } = context;

    if (config.period === 'hour') return formatTime(start, locale);
    if (config.period === 'day') return formatDate(start, locale);
    if (config.period === 'week') return formatDate(start, locale);

    return formatMonth(start, locale);
  }

  private _ticks(context: Context, window: BarWindow, current: number): Tick[] {
    const { config, locale } = context;
    const count = window.starts.length;

    if (config.period === 'hour') {
      return [0, 6, 12, 18, 24].map((hour) => ({
        at: Math.min(1, (hour * HOUR) / (window.end - window.start)),
        label: String(hour).padStart(2, '0'),
      }));
    }

    const step = config.period === 'day' ? 7 : config.period === 'week' ? 4 : 3;
    const positions = new Set<number>();

    const keep = (anchor: number): void => {
      [...positions].forEach((position) => {
        if (position !== anchor && Math.abs(position - anchor) < 2) positions.delete(position);
      });
      positions.add(anchor);
    };

    for (let position = 0; position < count; position += step) positions.add(position);

    if (config.period === 'day') keep(count - 1);
    if (current >= 0) keep(current);

    return [...positions]
      .sort((a, b) => a - b)
      .map((position) => {
        const start = window.starts[position] ?? window.start;

        return {
          at: (position + 0.5) / count,
          label:
            config.period === 'day'
              ? String(new Date(start).getDate())
              : config.period === 'week'
                ? formatDate(start, locale)
                : formatMonth(start, locale),
          color: position === current ? 'var(--m-text)' : undefined,
        };
      });
  }

  private _tip(
    context: Context,
    window: BarWindow,
    data: BarsData,
    position: number,
    color: string,
  ): Tip | undefined {
    const { config, hass, locale } = context;
    const value = data.values[position];
    const start = window.starts[position];

    if (value === undefined || start === undefined) return undefined;

    const title =
      config.period === 'hour'
        ? `${formatTime(start, locale)}–${formatTime(start + HOUR, locale)}`
        : config.period === 'day'
          ? formatDate(start, locale, { weekday: 'short', day: 'numeric', month: 'short' })
          : config.period === 'week'
            ? `${formatDate(start, locale)} – ${formatDate(startOfDay(addDays(start, 6)), locale)}`
            : formatDate(start, locale, { month: 'long', year: 'numeric' });

    return {
      title,
      rows: [
        {
          label: entityName(hass, config.entity),
          value: tipValue(this._format(context, value)),
          color,
        },
      ],
    };
  }
}
