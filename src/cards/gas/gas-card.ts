import { css, html, nothing, svg } from 'lit';
import type { CSSResultGroup, SVGTemplateResult, TemplateResult } from 'lit';
import { DAY, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { fetchStates, intervalsWhere, overlap } from '../../core/data/history';
import { bucketize, fetchStatistics, maxOf, meanOf, minOf } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { readNumber, stateIsOn } from '../../core/entities';
import {
  formatDate,
  formatDuration,
  formatMonth,
  formatNumber,
  formatSigned,
  unitText,
} from '../../core/format';
import { niceMax } from '../../core/math';
import { addDays, addMonths, daysInMonth, startOfDay, startOfMonth } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { barChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, legend, pill } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import type { Tip, TipRow } from '../../ui/tip';
import { degreeDays, specific } from '../shared/degree-days';
import { counterSeries, resolveGas, total } from '../shared/energy-sources';
import type { Series } from '../shared/energy-sources';

export interface GasCardConfig extends BaseConfig {
  readonly gas: readonly string[];
  readonly indoor?: string;
  readonly outdoor?: string;
  readonly boiler?: string;
  readonly base_temperature: number;
  readonly compare: boolean;
}

interface Boiler {
  readonly minutes: number;
  readonly starts: number;
  readonly fraction: number;
}

interface GasData {
  readonly start: number;
  readonly days: number;
  readonly gas: Series;
  readonly outdoor: Series;
  readonly outdoorMin: Series;
  readonly outdoorMax: Series;
  readonly indoor: Series;
  readonly lastYearGas?: number;
  readonly lastYearDegreeDays?: number;
  readonly boiler?: Boiler;
  readonly empty: boolean;
}

type Context = CardContext<GasCardConfig, GasData>;

const TEMPERATURE_HEIGHT = 72;
const SLOT = 10;

const known = (series: Series): number[] =>
  series.filter((value): value is number => value !== undefined);

const average = (series: Series): number | undefined => {
  const values = known(series);

  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
};

export class MetronGasCard extends MetronCard<GasCardConfig, GasData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
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

      .panels .panel {
        gap: 4px;
        padding: 10px 12px;
      }

      .panel .label {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .panel .label i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--c);
      }

      .temps svg {
        display: block;
        width: 100%;
      }

      .gas-bars {
        position: relative;
      }

      .avg {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-gas);
      }

      .avg span {
        position: absolute;
        bottom: 2px;
        left: 0;
        font-family: var(--m-mono);
        font-size: 10px;
        color: var(--m-gas);
      }

      .footer {
        display: grid;
        grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr));
        gap: 10px;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.entities('gas', { domain: ['sensor'], deviceClass: ['gas'] }),
      form.grid(
        form.entity('indoor', { domain: ['sensor'], deviceClass: ['temperature'] }),
        form.entity('outdoor', { domain: ['sensor'], deviceClass: ['temperature'] }),
      ),
      form.grid(
        form.entity('boiler', { domain: ['binary_sensor', 'switch', 'climate', 'input_boolean'] }),
        form.number('base_temperature', { min: 10, max: 25, step: 0.5, unit: '°C' }),
      ),
      form.toggle('compare'),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): GasCardConfig {
    return {
      ...cfg.base(raw),
      gas: cfg.entityIds(raw, 'gas'),
      indoor: cfg.entity(raw, 'indoor'),
      outdoor: cfg.entity(raw, 'outdoor'),
      boiler: cfg.entity(raw, 'boiler'),
      base_temperature: cfg.number(raw, 'base_temperature', 18, { min: 0, max: 30 }),
      compare: cfg.boolean(raw, 'compare', true),
    };
  }

  protected override trackedEntities(config: GasCardConfig): readonly (string | undefined)[] {
    return [config.indoor, config.outdoor, config.boiler];
  }

  protected override cardSize(): number {
    return 8;
  }

  protected override defaultSize(): SizeSetting {
    return 'large';
  }

  protected override async fetchData(config: GasCardConfig, hass: HomeAssistant): Promise<GasData> {
    const now = Date.now();
    const start = startOfMonth(now);
    const end = addMonths(start, 1);
    const days = daysInMonth(start);
    const starts = Array.from({ length: days }, (_, index) => addDays(start, index));
    const gasIds = await resolveGas(hass, config.gas);
    const lastStart = addMonths(start, -12);
    const lastEnd = lastStart + (now - start);
    const temperatures = [config.outdoor, config.indoor].filter(
      (id): id is string => id !== undefined,
    );
    const [gas, temps, lastGas, lastTemps, boiler] = await Promise.all([
      fetchStatistics(hass, {
        entityIds: gasIds,
        start: start - DAY,
        end,
        period: 'day',
        types: ['change', 'state'],
      }),
      fetchStatistics(hass, {
        entityIds: temperatures,
        start,
        end,
        period: 'day',
        types: ['mean', 'min', 'max'],
      }),
      config.compare
        ? fetchStatistics(hass, {
            entityIds: gasIds,
            start: lastStart,
            end: lastEnd,
            period: 'day',
            types: ['change'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
      config.compare && config.outdoor
        ? fetchStatistics(hass, {
            entityIds: [config.outdoor],
            start: lastStart,
            end: lastEnd,
            period: 'day',
            types: ['mean'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
      this._boiler(config, hass, now),
    ]);
    const lastGasSeries = counterSeries(lastGas, gasIds, [lastStart], lastEnd);
    const lastOutdoor = config.outdoor
      ? bucketize(
          lastTemps.get(config.outdoor),
          Array.from({ length: days }, (_, index) => addDays(lastStart, index)),
          meanOf,
          'mean',
          lastEnd,
        ).filter((_, index) => addDays(lastStart, index) < lastEnd)
      : [];
    const outdoorRows = config.outdoor ? temps.get(config.outdoor) : undefined;

    return {
      start,
      days,
      gas: counterSeries(gas, gasIds, starts, end, { hass, now }, 'volume'),
      outdoor: bucketize(outdoorRows, starts, meanOf, 'mean', end),
      outdoorMin: bucketize(outdoorRows, starts, minOf, 'min', end),
      outdoorMax: bucketize(outdoorRows, starts, maxOf, 'max', end),
      indoor: config.indoor ? bucketize(temps.get(config.indoor), starts, meanOf, 'mean', end) : [],
      lastYearGas: lastGasSeries[0],
      lastYearDegreeDays:
        lastOutdoor.length > 0 ? degreeDays(lastOutdoor, config.base_temperature) : undefined,
      boiler,
      empty: gasIds.length === 0,
    };
  }

  private async _boiler(
    config: GasCardConfig,
    hass: HomeAssistant,
    now: number,
  ): Promise<Boiler | undefined> {
    if (!config.boiler) return undefined;

    const start = startOfDay(now);
    const states = await fetchStates(hass, [config.boiler], start, now);
    const samples = states.get(config.boiler) ?? [];
    const intervals = intervalsWhere(
      samples,
      (state) => stateIsOn(state) === true || state === 'heat',
      now,
    );
    const minutes = overlap(intervals, start, now) / MINUTE;

    return {
      minutes,
      starts: intervals.filter((interval) => interval.from > start).length,
      fraction: now > start ? (minutes * MINUTE) / (now - start) : 0,
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, t, locale, now } = context;

    if (data?.empty) return html`<div class="empty">${t('gas.no_meter')}</div>`;

    const boilerOn = config.boiler ? hass.states[config.boiler]?.state : undefined;
    const title = config.title ?? t('gas.title', { month: formatMonth(now, locale, true) });

    return html`
      ${header(
        title,
        boilerOn === undefined
          ? nothing
          : ['on', 'heat', 'heating'].includes(boilerOn)
            ? pill(t('gas.boiler_on'), 'ok')
            : pill(t('gas.boiler_off'), 'muted'),
      )}
      ${data ? this._renderContent(context, data) : html`<div class="empty">${t('common.loading')}</div>`}
    `;
  }

  private _renderContent(context: Context, data: GasData): TemplateResult {
    const { size, t, locale, now } = context;
    const m3 = unitText('m³', locale);
    const sum = total(data.gas);
    const todayIndex = Math.floor((startOfDay(now) - data.start) / DAY);
    const today = data.gas[todayIndex];
    const complete = data.gas.slice(0, todayIndex);
    const avg = average(complete);
    const change =
      sum !== undefined && data.lastYearGas
        ? ((sum - data.lastYearGas) / data.lastYearGas) * 100
        : undefined;

    return html`
      <div class="summary">
        <div class="total">
          <span
            ><span class="big">${formatNumber(sum, 1, locale)}</span
            ><span class="unit"> ${m3}</span></span
          >
          ${
            change === undefined
              ? nothing
              : pill(
                  t('gas.year_over_year', { value: formatSigned(change, 0, locale) }),
                  change <= 0 ? 'ok' : 'warn',
                  false,
                )
          }
        </div>
        <div class="side-list">
          <div class="side-row">
            <span>${t('common.today')}</span
            ><span><b>${formatNumber(today, 1, locale)}</b> ${m3}</span>
          </div>
          <div class="side-row">
            <span>${t('history.average')}</span
            ><span><b>${formatNumber(avg, 1, locale)}</b> ${m3}${t('history.per_day')}</span>
          </div>
        </div>
      </div>
      ${size === 'small' ? nothing : this._renderTemperatures(context, data)}
      ${this._renderChart(context, data, avg)}
      ${size === 'auto' || size === 'large' ? this._renderFooter(context, data, sum) : nothing}
    `;
  }

  private _renderTemperatures(context: Context, data: GasData): TemplateResult | typeof nothing {
    const { config, hass, t, locale } = context;

    if (!config.indoor && !config.outdoor) return nothing;

    const indoor = readNumber(hass, config.indoor, 'temperature');
    const outdoor = readNumber(hass, config.outdoor, 'temperature');
    const panel = (
      label: string,
      color: string,
      value: number | undefined,
      mean: number | undefined,
      entityId?: string,
    ): TemplateResult =>
      html`<div
        class="panel ${entityId ? 'clickable' : ''}"
        @click=${() => {
          context.moreInfo(entityId);
        }}
      >
        <span class="label" style="--c:${color}"><i></i>${label}</span>
        <span
          ><span class="xl" style="font-size:20px">${formatNumber(value, 1, locale)}</span
          ><span class="unit"> °C</span></span
        >
        <span class="label">${t('gas.mean', { value: formatNumber(mean, 1, locale) })}</span>
      </div>`;
    const indoorMean = average(data.indoor);
    const outdoorMean = average(data.outdoor);
    const panels = [
      config.indoor
        ? panel(t('gas.indoor'), 'var(--m-home)', indoor, indoorMean, config.indoor)
        : undefined,
      config.outdoor
        ? panel(t('gas.outdoor'), 'var(--m-cold)', outdoor, outdoorMean, config.outdoor)
        : undefined,
      config.indoor && config.outdoor
        ? panel(
            t('gas.delta'),
            'var(--m-text-2)',
            indoor !== undefined && outdoor !== undefined ? indoor - outdoor : undefined,
            indoorMean !== undefined && outdoorMean !== undefined
              ? indoorMean - outdoorMean
              : undefined,
          )
        : undefined,
    ].filter((item): item is TemplateResult => item !== undefined);

    return html`<div class="panels" style="--cols:${panels.length}">${panels}</div>`;
  }

  private _renderChart(context: Context, data: GasData, avg: number | undefined): TemplateResult {
    const { config, size, t, locale, now } = context;
    const small = size === 'small';
    const full = size === 'auto' || size === 'large';
    const todayIndex = Math.floor((startOfDay(now) - data.start) / DAY);
    const temperatureValues = [
      ...known(data.outdoorMin),
      ...known(data.outdoorMax),
      ...known(data.indoor),
    ];
    const hasTemperature = temperatureValues.length > 0 && !small;
    const low = Math.floor(Math.min(0, ...temperatureValues) / 5) * 5;
    const high = Math.ceil(Math.max(20, ...temperatureValues) / 5) * 5;
    const y = (value: number): number =>
      TEMPERATURE_HEIGHT - ((value - low) / (high - low || 1)) * TEMPERATURE_HEIGHT;

    const marks: SVGTemplateResult[] = [];

    for (let index = 0; index < data.days; index++) {
      const x = index * SLOT + SLOT / 2;
      const min = data.outdoorMin[index];
      const max = data.outdoorMax[index];
      const mean = data.outdoor[index];
      const inside = data.indoor[index];

      if (min !== undefined && max !== undefined) {
        marks.push(
          svg`<rect x=${x - 2} y=${y(max)} width="4" height=${Math.max(1, y(min) - y(max))} rx="2" style="fill:var(--m-cold);fill-opacity:0.28"></rect>`,
        );
      }

      if (mean !== undefined) {
        marks.push(
          svg`<rect x=${x - 2.5} y=${y(mean) - 1} width="5" height="2" rx="1" style="fill:var(--m-cold)"></rect>`,
        );
      }

      if (inside !== undefined) {
        marks.push(
          svg`<rect x=${x - 2.5} y=${y(inside) - 1} width="5" height="2" rx="1" style="fill:var(--m-home)"></rect>`,
        );
      }
    }

    const max = niceMax(Math.max(1, ...known(data.gas)));
    const height = small ? 28 : size === 'medium' ? 44 : 56;
    const tempHeight = size === 'medium' ? 44 : TEMPERATURE_HEIGHT;
    const opacity = (index: number): number => (index === todayIndex ? 0.5 : 1);

    return html`<div class="section shrink" style="gap:6px">
      ${
        full
          ? legend([
              ...(config.indoor ? [{ label: t('gas.indoor_short'), color: 'var(--m-home)' }] : []),
              ...(config.outdoor
                ? [{ label: t('gas.outdoor_range'), color: 'var(--m-cold)' }]
                : []),
              { label: t('gas.per_day', { unit: unitText('m³', locale) }), color: 'var(--m-gas)' },
            ])
          : nothing
      }
      ${
        hasTemperature
          ? html`<div class="temps">
              <svg
                viewBox="0 0 ${data.days * SLOT} ${TEMPERATURE_HEIGHT}"
                height=${tempHeight}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <line
                  x1="0"
                  x2=${data.days * SLOT}
                  y1=${y(0)}
                  y2=${y(0)}
                  style="stroke:var(--m-line)"
                  vector-effect="non-scaling-stroke"
                ></line>
                ${marks}
              </svg>
            </div>`
          : nothing
      }
      <div class="gas-bars shrink">
        ${barChart([{ values: data.gas, color: 'var(--m-gas)', opacity }], {
          height,
          fill: small ? 20 : 34,
          max,
          gap: 3,
          radius: 1,
          tip: (index) => this._tip(context, data, index),
        })}
        ${
          avg === undefined || small
            ? nothing
            : html`<div class="avg" style="top:${((1 - avg / max) * height).toFixed(1)}px">
                <span>${t('history.avg_short', { value: formatNumber(avg, 1, locale) })}</span>
              </div>`
        }
      </div>
      ${
        small
          ? nothing
          : axis(
              [1, 8, 15, 22, data.days].map((day) => ({
                at: (day - 0.5) / data.days,
                label: String(day),
                color: day - 1 === todayIndex ? 'var(--m-text)' : undefined,
              })),
            )
      }
    </div>`;
  }

  private _tip(context: Context, data: GasData, index: number): Tip | undefined {
    const { locale, t } = context;
    const gas = data.gas[index];

    if (gas === undefined) return undefined;

    const degrees = (value: number | undefined): string =>
      value === undefined ? '—' : `${formatNumber(value, 1, locale)} °C`;
    const rows: TipRow[] = [
      {
        label: t('gas.gas'),
        value: `${formatNumber(gas, 2, locale)} ${unitText('m³', locale)}`,
        color: 'var(--m-gas)',
      },
    ];
    const min = data.outdoorMin[index];
    const max = data.outdoorMax[index];

    if (min !== undefined && max !== undefined) {
      rows.push({
        label: t('gas.outdoor'),
        value: `${degrees(min)} … ${degrees(max)}`,
        color: 'var(--m-cold)',
      });
    }

    if (data.indoor[index] !== undefined) {
      rows.push({
        label: t('gas.indoor'),
        value: degrees(data.indoor[index]),
        color: 'var(--m-home)',
      });
    }

    return {
      title: formatDate(addDays(data.start, index), locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
      rows,
    };
  }

  private _renderFooter(
    context: Context,
    data: GasData,
    sum: number | undefined,
  ): TemplateResult | typeof nothing {
    const { config, t, locale, now } = context;
    const todayIndex = Math.floor((startOfDay(now) - data.start) / DAY);
    const panels: TemplateResult[] = [];

    if (config.outdoor) {
      const days = degreeDays(data.outdoor.slice(0, todayIndex + 1), config.base_temperature);
      const value = specific(sum, days);
      const last = specific(data.lastYearGas, data.lastYearDegreeDays);
      const change = value !== undefined && last ? ((value - last) / last) * 100 : undefined;

      panels.push(
        html`<div class="panel">
          <span class="label">${t('gas.specific')}</span>
          <span
            ><span class="xl">${formatNumber(value, 2, locale)}</span
            ><span class="unit">
              ${t('gas.specific_unit', { unit: unitText('m³', locale) })}</span
            ></span
          >
          <span class="label"
            >${
              last === undefined
                ? t('gas.degree_days', { value: formatNumber(days, 0, locale) })
                : html`${t('gas.last_year', { value: formatNumber(last, 2, locale) })}
                  ${
                    change === undefined
                      ? nothing
                      : html`·
                          <span style="color:${change <= 0 ? 'var(--m-ok)' : 'var(--m-warn)'}"
                            >${formatSigned(change, 0, locale)} %</span
                          >`
                  }`
            }</span
          >
        </div>`,
      );
    }

    if (data.boiler) {
      panels.push(
        html`<div class="panel">
          <span class="label">${t('gas.boiler_today')}</span>
          <span class="xl">${formatDuration(data.boiler.minutes, t)}</span>
          <span class="label"
            >${t('gas.boiler_starts', {
              count: data.boiler.starts,
              percent: formatNumber(data.boiler.fraction * 100, 0, locale),
            })}</span
          >
        </div>`,
      );
    }

    return panels.length === 0
      ? nothing
      : html`<div class="footer" style="--cols:${panels.length}">${panels}</div>`;
  }
}
