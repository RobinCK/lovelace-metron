import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchCalendarIntervals } from '../../core/data/calendar';
import {
  fetchSolarForecast,
  fetchWeatherForecast,
  forecastBetween,
} from '../../core/data/forecast';
import type { HourlyEnergy, WeatherForecast } from '../../core/data/forecast';
import type { Interval } from '../../core/data/history';
import { bucketize, fetchStatistics, meanOf } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { formatMoney, formatNumber, formatWeekday, unitText } from '../../core/format';
import { addDays, startOfDay } from '../../core/time';
import { findEntity } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, icon, meta, stats, weatherIcon } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { degreeDays } from '../shared/degree-days';
import {
  counterSeries,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveGas,
  resolveSources,
  total,
} from '../shared/energy-sources';
import type { EnergyConfig } from '../shared/energy-sources';
import { currencyOf, parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';

export interface WeekAheadCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly weather: string;
  readonly days: number;
  readonly gas: readonly string[];
  readonly outdoor?: string;
  readonly base_temperature: number;
  readonly gas_price?: Price;
  readonly currency?: string;
  readonly outage_calendar?: string;
  readonly clear_day?: number;
}

interface DayPlan {
  readonly start: number;
  readonly weather?: WeatherForecast;
  readonly solar?: number;
  readonly estimated: boolean;
  readonly gas?: number;
  readonly outages: readonly Interval[];
}

interface WeekData {
  readonly days: readonly DayPlan[];
  readonly hasGas: boolean;
  readonly hasSolar: boolean;
}

type Context = CardContext<WeekAheadCardConfig, WeekData>;

const CONDITION_FACTOR: Readonly<Record<string, number>> = {
  sunny: 0.95,
  'clear-night': 0.95,
  windy: 0.75,
  partlycloudy: 0.6,
  'windy-variant': 0.5,
  cloudy: 0.3,
  exceptional: 0.3,
  fog: 0.22,
  rainy: 0.2,
  'lightning-rainy': 0.15,
  snowy: 0.15,
  'snowy-rainy': 0.15,
  hail: 0.15,
  lightning: 0.25,
  pouring: 0.12,
};

const BAR_HEIGHT = 48;

