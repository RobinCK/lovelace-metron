import type { HomeAssistant, Unsubscribe } from '../../types/ha';

interface SolarForecastEntry {
  readonly wh_hours?: Readonly<Record<string, number>>;
}

type SolarForecastResponse = Readonly<Record<string, SolarForecastEntry | undefined>>;

export type HourlyEnergy = ReadonlyMap<number, number>;

export const fetchSolarForecast = async (
  hass: HomeAssistant,
  configEntries?: readonly string[],
): Promise<HourlyEnergy> => {
  const response = await hass.callWS<SolarForecastResponse>({ type: 'energy/solar_forecast' });
  const hourly = new Map<number, number>();

  for (const [entryId, entry] of Object.entries(response)) {
    if (configEntries && configEntries.length > 0 && !configEntries.includes(entryId)) continue;

    for (const [time, wh] of Object.entries(entry?.wh_hours ?? {})) {
      const start = Date.parse(time);

      if (!Number.isFinite(start)) continue;

      hourly.set(start, (hourly.get(start) ?? 0) + wh / 1000);
    }
  }

  return hourly;
};

export const forecastBetween = (forecast: HourlyEnergy, from: number, to: number): number => {
  let total = 0;

  for (const [time, kwh] of forecast) {
    if (time >= from && time < to) total += kwh;
  }

  return total;
};

export interface WeatherForecast {
  readonly datetime: string;
  readonly condition?: string;
  readonly temperature?: number;
  readonly templow?: number;
  readonly cloud_coverage?: number;
  readonly precipitation?: number;
  readonly precipitation_probability?: number;
}

interface ForecastEvent {
  readonly forecast?: readonly WeatherForecast[] | null;
}

export const subscribeWeatherForecast = async (
  hass: HomeAssistant,
  entityId: string,
  forecastType: 'daily' | 'hourly' | 'twice_daily',
  callback: (forecast: readonly WeatherForecast[]) => void,
): Promise<Unsubscribe | undefined> => {
  if (!hass.connection) return undefined;

  return hass.connection.subscribeMessage<ForecastEvent>(
    (event) => {
      callback(event.forecast ?? []);
    },
    { type: 'weather/subscribe_forecast', entity_id: entityId, forecast_type: forecastType },
  );
};

export const fetchWeatherForecast = (
  hass: HomeAssistant,
  entityId: string,
  forecastType: 'daily' | 'hourly' | 'twice_daily',
  timeout = 8000,
): Promise<readonly WeatherForecast[]> =>
  new Promise((resolve) => {
    let settled = false;
    let unsubscribe: Unsubscribe | undefined;

    const finish = (forecast: readonly WeatherForecast[]): void => {
      if (settled) return;

      settled = true;
      unsubscribe?.();
      resolve(forecast);
    };

    window.setTimeout(() => {
      finish([]);
    }, timeout);

    void subscribeWeatherForecast(hass, entityId, forecastType, finish)
      .then((handle) => {
        unsubscribe = handle;

        if (settled) handle?.();
      })
      .catch(() => {
        finish([]);
      });
  });
