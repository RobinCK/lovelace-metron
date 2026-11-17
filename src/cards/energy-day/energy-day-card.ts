import { css, html, nothing, svg } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, SVGTemplateResult, TemplateResult } from 'lit';
import { DAY, HOUR, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { fetchSolarForecast } from '../../core/data/forecast';
import type { HourlyEnergy } from '../../core/data/forecast';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { readNumber } from '../../core/entities';
import {
  formatDate,
  formatEnergy,
  formatNumber,
  formatPercent,
  formatPower,
  formatTime,
  unitText,
} from '../../core/format';
import { niceMax } from '../../core/math';
import { addDays, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, dotLegend, navigator, shareBar, stats } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { slotHover, tipValue } from '../../ui/tip';
import type { Tip, TipRow } from '../../ui/tip';
import {
  balanceOf,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  hasSources,
  parseEnergyConfig,
  resolveSources,
  selfConsumption,
  selfSufficiency,
} from '../shared/energy-sources';
import type { Balance, EnergyConfig, EnergySeries, Series } from '../shared/energy-sources';

export type ForecastMode = 'auto' | 'off';

export interface EnergyDayCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly solar_power?: string;
  readonly home_power?: string;
  readonly solar_forecast: ForecastMode;
  readonly solar_forecast_entity?: string;
  readonly slot_minutes: number;
  readonly navigation: boolean;
}

interface Peak {
  readonly time: number;
  readonly value: number;
}

interface DayData {
  readonly start: number;
  readonly series: EnergySeries;
  readonly solar: Series;
  readonly home: Series;
  readonly forecast?: Series;
  readonly forecastTotal?: number;
  readonly peak?: Peak;
  readonly empty: boolean;
}

type Context = CardContext<EnergyDayCardConfig, DayData>;

const UP = 92;
const SLOT = 10;

const slotStarts = (start: number, minutes: number): number[] =>
  Array.from(
    { length: Math.round((24 * 60) / minutes) },
    (_, index) => start + index * minutes * MINUTE,
  );

const profileFromPower = (
  stats: StatisticsResult,
  entityId: string | undefined,
  starts: readonly number[],
  minutes: number,
): Series | undefined => {
  const rows = entityId ? stats.get(entityId) : undefined;

  if (!rows || rows.length === 0) return undefined;

  return starts.map((start) => {
    const inside = rows.filter(
      (row) => row.start >= start && row.start < start + minutes * MINUTE && row.mean != null,
    );

    if (inside.length === 0) return undefined;

    return inside.reduce((sum, row) => sum + (row.mean ?? 0), 0) / inside.length / 1000;
  });
};

const profileFromEnergy = (hourly: Series, starts: readonly number[], dayStart: number): Series =>
  starts.map((start) => hourly[Math.floor((start - dayStart) / HOUR)]);

const forecastProfile = (forecast: HourlyEnergy, starts: readonly number[]): Series | undefined => {
  if (forecast.size === 0) return undefined;

  const values = starts.map((start) => {
    const hour = start - (start % HOUR);

    return forecast.get(hour);
  });

  return values.some((value) => value !== undefined) ? values : undefined;
};

const peakOf = (stats: StatisticsResult, entityId: string | undefined): Peak | undefined => {
  const rows = entityId ? stats.get(entityId) : undefined;
  let peak: Peak | undefined;

  for (const row of rows ?? []) {
    const value = row.max ?? row.mean;

    if (value === null || value === undefined) continue;
    if (!peak || value > peak.value) peak = { time: row.start, value: value / 1000 };
  }

  return peak;
};