export class MetronWeekAheadCard extends MetronCard<WeekAheadCardConfig, WeekData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .table {
        display: grid;
        grid-template-columns: 44px repeat(var(--days, 7), minmax(0, 1fr));
        gap: 6px 4px;
        align-items: center;
      }

      .label-cell {
        font-size: 11px;
        color: var(--m-muted);
      }

      .cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 0;
        text-align: center;
      }

      .weekday {
        font-size: 12px;
        white-space: nowrap;
        color: var(--m-text-2);
      }

      .weekday.today {
        font-weight: 600;
        color: var(--m-text);
      }

      .cell ha-icon {
        --mdc-icon-size: 22px;
      }

      .high {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 600;
      }

      .low {
        font-family: var(--m-mono);
        font-size: 10px;
        color: var(--m-muted);
      }

      .bar-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        height: ${BAR_HEIGHT + 16}px;
      }

      .bar-cell i {
        width: 12px;
        min-height: 2px;
        border-radius: 3px 3px 0 0;
      }

      .bar-cell i.estimated {
        opacity: 0.45;
      }

      .bar-cell span {
        font-family: var(--m-mono);
        font-size: 11px;
        white-space: nowrap;
      }

      .outage {
        padding: 2px 5px;
        border-radius: 4px;
        font-family: var(--m-mono);
        font-size: 10px;
        white-space: nowrap;
        background: color-mix(in srgb, var(--m-warn) 18%, transparent);
        color: var(--m-warn);
      }

      .none {
        font-size: 10px;
        color: var(--m-muted);
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.entity('weather', { domain: ['weather'] }, true),
      form.grid(
        form.number('days', { min: 3, max: 7 }),
        form.number('clear_day', { min: 0, unit: 'kWh' }),
      ),
      form.entities('gas', { domain: ['sensor'], deviceClass: ['gas'] }),
      form.grid(
        form.entity('outdoor', { domain: ['sensor'], deviceClass: ['temperature'] }),
        form.number('base_temperature', { min: 10, max: 25, step: 0.5, unit: '°C' }),
      ),
      form.grid(form.number('gas_price', { min: 0, step: 0.01 }), form.text('currency')),
      form.entity('outage_calendar', { domain: ['calendar'] }),
      ...energyFields(),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return { weather: findEntity(hass, { domain: 'weather' }) ?? '' };
  }

  protected parseConfig(raw: RawConfig): WeekAheadCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      weather: cfg.entity(raw, 'weather') ?? '',
      days: cfg.number(raw, 'days', 7, { min: 3, max: 7 }),
      gas: cfg.entityIds(raw, 'gas'),
      outdoor: cfg.entity(raw, 'outdoor'),
      base_temperature: cfg.number(raw, 'base_temperature', 18, { min: 0, max: 30 }),
      gas_price: parsePrice(raw, 'gas_price'),
      currency: cfg.text(raw, 'currency'),
      outage_calendar: cfg.entity(raw, 'outage_calendar'),
      clear_day: cfg.optionalNumber(raw, 'clear_day'),
    };
  }

  protected override missingOption(config: WeekAheadCardConfig): string | undefined {
    return config.weather ? undefined : 'weather';
  }

  protected override cardSize(): number {
    return 6;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: WeekAheadCardConfig,
    hass: HomeAssistant,
  ): Promise<WeekData> {
    const now = Date.now();
    const today = startOfDay(now);
    const end = addDays(today, config.days);
    const historyStart = addDays(today, -30);
    const historyDays = Array.from({ length: 30 }, (_, index) => addDays(historyStart, index));
    const sources = await resolveSources(hass, config.energy);
    const gasIds = await resolveGas(hass, config.gas, config.energy.energy_dashboard);
    const [weather, forecast, history, gas, outdoor, outages] = await Promise.all([
      fetchWeatherForecast(hass, config.weather, 'daily'),
      fetchSolarForecast(hass).catch((): HourlyEnergy => new Map()),
      fetchEnergyStatistics(hass, sources, historyStart, today, 'day'),
      gasIds.length > 0 && config.outdoor
        ? fetchStatistics(hass, {
            entityIds: gasIds,
            start: historyStart,
            end: today,
            period: 'day',
            types: ['change'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
      config.outdoor && gasIds.length > 0
        ? fetchStatistics(hass, {
            entityIds: [config.outdoor],
            start: historyStart,
            end: today,
            period: 'day',
            types: ['mean'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
      config.outage_calendar
        ? fetchCalendarIntervals(hass, config.outage_calendar, today, end)
        : Promise.resolve([]),
    ]);
    const solarHistory = energySeries(history, sources, historyDays, today).solar;
    const clearDay = config.clear_day ?? Math.max(0, ...solarHistory.map((value) => value ?? 0));
    const gasHistory = total(counterSeries(gas, gasIds, historyDays, today));
    const outdoorHistory = config.outdoor
      ? bucketize(outdoor.get(config.outdoor), historyDays, meanOf, 'mean', today)
      : [];
    const historyDegrees = degreeDays(outdoorHistory, config.base_temperature);
    const specific =
      gasHistory !== undefined && historyDegrees ? gasHistory / historyDegrees : undefined;

    const days = Array.from({ length: config.days }, (_, index): DayPlan => {
      const start = addDays(today, index);
      const dayWeather = weather.find((item) => startOfDay(Date.parse(item.datetime)) === start);
      const predicted = forecastBetween(forecast, start, addDays(start, 1));
      const factor = dayWeather?.condition ? CONDITION_FACTOR[dayWeather.condition] : undefined;
      const estimate = clearDay > 0 && factor !== undefined ? clearDay * factor : undefined;
      const mean =
        dayWeather?.temperature !== undefined
          ? dayWeather.templow === undefined
            ? dayWeather.temperature
            : (dayWeather.temperature + dayWeather.templow) / 2
          : undefined;

      return {
        start,
        weather: dayWeather,
        solar: predicted > 0 ? predicted : estimate,
        estimated: !(predicted > 0) && estimate !== undefined,
        gas:
          specific !== undefined && mean !== undefined
            ? specific * Math.max(0, config.base_temperature - mean)
            : undefined,
        outages: outages.filter(
          (interval) => interval.to > start && interval.from < addDays(start, 1),
        ),
      };
    });

    return {
      days,
      hasGas: days.some((day) => day.gas !== undefined),
      hasSolar: days.some((day) => day.solar !== undefined),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale, now } = context;
    const title = config.title ?? t('week.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const parts = [
      data.hasSolar ? t('week.solar') : undefined,
      data.hasGas ? t('week.gas') : undefined,
      config.outage_calendar ? t('week.outages') : undefined,
    ].filter((part): part is string => part !== undefined);
    const solarMax = Math.max(0.1, ...data.days.map((day) => day.solar ?? 0));
    const gasMax = Math.max(0.1, ...data.days.map((day) => day.gas ?? 0));
    const today = startOfDay(now);
    const temperature = (value: number | undefined, className: string): TemplateResult =>
      html`<span
        class=${className}
        style=${value !== undefined && value < 0 ? 'color:var(--m-cold)' : ''}
        >${value === undefined ? '—' : `${formatNumber(value, 0, locale)}°`}</span
      >`;

    return html`
      ${header(title, parts.length > 0 ? meta(parts.join(' · ')) : nothing)}
      <div class="table" style="--days:${data.days.length}">
        <span></span>
        ${data.days.map(
          (day) =>
            html`<span class="cell weekday ${day.start === today ? 'today' : ''}"
              >${formatWeekday(day.start, locale)} ${new Date(day.start).getDate()}</span
            >`,
        )}
        <span></span>
        ${data.days.map(
          (day) =>
            html`<span class="cell"
              >${icon(
                weatherIcon(day.weather?.condition),
                day.weather?.condition === 'sunny' ? 'var(--m-solar)' : 'var(--m-text-2)',
              )}</span
            >`,
        )}
        <span class="label-cell">°C</span>
        ${data.days.map(
          (day) =>
            html`<span class="cell"
              >${temperature(day.weather?.temperature, 'high')}${temperature(day.weather?.templow, 'low')}</span
            >`,
        )}
        ${
          data.hasSolar
            ? html`<span class="label-cell">${t('flow.solar')}</span> ${data.days.map(
                  (day) =>
                    html`<div class="bar-cell">
                      <i
                        class=${day.estimated ? 'estimated' : ''}
                        style="height:${(((day.solar ?? 0) / solarMax) * BAR_HEIGHT).toFixed(1)}px;background:var(--m-solar)"
                      ></i>
                      <span
                        >${day.solar === undefined ? '—' : `${day.estimated ? '≈' : ''}${formatNumber(day.solar, 0, locale)}`}</span
                      >
                    </div>`,
                )}`
            : nothing
        }
        ${
          data.hasGas
            ? html`<span class="label-cell">${t('week.gas_row')}</span> ${data.days.map(
                  (day) =>
                    html`<div class="bar-cell">
                      <i
                        style="height:${(((day.gas ?? 0) / gasMax) * BAR_HEIGHT).toFixed(1)}px;background:var(--m-gas)"
                      ></i>
                      <span>${formatNumber(day.gas, 1, locale)}</span>
                    </div>`,
                )}`
            : nothing
        }
        ${
          config.outage_calendar
            ? html`<span class="label-cell">${t('week.outages_row')}</span> ${data.days.map(
                  (day) =>
                    html`<span class="cell"
                      >${
                        day.outages.length === 0
                          ? html`<span class="none">—</span>`
                          : day.outages.map(
                              (interval) =>
                                html`<span class="outage"
                                  >${new Date(Math.max(interval.from, day.start)).getHours()}–${
                                    new Date(
                                      Math.min(interval.to, addDays(day.start, 1)),
                                    ).getHours() || 24
                                  }</span
                                >`,
                            )
                      }</span
                    >`,
                )}`
            : nothing
        }
      </div>
      ${stats(this._summary(context, data))}
    `;
  }

  private _summary(context: Context, data: WeekData): StatItem[] {
    const { config, hass, t, locale } = context;
    const items: StatItem[] = [];
    const solar = total(data.days.map((day) => day.solar));
    const gas = total(data.days.map((day) => day.gas));
    const coldest = data.days
      .filter((day) => day.weather?.templow !== undefined || day.weather?.temperature !== undefined)
      .reduce<DayPlan | undefined>((found, day) => {
        const value = day.weather?.templow ?? day.weather?.temperature ?? Number.POSITIVE_INFINITY;
        const best =
          found?.weather?.templow ?? found?.weather?.temperature ?? Number.POSITIVE_INFINITY;

        return value < best ? day : found;
      }, undefined);

    if (solar !== undefined) {
      items.push({
        label: t('week.solar_total', { days: data.days.length }),
        value: `≈ ${formatNumber(solar, 0, locale)}`,
        unit: unitText('kWh', locale),
        tone: 'solar',
      });
    }

    if (gas !== undefined) {
      const price = priceOf(hass, config.gas_price);

      items.push({
        label: t('week.gas_total', { days: data.days.length }),
        value: `≈ ${formatNumber(gas, 0, locale)}`,
        unit: unitText('m³', locale),
        tone: 'gas',
        sub:
          price === undefined
            ? undefined
            : `≈ ${formatMoney(gas * price, locale, currencyOf(hass, config.currency))}`,
      });
    }

    if (coldest) {
      const value = coldest.weather?.templow ?? coldest.weather?.temperature;

      items.push({
        label: t('week.coldest'),
        value: formatNumber(value, 0, locale),
        unit: `°C · ${formatWeekday(coldest.start, locale)}`,
        tone: value !== undefined && value < 0 ? 'cold' : undefined,
      });
    }

    return items;
  }
}
