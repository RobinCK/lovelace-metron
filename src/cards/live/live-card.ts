import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchSamples, resample } from '../../core/data/history';
import { deviceClass, entityName, formatValue, readNumber } from '../../core/entities';
import type { Quantity } from '../../core/entities';
import { findEntities } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import { barChart, mirrorChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, colorOf, header } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { niceMax } from '../../core/math';

export interface LiveSeries {
  readonly entity: string;
  readonly name?: string;
  readonly color?: string;
  readonly invert: boolean;
  readonly max?: number;
}

export interface LiveCardConfig extends BaseConfig {
  readonly entities: readonly LiveSeries[];
  readonly minutes: number;
  readonly step: number;
  readonly height: number;
}

type History = ReadonlyMap<string, readonly (number | undefined)[]>;

type Context = CardContext<LiveCardConfig, History>;

const quantityOf = (hass: HomeAssistant, entityId: string): Quantity =>
  deviceClass(hass, entityId) === 'power' ? 'power' : 'raw';

export class MetronLiveCard extends MetronCard<LiveCardConfig, History> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .live {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-ok);
      }

      .live i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--m-ok);
        animation: metron-pulse 2s ease-out infinite;
      }

      @keyframes metron-pulse {
        0% {
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--m-ok) 55%, transparent);
        }

        80%,
        100% {
          box-shadow: 0 0 0 7px transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .live i {
          animation: none;
        }
      }

      .series {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .series-row {
        display: grid;
        grid-template-columns: minmax(56px, 76px) minmax(0, 1fr) minmax(72px, 88px);
        column-gap: 10px;
        align-items: end;
      }

      .series-name {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding-bottom: 2px;
        font-size: 12px;
        white-space: nowrap;
        color: var(--m-text-2);
      }

      .series-name span {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .series-name i {
        flex-shrink: 0;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--c);
      }

      .series-row .chart {
        border-bottom: 1px solid var(--m-line);
      }

      .series-value {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        white-space: nowrap;
      }

      .series-value b {
        font-family: var(--m-mono);
        font-size: 15px;
        font-weight: 500;
      }

      .series-value small,
      .series-value .peak {
        font-size: 10px;
        color: var(--m-muted);
      }

      .series-value .peak {
        font-family: var(--m-mono);
      }

      .axis-row {
        display: grid;
        grid-template-columns: minmax(56px, 76px) minmax(0, 1fr) minmax(72px, 88px);
        column-gap: 10px;
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.list('entities', {
        ...form.ITEM_FIELDS,
        invert: { selector: { boolean: {} } },
        max: { selector: { number: { mode: 'box' } } },
      }),
      form.grid(
        form.number('minutes', { min: 10, max: 360, unit: 'min' }),
        form.number('step', { min: 1, max: 30, unit: 'min' }),
      ),
      form.number('height', { min: 16, max: 120, unit: 'px' }),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return {
      entities: findEntities(hass, { deviceClass: 'power' }, 4).map((entity) => ({ entity })),
    };
  }

  protected parseConfig(raw: RawConfig): LiveCardConfig {
    const entities = cfg.list(raw, 'entities', (item) => {
      const entity = cfg.entity(item, 'entity');

      if (!entity) return undefined;

      return {
        entity,
        name: cfg.text(item, 'name'),
        color: cfg.text(item, 'color'),
        invert: cfg.boolean(item, 'invert', false),
        max: cfg.optionalNumber(item, 'max'),
      };
    });

    return {
      ...cfg.base(raw),
      entities,
      minutes: cfg.number(raw, 'minutes', 60, { min: 10, max: 360 }),
      step: cfg.number(raw, 'step', 1, { min: 1, max: 30 }),
      height: cfg.number(raw, 'height', 36, { min: 16, max: 120 }),
    };
  }

  protected override trackedEntities(config: LiveCardConfig): readonly (string | undefined)[] {
    return config.entities.map((series) => series.entity);
  }

  protected override refreshInterval(config: LiveCardConfig): number {
    return config.step * MINUTE;
  }

  protected override missingOption(config: LiveCardConfig): string | undefined {
    return config.entities.length === 0 ? 'entities' : undefined;
  }

  protected override cardSize(config: LiveCardConfig): number {
    return 2 + config.entities.length;
  }

  protected override fetchData(config: LiveCardConfig, hass: HomeAssistant): Promise<History> {
    const now = Date.now();
    const step = config.step * MINUTE;
    const count = Math.ceil(config.minutes / config.step);
    const start = now - count * step;

    return fetchSamples(
      hass,
      config.entities.map((series) => [series.entity, quantityOf(hass, series.entity)] as const),
      start - step,
      now,
    ).then(
      (samples) =>
        new Map(
          config.entities.map((series) => [
            series.entity,
            resample(samples.get(series.entity) ?? [], start, step, count),
          ]),
        ),
    );
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, t } = context;
    const half = Math.round(config.minutes / 2);

    return html`
      ${header(
        config.title ?? t('live.title', { minutes: config.minutes }),
        html`<span class="live"><i></i>${t('live.status', { step: config.step })}</span>`,
      )}
      <div class="series">
        ${config.entities.map((series, index) => this._renderSeries(context, series, index))}
        <div class="axis-row">
          <span></span>
          ${axis([
            { at: 0, label: t('live.ago', { minutes: config.minutes }) },
            { at: 0.5, label: `−${half}` },
            { at: 1, label: t('common.now').toLowerCase() },
          ])}
          <span></span>
        </div>
      </div>
    `;
  }

  private _renderSeries(context: Context, series: LiveSeries, index: number): TemplateResult {
    const { config, hass, data, t, locale, moreInfo } = context;
    const sign = series.invert ? -1 : 1;
    const quantity = quantityOf(hass, series.entity);
    const raw = readNumber(hass, series.entity, quantity);
    const current = raw === undefined ? undefined : raw * sign;
    const history = (data?.get(series.entity) ?? []).map((value) =>
      value === undefined ? undefined : value * sign,
    );
    const values = history.length > 0 ? [...history.slice(0, -1), current] : [];
    const color = colorOf(series.color, index);
    const numbers = values.filter((value): value is number => value !== undefined);
    const peak = numbers.length > 0 ? Math.max(...numbers) : undefined;
    const signed = numbers.some((value) => value < 0);
    const max = series.max ?? niceMax(Math.max(0, ...numbers.map((value) => Math.abs(value))));
    const formatted = formatValue(hass, series.entity, current, locale);
    const peakText = formatValue(hass, series.entity, peak, locale);

    return html`<div
      class="series-row clickable"
      @click=${() => {
        moreInfo(series.entity);
      }}
    >
      <div class="series-name" style="--c:${color}">
        <i></i><span>${series.name ?? entityName(hass, series.entity)}</span>
      </div>
      ${
        signed
          ? mirrorChart(
              values.map((value) => (value === undefined ? undefined : Math.max(0, value))),
              values.map((value) => (value === undefined ? undefined : Math.max(0, -value))),
              { height: config.height, max, upColor: color, downColor: color, gap: 1 },
            )
          : barChart([{ values, color, opacity: 0.85 }], {
              height: config.height,
              max,
              gap: 1,
              radius: 0.5,
            })
      }
      <div class="series-value">
        <span
          ><b>${formatted.value}</b>${
            formatted.unit ? html`<small> ${formatted.unit}</small>` : nothing
          }</span
        >
        <span class="peak">${t('live.max', { value: peakText.value })}</span>
      </div>
    </div>`;
  }
}
