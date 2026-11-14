import { css, html, nothing, svg } from 'lit';
import type { CSSResultGroup, SVGTemplateResult, TemplateResult } from 'lit';
import { HOUR, MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import type { EntityItem } from '../../core/config';
import { attribute, entityOf, isOn, readNumber } from '../../core/entities';
import {
  durationParts,
  formatDuration,
  formatNumber,
  formatPower,
  formatTime,
  unitText,
} from '../../core/format';
import type { Localize, TranslationKey } from '../../core/i18n';
import { clamp } from '../../core/math';
import { strip } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, empty, header, icon, pill } from '../../ui/parts';
import type { Tick } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { computeAutonomy, computeFlows, deriveHome } from './flows';
import type { Flow, FlowNode, PowerBalance } from './flows';
import { layoutSankey, ribbonPath, spread } from './sankey';
import type { NodeBox, Ribbon } from './sankey';

export interface FlowCardConfig extends BaseConfig {
  readonly solar?: string;
  readonly solar_strings: readonly EntityItem[];
  readonly grid?: string;
  readonly battery?: string;
  readonly battery_soc?: string;
  readonly home?: string;
  readonly grid_status?: string;
  readonly invert_grid_status: boolean;
  readonly sun?: string;
  readonly invert_grid: boolean;
  readonly invert_battery: boolean;
  readonly battery_capacity?: number;
  readonly battery_reserve: number;
  readonly battery_name?: string;
  readonly battery_temperature?: string;
  readonly grid_frequency?: string;
  readonly grid_voltages: readonly EntityItem[];
  readonly voltage_min: number;
  readonly voltage_max: number;
  readonly voltage_margin: number;
  readonly height: number;
  readonly animate: boolean;
  readonly show_panels: boolean;
}

type Context = CardContext<FlowCardConfig, never>;

interface Reading {
  readonly balance: PowerBalance;
  readonly soc?: number;
  readonly gridOn: boolean;
}

type PhaseState = 'ok' | 'near' | 'out' | 'none';

interface Phase {
  readonly name: string;
  readonly entity: string;
  readonly value?: number;
  readonly state: PhaseState;
}

const LABEL_SIZE = 66;
const SEGMENTS = 10;

const COLORS: Readonly<Record<FlowNode, string>> = {
  solar: 'var(--m-solar)',
  grid: 'var(--m-grid)',
  battery: 'var(--m-battery)',
  home: 'var(--m-home)',
};

const LABELS: Readonly<Record<FlowNode, TranslationKey>> = {
  solar: 'flow.solar',
  grid: 'flow.grid',
  battery: 'flow.battery',
  home: 'flow.home',
};

const SOURCE_SHARE: Readonly<Record<FlowNode, TranslationKey>> = {
  solar: 'flow.from_solar',
  grid: 'flow.from_grid',
  battery: 'flow.from_battery',
  home: 'flow.from_solar',
};

const signed = (value: number | undefined, invert: boolean): number | undefined => {
  if (value === undefined) return undefined;

  return invert ? -value : value;
};

const parseTime = (value: string | undefined): number | undefined => {
  if (!value) return undefined;

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : undefined;
};

const phaseState = (value: number | undefined, config: FlowCardConfig): PhaseState => {
  if (value === undefined) return 'none';
  if (value < config.voltage_min || value > config.voltage_max) return 'out';
  if (value < config.voltage_min + config.voltage_margin) return 'near';
  if (value > config.voltage_max - config.voltage_margin) return 'near';

  return 'ok';
};

const bigDuration = (minutes: number, t: Localize): TemplateResult => {
  const parts = durationParts(minutes);

  if (parts.hours === 0) {
    return html`<span class="xl">${parts.minutes}</span><span class="unit">${t('unit.min')}</span>`;
  }

  return html`<span class="xl">${parts.hours}</span><span class="unit">${t('unit.h')}</span>
    <span class="xl">${String(parts.minutes).padStart(2, '0')}</span
    ><span class="unit">${t('unit.min')}</span>`;
};

