import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticRow } from '../../core/data/statistics';
import { formatDate, formatNumber, unitText } from '../../core/format';
import { addDays, parseClock, startOfDay } from '../../core/time';
import { findEntity } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  counterSeries,
  energyFields,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergyKey } from '../shared/energy-sources';

const ENERGY: readonly EnergyKey[] = ['import'];

export interface NightsCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly battery_soc: string;
  readonly battery_capacity?: number;
  readonly battery_reserve: number;
  readonly days: number;
  readonly evening: number;
  readonly morning: number;
}

interface Night {
  readonly start: number;
  readonly evening?: number;
  readonly morning?: number;
  readonly imported?: number;
}

interface NightsData {
  readonly nights: readonly Night[];
}

type Context = CardContext<NightsCardConfig, NightsData>;

const SOC_HEIGHT = 120;
const IMPORT_HEIGHT = 30;

const valueAtHour = (rows: readonly StatisticRow[], time: number): number | undefined => {
  const row = rows.find((candidate) => candidate.start <= time && time < candidate.end);

  return row?.mean ?? undefined;
};

export class MetronNightsCard extends MetronCard<NightsCardConfig, NightsData> {
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
      }

      .soc {
        position: relative;
        display: flex;
        gap: 2px;
        height: ${SOC_HEIGHT}px;
      }

      .soc .reserve {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-solar);
      }

      .soc .guide {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-line);
      }

      .night {
        position: relative;
        flex: 1 1 0;
      }

      .night .line {
        position: absolute;
        left: 50%;
        width: 2px;
        margin-left: -1px;
        border-radius: 1px;
      }

      .night .top,
      .night .bottom {
        position: absolute;
        left: 50%;
        width: 6px;
        height: 6px;
        margin: 0 0 -3px -3px;
        border-radius: 50%;
      }

      .night .top {
        background: var(--m-muted);
      }

      .imports {
        display: flex;
        align-items: flex-start;
        gap: 2px;
        height: ${IMPORT_HEIGHT}px;
        border-top: 1px solid var(--m-line);
      }

      .imports span {
        flex: 1 1 0;
        border-radius: 0 0 2px 2px;
        background: var(--m-grid);
      }

      .legend i.dot {
        border-radius: 50%;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.entity('battery_soc', { domain: ['sensor'], deviceClass: ['battery'] }, true),
      form.grid(
        form.number('battery_capacity', { min: 0, step: 0.1, unit: 'kWh' }),
        form.number('battery_reserve', { min: 0, max: 100, unit: '%' }),
      ),
      form.grid(form.time('evening'), form.time('morning')),
      form.number('days', { min: 7, max: 60 }),
      ...energyFields(ENERGY),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return { battery_soc: findEntity(hass, { deviceClass: 'battery' }) ?? '' };
  }

  protected parseConfig(raw: RawConfig): NightsCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw, ENERGY),
      battery_soc: cfg.entity(raw, 'battery_soc') ?? '',
      battery_capacity: cfg.optionalNumber(raw, 'battery_capacity'),
      battery_reserve: cfg.number(raw, 'battery_reserve', 20, { min: 0, max: 100 }),
      days: cfg.number(raw, 'days', 30, { min: 7, max: 60 }),
      evening: Math.floor(parseClock(cfg.text(raw, 'evening'), 17 * 60) / 60),
      morning: Math.ceil(parseClock(cfg.text(raw, 'morning'), 7 * 60) / 60),
    };
  }

  protected override missingOption(config: NightsCardConfig): string | undefined {
    return config.battery_soc ? undefined : 'battery_soc';
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: NightsCardConfig,
    hass: HomeAssistant,
  ): Promise<NightsData> {
    const now = Date.now();
    const today = startOfDay(now);
    const first = addDays(today, -config.days);
    const sources = await resolveSources(hass, config.energy, ENERGY);
    const [soc, energy] = await Promise.all([
      fetchStatistics(hass, {
        entityIds: [config.battery_soc],
        start: first,
        end: now,
        period: 'hour',
        types: ['mean', 'min'],
      }),
      fetchEnergyStatistics(hass, sources, first, now, 'hour'),
    ]);
    const rows = soc.get(config.battery_soc) ?? [];
    const nights = Array.from({ length: config.days }, (_, index): Night => {
      const start = addDays(first, index) + config.evening * HOUR;
      const end = addDays(first, index + 1) + config.morning * HOUR;

      if (end > now) return { start };

      const inside = rows.filter((row) => row.start >= start && row.start < end);
      const minima = inside
        .map((row) => row.min ?? row.mean)
        .filter((value): value is number => value !== null && value !== undefined);

      return {
        start,
        evening: valueAtHour(rows, start),
        morning: minima.length > 0 ? Math.min(...minima) : undefined,
        imported: counterSeries(energy, sources.import, [start], end)[0],
      };
    });

    return {
      nights: nights.filter((night) => night.evening !== undefined || night.morning !== undefined),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale } = context;
    const title = config.title ?? t('nights.title');
    const parts = [
      t('nights.count', { count: data?.nights.length ?? config.days }),
      config.battery_capacity === undefined
        ? undefined
        : `${formatNumber(config.battery_capacity, 0, locale)} ${unitText('kWh', locale)}`,
      t('nights.reserve', { value: config.battery_reserve }),
    ].filter((part): part is string => part !== undefined);

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const maxImport = Math.max(1, ...data.nights.map((night) => night.imported ?? 0));
    const soc = (value: number): string =>
      `${((Math.min(100, Math.max(0, value)) / 100) * SOC_HEIGHT).toFixed(1)}px`;

    return html`
      ${header(title, meta(parts.join(' · ')))}
      <div class="legend">
        <span
          ><i class="dot" style="--c:var(--m-muted)"></i
          >${t('nights.evening', { time: `${String(config.evening).padStart(2, '0')}:00` })}</span
        >
        <span><i class="dot" style="--c:var(--m-ok)"></i>${t('nights.enough')}</span>
        <span><i class="dot" style="--c:var(--m-solar)"></i>${t('nights.to_reserve')}</span>
        <span><i style="--c:var(--m-grid)"></i>${t('nights.import')}</span>
      </div>
      <div class="plot">
        <div class="scale" style="height:${SOC_HEIGHT}px">
          <span style="top:0">100</span>
          <span style="top:50%">50</span>
          <span style="top:${(100 - config.battery_reserve).toFixed(0)}%;color:var(--m-solar)"
            >${config.battery_reserve}</span
          >
        </div>
        <div class="soc">
          <div class="guide" style="top:50%"></div>
          <div class="reserve" style="bottom:${soc(config.battery_reserve)}"></div>
          ${data.nights.map((night) => {
            const imported = (night.imported ?? 0) > 0.05;
            const color = imported ? 'var(--m-solar)' : 'var(--m-ok)';
            const top = night.evening ?? night.morning ?? 0;
            const bottom = night.morning ?? top;

            return html`<div class="night" title="${formatDate(night.start, locale)}">
              <span
                class="line"
                style="bottom:${soc(bottom)};height:${soc(Math.max(0, top - bottom))};background:${color}"
              ></span>
              <span class="top" style="bottom:${soc(top)}"></span>
              <span class="bottom" style="bottom:${soc(bottom)};background:${color}"></span>
            </div>`;
          })}
        </div>
        <span class="scale" style="font-size:9px">${unitText('kWh', locale)}</span>
        <div class="imports">
          ${data.nights.map(
            (night) =>
              html`<span
                style="height:${(((night.imported ?? 0) / maxImport) * IMPORT_HEIGHT).toFixed(1)}px"
              ></span>`,
          )}
        </div>
        <span></span>
        ${this._axis(context, data)}
      </div>
      ${stats(this._summary(context, data))}
    `;
  }

  private _axis(context: Context, data: NightsData): TemplateResult | typeof nothing {
    const { locale } = context;
    const count = data.nights.length;

    if (count === 0) return nothing;

    const pick = [0, Math.floor(count / 3), Math.floor((2 * count) / 3), count - 1];

    return html`<div class="axis">
      ${pick.map((index, position) => {
        const night = data.nights[index];

        return night
          ? html`<span
              class=${position === 0 ? 'first' : position === pick.length - 1 ? 'last' : ''}
              style="left:${(((index + 0.5) / count) * 100).toFixed(1)}%"
              >${formatDate(night.start, locale)}</span
            >`
          : nothing;
      })}
    </div>`;
  }

  private _summary(context: Context, data: NightsData): StatItem[] {
    const { t, locale } = context;
    const complete = data.nights.filter((night) => night.imported !== undefined);
    const enough = complete.filter((night) => (night.imported ?? 0) <= 0.05).length;
    const total = complete.reduce((sum, night) => sum + (night.imported ?? 0), 0);
    const worst = complete.reduce<Night | undefined>(
      (found, night) => ((night.imported ?? 0) > (found?.imported ?? 0) ? night : found),
      undefined,
    );
    const kwh = unitText('kWh', locale);

    return [
      {
        label: t('nights.enough_label'),
        value: String(enough),
        unit: t('nights.of', { count: complete.length }),
        tone: 'ok',
      },
      {
        label: t('nights.import_total'),
        value: formatNumber(total, 1, locale),
        unit: kwh,
        tone: 'grid',
      },
      ...(worst && (worst.imported ?? 0) > 0
        ? [
            {
              label: t('nights.worst'),
              value: formatNumber(worst.imported, 1, locale),
              unit: kwh,
              tone: 'solar' as const,
              sub: formatDate(worst.start, locale),
            },
          ]
        : []),
    ];
  }
}
