import { css, html } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { DAY, HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { bucketize, changeOf, fetchStatistics } from '../../core/data/statistics';
import { readNumber } from '../../core/entities';
import {
  formatDate,
  formatEnergy,
  formatMonth,
  formatNumber,
  formatWeekday,
  unitText,
} from '../../core/format';
import { addDays, startOfDay, startOfWeek } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { colorOf, header, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  energyFields,
  energySeries,
  fetchEnergyStatistics,
  parseEnergyConfig,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig, Series } from '../shared/energy-sources';

export interface SolarYearCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly entity?: string;
  readonly weeks: number;
  readonly good_day?: number;
  readonly max?: number;
  readonly color?: string;
  readonly first_weekday: number;
}

interface YearData {
  readonly start: number;
  readonly values: Series;
}

type Context = CardContext<SolarYearCardConfig, YearData>;

export class MetronSolarYearCard extends MetronCard<SolarYearCardConfig, YearData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
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

  static getConfigForm(): ConfigForm {
    return form.createForm([
      form.energyEntity('entity'),
      form.grid(form.number('weeks', { min: 4, max: 53 }), form.text('color')),
      form.grid(
        form.number('good_day', { min: 0, step: 0.1, unit: 'kWh' }),
        form.number('max', { min: 0, step: 0.1, unit: 'kWh' }),
      ),
      ...energyFields(),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): SolarYearCardConfig {
    return {
      ...cfg.base(raw),
      energy: parseEnergyConfig(raw),
      entity: cfg.entity(raw, 'entity'),
      weeks: cfg.number(raw, 'weeks', 53, { min: 4, max: 53 }),
      good_day: cfg.optionalNumber(raw, 'good_day'),
      max: cfg.optionalNumber(raw, 'max'),
      color: cfg.text(raw, 'color'),
      first_weekday: cfg.number(raw, 'first_weekday', 1, { min: 0, max: 6 }),
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
    const start = addDays(startOfWeek(now, config.first_weekday), -7 * (config.weeks - 1));
    const end = addDays(startOfDay(now), 1);
    const starts = Array.from({ length: Math.round((end - start) / DAY) }, (_, index) =>
      addDays(start, index),
    );

    if (config.entity) {
      const result = await fetchStatistics(hass, {
        entityIds: [config.entity],
        start,
        end,
        period: 'day',
        types: ['change', 'state'],
      });
      const values = bucketize(result.get(config.entity), starts, changeOf, 'sum');
      const rows = result.get(config.entity) ?? [];
      const state = rows[rows.length - 1]?.state;
      const current = readNumber(hass, config.entity, 'energy');
      const tail =
        current !== undefined && state !== null && state !== undefined && current >= state
          ? current - state
          : 0;

      return {
        start,
        values: values.map((value, index) =>
          index === values.length - 1 ? (value ?? 0) + tail : value,
        ),
      };
    }

    const sources = await resolveSources(hass, config.energy);
    const statistics = await fetchEnergyStatistics(hass, sources, start - DAY, end, 'day');

    return { start, values: energySeries(statistics, sources, starts, end, { hass, now }).solar };
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale, now } = context;
    const color = colorOf(config.color ?? 'solar');

    if (!data) {
      return html`${header(config.title ?? t('solar_year.title'))}
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
      ${header(config.title ?? t('solar_year.title'))}
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
          class="cells"
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

            return html`<span
              class=${day === today ? 'today' : ''}
              title="${formatDate(day, locale)} · ${formatNumber(value, 1, locale)}"
              style="background:color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, var(--m-track))"
            ></span>`;
          })}
        </div>
      </div>
      ${stats(this._summary(context, data, known))}
    `;
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
