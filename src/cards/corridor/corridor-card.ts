import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { CardSize } from '../../core/size';
import * as cfg from '../../core/config';
import { deviceClass, readNumber } from '../../core/entities';
import {
  formatDuration,
  formatNumber,
  formatSigned,
  formatTime,
  unitText,
} from '../../core/format';
import { median, niceMax, quantile } from '../../core/math';
import { addDays, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, meta, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { slotHover } from '../../ui/tip';
import type { TipRow } from '../../ui/tip';
import { DASHBOARD_ENERGY } from '../shared/energy-sources';
import type { EnergyConfig } from '../shared/energy-sources';
import { fetchHourlyLoad } from '../shared/hourly';

export interface CorridorCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly entity?: string;
  readonly weeks: number;
  readonly low: number;
  readonly high: number;
  readonly same_weekday: boolean;
}

interface Band {
  readonly low?: number;
  readonly median?: number;
  readonly high?: number;
}

interface CorridorData {
  readonly day: number;
  readonly bands: readonly Band[];
  readonly today: readonly (number | undefined)[];
  readonly dailyNorm?: number;
  readonly samples: number;
}

type Context = CardContext<CorridorCardConfig, CorridorData>;

const CHART_HEIGHT = 140;

export class MetronCorridorCard extends MetronCard<CorridorCardConfig, CorridorData> {
  static override maxSize: CardSize = 'medium';

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .plot {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
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
        white-space: nowrap;
      }

      .hours {
        position: relative;
        display: flex;
        gap: 2px;
        height: ${CHART_HEIGHT}px;
        border-bottom: 1px solid var(--m-line);
      }

      .hour {
        position: relative;
        flex: 1 1 0;
      }

      .hour .band {
        position: absolute;
        right: 0;
        left: 0;
        border-radius: 3px;
        background: color-mix(in srgb, var(--m-text-2) 22%, transparent);
      }

      .hour .median {
        position: absolute;
        right: 0;
        left: 0;
        height: 2px;
        background: var(--m-text-2);
      }

      .hour .today {
        position: absolute;
        bottom: 0;
        left: 28%;
        right: 28%;
        border-radius: 2px 2px 0 0;
      }

      .note {
        position: absolute;
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
        color: var(--m-warn);
      }

      .legend i.median {
        height: 2px;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.consumptionEntity(),
      form.grid(form.number('weeks', { min: 2, max: 12 }), form.toggle('same_weekday')),
      form.grid(
        form.number('low', { min: 0, max: 49, unit: '%' }),
        form.number('high', { min: 51, max: 100, unit: '%' }),
      ),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): CorridorCardConfig {
    return {
      ...cfg.base(raw),
      energy: DASHBOARD_ENERGY,
      entity: cfg.entity(raw, 'entity'),
      weeks: cfg.number(raw, 'weeks', 6, { min: 2, max: 12 }),
      low: cfg.number(raw, 'low', 10, { min: 0, max: 49 }) / 100,
      high: cfg.number(raw, 'high', 90, { min: 51, max: 100 }) / 100,
      same_weekday: cfg.boolean(raw, 'same_weekday', true),
    };
  }

