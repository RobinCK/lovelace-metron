import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { readNumber } from '../../core/entities';
import { formatDuration, formatNumber, formatPower, formatTime, MINUS } from '../../core/format';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, stats } from '../../ui/parts';
import type { StatItem, Tone } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { isOutageState } from '../shared/outages';
import { assess, batteryBudget, freeOn, powerOnTime } from './headroom';
import type { ApplianceSpec, Assessment, BatteryBudget, PhaseLoad, Verdict } from './headroom';

export interface HeadroomPhase {
  readonly power: string;
  readonly name?: string;
}

export interface HeadroomAppliance extends ApplianceSpec {
  readonly icon?: string;
}

export interface HeadroomCardConfig extends BaseConfig {
  readonly phases: readonly HeadroomPhase[];
  readonly phase_limit?: number;
  readonly appliances: readonly HeadroomAppliance[];
  readonly battery_soc?: string;
  readonly battery_capacity?: number;
  readonly battery_reserve: number;
  readonly power_on?: string;
  readonly grid_status?: string;
  readonly invert_grid_status: boolean;
}

interface Model {
  readonly phases: readonly PhaseLoad[];
  readonly limit: number;
  readonly outage: boolean;
  readonly soc?: number;
  readonly powerOn?: number;
  readonly budget?: BatteryBudget;
}

type Context = CardContext<HeadroomCardConfig, undefined>;

const CAUTION = 0.7;
const CRITICAL = 0.9;
const VERDICT_COLORS: Readonly<Record<Verdict, string>> = {
  ok: 'var(--m-ok)',
  battery: 'var(--m-caution)',
  phase: 'var(--m-warn)',
};

const usageColor = (ratio: number): string => {
  if (ratio >= CRITICAL) return 'var(--m-warn)';
  if (ratio >= CAUTION) return 'var(--m-caution)';

  return 'var(--m-ok)';
};

export class MetronHeadroomCard extends MetronCard<HeadroomCardConfig, undefined> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      :host {
        --m-caution: var(--metron-caution-color, #ffb547);
      }

      .section {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .section-head b {
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .tiles {
        display: grid;
        grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr));
        gap: 10px;
      }

      .tile {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 12px;
        border-radius: 12px;
        background: var(--m-panel);
      }

      .tile-head {
        display: flex;
        justify-content: space-between;
        gap: 6px;
        font-family: var(--m-mono);
        font-size: 11px;
        color: var(--m-muted);
      }

      .tile-head b {
        font-weight: 600;
        color: var(--m-text);
      }

      .tile-value {
        display: flex;
        align-items: baseline;
        gap: 4px;
        white-space: nowrap;
      }

      .tile-value b {
        font-family: var(--m-mono);
        font-size: 18px;
        font-weight: 500;
        color: var(--v, var(--m-text));
      }

      .tile-value small {
        font-size: 11px;
        color: var(--m-muted);
      }

      .bar {
        height: 4px;
        border-radius: 2px;
        background: var(--m-track);
      }

      .bar div {
        height: 100%;
        border-radius: inherit;
        background: var(--c);
      }