export class MetronFlowCard extends MetronCard<FlowCardConfig> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .sankey {
        display: grid;
        grid-template-columns: minmax(80px, 112px) minmax(64px, 1fr) minmax(104px, 148px);
        column-gap: 10px;
      }

      .side {
        position: relative;
        min-width: 0;
      }

      .node {
        position: absolute;
        right: 0;
        left: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        transform: translateY(-50%);
      }

      .node-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .node-label {
        overflow: hidden;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .share {
        font-family: var(--m-mono);
        font-size: 11px;
        color: var(--m-muted);
      }

      .node-value {
        white-space: nowrap;
      }

      .node-value b {
        font-family: var(--m-mono);
        font-size: 20px;
        font-weight: 500;
        letter-spacing: -0.02em;
      }

      .left .node-value b {
        font-size: 24px;
      }

      .node-value small,
      .node-sub {
        font-size: 11px;
        color: var(--m-muted);
      }

      .node-value small {
        margin-left: 4px;
        font-size: 12px;
      }

      .node-sub {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .strings {
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-family: var(--m-mono);
        font-size: 12px;
        color: var(--m-text-2);
      }

      .strings em {
        font-style: normal;
        color: var(--m-muted);
      }

      .mid {
        position: relative;
      }

      .mid svg {
        position: absolute;
        top: 0;
        right: 6px;
        left: 6px;
        width: calc(100% - 12px);
        height: 100%;
        overflow: visible;
      }

      .bar {
        position: absolute;
        width: 6px;
        min-height: 2px;
        border-radius: 3px;
      }

      .ribbon {
        stroke: var(--m-bg);
        stroke-width: 1px;
      }

      .dots {
        fill: none;
        stroke: color-mix(in srgb, var(--c) 18%, #fff);
        stroke-dasharray: 0.1 11;
        stroke-linecap: round;
        stroke-opacity: 0.9;
        stroke-width: 2.5px;
        animation: metron-flow 1.2s linear infinite;
      }

      @keyframes metron-flow {
        to {
          stroke-dashoffset: -11.1;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .dots {
          animation: none;
        }
      }

      .segments {
        display: flex;
        gap: 3px;
      }

      .segments span {
        flex: 1 1 0;
        height: 8px;
        overflow: hidden;
        border-radius: 2px;
        background: var(--m-track);
      }

      .segments i {
        display: block;
        height: 100%;
        background: var(--m-battery);
      }

      .phases {
        display: grid;
        grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
        gap: 8px;
      }

      .phase {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .phase b {
        font-family: var(--m-mono);
        font-size: 18px;
        font-weight: 500;
      }

      .phase.near b,
      .phase.out b {
        color: var(--m-warn);
      }

      .duration {
        display: flex;
        align-items: baseline;
        gap: 4px;
        white-space: nowrap;
      }

      .until {
        font-size: 12px;
        white-space: nowrap;
        color: var(--m-muted);
      }

      .until b {
        font-family: var(--m-mono);
        font-size: 16px;
        font-weight: 500;
        color: var(--m-text);
      }

      .timeline {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.grid(form.powerEntity('solar'), form.powerEntity('home')),
      form.grid(form.powerEntity('grid'), form.toggle('invert_grid')),
      form.grid(form.powerEntity('battery'), form.toggle('invert_battery')),
      form.grid(
        form.entity('battery_soc', { domain: ['sensor'], deviceClass: ['battery'] }),
        form.entity('grid_status', {
          domain: ['binary_sensor', 'sensor', 'switch', 'input_boolean'],
        }),
      ),
      form.expandable(
        'battery',
        form.grid(
          form.number('battery_capacity', { min: 0, step: 0.1, unit: 'kWh' }),
          form.number('battery_reserve', { min: 0, max: 100, unit: '%' }),
        ),
        form.grid(
          form.text('battery_name'),
          form.entity('battery_temperature', {
            domain: ['sensor'],
            deviceClass: ['temperature'],
          }),
        ),
      ),
      form.expandable(
        'details',
        form.entities('solar_strings', { domain: ['sensor'], deviceClass: ['power'] }),
        form.entities('grid_voltages', { domain: ['sensor'], deviceClass: ['voltage'] }),
        form.grid(
          form.entity('grid_frequency', { domain: ['sensor'], deviceClass: ['frequency'] }),
          form.entity('sun', { domain: ['sun'] }),
        ),
        form.grid(
          form.number('voltage_min', { min: 0, unit: 'V' }),
          form.number('voltage_max', { min: 0, unit: 'V' }),
        ),
        form.grid(
          form.number('height', { min: 120, max: 400, unit: 'px' }),
          form.toggle('animate'),
        ),
        form.grid(form.toggle('show_panels'), form.toggle('invert_grid_status')),
      ),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { solar: '', grid: '', battery: '', battery_soc: '', home: '' };
  }

  protected parseConfig(raw: RawConfig): FlowCardConfig {
    const config: FlowCardConfig = {
      ...cfg.base(raw),
      solar: cfg.entity(raw, 'solar'),
      solar_strings: cfg.entityItems(raw, 'solar_strings'),
      grid: cfg.entity(raw, 'grid'),
      battery: cfg.entity(raw, 'battery'),
      battery_soc: cfg.entity(raw, 'battery_soc'),
      home: cfg.entity(raw, 'home'),
      grid_status: cfg.entity(raw, 'grid_status'),
      invert_grid_status: cfg.boolean(raw, 'invert_grid_status', false),
      sun: cfg.entity(raw, 'sun') ?? 'sun.sun',
      invert_grid: cfg.boolean(raw, 'invert_grid', false),
      invert_battery: cfg.boolean(raw, 'invert_battery', false),
      battery_capacity: cfg.optionalNumber(raw, 'battery_capacity'),
      battery_reserve: cfg.number(raw, 'battery_reserve', 10, { min: 0, max: 100 }),
      battery_name: cfg.text(raw, 'battery_name'),
      battery_temperature: cfg.entity(raw, 'battery_temperature'),
      grid_frequency: cfg.entity(raw, 'grid_frequency'),
      grid_voltages: cfg.entityItems(raw, 'grid_voltages'),
      voltage_min: cfg.number(raw, 'voltage_min', 207, { min: 0 }),
      voltage_max: cfg.number(raw, 'voltage_max', 253, { min: 0 }),
      voltage_margin: cfg.number(raw, 'voltage_margin', 5, { min: 0 }),
      height: cfg.number(raw, 'height', 216, { min: 120, max: 400 }),
      animate: cfg.boolean(raw, 'animate', true),
      show_panels: cfg.boolean(raw, 'show_panels', true),
    };

    if (!config.solar && !config.grid && !config.battery && !config.home) {
      throw new Error('Configure at least one of: solar, grid, battery, home');
    }

    return config;
  }

  protected override trackedEntities(config: FlowCardConfig): readonly (string | undefined)[] {
    return [
      config.solar,
      config.grid,
      config.battery,
      config.battery_soc,
      config.home,
      config.grid_status,
      config.sun,
      config.battery_temperature,
      config.grid_frequency,
      ...config.solar_strings.map((item) => item.entity),
      ...config.grid_voltages.map((item) => item.entity),
    ];
  }

  protected override cardSize(): number {
    return 7;
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, t } = context;
    const reading = this._read(context);
    const flows = computeFlows(reading.balance);

    return html`
      ${header(config.title ?? t('flow.title'), this._statusPill(context, reading))}
      ${flows.length === 0 ? empty(t('flow.no_flow')) : this._renderSankey(context, reading, flows)}
      ${reading.gridOn ? this._renderPanels(context, reading) : this._renderOutage(context, reading)}
    `;
  }

  private _read(context: Context): Reading {
    const { config, hass } = context;
    const solar = Math.max(0, readNumber(hass, config.solar, 'power') ?? 0);
    const grid = signed(readNumber(hass, config.grid, 'power'), config.invert_grid) ?? 0;
    const battery = signed(readNumber(hass, config.battery, 'power'), config.invert_battery) ?? 0;
    const home = readNumber(hass, config.home, 'power') ?? deriveHome(solar, grid, battery);
    const status = config.grid_status ? isOn(hass, config.grid_status) : undefined;
    const gridOn = status === undefined ? true : status !== config.invert_grid_status;

    return {
      balance: { solar, grid, battery, home: Math.max(0, home) },
      soc: readNumber(hass, config.battery_soc, 'percent'),
      gridOn,
    };
  }

  private _statusPill(context: Context, reading: Reading): TemplateResult | typeof nothing {
    const { config, t } = context;

    if (!config.grid_status) return nothing;

    return reading.gridOn ? pill(t('flow.grid_on'), 'ok') : pill(t('flow.grid_off'), 'warn');
  }

  private _entityFor(config: FlowCardConfig, node: FlowNode): string | undefined {
    if (node === 'solar') return config.solar;
    if (node === 'grid') return config.grid;
    if (node === 'battery') return config.battery ?? config.battery_soc;

    return config.home;
  }

  private _renderSankey(
    context: Context,
    reading: Reading,
    flows: readonly Flow[],
  ): TemplateResult {
    const { config } = context;
    const sources = new Set(flows.map((flow) => flow.from)).size;
    const sinks = new Set(flows.map((flow) => flow.to)).size;
    const height = Math.min(config.height, 40 + LABEL_SIZE * Math.max(sources, sinks));
    const layout = layoutSankey(flows, height, 10);
    const leftCenters = spread(
      layout.left.map((node) => node.y + node.h / 2),
      LABEL_SIZE,
      height,
    );
    const rightCenters = spread(
      layout.right.map((node) => node.y + node.h / 2),
      LABEL_SIZE,
      height,
    );
    const sinkTotal = layout.right.reduce((total, node) => total + node.value, 0);
    const pairs = [...new Set(layout.ribbons.map((ribbon) => `${ribbon.from}-${ribbon.to}`))];

    return html`<div class="sankey" style="height:${height}px">
      <div class="side left">
        ${layout.left.map((node, index) =>
          this._renderSource(context, reading, node, leftCenters[index] ?? 0),
        )}
      </div>
      <div class="mid">
        <svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">
          <defs>${pairs.map((pair) => this._gradient(pair))}</defs>
          ${layout.ribbons.map(
            (ribbon) =>
              svg`<path class="ribbon" d=${ribbonPath(ribbon, 0, 100)} style="fill:url(#flow-${ribbon.from}-${ribbon.to})" vector-effect="non-scaling-stroke"></path>`,
          )}
          ${config.animate ? layout.ribbons.map((ribbon) => this._dots(ribbon, sinkTotal)) : nothing}
        </svg>
        ${layout.left.map((node) => this._bar(node, 'left'))}
        ${layout.right.map((node) => this._bar(node, 'right'))}
      </div>
      <div class="side right">
        ${layout.right.map((node, index) =>
          this._renderSink(context, reading, flows, node, rightCenters[index] ?? 0, sinkTotal),
        )}
      </div>
    </div>`;
  }

  private _gradient(pair: string): SVGTemplateResult {
    const [from, to] = pair.split('-') as [FlowNode, FlowNode];

    return svg`<linearGradient id="flow-${pair}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" style="stop-color:${COLORS[from]};stop-opacity:0.45"></stop>
      <stop offset="1" style="stop-color:${COLORS[to]};stop-opacity:0.45"></stop>
    </linearGradient>`;
  }

  private _dots(ribbon: Ribbon, total: number): SVGTemplateResult {
    const start = (ribbon.y0 + ribbon.h / 2).toFixed(2);
    const end = (ribbon.y1 + ribbon.h / 2).toFixed(2);
    const share = total > 0 ? ribbon.value / total : 0;
    const duration = clamp(2 - share * 1.4, 0.8, 2).toFixed(2);

    return svg`<path class="dots" d="M0,${start} C50,${start} 50,${end} 100,${end}" style="--c:${COLORS[ribbon.from]};animation-duration:${duration}s" vector-effect="non-scaling-stroke"></path>`;
  }

  private _bar(node: NodeBox, side: 'left' | 'right'): TemplateResult {
    return html`<i
      class="bar"
      style="${side}:0;top:${node.y.toFixed(1)}px;height:${node.h.toFixed(1)}px;background:${
        COLORS[node.id]
      }"
    ></i>`;
  }

  private _renderSource(
    context: Context,
    reading: Reading,
    node: NodeBox,
    center: number,
  ): TemplateResult {
    const { config, hass, t, locale, moreInfo } = context;
    const power = formatPower(node.value, locale);
    let sub: TemplateResult | typeof nothing = nothing;

    if (node.id === 'solar' && config.solar_strings.length > 0) {
      sub = html`<div class="strings">
        ${config.solar_strings.map((item, index) => {
          const watts = readNumber(hass, item.entity, 'power');

          return html`<span
            ><em>${item.name ?? `PV${index + 1}`}</em> ${formatNumber(
              watts === undefined ? undefined : watts / 1000,
              2,
              locale,
            )}</span
          >`;
        })}
      </div>`;
    }

    if (node.id === 'battery') {
      sub = html`<span class="node-sub"
        >${t('flow.discharging')}${
          reading.soc === undefined ? '' : ` · ${formatNumber(reading.soc, 0, locale)} %`
        }</span
      >`;
    }

    if (node.id === 'grid') sub = html`<span class="node-sub">${t('flow.import')}</span>`;

    return html`<div
      class="node clickable"
      style="top:${center.toFixed(1)}px"
      @click=${() => {
        moreInfo(this._entityFor(config, node.id));
      }}
    >
      <span class="node-label" style="color:${COLORS[node.id]}">${t(LABELS[node.id])}</span>
      <span class="node-value"><b>${power.value}</b><small>${power.unit}</small></span>
      ${sub}
    </div>`;
  }

  private _renderSink(
    context: Context,
    reading: Reading,
    flows: readonly Flow[],
    node: NodeBox,
    center: number,
    total: number,
  ): TemplateResult {
    const { config, t, locale, moreInfo } = context;
    const power = formatPower(node.value, locale);
    const share = total > 0 ? (node.value / total) * 100 : 0;

    return html`<div
      class="node clickable"
      style="top:${center.toFixed(1)}px"
      @click=${() => {
        moreInfo(this._entityFor(config, node.id));
      }}
    >
      <div class="node-head">
        <span class="node-label" style="color:${COLORS[node.id]}">${t(LABELS[node.id])}</span>
        <span class="share">${formatNumber(share, 0, locale)} %</span>
      </div>
      <span class="node-value"><b>${power.value}</b><small>${power.unit}</small></span>
      <span class="node-sub">${this._sinkNote(context, reading, flows, node.id)}</span>
    </div>`;
  }

  private _sinkNote(
    context: Context,
    reading: Reading,
    flows: readonly Flow[],
    node: FlowNode,
  ): string {
    const { t, locale } = context;

    if (node === 'battery') {
      return `${t('flow.charging')}${reading.soc === undefined ? '' : ` · ${formatNumber(reading.soc, 0, locale)} %`}`;
    }

    if (node === 'grid') return t('flow.export');

    const incoming = flows.filter((flow) => flow.to === node);
    const total = incoming.reduce((sum, flow) => sum + flow.value, 0);
    const main = [...incoming].sort((a, b) => b.value - a.value)[0];

    if (!main || total <= 0) return '';

    return t(SOURCE_SHARE[main.from], {
      value: formatNumber((main.value / total) * 100, 0, locale),
    });
  }

  private _renderPanels(context: Context, reading: Reading): TemplateResult | typeof nothing {
    const { config } = context;

    if (!config.show_panels) return nothing;

    const panels = [
      config.battery_soc ? this._renderBatteryPanel(context, reading) : undefined,
      config.grid_voltages.length > 0 || config.grid_frequency
        ? this._renderGridPanel(context)
        : undefined,
    ].filter((panel): panel is TemplateResult => panel !== undefined);

    if (panels.length === 0) return nothing;

    return html`<div class="panels" style="--cols:${panels.length}">${panels}</div>`;
  }

  private _renderBatteryPanel(context: Context, reading: Reading): TemplateResult {
    const { config, hass, t, locale, moreInfo } = context;
    const soc = reading.soc;
    const battery = reading.balance.battery;
    const power = formatPower(Math.abs(battery), locale);
    const temperature = readNumber(hass, config.battery_temperature, 'temperature');
    const title = config.battery_name
      ? `${t('flow.battery')} · ${config.battery_name}`
      : t('flow.battery');
    const sign = battery < -1 ? '+' : battery > 1 ? '−' : '';

    return html`<div
      class="panel clickable"
      @click=${() => {
        moreInfo(config.battery_soc);
      }}
    >
      <div class="panel-head">
        <span class="eyebrow">${title}</span>
        ${
          temperature === undefined
            ? nothing
            : html`<span class="meta mono">${formatNumber(temperature, 0, locale)} °C</span>`
        }
      </div>
      <div class="panel-head">
        <span
          ><span class="xl">${formatNumber(soc, 0, locale)}</span><span class="unit"> %</span></span
        >
        <span class="mono" style="color:var(--m-battery);font-size:13px"
          >${sign}${power.value} ${power.unit}</span
        >
      </div>
      <div class="segments">
        ${Array.from({ length: SEGMENTS }, (_, index) => {
          const fill = clamp(((soc ?? 0) - index * (100 / SEGMENTS)) / (100 / SEGMENTS), 0, 1);

          return html`<span><i style="width:${(fill * 100).toFixed(0)}%"></i></span>`;
        })}
      </div>
      <span class="note">${this._batteryNote(context, reading)}</span>
    </div>`;
  }

  private _batteryNote(context: Context, reading: Reading): string {
    const { config, t } = context;
    const soc = reading.soc;
    const capacity = config.battery_capacity;
    const battery = reading.balance.battery;

    if (soc === undefined || !capacity) {
      return battery < -1
        ? t('flow.charging')
        : battery > 1
          ? t('flow.discharging')
          : t('flow.idle');
    }

    if (battery < -50) {
      const hours = (((100 - soc) / 100) * capacity) / (-battery / 1000);

      return t('flow.to_full', { duration: formatDuration(hours * 60, t) });
    }

    if (battery > 50) {
      const hours =
        ((Math.max(0, soc - config.battery_reserve) / 100) * capacity) / (battery / 1000);

      return t('flow.to_reserve', {
        value: config.battery_reserve,
        duration: formatDuration(hours * 60, t),
      });
    }

    return t('flow.idle');
  }

  private _renderGridPanel(context: Context): TemplateResult {
    const { config, hass, t, locale, moreInfo } = context;
    const frequency = readNumber(hass, config.grid_frequency);
    const phases: Phase[] = config.grid_voltages.map((item, index) => {
      const value = readNumber(hass, item.entity);

      return {
        name: item.name ?? `L${index + 1}`,
        entity: item.entity,
        value,
        state: phaseState(value, config),
      };
    });
    const unit = unitText('V', locale);

    return html`<div class="panel">
      <div class="panel-head">
        <span class="eyebrow">${t('flow.grid')}</span>
        ${
          frequency === undefined
            ? nothing
            : html`<span
                class="meta mono clickable"
                @click=${() => {
                  moreInfo(config.grid_frequency);
                }}
                >${formatNumber(frequency, 2, locale)} ${unitText('Hz', locale)}</span
              >`
        }
      </div>
      ${
        phases.length === 0
          ? nothing
          : html`<div class="phases" style="--cols:${phases.length}">
              ${phases.map(
                (phase) =>
                  html`<div
                    class="phase clickable ${phase.state}"
                    @click=${() => {
                      moreInfo(phase.entity);
                    }}
                  >
                    <span class="label">${phase.name}</span>
                    <span
                      ><b>${formatNumber(phase.value, 0, locale)}</b>
                      <small class="unit">${unit}</small></span
                    >
                  </div>`,
              )}
            </div>`
      }
      ${this._voltageNote(context, phases)}
    </div>`;
  }

  private _voltageNote(
    context: Context,
    phases: readonly Phase[],
  ): TemplateResult | typeof nothing {
    const { config, t, locale } = context;
    const unit = unitText('V', locale);
    const out = phases.find((phase) => phase.state === 'out');

    if (out) {
      return html`<span class="note warn"
        >${t('flow.voltage_out', {
          phase: out.name,
          value: formatNumber(out.value, 0, locale),
          unit,
        })}</span
      >`;
    }

    const near = phases.find((phase) => phase.state === 'near');

    if (near?.value === undefined) return nothing;

    const limit =
      Math.abs(near.value - config.voltage_max) < Math.abs(near.value - config.voltage_min)
        ? config.voltage_max
        : config.voltage_min;

    return html`<span class="note warn"
      >${t('flow.voltage_near', { phase: near.name, limit, unit })}</span
    >`;
  }

  private _renderOutage(context: Context, reading: Reading): TemplateResult {
    const { config, hass, t, locale, now } = context;
    const solar = formatPower(reading.balance.solar, locale);
    const sunUp = entityOf(hass, config.sun)?.state === 'above_horizon';
    const rising = parseTime(attribute<string>(hass, config.sun, 'next_rising'));
    const setting = parseTime(attribute<string>(hass, config.sun, 'next_setting'));
    const since = parseTime(entityOf(hass, config.grid_status)?.last_changed);
    let sunLine = '';

    if (sunUp && setting) sunLine = t('flow.sunset_at', { time: formatTime(setting, locale) });
    if (!sunUp && rising) sunLine = t('flow.sunrise_at', { time: formatTime(rising, locale) });

    return html`<div class="panels">
        <div class="tile">
          ${icon(sunUp ? 'mdi:weather-sunny' : 'mdi:weather-sunset-up')}
          <div class="tile-text">
            <span>${t('flow.solar_now', { value: solar.value, unit: solar.unit })}</span>
            <span class="sub">${sunLine}</span>
          </div>
        </div>
        <div class="tile" style="--tone:var(--m-warn)">
          ${icon('mdi:transmission-tower-off')}
          <div class="tile-text">
            <span style="color:var(--m-warn)">${t('flow.grid_missing')}</span>
            <span class="sub"
              >${
                since === undefined
                  ? ''
                  : t('flow.outage_since', {
                      duration: formatDuration((now - since) / MINUTE, t),
                      time: formatTime(since, locale),
                    })
              }</span
            >
          </div>
        </div>
      </div>
      ${this._renderAutonomy(context, reading, rising)}`;
  }

  private _renderAutonomy(
    context: Context,
    reading: Reading,
    sunrise: number | undefined,
  ): TemplateResult | typeof nothing {
    const { config, t, locale, now } = context;
    const drain = config.battery
      ? Math.max(0, reading.balance.battery)
      : Math.max(0, reading.balance.home - reading.balance.solar);
    const autonomy = computeAutonomy(
      reading.soc,
      config.battery_capacity,
      config.battery_reserve,
      drain,
    );

    if (!autonomy) return nothing;

    const finite = Number.isFinite(autonomy.hours);
    const end = finite ? now + autonomy.hours * HOUR : undefined;
    const toSunrise = sunrise !== undefined && sunrise > now ? (sunrise - now) / HOUR : undefined;

    return html`<div class="panel">
      <div class="panel-head">
        <span class="eyebrow">${t('flow.autonomy')}</span>
        <span class="meta mono"
          >${t('flow.soc_range', {
            from: formatNumber(reading.soc, 0, locale),
            to: config.battery_reserve,
          })}</span
        >
      </div>
      <div class="panel-head">
        <span class="duration"
          >${
            finite
              ? html`<span class="unit">≈</span>${bigDuration(autonomy.hours * 60, t)}`
              : html`<span class="xl">∞</span>`
          }</span
        >
        ${
          end === undefined
            ? nothing
            : html`<span class="until">${t('flow.until')} <b>${formatTime(end, locale)}</b></span>`
        }
      </div>
      ${
        toSunrise === undefined || sunrise === undefined
          ? nothing
          : this._timeline(context, autonomy.hours, toSunrise, sunrise, end)
      }
      ${this._autonomyNotes(context, autonomy, toSunrise)}
    </div>`;
  }

  private _timeline(
    context: Context,
    hours: number,
    toSunrise: number,
    sunrise: number,
    end: number | undefined,
  ): TemplateResult {
    const { t, locale, now } = context;
    const fraction = Number.isFinite(hours) ? clamp(hours / toSunrise, 0, 1) : 1;
    const ticks: Tick[] = [{ at: 0, label: formatTime(now, locale) }];

    if (end !== undefined && fraction > 0.18 && fraction < 0.82) {
      ticks.push({ at: fraction, label: formatTime(end, locale), color: 'var(--m-battery)' });
    }

    ticks.push({ at: 1, label: t('flow.sunrise', { time: formatTime(sunrise, locale) }) });

    return html`<div class="timeline">
      ${strip(
        [
          { from: 0, to: fraction, color: 'var(--m-battery)' },
          ...(fraction < 1
            ? [
                {
                  from: fraction,
                  to: 1,
                  color: 'color-mix(in srgb, var(--m-warn) 55%, transparent)',
                  pattern: true,
                },
              ]
            : []),
        ],
        10,
      )}
      ${axis(ticks)}
    </div>`;
  }

  private _autonomyNotes(
    context: Context,
    autonomy: { readonly hours: number; readonly energy: number },
    toSunrise: number | undefined,
  ): TemplateResult | typeof nothing {
    const { t, locale } = context;

    if (!Number.isFinite(autonomy.hours)) {
      return html`<span class="note ok">${t('flow.unlimited')}</span>`;
    }

    if (toSunrise === undefined) return nothing;

    if (autonomy.hours >= toSunrise) {
      return html`<span class="note ok"
        >${t('flow.enough', { duration: formatDuration((autonomy.hours - toSunrise) * 60, t) })}</span
      >`;
    }

    return html`<span class="note warn"
        >⚠
        ${t('flow.shortfall', {
          duration: formatDuration((toSunrise - autonomy.hours) * 60, t),
        })}</span
      >
      <span class="note"
        >${t('flow.keep_below', {
          value: formatNumber(autonomy.energy / toSunrise, 2, locale),
          unit: unitText('kW', locale),
        })}</span
      >`;
  }
}
