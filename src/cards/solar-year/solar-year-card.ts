import { css, html, nothing } from 'lit';
import type { CSSResultGroup, PropertyDeclarations, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import type { CardSize } from '../../core/size';
import * as cfg from '../../core/config';
import {
  formatDate,
  formatEnergy,
  formatMonth,
  formatNumber,
  formatWeekday,
  unitText,
} from '../../core/format';
import { addDays, firstWeekday, startOfDay } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { colorOf, header, navigator, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import { elementHover, tipValue } from '../../ui/tip';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, EnergyKey, Series } from '../shared/energy-sources';
import { yearWindow } from './window';
import type { YearWindow } from './window';

const ENERGY: readonly EnergyKey[] = ['solar'];

const RANGE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };

export interface SolarYearCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly weeks: number;
  readonly good_day?: number;
  readonly max?: number;
  readonly color?: string;
  readonly navigation: boolean;
}

interface YearData {
  readonly start: number;
  readonly values: Series;
}

type Context = CardContext<SolarYearCardConfig, YearData>;

export class MetronSolarYearCard extends MetronCard<SolarYearCardConfig, YearData> {
  static override maxSize: CardSize = 'medium';

  static override properties: PropertyDeclarations = {
    _offset: { state: true },
  };

  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .head {
        flex-wrap: wrap;
        row-gap: 6px;
      }

