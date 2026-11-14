import { css, html } from 'lit';
import type { StatItem } from '../../ui/parts';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY, HOUR, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchSamples, valueBefore } from '../../core/data/history';
import { formatNumber, formatSigned, unitText } from '../../core/format';
import { niceMax } from '../../core/math';
import { addDays, parseClock, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, stats } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, Series } from '../shared/energy-sources';

export interface ForecastAccuracyCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly forecast: string;
  readonly offset: number;
  readonly sample_time: number;
  readonly days: number;
  readonly good: number;
  readonly fair: number;
}

interface AccuracyData {
  readonly starts: readonly number[];
  readonly forecast: Series;
  readonly actual: Series;
}

type Context = CardContext<ForecastAccuracyCardConfig, AccuracyData>;

const CHART_HEIGHT = 120;

export class MetronForecastAccuracyCard extends MetronCard<
  ForecastAccuracyCardConfig,
  AccuracyData
> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .chart-area {
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

      .columns {
        position: relative;
        display: flex;
        align-items: flex-end;
        gap: 3px;
        height: ${CHART_HEIGHT}px;
        border-bottom: 1px solid var(--m-line);
      }

      .guide {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--m-line);
      }

      .column {
        position: relative;
        display: flex;
        flex: 1 1 0;
        align-items: flex-end;
        justify-content: center;
        gap: 1px;
        height: 100%;
      }

      .column span {
        flex: 0 1 8px;
        border-radius: 2px 2px 0 0;
      }

      .forecast {
        box-shadow: inset 0 0 0 1.5px var(--m-solar);
      }

      .actual {
        background: var(--m-solar);
      }

      .row {
        display: flex;
        gap: 3px;
        padding: 0;
        border: 0;
      }

      .row span {
        flex: 1 1 0;
        overflow: hidden;
        font-family: var(--m-mono);
        font-size: 9px;
        text-align: center;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .row.errors span {
        font-size: 10px;
        font-weight: 600;
      }

      .axis-label {
        font-family: var(--m-mono);
        font-size: 9px;
        text-align: right;
        color: var(--m-muted);
      }

      .legend i.outline {
        background: none;
        box-shadow: inset 0 0 0 1.5px var(--m-solar);
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.entity('forecast', { domain: ['sensor'] }, true),
      form.grid(form.select('offset', ['0', '1']), form.time('sample_time')),
      form.grid(
        form.number('days', { min: 3, max: 30 }),
        form.number('good', { min: 1, max: 50, unit: '%' }),
      ),
      form.number('fair', { min: 1, max: 100, unit: '%' }),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { forecast: '' };
  }

  protected parseConfig(raw: RawConfig): ForecastAccuracyCardConfig {
    const offset = Number(raw.offset ?? 0) === 1 ? 1 : 0;

    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      forecast: cfg.requiredEntity(raw, 'forecast'),
      offset,
      sample_time: parseClock(cfg.text(raw, 'sample_time'), offset === 1 ? 21 * 60 : 6 * 60),
      days: cfg.number(raw, 'days', 14, { min: 3, max: 30 }),
      good: cfg.number(raw, 'good', 10, { min: 1, max: 50 }),
      fair: cfg.number(raw, 'fair', 25, { min: 1, max: 100 }),
    };
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: ForecastAccuracyCardConfig,
    hass: HomeAssistant,
  ): Promise<AccuracyData> {
    const today = startOfDay(Date.now());
    const first = addDays(today, -config.days);
    const starts = Array.from({ length: config.days }, (_, index) => addDays(first, index));
    const sources = await resolveSources(hass, config.energy);
    const [statistics, samples] = await Promise.all([
      fetchEnergyStatistics(hass, sources, first - DAY, today, 'day'),
      fetchSamples(hass, [[config.forecast, 'energy']], addDays(first, -config.offset - 1), today),
    ]);
    const series = energySeries(statistics, sources, starts, today);
    const history = samples.get(config.forecast) ?? [];

    return {
      starts,
      actual: series.solar,
      forecast: starts.map((start) =>
        valueBefore(history, addDays(start, -config.offset) + config.sample_time * MINUTE),
      ),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale } = context;
    const title = config.title ?? t('accuracy.title', { days: config.days });

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const max = niceMax(
      Math.max(1, ...[...data.forecast, ...data.actual].map((value) => value ?? 0)),
    );
    const px = (value: number | undefined): string =>
      `${(((value ?? 0) / max) * CHART_HEIGHT).toFixed(1)}px`;
    const errors = data.starts.map((_, index) => {
      const forecast = data.forecast[index];
      const actual = data.actual[index];

      return forecast !== undefined && actual ? ((forecast - actual) / actual) * 100 : undefined;
    });
    const color = (error: number | undefined): string => {
      if (error === undefined) return 'var(--m-muted)';
      if (Math.abs(error) > config.fair) return 'var(--m-warn)';
      if (Math.abs(error) > config.good) return 'var(--m-solar)';

      return 'var(--m-ok)';
    };

    return html`
      ${header(
        title,
        html`<div class="legend">
          <span><i class="outline"></i>${t('accuracy.forecast')}</span
          ><span><i style="--c:var(--m-solar)"></i>${t('accuracy.actual')}</span>
        </div>`,
      )}
      <div class="chart-area">
        <div class="scale">
          <span style="top:0">${formatNumber(max, 0, locale)}</span>
          <span style="top:50%">${formatNumber(max / 2, 0, locale)}</span>
          <span style="top:100%">${unitText('kWh', locale)}</span>
        </div>
        <div class="columns">
          <div class="guide" style="top:50%"></div>
          ${data.starts.map(
            (_, index) =>
              html`<div class="column">
                <span class="forecast" style="height:${px(data.forecast[index])}"></span>
                <span class="actual" style="height:${px(data.actual[index])}"></span>
              </div>`,
          )}
        </div>
        <span class="axis-label">Δ %</span>
        <div class="row errors">
          ${errors.map(
            (error) =>
              html`<span style="color:${color(error)}"
                >${error === undefined ? '·' : formatSigned(error, 0, locale)}</span
              >`,
          )}
        </div>
        <span></span>
        <div class="row">
          ${data.starts.map((start) => html`<span>${new Date(start).getDate()}</span>`)}
        </div>
      </div>
      ${stats(this._summary(context, data, errors))}
    `;
  }

  private _summary(
    context: Context,
    data: AccuracyData,
    errors: readonly (number | undefined)[],
  ): StatItem[] {
    const { t, locale } = context;
    const known = errors.filter((error): error is number => error !== undefined);

    if (known.length === 0) return [];

    const mape = known.reduce((sum, error) => sum + Math.abs(error), 0) / known.length;
    const pairs = data.starts
      .map((_, index) => [data.forecast[index], data.actual[index]] as const)
      .filter(
        (pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined,
      );
    const forecastSum = pairs.reduce((sum, [forecast]) => sum + forecast, 0);
    const actualSum = pairs.reduce((sum, [, actual]) => sum + actual, 0);
    const ratio = actualSum > 0 ? forecastSum / actualSum : 1;
    const bias = (ratio - 1) * 100;

    return [
      { label: t('accuracy.mape'), value: `±${formatNumber(mape, 0, locale)}`, unit: '%' },
      {
        label: t('accuracy.bias'),
        value: formatSigned(bias, 0, locale),
        unit: '%',
        tone: Math.abs(bias) > 5 ? 'solar' : 'ok',
        sub: bias >= 0 ? t('accuracy.over') : t('accuracy.under'),
      },
      {
        label: t('accuracy.factor'),
        value: `× ${formatNumber(ratio > 0 ? 1 / ratio : 1, 2, locale)}`,
      },
    ];
  }
}
