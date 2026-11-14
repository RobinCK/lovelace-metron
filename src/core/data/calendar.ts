import type { HomeAssistant } from '../../types/ha';
import type { Interval } from './history';

interface CalendarMoment {
  readonly dateTime?: string;
  readonly date?: string;
}

interface CalendarEvent {
  readonly start: CalendarMoment | string;
  readonly end: CalendarMoment | string;
  readonly summary?: string;
}

const parseMoment = (moment: CalendarMoment | string): number | undefined => {
  const text = typeof moment === 'string' ? moment : (moment.dateTime ?? moment.date);
  const time = text ? Date.parse(text) : Number.NaN;

  return Number.isFinite(time) ? time : undefined;
};

export const fetchCalendarIntervals = async (
  hass: HomeAssistant,
  entityId: string,
  start: number,
  end: number,
): Promise<Interval[]> => {
  if (!hass.callApi) return [];

  const path = `calendars/${entityId}?start=${encodeURIComponent(new Date(start).toISOString())}&end=${encodeURIComponent(new Date(end).toISOString())}`;
  const events = await hass
    .callApi<readonly CalendarEvent[]>('GET', path)
    .catch((): CalendarEvent[] => []);

  return events.flatMap((event) => {
    const from = parseMoment(event.start);
    const to = parseMoment(event.end);

    return from !== undefined && to !== undefined ? [{ from, to }] : [];
  });
};
