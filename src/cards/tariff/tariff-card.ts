import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { CardSize } from '../../core/size';
import * as cfg from '../../core/config';
import { formatDate, formatMoney, formatNumber, unitText } from '../../core/format';
import { firstWeekday } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, meta } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { slotHover } from '../../ui/tip';
import {
  counterSeries,
  energyFields,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergyKey } from '../shared/energy-sources';
import { currencyOf, parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';
import { periodToDate } from '../stats/periods';
import type { PeriodKind } from '../stats/periods';
import { bill, DEFAULT_PLANS, nightFactor, segments, shiftedBill, zone } from './zones';
import type { Plan } from './zones';

const ENERGY: readonly EnergyKey[] = ['import', 'export'];

export interface TariffCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly price?: Price;
  readonly plans: readonly Plan[];
  readonly battery_shift: boolean;
  readonly shift_loss: number;
  readonly period: PeriodKind;
  readonly currency?: string;
}

interface TariffData {
  readonly start: number;
  readonly end: number;
  readonly days: number;
  readonly net: readonly number[];
  readonly imported: readonly number[];
}

type Context = CardContext<TariffCardConfig, TariffData>;

interface Variant {
  readonly name: string;
  readonly value: number;
  readonly base: boolean;
}

const factorColor = (factor: number): string => {
  if (factor < 1) return 'var(--m-ok)';
  if (factor > 1) return 'var(--m-warn)';

  return 'var(--m-track)';
};

const factorText = (factor: number, locale: Context['locale']): string =>
  `×${formatNumber(factor, Number.isInteger(factor) ? 0 : factor * 10 === Math.round(factor * 10) ? 1 : 2, locale)}`;

const parsePlans = (raw: RawConfig): Plan[] =>
  cfg.list(raw, 'plans', (item) => {
    const zones = cfg.list(item, 'zones', (entry) => {
      const from = cfg.text(entry, 'from');
      const to = cfg.text(entry, 'to');
      const factor = cfg.optionalNumber(entry, 'factor');

      return from && to && factor !== undefined ? zone(from, to, factor) : undefined;
    });

    return zones.length > 0 ? { name: cfg.text(item, 'name'), zones } : undefined;
  });

export class MetronTariffCard extends MetronCard<TariffCardConfig, TariffData> {
  static override maxSize: CardSize = 'medium';

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .hours {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        gap: 6px 8px;
        align-items: center;
        font-size: 11px;
        color: var(--m-text-2);
      }

      .histogram {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 52px;
        border-bottom: 1px solid var(--m-line);
        touch-action: pan-y;
      }

      .histogram span {
        flex: 1 1 0;
        border-radius: 2px 2px 0 0;
        background: color-mix(in srgb, var(--m-grid) 70%, transparent);
      }

      .zones {
        position: relative;
        display: flex;
        gap: 2px;
        height: 20px;
      }

      .zones span {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        overflow: hidden;
        border-radius: 4px;
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
      }

      .variants .row {
        grid-template-columns: minmax(0, 1.3fr) minmax(48px, 1fr) auto 64px;
      }

      .variants .bar {
        height: 6px;
        overflow: hidden;
        border-radius: 3px;
        background: var(--m-track);
      }

      .variants .bar i {
        display: block;
        height: 100%;
        border-radius: 3px;
      }

      .delta {
        font-family: var(--m-mono);
        font-size: 12px;
        font-weight: 600;
        text-align: right;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(form.number('price', { min: 0, step: 0.01 }), form.text('currency')),
      form.grid(
        form.select('period', ['day', 'week', 'month', 'year']),
        form.number('shift_loss', { min: 0, max: 50, unit: '%' }),
      ),
      form.toggle('battery_shift'),
      form.object('plans'),
      ...energyFields(ENERGY),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { price: 4.32 };
  }

