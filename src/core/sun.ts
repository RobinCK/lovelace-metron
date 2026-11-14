const RADIANS = Math.PI / 180;
const MINUTE = 60_000;

export interface SunDay {
  readonly sunrise?: number;
  readonly sunset?: number;
  readonly noon: number;
}

interface SolarTerms {
  readonly declination: number;
  readonly equation: number;
}

const dayOfYear = (date: Date): number => {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const current = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

  return Math.floor((current - start) / 86_400_000);
};

const terms = (date: Date, hours: number): SolarTerms => {
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear(date) - 1 + (hours - 12) / 24);
  const equation =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  return { declination, equation };
};

export const sunDay = (time: number, latitude: number, longitude: number): SunDay => {
  const date = new Date(time);
  const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const { declination, equation } = terms(date, 12);
  const lat = latitude * RADIANS;
  const cosine =
    Math.cos(90.833 * RADIANS) / (Math.cos(lat) * Math.cos(declination)) -
    Math.tan(lat) * Math.tan(declination);
  const noon = midnight + (720 - 4 * longitude - equation) * MINUTE;

  if (cosine > 1 || cosine < -1) return { noon };

  const hourAngle = Math.acos(cosine) / RADIANS;

  return {
    sunrise: midnight + (720 - 4 * (longitude + hourAngle) - equation) * MINUTE,
    sunset: midnight + (720 - 4 * (longitude - hourAngle) - equation) * MINUTE,
    noon,
  };
};

export const sunElevation = (time: number, latitude: number, longitude: number): number => {
  const date = new Date(time);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const { declination, equation } = terms(date, minutes / 60);
  const solarTime = minutes + equation + 4 * longitude;
  const hourAngle = (solarTime / 4 - 180) * RADIANS;
  const lat = latitude * RADIANS;
  const cosine =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);

  return 90 - Math.acos(Math.min(1, Math.max(-1, cosine))) / RADIANS;
};
