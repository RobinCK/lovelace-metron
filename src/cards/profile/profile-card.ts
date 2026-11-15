import { css, html, nothing } from 'lit';
import type { CSSResultGroup, TemplateResult } from 'lit';
import { HOUR } from '../../const';
import { MetronCard } from '../../core/base-card';
import type { BaseConfig, CardContext, RawConfig } from '../../core/base-card';
import * as cfg from '../../core/config';
import { fetchStatistics } from '../../core/data/statistics';
import { deviceClass } from '../../core/entities';
import { formatNumber, formatWeekday, unitText } from '../../core/format';
import { addDays, firstWeekday, startOfDay, startOfWeek } from '../../core/time';
import type { HomeAssistant } from '../../types/ha';
import * as form from '../../ui/form';
import type { ConfigForm } from '../../ui/form';
import { colorOf, header, stats } from '../../ui/parts';
import type { StatItem } from '../../ui/parts';
import { metronStyles } from '../../ui/styles';
import {
  energySeries,
  fetchEnergyStatistics,
  DASHBOARD_ENERGY,
  resolveSources,
} from '../shared/energy-sources';
import type { EnergyConfig } from '../shared/energy-sources';

export interface ProfileCardConfig extends BaseConfig {
  readonly energy: EnergyConfig;
  readonly entity?: string;
  readonly weeks: number;
  readonly color?: string;
  readonly night_start: number;
  readonly night_end: number;
}

interface ProfileData {
  readonly grid: readonly (readonly (number | undefined)[])[];
  readonly hourly: readonly { readonly time: number; readonly value: number }[];
  readonly weekStart: number;
}

type Context = CardContext<ProfileCardConfig, ProfileData>;

const average = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;

export class MetronProfileCard extends MetronCard<ProfileCardConfig, ProfileData> {
  static override styles: CSSResultGroup = [
    metronStyles,
    css`
      .scale {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--m-mono);
        font-size: 10px;
        color: var(--m-muted);
      }

      .scale i {
        width: 56px;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(90deg, color-mix(in srgb, var(--c) 8%, transparent), var(--c));
      }

      .heat {
        display: grid;
        grid-template-columns: 22px repeat(24, minmax(0, 1fr));
        gap: 2px;
        align-items: center;
      }

      .heat .row-label {
        font-size: 10px;
        color: var(--m-muted);
      }

      .heat .cell {
        aspect-ratio: 1;
        border-radius: 2px;
      }

      .hours {
        display: grid;
        grid-template-columns: 22px repeat(24, minmax(0, 1fr));
        gap: 2px;
        font-family: var(--m-mono);
        font-size: 9px;
        color: var(--m-muted);
      }
    `,
  ];

  static override configForm(): ConfigForm {
    return form.createForm([
      form.consumptionEntity(),
      form.grid(form.number('weeks', { min: 1, max: 12 }), form.text('color')),
      form.grid(
        form.number('night_start', { min: 0, max: 23, unit: 'h' }),
        form.number('night_end', { min: 0, max: 23, unit: 'h' }),
      ),
    ]);
  }

  static getStubConfig(): RawConfig {
    return {};
  }

  protected parseConfig(raw: RawConfig): ProfileCardConfig {
    return {
      ...cfg.base(raw),
      energy: DASHBOARD_ENERGY,
      entity: cfg.entity(raw, 'entity'),
      weeks: cfg.number(raw, 'weeks', 4, { min: 1, max: 12 }),
      color: cfg.text(raw, 'color'),
      night_start: cfg.number(raw, 'night_start', 1, { min: 0, max: 23 }),
      night_end: cfg.number(raw, 'night_end', 5, { min: 0, max: 23 }),
    };
  }

  protected override cardSize(): number {
    return 5;
  }

  protected override refreshInterval(): number {
    return HOUR;
  }

  protected override async fetchData(
    config: ProfileCardConfig,
    hass: HomeAssistant,
  ): Promise<ProfileData> {
    const now = Date.now();
    const end = startOfDay(now);
    const start = addDays(end, -7 * config.weeks);
    const hourly = await this._hourly(config, hass, start, end);
    const firstDay = firstWeekday(hass.locale);
    const weekStart = startOfWeek(now, firstDay);
    const buckets: number[][][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => []),
    );

    for (const sample of hourly) {
      const date = new Date(sample.time);
      const row = (date.getDay() - firstDay + 7) % 7;

      buckets[row]?.[date.getHours()]?.push(sample.value);
    }