  protected parseConfig(raw: RawConfig): TariffCardConfig {
    const plans = parsePlans(raw);

    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw, ENERGY),
      price: parsePrice(raw, 'price'),
      plans: plans.length > 0 ? plans : DEFAULT_PLANS,
      battery_shift: cfg.boolean(raw, 'battery_shift', true),
      shift_loss: cfg.number(raw, 'shift_loss', 10, { min: 0, max: 50 }) / 100,
      period: cfg.oneOf(raw, 'period', ['day', 'week', 'month', 'year'], 'month'),
      currency: cfg.text(raw, 'currency'),
    };
  }

  protected override cardSize(): number {
    return 6;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: TariffCardConfig,
    hass: HomeAssistant,
  ): Promise<TariffData> {
    const now = Date.now();
    const range = periodToDate(config.period, now, firstWeekday(hass.locale));
    const sources = await resolveSources(hass, config.energy, ENERGY);
    const statistics = await fetchEnergyStatistics(hass, sources, range.start, range.end, 'hour');
    const hours = Array.from(
      { length: Math.ceil((range.end - range.start) / HOUR) },
      (_, index) => range.start + index * HOUR,
    );
    const imported = counterSeries(statistics, sources.import, hours, range.end);
    const exported = counterSeries(statistics, sources.export, hours, range.end);
    const net = Array.from({ length: 24 }, () => 0);
    const importByHour = Array.from({ length: 24 }, () => 0);

    hours.forEach((time, index) => {
      const hour = new Date(time).getHours();

      net[hour] = (net[hour] ?? 0) + (imported[index] ?? 0) - (exported[index] ?? 0);
      importByHour[hour] = (importByHour[hour] ?? 0) + (imported[index] ?? 0);
    });

    const days = Math.max(1, (range.end - range.start) / (24 * HOUR));

    return {
      start: range.start,
      end: range.end,
      days,
      net,
      imported: importByHour.map((value) => value / days),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, size, t, locale } = context;
    const title = config.title ?? t('tariff.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const price = priceOf(hass, config.price);
    const range = t('tariff.range', {
      range: `${formatDate(data.start, locale, { day: 'numeric' })}–${formatDate(data.end, locale)}`,
    });

    return html`
      ${header(title, meta(range))} ${size === 'small' ? nothing : this._renderZones(context, data)}
      ${price === undefined ? html`<div class="empty">${t('tariff.no_price')}</div>` : this._renderVariants(context, data, price)}
    `;
  }

  private _renderZones(context: Context, data: TariffData): TemplateResult {
    const { config, t, locale } = context;
    const peak = Math.max(0.0001, ...data.imported);
    const first = config.plans[0];
    const firstNight = first ? nightFactor(first) : 1;
    const hover = slotHover(data.imported.length, (hour) => {
      const value = data.imported[hour];

      if (value === undefined) return undefined;

      return {
        title: `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
        rows: [
          {
            label: t('tariff.average_import'),
            value: `${formatNumber(value, 2, locale)} ${unitText('kWh', locale)}`,
            color: 'var(--m-grid)',
          },
        ],
      };
    });

    return html`<div class="section" style="gap:6px">
      <div class="hours">
        <span>${t('tariff.import')}</span>
        <div
          class="histogram"
          @pointermove=${hover.move}
          @pointerdown=${hover.move}
          @pointerleave=${hover.leave}
        >
          ${data.imported.map(
            (value) =>
              html`<span style="height:${Math.max(1, (value / peak) * 52).toFixed(1)}px"></span>`,
          )}
        </div>
        ${config.plans.map(
          (plan, index) =>
            html`<span>${plan.name ?? t('tariff.zones', { count: index + 2 })}</span>
              <div class="zones">
                ${segments(plan).map(
                  (segment) =>
                    html`<span
                      style="flex:${segment.to - segment.from} 1 0;background:${
                        factorColor(segment.factor) === 'var(--m-track)'
                          ? 'var(--m-track)'
                          : `color-mix(in srgb, ${factorColor(segment.factor)} 22%, transparent)`
                      };color:${factorColor(segment.factor) === 'var(--m-track)' ? 'var(--m-muted)' : factorColor(segment.factor)}"
                      >${segment.to - segment.from >= 2 ? factorText(segment.factor, locale) : ''}</span
                    >`,
                )}
              </div>`,
        )}
        <span></span>
        ${axis([
          { at: 0, label: '00' },
          { at: 0.25, label: '06' },
          { at: 0.5, label: '12' },
          { at: 0.75, label: '18' },
          { at: 1, label: '24' },
        ])}
      </div>
      <div class="legend" style=${context.size === 'auto' ? '' : 'display:none'}>
        <span
          ><i style="--c:var(--m-ok)"></i
          >${t('tariff.cheap', { value: factorText(firstNight, locale) })}</span
        >
        <span><i style="--c:var(--m-warn)"></i>${t('tariff.expensive')}</span>
        <span><i style="--c:var(--m-grid)"></i>${t('tariff.average_import')}</span>
      </div>
    </div>`;
  }

  private _renderVariants(context: Context, data: TariffData, price: number): TemplateResult {
    const { config, hass, t, locale } = context;
    const currency = currencyOf(hass, config.currency);
    const base = data.net.reduce((sum, value) => sum + value, 0) * price;
    const first = config.plans[0];
    const variants: Variant[] = [
      { name: t('tariff.single_current'), value: base, base: true },
      ...config.plans.map((plan, index) => ({
        name: plan.name ?? t('tariff.zones', { count: index + 2 }),
        value: bill(plan, data.net, price),
        base: false,
      })),
      ...(config.battery_shift && first
        ? [
            {
              name: t('tariff.battery_shift', {
                name: first.name ?? t('tariff.zones', { count: 2 }),
              }),
              value: shiftedBill(first, data.net, price, config.shift_loss),
              base: false,
            },
          ]
        : []),
    ];
    const max = Math.max(1, ...variants.map((variant) => Math.abs(variant.value)));

    return html`<div class="rows variants">
      ${variants.map((variant, index) => {
        const diff = variant.value - base;
        const saving = diff < 0;
        const color = variant.base ? 'var(--m-text-2)' : saving ? 'var(--m-ok)' : 'var(--m-warn)';

        return html`<div class="row" data-drop=${variants.length - index}>
          <span class="name" style=${variant.base ? 'color:var(--m-text-2)' : ''}
            >${variant.name}</span
          >
          <div class="bar">
            <i
              style="width:${((Math.max(0, variant.value) / max) * 100).toFixed(1)}%;background:${color}"
            ></i>
          </div>
          <span class="num">${formatMoney(variant.value, locale, currency)}</span>
          <span class="delta" style="color:${color}"
            >${variant.base ? '—' : `${saving ? '−' : '+'}${formatMoney(Math.abs(diff), locale, currency)}`}</span
          >
        </div>`;
      })}
    </div>`;
  }
}
