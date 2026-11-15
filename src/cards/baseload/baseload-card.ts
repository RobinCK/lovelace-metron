import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { entityName } from '../../core/entities';
import { formatDate, formatMoney, formatNumber, formatSigned, unitText } from '../../core/format';
import { median } from '../../core/math';
import { addDays, parseClock, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { colorOf, header, pill } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { DASHBOARD_ENERGY } from '../shared/energy-sources';
import type { EnergyConfig } from '../shared/energy-sources';
import { fetchHourlyLoad, inWindow } from '../shared/hourly';
import { currencyOf, parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';
import { detectStep } from './baseload';

export interface BaseLoad {
  readonly entity: string;
  readonly name?: string;
  readonly color?: string;
}

export interface BaseloadCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly entity?: string;
  readonly days: number;
  readonly night_start: number;
  readonly night_end: number;
  readonly loads: readonly BaseLoad[];
  readonly price?: Price;
  readonly currency?: string;
  readonly step_threshold: number;
}

interface BaseloadData {
  readonly start: number;
  readonly minima: readonly (number | undefined)[];
  readonly loads: readonly (number | undefined)[];
}

type Context = CardContext<BaseloadCardConfig, BaseloadData>;

const CHART_HEIGHT = 80;

export class MetronBaseloadCard extends MetronCard<BaseloadCardConfig, BaseloadData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .summary {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
      }

      .summary > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .summary > div:last-child {
        align-items: flex-end;
        font-size: 11px;
        color: var(--m-muted);
      }

      .summary > div:last-child b {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 500;
        color: var(--m-text);
      }

      .plot {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 4px 6px;
      }

      .scale {
        position: relative;
        font-family: var(--m-mono);
        font-size: 9px;
        color: var(--m-muted);
      }

      .scale span {
        position: absolute;
        right: 0;
        transform: translateY(-50%);
      }

      .area {
        position: relative;
        height: ${CHART_HEIGHT}px;
        border-radius: 6px;
        background: var(--m-panel);
      }

      .dot {
        position: absolute;
        width: 6px;
        height: 6px;
        margin: -3px 0 0 -3px;
        border-radius: 50%;
        background: var(--m-home);
      }

      .level {
        position: absolute;
        height: 0;
        border-top: 2px solid var(--c);
      }

      .level span {
        position: absolute;
        top: -16px;
        left: 6px;
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
        color: var(--c);
      }

      .breakdown {
        display: flex;
        gap: 2px;
        height: 8px;
        overflow: hidden;
        border-radius: 4px;
      }

      .loads {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 18px;
        font-size: 13px;
      }

      .loads span {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }

      .loads span i {
        flex-shrink: 0;
        width: 6px;
        height: 6px;
        margin-right: 6px;
        border-radius: 50%;
        background: var(--c);
      }

      .loads span em {
        overflow: hidden;
        font-style: normal;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .loads b {
        font-family: var(--m-mono);
        font-weight: 500;
        white-space: nowrap;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.consumptionEntity(),
      form.grid(
        form.number('days', { min: 7, max: 90 }),
        form.number('step_threshold', { min: 5, unit: 'W' }),
      ),
      form.grid(form.time('night_start'), form.time('night_end')),
      form.list('loads', {
        entity: {
          selector: { entity: { filter: { domain: 'sensor', device_class: 'power' } } },
          required: true,
        },
        name: { selector: { text: {} } },
        color: { selector: { text: {} } },
      }),
      form.grid(form.number('price', { min: 0, step: 0.01 }), form.text('currency')),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): BaseloadCardConfig {
    return {
      ...cfg.base(raw),
      energy: DASHBOARD_ENERGY,
      entity: cfg.entity(raw, 'entity'),
      days: cfg.number(raw, 'days', 30, { min: 7, max: 90 }),
      night_start: Math.floor(parseClock(cfg.text(raw, 'night_start'), 60) / 60),
      night_end: Math.ceil(parseClock(cfg.text(raw, 'night_end'), 300) / 60),
      loads: cfg.entityItems(raw, 'loads'),
      price: parsePrice(raw, 'price'),
      currency: cfg.text(raw, 'currency'),
      step_threshold: cfg.number(raw, 'step_threshold', 40, { min: 5 }),
    };
  }

  protected override cardSize(): number {
    return 6;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: BaseloadCardConfig,
    hass: HomeAssistant,
  ): Promise<BaseloadData> {
    const end = startOfDay(Date.now());
    const start = addDays(end, -config.days);
    const [samples, loads] = await Promise.all([
      fetchHourlyLoad(hass, config.entity, config.energy, start, end),
      config.loads.length > 0
        ? fetchStatistics(hass, {
            entityIds: config.loads.map((load) => load.entity),
            start: addDays(end, -14),
            end,
            period: 'hour',
            types: ['mean'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
    ]);
    const minima = Array.from({ length: config.days }, (_, index) => {
      const dayStart = addDays(start, index);
      const night = samples.filter(
        (sample) =>
          sample.time >= dayStart &&
          sample.time < addDays(dayStart, 1) &&
          inWindow(new Date(sample.time).getHours(), config.night_start, config.night_end),
      );

      return night.length === 0
        ? undefined
        : Math.min(...night.map((sample) => sample.value)) * 1000;
    });

    return {
      start,
      minima,
      loads: config.loads.map((load) => {
        const rows = loads.get(load.entity) ?? [];
        const values = rows
          .filter((row) =>
            inWindow(new Date(row.start).getHours(), config.night_start, config.night_end),
          )
          .map((row) => row.mean)
          .filter((value): value is number => value !== null && value !== undefined);

        return median(values);
      }),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, t, locale } = context;
    const title = config.title ?? t('baseload.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const recent = data.minima.slice(-14).filter((value): value is number => value !== undefined);
    const base = median(recent);
    const step = detectStep(data.minima, 5, config.step_threshold);
    const price = priceOf(hass, config.price);
    const currency = currencyOf(hass, config.currency);
    const daily = base === undefined ? undefined : (base * 24) / 1000;
    const w = unitText('W', locale);

    return html`
      ${header(
        title,
        step
          ? pill(
              t('baseload.step', {
                value: `${formatSigned(step.after - step.before, 0, locale)} ${w}`,
                date: formatDate(addDays(data.start, step.index), locale),
              }),
              step.after > step.before ? 'solar' : 'ok',
            )
          : nothing,
      )}
      <div class="summary">
        <div>
          <span class="label">${t('baseload.night_minimum')}</span>
          <span
            ><span class="big">${formatNumber(base, 0, locale)}</span
            ><span class="unit"> ${w}</span></span
          >
        </div>
        <div>
          <span
            >≈
            <b>${formatNumber(daily, 1, locale)}</b>
            ${unitText('kWh', locale)}${t('history.per_day')}</span
          >
          <span
            >≈
            <b
              >${formatNumber(daily === undefined ? undefined : (daily * 365) / 1000, 1, locale)}</b
            >
            ${unitText('MWh', locale)}${t('baseload.per_year')}</span
          >
          ${
            price === undefined || daily === undefined
              ? nothing
              : html`<span
                  >≈
                  <b>${formatMoney(daily * 365 * price, locale, currency)}</b>
                  ${t('baseload.a_year')}</span
                >`
          }
        </div>
      </div>
      ${this._renderChart(context, data, step)} ${this._renderBreakdown(context, data, base)}
    `;
  }

  private _renderChart(
    context: Context,
    data: BaseloadData,
    step: ReturnType<typeof detectStep>,
  ): TemplateResult {
    const { t, locale } = context;
    const known = data.minima.filter((value): value is number => value !== undefined);

    if (known.length === 0) return html`<div class="empty">${t('common.no_data')}</div>`;

    const low = Math.floor((Math.min(...known) * 0.9) / 50) * 50;
    const high = Math.ceil((Math.max(...known) * 1.1) / 50) * 50;
    const y = (value: number): number => ((high - value) / (high - low || 1)) * CHART_HEIGHT;
    const count = data.minima.length;
    const level = (
      from: number,
      to: number,
      value: number,
      color: string,
      label?: string,
    ): TemplateResult =>
      html`<div
        class="level"
        style="--c:${color};left:${((from / count) * 100).toFixed(1)}%;width:${(((to - from) / count) * 100).toFixed(1)}%;top:${y(value).toFixed(1)}px"
      >
        ${label ? html`<span>${label}</span>` : nothing}
      </div>`;

    return html`<div class="plot">
      <div class="scale">
        <span style="top:0">${formatNumber(high, 0, locale)}</span>
        <span style="top:50%">${formatNumber((high + low) / 2, 0, locale)}</span>
        <span style="top:100%">${formatNumber(low, 0, locale)}</span>
      </div>
      <div class="area">
        ${
          step
            ? html`${level(0, step.index, step.before, 'var(--m-muted)')}
              ${level(step.index, count, step.after, 'var(--m-solar)', `${formatSigned(step.after - step.before, 0, locale)} ${unitText('W', locale)}`)}`
            : nothing
        }
        ${data.minima.map((value, index) =>
          value === undefined
            ? nothing
            : html`<span
                class="dot"
                style="left:${(((index + 0.5) / count) * 100).toFixed(2)}%;top:${y(value).toFixed(1)}px"
              ></span>`,
        )}
      </div>
      <span class="scale" style="font-size:9px">${unitText('W', locale)}</span>
      <div class="axis">
        <span class="first" style="left:0">${formatDate(data.start, locale)}</span>
        <span style="left:50%"
          >${formatDate(addDays(data.start, Math.floor(count / 2)), locale)}</span
        >
        <span class="last" style="left:100%"
          >${formatDate(addDays(data.start, count - 1), locale)}</span
        >
      </div>
    </div>`;
  }

  private _renderBreakdown(
    context: Context,
    data: BaseloadData,
    base: number | undefined,
  ): TemplateResult | typeof nothing {
    const { config, hass, t, locale } = context;

    if (config.loads.length === 0 || base === undefined) return nothing;

    const known = data.loads.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const unknown = Math.max(0, base - known);
    const w = unitText('W', locale);
    const price = priceOf(hass, config.price);
    const color = (index: number, load: BaseLoad): string =>
      load.color
        ? colorOf(load.color)
        : `color-mix(in srgb, var(--m-home) ${Math.max(45, 100 - index * 12)}%, var(--m-grid))`;

    return html`<div class="section">
      <div class="breakdown">
        ${config.loads.map((load, index) => {
          const value = data.loads[index] ?? 0;

          return value > 0
            ? html`<span style="flex:${value} 1 0;background:${color(index, load)}"></span>`
            : nothing;
        })}
        ${
          unknown > 0
            ? html`<span
                style="flex:${unknown} 1 0;background:repeating-linear-gradient(135deg, var(--m-muted) 0 2px, transparent 2px 5px)"
              ></span>`
            : nothing
        }
      </div>
      <div class="loads">
        ${config.loads.map(
          (load, index) =>
            html`<span style="--c:${color(index, load)}"
              ><em><i></i>${load.name ?? entityName(hass, load.entity)}</em
              ><b>${formatNumber(data.loads[index], 0, locale)} ${w}</b></span
            >`,
        )}
        <span style="--c:var(--m-muted)"
          ><em><i></i>${t('baseload.unknown')}</em
          ><b style="color:var(--m-solar)">${formatNumber(unknown, 0, locale)} ${w}</b></span
        >
      </div>
      ${
        price === undefined
          ? nothing
          : html`<span class="label"
              >${t('baseload.unknown_cost', {
                value: formatMoney(
                  (unknown / 1000) * 24 * 365 * price,
                  locale,
                  currencyOf(hass, config.currency),
                ),
                price: formatNumber(price, 2, locale),
              })}</span
            >`
      }
    </div>`;
  }
}
