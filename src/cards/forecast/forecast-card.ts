import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import {
  fetchSolarForecast,
  fetchWeatherForecast,
  forecastBetween,
} from '../../core/data/forecast';
import type { HourlyEnergy, WeatherForecast } from '../../core/data/forecast';
import { readNumber } from '../../core/entities';
import { formatNumber, formatWeekday, unitText } from '../../core/format';
import { addDays, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { axis, colorOf, header, icon, legend, weatherIcon } from '../../ui/parts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { metronStyles } from '../../ui/styles';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
  total,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergyKey } from '../shared/energy-sources';
import { surplusWindow } from './surplus';

const ENERGY: readonly EnergyKey[] = ['home'];

export interface Appliance {
  readonly name: string;
  readonly power: number;
  readonly icon?: string;
}

export interface ForecastCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly weather?: string;
  readonly days: number;
  readonly threshold: number;
  readonly history_days: number;
  readonly appliances: readonly Appliance[];
  readonly forecast_entities: readonly string[];
}

interface ForecastData {
  readonly forecast: HourlyEnergy;
  readonly typical: readonly number[];
  readonly today?: number;
  readonly weather: readonly WeatherForecast[];
}

type Context = CardContext<ForecastCardConfig, ForecastData>;

const CHART_HEIGHT = 100;

