import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { hourlyChanges } from '../../core/data/energy';
import { fetchStatistics } from '../../core/data/statistics';
import { isCounter } from '../../core/entities';
import { formatTime } from '../../core/format';
import { startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import { sparkBars } from '../../ui/charts';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, meta, stateIcon } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
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

      .tile-box .item-sub {
        margin-top: auto;
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.list('tiles', ITEM_LIST_FIELDS),
      form.grid(form.number('columns', { min: 1, max: 6 }), form.toggle('show_time')),
    ]);
  }

  static getStubConfig(): RawConfig {
    return { tiles: [] };
  }

  protected parseConfig(raw: RawConfig): TileCardConfig {
    const tiles = cfg.list(raw, 'tiles', parseItem);

    if (tiles.length === 0) throw new Error('Add at least one tile with an entity');

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

  protected override cardSize(config: TileCardConfig): number {
    return 1 + Math.ceil(config.tiles.length / config.columns) * 2;
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
    const { config, locale, now } = context;
    const showHeader = Boolean(config.title) || config.show_time;

    return html`
      ${
        showHeader
          ? header(config.title ?? '', config.show_time ? meta(formatTime(now, locale)) : nothing)
          : nothing
      }
      <div class="tiles" style="--cols:${config.columns}">
        ${config.tiles.map((tile, index) => this._renderTile(context, tile, index))}
      </div>
    `;
  }

  private _renderTile(context: Context, tile: ItemConfig, index: number): TemplateResult {
    const { hass, t, locale, moreInfo, data } = context;
    const view = describeItem(hass, tile, index, t, locale);
    const spark = tile.sparkline ? data?.get(tile.entity) : undefined;

    return html`<div
      class="tile-box clickable"
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
      ${spark ? sparkBars(spark, view.color, 24) : renderProgress(view)} ${renderSecondary(view)}
    </div>`;
  }
}
