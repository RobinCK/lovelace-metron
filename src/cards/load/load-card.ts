import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { fetchSamples, resample } from '../../core/data/history';
import { fetchStatistics } from '../../core/data/statistics';
import { readNumber } from '../../core/entities';
import { formatEnergy, formatNumber, formatPower, formatTime } from '../../core/format';
import { niceMax } from '../../core/math';
import { findEntity } from '../../core/stub';
import { startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { barChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, icon, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { tipValue } from '../../ui/tip';
import type { Tip } from '../../ui/tip';
import { imbalance, levelOf, phaseLimit, sumSeries, todayStats, totalLimit, usage } from './load';
import type { Level, TodayStats } from './load';

export interface LoadPhase {
  readonly power: string;
  readonly current?: string;
  readonly voltage?: string;
  readonly name?: string;
}

export interface LoadCardConfig extends BaseConfig {
  readonly power?: string;
  readonly phases: readonly LoadPhase[];
  readonly limit?: number;
  readonly breaker?: number;
  readonly warning: number;
  readonly critical: number;
  readonly minutes: number;
}

interface LoadData {
  readonly start: number;
  readonly minutes: ReadonlyMap<string, readonly (number | undefined)[]>;
  readonly today: TodayStats;
}

interface PhaseView {
  readonly name: string;
  readonly color: string;
  readonly power?: number;
  readonly current?: number;
  readonly voltage?: number;
  readonly limit?: number;
  readonly ratio?: number;
  readonly level: Level;
  readonly peak?: number;
  readonly history: readonly (number | undefined)[];
}

interface Model {
  readonly total?: number;
  readonly history: readonly (number | undefined)[];
  readonly limit?: number;
  readonly ratio?: number;
  readonly phases: readonly PhaseView[];
}

type Context = CardContext<LoadCardConfig, LoadData>;

const PHASE_COLORS = ['var(--m-grid)', 'var(--m-home)', 'var(--m-gas)'];
const LEVEL_COLORS: Readonly<Record<Level, string>> = {
  ok: 'var(--m-ok)',
  caution: 'var(--m-caution)',
  warn: 'var(--m-warn)',
};
const STEP = 5 * MINUTE;
const TREND_MINUTES = 5;
const TREND_MIN_WATTS = 50;
const HINT_MIN_WATTS = 1000;

const withLive = (
  history: readonly (number | undefined)[],
  live: number | undefined,
): (number | undefined)[] => (history.length > 0 ? [...history.slice(0, -1), live] : []);

const maxOf = (values: readonly (number | undefined)[]): number | undefined => {
  const numbers = values.filter((value): value is number => value !== undefined);

  return numbers.length > 0 ? Math.max(...numbers) : undefined;
};

const averageOf = (values: readonly (number | undefined)[]): number | undefined => {
  const numbers = values.filter((value): value is number => value !== undefined);

  return numbers.length > 0
    ? numbers.reduce((total, value) => total + value, 0) / numbers.length
    : undefined;
};

const percent = (ratio: number): string => `${Math.min(100, Math.max(0, ratio * 100)).toFixed(2)}%`;

export class MetronLoadCard extends MetronCard<LoadCardConfig, LoadData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      :host {
        --m-caution: var(--metron-caution-color, #ffb547);
      }

      .total {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .total-row {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
      }

      .total-value {
        display: flex;
        align-items: baseline;
        gap: 6px;
        white-space: nowrap;
      }

      .total-value b {
        font-family: var(--m-mono);
        font-size: 40px;
        font-weight: 500;
        letter-spacing: -0.02em;
        line-height: 1;
      }

      .total-value small {
        font-size: 14px;
        color: var(--m-muted);
      }

      .trend {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        margin-left: 8px;
        font-size: 12px;
        color: var(--m-muted);
        --mdc-icon-size: 13px;
      }

      .limit {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .limit b {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 400;
        color: var(--m-text-2);
      }

      .gauge {
        position: relative;
        height: 8px;
        border-radius: 4px;
        background: var(--m-track);
      }

      .gauge .fill {
        height: 100%;
        border-radius: inherit;
        background: var(--c);
      }

      .gauge .tick,
      .phase-bar .tick {
        position: absolute;
        width: 1px;
        background: color-mix(in srgb, var(--m-text) 22%, transparent);
      }

      .gauge .tick {
        top: -3px;
        height: 14px;
      }

      .gauge .mark,
      .phase-bar .mark {
        position: absolute;
        width: 2px;
        margin-left: -1px;
        border-radius: 1px;
        background: var(--m-text);
      }

      .gauge .mark {
        top: -4px;
        height: 16px;
      }

      .caption {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .caption .mono {
        color: var(--m-text-2);
      }

      .phases {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .phase-list {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--m-line);
      }

      .phase,
      .phase-axis {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr) 112px;
        column-gap: 14px;
        align-items: center;
      }

      .phase {
        padding: 10px 0;
        border-bottom: 1px solid var(--m-line);
      }

      .compact .phase {
        padding: 5px 0;
      }

      .phase-line {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .phase-line span {
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
      }

      .phase-line i {
        align-self: center;
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .phase-line b {
        font-family: var(--m-mono);
        font-weight: 500;
        color: var(--m-text);
      }

      .phase-line small {
        margin-left: -2px;
        font-size: 10px;
      }

      .phase-name {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 28px;
        border-radius: 8px;
        background: var(--m-panel);
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 600;
      }

      .phase-name i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--c);
      }

      .phase-bar {
        position: relative;
        height: 28px;
      }

      .phase-bar .rail,
      .phase-bar .fill {
        position: absolute;
        top: 11px;
        left: 0;
        height: 6px;
        border-radius: 3px;
      }

      .phase-bar .rail {
        right: 0;
        background: var(--m-track);
      }

      .phase-bar .fill {
        background: var(--c);
      }

      .phase-bar .tick {
        top: 8px;
        height: 12px;
      }

      .phase-bar .mark {
        top: 6px;
        height: 16px;
        background: color-mix(in srgb, var(--m-text) 60%, transparent);
      }

      .phase-value {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
        min-width: 0;
        white-space: nowrap;
      }

      .phase-value b {
        font-family: var(--m-mono);
        font-size: 15px;
        font-weight: 500;
        color: var(--v, var(--m-text));
      }

      .phase-value small,
      .phase-value .mono,
      .phase-axis .note {
        font-size: 11px;
        color: var(--m-muted);
      }

      .phase-axis .note {
        font-size: 10px;
        text-align: right;
        white-space: nowrap;
      }

      .hint {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--m-panel);
        font-size: 12px;
        line-height: 1.45;
        color: var(--m-text-2);
        --mdc-icon-size: 16px;
      }

      .hint ha-icon {
        flex-shrink: 0;
      }

      .history {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .history .chart {
        border-bottom: 1px solid var(--m-line);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    const sensor = (deviceClass: string): form.ListField => ({
      selector: { entity: { filter: { domain: ['sensor'], device_class: [deviceClass] } } },
    });

    return form.createForm([
      form.grid(form.powerEntity('power'), form.number('limit', { min: 0, step: 0.1, unit: 'kW' })),
      form.list(
        'phases',
        {
          power: { ...sensor('power'), required: true },
          current: sensor('current'),
          voltage: sensor('voltage'),
          name: { selector: { text: {} } },
        },
        'name',
      ),
      form.grid(
        form.number('breaker', { min: 1, max: 250, unit: 'A' }),
        form.number('minutes', { min: 10, max: 360, unit: 'min' }),
      ),
      form.expandable(
        'details',
        form.grid(
          form.number('warning', { min: 1, max: 100, unit: '%' }),
          form.number('critical', { min: 1, max: 100, unit: '%' }),
        ),
      ),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    const power = findEntity(hass, {
      deviceClass: 'power',
      keywords: ['load', 'house', 'home', 'consumption'],
    });

    return power ? { power } : {};
  }

  protected parseConfig(raw: RawConfig): LoadCardConfig {
    const phases = cfg
      .list(raw, 'phases', (item) => {
        const power = cfg.entity(item, 'power');

        if (!power) return undefined;

        return {
          power,
          current: cfg.entity(item, 'current'),
          voltage: cfg.entity(item, 'voltage'),
          name: cfg.text(item, 'name'),
        };
      })
      .slice(0, 3);
    const breaker = cfg.optionalNumber(raw, 'breaker');
    const limit = cfg.optionalNumber(raw, 'limit');

    return {
      ...cfg.base(raw),
      power: cfg.entity(raw, 'power'),
      phases,
      limit: limit !== undefined && limit > 0 ? limit : undefined,
      breaker: breaker !== undefined && breaker > 0 ? breaker : undefined,
      warning: cfg.number(raw, 'warning', 70, { min: 1, max: 100 }),
      critical: cfg.number(raw, 'critical', 90, { min: 1, max: 100 }),
      minutes: cfg.number(raw, 'minutes', 60, { min: 10, max: 360 }),
    };
  }

  protected override trackedEntities(config: LoadCardConfig): readonly (string | undefined)[] {
    return [
      config.power,
      ...config.phases.flatMap((phase) => [phase.power, phase.current, phase.voltage]),
    ];
  }

  protected override refreshInterval(): number {
    return MINUTE;
  }

  protected override missingOption(config: LoadCardConfig): string | undefined {
    return !config.power && config.phases.length === 0 ? 'power' : undefined;
  }

  protected override cardSize(config: LoadCardConfig): number {
    return config.phases.length > 1 ? 8 : 4;
  }

  protected override defaultSize(config: LoadCardConfig): SizeSetting {
    return config.phases.length > 1 ? 'large' : 'medium';
  }

  protected override async fetchData(
    config: LoadCardConfig,
    hass: HomeAssistant,
  ): Promise<LoadData> {
    const now = Date.now();
    const start = now - config.minutes * MINUTE;
    const ids = [
      ...new Set([...(config.power ? [config.power] : []), ...config.phases.map((p) => p.power)]),
    ];
    const totals = config.power ? [config.power] : config.phases.map((phase) => phase.power);
    const [samples, statistics] = await Promise.all([
      fetchSamples(
        hass,
        ids.map((id) => [id, 'power'] as const),
        start - MINUTE,
        now,
      ),
      fetchStatistics(hass, {
        entityIds: totals,
        start: startOfDay(now),
        end: now,
        period: '5minute',
        types: ['mean', 'max'],
      }),
    ]);

    return {
      start,
      minutes: new Map(
        ids.map((id) => [id, resample(samples.get(id) ?? [], start, MINUTE, config.minutes)]),
      ),
      today: todayStats(
        totals.map((id) => statistics.get(id) ?? []),
        STEP,
      ),
    };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, size, t } = context;
    const model = this._model(context);
    const multi = model.phases.length > 1;
    const head = header(config.title ?? t('load.title'), this._badge(context, model));

    if (size === 'small') {
      return html`${head}
      ${this._renderTotal(context, model, multi ? this._renderPhaseLine(context, model) : nothing)}`;
    }

    if (size === 'medium' && multi) {
      return html`${head} ${this._renderTotal(context, model)}
      ${this._renderPhases(context, model, true)} ${this._renderHistory(context, model, 40)}`;
    }

    if (size === 'medium') {
      return html`${head} ${this._renderTotal(context, model)}
      ${this._renderHistory(context, model, 120)} ${stats(this._stats(context, model), 3)}`;
    }

    const height = size === 'large' ? (multi ? 96 : 300) : 48;

    return html`
      ${head} ${this._renderTotal(context, model)}
      ${multi ? this._renderPhases(context, model, false) : nothing}
      ${multi ? this._renderHint(context, model) : nothing}
      ${this._renderHistory(context, model, height)} ${stats(this._stats(context, model), 3)}
    `;
  }

  private _model(context: Context): Model {
    const { config, hass, data } = context;
    const count = config.phases.length;
    const phases = config.phases.map((phase, index): PhaseView => {
      const power = readNumber(hass, phase.power, 'power');
      const current = readNumber(hass, phase.current, 'raw');
      const voltage = readNumber(hass, phase.voltage, 'raw');
      const limit = phaseLimit(config.breaker, config.limit, voltage, count);
      const ratio = usage(power, limit, current, config.breaker);
      const history = withLive(data?.minutes.get(phase.power) ?? [], power);

      return {
        name: phase.name ?? `L${index + 1}`,
        color: PHASE_COLORS[index] ?? 'var(--m-home)',
        power,
        current,
        voltage,
        limit,
        ratio,
        level: levelOf(ratio, config.warning, config.critical),
        peak: maxOf(history),
        history,
      };
    });
    const known = phases.flatMap((phase) => (phase.power === undefined ? [] : [phase.power]));
    const live = config.power
      ? readNumber(hass, config.power, 'power')
      : known.length > 0
        ? known.reduce((total, power) => total + power, 0)
        : undefined;
    const history = withLive(
      config.power
        ? (data?.minutes.get(config.power) ?? [])
        : sumSeries(phases.map((phase) => phase.history)),
      live,
    );
    const limit = totalLimit(config.breaker, config.limit, Math.max(1, count));
    const single = count === 1 ? phases[0] : undefined;

    return {
      total: live,
      history,
      limit,
      ratio: usage(live, limit, single?.current, count <= 1 ? config.breaker : undefined),
      phases,
    };
  }

  private _badge(context: Context, model: Model): TemplateResult | typeof nothing {
    const { config, t } = context;
    const input = { name: t('load.input'), ratio: model.ratio };
    const candidates =
      model.phases.length > 1
        ? [...model.phases.map((phase) => ({ name: phase.name, ratio: phase.ratio })), input]
        : [input];
    const known = candidates.filter((item) => item.ratio !== undefined);

    if (known.length === 0) return nothing;

    const worst = known.reduce((a, b) => ((b.ratio ?? 0) > (a.ratio ?? 0) ? b : a));
    const level = levelOf(worst.ratio, config.warning, config.critical);
    const text =
      level === 'ok'
        ? t('load.ok')
        : t('load.near', { name: worst.name, value: Math.round((worst.ratio ?? 0) * 100) });

    return html`<span class="pill" style="--tone:${LEVEL_COLORS[level]}"><i></i>${text}</span>`;
  }

  private _renderTotal(
    context: Context,
    model: Model,
    extra: TemplateResult | typeof nothing = nothing,
  ): TemplateResult {
    const { config, t, locale, data } = context;
    const total = formatPower(model.total, locale);
    const peak = data?.today.peak;
    const level = levelOf(model.ratio, config.warning, config.critical);
    const single = model.phases.length === 1 ? model.phases[0] : undefined;
    const electrical = [
      single?.current === undefined
        ? undefined
        : `${formatNumber(single.current, 1, locale)} ${t('unit.a')}`,
      single?.voltage === undefined
        ? undefined
        : `${formatNumber(single.voltage, 0, locale)} ${t('unit.v')}`,
    ].filter((part): part is string => part !== undefined);
    const share =
      model.ratio === undefined
        ? undefined
        : t('load.of_limit', { value: Math.round(model.ratio * 100) });
    const left = [share, electrical.join(' · ')].filter(Boolean).join(' · ');

    return html`<div class="total">
      <div class="total-row">
        <div class="total-value">
          <b>${total.value}</b><small>${total.unit}</small>${this._trend(context, model)}
        </div>
        ${this._limit(context, model)}
      </div>
      ${
        model.limit === undefined
          ? nothing
          : html`<div class="gauge">
              <div
                class="fill"
                style="width:${percent(model.ratio ?? 0)};--c:${LEVEL_COLORS[level]}"
              ></div>
              <span class="tick" style="left:${config.warning}%"></span>
              <span class="tick" style="left:${config.critical}%"></span>
              ${
                peak
                  ? html`<span
                      class="mark"
                      style="left:${percent(peak.value / model.limit)}"
                    ></span>`
                  : nothing
              }
            </div>`
      }
      <div class="caption" data-drop="8">
        <span>${left}</span>
        ${
          peak
            ? html`<span
                >${t('load.peak_today', {
                  value: formatPower(peak.value, locale).value,
                  unit: formatPower(peak.value, locale).unit,
                  time: formatTime(peak.time, locale),
                })}</span
              >`
            : nothing
        }
      </div>
      ${extra}
    </div>`;
  }

  private _renderPhaseLine(context: Context, model: Model): TemplateResult {
    const { locale } = context;

    return html`<div class="phase-line">
      ${model.phases.map((phase) => {
        const power = formatPower(phase.power, locale);

        return html`<span
          ><i style="background:${phase.color}"></i>${phase.name}
          <b style=${phase.level === 'ok' ? '' : `color:${LEVEL_COLORS[phase.level]}`}
            >${power.value}</b
          ><small>${power.unit}</small></span
        >`;
      })}
    </div>`;
  }

  private _trend(context: Context, model: Model): TemplateResult | typeof nothing {
    const { locale, t } = context;
    const before = model.history[model.history.length - 1 - TREND_MINUTES];

    if (model.total === undefined || before === undefined) return nothing;

    const delta = model.total - before;

    if (Math.abs(delta) < TREND_MIN_WATTS) return nothing;

    const formatted = formatPower(Math.abs(delta), locale);

    return html`<span class="trend"
      >${icon(delta > 0 ? 'mdi:arrow-up' : 'mdi:arrow-down')}${t('load.trend', {
        value: formatted.value,
        unit: formatted.unit,
      })}</span
    >`;
  }

  private _limit(context: Context, model: Model): TemplateResult | typeof nothing {
    const { config, locale, t } = context;

    if (model.limit === undefined) return nothing;

    const kilowatts = model.limit / 1000;
    const value = formatNumber(kilowatts, Number.isInteger(kilowatts) ? 0 : 1, locale);
    const label =
      config.limit === undefined && config.breaker !== undefined
        ? t('load.breaker', { value: formatNumber(config.breaker, 0, locale) })
        : t('load.input_limit');

    return html`<div class="limit"><span>${label}</span><b>${value} ${t('unit.kw')}</b></div>`;
  }

  private _renderPhases(context: Context, model: Model, compact: boolean): TemplateResult {
    const { config, locale, t } = context;
    const limit = model.phases.find((phase) => phase.limit !== undefined)?.limit;
    const scale = limit ?? niceMax(Math.max(0, ...model.phases.map((p) => p.peak ?? p.power ?? 0)));
    const unit = config.breaker !== undefined ? t('unit.a') : t('unit.kw');
    const top = config.breaker ?? scale / 1000;

    return html`<div class="phases ${compact ? 'compact' : ''}" data-drop="7">
      <div class="phase-list">
        ${model.phases.map((phase, index) =>
          this._renderPhase(context, phase, index, scale, compact),
        )}
      </div>
      ${
        compact
          ? nothing
          : html`<div class="phase-axis" data-drop="2">
              <span></span>
              ${axis([
                { at: 0, label: '0' },
                { at: 0.5, label: formatNumber(top / 2, top >= 20 ? 1 : 2, locale) },
                { at: 1, label: `${formatNumber(top, top >= 20 ? 0 : 1, locale)} ${unit}` },
              ])}
              <span class="note">${t('load.peak_mark', { minutes: config.minutes })}</span>
            </div>`
      }
    </div>`;
  }

  private _renderPhase(
    context: Context,
    phase: PhaseView,
    index: number,
    scale: number,
    compact: boolean,
  ): TemplateResult {
    const { config, locale, t, moreInfo } = context;
    const fill = phase.ratio ?? (phase.power === undefined ? 0 : phase.power / scale);
    const peak = phase.peak === undefined ? undefined : phase.peak / (phase.limit ?? scale);
    const power = formatPower(phase.power, locale);
    const color = LEVEL_COLORS[phase.level];
    const details = [
      phase.current === undefined
        ? undefined
        : `${formatNumber(phase.current, 1, locale)} ${t('unit.a')}`,
      phase.voltage === undefined
        ? undefined
        : `${formatNumber(phase.voltage, 0, locale)} ${t('unit.v')}`,
    ].filter((part): part is string => part !== undefined);

    return html`<div
      class="phase clickable"
      @click=${() => {
        moreInfo(config.phases[index]?.power);
      }}
    >
      <div class="phase-name" style="--c:${phase.color}"><i></i>${phase.name}</div>
      <div class="phase-bar">
        <span class="rail"></span>
        <span class="fill" style="width:${percent(fill)};--c:${color}"></span>
        ${
          phase.limit === undefined
            ? nothing
            : html`<span class="tick" style="left:${config.warning}%"></span
                ><span class="tick" style="left:${config.critical}%"></span>`
        }
        ${peak === undefined ? nothing : html`<span class="mark" style="left:${percent(peak)}"></span>`}
      </div>
      <div class="phase-value">
        <span
          ><b style=${phase.level === 'ok' ? '' : `--v:${color}`}>${power.value}</b
          ><small> ${power.unit}</small></span
        >
        ${
          details.length > 0 && !compact
            ? html`<span class="mono" data-drop="5">${details.join(' · ')}</span>`
            : nothing
        }
      </div>
    </div>`;
  }

  private _renderHint(context: Context, model: Model): TemplateResult | typeof nothing {
    const { locale, t } = context;
    const spread = imbalance(model.phases.map((phase) => phase.power));

    if (!spread || spread.spread < HINT_MIN_WATTS) return nothing;

    const high = model.phases[spread.high];
    const low = model.phases[spread.low];

    if (!high || !low) return nothing;

    const text = (watts: number): string => {
      const formatted = formatPower(watts, locale);

      return `${formatted.value} ${formatted.unit}`;
    };

    const free = (phase: PhaseView): string | undefined =>
      phase.limit === undefined || phase.power === undefined
        ? undefined
        : text(Math.max(0, phase.limit - phase.power));
    const freeHigh = free(high);
    const freeLow = free(low);
    const message =
      freeHigh !== undefined && freeLow !== undefined
        ? t('load.hint', {
            spread: text(spread.spread),
            high: high.name,
            low: low.name,
            free_high: freeHigh,
            free_low: freeLow,
          })
        : t('load.hint_plain', { spread: text(spread.spread), high: high.name, low: low.name });

    return html`<div class="hint" data-drop="1">
      ${icon('mdi:swap-horizontal')}<span>${message}</span>
    </div>`;
  }

  private _renderHistory(context: Context, model: Model, height: number): TemplateResult {
    const { config, t } = context;
    const positive = (values: readonly (number | undefined)[]): (number | undefined)[] =>
      values.map((value) => (value === undefined ? undefined : Math.max(0, value)));
    const label = t('load.chart', { minutes: config.minutes });
    const tip = (index: number): Tip | undefined => this._tip(context, model, index);
    const chart =
      model.phases.length > 1
        ? barChart(
            model.phases.map((phase) => ({ values: positive(phase.history), color: phase.color })),
            { height, fill: Math.round(height / 2), stacked: true, gap: 1, label, tip },
          )
        : barChart([{ values: positive(model.history), color: 'var(--m-home)', opacity: 0.85 }], {
            height,
            fill: Math.round(height / 2),
            gap: 1,
            radius: 0.5,
            label,
            tip,
          });

    return html`<div class="history shrink" data-drop="6">
      ${chart}
      ${axis(
        [
          { at: 0, label: t('live.ago', { minutes: config.minutes }) },
          { at: 0.5, label: `−${Math.round(config.minutes / 2)}` },
          { at: 1, label: t('common.now').toLowerCase() },
        ],
        4,
      )}
    </div>`;
  }

  private _tip(context: Context, model: Model, index: number): Tip | undefined {
    const { config, data, locale, now, t } = context;
    const total = model.history[index];
    const start = data?.start ?? now - config.minutes * MINUTE;
    const title = formatTime(start + index * MINUTE, locale);

    if (model.phases.length <= 1) {
      return total === undefined
        ? undefined
        : {
            title,
            rows: [
              {
                label: t('load.input'),
                value: tipValue(formatPower(total, locale)),
                color: 'var(--m-home)',
              },
            ],
          };
    }

    const rows = model.phases.flatMap((phase) => {
      const value = phase.history[index];

      return value === undefined
        ? []
        : [{ label: phase.name, value: tipValue(formatPower(value, locale)), color: phase.color }];
    });

    if (rows.length === 0) return undefined;

    return {
      title,
      rows:
        total === undefined
          ? rows
          : [...rows, { label: t('load.total'), value: tipValue(formatPower(total, locale)) }],
    };
  }

  private _stats(context: Context, model: Model): StatItem[] {
    const { config, data, locale, t } = context;
    const energy = formatEnergy(data?.today.energy, locale);
    const average = formatPower(averageOf(model.history), locale);
    const last =
      model.limit === undefined
        ? {
            label: t('load.peak', { minutes: config.minutes }),
            ...formatPower(maxOf(model.history), locale),
          }
        : {
            label: t('load.headroom'),
            ...formatPower(Math.max(0, model.limit - (model.total ?? 0)), locale),
          };

    return [
      { label: t('load.today'), value: energy.value, unit: energy.unit },
      { label: t('load.average', { minutes: config.minutes }), ...average },
      last,
    ];
  }
}
