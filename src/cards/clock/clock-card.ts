import { css, html, nothing, svg } from 'lit';
import type { CSSResultGroup, SVGTemplateResult, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { fetchSolarForecast } from '../../core/data/forecast';
import type { HourlyEnergy } from '../../core/data/forecast';
import { formatEnergy, formatNumber, formatPercent, formatTime, unitText } from '../../core/format';
import { startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, legend, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { elementHover, tipValue } from '../../ui/tip';
import type { Tip, TipRow } from '../../ui/tip';
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

const HIT_INNER = HOME_BASE - 4;
const HIT_OUTER = SOLAR_BASE + SOLAR_LENGTH + 4;

const angle = (hour: number): number => (hour - 12) * 15;

const point = (radius: number, degrees: number): string => {
  const radians = (degrees * Math.PI) / 180;

  return `${(CENTER + radius * Math.sin(radians)).toFixed(2)},${(CENTER - radius * Math.cos(radians)).toFixed(2)}`;
};

const wedge = (hour: number): string => {
  const from = angle(hour);
  const to = angle(hour + 1);

  return [
    `M${point(HIT_INNER, from)}`,
    `L${point(HIT_OUTER, from)}`,
    `A${HIT_OUTER},${HIT_OUTER} 0 0 1 ${point(HIT_OUTER, to)}`,
    `L${point(HIT_INNER, to)}`,
    `A${HIT_INNER},${HIT_INNER} 0 0 0 ${point(HIT_INNER, from)}`,
    'Z',
  ].join(' ');
};

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
        position: relative;
        flex: 0 1 auto;
        height: ${SIZE}px;
      }

      .dial svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }

      .compact {
        display: grid;
        grid-template-columns: 108px minmax(0, 1fr);
        align-items: center;
        gap: 20px;
      }

      .dial.fit {
        flex: 1 1 auto;
        height: auto !important;
      }

      .dial.mini {
        height: 108px;
        min-height: 0;
      }

      .side-row b small {
        font-family: var(--ha-font-family-body, inherit);
        font-size: 11px;
        font-weight: 400;
        color: var(--m-muted);
      }

      .side-row b {
        color: var(--tone, var(--m-text));
      }

      .hit {
        fill: transparent;
      }

      .hit:hover {
        fill: color-mix(in srgb, var(--m-text) 9%, transparent);
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

  protected override defaultSize(): SizeSetting {
    return 'medium';
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
    const { config, data, size, t } = context;
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

    if (size === 'small') {
      return html`${head}
        <div class="compact">
          <div class="dial mini">${this._dial(context, data, true)}</div>
          <div class="side-list">
            ${this._summary(context, data).map(
              (item) =>
                html`<div class="side-row" style=${item.tone ? `--tone:var(--m-${item.tone})` : ''}>
                  <span>${item.label}</span><b>${item.value}<small> ${item.unit ?? ''}</small></b>
                </div>`,
            )}
          </div>
        </div>`;
    }

    const height = size === 'large' ? 400 : size === 'medium' ? 236 : SIZE;

    return html`
      ${head}
      <div
        class="dial ${size === 'large' ? 'fit' : ''}"
        style="height:${height}px;min-height:${Math.min(height, 150)}px"
        data-drop="1"
      >
        ${this._dial(context, data, false)}
      </div>
      ${stats(this._summary(context, data))}
    `;
  }

  private _dial(context: Context, data: ClockData, mini: boolean): TemplateResult {
    const { t, locale, now } = context;
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

    return html`<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label=${t('clock.label')}>
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
      ${
        mini
          ? nothing
          : svg`${labels.map((label) => {
              const radians = (angle(label.hour) * Math.PI) / 180;
              const radius = HOME_BASE - 14;

              return svg`<text x=${CENTER + radius * Math.sin(radians)} y=${CENTER - radius * Math.cos(radians) + 3} text-anchor="middle" style="fill:var(--m-muted);font-family:var(--m-mono);font-size:9px">${label.text}</text>`;
            })}
                <text x=${CENTER} y=${CENTER - 12} text-anchor="middle" style="fill:var(--m-muted);font-size:10px">${t('common.today').toLowerCase()}</text>
                <text x=${CENTER} y=${CENTER + 8} text-anchor="middle" style="fill:var(--m-solar);font-family:var(--m-mono);font-size:20px;font-weight:500">${formatNumber(balance.solar, 1, locale)}</text>
                <text x=${CENTER} y=${CENTER + 24} text-anchor="middle" style="fill:var(--m-home);font-family:var(--m-mono);font-size:12px">${formatNumber(balance.home, 1, locale)} ${kwh}</text>`
      }
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
      ${Array.from({ length: 24 }, (_, hour) => {
        const hover = elementHover(() => this._tip(context, data, hour));

        return svg`<path class="hit" d=${wedge(hour)} @pointermove=${hover.move} @pointerdown=${hover.move} @pointerleave=${hover.leave}></path>`;
      })}
    </svg>`;
  }

  private _tip(context: Context, data: ClockData, hour: number): Tip {
    const { locale, now, t } = context;
    const from = data.start + hour * HOUR;
    const done = from < now;
    const solar = done ? data.series.solar[hour] : undefined;
    const forecast = data.forecast[hour];
    const home = done ? data.series.home[hour] : undefined;
    const rows: TipRow[] = [];

    if (solar !== undefined) {
      rows.push({
        label: t('flow.solar'),
        value: tipValue(formatEnergy(solar, locale)),
        color: 'var(--m-solar)',
      });
    }

    if (forecast !== undefined && (!done || solar === undefined || from + HOUR > now)) {
      rows.push({
        label: t('clock.forecast'),
        value: tipValue(formatEnergy(forecast, locale)),
        color: 'color-mix(in srgb, var(--m-solar) 35%, transparent)',
      });
    }

    if (home !== undefined) {
      rows.push({
        label: t('flow.home'),
        value: tipValue(formatEnergy(home, locale)),
        color: 'var(--m-home)',
      });
    }

    return {
      title: `${formatTime(from, locale)}–${formatTime(from + HOUR, locale)}`,
      rows: rows.length > 0 ? rows : [{ label: t('common.no_data'), value: '' }],
    };
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
