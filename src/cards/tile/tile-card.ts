import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import { contentHeight } from '../../core/size';
import type { SizeSetting } from '../../core/size';
import * as cfg from '../../core/config';
import { hourlyChanges } from '../../core/data/energy';
import { fetchStatistics } from '../../core/data/statistics';
import { formatValue, isCounter } from '../../core/entities';
import { formatTime } from '../../core/format';
import { niceMax } from '../../core/math';
import { startOfDay } from '../../core/time';
import { findEntities } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import { barChart } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta, stateIcon } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { tipValue } from '../../ui/tip';
import { itemStyles, renderProgress, renderSecondary } from '../shared/item-parts';
import { describeItem, itemEntities, ITEM_LIST_FIELDS, parseItem } from '../shared/items';
import type { ItemConfig } from '../shared/items';

export interface TileCardConfig extends BaseConfig {
  readonly tiles: readonly ItemConfig[];
  readonly columns: number;
  readonly show_time: boolean;
}

type Sparklines = ReadonlyMap<string, readonly (number | undefined)[]>;

type Context = CardContext<TileCardConfig, Sparklines>;

const HEADER = 40;
const GAP = 10;
const MIN_TILE = 72;

export class MetronTileCard extends MetronCard<TileCardConfig, Sparklines> {
  static override styles: CSSResultGroup = [
    metronStyles,
    itemStyles,
    css`
      .head .eyebrow {
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0;
        text-transform: none;
        color: var(--m-text);
      }

      .tiles {
        display: grid;
        grid-template-columns: repeat(var(--cols, 2), minmax(0, 1fr));
        gap: 10px;
      }

      .tile-box {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 12px;
        border-radius: 14px;
        background: var(--m-panel);
      }

      .tile-name {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 11px;
        white-space: nowrap;
        color: var(--m-text-2);
      }

      .tile-name span {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tile-name ha-state-icon {
        flex-shrink: 0;
        --mdc-icon-size: 14px;
      }

      .tile-value {
        white-space: nowrap;
      }

      .tile-value b {
        font-family: var(--m-mono);
        font-size: 22px;
        font-weight: 500;
      }

      .tile-value small {
        margin-left: 3px;
        font-size: 11px;
        color: var(--m-muted);
      }

      .tile-box .tile-sub {
        margin-top: auto;
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.list('tiles', ITEM_LIST_FIELDS),
      form.grid(form.number('columns', { min: 1, max: 6 }), form.toggle('show_time')),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return {
      tiles: findEntities(hass, { deviceClass: 'power' }, 4).map((entity) => ({ entity })),
    };
  }

  protected parseConfig(raw: RawConfig): TileCardConfig {
    const tiles = cfg.list(raw, 'tiles', parseItem);

    return {
      ...cfg.base(raw),
      tiles,
      columns: cfg.number(raw, 'columns', 2, { min: 1, max: 6 }),
      show_time: cfg.boolean(raw, 'show_time', false),
    };
  }

  protected override trackedEntities(config: TileCardConfig): readonly (string | undefined)[] {
    return config.tiles.flatMap(itemEntities);
  }

  protected override missingOption(config: TileCardConfig): string | undefined {
    return config.tiles.length === 0 ? 'tiles' : undefined;
  }

  protected override cardSize(config: TileCardConfig): number {
    return 1 + Math.ceil(config.tiles.length / config.columns) * 2;
  }

  protected override defaultSize(config: TileCardConfig): SizeSetting {
    const rows = Math.ceil(config.tiles.length / config.columns);

    if (rows <= 1) return 'small';

    return rows === 2 ? 'medium' : 'large';
  }

  protected override fetchData(
    config: TileCardConfig,
    hass: HomeAssistant,
  ): Promise<Sparklines> | undefined {
    const ids = config.tiles.filter((tile) => tile.sparkline).map((tile) => tile.entity);

    if (ids.length === 0) return undefined;

    const start = startOfDay(Date.now());

    return fetchStatistics(hass, {
      entityIds: ids,
      start,
      end: start + DAY,
      period: 'hour',
      types: ['change', 'mean'],
    }).then(
      (result) =>
        new Map(
          ids.map((id) => [
            id,
            hourlyChanges(result.get(id), start, 24, (row) =>
              isCounter(hass, id) ? row.change : row.mean,
            ),
          ]),
        ),
    );
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, locale, now, size } = context;
    const showHeader = Boolean(config.title) || config.show_time;
    const available = size === 'auto' ? undefined : contentHeight(size) - (showHeader ? HEADER : 0);
    const needed = Math.ceil(config.tiles.length / config.columns);
    const rows =
      available === undefined
        ? needed
        : Math.max(1, Math.min(needed, Math.floor((available + GAP) / (MIN_TILE + GAP))));
    const height =
      available === undefined ? undefined : Math.floor((available - (rows - 1) * GAP) / rows);
    const tiles = config.tiles.slice(0, rows * config.columns);

    return html`
      ${
        showHeader
          ? header(config.title ?? '', config.show_time ? meta(formatTime(now, locale)) : nothing)
          : nothing
      }
      <div
        class="tiles"
        style="--cols:${config.columns};${height === undefined ? '' : `grid-auto-rows:${height}px`}"
      >
        ${tiles.map((tile, index) => this._renderTile(context, tile, index, tiles.length - index))}
      </div>
    `;
  }

  private _renderTile(
    context: Context,
    tile: ItemConfig,
    index: number,
    drop: number,
  ): TemplateResult {
    const { hass, t, locale, moreInfo, data, now, size } = context;
    const sparkHeight = size === 'large' ? 56 : size === 'medium' ? 40 : size === 'small' ? 18 : 24;
    const view = describeItem(hass, tile, index, t, locale);
    const spark = tile.sparkline ? data?.get(tile.entity) : undefined;
    const start = startOfDay(now);

    return html`<div
      class="tile-box shrink clickable"
      data-drop=${drop + 1}
      @click=${() => {
        moreInfo(tile.entity);
      }}
    >
      <div class="tile-name">
        ${stateIcon(hass, tile.entity, tile.icon, view.color)}<span>${view.name}</span>
      </div>
      <div class="tile-value">
        <b>${view.value.value}</b>${
          view.value.unit ? html`<small>${view.value.unit}</small>` : nothing
        }
      </div>
      ${
        spark
          ? barChart([{ values: spark, color: view.color }], {
              height: sparkHeight,
              fill: 16,
              gap: 3,
              radius: 0.8,
              max: niceMax(Math.max(0, ...spark.map((value) => value ?? 0))),
              tip: (hour) => {
                const value = spark[hour];

                if (value === undefined) return undefined;

                const from = start + hour * HOUR;

                return {
                  title: `${formatTime(from, locale)}–${formatTime(from + HOUR, locale)}`,
                  rows: [
                    {
                      label: view.name,
                      value: tipValue(formatValue(hass, tile.entity, value, locale)),
                      color: view.color,
                    },
                  ],
                };
              },
            })
          : renderProgress(view)
      }
      ${
        view.secondary
          ? html`<div class="tile-sub" data-drop="1">${renderSecondary(view)}</div>`
          : nothing
      }
    </div>`;
  }
}
