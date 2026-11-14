import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { bucketize, fetchStatistics, meanOf } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { formatDate, formatMonth, formatNumber, formatSigned, unitText } from '../../core/format';
import { addDays } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta, pill, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { degreeDays, specific } from '../shared/degree-days';
import { counterSeries, resolveGas, total } from '../shared/energy-sources';
import type { Series } from '../shared/energy-sources';
import { projectRemaining, seasonBounds } from './season';
import type { SeasonBounds } from './season';

export interface SeasonCardConfig extends BaseConfig {
  readonly gas: readonly string[];
  readonly energy_dashboard: boolean;
  readonly outdoor?: string;
  readonly base_temperature: number;
  readonly season_start?: string;
  readonly season_end?: string;
}

interface SeasonData {
  readonly bounds: SeasonBounds;
  readonly now: number;
  readonly weeks: readonly number[];
  readonly current: Series;
  readonly previous: Series;
  readonly currentDaily: Series;
  readonly previousDaily: Series;
  readonly currentTemperature: Series;
  readonly previousTemperature: Series;
  readonly empty: boolean;
}

type Context = CardContext<SeasonCardConfig, SeasonData>;

const CHART_HEIGHT = 110;

const cumulative = (values: Series): number[] => {
  let sum = 0;

  return values.map((value) => {
    sum += value ?? 0;

    return sum;
  });
};

const sumUntil = (values: Series, count: number): number =>
  values.slice(0, count).reduce<number>((sum, value) => sum + (value ?? 0), 0);

export class MetronSeasonCard extends MetronCard<SeasonCardConfig, SeasonData> {
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

      .weeks {
        position: relative;
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: ${CHART_HEIGHT}px;
        border-bottom: 1px solid var(--m-line);
      }

      .week {
        position: relative;
        flex: 1 1 0;
        height: 100%;
      }

      .week span {
        position: absolute;
        right: 0;
        left: 0;
        bottom: 0;
        border-radius: 2px 2px 0 0;
      }

