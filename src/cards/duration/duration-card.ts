import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { CardSize } from '../../core/size';
import * as cfg from '../../core/config';
import type { EntityItem } from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticsResult } from '../../core/data/statistics';
import { entityName } from '../../core/entities';
import { formatDate, formatNumber, unitText } from '../../core/format';
import { niceMax, quantile } from '../../core/math';
import { firstWeekday } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, meta, stats } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { slotHover } from '../../ui/tip';
import { DASHBOARD_ENERGY } from '../shared/energy-sources';
import type { EnergyConfig } from '../shared/energy-sources';
import { fetchHourlyLoad } from '../shared/hourly';
import { periodToDate } from '../stats/periods';
import type { PeriodKind } from '../stats/periods';

export interface DurationCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly entity?: string;
  readonly phases: readonly EntityItem[];
  readonly phase_limit?: number;
  readonly threshold: number;
  readonly period: PeriodKind;
}

interface DurationData {
  readonly start: number;
  readonly end: number;
  readonly values: readonly number[];
  readonly peak?: number;
  readonly phasePeaks: readonly (number | undefined)[];
}

type Context = CardContext<DurationCardConfig, DurationData>;

const CHART_HEIGHT = 120;
const BARS = 100;

export class MetronDurationCard extends MetronCard<DurationCardConfig, DurationData> {
  static override maxSize: CardSize = 'medium';

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .plot {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr);
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

      .curve {
        position: relative;
        display: flex;
        align-items: flex-end;
        gap: 1px;
        height: var(--chart, ${CHART_HEIGHT}px);
        border-bottom: 1px solid var(--m-line);
        touch-action: pan-y;
      }

      .curve > span {
        flex: 1 1 0;
        border-radius: 1px 1px 0 0;
      }

      .rule {
        position: absolute;
        right: 0;
        left: 0;
        border-top: 1px dashed var(--c);
      }

      .rule em {
        position: absolute;
        right: 0;
        bottom: 2px;
        font-family: var(--m-mono);
        font-size: 10px;
        font-style: normal;
        color: var(--c);
      }

      .phase {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        font-size: 12px;
      }

      .phase b {
        font-family: var(--m-mono);
        font-weight: 500;
        white-space: nowrap;
      }

      .phase small {
        font-family: var(--m-mono);
        color: var(--m-muted);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.consumptionEntity(),
      form.entities('phases', { domain: ['sensor'], deviceClass: ['power'] }),
      form.grid(
        form.number('phase_limit', { min: 0, step: 0.1, unit: 'kW' }),
        form.number('threshold', { min: 0, step: 0.1, unit: 'kW' }),
      ),
      form.select('period', ['day', 'week', 'month', 'year']),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): DurationCardConfig {
    return {
      ...cfg.base(raw),
      energy: DASHBOARD_ENERGY,
      entity: cfg.entity(raw, 'entity'),
      phases: cfg.entityItems(raw, 'phases'),
      phase_limit: cfg.optionalNumber(raw, 'phase_limit'),
      threshold: cfg.number(raw, 'threshold', 5, { min: 0 }),
      period: cfg.oneOf(raw, 'period', ['day', 'week', 'month', 'year'], 'month'),
    };
  }

  protected override cardSize(config: DurationCardConfig): number {
    return 5 + Math.ceil(config.phases.length / 2);
  }

  protected override refreshInterval(): number {
    return HOUR / 2;
  }

