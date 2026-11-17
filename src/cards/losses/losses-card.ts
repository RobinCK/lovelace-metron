import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import { formatDate, formatMoney, formatMonth, formatNumber, unitText } from '../../core/format';
import { firstWeekday } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  counterSeries,
  energyFields,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergyKey } from '../shared/energy-sources';
import { currencyOf, parsePrice, priceOf } from '../shared/prices';
import type { Price } from '../shared/prices';
import { periodToDate } from '../stats/periods';
import type { PeriodKind } from '../stats/periods';

const ENERGY: readonly EnergyKey[] = ['solar'];

export interface LossStage {
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly color?: string;
}

export interface LossesCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly stages: readonly LossStage[];
  readonly price?: Price;
  readonly period: PeriodKind;
  readonly currency?: string;
}

interface StageResult {
  readonly stage: LossStage;
  readonly input: number;
  readonly output: number;
  readonly loss: number;
}

interface LossesData {
  readonly start: number;
  readonly end: number;
  readonly reference?: number;
  readonly stages: readonly StageResult[];
}

type Context = CardContext<LossesCardConfig, LossesData>;

const SHADES = [
  'var(--m-warn)',
  'color-mix(in srgb, var(--m-warn) 70%, var(--m-muted))',
  'color-mix(in srgb, var(--m-warn) 45%, var(--m-muted))',
];

