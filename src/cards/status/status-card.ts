import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { findEntities } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { header, stateIcon } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { renderProgress, renderSecondary, itemStyles } from '../shared/item-parts';
import { describeItem, itemEntities, ITEM_LIST_FIELDS, parseItem } from '../shared/items';
import type { ItemConfig } from '../shared/items';

export interface StatusCardConfig extends BaseConfig {
  readonly chips: readonly ItemConfig[];
  readonly min_width: number;
}

type Context = CardContext<StatusCardConfig, never>;

export class MetronStatusCard extends MetronCard<StatusCardConfig> {
  static override styles: CSSResultGroup = [
    metronStyles,
    itemStyles,
    css`
      ha-card.metron {
        gap: 0;
        padding: 0;
      }

      .head {
        padding: 14px 14px 0;
      }

      .chips {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(var(--chip-min, 104px), 1fr));
      }

      .chip {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
        padding: 14px;
        box-shadow: -1px 0 0 var(--m-line);
      }

      .chip-name {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .chip-name span {
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .chip-name ha-state-icon {
        flex-shrink: 0;
        --mdc-icon-size: 14px;
      }

      .chip-value {
        white-space: nowrap;
      }

      .chip-value b {
        font-family: var(--m-mono);
        font-size: 20px;
        font-weight: 500;
      }

      .chip-value small {
        margin-left: 3px;
        font-size: 11px;
        color: var(--m-muted);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.list('chips', ITEM_LIST_FIELDS),
      form.number('min_width', { min: 64, max: 320, unit: 'px' }),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return {
      chips: findEntities(hass, { deviceClass: 'power' }, 4).map((entity) => ({ entity })),
    };
  }

  protected parseConfig(raw: RawConfig): StatusCardConfig {
    const chips = cfg.list(raw, 'chips', parseItem);

    return {
      ...cfg.base(raw),
      chips,
      min_width: cfg.number(raw, 'min_width', 104, { min: 64, max: 320 }),
    };
  }

  protected override trackedEntities(config: StatusCardConfig): readonly (string | undefined)[] {
    return config.chips.flatMap(itemEntities);
  }

  protected override missingOption(config: StatusCardConfig): string | undefined {
    return config.chips.length === 0 ? 'chips' : undefined;
  }

  protected override cardSize(): number {
    return 2;
  }

  protected renderBody(context: Context): TemplateResult {
    const { config } = context;

    return html`
      ${config.title ? header(config.title) : nothing}
      <div class="chips" style="--chip-min:${config.min_width}px">
        ${config.chips.map((chip, index) => this._renderChip(context, chip, index))}
      </div>
    `;
  }

  private _renderChip(context: Context, chip: ItemConfig, index: number): TemplateResult {
    const { hass, t, locale, moreInfo } = context;
    const view = describeItem(hass, chip, index, t, locale);

    return html`<div
      class="chip clickable"
      @click=${() => {
        moreInfo(chip.entity);
      }}
    >
      <div class="chip-name" style="color:${view.color}">
        ${stateIcon(hass, chip.entity, chip.icon)}<span>${view.name}</span>
      </div>
      <div class="chip-value">
        <b>${view.value.value}</b>${
          view.value.unit ? html`<small>${view.value.unit}</small>` : nothing
        }
      </div>
      ${renderProgress(view)} ${renderSecondary(view)}
    </div>`;
  }
}
