import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { formatEnergy, formatMoney, formatMonth, formatNumber, unitText } from '../../core/format';
import type { Formatted } from '../../core/format';
import { sunDay } from '../../core/sun';
import { addDays, addMonths, daysInMonth, startOfDay, startOfMonth } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, legend, meta, stats } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig } from '../shared/energy-sources';
import { currencyOf, parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';
import { monthlyBalance, simulateYear, sunShape } from './model';
import type { MonthInput, YearResult } from './model';

export interface ExpansionCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly pv_power: number;
  readonly battery_capacity: number;
  readonly pv_step: number;
  readonly battery_step: number;
  readonly steps: number;
  readonly usable: number;
  readonly efficiency: number;
  readonly price?: Price;
  readonly export_price?: Price;
  readonly netting: boolean;
  readonly currency?: string;
}

interface ExpansionData {
  readonly months: readonly MonthInput[];
  readonly starts: readonly number[];
  readonly loadShape: readonly number[];
}

type Context = CardContext<ExpansionCardConfig, ExpansionData>;

const CHART_HEIGHT = 76;

export class MetronExpansionCard extends MetronCard<ExpansionCardConfig, ExpansionData> {
  static override properties: PropertyDeclarations = {
    _pv: { state: true },
    _battery: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .options {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 8px 10px;
        align-items: center;
        font-size: 13px;
        color: var(--m-text-2);
      }

      .segmented {
        display: flex;
        gap: 2px;
        padding: 3px;
        border-radius: 12px;
        background: var(--m-panel);
      }

      .segmented button {
        flex: 1 1 0;
        min-width: 0;
        padding: 7px 6px;
        border: 0;
        border-radius: 9px;
        background: none;
        color: var(--m-text-2);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }

      .segmented button[aria-pressed='true'] {
        background: var(--m-text);
        color: var(--m-bg);
      }

      .kpis {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .kpis .panel {
        gap: 4px;
        padding: 10px 12px;
      }

      .kpis b {
        overflow: hidden;
        font-family: var(--m-mono);
        font-size: 20px;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .months {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        height: ${CHART_HEIGHT}px;
        border-bottom: 1px solid var(--m-line);
      }

      .month {
        display: flex;
        flex: 1 1 0;
        align-items: flex-end;
        justify-content: center;
        gap: 1px;
        height: 100%;
      }

      .month span {
        flex: 0 1 7px;
        border-radius: 2px 2px 0 0;
      }

      .labels {
        display: flex;
        gap: 4px;
        font-size: 9px;
        color: var(--m-muted);
      }

      .labels span {
        flex: 1 1 0;
        text-align: center;
      }
    `,
  ];

  declare _pv: number;
  declare _battery: number;

  constructor() {
    super();
    this._pv = 1;
    this._battery = 0;
  }

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(
        form.number('pv_power', { min: 0, step: 0.1, unit: 'kWp' }),
        form.number('battery_capacity', { min: 0, step: 0.1, unit: 'kWh' }),
      ),
      form.grid(
        form.number('pv_step', { min: 0.1, step: 0.1, unit: 'kWp' }),
        form.number('battery_step', { min: 0.1, step: 0.1, unit: 'kWh' }),
      ),
      form.grid(form.number('steps', { min: 1, max: 4 }), form.toggle('netting')),
      form.grid(
        form.number('usable', { min: 10, max: 100, unit: '%' }),
        form.number('efficiency', { min: 50, max: 100, unit: '%' }),
      ),
      form.grid(
        form.number('price', { min: 0, step: 0.01 }),
        form.number('export_price', { min: 0, step: 0.01 }),
      ),
      form.text('currency'),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { pv_power: 10, battery_capacity: 10 };
  }

  protected parseConfig(raw: RawConfig): ExpansionCardConfig {
    const pv = cfg.optionalNumber(raw, 'pv_power') ?? 0;
    const battery = cfg.number(raw, 'battery_capacity', 0, { min: 0 });

    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      pv_power: pv,
      battery_capacity: battery,
      pv_step: cfg.number(raw, 'pv_step', Math.max(1, Math.round(pv / 4)), { min: 0.1 }),
      battery_step: cfg.number(raw, 'battery_step', battery > 0 ? battery : 10, { min: 0.1 }),
      steps: cfg.number(raw, 'steps', 2, { min: 1, max: 4 }),
      usable: cfg.number(raw, 'usable', 80, { min: 10, max: 100 }) / 100,
      efficiency: cfg.number(raw, 'efficiency', 95, { min: 50, max: 100 }) / 100,
      price: parsePrice(raw, 'price'),
      export_price: parsePrice(raw, 'export_price'),
      netting: cfg.boolean(raw, 'netting', true),
      currency: cfg.text(raw, 'currency'),
    };
  }

  protected override missingOption(config: ExpansionCardConfig): string | undefined {
    return config.pv_power > 0 ? undefined : 'pv_power';
  }

  protected override cardSize(): number {
    return 7;
  }

  protected override refreshInterval(): number {
    return 6 * HOUR;
  }

  protected override async fetchData(
    config: ExpansionCardConfig,
    hass: HomeAssistant,
  ): Promise<ExpansionData> {
    const now = Date.now();
    const end = startOfMonth(now);
    const starts = Array.from({ length: 12 }, (_, index) => addMonths(end, index - 12));
    const sources = await resolveSources(hass, config.energy);
    const recentStart = addDays(startOfDay(now), -30);
    const [monthly, hourly] = await Promise.all([
      fetchEnergyStatistics(hass, sources, (starts[0] ?? end) - DAY, end, 'month'),
      fetchEnergyStatistics(hass, sources, recentStart, startOfDay(now), 'hour'),
    ]);
    const series = energySeries(monthly, sources, starts, end);
    const hours = Array.from({ length: 30 * 24 }, (_, index) => recentStart + index * HOUR);
    const recent = energySeries(hourly, sources, hours, startOfDay(now));
    const shape = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));

    hours.forEach((time, index) => {
      const value = recent.home[index];
      const slot = shape[new Date(time).getHours()];

      if (value === undefined || !slot) return;

      slot.sum += value;
      slot.count += 1;
    });

    const latitude = hass.config?.latitude ?? 50;
    const longitude = hass.config?.longitude ?? 30;
    const months: MonthInput[] = [];
    const used: number[] = [];

    starts.forEach((start, index) => {
      const generation = series.solar[index];
      const consumption = series.home[index];

      if (generation === undefined || consumption === undefined || consumption <= 0) return;

      const middle = addDays(start, 14);
      const sun = sunDay(middle, latitude, longitude);
      const dayLength =
        sun.sunrise !== undefined && sun.sunset !== undefined
          ? (sun.sunset - sun.sunrise) / HOUR
          : 12;
      const noon = (sun.noon - startOfDay(sun.noon)) / HOUR;

      months.push({
        days: daysInMonth(start),
        generation,
        consumption,
        shape: sunShape(dayLength, noon),
      });
      used.push(start);
    });

    return {
      months,
      starts: used,
      loadShape: shape.map((slot) => (slot.count > 0 ? slot.sum / slot.count : 1)),
    };
  }

  private _option(kind: 'pv' | 'battery', index: number, label: string): TemplateResult {
    const active = (kind === 'pv' ? this._pv : this._battery) === index;

    return html`<button
      type="button"
      aria-pressed=${active ? 'true' : 'false'}
      @click=${(event: Event) => {
        event.stopPropagation();

        if (kind === 'pv') this._pv = index;
        else this._battery = index;
      }}
    >
      ${label}
    </button>`;
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, t, locale } = context;
    const title = config.title ?? t('expansion.title');
    const description = config.netting ? t('expansion.meta_netting') : t('expansion.meta');

    if (!data)
      return html`${header(title, meta(description))}
        <div class="empty">${t('common.loading')}</div>`;
    if (data.months.length === 0) {
      return html`${header(title, meta(description))}
        <div class="empty">${t('expansion.no_history')}</div>`;
    }

    const settings = {
      basePv: config.pv_power,
      loadShape: data.loadShape,
      usable: config.usable,
      efficiency: config.efficiency,
    };
    const steps = Array.from({ length: config.steps + 1 }, (_, index) => index);
    const pvIndex = Math.min(this._pv, config.steps);
    const batteryIndex = Math.min(this._battery, config.steps);
    const current = simulateYear(
      data.months,
      { pv: config.pv_power, battery: config.battery_capacity },
      settings,
    );
    const planned = simulateYear(
      data.months,
      {
        pv: config.pv_power + pvIndex * config.pv_step,
        battery: config.battery_capacity + batteryIndex * config.battery_step,
      },
      settings,
    );
    const price = priceOf(hass, config.price);
    const exportPrice = priceOf(hass, config.export_price) ?? 0;
    const currency = currencyOf(hass, config.currency);
    const balance = (result: YearResult): number | undefined =>
      price === undefined
        ? undefined
        : result.months.reduce(
            (sum, month) => sum + monthlyBalance(month, price, exportPrice, config.netting),
            0,
          );
    const tone = (better: boolean, same: boolean): string =>
      same ? 'var(--m-text)' : better ? 'var(--m-ok)' : 'var(--m-solar)';
    const pvLabel = (index: number): string =>
      index === 0
        ? t('expansion.now', { value: formatNumber(config.pv_power, 1, locale) })
        : `+${formatNumber(index * config.pv_step, 1, locale)} ${t('strings.kwp')}`;
    const batteryLabel = (index: number): string =>
      index === 0
        ? t('expansion.now', { value: formatNumber(config.battery_capacity, 0, locale) })
        : `+${formatNumber(index * config.battery_step, 0, locale)} ${unitText('kWh', locale)}`;
    const nowBalance = balance(current);
    const plannedBalance = balance(planned);
    const maxImport = Math.max(
      1,
      ...current.months.map((month) => month.imported),
      ...planned.months.map((month) => month.imported),
    );
    const pair = (a: number, b: number): [Formatted, Formatted] => {
      const mega = Math.max(Math.abs(a), Math.abs(b)) >= 1000;
      const digits = mega ? 2 : 0;
      const from = mega ? 0 : Number.POSITIVE_INFINITY;

      return [formatEnergy(a, locale, digits, from), formatEnergy(b, locale, digits, from)];
    };

    const [importNow, importNext] = pair(current.imported, planned.imported);
    const [generationNow, generationNext] = pair(current.generated, planned.generated);
    const [exportNow, exportNext] = pair(current.exported, planned.exported);

    return html`
      ${header(title, meta(description))}
      <div class="options">
        <span>${t('expansion.panels')}</span>
        <div class="segmented">
          ${steps.map((index) => this._option('pv', index, pvLabel(index)))}
        </div>
        <span>${t('flow.battery')}</span>
        <div class="segmented">
          ${steps.map((index) => this._option('battery', index, batteryLabel(index)))}
        </div>
      </div>
      <div class="kpis">
        <div class="panel">
          <span class="label">${t('energy.self_sufficiency')}</span>
          <b
            style="color:${tone(planned.selfSufficiency > current.selfSufficiency, Math.abs(planned.selfSufficiency - current.selfSufficiency) < 0.005)}"
            >${formatNumber(planned.selfSufficiency * 100, 0, locale)} %</b
          >
          <span class="label"
            >${t('expansion.was', { value: `${formatNumber(current.selfSufficiency * 100, 0, locale)} %` })}</span
          >
        </div>
        <div class="panel">
          <span class="label">${t('expansion.import_year')}</span>
          <b
            style="color:${tone(planned.imported < current.imported, Math.abs(planned.imported - current.imported) < 5)}"
            >${importNext.value} <small class="unit">${importNext.unit}</small></b
          >
          <span class="label">${t('expansion.was', { value: importNow.value })}</span>
        </div>
        ${
          plannedBalance === undefined || nowBalance === undefined
            ? nothing
            : html`<div class="panel">
                <span class="label">${t('expansion.balance_year')}</span>
                <b
                  style="color:${tone(plannedBalance > nowBalance, Math.abs(plannedBalance - nowBalance) < 50)}"
                  >${plannedBalance >= 0 ? '+' : ''}${formatMoney(plannedBalance, locale, currency)}</b
                >
                <span class="label"
                  >${t('expansion.was', { value: `${nowBalance >= 0 ? '+' : ''}${formatMoney(nowBalance, locale, currency)}` })}</span
                >
              </div>`
        }
      </div>
      <div class="section" style="gap:6px">
        <div class="section-head">
          <span class="label">${t('expansion.import_by_month')}</span>
          ${legend([
            { label: t('expansion.now_short'), color: 'var(--m-track)' },
            { label: t('expansion.with_expansion'), color: 'var(--m-grid)' },
          ])}
        </div>
        <div class="months">
          ${current.months.map(
            (month, index) =>
              html`<div class="month">
                <span
                  style="height:${((month.imported / maxImport) * CHART_HEIGHT).toFixed(1)}px;background:color-mix(in srgb, var(--m-text-2) 40%, transparent)"
                ></span>
                <span
                  style="height:${(((planned.months[index]?.imported ?? 0) / maxImport) * CHART_HEIGHT).toFixed(1)}px;background:var(--m-grid)"
                ></span>
              </div>`,
          )}
        </div>
        <div class="labels">
          ${data.starts.map((start) => html`<span>${formatMonth(start, locale)}</span>`)}
        </div>
      </div>
      ${stats([
        {
          label: t('expansion.generation_year'),
          value: `${generationNow.value} → ${generationNext.value}`,
          unit: generationNext.unit,
        },
        {
          label: t('expansion.export_year'),
          value: `${exportNow.value} → ${exportNext.value}`,
          unit: exportNext.unit,
        },
      ])}
    `;
  }
}