  protected override async fetchData(
    config: DurationCardConfig,
    hass: HomeAssistant,
  ): Promise<DurationData> {
    const range = periodToDate(config.period, Date.now(), firstWeekday(hass.locale));
    const [samples, phases] = await Promise.all([
      fetchHourlyLoad(hass, config.entity, config.energy, range.start, range.end),
      config.phases.length > 0
        ? fetchStatistics(hass, {
            entityIds: config.phases.map((phase) => phase.entity),
            start: range.start,
            end: range.end,
            period: 'hour',
            types: ['max', 'mean'],
          })
        : Promise.resolve<StatisticsResult>(new Map()),
    ]);
    const maxima = samples.map((sample) => sample.max ?? sample.value);

    return {
      start: range.start,
      end: range.end,
      values: samples.map((sample) => sample.value).sort((a, b) => b - a),
      peak: maxima.length > 0 ? Math.max(...maxima) : undefined,
      phasePeaks: config.phases.map((phase) => {
        const values = (phases.get(phase.entity) ?? [])
          .map((row) => row.max ?? row.mean)
          .filter((value): value is number => value !== null && value !== undefined);

        return values.length > 0 ? Math.max(...values) / 1000 : undefined;
      }),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, size, t, locale } = context;
    const small = size === 'small';
    const chart = small ? 90 : size === 'medium' ? 104 : CHART_HEIGHT;
    const title = config.title ?? t('duration.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const range = `${formatDate(data.start, locale, { day: 'numeric' })}–${formatDate(data.end, locale)}`;

    if (data.values.length === 0)
      return html`${header(title, meta(range))}
        <div class="empty">${t('common.no_data')}</div>`;

    const kw = unitText('kW', locale);
    const top = niceMax(Math.max(config.threshold * 1.2, data.values[0] ?? 0));
    const average = data.values.reduce((sum, value) => sum + value, 0) / data.values.length;
    const y = (value: number): string => `${(((top - value) / top) * chart).toFixed(1)}px`;
    const bars = Array.from({ length: BARS }, (_, index) => {
      const position = Math.min(
        data.values.length - 1,
        Math.floor(((index + 0.5) / BARS) * data.values.length),
      );

      return data.values[position] ?? 0;
    });
    const above = data.values.filter((value) => value > config.threshold).length;
    const p90 = quantile(data.values, 0.1);
    const hover = slotHover(BARS, (index) => ({
      title: t('duration.tip_title', { value: Math.round(((index + 1) / BARS) * 100) }),
      rows: [
        {
          label: t('duration.tip_power'),
          value: `${formatNumber(bars[index] ?? 0, 1, locale)} ${kw}`,
          color: (bars[index] ?? 0) > config.threshold ? 'var(--m-warn)' : 'var(--m-home)',
        },
      ],
    }));

    return html`
      ${header(title, meta(t('duration.range', { range })))}
      <div class="plot">
        <div class="scale" style="height:${chart}px">
          <span style="top:0">${formatNumber(top, 0, locale)} ${kw}</span>
          <span style="top:${y(config.threshold)};color:var(--m-warn)"
            >${formatNumber(config.threshold, 0, locale)}</span
          >
          <span style="top:100%">0</span>
        </div>
        <div
          class="curve"
          style="--chart:${chart}px"
          @pointermove=${hover.move}
          @pointerdown=${hover.move}
          @pointerleave=${hover.leave}
        >
          ${bars.map(
            (value) =>
              html`<span
                style="height:${((value / top) * chart).toFixed(1)}px;background:${value > config.threshold ? 'var(--m-warn)' : 'var(--m-home)'}"
              ></span>`,
          )}
          <div class="rule" style="--c:var(--m-warn);top:${y(config.threshold)}"></div>
          <div class="rule" style="--c:var(--m-text-2);top:${y(average)}">
            <em>${t('duration.average', { value: formatNumber(average, 1, locale), unit: kw })}</em>
          </div>
        </div>
        <span></span>
        ${
          small
            ? nothing
            : axis([
                { at: 0, label: '0' },
                { at: 0.25, label: '25' },
                { at: 0.5, label: '50' },
                { at: 0.75, label: '75' },
                { at: 1, label: t('duration.time_axis') },
              ])
        }
      </div>
      ${small ? nothing : this._renderPhases(context, data)}
      ${
        small
          ? nothing
          : stats([
              { label: t('common.peak'), value: formatNumber(data.peak, 1, locale), unit: kw },
              { label: t('duration.p90'), value: formatNumber(p90, 1, locale), unit: kw },
              {
                label: t('duration.above', { value: formatNumber(config.threshold, 0, locale) }),
                value: String(above),
                unit: unitText('h', locale),
                tone: above > 0 ? 'warn' : 'ok',
              },
            ])
      }
    `;
  }

  private _renderPhases(context: Context, data: DurationData): TemplateResult | typeof nothing {
    const { config, hass, t, locale } = context;

    if (config.phases.length === 0) return nothing;

    const kw = unitText('kW', locale);
    const limit = config.phase_limit;
    const max = limit ?? Math.max(1, ...data.phasePeaks.map((value) => value ?? 0));
    const color = (share: number): string => {
      if (share >= 0.85) return 'var(--m-warn)';
      if (share >= 0.6) return 'var(--m-solar)';

      return 'var(--m-home)';
    };

    return html`<div class="section" data-drop="1">
      <div class="section-head">
        <span class="label">${t('duration.phase_peaks')}</span>
        ${
          limit === undefined
            ? nothing
            : html`<span class="label"
                >${t('duration.limit', { value: formatNumber(limit, 1, locale), unit: kw })}</span
              >`
        }
      </div>
      ${config.phases.map((phase, index) => {
        const peak = data.phasePeaks[index];
        const share = peak === undefined ? 0 : peak / max;

        return html`<div class="phase">
          <span
            >${phase.name ?? (config.phases.length <= 3 ? `L${index + 1}` : entityName(hass, phase.entity))}</span
          >
          <div class="track">
            <div style="width:${(Math.min(1, share) * 100).toFixed(1)}%;--c:${color(share)}"></div>
          </div>
          <span
            ><b>${formatNumber(peak, 1, locale)}</b> ${kw}
            ${limit === undefined ? nothing : html`<small>· ${formatNumber(share * 100, 0, locale)} %</small>`}</span
          >
        </div>`;
      })}
    </div>`;
  }
}
