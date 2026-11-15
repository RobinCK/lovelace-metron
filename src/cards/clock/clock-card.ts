import { css, html, nothing, svg } from 'lit';
import type { CSSResultGroup, SVGTemplateResult, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchSolarForecast } from '../../core/data/forecast';
import type { HourlyEnergy } from '../../core/data/forecast';
import { formatNumber, formatPercent, unitText } from '../../core/format';
import { startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, legend, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  balanceOf,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
  selfSufficiency,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergySeries } from '../shared/energy-sources';

export interface ClockCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly forecast: boolean;
}

interface ClockData {
  readonly start: number;
  readonly series: EnergySeries;
  readonly forecast: readonly (number | undefined)[];
}

type Context = CardContext<ClockCardConfig, ClockData>;

const SIZE = 240;
const CENTER = SIZE / 2;
const HOME_BASE = 56;
const HOME_LENGTH = 22;
const SOLAR_BASE = 84;
const SOLAR_LENGTH = 32;

const angle = (hour: number): number => (hour - 12) * 15;

const bar = (
  hour: number,
  value: number,
  base: number,
  length: number,
  max: number,
  color: string,
  opacity: number,
): SVGTemplateResult | typeof nothing => {
  if (value <= 0 || max <= 0) return nothing;

  const size = Math.max(1.5, (value / max) * length);

  return svg`<rect x=${CENTER - 3} y=${CENTER - base - size} width="6" height=${size} rx="2" transform="rotate(${angle(hour + 0.5)} ${CENTER} ${CENTER})" style="fill:${color};fill-opacity:${opacity}"></rect>`;
};

