import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { CardSize } from '../../core/size';
import * as cfg from '../../core/config';
import { formatEnergy, formatMonth, unitText } from '../../core/format';
import { niceMax } from '../../core/math';
import { addMonths, startOfMonth } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { barChart, mirrorChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, legend, meta, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { tipValue } from '../../ui/tip';
import type { Tip } from '../../ui/tip';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  hasSources,
  parseEnergyConfig,
  resolveSources,
  total,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergySeries, Series } from '../shared/energy-sources';

export interface YearCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly months: number;
  readonly height: number;
}

interface YearData {
  readonly starts: readonly number[];
  readonly series: EnergySeries;
  readonly net: Series;
  readonly empty: boolean;
}

type Context = CardContext<YearCardConfig, YearData>;

const netSeries = (series: EnergySeries): Series => {
  const hasGrid =
    series.export.some((value) => value !== undefined) ||
    series.import.some((value) => value !== undefined);

  return series.solar.map((solar, index) => {
    if (hasGrid) {
      const exported = series.export[index];
      const imported = series.import[index];

      if (exported === undefined && imported === undefined) return undefined;

      return (exported ?? 0) - (imported ?? 0);
    }

    const home = series.home[index];

    return solar === undefined || home === undefined ? undefined : solar - home;
  });
};

export class MetronYearCard extends MetronCard<YearCardConfig, YearData> {
  static override maxSize: CardSize = 'medium';

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .months {
        display: grid;
        grid-template-columns: repeat(var(--count, 12), minmax(0, 1fr));
        font-size: 9px;
        text-align: center;
        color: var(--m-muted);
      }

      .months .current {
        font-weight: 600;
        color: var(--m-text);
      }