    return {
      grid: buckets.map((row) => row.map((values) => average(values))),
      hourly,
      weekStart,
    };
  }

  private async _hourly(
    config: ProfileCardConfig,
    hass: HomeAssistant,
    start: number,
    end: number,
  ): Promise<{ time: number; value: number }[]> {
    if (config.entity) {
      const power = deviceClass(hass, config.entity) === 'power';
      const result = await fetchStatistics(hass, {
        entityIds: [config.entity],
        start,
        end,
        period: 'hour',
        types: [power ? 'mean' : 'change'],
      });

      return (result.get(config.entity) ?? []).flatMap((row) => {
        const value = power ? row.mean : row.change;

        return value === null || value === undefined
          ? []
          : [{ time: row.start, value: power ? value / 1000 : value }];
      });
    }

    const sources = await resolveSources(hass, config.energy);
    const statistics = await fetchEnergyStatistics(hass, sources, start, end, 'hour');
    const starts = Array.from(
      { length: Math.round((end - start) / HOUR) },
      (_, index) => start + index * HOUR,
    );
    const series = energySeries(statistics, sources, starts, end);

    return starts.flatMap((time, index) => {
      const value = series.home[index];

      return value === undefined ? [] : [{ time, value }];
    });
  }

  protected renderBody(context: Context): TemplateResult {
    const { config, data, t, locale } = context;
    const color = colorOf(config.color ?? 'home');
    const values = (data?.grid ?? [])
      .flat()
      .filter((value): value is number => value !== undefined);
    const max = values.length > 0 ? Math.max(...values) : 0;
    const scaleMax = max > 0 ? max : 1;

    return html`
      ${header(
        config.title ?? t('profile.title', { weeks: config.weeks }),
        html`<span class="scale" style="--c:${color}"
          >0 <i></i> ${formatNumber(max, 1, locale)} ${unitText('kW', locale)}</span
        >`,
      )}
      ${
        data
          ? html`<div class="section" style="gap:4px">
              <div class="heat" role="img" aria-label=${t('profile.chart_label')}>
                ${data.grid.map(
                  (row, index) =>
                    html`<span class="row-label"
                        >${formatWeekday(addDays(data.weekStart, index), locale)}</span
                      >${row.map((value) => {
                        const alpha =
                          value === undefined ? 0 : 0.06 + 0.94 * Math.min(1, value / scaleMax);

                        return html`<span
                          class="cell"
                          title=${value === undefined ? '' : formatNumber(value, 2, locale)}
                          style="background:color-mix(in srgb, ${color} ${(alpha * 100).toFixed(0)}%, var(--m-track))"
                        ></span>`;
                      })}`,
                )}
              </div>
              <div class="hours">
                <span></span>
                ${Array.from(
                  { length: 24 },
                  (_, hour) =>
                    html`<span>${hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}</span>`,
                )}
              </div>
            </div>`
          : html`<div class="empty">${t('common.loading')}</div>`
      }
      ${data ? stats(this._summary(context, data)) : nothing}
    `;
  }

  private _summary(context: Context, data: ProfileData): StatItem[] {
    const { config, t, locale } = context;
    const kw = unitText('kW', locale);
    const kwh = unitText('kWh', locale);
    let peak: { row: number; hour: number; value: number } | undefined;

    data.grid.forEach((row, rowIndex) => {
      row.forEach((value, hour) => {
        if (value !== undefined && (!peak || value > peak.value))
          peak = { row: rowIndex, hour, value };
      });
    });

    const nightHours = (hour: number): boolean =>
      config.night_start <= config.night_end
        ? hour >= config.night_start && hour <= config.night_end
        : hour >= config.night_start || hour <= config.night_end;
    const night = data.hourly
      .filter((sample) => nightHours(new Date(sample.time).getHours()))
      .map((sample) => sample.value)
      .sort((a, b) => a - b);
    const base = night.length > 0 ? night[Math.floor(night.length * 0.1)] : undefined;
    const daily = new Map<number, number>();

    for (const sample of data.hourly) {
      const day = startOfDay(sample.time);

      daily.set(day, (daily.get(day) ?? 0) + sample.value);
    }

    const weekend = (time: number): boolean => [0, 6].includes(new Date(time).getDay());
    const days = [...daily.entries()];
    const workdays = average(days.filter(([day]) => !weekend(day)).map(([, value]) => value));
    const weekends = average(days.filter(([day]) => weekend(day)).map(([, value]) => value));
    const items: StatItem[] = [];

    if (peak) {
      items.push({
        label: t('profile.peak'),
        value: `${formatWeekday(addDays(data.weekStart, peak.row), locale)} ${String(peak.hour).padStart(2, '0')}:00`,
        sub: `${formatNumber(peak.value, 1, locale)} ${kw}`,
      });
    }

    if (base !== undefined) {
      items.push({
        label: t('profile.base'),
        value: formatNumber(base, 1, locale),
        unit: kw,
        sub: t('profile.base_daily', { value: formatNumber(base * 24, 0, locale), unit: kwh }),
      });
    }

    if (workdays !== undefined || weekends !== undefined) {
      items.push({
        label: t('profile.weekdays'),
        value: `${formatNumber(workdays, 0, locale)} / ${formatNumber(weekends, 0, locale)}`,
        sub: t('profile.per_day', { unit: kwh }),
      });
    }

    return items;
  }
}