export class MetronForecastCard extends MetronCard<ForecastCardConfig, ForecastData> {
  static override properties: PropertyDeclarations = {
    _day: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .days {
        display: grid;
        grid-template-columns: repeat(var(--count, 3), minmax(0, 1fr));
        gap: 8px;
      }

      .day {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 10px 12px;
        border: 0;
        border-radius: 12px;
        background: var(--m-panel);
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .day.selected {
        box-shadow: inset 0 0 0 1px var(--m-solar);
      }

      .day-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        font-size: 12px;
        color: var(--m-text-2);
      }

      .day.selected .day-head {
        font-weight: 600;
        color: var(--m-text);
      }

      .day-head ha-icon {
        --mdc-icon-size: 18px;
        color: var(--m-solar);
      }

      .plot {
        position: relative;
        height: ${CHART_HEIGHT}px;
        border-bottom: 1px solid var(--m-line);
      }

      .slots {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-end;
        gap: 3px;
      }

      .slot {
        position: relative;
        flex: 1 1 0;
        height: 100%;
      }

      .slot .pv {
        position: absolute;
        right: 15%;
        bottom: 0;
        left: 15%;
        border-radius: 2px 2px 0 0;
        background: var(--m-solar);
      }

      .slot .load {
        position: absolute;
        right: 0;
        left: 0;
        height: 2px;
        border-radius: 1px;
        background: var(--m-home);
      }

      .window {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 6px;
        background: color-mix(in srgb, var(--m-ok) 12%, transparent);
      }

      .window span {
        position: absolute;
        top: -16px;
        left: 4px;
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
        color: var(--m-ok);
      }

      .plan {
        flex-direction: row;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
      }

      .plan > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .plan > .apps {
        align-items: flex-end;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 12px;
        background: var(--m-panel);
        --mdc-icon-size: 14px;
      }
    `,
  ];

  declare _day: number | undefined;

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(
        form.entity('weather', { domain: ['weather'] }),
        form.number('days', { min: 1, max: 7 }),
      ),
      form.grid(
        form.number('threshold', { min: 0, step: 0.1, unit: 'kW' }),
        form.number('history_days', { min: 3, max: 60 }),
      ),
      form.entities('forecast_entities', { domain: ['sensor'], deviceClass: ['energy'] }),
      form.list(
        'appliances',
        {
          name: { selector: { text: {} }, required: true },
          power: { selector: { number: { mode: 'box', unit_of_measurement: 'W' } } },
          icon: { selector: { icon: {} } },
        },
        'name',
      ),
      ...energyFields(ENERGY),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): ForecastCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw, ENERGY),
      weather: cfg.entity(raw, 'weather'),
      days: cfg.number(raw, 'days', 3, { min: 1, max: 7 }),
      threshold: cfg.number(raw, 'threshold', 1.5, { min: 0 }),
      history_days: cfg.number(raw, 'history_days', 14, { min: 3, max: 60 }),
      appliances: cfg.list(raw, 'appliances', (item) => {
        const name = cfg.text(item, 'name');
        const power = cfg.optionalNumber(item, 'power');

        return name && power !== undefined
          ? { name, power, icon: cfg.text(item, 'icon') }
          : undefined;
      }),
      forecast_entities: cfg.entityIds(raw, 'forecast_entities'),
    };
  }

  protected override trackedEntities(config: ForecastCardConfig): readonly (string | undefined)[] {
    return config.forecast_entities;
  }

  protected override cardSize(): number {
    return 6;
  }

  protected override refreshInterval(): number {
    return HOUR / 2;
  }

  protected override async fetchData(
    config: ForecastCardConfig,
    hass: HomeAssistant,
  ): Promise<ForecastData> {
    const now = Date.now();
    const today = startOfDay(now);
    const historyStart = addDays(today, -config.history_days);
    const sources = await resolveSources(hass, config.energy);
    const [forecast, history, weather] = await Promise.all([
      fetchSolarForecast(hass).catch((): HourlyEnergy => new Map()),
      fetchEnergyStatistics(hass, sources, historyStart - HOUR, now, 'hour'),
      config.weather ? fetchWeatherForecast(hass, config.weather, 'daily') : Promise.resolve([]),
    ]);
    const hours = Array.from(
      { length: Math.round((today - historyStart) / HOUR) },
      (_, index) => historyStart + index * HOUR,
    );
    const series = energySeries(history, sources, hours, today);
    const sums = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));

    hours.forEach((time, index) => {
      const value = series.home[index];
      const slot = sums[new Date(time).getHours()];

      if (value === undefined || !slot) return;

      slot.sum += value;
      slot.count += 1;
    });

    const todayHours = Array.from({ length: 24 }, (_, index) => today + index * HOUR);
    const todaySeries = energySeries(history, sources, todayHours, today + DAY, { hass, now });

    return {
      forecast,
      typical: sums.map((slot) => (slot.count > 0 ? slot.sum / slot.count : 0)),
      today: total(todaySeries.solar),
      weather,
    };
  }

  private _dayTotal(context: Context, data: ForecastData, index: number): number | undefined {
    const { config, hass, now } = context;
    const entity = config.forecast_entities[index];

    if (entity) return readNumber(hass, entity, 'energy');

    const start = addDays(startOfDay(now), index);
    const value = forecastBetween(data.forecast, start, addDays(start, 1));

    return value > 0 ? value : undefined;
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, now } = context;
    const title = config.title ?? t('forecast.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const selected =
      this._day ?? (new Date(now).getHours() >= 14 ? Math.min(1, config.days - 1) : 0);

    return html`
      ${header(
        title,
        legend([
          { label: t('flow.solar'), color: 'var(--m-solar)' },
          { label: t('forecast.typical_home'), color: 'var(--m-home)', line: true },
        ]),
      )}
      ${this._renderDays(context, data, selected)} ${this._renderDay(context, data, selected)}
    `;
  }

  private _dayLabel(context: Context, index: number): string {
    const { t, locale, now } = context;
    const day = addDays(startOfDay(now), index);

    if (index === 0) return t('common.today');
    if (index === 1) return `${t('forecast.tomorrow')}, ${formatWeekday(day, locale)}`;

    return new Intl.DateTimeFormat(locale.timeLocale, { weekday: 'long' }).format(day);
  }

  private _renderDays(context: Context, data: ForecastData, selected: number): TemplateResult {
    const { config, t, locale, now } = context;
    const totals = Array.from({ length: config.days }, (_, index) =>
      this._dayTotal(context, data, index),
    );
    const max = Math.max(1, ...totals.map((value) => value ?? 0));

    return html`<div class="days" style="--count:${config.days}">
      ${totals.map((value, index) => {
        const day = addDays(startOfDay(now), index);
        const weather = data.weather.find((item) => startOfDay(Date.parse(item.datetime)) === day);
        const progress =
          index === 0 && value && data.today !== undefined
            ? Math.min(1, data.today / value)
            : (value ?? 0) / max;

        return html`<button
          type="button"
          class="day ${index === selected ? 'selected' : ''}"
          @click=${(event: Event) => {
            event.stopPropagation();
            this._day = index;
          }}
        >
          <span class="day-head"
            ><span>${this._dayLabel(context, index)}</span
            >${weather ? icon(weatherIcon(weather.condition)) : nothing}</span
          >
          <span
            ><span class="xl" style="font-size:22px">${formatNumber(value, 0, locale)}</span
            ><span class="unit"> ${unitText('kWh', locale)}</span></span
          >
          <div class="track">
            <div style="width:${(progress * 100).toFixed(0)}%;--c:var(--m-solar)"></div>
          </div>
          ${
            index === 0 && data.today !== undefined
              ? html`<span class="label"
                  >${t('forecast.done', { value: formatNumber(data.today, 1, locale) })}</span
                >`
              : nothing
          }
        </button>`;
      })}
    </div>`;
  }

  private _renderDay(context: Context, data: ForecastData, selected: number): TemplateResult {
    const { config, t, locale, now } = context;
    const start = addDays(startOfDay(now), selected);
    const production = Array.from(
      { length: 24 },
      (_, hour) => data.forecast.get(start + hour * HOUR) ?? 0,
    );
    const active = production
      .map((value, hour) => (value > 0.05 ? hour : -1))
      .filter((hour) => hour >= 0);

    if (active.length === 0) {
      return html`<div class="empty">${t('forecast.no_hourly')}</div>`;
    }

    const first = Math.max(0, Math.min(...active) - 1);
    const last = Math.min(23, Math.max(...active) + 1);
    const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    const max =
      Math.max(
        1,
        ...hours.map((hour) => Math.max(production[hour] ?? 0, data.typical[hour] ?? 0)),
      ) * 1.1;
    const window = surplusWindow(
      hours.map((hour) => production[hour] ?? 0),
      hours.map((hour) => data.typical[hour] ?? 0),
      config.threshold,
    );
    const px = (value: number): string => `${((value / max) * CHART_HEIGHT).toFixed(1)}px`;
    const fits = window ? config.appliances.filter((item) => item.power / 1000 <= window.peak) : [];
    const ticks = hours
      .filter((hour) => hour % 3 === 0)
      .map((hour) => ({
        at: (hour - first + 0.5) / hours.length,
        label: String(hour).padStart(2, '0'),
      }));
    const dayName =
      selected === 0
        ? t('common.today').toLowerCase()
        : this._dayLabel(context, selected).toLowerCase();

    return html`<div class="section" style="gap:6px;padding-top:16px">
        <div class="plot">
          ${
            window
              ? html`<div
                  class="window"
                  style="left:${((window.from / hours.length) * 100).toFixed(1)}%;width:${(((window.to - window.from) / hours.length) * 100).toFixed(1)}%"
                >
                  <span>${t('forecast.window')}</span>
                </div>`
              : nothing
          }
          <div class="slots">
            ${hours.map(
              (hour) =>
                html`<div class="slot">
                  <span
                    class="pv"
                    style="height:${px(production[hour] ?? 0)};opacity:${start + (hour + 1) * HOUR <= now ? 0.45 : 1}"
                  ></span>
                  <span class="load" style="bottom:${px(data.typical[hour] ?? 0)}"></span>
                </div>`,
            )}
          </div>
        </div>
        ${axis(ticks)}
      </div>
      <div class="panel plan">
        <div>
          <span class="label">${t('forecast.window_day', { day: dayName })}</span>
          <span class="xl" style="font-size:22px"
            >${
              window
                ? `${String(hours[window.from] ?? 0).padStart(2, '0')}:00–${String((hours[window.to - 1] ?? 0) + 1).padStart(2, '0')}:00`
                : '—'
            }</span
          >
          <span class="label"
            >${
              window
                ? t('forecast.window_note', {
                    peak: formatNumber(window.peak, 1, locale),
                    energy: formatNumber(window.energy, 0, locale),
                    kw: unitText('kW', locale),
                    kwh: unitText('kWh', locale),
                  })
                : t('forecast.no_window', { value: formatNumber(config.threshold, 1, locale) })
            }</span
          >
        </div>
        ${
          fits.length > 0
            ? html`<div class="apps">
                <span class="label">${t('forecast.can_run')}</span>
                <div class="chips">
                  ${fits.map(
                    (item, index) =>
                      html`<span class="chip"
                        >${icon(item.icon, colorOf(undefined, index + 1))}${item.name}</span
                      >`,
                  )}
                </div>
              </div>`
            : nothing
        }
      </div>`;
  }
}
