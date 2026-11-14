import { css, html } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { MINUTE } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import type { StatisticRow } from '../../core/data/statistics';
import { entityName } from '../../core/entities';
import { formatNumber, formatSigned, unitText } from '../../core/format';
import { median } from '../../core/math';
import { addDays, parseClock, startOfDay } from '../../core/time';
import { findEntities } from '../../core/stub';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { axis, header, pill } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { dipCounts, repeatingWindow, yieldDeviation } from './analysis';
import type { Grid, Window } from './analysis';

export interface StringConfig {
  readonly entity: string;
  readonly name?: string;
  readonly peak_power: number;
}

export interface StringsCardConfig extends BaseConfig {
  readonly strings: readonly StringConfig[];
  readonly from?: number;
  readonly to?: number;
  readonly dip: number;
  readonly days: number;
  readonly deviation: number;
}

interface StringsData {
  readonly today: Grid;
  readonly history: readonly Grid[];
}

type Context = CardContext<StringsCardConfig, StringsData>;

const SLOT = 30 * MINUTE;
const SLOTS = 48;

const slotGrid = (
  rows: readonly StatisticRow[] | undefined,
  start: number,
): (number | undefined)[] => {
  const sums = Array.from({ length: SLOTS }, () => ({ sum: 0, count: 0 }));

  for (const row of rows ?? []) {
    const index = Math.floor((row.start - start) / SLOT);
    const slot = sums[index];

    if (!slot || row.mean === null || row.mean === undefined) continue;

    slot.sum += row.mean / 1000;
    slot.count += 1;
  }

  return sums.map((slot) => (slot.count > 0 ? slot.sum / slot.count : undefined));
};