      .ghost {
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--m-text-2) 45%, transparent);
      }

      .solid {
        background: var(--m-gas);
      }

      .projected {
        background: repeating-linear-gradient(
          135deg,
          color-mix(in srgb, var(--m-gas) 65%, transparent) 0 2px,
          color-mix(in srgb, var(--m-gas) 12%, transparent) 2px 5px
        );
      }

      .marker {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 0;
        border-left: 1px dashed var(--m-text-2);
      }

      .marker b {
        position: absolute;
        top: 0;
        left: 4px;
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 500;
        white-space: nowrap;
      }

      .legend i.ghost {
        background: none;
      }

      .legend i.projected {
        background: repeating-linear-gradient(135deg, var(--m-gas) 0 2px, transparent 2px 4px);
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.entities('gas', { domain: ['sensor'], deviceClass: ['gas'] }),
      form.grid(
        form.entity('outdoor', { domain: ['sensor'], deviceClass: ['temperature'] }),
        form.number('base_temperature', { min: 10, max: 25, step: 0.5, unit: '°C' }),
      ),
      form.grid(form.text('season_start'), form.text('season_end')),
      form.toggle('energy_dashboard'),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): SeasonCardConfig {
    return {
      ...cfg.base(raw),
      gas: cfg.entityIds(raw, 'gas'),
      energy_dashboard: cfg.boolean(raw, 'energy_dashboard', true),
      outdoor: cfg.entity(raw, 'outdoor'),
      base_temperature: cfg.number(raw, 'base_temperature', 18, { min: 0, max: 30 }),
      season_start: cfg.text(raw, 'season_start'),
      season_end: cfg.text(raw, 'season_end'),
    };
  }

  protected override cardSize(): number {
    return 6;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: SeasonCardConfig,
    hass: HomeAssistant,
  ): Promise<SeasonData> {
    const now = Date.now();
    const bounds = seasonBounds(now, config.season_start, config.season_end);
    const gasIds = await resolveGas(hass, config.gas, config.energy_dashboard);
    const weekCount = Math.ceil((bounds.end - bounds.start) / (7 * DAY));
    const weeks = Array.from({ length: weekCount }, (_, index) => addDays(bounds.start, index * 7));
    const previousWeeks = Array.from({ length: weekCount }, (_, index) =>
      addDays(bounds.previousStart, index * 7),
    );
    const dayCount = Math.round((bounds.end - bounds.start) / DAY);
    const days = Array.from({ length: dayCount }, (_, index) => addDays(bounds.start, index));
    const previousDays = Array.from({ length: dayCount }, (_, index) =>
      addDays(bounds.previousStart, index),
    );
    const [gas, temperature] = await Promise.all([
      fetchStatistics(hass, {
        entityIds: gasIds,
        start: bounds.previousStart,
        end: Math.min(bounds.end, now + DAY),
        period: 'day',
        types: ['change', 'state'],
      }),
      config.outdoor
        ? fetchStatistics(hass, {
            entityIds: [config.outdoor],
            start: bounds.previousStart,
            end: Math.min(bounds.end, now + DAY),
            period: 'day',
            types: ['mean'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
    ]);
    const live = { hass, now };
    const outdoorRows = config.outdoor ? temperature.get(config.outdoor) : undefined;

    return {
      bounds,
      now,
      weeks,
      current: counterSeries(gas, gasIds, weeks, bounds.end, live, 'volume'),
      previous: counterSeries(gas, gasIds, previousWeeks, bounds.previousEnd),
      currentDaily: counterSeries(gas, gasIds, days, bounds.end, live, 'volume'),
      previousDaily: counterSeries(gas, gasIds, previousDays, bounds.previousEnd),
      currentTemperature: bucketize(outdoorRows, days, meanOf, 'mean', bounds.end),
      previousTemperature: bucketize(outdoorRows, previousDays, meanOf, 'mean', bounds.previousEnd),
      empty: gasIds.length === 0,
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale } = context;

    if (data?.empty) return html`<div class="empty">${t('gas.no_meter')}</div>`;
    if (!data)
      return html`${header(config.title ?? t('season.title_short'))}
        <div class="empty">${t('common.loading')}</div>`;

    const startYear = new Date(data.bounds.start).getFullYear();
    const title =
      config.title ??
      t('season.title', {
        season: `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`,
      });
    const elapsedDays = Math.max(
      0,
      Math.min(data.currentDaily.length, Math.ceil((data.now - data.bounds.start) / DAY)),
    );
    const thisToDate = sumUntil(data.currentDaily, elapsedDays);
    const lastToDate = sumUntil(data.previousDaily, elapsedDays);
    const lastTotal = total(data.previous) ?? 0;
    const projected = projectRemaining(thisToDate, lastToDate, Math.max(0, lastTotal - lastToDate));
    const change = lastToDate > 0 ? ((thisToDate - lastToDate) / lastToDate) * 100 : undefined;
    const m3 = unitText('m³', locale);

    return html`
      ${header(title, meta(t('season.since', { date: formatDate(data.bounds.start, locale) })))}
      <div class="summary">
        <div class="total">
          <span
            ><span class="big">${formatNumber(thisToDate, 0, locale)}</span
            ><span class="unit"> ${t('season.of_gas', { unit: m3 })}</span></span
          >
          ${
            change === undefined
              ? nothing
              : pill(
                  t('season.vs_last', { value: formatSigned(change, 0, locale) }),
                  change <= 0 ? 'ok' : 'warn',
                  false,
                )
          }
        </div>
        <div class="side-list">
          <div class="side-row">
            <span>${t('season.last_to_date')}</span
            ><span><b>${formatNumber(lastToDate, 0, locale)}</b> ${m3}</span>
          </div>
          <div class="side-row">
            <span>${t('season.forecast')}</span
            ><span>≈ <b>${formatNumber(Math.round(projected / 10) * 10, 0, locale)}</b> ${m3}</span>
          </div>
          <div class="side-row">
            <span>${t('season.last_total')}</span
            ><span><b>${formatNumber(lastTotal, 0, locale)}</b> ${m3}</span>
          </div>
        </div>
      </div>
      <div class="legend">
        <span><i style="--c:var(--m-gas)"></i>${t('season.this_season')}</span>
        <span><i class="projected"></i>${t('season.projected')}</span>
        <span
          ><i class="ghost" style="box-shadow:inset 0 0 0 1px var(--m-text-2)"></i
          >${t('season.last_cumulative')}</span
        >
      </div>
      ${this._renderChart(context, data, thisToDate, lastToDate)}
      ${stats(this._footer(context, data, elapsedDays, thisToDate, lastToDate))}
    `;
  }

  private _renderChart(
    context: Context,
    data: SeasonData,
    thisToDate: number,
    lastToDate: number,
  ): TemplateResult {
    const { locale } = context;
    const lastCumulative = cumulative(data.previous);
    const thisCumulative = cumulative(data.current);
    const ratio = lastToDate > 0 ? Math.min(3, Math.max(0.3, thisToDate / lastToDate)) : 1;
    const currentWeek = Math.floor((data.now - data.bounds.start) / (7 * DAY));
    const maxValue = Math.max(1, ...lastCumulative, ...thisCumulative) * 1.05;
    let projection = thisToDate;
    const height = (value: number): string => `${((value / maxValue) * CHART_HEIGHT).toFixed(1)}px`;
    const fraction = (data.now - data.bounds.start) / (data.bounds.end - data.bounds.start);

    return html`<div class="section" style="gap:4px">
      <div class="weeks">
        ${data.weeks.map((_, index) => {
          const ghost = lastCumulative[index] ?? 0;

          if (index < currentWeek) {
            return html`<div class="week">
              <span class="ghost" style="height:${height(ghost)}"></span>
              <span class="solid" style="height:${height(thisCumulative[index] ?? 0)}"></span>
            </div>`;
          }

          const weekShare =
            index === currentWeek ? 1 - (data.now - (data.weeks[index] ?? 0)) / (7 * DAY) : 1;

          projection += (data.previous[index] ?? 0) * ratio * Math.max(0, weekShare);

          return html`<div class="week">
            <span class="ghost" style="height:${height(ghost)}"></span>
            ${
              index === currentWeek
                ? html`<span class="solid" style="height:${height(thisToDate)}"></span>`
                : nothing
            }
            <span
              class="projected"
              style="bottom:${index === currentWeek ? height(thisToDate) : '0px'};height:${height(index === currentWeek ? projection - thisToDate : projection)}"
            ></span>
          </div>`;
        })}
        ${
          fraction > 0 && fraction < 1
            ? html`<div class="marker" style="left:${(fraction * 100).toFixed(1)}%">
                <b>${formatDate(data.now, locale)}</b>
              </div>`
            : nothing
        }
      </div>
      <div class="axis">
        ${data.weeks.map((week, index) => {
          const previous = data.weeks[index - 1];
          const isNew =
            previous === undefined || new Date(week).getMonth() !== new Date(previous).getMonth();

          return isNew
            ? html`<span
                class=${index === 0 ? 'first' : ''}
                style="left:${((index / data.weeks.length) * 100).toFixed(1)}%;transform:none"
                >${formatMonth(addDays(week, 6), locale)}</span
              >`
            : nothing;
        })}
      </div>
    </div>`;
  }

  private _footer(
    context: Context,
    data: SeasonData,
    elapsedDays: number,
    thisToDate: number,
    lastToDate: number,
  ): StatItem[] {
    const { config, t, locale } = context;

    if (!config.outdoor) return [];

    const thisDegree = degreeDays(
      data.currentTemperature.slice(0, elapsedDays),
      config.base_temperature,
    );
    const lastDegree = degreeDays(
      data.previousTemperature.slice(0, elapsedDays),
      config.base_temperature,
    );
    const thisSpecific = specific(thisToDate, thisDegree);
    const lastSpecific = specific(lastToDate, lastDegree);
    const adjusted =
      thisSpecific !== undefined && lastSpecific
        ? ((thisSpecific - lastSpecific) / lastSpecific) * 100
        : undefined;

    return [
      {
        label: t('season.degree_days'),
        value: formatNumber(thisDegree, 0, locale),
        sub: t('season.last_year', { value: formatNumber(lastDegree, 0, locale) }),
      },
      {
        label: t('gas.specific'),
        value: formatNumber(thisSpecific, 2, locale),
        sub: `${t('season.per_degree_day', { unit: unitText('m³', locale) })} · ${t(
          'season.last_year',
          {
            value: formatNumber(lastSpecific, 2, locale),
          },
        )}`,
      },
      {
        label: t('season.weather_adjusted'),
        value: adjusted === undefined ? '—' : `${formatSigned(adjusted, 0, locale)} %`,
        tone: adjusted === undefined ? undefined : adjusted <= 0 ? 'ok' : 'warn',
        sub: t('season.vs_last_short'),
      },
    ];
  }
}
