import { fetchStates, intervalsWhere } from '../../core/data/history';
import type { Interval } from '../../core/data/history';
import { stateIsOn } from '../../core/entities';
import type { HomeAssistant } from '../../types/ha';

export const isOutageState = (state: string, invert: boolean): boolean => {
  const on = stateIsOn(state);

  if (on === undefined) return false;

  return invert ? on : !on;
};

export const fetchOutages = async (
  hass: HomeAssistant,
  entityId: string | undefined,
  invert: boolean,
  start: number,
  end: number,
): Promise<Interval[]> => {
  if (!entityId) return [];

  const states = await fetchStates(hass, [entityId], start, end);

  return intervalsWhere(
    states.get(entityId) ?? [],
    (state) => isOutageState(state, invert),
    end,
  ).map((interval) => ({ from: Math.max(start, interval.from), to: Math.min(end, interval.to) }));
};
