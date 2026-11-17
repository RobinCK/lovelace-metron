import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { formatDate, formatMoney, formatMonth, formatNumber, unitText } from '../../core/format';
import { addMonths, daysInMonth, startOfMonth } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  balanceOf,
  counterSeries,
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveGas,
  resolveSources,
} from '../shared/energy-sources';
import type { Balance, EnergyConfig } from '../shared/energy-sources';
import { currencyOf, parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';

export interface MoneyCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly gas: readonly string[];
  readonly electricity_price?: Price;
  readonly gas_price?: Price;
  readonly export_price?: Price;
  readonly netting: boolean;
  readonly currency?: string;
  readonly note?: string;
}

interface MoneyData {
  readonly start: number;
  readonly now: number;
  readonly balance: Balance;
  readonly gas?: number;
}

type Context = CardContext<MoneyCardConfig, MoneyData>;

interface Bill {
  readonly imported: number;
  readonly exported: number;
  readonly billedImport: number;
  readonly billedExport: number;
  readonly electricity: number;
  readonly exportIncome: number;
  readonly gas: number;
  readonly withoutSolar?: number;
  readonly saved?: number;
  readonly total: number;
}

export class MetronMoneyCard extends MetronCard<MoneyCardConfig, MoneyData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .summary {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
      }

      .summary > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .summary > div:last-child {
        align-items: flex-end;
        text-align: right;
      }

      .compare {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr) auto;
        gap: 8px 10px;
        align-items: center;
        font-size: 11px;
        color: var(--m-muted);
      }

      .compare .bar {
        position: relative;
        height: 12px;
        overflow: hidden;
        border-radius: 3px;
        background: var(--m-track);
      }

      .compare .bar i {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        border-radius: 3px;
      }

      .compare .bar.outline i {
        background: none;
        box-shadow: inset 0 0 0 1.5px var(--m-grid);
      }

      .compare .bar em {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--m-mono);
        font-size: 9px;
        font-style: normal;
        color: var(--m-ok);
      }

      .compare b {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 500;
        text-align: right;
        white-space: nowrap;
        color: var(--m-text);
      }

      .lines .row b {
        font-family: var(--m-mono);
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
      }

      .lines .row small {
        display: block;
        font-size: 10px;
        color: var(--m-muted);
      }

      .lines .row.total {
        border-top: 1px solid var(--m-text-2);
      }

      .footnote {
        font-size: 10px;
        line-height: 1.4;
        color: var(--m-muted);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(
        form.number('electricity_price', { min: 0, step: 0.01 }),
        form.number('export_price', { min: 0, step: 0.01 }),
      ),
      form.grid(form.number('gas_price', { min: 0, step: 0.01 }), form.text('currency')),
      form.entities('gas', { domain: ['sensor'], deviceClass: ['gas'] }),
      form.grid(form.toggle('netting'), form.text('note')),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { electricity_price: 4.32 };
  }

  protected parseConfig(raw: RawConfig): MoneyCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      gas: cfg.entityIds(raw, 'gas'),
      electricity_price: parsePrice(raw, 'electricity_price'),
      gas_price: parsePrice(raw, 'gas_price'),
      export_price: parsePrice(raw, 'export_price'),
      netting: cfg.boolean(raw, 'netting', true),
      currency: cfg.text(raw, 'currency'),
      note: cfg.text(raw, 'note'),
    };
  }

  protected override trackedEntities(config: MoneyCardConfig): readonly (string | undefined)[] {
    return [config.electricity_price, config.gas_price, config.export_price].map((price) =>
      typeof price === 'string' ? price : undefined,
    );
  }

  protected override cardSize(): number {
    return 8;
  }

  protected override defaultSize(): SizeSetting {
    return 'large';
  }

  protected override async fetchData(
    config: MoneyCardConfig,
    hass: HomeAssistant,
  ): Promise<MoneyData> {
    const now = Date.now();
    const start = startOfMonth(now);
    const end = addMonths(start, 1);
    const sources = await resolveSources(hass, config.energy);
    const gasIds =
      config.gas_price === undefined
        ? []
        : await resolveGas(hass, config.gas, config.energy.energy_dashboard);
    const [energy, gas] = await Promise.all([
      fetchEnergyStatistics(hass, sources, start - HOUR, end, 'day'),
      gasIds.length > 0
        ? fetchStatistics(hass, {
            entityIds: gasIds,
            start: start - DAY,
            end,
            period: 'day',
            types: ['change', 'state'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
    ]);
    const live = { hass, now };

    return {
      start,
      now,
      balance: balanceOf(energySeries(energy, sources, [start], end, live)),
      gas:
        gasIds.length > 0 ? counterSeries(gas, gasIds, [start], end, live, 'volume')[0] : undefined,
    };
  }

  private _bill(context: Context, data: MoneyData): Bill {
    const { config, hass } = context;
    const electricityPrice = priceOf(hass, config.electricity_price) ?? 0;
    const exportPrice = priceOf(hass, config.export_price) ?? 0;
    const gasPrice = priceOf(hass, config.gas_price) ?? 0;
    const imported = data.balance.import ?? 0;
    const exported = data.balance.export ?? 0;
    const net = imported - exported;
    const billedImport = config.netting ? Math.max(0, net) : imported;
    const billedExport = config.netting ? Math.max(0, -net) : exported;
    const electricity = billedImport * electricityPrice;
    const exportIncome = billedExport * exportPrice;
    const gas = (data.gas ?? 0) * gasPrice;
    const withoutSolar =
      data.balance.home === undefined ? undefined : data.balance.home * electricityPrice;

    return {
      imported,
      exported,
      billedImport,
      billedExport,
      electricity,
      exportIncome,
      gas,
      withoutSolar,
      saved: withoutSolar === undefined ? undefined : withoutSolar - electricity + exportIncome,
      total: electricity + gas - exportIncome,
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, size, t, locale, now } = context;
    const title = config.title ?? t('money.title', { month: formatMonth(now, locale, true) });

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const bill = this._bill(context, data);
    const currency = currencyOf(hass, config.currency);
    const money = (value: number | undefined): string => formatMoney(value, locale, currency);
    const elapsed = Math.max(1, (data.now - data.start) / DAY);
    const forecast = (bill.total * daysInMonth(data.start)) / elapsed;
    const savedShare = bill.withoutSolar ? (bill.saved ?? 0) / bill.withoutSolar : undefined;
    const range = `${formatDate(data.start, locale, { day: 'numeric' })}–${formatDate(data.now, locale)}`;

    return html`
      ${header(title, meta(range))}
      <div class="summary">
        <div>
          <span class="label"
            >${config.gas_price === undefined ? t('money.accrued_electricity') : t('money.accrued')}</span
          >
          <span class="big" style="font-size:34px">${money(bill.total)}</span>
          <span class="label"
            >${t('money.forecast', { value: money(Math.round(forecast / 10) * 10) })}</span
          >
        </div>
        ${
          bill.saved === undefined
            ? nothing
            : html`<div>
                <span class="label">${t('money.saved')}</span>
                <span class="big" style="color:var(--m-ok)">${money(bill.saved)}</span>
                <span class="label"
                  >${t('money.saved_share', { value: formatNumber((savedShare ?? 0) * 100, 0, locale) })}</span
                >
              </div>`
        }
      </div>
      ${size === 'small' ? nothing : this._renderElectricity(context, bill, money)}
      ${size === 'auto' || size === 'large' ? this._renderNetting(context, bill) : nothing}
      ${size === 'small' ? nothing : this._renderLines(context, bill, data, money)}
      ${size === 'auto' || size === 'large' ? this._footnote(context) : nothing}
    `;
  }

  private _renderElectricity(
    context: Context,
    bill: Bill,
    money: (value: number | undefined) => string,
  ): TemplateResult | typeof nothing {
    const { t } = context;

    if (bill.withoutSolar === undefined || bill.withoutSolar <= 0) return nothing;

    const share = Math.min(1, bill.electricity / bill.withoutSolar);

    return html`<div class="section" data-drop="3">
      <span class="eyebrow">${t('money.electricity')}</span>
      <div class="compare">
        <span>${t('money.without_solar')}</span>
        <div class="bar"><i style="width:100%;background:var(--m-text-2);opacity:0.45"></i></div>
        <b>${money(bill.withoutSolar)}</b>
        <span>${t('money.with_solar')}</span>
        <div class="bar">
          <i style="width:${(share * 100).toFixed(1)}%;background:var(--m-grid)"></i>
          <em style="left:${(share * 100).toFixed(1)}%">−${money(bill.saved)}</em>
        </div>
        <b>${money(bill.electricity)}</b>
      </div>
    </div>`;
  }

  private _renderNetting(context: Context, bill: Bill): TemplateResult | typeof nothing {
    const { t, locale } = context;
    const scale = Math.max(bill.imported, bill.exported);

    if (scale <= 0) return nothing;

    const net = bill.imported - bill.exported;

    return html`<div class="section">
      <div class="section-head">
        <span class="eyebrow">${t('money.netting')}</span
        ><span class="meta">${unitText('kWh', locale)}</span>
      </div>
      <div class="compare">
        <span>${t('stats.import_total')}</span>
        <div class="bar">
          <i
            style="width:${((bill.imported / scale) * 100).toFixed(1)}%;background:var(--m-grid)"
          ></i>
        </div>
        <b>${formatNumber(bill.imported, 1, locale)}</b>
        <span>${t('stats.export_total')}</span>
        <div class="bar outline">
          <i style="width:${((bill.exported / scale) * 100).toFixed(1)}%"></i>
        </div>
        <b>${formatNumber(bill.exported, 1, locale)}</b>
      </div>
      <span class="label"
        >${net >= 0 ? t('stats.net_from_grid') : t('stats.net_to_grid')}
        <b class="mono"
          >${formatNumber(Math.abs(net), 1, locale)} ${unitText('kWh', locale)}</b
        ></span
      >
    </div>`;
  }

  private _renderLines(
    context: Context,
    bill: Bill,
    data: MoneyData,
    money: (value: number | undefined) => string,
  ): TemplateResult {
    const { config, hass, t, locale } = context;
    const kwh = unitText('kWh', locale);
    const m3 = unitText('m³', locale);
    const electricityPrice = priceOf(hass, config.electricity_price);
    const exportPrice = priceOf(hass, config.export_price);
    const gasPrice = priceOf(hass, config.gas_price);
    const currency = currencyOf(hass, config.currency);
    const price = (value: number | undefined): string => formatMoney(value, locale, currency, 2);

    return html`<div class="rows lines">
      <div class="row">
        <span class="name"
          >${t('money.electricity_line')}<small
            >${formatNumber(bill.billedImport, 1, locale)} ${kwh} ×
            ${price(electricityPrice)}</small
          ></span
        >
        <b>${money(bill.electricity)}</b>
      </div>
      ${
        config.gas_price === undefined
          ? nothing
          : html`<div class="row">
              <span class="name"
                >${t('money.gas_line')}<small
                  >${formatNumber(data.gas, 1, locale)} ${m3} × ${price(gasPrice)}</small
                ></span
              >
              <b>${money(bill.gas)}</b>
            </div>`
      }
      ${
        config.export_price === undefined
          ? nothing
          : html`<div class="row">
              <span class="name"
                >${t('money.export_line')}<small
                  >${formatNumber(bill.billedExport, 1, locale)} ${kwh} ×
                  ${price(exportPrice)}${
                    config.netting && bill.billedExport <= 0 ? ` · ${t('money.no_surplus')}` : ''
                  }</small
                ></span
              >
              <b style="color:${bill.exportIncome > 0 ? 'var(--m-ok)' : 'var(--m-muted)'}"
                >${bill.exportIncome > 0 ? '+' : ''}${money(bill.exportIncome)}</b
              >
            </div>`
      }
      <div class="row total">
        <span class="name"
          ><b style="font-family:inherit;font-size:13px">${t('common.total')}</b></span
        >
        <b>${money(bill.total)}</b>
      </div>
    </div>`;
  }

  private _footnote(context: Context): TemplateResult | typeof nothing {
    const { config, t } = context;
    const note =
      config.note ??
      (config.netting && config.export_price !== undefined ? t('money.netting_note') : undefined);

    return note ? html`<div class="footnote">${note}</div>` : nothing;
  }
}