  protected override trackedEntities(config: CorridorCardConfig): readonly (string | undefined)[] {
    return [config.entity];
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override refreshInterval(): number {
    return 10 * MINUTE;
  }

  protected override async fetchData(
    config: CorridorCardConfig,
    hass: HomeAssistant,
  ): Promise<CorridorData> {
    const now = Date.now();
    const day = startOfDay(now);
    const start = addDays(day, -7 * config.weeks);
    const samples = await fetchHourlyLoad(hass, config.entity, config.energy, start, now);
    const weekday = new Date(day).getDay();
    const history = samples.filter(
      (sample) =>
        sample.time < day && (!config.same_weekday || new Date(sample.time).getDay() === weekday),
    );
    const byHour = Array.from({ length: 24 }, () => [] as number[]);
    const totals = new Map<number, number>();

    for (const sample of history) {
      byHour[new Date(sample.time).getHours()]?.push(sample.value);

      const key = startOfDay(sample.time);

      totals.set(key, (totals.get(key) ?? 0) + sample.value);
    }

    const today = Array.from(
      { length: 24 },
      (_, hour) => samples.find((sample) => sample.time === day + hour * HOUR)?.value,
    );

    return {
      day,
      bands: byHour.map((values) => ({
        low: quantile(values, config.low),
        median: median(values),
        high: quantile(values, config.high),
      })),
      today,
      dailyNorm: median([...totals.values()]),
      samples: totals.size,
    };
  }

  private _todayValues(context: Context, data: CorridorData): (number | undefined)[] {
    const { config, hass, now } = context;
    const hour = new Date(now).getHours();
    const live =
      config.entity && deviceClass(hass, config.entity) !== 'energy'
        ? readNumber(hass, config.entity, 'power')
        : undefined;

    return data.today.map((value, index) =>
      index === hour && value === undefined && live !== undefined ? live / 1000 : value,
    );
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, size, t, locale, now } = context;
    const small = size === 'small';
    const chart = small ? 96 : size === 'medium' ? 156 : CHART_HEIGHT;
    const title = config.title ?? t('corridor.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const weekday = new Intl.DateTimeFormat(locale.timeLocale, { weekday: 'long' }).format(now);
    const scope = config.same_weekday
      ? t('corridor.scope_weekday', { count: data.samples, weekday })
      : t('corridor.scope_days', { count: data.samples });
    const today = this._todayValues(context, data);
    const max = niceMax(
      Math.max(1, ...data.bands.map((band) => band.high ?? 0), ...today.map((value) => value ?? 0)),
    );
    const px = (value: number): number => (Math.min(max, Math.max(0, value)) / max) * chart;
    const currentHour = new Date(now).getHours();
    const outside = today.map((value, hour) => {
      const band = data.bands[hour];

      if (value === undefined || band?.low === undefined || band.high === undefined) return 0;
      if (value > band.high) return value - band.high;
      if (value < band.low) return value - band.low;

      return 0;
    });
    const lastOut = outside.reduce((found, value, hour) => (value !== 0 ? hour : found), -1);
    const kw = unitText('kW', locale);
    const value = (number: number | undefined): string =>
      number === undefined ? '—' : `${formatNumber(number, 2, locale)} ${kw}`;
    const hover = slotHover(data.bands.length, (hour) => {
      const band = data.bands[hour];
      const rows: TipRow[] = [];

      if (today[hour] !== undefined) {
        rows.push({
          label: t('common.today'),
          value: value(today[hour]),
          color: outside[hour] !== 0 ? 'var(--m-warn)' : 'var(--m-home)',
        });
      }

      if (band?.median !== undefined) {
        rows.push({
          label: t('corridor.median'),
          value: value(band.median),
          color: 'var(--m-text-2)',
        });
      }

      if (band?.low !== undefined && band.high !== undefined) {
        rows.push({
          label: t('corridor.range'),
          value: `${formatNumber(band.low, 2, locale)}–${value(band.high)}`,
          color: 'color-mix(in srgb, var(--m-text-2) 35%, transparent)',
        });
      }

      return rows.length === 0
        ? undefined
        : {
            title: `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
            rows,
          };
    });

    return html`
      ${header(title, meta(scope))}
      <div class="legend" style=${size === 'auto' || size === 'large' ? '' : 'display:none'}>
        <span
          ><i style="--c:color-mix(in srgb, var(--m-text-2) 35%, transparent)"></i>${t(
            'corridor.usual',
            {
              low: Math.round(config.low * 100),
              high: Math.round(config.high * 100),
            },
          )}</span
        >
        <span><i class="median line" style="--c:var(--m-text-2)"></i>${t('corridor.median')}</span>
        <span><i style="--c:var(--m-home)"></i>${t('common.today').toLowerCase()}</span>
        <span><i style="--c:var(--m-warn)"></i>${t('corridor.outside')}</span>
      </div>
      <div class="plot">
        <div class="scale" style="height:${chart}px">
          <span style="top:0">${formatNumber(max, 0, locale)} ${kw}</span>
          <span style="top:50%">${formatNumber(max / 2, 0, locale)}</span>
          <span style="top:100%">0</span>
        </div>
        <div
          class="hours"
          style="height:${chart}px;touch-action:pan-y"
          @pointermove=${hover.move}
          @pointerdown=${hover.move}
          @pointerleave=${hover.leave}
        >
          ${data.bands.map((band, hour) => {
            const current = today[hour];

            return html`<div class="hour">
              ${
                band.low === undefined || band.high === undefined
                  ? nothing
                  : html`<span
                      class="band"
                      style="bottom:${px(band.low).toFixed(1)}px;height:${Math.max(2, px(band.high) - px(band.low)).toFixed(1)}px"
                    ></span>`
              }
              ${band.median === undefined ? nothing : html`<span class="median" style="bottom:${(px(band.median) - 1).toFixed(1)}px"></span>`}
              ${
                current === undefined
                  ? nothing
                  : html`<span
                      class="today"
                      style="height:${px(current).toFixed(1)}px;background:${outside[hour] !== 0 ? 'var(--m-warn)' : 'var(--m-home)'};opacity:${hour === currentHour ? 0.7 : 1}"
                    ></span>`
              }
            </div>`;
          })}
          ${
            lastOut >= 0 && today[lastOut] !== undefined
              ? html`<span
                  class="note"
                  style="bottom:${Math.min(chart - 12, px(today[lastOut] ?? 0) + 4).toFixed(1)}px;${lastOut > 16 ? `right:${(((24 - lastOut) / 24) * 100).toFixed(1)}%` : `left:${(((lastOut + 1) / 24) * 100).toFixed(1)}%`}"
                  >${t((outside[lastOut] ?? 0) > 0 ? 'corridor.above' : 'corridor.below', {
                    value: `${formatSigned(outside[lastOut] ?? 0, 1, locale)} ${kw}`,
                  })}</span
                >`
              : nothing
          }
        </div>
        <span></span>
        ${
          small
            ? nothing
            : axis([
                { at: 0, label: '00' },
                { at: 0.25, label: '06' },
                { at: 0.5, label: '12' },
                { at: 0.75, label: '18' },
                { at: 1, label: '24' },
              ])
        }
      </div>
      ${small ? nothing : stats(this._summary(context, data, today, outside, weekday))}
    `;
  }

  private _summary(
    context: Context,
    data: CorridorData,
    today: readonly (number | undefined)[],
    outside: readonly number[],
    weekday: string,
  ): StatItem[] {
    const { t, locale, now } = context;
    const fraction = (hour: number): number => {
      const start = data.day + hour * HOUR;

      return Math.min(1, Math.max(0, (now - start) / HOUR));
    };

    const used = today.reduce<number>((sum, value, hour) => sum + (value ?? 0) * fraction(hour), 0);
    const norm = data.bands.reduce<number>(
      (sum, band, hour) => sum + (band.median ?? 0) * fraction(hour),
      0,
    );
    const outHours = outside
      .map((value, hour) => (value !== 0 ? hour : -1))
      .filter((hour) => hour >= 0);
    const outMinutes = outHours.reduce((sum, hour) => sum + fraction(hour) * 60, 0);
    const kwh = unitText('kWh', locale);
    const first = outHours[0];
    const last = outHours[outHours.length - 1];

    return [
      {
        label: t('corridor.since_midnight'),
        value: formatNumber(used, 1, locale),
        unit: kwh,
        sub: t('corridor.norm', {
          value: formatNumber(norm, 1, locale),
          delta: norm > 0 ? `${formatSigned((used / norm - 1) * 100, 0, locale)} %` : '—',
        }),
      },
      {
        label: t('corridor.outside_label'),
        value: outMinutes > 0 ? formatDuration(outMinutes, t) : '0',
        tone: outMinutes > 0 ? 'warn' : 'ok',
        sub:
          first === undefined || last === undefined
            ? undefined
            : `${formatTime(data.day + first * HOUR, locale)}–${formatTime(Math.min(now, data.day + (last + 1) * HOUR), locale)}`,
      },
      {
        label: t('corridor.usual_day', { weekday }),
        value: formatNumber(data.dailyNorm, 1, locale),
        unit: kwh,
        sub: t('corridor.daily_median'),
      },
    ];
  }
}