export class MetronEnergyDayCard extends MetronCard<EnergyDayCardConfig, DayData> {
  static override properties: PropertyDeclarations = {
    _offset: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      .intro {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .hero-line {
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
      }

      .hero-line .unit {
        font-size: 13px;
      }

      .day {
        display: flex;
        flex-direction: column;
      }

      .profile {
        display: flex;
        flex-direction: column;
        padding-top: 20px;
      }

      .plot {
        position: relative;
        flex: 0 1 auto;
        touch-action: pan-y;
      }

      .plot svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .tag {
        position: absolute;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .guide-label {
        position: absolute;
        right: 0;
        font-family: var(--m-mono);
        font-size: 10px;
        color: var(--m-muted);
      }

      .now {
        position: absolute;
        top: -4px;
        bottom: 0;
        width: 1px;
        background: color-mix(in srgb, var(--m-text) 40%, transparent);
      }

      .now span {
        position: absolute;
        top: -16px;
        left: 0;
        padding: 1px 5px;
        border-radius: 4px;
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 600;
        background: var(--m-text);
        color: var(--m-bg);
        transform: translateX(-50%);
      }

      .forecast-tag {
        position: absolute;
        font-size: 10px;
        color: color-mix(in srgb, var(--m-solar) 80%, transparent);
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
      form.grid(form.powerEntity('solar_power'), form.powerEntity('home_power')),
      form.grid(
        form.select('solar_forecast', ['auto', 'off']),
        form.entity('solar_forecast_entity', { domain: ['sensor'], deviceClass: ['energy'] }),
      ),
      form.grid(form.select('slot_minutes', ['30', '60']), form.toggle('navigation')),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): EnergyDayCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      solar_power: cfg.entity(raw, 'solar_power'),
      home_power: cfg.entity(raw, 'home_power'),
      solar_forecast:
        raw.solar_forecast === false
          ? 'off'
          : cfg.oneOf(raw, 'solar_forecast', ['auto', 'off'], 'auto'),
      solar_forecast_entity: cfg.entity(raw, 'solar_forecast_entity'),
      slot_minutes: Number(raw.slot_minutes) === 60 ? 60 : 30,
      navigation: cfg.boolean(raw, 'navigation', true),
    };
  }

  protected override cardSize(): number {
    return 8;
  }

  protected override trackedEntities(config: EnergyDayCardConfig): readonly (string | undefined)[] {
    return [config.solar_forecast_entity];
  }

  protected override async fetchData(
    config: EnergyDayCardConfig,
    hass: HomeAssistant,
  ): Promise<DayData> {
    const now = Date.now();
    const start = startOfDay(addDays(now, this._offset));
    const end = addDays(start, 1);
    const sources = await resolveSources(hass, config.energy);
    const hours = Array.from({ length: 24 }, (_, index) => start + index * HOUR);
    const slots = slotStarts(start, config.slot_minutes);
    const powerIds = [config.solar_power, config.home_power].filter(
      (id): id is string => id !== undefined,
    );
    const [energy, power, forecast] = await Promise.all([
      fetchEnergyStatistics(hass, sources, start - HOUR, end, 'hour'),
      fetchStatistics(hass, {
        entityIds: powerIds,
        start,
        end,
        period: '5minute',
        types: ['mean', 'max'],
      }),
      config.solar_forecast === 'auto' && end > now
        ? fetchSolarForecast(hass).catch((): HourlyEnergy => new Map())
        : Promise.resolve<HourlyEnergy>(new Map()),
    ]);
    const series = energySeries(
      energy,
      sources,
      hours,
      end,
      this._offset === 0 ? { hass, now } : undefined,
    );
    const forecastSlots = forecastProfile(forecast, slots);
    const forecastHours = forecastProfile(forecast, hours);

    return {
      start,
      series,
      solar:
        profileFromPower(power, config.solar_power, slots, config.slot_minutes) ??
        profileFromEnergy(series.solar, slots, start),
      home:
        profileFromPower(power, config.home_power, slots, config.slot_minutes) ??
        profileFromEnergy(series.home, slots, start),
      forecast: forecastSlots,
      forecastTotal: forecastHours?.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      peak: peakOf(power, config.solar_power),
      empty: !hasSources(sources),
    };
  }

  protected override defaultSize(): SizeSetting {
    return 'large';
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, size, t, now } = context;
    const selected = startOfDay(addDays(now, this._offset));
    const ready = data?.start === selected;

    if (data?.empty) {
      return html`<div class="empty">${t('energy.no_sources')}</div>`;
    }

    const balance = ready ? balanceOf(data.series) : {};

    const top = html`<div class="top">
      ${this._renderIntro(context, ready ? data : undefined, balance)}
      ${config.navigation ? this._renderNavigator(context, selected) : nothing}
    </div>`;
    const footer = this._renderFooter(context, balance, ready ? data : undefined);

    if (size === 'small') return html`${top} ${footer}`;

    const plot = size === 'large' ? 176 : size === 'medium' ? 150 : undefined;

    return html`
      ${top}
      <div class="day shrink ${ready ? '' : 'loading'}" data-drop="3">
        ${this._renderProfile(context, ready ? data : undefined, selected, plot)}
      </div>
      ${size === 'medium' ? nothing : this._renderBalance(context, balance)} ${footer}
    `;
  }

