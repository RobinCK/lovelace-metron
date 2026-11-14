import { html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { niceMax } from '../core/math';

const SLOT = 10;

export interface BarSeries {
  readonly values: readonly (number | undefined)[];
  readonly color: string | ((index: number) => string);
  readonly opacity?: number | ((index: number) => number);
}

export interface BarChartOptions {
  readonly height: number;
  readonly max?: number;
  readonly gap?: number;
  readonly stacked?: boolean;
  readonly radius?: number;
  readonly label?: string;
}

const resolve = <T>(value: T | ((index: number) => T), index: number): T =>
  typeof value === 'function' ? (value as (index: number) => T)(index) : value;

const slotCount = (series: readonly BarSeries[]): number =>
  Math.max(0, ...series.map((item) => item.values.length));

const seriesMax = (series: readonly BarSeries[], stacked: boolean): number => {
  const count = slotCount(series);
  let max = 0;

  for (let index = 0; index < count; index++) {
    const values = series.map((item) => Math.max(0, item.values[index] ?? 0));
    const slot = stacked ? values.reduce((a, b) => a + b, 0) : Math.max(0, ...values);

    max = Math.max(max, slot);
  }

  return niceMax(max);
};

export const barChart = (
  series: readonly BarSeries[],
  options: BarChartOptions,
): TemplateResult => {
  const count = slotCount(series);
  const stacked = options.stacked ?? false;
  const max = options.max ?? seriesMax(series, stacked);
  const gap = options.gap ?? 2;
  const height = options.height;
  const width = count * SLOT;
  const radius = options.radius ?? 0;
  const bars: SVGTemplateResult[] = [];

  for (let index = 0; index < count; index++) {
    let offset = 0;
    const visible = series.filter((item) => (item.values[index] ?? 0) > 0);
    const slotWidth = stacked ? SLOT - gap : (SLOT - gap) / Math.max(1, visible.length);

    visible.forEach((item, position) => {
      const value = item.values[index] ?? 0;
      const barHeight = Math.max(0.5, (value / max) * height);
      const x = index * SLOT + gap / 2 + (stacked ? 0 : position * slotWidth);
      const y = height - offset - barHeight;

      bars.push(
        svg`<rect x=${x} y=${y} width=${Math.max(0.5, slotWidth - (stacked ? 0 : 0.6))} height=${barHeight} rx=${radius} style="fill:${resolve(item.color, index)};fill-opacity:${resolve(item.opacity ?? 1, index)}"></rect>`,
      );

      if (stacked) offset += barHeight;
    });
  }

  return html`<div class="chart" role="img" aria-label=${options.label ?? nothing}>
    <svg
      viewBox="0 0 ${Math.max(width, 1)} ${height}"
      height=${height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      ${bars}
    </svg>
  </div>`;
};

export interface MirrorOptions {
  readonly height: number;
  readonly max?: number;
  readonly gap?: number;
  readonly upColor: string | ((index: number) => string);
  readonly downColor: string | ((index: number) => string);
  readonly label?: string;
}

export const mirrorChart = (
  up: readonly (number | undefined)[],
  down: readonly (number | undefined)[],
  options: MirrorOptions,
): TemplateResult => {
  const count = Math.max(up.length, down.length);
  const half = options.height / 2;
  const max =
    options.max ??
    niceMax(Math.max(0, ...up.map((value) => value ?? 0), ...down.map((value) => value ?? 0)));
  const gap = options.gap ?? 2;
  const bars: SVGTemplateResult[] = [];

  for (let index = 0; index < count; index++) {
    const x = index * SLOT + gap / 2;
    const upValue = Math.max(0, up[index] ?? 0);
    const downValue = Math.max(0, down[index] ?? 0);

    if (upValue > 0) {
      const h = Math.max(0.5, (upValue / max) * (half - 1));

      bars.push(
        svg`<rect x=${x} y=${half - 1 - h} width=${SLOT - gap} height=${h} style="fill:${resolve(options.upColor, index)}"></rect>`,
      );
    }

    if (downValue > 0) {
      const h = Math.max(0.5, (downValue / max) * (half - 1));

      bars.push(
        svg`<rect x=${x} y=${half + 1} width=${SLOT - gap} height=${h} style="fill:${resolve(options.downColor, index)}"></rect>`,
      );
    }
  }

  return html`<div class="chart" role="img" aria-label=${options.label ?? nothing}>
    <svg
      viewBox="0 0 ${Math.max(count * SLOT, 1)} ${options.height}"
      height=${options.height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1="0"
        x2=${count * SLOT}
        y1=${half}
        y2=${half}
        style="stroke:var(--m-line)"
        vector-effect="non-scaling-stroke"
      ></line>
      ${bars}
    </svg>
  </div>`;
};

export interface LinePoint {
  readonly x: number;
  readonly y: number | undefined;
}

export interface LineSeries {
  readonly points: readonly LinePoint[];
  readonly color: string;
  readonly area?: boolean;
  readonly dashed?: boolean;
  readonly width?: number;
  readonly opacity?: number;
}

export interface LineChartOptions {
  readonly height: number;
  readonly yMin?: number;
  readonly yMax?: number;
  readonly guides?: readonly {
    readonly y: number;
    readonly color: string;
    readonly dashed?: boolean;
  }[];
  readonly marker?: number;
  readonly label?: string;
  readonly overlay?: TemplateResult;
}

const VIEW_WIDTH = 1000;

const segmentsOf = (points: readonly LinePoint[]): LinePoint[][] => {
  const segments: LinePoint[][] = [];
  let current: LinePoint[] = [];

  for (const point of points) {
    if (point.y === undefined || !Number.isFinite(point.y)) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }

    current.push(point);
  }

  if (current.length > 0) segments.push(current);

  return segments;
};