export class MetronClockCard extends MetronCard<ClockCardConfig, ClockData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .dial {
        display: flex;
        justify-content: center;
      }

      .dial svg {
        width: 100%;
        max-width: ${SIZE}px;
        height: auto;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([form.toggle('forecast'), ...energyFields()]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): ClockCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      forecast: cfg.boolean(raw, 'forecast', true),
    };
  }

  protected override cardSize(): number {
    return 6;
  }

  protected override async fetchData(
    config: ClockCardConfig,
    hass: HomeAssistant,
  ): Promise<ClockData> {
    const now = Date.now();
    const start = startOfDay(now);
    const hours = Array.from({ length: 24 }, (_, index) => start + index * HOUR);
    const sources = await resolveSources(hass, config.energy);
    const [statistics, forecast] = await Promise.all([
      fetchEnergyStatistics(hass, sources, start - HOUR, start + DAY, 'hour'),
      config.forecast
        ? fetchSolarForecast(hass).catch((): HourlyEnergy => new Map())
        : Promise.resolve<HourlyEnergy>(new Map()),
    ]);

    return {
      start,
      series: energySeries(statistics, sources, hours, start + DAY, { hass, now }),
      forecast: hours.map((hour) => forecast.get(hour)),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale, now } = context;
    const title = config.title ?? t('clock.title');
    const head = header(
      title,
      legend([
        { label: t('clock.solar'), color: 'var(--m-solar)' },
        { label: t('clock.home'), color: 'var(--m-home)' },
      ]),
    );

    if (!data)
      return html`${head}
        <div class="empty">${t('common.loading')}</div>`;

    const currentHour = (now - data.start) / HOUR;
    const solar = data.series.solar;
    const home = data.series.home;
    const solarMax = Math.max(
      0.1,
      ...solar.map((value) => value ?? 0),
      ...data.forecast.map((value) => value ?? 0),
    );
    const homeMax = Math.max(0.1, ...home.map((value) => value ?? 0));
    const balance = balanceOf(data.series);
    const needle = angle(currentHour);
    const kwh = unitText('kWh', locale);
    const labels = [
      { hour: 0, text: '00' },
      { hour: 6, text: '06' },
      { hour: 12, text: '12' },
      { hour: 18, text: '18' },
    ];

    return html`
      ${head}
      <div class="dial">
        <svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label=${t('clock.label')}>
          <circle
            cx=${CENTER}
            cy=${CENTER}
            r=${SOLAR_BASE - 3}
            style="fill:none;stroke:var(--m-line)"
          ></circle>
          <circle
            cx=${CENTER}
            cy=${CENTER}
            r=${HOME_BASE - 3}
            style="fill:var(--m-panel);stroke:var(--m-line)"
          ></circle>
          ${Array.from({ length: 24 }, (_, hour) => {
            const past = hour + 1 <= currentHour;
            const actual = solar[hour];
            const value = past || hour < currentHour ? (actual ?? 0) : (data.forecast[hour] ?? 0);

            return bar(
              hour,
              value,
              SOLAR_BASE,
              SOLAR_LENGTH,
              solarMax,
              'var(--m-solar)',
              past || hour < currentHour ? 1 : 0.28,
            );
          })}
          ${Array.from({ length: 24 }, (_, hour) =>
            hour < currentHour
              ? bar(hour, home[hour] ?? 0, HOME_BASE, HOME_LENGTH, homeMax, 'var(--m-home)', 1)
              : nothing,
          )}
          ${labels.map((label) => {
            const radians = (angle(label.hour) * Math.PI) / 180;
            const radius = HOME_BASE - 14;

            return svg`<text x=${CENTER + radius * Math.sin(radians)} y=${CENTER - radius * Math.cos(radians) + 3} text-anchor="middle" style="fill:var(--m-muted);font-family:var(--m-mono);font-size:9px">${label.text}</text>`;
          })}
          <text
            x=${CENTER}
            y=${CENTER - 12}
            text-anchor="middle"
            style="fill:var(--m-muted);font-size:10px"
          >
            ${t('common.today').toLowerCase()}
          </text>
          <text
            x=${CENTER}
            y=${CENTER + 8}
            text-anchor="middle"
            style="fill:var(--m-solar);font-family:var(--m-mono);font-size:20px;font-weight:500"
          >
            ${formatNumber(balance.solar, 1, locale)}
          </text>
          <text
            x=${CENTER}
            y=${CENTER + 24}
            text-anchor="middle"
            style="fill:var(--m-home);font-family:var(--m-mono);font-size:12px"
          >
            ${formatNumber(balance.home, 1, locale)} ${kwh}
          </text>
          <line
            x1=${CENTER}
            y1=${CENTER - SOLAR_BASE + 8}
            x2=${CENTER}
            y2=${CENTER - SOLAR_BASE - SOLAR_LENGTH - 6}
            transform="rotate(${needle} ${CENTER} ${CENTER})"
            style="stroke:var(--m-text);stroke-opacity:0.7"
            stroke-width="2"
            stroke-linecap="round"
          ></line>
        </svg>
      </div>
      ${stats(this._summary(context, data))}
    `;
  }

  private _summary(context: Context, data: ClockData): StatItem[] {
    const { t, locale } = context;
    const balance = balanceOf(data.series);
    const forecast = data.forecast.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const sufficiency = selfSufficiency(balance);
    const items: StatItem[] = [];

    if (balance.solar !== undefined) {
      items.push({
        label: t('flow.solar'),
        value: formatNumber(balance.solar, 1, locale),
        unit:
          forecast > 0
            ? t('clock.of_forecast', { value: formatNumber(forecast, 0, locale) })
            : unitText('kWh', locale),
        tone: 'solar',
      });
    }

    if (balance.home !== undefined) {
      items.push({
        label: t('flow.home'),
        value: formatNumber(balance.home, 1, locale),
        unit: unitText('kWh', locale),
        tone: 'home',
      });
    }

    if (sufficiency !== undefined) {
      items.push({
        label: t('energy.self_sufficiency'),
        value: formatPercent(sufficiency, locale),
        unit: '%',
      });
    }

    return items;
  }
}