  private _title(context: Context): string {
    const { config, t } = context;

    if (config.title !== undefined && config.title !== false) return config.title;
    if (this._offset === 0) return t('energy.title_today');
    if (this._offset === -1) return t('energy.title_yesterday');

    return t('energy.title');
  }

  private _renderIntro(
    context: Context,
    data: DayData | undefined,
    balance: Balance,
  ): TemplateResult {
    const { config, hass, t, locale } = context;
    const solar = balance.solar;
    const hero =
      solar === undefined ? formatEnergy(balance.home, locale) : formatEnergy(solar, locale);
    const forecastTotal =
      this._offset === 0 && config.solar_forecast_entity
        ? readNumber(hass, config.solar_forecast_entity, 'energy')
        : data?.forecastTotal;
    const done = forecastTotal && solar !== undefined ? solar / forecastTotal : undefined;

    return html`<div class="intro">
      ${config.title === false ? nothing : html`<div class="eyebrow">${this._title(context)}</div>`}
      <div class="hero-line">
        <span class="big">${hero.value}</span>
        <span class="unit"
          >${hero.unit} ${solar === undefined ? t('energy.consumed') : t('energy.from_solar')}</span
        >
      </div>
      ${
        forecastTotal
          ? html`<div class="meta">
              ${t('energy.forecast_line', {
                value: formatNumber(forecastTotal, 0, locale),
                unit: unitText('kWh', locale),
                percent: formatPercent(done, locale),
              })}
            </div>`
          : nothing
      }
    </div>`;
  }

  private _renderNavigator(context: Context, selected: number): TemplateResult {
    const { t, locale } = context;

    return navigator({
      label: formatDate(selected, locale),
      previousLabel: t('energy.previous_day'),
      nextLabel: t('energy.next_day'),
      canNext: this._offset < 0,
      previous: () => {
        this._shift(-1);
      },
      next: () => {
        this._shift(1);
      },
    });
  }

  private _shift(delta: number): void {
    this._offset = Math.min(0, this._offset + delta);
    this.reload();
  }

