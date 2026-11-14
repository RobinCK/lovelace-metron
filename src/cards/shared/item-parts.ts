import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import type { ItemView } from './items';

export const itemStyles = css`
  .progress {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 10px;
  }

  .progress span {
    flex: 1 1 0;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--m-track);
  }

  .progress i {
    display: block;
    height: 100%;
    border-radius: 2px;
  }

  .phases-row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 10px;
    font-family: var(--m-mono);
    font-size: 10px;
    font-weight: 600;
  }

  .item-sub {
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--m-muted);
  }
`;

const SEGMENTS = 10;

export const renderProgress = (view: ItemView): TemplateResult | typeof nothing => {
  if (view.phases.length > 0) {
    return html`<div class="phases-row">
      ${view.phases.map((phase) => html`<span style="color:${phase.color}">${phase.name}</span>`)}
    </div>`;
  }

  const progress = view.progress;

  if (progress === undefined) return nothing;

  if (view.progressStyle === 'segments') {
    return html`<div class="progress">
      ${Array.from({ length: SEGMENTS }, (_, index) => {
        const fill = Math.min(1, Math.max(0, progress * SEGMENTS - index));

        return html`<span
          ><i style="width:${(fill * 100).toFixed(0)}%;background:${view.color}"></i
        ></span>`;
      })}
    </div>`;
  }

  return html`<div class="progress">
    <span><i style="width:${(progress * 100).toFixed(1)}%;background:${view.color}"></i></span>
  </div>`;
};

export const renderSecondary = (view: ItemView): TemplateResult | typeof nothing =>
  view.secondary
    ? html`<span class="item-sub" style=${view.secondaryColor ? `color:${view.secondaryColor}` : ''}
        >${view.secondary}</span
      >`
    : nothing;