export const lineChart = (
  series: readonly LineSeries[],
  options: LineChartOptions,
): TemplateResult => {
  const values = series.flatMap((item) =>
    item.points.flatMap((point) => (point.y === undefined ? [] : [point.y])),
  );
  const yMin = options.yMin ?? Math.min(0, ...values);
  const yMax = options.yMax ?? niceMax(Math.max(...values, yMin + 1));
  const height = options.height;
  const span = yMax - yMin || 1;
  const sx = (x: number): number => x * VIEW_WIDTH;
  const sy = (y: number): number => height - ((y - yMin) / span) * height;
  const paths: SVGTemplateResult[] = [];

  for (const item of series) {
    for (const segment of segmentsOf(item.points)) {
      const line = segment
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${sx(point.x).toFixed(1)},${sy(point.y ?? 0).toFixed(1)}`,
        )
        .join(' ');

      if (item.area) {
        const first = segment[0];
        const last = segment[segment.length - 1];

        if (first && last) {
          const base = sy(Math.max(yMin, 0));

          paths.push(
            svg`<path d="${line} L${sx(last.x).toFixed(1)},${base.toFixed(1)} L${sx(first.x).toFixed(1)},${base.toFixed(1)} Z" style="fill:${item.color};fill-opacity:0.16;stroke:none"></path>`,
          );
        }
      }

      paths.push(
        svg`<path d=${line} style="fill:none;stroke:${item.color};stroke-opacity:${item.opacity ?? 1};stroke-width:${item.width ?? 2}" stroke-dasharray=${item.dashed ? '4 4' : nothing} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>`,
      );
    }
  }

  const guides = (options.guides ?? []).map(
    (guide) =>
      svg`<line x1="0" x2=${VIEW_WIDTH} y1=${sy(guide.y)} y2=${sy(guide.y)} style="stroke:${guide.color}" stroke-dasharray=${guide.dashed === false ? nothing : '3 4'} vector-effect="non-scaling-stroke"></line>`,
  );

  const marker =
    options.marker === undefined
      ? nothing
      : svg`<line x1=${sx(options.marker)} x2=${sx(options.marker)} y1="0" y2=${height} style="stroke:var(--m-text);stroke-opacity:0.35" vector-effect="non-scaling-stroke"></line>`;

  return html`<div class="chart" role="img" aria-label=${options.label ?? nothing}>
    <svg
      viewBox="0 0 ${VIEW_WIDTH} ${height}"
      height=${height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      ${guides}${paths}${marker}
    </svg>
    ${options.overlay ?? nothing}
  </div>`;
};

export const sparkBars = (
  values: readonly (number | undefined)[],
  color: string | ((index: number) => string),
  height = 22,
): TemplateResult =>
  barChart([{ values, color }], {
    height,
    gap: 3,
    radius: 0.8,
    max: niceMax(Math.max(0, ...values.map((v) => v ?? 0))),
  });

export const ring = (
  fraction: number | undefined,
  color: string,
  size = 76,
  stroke = 8,
): SVGTemplateResult => {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = Math.min(1, Math.max(0, fraction ?? 0));

  return svg`<svg width=${size} height=${size} viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx=${size / 2} cy=${size / 2} r=${radius} style="fill:none;stroke:var(--m-track)" stroke-width=${stroke}></circle>
    ${
      value > 0
        ? svg`<circle cx=${size / 2} cy=${size / 2} r=${radius} style="fill:none;stroke:${color}" stroke-width=${stroke} stroke-linecap="round" stroke-dasharray="${(circumference * value).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"></circle>`
        : nothing
    }
  </svg>`;
};

export interface StripSegment {
  readonly from: number;
  readonly to: number;
  readonly color: string;
  readonly pattern?: boolean;
}

export const strip = (
  segments: readonly StripSegment[],
  height = 14,
  marker?: number,
  background = 'var(--m-track)',
): TemplateResult =>
  html`<div
    class="strip"
    style="position:relative;height:${height}px;border-radius:4px;overflow:hidden;background:${background}"
  >
    ${segments.map((segment) => {
      const left = Math.max(0, Math.min(1, segment.from));
      const right = Math.max(left, Math.min(1, segment.to));
      const fill = segment.pattern
        ? `repeating-linear-gradient(135deg, ${segment.color} 0 2px, transparent 2px 6px)`
        : segment.color;

      return html`<span
        style="position:absolute;top:0;bottom:0;left:${(left * 100).toFixed(2)}%;width:${((right - left) * 100).toFixed(2)}%;background:${fill}"
      ></span>`;
    })}
    ${
      marker === undefined
        ? nothing
        : html`<span
            style="position:absolute;top:0;bottom:0;left:${(Math.min(1, Math.max(0, marker)) * 100).toFixed(2)}%;width:2px;margin-left:-1px;background:var(--m-text)"
          ></span>`
    }
  </div>`;

export interface GaugeOptions {
  readonly size?: number;
  readonly stroke?: number;
  readonly sweep?: number;
  readonly origin?: number;
  readonly marker?: boolean;
}

const polar = (cx: number, cy: number, radius: number, degrees: number): [number, number] => {
  const radians = (degrees * Math.PI) / 180;

  return [cx + radius * Math.cos(radians), cy - radius * Math.sin(radians)];
};

export const gauge = (
  fraction: number | undefined,
  color: string,
  options: GaugeOptions = {},
): SVGTemplateResult => {
  const size = options.size ?? 120;
  const stroke = options.stroke ?? 10;
  const sweep = options.sweep ?? 240;
  const origin = options.origin ?? 0;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 90 + sweep / 2;
  const [x0, y0] = polar(cx, cy, radius, startAngle);
  const [x1, y1] = polar(cx, cy, radius, startAngle - sweep);
  const length = (radius * sweep * Math.PI) / 180;
  const value = Math.min(1, Math.max(0, fraction ?? origin));
  const from = Math.min(origin, value);
  const segment = Math.abs(value - origin) * length;
  const path = `M${x0.toFixed(2)},${y0.toFixed(2)} A${radius},${radius} 0 1 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  const [mx, my] = polar(cx, cy, radius, startAngle - value * sweep);
  const height = cy + Math.sin(((sweep / 2 - 90) * Math.PI) / 180) * radius + stroke / 2 + 1;

  return svg`<svg width=${size} height=${height.toFixed(1)} viewBox="0 0 ${size} ${height.toFixed(1)}" aria-hidden="true">
    <path d=${path} style="fill:none;stroke:var(--m-track)" stroke-width=${stroke} stroke-linecap="round"></path>
    ${
      fraction === undefined
        ? nothing
        : svg`<path d=${path} style="fill:none;stroke:${color}" stroke-width=${stroke} stroke-linecap="round" stroke-dasharray="${segment.toFixed(2)} ${(length * 2).toFixed(2)}" stroke-dashoffset=${(-from * length).toFixed(2)}></path>`
    }
    ${
      origin > 0
        ? svg`<line x1=${cx} x2=${cx} y1=${cy - radius - stroke / 2 - 3} y2=${cy - radius + stroke / 2 + 1} style="stroke:var(--m-text)" stroke-width="2" stroke-linecap="round"></line>`
        : nothing
    }
    ${
      options.marker && fraction !== undefined
        ? svg`<circle cx=${mx.toFixed(2)} cy=${my.toFixed(2)} r=${stroke / 2 + 1} style="fill:var(--m-bg);stroke:${color}" stroke-width="3"></circle>`
        : nothing
    }
  </svg>`;
};