  private _renderProfile(
    context: Context,
    data: DayData | undefined,
    start: number,
    plot: number | undefined,
  ): TemplateResult {
    const { t, locale, now } = context;
    const count = Math.round((24 * 60) / context.config.slot_minutes);
    const solar = data?.solar ?? [];
    const home = data?.home ?? [];
    const forecast = data?.forecast ?? [];
    const values = [...solar, ...home, ...forecast].filter(
      (value): value is number => value !== undefined,
    );
    const max = niceMax(Math.max(1, ...values));
    const scale = UP / max;
    const homeMax = Math.max(0, ...home.map((value) => value ?? 0));
    const down = Math.min(60, Math.max(24, homeMax * scale + 4));
    const height = UP + 1 + down;
    const slotMs = DAY / count;
    const nowFraction = (now - start) / DAY;
    const showNow = nowFraction > 0 && nowFraction < 1;
    const firstFuture = Math.max(0, Math.ceil((now - start) / slotMs));
    const bars: SVGTemplateResult[] = [];

    for (let index = 0; index < count; index++) {
      const slotStart = start + index * slotMs;
      const past = slotStart + slotMs / 2 <= now;
      const actual = solar[index];
      const planned = forecast[index];
      const up = past ? actual : planned;
      const x = index * SLOT + SLOT / 4;

      if (up !== undefined && up > 0) {
        const h = Math.max(1, up * scale);

        bars.push(
          svg`<rect x=${x} y=${UP - h} width=${SLOT / 2} height=${h} rx="1.5" style="fill:var(--m-solar);fill-opacity:${past ? 1 : 0.28}"></rect>`,
        );
      }

      const used = past ? home[index] : undefined;

      if (used !== undefined && used > 0) {
        bars.push(
          svg`<rect x=${x} y=${UP + 1} width=${SLOT / 2} height=${Math.max(1, Math.min(down, used * scale))} rx="1.5" style="fill:var(--m-home)"></rect>`,
        );
      }
    }

    const guide = (value: number): SVGTemplateResult =>
      svg`<line x1="0" x2=${count * SLOT} y1=${UP - value * scale} y2=${UP - value * scale} style="stroke:var(--m-line)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`;

    const share = (value: number): string => `${((value / height) * 100).toFixed(2)}%`;
    const hover = slotHover(count, (index) =>
      this._tip(context, data, start + index * slotMs, slotMs, index),
    );

    const box = plot ?? height;

    return html`<div class="section shrink">
      <div class="profile shrink" role="img" aria-label=${t('energy.profile_label')}>
        <div
          class="plot"
          style="height:${box}px;min-height:${Math.round(box * 0.6)}px"
          @pointermove=${hover.move}
          @pointerdown=${hover.move}
          @pointerleave=${hover.leave}
        >
          <span class="tag" style="left:0;top:2px;color:var(--m-solar)">${t('flow.solar')}</span>
          <span class="guide-label" style="top:2px"
            >${formatNumber(max, 0, locale)} ${unitText('kW', locale)}</span
          >
          <span class="guide-label" style="top:calc(${share(UP / 2)} + 2px)"
            >${formatNumber(max / 2, 0, locale)}</span
          >
          ${
            forecast.length > 0 && firstFuture < count
              ? html`<span
                  class="forecast-tag"
                  style="left:${Math.min(80, (firstFuture / count) * 100 + 2).toFixed(1)}%;top:calc(${share(UP)} - 14px)"
                  >${t('common.forecast')}</span
                >`
              : nothing
          }
          <svg
            viewBox="0 0 ${count * SLOT} ${height}"
            height=${height}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            ${guide(max)}${guide(max / 2)}
            <line
              x1="0"
              x2=${count * SLOT}
              y1=${UP + 0.5}
              y2=${UP + 0.5}
              style="stroke:var(--m-line)"
              vector-effect="non-scaling-stroke"
            ></line>
            ${bars}
          </svg>
          <span class="tag" style="left:0;bottom:0;color:var(--m-home)">${t('flow.home')}</span>
          ${
            showNow
              ? html`<div class="now" style="left:${(nowFraction * 100).toFixed(2)}%">
                  <span>${formatTime(now, locale)}</span>
                </div>`
              : nothing
          }
        </div>
      </div>
      ${axis(
        [
          { at: 0, label: '00' },
          { at: 0.25, label: '06' },
          { at: 0.5, label: '12' },
          { at: 0.75, label: '18' },
          { at: 1, label: '24' },
        ],
        2,
      )}
    </div>`;
  }