      .net .chart {
        border-top: none;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.grid(
        form.number('months', { min: 3, max: 24 }),
        form.number('height', { min: 60, max: 240, unit: 'px' }),
      ),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): YearCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      months: cfg.number(raw, 'months', 12, { min: 3, max: 24 }),
      height: cfg.number(raw, 'height', 100, { min: 60, max: 240 }),
    };
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override refreshInterval(): number {
    return 30 * 60 * 1000;
  }

  protected override async fetchData(
    config: YearCardConfig,
    hass: HomeAssistant,
  ): Promise<YearData> {
    const now = Date.now();
    const current = startOfMonth(now);
    const starts = Array.from({ length: config.months }, (_, index) =>
      addMonths(current, index - config.months + 1),
    );
    const first = starts[0] ?? current;
    const end = addMonths(current, 1);
    const sources = await resolveSources(hass, config.energy);
    const statistics = await fetchEnergyStatistics(hass, sources, first - DAY, end, 'month');
    const series = energySeries(statistics, sources, starts, end, { hass, now });

    return { starts, series, net: netSeries(series), empty: !hasSources(sources) };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, size, t, locale } = context;
    const small = size === 'small';

    if (data?.empty) return html`<div class="empty">${t('energy.no_sources')}</div>`;
    if (!data)
      return html`${header(config.title ?? t('year.title'))}
        <div class="empty">${t('common.loading')}</div>`;

    const last = data.starts.length - 1;
    const first = data.starts[0] ?? 0;
    const lastStart = data.starts[last] ?? 0;
    const opacity = (index: number): number => (index === last ? 0.55 : 1);
    const max = niceMax(
      Math.max(1, ...[...data.series.solar, ...data.series.home].map((value) => value ?? 0)),
    );
    const netMax = niceMax(Math.max(1, ...data.net.map((value) => Math.abs(value ?? 0))));
    const range = `${formatMonth(first, locale)} ${new Date(first).getFullYear()} – ${formatMonth(lastStart, locale)} ${new Date(lastStart).getFullYear()} · ${unitText('kWh', locale)}`;

    const tip = (index: number): Tip | undefined => this._tip(context, data, index);

    return html`
      ${header(config.title ?? t('year.title'), meta(range))}
      ${
        small
          ? nothing
          : legend([
              { label: t('year.generation'), color: 'var(--m-solar)' },
              { label: t('year.consumption'), color: 'var(--m-home)' },
              { label: t('year.net_out'), color: 'var(--m-ok)' },
              { label: t('year.net_in'), color: 'var(--m-grid)' },
            ])
      }
      <div class="section shrink" style="gap:4px">
        ${barChart(
          [
            { values: data.series.solar, color: 'var(--m-solar)', opacity },
            { values: data.series.home, color: 'var(--m-home)', opacity },
          ],
          {
            height: small ? 80 : size === 'medium' ? 112 : config.height,
            fill: small ? 60 : 80,
            max,
            gap: 3,
            radius: 1,
            label: t('year.chart_label'),
            tip,
          },
        )}
        ${
          small
            ? nothing
            : html`<div class="net">
                ${mirrorChart(
                  data.net.map((value) => (value === undefined ? undefined : Math.max(0, value))),
                  data.net.map((value) => (value === undefined ? undefined : Math.max(0, -value))),
                  {
                    height: size === 'medium' ? 52 : 60,
                    max: netMax,
                    upColor: 'var(--m-ok)',
                    downColor: 'var(--m-grid)',
                    gap: 4,
                    tip,
                  },
                )}
              </div>`
        }
        <div class="months" style="--count:${data.starts.length}">
          ${data.starts.map(
            (start, index) =>
              html`<span class=${index === last ? 'current' : ''}
                >${formatMonth(start, locale)}</span
              >`,
          )}
        </div>
      </div>
      ${small ? nothing : stats(this._totals(context, data))}
    `;
  }

  private _tip(context: Context, data: YearData, index: number): Tip | undefined {
    const { locale, t } = context;
    const start = data.starts[index];

    if (start === undefined) return undefined;

    const rows = [
      { label: t('year.generation'), value: data.series.solar[index], color: 'var(--m-solar)' },
      { label: t('year.consumption'), value: data.series.home[index], color: 'var(--m-home)' },
    ].flatMap((row) =>
      row.value === undefined
        ? []
        : [
            {
              label: row.label,
              value: tipValue(formatEnergy(row.value, locale)),
              color: row.color,
            },
          ],
    );
    const net = data.net[index];

    if (net !== undefined) {
      rows.push({
        label: net >= 0 ? t('year.net_out') : t('year.net_in'),
        value: tipValue(formatEnergy(Math.abs(net), locale)),
        color: net >= 0 ? 'var(--m-ok)' : 'var(--m-grid)',
      });
    }

    return rows.length === 0
      ? undefined
      : { title: `${formatMonth(start, locale, true)} ${new Date(start).getFullYear()}`, rows };
  }

  private _totals(context: Context, data: YearData): StatItem[] {
    const { t, locale } = context;
    const generation = total(data.series.solar);
    const consumption = total(data.series.home);
    const net = total(data.net);
    const exportMonths = data.net.filter((value) => (value ?? 0) > 0).length;
    const items: StatItem[] = [];

    if (generation !== undefined) {
      const value = formatEnergy(generation, locale, 2, 1000);

      items.push({ label: t('year.generation_total'), value: value.value, unit: value.unit });
    }

    if (consumption !== undefined) {
      const value = formatEnergy(consumption, locale, 2, 1000);

      items.push({ label: t('year.consumption_total'), value: value.value, unit: value.unit });
    }

    if (net !== undefined) {
      const value = formatEnergy(Math.abs(net), locale, 2, 1000);

      items.push({
        label: t('year.net_total'),
        value: `${net >= 0 ? '+' : '−'}${value.value}`,
        unit: value.unit,
        tone: net >= 0 ? 'ok' : 'grid',
        sub: t('year.export_months', { count: exportMonths }),
      });
    }

    return items;
  }
}