export class MetronLossesCard extends MetronCard<LossesCardConfig, LossesData> {
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
      }

      .summary > div:last-child {
        align-items: flex-end;
        font-size: 11px;
        color: var(--m-muted);
      }

      .summary b {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 500;
        color: var(--m-text);
      }

      .chain {
        display: flex;
        gap: 2px;
        height: 10px;
        overflow: hidden;
        border-radius: 5px;
      }

      .chain-labels {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        color: var(--m-muted);
      }

      .chain-labels b {
        font-family: var(--m-mono);
        font-weight: 400;
      }

      .stages .row {
        grid-template-columns: minmax(0, 1fr) minmax(64px, 120px) 56px;
      }

      .stage {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .stage span:first-child {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }

      .stage span:first-child i {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: var(--c);
      }

      .stage small {
        overflow: hidden;
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--m-muted);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.list(
        'stages',
        {
          name: { selector: { text: {} }, required: true },
          input: {
            selector: { entity: { filter: { domain: 'sensor', device_class: 'energy' } } },
            required: true,
          },
          output: {
            selector: { entity: { filter: { domain: 'sensor', device_class: 'energy' } } },
            required: true,
          },
          color: { selector: { text: {} } },
        },
        'name',
      ),
      form.grid(...energyFields(ENERGY), form.select('period', ['day', 'week', 'month', 'year'])),
      form.grid(form.number('price', { min: 0, step: 0.01 }), form.text('currency')),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { stages: [] };
  }

  protected parseConfig(raw: RawConfig): LossesCardConfig {
    const stages = cfg.list(raw, 'stages', (item): LossStage | undefined => {
      const input = cfg.entity(item, 'input');
      const output = cfg.entity(item, 'output');

      if (!input || !output) return undefined;

      return {
        name: cfg.text(item, 'name') ?? input,
        input,
        output,
        color: cfg.text(item, 'color'),
      };
    });

    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw, ENERGY),
      stages,
      price: parsePrice(raw, 'price'),
      period: cfg.oneOf(raw, 'period', ['day', 'week', 'month', 'year'], 'month'),
      currency: cfg.text(raw, 'currency'),
    };
  }

  protected override missingOption(config: LossesCardConfig): string | undefined {
    return config.stages.length === 0 ? 'stages' : undefined;
  }

  protected override cardSize(config: LossesCardConfig): number {
    return 4 + config.stages.length;
  }

  protected override defaultSize(config: LossesCardConfig): SizeSetting {
    return config.stages.length <= 3 ? 'medium' : 'large';
  }

  protected override refreshInterval(): number {
    return HOUR / 4;
  }

  protected override async fetchData(
    config: LossesCardConfig,
    hass: HomeAssistant,
  ): Promise<LossesData> {
    const now = Date.now();
    const range = periodToDate(config.period, now, firstWeekday(hass.locale));
    const referenceIds = (await resolveSources(hass, config.energy, ENERGY)).solar;
    const ids = [
      ...new Set([
        ...referenceIds,
        ...config.stages.flatMap((stage) => [stage.input, stage.output]),
      ]),
    ];
    const statistics = await fetchStatistics(hass, {
      entityIds: ids,
      start: range.start - HOUR,
      end: range.end,
      period: config.period === 'day' ? 'hour' : 'day',
      types: ['change', 'state'],
    });
    const live = { hass, now };
    const sum = (entities: readonly string[]): number =>
      counterSeries(statistics, entities, [range.start], range.end + 1, live)[0] ?? 0;
    const stages = config.stages.map((stage) => {
      const input = sum([stage.input]);
      const output = sum([stage.output]);

      return { stage, input, output, loss: Math.max(0, input - output) };
    });

    return {
      start: range.start,
      end: range.end,
      reference: referenceIds.length > 0 ? sum(referenceIds) : stages[0]?.input,
      stages,
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, size, t, locale, now } = context;
    const title = config.title ?? t('losses.title', { month: formatMonth(now, locale, true) });

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const kwh = unitText('kWh', locale);
    const lost = data.stages.reduce((sum, item) => sum + item.loss, 0);
    const reference = data.reference ?? 0;
    const useful = Math.max(0, reference - lost);
    const efficiency = reference > 0 ? useful / reference : undefined;
    const price = priceOf(hass, config.price);
    const currency = currencyOf(hass, config.currency);
    const maxLoss = Math.max(0.0001, ...data.stages.map((item) => item.loss));
    const days = Math.max(1, (data.end - data.start) / DAY);
    const largest = [...data.stages].sort((a, b) => b.loss - a.loss)[0];

    return html`
      ${header(
        title,
        efficiency === undefined
          ? undefined
          : meta(t('losses.efficiency', { value: formatNumber(efficiency * 100, 0, locale) })),
      )}
      <div class="summary">
        <div>
          <span class="label"
            >${t('losses.lost_since', { date: formatDate(data.start, locale) })}</span
          >
          <span
            ><span class="big" style="color:var(--m-warn)">${formatNumber(lost, 1, locale)}</span
            ><span class="unit"> ${kwh}</span></span
          >
        </div>
        <div>
          ${
            reference > 0
              ? html`<span
                  ><b>${formatNumber((lost / reference) * 100, 1, locale)} %</b>
                  ${t('losses.of_input')}</span
                >`
              : nothing
          }
          ${
            price === undefined
              ? nothing
              : html`<span
                  >≈ <b>${formatMoney(lost * price, locale, currency)}</b> ${t('losses.at_price', {
                    value: formatNumber(price, 2, locale),
                  })}</span
                >`
          }
        </div>
      </div>
      ${
        reference > 0
          ? html`<div class="section" style="gap:6px">
              <div class="chain">
                <span style="flex:${useful} 1 0;background:var(--m-home)"></span>
                ${data.stages.map(
                  (item, index) =>
                    html`<span
                      style="flex:${item.loss} 1 0;background:${item.stage.color ?? SHADES[index % SHADES.length]}"
                    ></span>`,
                )}
              </div>
              <div class="chain-labels">
                <span>${t('losses.input')} <b>${formatNumber(reference, 1, locale)}</b></span>
                <span
                  >${t('losses.useful')}
                  <b style="color:var(--m-home)">${formatNumber(useful, 1, locale)}</b> ·
                  ${t('losses.losses')}
                  <b style="color:var(--m-warn)">${formatNumber(lost, 1, locale)}</b></span
                >
              </div>
            </div>`
          : nothing
      }
      <div class="rows stages" style=${size === 'small' ? 'display:none' : ''}>
        ${data.stages.map((item, index) => {
          const color = item.stage.color ?? SHADES[index % SHADES.length] ?? 'var(--m-warn)';
          const stageEfficiency = item.input > 0 ? item.output / item.input : undefined;

          return html`<div class="row" data-drop=${data.stages.length - index + 1}>
            <div class="stage" style="--c:${color}">
              <span><i></i>${item.stage.name}</span>
              <small
                >${t('losses.stage_note', {
                  efficiency: formatNumber(
                    stageEfficiency === undefined ? undefined : stageEfficiency * 100,
                    1,
                    locale,
                  ),
                  daily: formatNumber(item.loss / days, 1, locale),
                  unit: kwh,
                })}</small
              >
            </div>
            <div class="track">
              <div style="width:${((item.loss / maxLoss) * 100).toFixed(1)}%;--c:${color}"></div>
            </div>
            <span class="num">${formatNumber(item.loss, 1, locale)}</span>
          </div>`;
        })}
      </div>
      ${
        largest && largest.loss > 0
          ? html`<div class="panels" data-drop="1" style=${size === 'small' ? 'display:none' : ''}>
              <div class="panel">
                <span class="label">${t('losses.per_year', { name: largest.stage.name })}</span>
                <span
                  >≈
                  <span class="xl" style="font-size:20px"
                    >${formatNumber((largest.loss / days) * 365, 0, locale)}</span
                  ><span class="unit"> ${kwh}</span></span
                >
              </div>
              ${
                price === undefined
                  ? nothing
                  : html`<div class="panel">
                      <span class="label">${t('losses.money_per_year')}</span>
                      <span
                        >≈
                        <span class="xl" style="font-size:20px"
                          >${formatMoney((largest.loss / days) * 365 * price, locale, currency)}</span
                        ><span class="unit">${t('losses.per_year_unit')}</span></span
                      >
                    </div>`
              }
            </div>`
          : nothing
      }
    `;
  }
}