      .appliances {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--m-line);
      }

      .appliance {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px 62px 132px;
        column-gap: 10px;
        align-items: center;
        padding: 9px 0;
        border-bottom: 1px solid var(--m-line);
      }

      .appliance-name {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .appliance-name span {
        overflow: hidden;
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .appliance-name small {
        font-family: var(--m-mono);
        font-size: 10px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .phase-chip {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 20px;
        border-radius: 6px;
        background: var(--m-panel);
        font-family: var(--m-mono);
        font-size: 10px;
        font-weight: 600;
        color: var(--m-text-2);
      }

      .appliance-power {
        text-align: right;
        white-space: nowrap;
      }

      .appliance-power b {
        font-family: var(--m-mono);
        font-size: 13px;
        font-weight: 500;
      }

      .appliance-power small {
        font-size: 10px;
        color: var(--m-muted);
      }

      .verdict {
        justify-self: end;
        padding: 4px 8px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--tone) 14%, transparent);
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        color: var(--tone);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.list(
        'phases',
        {
          power: {
            selector: { entity: { filter: { domain: ['sensor'], device_class: ['power'] } } },
            required: true,
          },
          name: { selector: { text: {} } },
        },
        'name',
      ),
      form.grid(
        form.number('phase_limit', { min: 0.1, step: 0.1, unit: 'kW' }),
        form.entity('power_on', { domain: ['sensor', 'input_datetime'] }),
      ),
      form.grid(
        form.entity('grid_status', {
          domain: ['binary_sensor', 'sensor', 'switch', 'input_boolean'],
        }),
        form.toggle('invert_grid_status'),
      ),
      form.list(
        'appliances',
        {
          name: { selector: { text: {} }, required: true },
          power: { selector: { number: { mode: 'box', unit_of_measurement: 'W' } } },
          phase: { selector: { number: { mode: 'box', min: 1, max: 3 } } },
          minutes: { selector: { number: { mode: 'box', unit_of_measurement: 'min' } } },
        },
        'name',
      ),
      form.expandable(
        'battery',
        form.entity('battery_soc', { domain: ['sensor'], deviceClass: ['battery'] }),
        form.grid(
          form.number('battery_capacity', { min: 0, step: 0.1, unit: 'kWh' }),
          form.number('battery_reserve', { min: 0, max: 100, unit: '%' }),
        ),
      ),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): HeadroomCardConfig {
    const limit = cfg.optionalNumber(raw, 'phase_limit');

    return {
      ...cfg.base(raw),
      phases: cfg
        .list(raw, 'phases', (item) => {
          const power = cfg.entity(item, 'power');

          return power ? { power, name: cfg.text(item, 'name') } : undefined;
        })
        .slice(0, 3),
      phase_limit: limit !== undefined && limit > 0 ? limit : undefined,
      appliances: cfg.list(raw, 'appliances', (item) => {
        const name = cfg.text(item, 'name');
        const power = cfg.optionalNumber(item, 'power');

        if (!name || power === undefined || power <= 0) return undefined;

        const phase = cfg.optionalNumber(item, 'phase');

        return {
          name,
          power,
          phase: phase === undefined ? undefined : Math.min(3, Math.max(1, Math.round(phase))),
          minutes: cfg.number(item, 'minutes', 30, { min: 1, max: 1440 }),
          icon: cfg.text(item, 'icon'),
        };
      }),
      battery_soc: cfg.entity(raw, 'battery_soc'),
      battery_capacity: cfg.optionalNumber(raw, 'battery_capacity'),
      battery_reserve: cfg.number(raw, 'battery_reserve', 20, { min: 0, max: 100 }),
      power_on: cfg.entity(raw, 'power_on'),
      grid_status: cfg.entity(raw, 'grid_status'),
      invert_grid_status: cfg.boolean(raw, 'invert_grid_status', false),
    };
  }

  protected override trackedEntities(config: HeadroomCardConfig): readonly (string | undefined)[] {
    return [
      ...config.phases.map((phase) => phase.power),
      config.battery_soc,
      config.power_on,
      config.grid_status,
    ];
  }

  protected override refreshInterval(): number {
    return MINUTE;
  }

  protected override missingOption(config: HeadroomCardConfig): string | undefined {
    if (config.phases.length === 0) return 'phases';
    if (config.phase_limit === undefined) return 'phase_limit';

    return undefined;
  }

  protected override cardSize(config: HeadroomCardConfig): number {
    return 4 + Math.ceil(config.appliances.length / 2);
  }

  protected override defaultSize(config: HeadroomCardConfig): SizeSetting {
    return config.appliances.length <= 3 ? 'medium' : 'large';
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, size, t } = context;
    const model = this._model(context);

    return html`
      ${header(config.title ?? t('headroom.title'), this._badge(context, model))}
      ${this._renderPhases(context, model)}
      ${size === 'small' ? nothing : this._renderAppliances(context, model)}
      ${size === 'small' ? nothing : stats(this._stats(context, model), 1)}
    `;
  }

  private _model(context: Context): Model {
    const { config, hass, now } = context;
    const phases = config.phases.map((phase, index): PhaseLoad => ({
      name: phase.name ?? `L${index + 1}`,
      power: readNumber(hass, phase.power, 'power'),
    }));
    const status = config.grid_status ? hass.states[config.grid_status]?.state : undefined;
    const outage = status === undefined || isOutageState(status, config.invert_grid_status);
    const soc = readNumber(hass, config.battery_soc, 'percent');
    const powerOn = config.power_on
      ? powerOnTime(hass.states[config.power_on]?.state, now)
      : undefined;
    const load = phases.reduce((total, phase) => total + Math.max(0, phase.power ?? 0), 0);

    return {
      phases,
      limit: (config.phase_limit ?? 0) * 1000,
      outage,
      soc,
      powerOn,
      budget: batteryBudget(
        soc,
        config.battery_reserve,
        config.battery_capacity,
        load,
        outage && powerOn !== undefined ? powerOn - now : undefined,
      ),
    };
  }

  private _badge(context: Context, model: Model): TemplateResult | typeof nothing {
    const { config, locale, t } = context;
    const battery =
      model.soc === undefined
        ? undefined
        : t('headroom.battery', { value: formatNumber(model.soc, 0, locale) });

    if (!config.grid_status) {
      return battery
        ? html`<span class="pill" style="--tone:var(--m-battery)"><i></i>${battery}</span>`
        : nothing;
    }

    const state = model.outage ? t('headroom.outage') : t('headroom.grid_on');
    const tone = model.outage ? 'var(--m-warn)' : 'var(--m-ok)';

    return html`<span class="pill" style="--tone:${tone}"
      ><i></i>${battery ? `${state} · ${battery}` : state}</span
    >`;
  }

  private _renderPhases(context: Context, model: Model): TemplateResult {
    const { config, locale, t } = context;

    return html`<div class="section">
      <div class="section-head" data-drop="1">
        <b>${t('headroom.free')}</b
        ><span
          >${t('headroom.limit_note', {
            value: formatNumber(config.phase_limit ?? 0, 1, locale),
          })}</span
        >
      </div>
      <div class="tiles" style="--n:${model.phases.length}">
        ${model.phases.map((phase, index) => this._renderTile(context, model, phase, index))}
      </div>
    </div>`;
  }

  private _renderTile(
    context: Context,
    model: Model,
    phase: PhaseLoad,
    index: number,
  ): TemplateResult {
    const { config, locale, moreInfo } = context;
    const load = Math.max(0, phase.power ?? 0);
    const ratio = model.limit > 0 ? load / model.limit : 0;
    const free = formatPower(freeOn(phase, model.limit), locale);
    const color = usageColor(ratio);

    return html`<div
      class="tile clickable"
      @click=${() => {
        moreInfo(config.phases[index]?.power);
      }}
    >
      <div class="tile-head">
        <b>${phase.name}</b
        ><span
          >${formatNumber(load / 1000, 1, locale)} /
          ${formatNumber(model.limit / 1000, 1, locale)}</span
        >
      </div>
      <div class="tile-value">
        <b style=${ratio >= CAUTION ? `--v:${color}` : ''}>${free.value}</b
        ><small>${free.unit}</small>
      </div>
      <div class="bar">
        <div style="width:${(Math.min(1, ratio) * 100).toFixed(1)}%;--c:${color}"></div>
      </div>
    </div>`;
  }

  private _renderAppliances(context: Context, model: Model): TemplateResult | typeof nothing {
    const { config, t } = context;

    if (config.appliances.length === 0) return nothing;

    const rows = config.appliances
      .map((appliance) => ({
        appliance,
        result: assess(appliance, model.phases, model.limit, model.budget, model.outage),
      }))
      .sort((a, b) => Number(a.result.verdict !== 'ok') - Number(b.result.verdict !== 'ok'));

    return html`<div class="section">
      <div class="section-head">
        <b>${t('headroom.appliances')}</b><span>${t('headroom.if_now')}</span>
      </div>
      <div class="appliances">
        ${rows.map(({ appliance, result }, index) =>
          this._renderAppliance(context, model, appliance, result, rows.length - index + 1),
        )}
      </div>
    </div>`;
  }

  private _renderAppliance(
    context: Context,
    model: Model,
    appliance: HeadroomAppliance,
    result: Assessment,
    drop: number,
  ): TemplateResult {
    const { locale, t } = context;
    const phase = result.phase === undefined ? undefined : model.phases[result.phase];
    const power = formatPower(appliance.power, locale);
    const duration = formatDuration(appliance.minutes, t);
    const free = formatPower(result.free ?? 0, locale);
    const note =
      result.verdict === 'phase'
        ? t('headroom.free_on', {
            phase: phase?.name ?? '',
            value: free.value,
            unit: free.unit,
          })
        : model.outage && model.budget && result.cost !== undefined
          ? t('headroom.cost', { value: formatDuration(result.cost / MINUTE, t) })
          : undefined;
    const verdict =
      result.verdict === 'ok'
        ? t('headroom.ok')
        : result.verdict === 'battery'
          ? t('headroom.battery_short')
          : t('headroom.no_room', { phase: phase?.name ?? '' });

    return html`<div class="appliance" data-drop=${drop}>
      <div class="appliance-name">
        <span>${appliance.name}</span><small>${note ? `${duration} · ${note}` : duration}</small>
      </div>
      <span class="phase-chip">${phase?.name ?? '—'}</span>
      <span class="appliance-power"><b>${power.value}</b><small> ${power.unit}</small></span>
      <span class="verdict" style="--tone:${VERDICT_COLORS[result.verdict]}">${verdict}</span>
    </div>`;
  }

  private _stats(context: Context, model: Model): StatItem[] {
    const { locale, t } = context;
    const budget = model.budget;

    if (!budget) return [];

    const items: StatItem[] = [
      {
        label: t('headroom.runtime'),
        value: budget.runtime === undefined ? '—' : formatDuration(budget.runtime / MINUTE, t),
      },
    ];

    if (!model.outage || model.powerOn === undefined || budget.margin === undefined) return items;

    const tone: Tone = budget.margin >= 0 ? 'ok' : 'warn';
    const margin = formatDuration(Math.abs(budget.margin) / MINUTE, t);

    return [
      ...items,
      { label: t('headroom.power_on'), value: formatTime(model.powerOn, locale) },
      {
        label: t('headroom.margin'),
        value: budget.margin >= 0 ? margin : `${MINUS}${margin}`,
        tone,
      },
    ];
  }
}
