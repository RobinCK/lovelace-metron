import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';

export type Tone =
  'solar' | 'home' | 'battery' | 'grid' | 'gas' | 'warn' | 'ok' | 'cold' | 'muted' | 'text';

export const toneColor = (tone: Tone): string =>
  tone === 'text' ? 'var(--m-text)' : `var(--m-${tone})`;

export const header = (
  title: string | false | undefined,
  aside?: TemplateResult | typeof nothing,
): TemplateResult | typeof nothing => {
  if (title === false && (aside === undefined || aside === nothing)) return nothing;

  return html`<div class="head">
    <div class="eyebrow">${title === false ? '' : (title ?? '')}</div>
    ${aside ?? nothing}
  </div>`;
};

export const meta = (text: string): TemplateResult => html`<div class="meta">${text}</div>`;

export const pill = (text: string, tone: Tone, dot = true): TemplateResult =>
  html`<span class="pill" style="--tone:${toneColor(tone)}"
    >${dot ? html`<i></i>` : nothing}${text}</span
  >`;

export interface StatItem {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly tone?: Tone;
  readonly sub?: string;
}

const statTemplate = (item: StatItem): TemplateResult =>
  html`<div class="stat" style=${item.tone ? `--tone:${toneColor(item.tone)}` : ''}>
    <span class="label">${item.label}</span>
    <span class="value"
      >${item.value}${item.unit ? html`<small> ${item.unit}</small>` : nothing}</span
    >
    ${item.sub ? html`<span class="sub">${item.sub}</span>` : nothing}
  </div>`;

export const stats = (items: readonly StatItem[]): TemplateResult | typeof nothing =>
  items.length === 0
    ? nothing
    : html`<div class="stats" style="--cols:${items.length}">${items.map(statTemplate)}</div>`;

export interface LegendItem {
  readonly label: string;
  readonly color: string;
  readonly line?: boolean;
}

export const legend = (items: readonly LegendItem[]): TemplateResult =>
  html`<div class="legend">
    ${items.map(
      (item) =>
        html`<span
          ><i class=${item.line ? 'line' : ''} style="--c:${item.color}"></i>${item.label}</span
        >`,
    )}
  </div>`;

export interface Tick {
  readonly at: number;
  readonly label: string;
  readonly color?: string;
}

export const axis = (ticks: readonly Tick[]): TemplateResult =>
  html`<div class="axis">
    ${ticks.map((tick) => {
      const position = Math.min(1, Math.max(0, tick.at));
      const edge = position <= 0.001 ? 'first' : position >= 0.999 ? 'last' : '';

      return html`<span
        class=${edge}
        style="left:${(position * 100).toFixed(2)}%;${tick.color ? `color:${tick.color}` : ''}"
        >${tick.label}</span
      >`;
    })}
  </div>`;

export const bigValue = (value: string, unit: string, color?: string): TemplateResult =>
  html`<span
    ><span class="big" style=${color ? `color:${color}` : ''}>${value}</span
    ><span class="unit"> ${unit}</span></span
  >`;

export const sideRow = (label: string, value: string, unit = ''): TemplateResult =>
  html`<div class="side-row">
    <span>${label}</span><span><b>${value}</b>${unit ? ` ${unit}` : ''}</span>
  </div>`;

export const empty = (text: string): TemplateResult => html`<div class="empty">${text}</div>`;

export const track = (fraction: number, color: string): TemplateResult =>
  html`<div class="track">
    <div style="width:${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%;--c:${color}"></div>
  </div>`;

export const icon = (name: string | undefined, color?: string): TemplateResult | typeof nothing =>
  name ? html`<ha-icon .icon=${name} style=${color ? `color:${color}` : ''}></ha-icon>` : nothing;

export const valueUnit = (value: string, unit: string, className = 'xl'): TemplateResult =>
  html`<span class="value-unit"
    ><span class=${className}>${value}</span><span class="unit"> ${unit}</span></span
  >`;
