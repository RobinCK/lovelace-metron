import { css, html, nothing, svg } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR, MINUTE } from '../../const';
import type { StatisticsResult } from '../../core/data/statistics';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchWeatherForecast } from '../../core/data/forecast';
import type { WeatherForecast } from '../../core/data/forecast';
import { fetchStatistics } from '../../core/data/statistics';
import { attribute, readNumber } from '../../core/entities';
import {
  formatDuration,
  formatNumber,
  formatPower,
  formatSigned,
  formatTime,
} from '../../core/format';
import { sunDay, sunElevation } from '../../core/sun';
import { addDays, startOfDay } from '../../core/time';
import { findEntity } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, icon, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';

export interface SkyCardConfig extends BaseConfig {
  readonly weather?: string;
  readonly solar_power?: string;
}

interface SkyData {
  readonly hourly: readonly WeatherForecast[];
  readonly reference: ReadonlyMap<number, number>;
}

type Context = CardContext<SkyCardConfig, SkyData>;

const WIDTH = 400;
const HEIGHT = 96;

export class MetronSkyCard extends MetronCard<SkyCardConfig, SkyData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .clouds-now {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--m-text-2);
        --mdc-icon-size: 16px;
      }

      .clouds-now b {
        font-family: var(--m-mono);
        font-weight: 500;
        color: var(--m-text);
      }

      .arc svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .ends {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--m-muted);
      }

      .ends b {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 500;
        color: var(--m-text);
      }

      .cells {
        display: grid;
        grid-template-columns: repeat(var(--count, 10), minmax(0, 1fr));
        gap: 3px;
      }

      .cells div {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }

      .cells span {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 26px;
        border-radius: 6px;
        font-family: var(--m-mono);
        font-size: 10px;
      }

      .cells small {
        font-family: var(--m-mono);
        font-size: 9px;
        color: var(--m-muted);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(form.entity('weather', { domain: ['weather'] }), form.powerEntity('solar_power')),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    const weather = findEntity(hass, { domain: 'weather' });

    return weather ? { weather } : {};
  }

  protected parseConfig(raw: RawConfig): SkyCardConfig {
    return {
      ...cfg.base(raw),
      weather: cfg.entity(raw, 'weather'),
      solar_power: cfg.entity(raw, 'solar_power'),
    };
  }

  protected override trackedEntities(config: SkyCardConfig): readonly (string | undefined)[] {
    return [config.weather, config.solar_power];
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override refreshInterval(): number {
    return HOUR / 2;
  }

  protected override async fetchData(config: SkyCardConfig, hass: HomeAssistant): Promise<SkyData> {
    const now = Date.now();
    const [hourly, power] = await Promise.all([
      config.weather ? fetchWeatherForecast(hass, config.weather, 'hourly') : Promise.resolve([]),
      config.solar_power
        ? fetchStatistics(hass, {
            entityIds: [config.solar_power],
            start: addDays(startOfDay(now), -30),
            end: now,
            period: 'hour',
            types: ['mean'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
    ]);
    const reference = new Map<number, number>();

    for (const row of (config.solar_power ? power.get(config.solar_power) : undefined) ?? []) {
      const hour = new Date(row.start).getHours();
      const value = row.mean ?? 0;

      reference.set(hour, Math.max(reference.get(hour) ?? 0, value));
    }

    return { hourly, reference };
  }

  private _location(context: Context): [number, number] | undefined {
    const latitude = context.hass.config?.latitude;
    const longitude = context.hass.config?.longitude;

    return latitude === undefined || longitude === undefined ? undefined : [latitude, longitude];
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, hass, t } = context;
    const title = config.title ?? t('sky.title');
    const location = this._location(context);
    const cloud = attribute<number>(hass, config.weather, 'cloud_coverage');

    if (!location)
      return html`${header(title)}
        <div class="empty">${t('sky.no_location')}</div>`;

    return html`
      ${header(
        title,
        cloud === undefined
          ? nothing
          : html`<span class="clouds-now"
              >${icon('mdi:weather-cloudy')} ${t('sky.cloudiness')}
              <b>${formatNumber(cloud, 0, context.locale)} %</b></span
            >`,
      )}
      ${this._renderArc(context, location)} ${this._renderClouds(context, location)}
      ${stats(this._summary(context, location))}
    `;
  }

  private _renderArc(context: Context, [latitude, longitude]: [number, number]): TemplateResult {
    const { t, locale, now } = context;
    const day = sunDay(now, latitude, longitude);

    if (day.sunrise === undefined || day.sunset === undefined) {
      return html`<div class="empty">${t('sky.polar')}</div>`;
    }

    const sunrise = day.sunrise;
    const sunset = day.sunset;
    const peak = Math.max(1, sunElevation(day.noon, latitude, longitude));
    const x = (time: number): number => ((time - sunrise) / (sunset - sunrise)) * WIDTH;
    const y = (elevation: number): number =>
      HEIGHT - (Math.max(0, elevation) / peak) * (HEIGHT - 12);
    const points = Array.from({ length: 61 }, (_, index) => {
      const time = sunrise + ((sunset - sunrise) * index) / 60;

      return { time, x: x(time), y: y(sunElevation(time, latitude, longitude)) };
    });
    const path = (items: typeof points): string =>
      items
        .map(
          (point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
        )
        .join(' ');
    const past = points.filter((point) => point.time <= now);
    const future = points.filter((point) => point.time >= now);
    const up = now > sunrise && now < sunset;
    const sunX = x(Math.min(sunset, Math.max(sunrise, now)));
    const sunY = y(sunElevation(now, latitude, longitude));

    return html`<div class="section" style="gap:6px">
      <div class="arc">
        <svg viewBox="0 0 ${WIDTH} ${HEIGHT + 2}" aria-hidden="true">
          <line x1="0" x2=${WIDTH} y1=${HEIGHT} y2=${HEIGHT} style="stroke:var(--m-line)"></line>
          <line
            x1=${x(day.noon)}
            x2=${x(day.noon)}
            y1=${HEIGHT - 6}
            y2=${HEIGHT + 2}
            style="stroke:var(--m-muted)"
          ></line>
          ${past.length > 1 ? svg`<path d=${path(past)} style="fill:none;stroke:var(--m-solar)" stroke-width="2.5" stroke-linecap="round"></path>` : nothing}
          ${
            future.length > 1
              ? svg`<path d=${path(future)} style="fill:none;stroke:var(--m-solar);stroke-opacity:0.45" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"></path>`
              : nothing
          }
          ${
            up
              ? svg`<circle cx=${sunX} cy=${sunY} r="14" style="fill:var(--m-solar);fill-opacity:0.18"></circle>
                <circle cx=${sunX} cy=${sunY} r="7" style="fill:var(--m-solar)"></circle>
                <text x=${sunX + 16} y=${sunY + 4} style="fill:var(--m-text);font-family:var(--m-mono);font-size:11px;font-weight:600">${formatTime(now, locale)}</text>`
              : nothing
          }
        </svg>
      </div>
      <div class="ends">
        <span><b>${formatTime(sunrise, locale)}</b> ${t('sky.sunrise')}</span>
        <span>${t('sky.noon')} <b>${formatTime(day.noon, locale)}</b></span>
        <span>${t('sky.sunset')} <b>${formatTime(sunset, locale)}</b></span>
      </div>
    </div>`;
  }

  private _renderClouds(
    context: Context,
    [latitude, longitude]: [number, number],
  ): TemplateResult | typeof nothing {
    const { data, t, now } = context;

    if (!data || data.hourly.length === 0) return nothing;

    const today = sunDay(now, latitude, longitude);
    const after = today.sunset !== undefined && now > today.sunset;
    const day = after ? sunDay(addDays(now, 1), latitude, longitude) : today;
    const from = after ? (day.sunrise ?? now) : now - HOUR;
    const to = day.sunset ?? from + 12 * HOUR;
    const hours = data.hourly
      .map((item) => ({ time: Date.parse(item.datetime), cloud: item.cloud_coverage }))
      .filter((item) => item.time >= from && item.time <= to && item.cloud !== undefined)
      .slice(0, 12);

    if (hours.length === 0) return nothing;

    return html`<div class="section" style="gap:6px">
      <div class="section-head">
        <span class="label">${after ? t('sky.clouds_tomorrow') : t('sky.clouds_hourly')}</span>
        <span class="label">${t('sky.weather_forecast')}</span>
      </div>
      <div class="cells" style="--count:${hours.length}">
        ${hours.map((item) => {
          const cloud = item.cloud ?? 0;
          const current = now >= item.time && now < item.time + HOUR;

          return html`<div>
            <span
              style="background:color-mix(in srgb, var(--m-text-2) ${(8 + (55 * cloud) / 100).toFixed(0)}%, transparent);${current ? 'box-shadow:inset 0 0 0 1.5px var(--m-text)' : ''}"
              >${formatNumber(cloud, 0, context.locale)}</span
            >
            <small style=${current ? 'color:var(--m-text)' : ''}
              >${String(new Date(item.time).getHours()).padStart(2, '0')}</small
            >
          </div>`;
        })}
      </div>
    </div>`;
  }

  private _summary(context: Context, [latitude, longitude]: [number, number]): StatItem[] {
    const { config, hass, data, t, locale, now } = context;
    const today = sunDay(now, latitude, longitude);
    const yesterday = sunDay(addDays(now, -1), latitude, longitude);
    const length = (day: typeof today): number | undefined =>
      day.sunrise === undefined || day.sunset === undefined
        ? undefined
        : (day.sunset - day.sunrise) / MINUTE;
    const todayLength = length(today);
    const yesterdayLength = length(yesterday);
    const elevation =
      attribute<number>(hass, 'sun.sun', 'elevation') ?? sunElevation(now, latitude, longitude);
    const items: StatItem[] = [];

    if (todayLength !== undefined) {
      items.push({
        label: t('sky.day_length'),
        value: formatDuration(todayLength, t),
        sub:
          yesterdayLength === undefined
            ? undefined
            : t('sky.vs_yesterday', {
                value: formatSigned(todayLength - yesterdayLength, 0, locale),
              }),
      });
    }

    items.push({
      label: t('sky.elevation'),
      value: `${formatNumber(elevation, 0, locale)}°`,
      sub: t('sky.max_at', {
        value: formatNumber(sunElevation(today.noon, latitude, longitude), 0, locale),
        time: formatTime(today.noon, locale),
      }),
    });

    const power = readNumber(hass, config.solar_power, 'power');
    const reference = data?.reference.get(new Date(now).getHours());

    if (power !== undefined && reference && elevation > 0) {
      const current = formatPower(power, locale);
      const best = formatPower(reference, locale);

      items.push({
        label: t('sky.of_clear'),
        value: formatNumber(Math.min(100, (power / reference) * 100), 0, locale),
        unit: '%',
        tone: 'solar',
        sub: t('sky.of_clear_note', { value: current.value, best: `${best.value} ${best.unit}` }),
      });
    }

    return items;
  }
}