const slotLabel = (slot: number): string => {
  const minutes = slot * 30;

  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

export class MetronStringsCard extends MetronCard<StringsCardConfig, StringsData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .table {
        display: grid;
        grid-template-columns: minmax(64px, 96px) minmax(0, 1fr) minmax(64px, 84px);
        column-gap: 12px;
        align-items: center;
      }

      .table.head {
        padding-bottom: 6px;
        border-bottom: 1px solid var(--m-line);
        font-size: 10px;
        color: var(--m-muted);
      }

      .table.head span:last-child {
        text-align: right;
      }

      .table.row {
        padding: 8px 0;
        border-bottom: 1px solid var(--m-line);
      }

      .who {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .who b {
        overflow: hidden;
        font-family: var(--m-mono);
        font-size: 12px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .who small {
        font-size: 10px;
        color: var(--m-muted);
      }

      .spark {
        display: flex;
        align-items: flex-end;
        gap: 1px;
        height: 28px;
      }

      .spark span {
        flex: 1 1 0;
        min-height: 1px;
        border-radius: 1px 1px 0 0;
      }

      .yield {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        white-space: nowrap;
      }

      .yield b {
        font-family: var(--m-mono);
        font-size: 14px;
        font-weight: 500;
      }

      .yield small {
        font-family: var(--m-mono);
        font-size: 11px;
        font-weight: 600;
      }

      .axis-row {
        display: grid;
        grid-template-columns: minmax(64px, 96px) minmax(0, 1fr) minmax(64px, 84px);
        column-gap: 12px;
      }
    `,
  ];

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.list(
        'strings',
        {
          entity: {
            selector: { entity: { filter: { domain: 'sensor', device_class: 'power' } } },
            required: true,
          },
          name: { selector: { text: {} } },
          peak_power: {
            selector: { number: { mode: 'box', step: 0.1, unit_of_measurement: 'kWp' } },
          },
        },
        'name',
      ),
      form.grid(form.time('from'), form.time('to')),
      form.grid(
        form.number('dip', { min: 5, max: 80, unit: '%' }),
        form.number('days', { min: 2, max: 9 }),
      ),
      form.number('deviation', { min: 1, max: 50, unit: '%' }),
    ]);
  }

  static getStubConfig(hass?: HomeAssistant): RawConfig {
    return {
      strings: findEntities(
        hass,
        { deviceClass: 'power', keywords: ['pv1', 'pv2', 'pv3', 'pv4', 'string'] },
        4,
      ).map((entity) => ({ entity, peak_power: 5 })),
    };
  }

  protected parseConfig(raw: RawConfig): StringsCardConfig {
    const strings = cfg.list(raw, 'strings', (item): StringConfig | undefined => {
      const entity = cfg.entity(item, 'entity');

      return entity
        ? {
            entity,
            name: cfg.text(item, 'name'),
            peak_power: cfg.number(item, 'peak_power', 1, { min: 0.01 }),
          }
        : undefined;
    });

    const from = cfg.text(raw, 'from');
    const to = cfg.text(raw, 'to');

    return {
      ...cfg.base(raw),
      strings,
      from: from ? Math.floor(parseClock(from, 420) / 30) : undefined,
      to: to ? Math.ceil(parseClock(to, 1020) / 30) : undefined,
      dip: cfg.number(raw, 'dip', 25, { min: 5, max: 80 }) / 100,
      days: cfg.number(raw, 'days', 7, { min: 2, max: 9 }),
      deviation: cfg.number(raw, 'deviation', 8, { min: 1, max: 50 }) / 100,
    };
  }

  protected override missingOption(config: StringsCardConfig): string | undefined {
    return config.strings.length === 0 ? 'strings' : undefined;
  }

  protected override cardSize(config: StringsCardConfig): number {
    return 3 + config.strings.length;
  }

  protected override refreshInterval(): number {
    return 5 * MINUTE;
  }

  protected override async fetchData(
    config: StringsCardConfig,
    hass: HomeAssistant,
  ): Promise<StringsData> {
    const today = startOfDay(Date.now());
    const first = addDays(today, -(config.days - 1));
    const ids = config.strings.map((item) => item.entity);
    const result = await fetchStatistics(hass, {
      entityIds: ids,
      start: first,
      end: addDays(today, 1),
      period: '5minute',
      types: ['mean'],
    });
    const history = Array.from({ length: config.days }, (_, index) => {
      const start = addDays(first, index);

      return ids.map((id) =>
        slotGrid(
          result.get(id)?.filter((row) => row.start >= start && row.start < addDays(start, 1)),
          start,
        ),
      );
    });

    return { today: history[history.length - 1] ?? [], history };
  }

  private _window(config: StringsCardConfig, data: StringsData): [number, number] {
    if (config.from !== undefined && config.to !== undefined) return [config.from, config.to];

    const active = new Set<number>();

    for (const day of data.history) {
      day.forEach((values, index) => {
        const kwp = config.strings[index]?.peak_power ?? 1;

        values.forEach((value, slot) => {
          if ((value ?? 0) > kwp * 0.02) active.add(slot);
        });
      });
    }

    if (active.size === 0) return [config.from ?? 14, config.to ?? 34];

    const slots = [...active];

    return [
      config.from ?? Math.floor(Math.min(...slots) / 2) * 2,
      config.to ?? Math.ceil((Math.max(...slots) + 1) / 2) * 2,
    ];
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, t, locale, now } = context;
    const title = config.title ?? t('strings.title');

    if (!data)
      return html`${header(title)}
        <div class="empty">${t('common.loading')}</div>`;

    const [from, to] = this._window(config, data);
    const kwps = config.strings.map((item) => item.peak_power);
    const yields = data.today.map((values) =>
      values.reduce<number>((sum, value) => sum + (value ?? 0) * 0.5, 0),
    );
    const deviations = yieldDeviation(yields, kwps);
    const worstIndex = deviations.reduce(
      (found, value, index) => (value < (deviations[found] ?? 0) ? index : found),
      0,
    );
    const worst = deviations[worstIndex] ?? 0;
    const flagged = worst <= -config.deviation ? worstIndex : -1;
    const counts = dipCounts(data.history, kwps, config.dip);
    const windows = counts.map((row) =>
      repeatingWindow(row, Math.max(2, Math.ceil(data.history.length * 0.6))),
    );
    const dipIndex = windows.reduce(
      (found, window, index) =>
        window && (!windows[found] || window.days > (windows[found]?.days ?? 0)) ? index : found,
      flagged >= 0 ? flagged : 0,
    );
    const dip = windows[dipIndex];
    const nameOf = (index: number): string => {
      const item = config.strings[index];

      return item?.name ?? entityName(hass, item?.entity);
    };

    const middle = median(yields.map((value, index) => value / (kwps[index] || 1))) ?? 0;
    const shortfall = yields.reduce(
      (sum, value, index) => sum + Math.max(0, middle * (kwps[index] ?? 0) - value),
      0,
    );
    const nowSlot = Math.floor((now - startOfDay(now)) / SLOT);
    const max = Math.max(
      0.1,
      ...data.today.flatMap((values, index) =>
        values.slice(from, to).map((value) => (value ?? 0) / (kwps[index] || 1)),
      ),
    );

    return html`
      ${header(
        title,
        flagged >= 0
          ? pill(`${nameOf(flagged)} ${formatSigned(worst * 100, 0, locale)} %`, 'solar')
          : pill(t('strings.aligned'), 'ok'),
      )}
      <div>
        <div class="table head">
          <span>${t('strings.string')}</span><span>${slotLabel(from)}–${slotLabel(to)}</span
          ><span>${unitText('kWh', locale)} · Δ</span>
        </div>
        ${config.strings.map((item, index) => {
          const deviation = deviations[index] ?? 0;
          const isFlagged = index === flagged;
          const dipped = windows[index];
          const color =
            Math.abs(deviation) < 0.02
              ? 'var(--m-text-2)'
              : deviation > 0
                ? 'var(--m-ok)'
                : 'var(--m-warn)';

          return html`<div
            class="table row clickable"
            @click=${() => {
              context.moreInfo(item.entity);
            }}
          >
            <div class="who">
              <b style=${isFlagged ? 'color:var(--m-solar)' : ''}>${nameOf(index)}</b>
              <small>${formatNumber(item.peak_power, 1, locale)} ${t('strings.kwp')}</small>
            </div>
            <div class="spark">
              ${(data.today[index] ?? []).slice(from, to).map((value, offset) => {
                const slot = from + offset;
                const past = slot < nowSlot;
                const inDip = dipped !== undefined && slot >= dipped.from && slot < dipped.to;
                const base = isFlagged
                  ? inDip
                    ? 'var(--m-warn)'
                    : 'var(--m-solar)'
                  : 'var(--m-text-2)';
                const height = ((value ?? 0) / (item.peak_power || 1) / max) * 28;

                return html`<span
                  style="height:${height.toFixed(1)}px;background:${base};opacity:${past ? 1 : 0.25}"
                ></span>`;
              })}
            </div>
            <div class="yield">
              <b>${formatNumber(yields[index], 1, locale)}</b>
              <small style="color:${color}">${formatSigned(deviation * 100, 0, locale)} %</small>
            </div>
          </div>`;
        })}
        <div class="axis-row">
          <span></span>
          ${axis([
            { at: 0, label: slotLabel(from).slice(0, 2) },
            { at: 0.5, label: slotLabel(Math.round((from + to) / 2)).slice(0, 2) },
            { at: 1, label: slotLabel(to).slice(0, 2) },
          ])}
          <span></span>
        </div>
      </div>
      ${this._renderFooter(context, dip, dip ? nameOf(dipIndex) : '', data.history.length, shortfall)}
    `;
  }

  private _renderFooter(
    context: Context,
    dip: Window | undefined,
    name: string,
    days: number,
    shortfall: number,
  ): TemplateResult {
    const { t, locale } = context;

    return html`<div class="panels">
      <div class="panel">
        <span class="label">${dip ? t('strings.dip', { name }) : t('strings.no_dip')}</span>
        ${
          dip
            ? html`<span class="xl" style="font-size:18px;color:var(--m-warn)"
                  >${slotLabel(dip.from)}–${slotLabel(dip.to)}</span
                >
                <span class="label">${t('strings.dip_note', { count: dip.days, days })}</span>`
            : html`<span class="xl" style="font-size:18px;color:var(--m-ok)">—</span>`
        }
      </div>
      <div class="panel">
        <span class="label">${t('strings.shortfall')}</span>
        <span
          ><span class="xl" style="font-size:18px">≈ ${formatNumber(shortfall, 1, locale)}</span
          ><span class="unit"> ${unitText('kWh', locale)}</span></span
        >
        <span class="label">${t('strings.shortfall_note')}</span>
      </div>
    </div>`;
  }
}
