import type { HomeAssistant } from '../../types/ha';
import { convert, parseNumber } from '../entities';
import type { Quantity } from '../entities';

export interface Sample {
  readonly time: number;
  readonly value: number | undefined;
}

export interface StateSample {
  readonly time: number;
  readonly state: string;
}

interface CompressedState {
  readonly s: string;
  readonly lu?: number;
  readonly lc?: number;
}

type HistoryResponse = Readonly<Record<string, readonly CompressedState[] | undefined>>;

const requestHistory = (
  hass: HomeAssistant,
  entityIds: readonly string[],
  start: number,
  end: number | undefined,
): Promise<HistoryResponse> =>
  hass.callWS<HistoryResponse>({
    type: 'history/history_during_period',
    start_time: new Date(start).toISOString(),
    ...(end === undefined ? {} : { end_time: new Date(end).toISOString() }),
    entity_ids: entityIds,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });

const timeOf = (state: CompressedState): number | undefined => {
  const seconds = state.lu ?? state.lc;

  return seconds === undefined ? undefined : seconds * 1000;
};

export const fetchStates = async (
  hass: HomeAssistant,
  entityIds: readonly string[],
  start: number,
  end?: number,
): Promise<ReadonlyMap<string, readonly StateSample[]>> => {
  const ids = [...new Set(entityIds.filter(Boolean))];

  if (ids.length === 0) return new Map();

  const response = await requestHistory(hass, ids, start, end);

  return new Map(
    ids.map((entityId) => [
      entityId,
      (response[entityId] ?? []).flatMap((state) => {
        const time = timeOf(state);

        return time === undefined ? [] : [{ time, state: state.s }];
      }),
    ]),
  );
};

export const fetchSamples = async (
  hass: HomeAssistant,
  entities: readonly (readonly [string, Quantity])[],
  start: number,
  end?: number,
): Promise<ReadonlyMap<string, readonly Sample[]>> => {
  const states = await fetchStates(
    hass,
    entities.map(([entityId]) => entityId),
    start,
    end,
  );

  return new Map(
    entities.map(([entityId, quantity]) => {
      const unit = hass.states[entityId]?.attributes.unit_of_measurement;

      return [
        entityId,
        (states.get(entityId) ?? []).map((sample) => {
          const value = parseNumber(sample.state);

          return {
            time: sample.time,
            value: value === undefined ? undefined : convert(value, quantity, unit),
          };
        }),
      ];
    }),
  );
};

export const valueBefore = (samples: readonly Sample[], time: number): number | undefined => {
  let result: number | undefined;

  for (const sample of samples) {
    if (sample.time > time) break;

    result = sample.value;
  }

  return result;
};

export const resample = (
  samples: readonly Sample[],
  start: number,
  step: number,
  count: number,
): (number | undefined)[] =>
  Array.from({ length: count }, (_, index) => {
    const from = start + index * step;
    const to = from + step;
    const inside = samples.filter(
      (sample) => sample.time >= from && sample.time < to && sample.value !== undefined,
    );

    if (inside.length > 0) {
      return inside.reduce((total, sample) => total + (sample.value ?? 0), 0) / inside.length;
    }

    return from <= Date.now() ? valueBefore(samples, from) : undefined;
  });

export interface Interval {
  readonly from: number;
  readonly to: number;
}

export const intervalsWhere = (
  samples: readonly StateSample[],
  predicate: (state: string) => boolean,
  end: number,
): Interval[] => {
  const intervals: Interval[] = [];
  let openedAt: number | undefined;

  for (const sample of samples) {
    const active = predicate(sample.state);

    if (active && openedAt === undefined) openedAt = sample.time;

    if (!active && openedAt !== undefined) {
      intervals.push({ from: openedAt, to: sample.time });
      openedAt = undefined;
    }
  }

  if (openedAt !== undefined) intervals.push({ from: openedAt, to: end });

  return intervals;
};