      .year {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr);
        gap: 4px 6px;
      }

      .labels {
        display: grid;
        grid-template-rows: repeat(7, minmax(0, 1fr));
        gap: 2px;
        font-size: 9px;
        color: var(--m-muted);
      }

      .labels span {
        display: flex;
        align-items: center;
      }

      .cells {
        display: grid;
        grid-auto-flow: column;
        grid-template-rows: repeat(7, minmax(0, 1fr));
        grid-template-columns: repeat(var(--weeks, 53), minmax(0, 1fr));
        gap: 2px;
      }

      .cells span {
        aspect-ratio: 1;
        border-radius: 2px;
        background: var(--m-track);
      }

      .cells.tall span {
        aspect-ratio: auto;
        height: 24px;
      }

      .cells span:hover {
        outline: 1px solid var(--m-text);
      }

      .cells span.today {
        box-shadow: 0 0 0 1.5px var(--m-text);
      }

      .months {
        display: grid;
        grid-template-columns: repeat(var(--weeks, 53), minmax(0, 1fr));
        gap: 2px;
        height: 12px;
        font-size: 9px;
        white-space: nowrap;
        color: var(--m-muted);
      }
    `,
  ];

  declare _offset: number;

  constructor() {
    super();
    this._offset = 0;
  }

  static override configForm(): ConfigForm {
    return form.createForm([
      ...energyFields(ENERGY),
      form.grid(form.number('weeks', { min: 4, max: 53 }), form.text('color')),
      form.grid(
        form.number('good_day', { min: 0, step: 0.1, unit: 'kWh' }),
        form.number('max', { min: 0, step: 0.1, unit: 'kWh' }),
      ),
      form.toggle('navigation'),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): SolarYearCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw, ENERGY),
      weeks: cfg.number(raw, 'weeks', 53, { min: 4, max: 53 }),
      good_day: cfg.optionalNumber(raw, 'good_day'),
      max: cfg.optionalNumber(raw, 'max'),
      color: cfg.text(raw, 'color'),
      navigation: cfg.boolean(raw, 'navigation', true),
    };
  }

  protected override cardSize(): number {
    return 4;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: SolarYearCardConfig,
    hass: HomeAssistant,
  ): Promise<YearData> {
    const now = Date.now();
    const { start, end } = yearWindow(now, config.weeks, firstWeekday(hass.locale), this._offset);
    const starts = Array.from({ length: Math.round((end - start) / DAY) }, (_, index) =>
      addDays(start, index),
    );

    const sources = await resolveSources(hass, config.energy, ENERGY);
    const statistics = await fetchEnergyStatistics(hass, sources, start - DAY, end, 'day');

    return { start, values: energySeries(statistics, sources, starts, end, { hass, now }).solar };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, hass, size, t, locale, now } = context;
    const color = colorOf(config.color ?? 'solar');
    const window = yearWindow(now, config.weeks, firstWeekday(hass.locale), this._offset);
    const head = header(
      config.title ?? t('solar_year.title'),
      config.navigation ? this._renderNavigator(context, window) : nothing,
    );

    if (data?.start !== window.start) {
      return html`${head}
        <div class="empty">${t('common.loading')}</div>`;
    }

    const known = data.values.filter((value): value is number => value !== undefined);
    const max = config.max ?? (known.length > 0 ? Math.max(...known) : 1);
    const today = startOfDay(now);
    const weeks = Math.ceil(data.values.length / 7);
    const total = weeks * 7;
    const labels = [0, 2, 4, 6].map((row) => ({
      row,
      text: formatWeekday(addDays(data.start, row), locale),
    }));

    return html`
      ${head}
      <div class="year">
        <span></span>
        <div class="months" style="--weeks:${weeks}">
          ${Array.from({ length: weeks }, (_, week) => {
            const first = addDays(data.start, week * 7);
            const previous = addDays(first, -7);
            const next = addDays(first, 14);
            const changed = new Date(first).getMonth() !== new Date(previous).getMonth();
            const isNew =
              (week === 0 && new Date(first).getMonth() === new Date(next).getMonth()) ||
              (week > 0 && changed);

            return html`<span>${isNew ? formatMonth(first, locale) : ''}</span>`;
          })}
        </div>
        <div class="labels">
          ${Array.from({ length: 7 }, (_, row) => {
            const label = labels.find((item) => item.row === row);

            return html`<span>${label?.text ?? ''}</span>`;
          })}
        </div>
        <div
          class="cells ${size === 'medium' ? 'tall' : ''}"
          style="--weeks:${weeks}"
          role="img"
          aria-label=${t('solar_year.chart_label')}
        >
          ${Array.from({ length: total }, (_, index) => {
            const day = addDays(data.start, index);
            const value = data.values[index];

            if (day > now || value === undefined) {
              return html`<span class=${day === today ? 'today' : ''}></span>`;
            }

            const alpha = 0.1 + 0.9 * Math.min(1, value / (max || 1));
            const hover = elementHover(() => ({
              title: formatDate(day, locale, { weekday: 'short', day: 'numeric', month: 'long' }),
              rows: [
                { label: t('solar_year.day'), value: tipValue(formatEnergy(value, locale)), color },
              ],
            }));

            return html`<span
              class=${day === today ? 'today' : ''}
              @pointermove=${hover.move}
              @pointerdown=${hover.move}
              @pointerleave=${hover.leave}
              style="background:color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, var(--m-track))"
            ></span>`;
          })}
        </div>
      </div>
      ${size === 'small' ? nothing : stats(this._summary(context, data, known))}
    `;
  }

  private _renderNavigator(context: Context, window: YearWindow): TemplateResult {
    const { t, locale } = context;

    return navigator({
      label: `${formatDate(window.start, locale, RANGE_FORMAT)} – ${formatDate(window.end - DAY, locale, RANGE_FORMAT)}`,
      previousLabel: t('bars.previous'),
      nextLabel: t('bars.next'),
      resetLabel: t('bars.current'),
      canNext: this._offset < 0,
      previous: () => {
        this._shift(-1);
      },
      next: () => {
        this._shift(1);
      },
      reset: () => {
        this._offset = 0;
        this.reload();
      },
    });
  }

  private _shift(delta: number): void {
    this._offset = Math.min(0, this._offset + delta);
    this.reload();
  }

  private _summary(context: Context, data: YearData, known: readonly number[]): StatItem[] {
    const { config, t, locale } = context;

    if (known.length === 0) return [];

    const sum = known.reduce((total, value) => total + value, 0);
    const best = Math.max(...known);
    const bestDay = addDays(data.start, data.values.indexOf(best));
    const totalEnergy = formatEnergy(sum, locale, sum >= 1000 ? 2 : 1, 1000);
    const items: StatItem[] = [
      { label: t('solar_year.total'), value: totalEnergy.value, unit: totalEnergy.unit },
      {
        label: t('solar_year.best'),
        value: formatNumber(best, 1, locale),
        unit: unitText('kWh', locale),
        sub: formatDate(bestDay, locale),
      },
      {
        label: t('solar_year.average'),
        value: formatNumber(sum / known.length, 1, locale),
        unit: unitText('kWh', locale),
      },
    ];

    if (config.good_day !== undefined) {
      const goodDay = config.good_day;

      items.push({
        label: t('solar_year.good_days', { value: formatNumber(goodDay, 0, locale) }),
        value: String(known.filter((value) => value >= goodDay).length),
      });
    }

    return items;
  }
}