  private _tip(
    context: Context,
    data: DayData | undefined,
    from: number,
    length: number,
    index: number,
  ): Tip | undefined {
    const { locale, now, t } = context;

    if (!data) return undefined;

    const past = from + length / 2 <= now;
    const solar = past ? data.solar[index] : undefined;
    const forecast = data.forecast?.[index];
    const home = past ? data.home[index] : undefined;
    const kw = (value: number): string => tipValue(formatPower(value * 1000, locale));
    const rows: TipRow[] = [];

    if (solar !== undefined)
      rows.push({ label: t('flow.solar'), value: kw(solar), color: 'var(--m-solar)' });

    if (!past && forecast !== undefined) {
      rows.push({
        label: t('common.forecast'),
        value: kw(forecast),
        color: 'color-mix(in srgb, var(--m-solar) 35%, transparent)',
      });
    }

    if (home !== undefined)
      rows.push({ label: t('flow.home'), value: kw(home), color: 'var(--m-home)' });

    if (rows.length === 0) return undefined;

    return { title: `${formatTime(from, locale)}–${formatTime(from + length, locale)}`, rows };
  }

  private _renderBalance(context: Context, balance: Balance): TemplateResult | typeof nothing {
    const { t, locale } = context;
    const kwh = unitText('kWh', locale);
    const format = (value: number | undefined): string => formatNumber(value, 1, locale);
    const sources = [
      { label: t('flow.solar'), value: balance.solar, color: 'var(--m-solar)' },
      { label: t('flow.battery'), value: balance.discharge, color: 'var(--m-battery)' },
      { label: t('flow.grid'), value: balance.import, color: 'var(--m-grid)' },
    ].filter((item) => item.value !== undefined);
    const sinks = [
      { label: t('flow.home'), value: balance.home, color: 'var(--m-home)' },
      { label: t('flow.battery'), value: balance.charge, color: 'var(--m-battery)' },
      { label: t('energy.export'), value: balance.export, color: 'var(--m-grid)' },
    ].filter((item) => item.value !== undefined);

    if (sources.length < 2 && sinks.length < 2) return nothing;

    const sum = (items: readonly { readonly value?: number }[]): number =>
      items.reduce((total, item) => total + (item.value ?? 0), 0);

    return html`<div class="section" style="gap:16px" data-drop="1">
      ${
        sources.length >= 2
          ? html`<div class="section">
              <div class="section-head">
                <span class="eyebrow">${t('energy.sources')}</span
                ><span class="meta mono">${format(sum(sources))} ${kwh}</span>
              </div>
              ${shareBar(sources)} ${dotLegend(sources, format)}
            </div>`
          : nothing
      }
      ${
        sinks.length >= 2
          ? html`<div class="section">
              <div class="section-head">
                <span class="eyebrow">${t('energy.destinations')}</span
                ><span class="meta mono">${format(sum(sinks))} ${kwh}</span>
              </div>
              ${shareBar(sinks)} ${dotLegend(sinks, format)}
            </div>`
          : nothing
      }
    </div>`;
  }

  private _renderFooter(
    context: Context,
    balance: Balance,
    data: DayData | undefined,
  ): TemplateResult | typeof nothing {
    const { t, locale } = context;
    const sufficiency = selfSufficiency(balance);
    const consumption = selfConsumption(balance);
    const peak = data?.peak;

    return stats([
      ...(sufficiency === undefined
        ? []
        : [
            {
              label: t('energy.self_sufficiency'),
              value: formatPercent(sufficiency, locale),
              unit: '%',
            },
          ]),
      ...(consumption === undefined
        ? []
        : [
            {
              label: t('energy.self_consumption'),
              value: formatPercent(consumption, locale),
              unit: '%',
            },
          ]),
      ...(peak
        ? [
            {
              label: t('energy.peak_at', { time: formatTime(peak.time, locale) }),
              value: formatNumber(peak.value, 1, locale),
              unit: unitText('kW', locale),
            },
          ]
        : []),
    ]);
  }
}
