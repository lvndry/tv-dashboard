import { config } from '../config';
import { fetchJson } from './net';
import { timeLabel, zoned } from './time';

export interface Hour { time: number; temp: number; precipProbability: number; precip: number; code: number }
export interface Day { time: number; min: number; max: number; code: number; precipProbability: number; sunrise: number; sunset: number }
export interface Weather {
  current: { time: number; temp: number; feels: number; code: number; windSpeed: number; windDirection: number; precip: number; isDay: boolean };
  hours: Hour[];
  days: Day[];
}

interface OpenMeteoResponse {
  current: { time: number; temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; wind_direction_10m: number; precipitation: number; is_day: number };
  hourly: { time: number[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; precipitation: number[]; weather_code: number[] };
  daily: { time: number[]; temperature_2m_min: number[]; temperature_2m_max: number[]; weather_code: number[]; precipitation_probability_max: (number | null)[]; sunrise: number[]; sunset: number[] };
}

export async function fetchWeather(): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    timezone: config.timeZone,
    timeformat: 'unixtime',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation,is_day',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code',
    daily: 'temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max,sunrise,sunset',
    forecast_hours: '36',
    forecast_days: '7',
  });
  const raw = await fetchJson<OpenMeteoResponse>(`https://api.open-meteo.com/v1/forecast?${params}`);
  const seconds = (value: number): number => value * 1000;
  return {
    current: {
      time: seconds(raw.current.time),
      temp: Math.round(raw.current.temperature_2m),
      feels: Math.round(raw.current.apparent_temperature),
      code: raw.current.weather_code,
      windSpeed: Math.round(raw.current.wind_speed_10m),
      windDirection: raw.current.wind_direction_10m,
      precip: raw.current.precipitation,
      isDay: raw.current.is_day === 1,
    },
    hours: raw.hourly.time.map((time, index) => ({
      time: seconds(time),
      temp: Math.round(raw.hourly.temperature_2m[index] ?? 0),
      precipProbability: raw.hourly.precipitation_probability[index] ?? 0,
      precip: raw.hourly.precipitation[index] ?? 0,
      code: raw.hourly.weather_code[index] ?? 0,
    })),
    days: raw.daily.time.map((time, index) => ({
      time: seconds(time),
      min: Math.round(raw.daily.temperature_2m_min[index] ?? 0),
      max: Math.round(raw.daily.temperature_2m_max[index] ?? 0),
      code: raw.daily.weather_code[index] ?? 0,
      precipProbability: raw.daily.precipitation_probability_max[index] ?? 0,
      sunrise: seconds(raw.daily.sunrise[index] ?? 0),
      sunset: seconds(raw.daily.sunset[index] ?? 0),
    })),
  };
}

interface Condition { label: string; state: string }

/** WMO weather interpretation codes, as documented by Open-Meteo. */
export function condition(code: number, isDay = true): Condition {
  if (code === 0) return isDay ? { label: 'Sunny', state: 'sunny' } : { label: 'Clear', state: 'clear' };
  if (code === 1) return isDay ? { label: 'Mostly sunny', state: 'mostly sunny' } : { label: 'Mostly clear', state: 'mostly clear' };
  if (code === 2) return { label: 'Partly cloudy', state: 'partly cloudy' };
  if (code === 3) return { label: 'Overcast', state: 'overcast' };
  if (code === 45 || code === 48) return { label: 'Fog', state: 'foggy' };
  if (code >= 51 && code <= 55) return { label: code === 55 ? 'Heavy drizzle' : 'Drizzle', state: 'drizzling' };
  if (code === 56 || code === 57) return { label: 'Freezing drizzle', state: 'drizzling and icy' };
  if (code === 61) return { label: 'Light rain', state: 'lightly raining' };
  if (code === 63) return { label: 'Rain', state: 'raining' };
  if (code === 65) return { label: 'Heavy rain', state: 'pouring' };
  if (code === 66 || code === 67) return { label: 'Freezing rain', state: 'raining and icy' };
  if (code >= 71 && code <= 77) return { label: code === 75 ? 'Heavy snow' : 'Snow', state: 'snowing' };
  if (code >= 80 && code <= 82) return { label: code === 82 ? 'Violent showers' : 'Showers', state: 'showery' };
  if (code === 85 || code === 86) return { label: 'Snow showers', state: 'snowing on and off' };
  if (code === 95) return { label: 'Thunderstorm', state: 'stormy' };
  if (code === 96 || code === 99) return { label: 'Thunderstorm, hail', state: 'stormy with hail' };
  return { label: 'Unsettled', state: 'unsettled' };
}

const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function windFrom(degrees: number): string {
  return compass[Math.round(degrees / 45) % 8] ?? 'north';
}

export function upcomingHours(weather: Weather, count: number, now: number = Date.now()): Hour[] {
  const startIndex = weather.hours.findIndex(hour => hour.time + 3600000 > now);
  return startIndex < 0 ? [] : weather.hours.slice(startIndex, startIndex + count);
}

const isWet = (hour: Hour): boolean => hour.precip >= 0.2 || hour.precipProbability >= 60;

export type RainOutlook =
  | { kind: 'dry' }
  | { kind: 'starts'; at: number; likely: boolean }
  | { kind: 'stops'; at: number }
  | { kind: 'persists' };

export function rainOutlook(weather: Weather, now: number = Date.now()): RainOutlook {
  const hours = upcomingHours(weather, 12, now);
  const first = hours[0];
  const wetNow = weather.current.precip > 0 || (first !== undefined && isWet(first));
  if (wetNow) {
    const dryIndex = hours.findIndex((hour, index) => index > 0 && !isWet(hour) && !(hours[index + 1] && isWet(hours[index + 1]!)));
    return dryIndex > 0 ? { kind: 'stops', at: hours[dryIndex]!.time } : { kind: 'persists' };
  }
  const wet = hours.find(hour => isWet(hour) || hour.precipProbability >= 40);
  if (!wet) return { kind: 'dry' };
  return { kind: 'starts', at: wet.time, likely: isWet(wet) };
}

function partOfDay(epochMs: number): string {
  const hour = zoned(epochMs).hour;
  if (hour < 5) return 'tonight';
  if (hour < 12) return 'this morning';
  if (hour < 18) return 'this afternoon';
  return 'tonight';
}

export function rainPhrase(outlook: RainOutlook, now: number = Date.now()): string {
  switch (outlook.kind) {
    case 'dry': return zoned(now).hour >= 17 ? 'a dry night ahead' : 'dry for the rest of the day';
    case 'starts': return outlook.likely ? `rain from about ${timeLabel(outlook.at)}` : `a chance of showers around ${timeLabel(outlook.at)}`;
    case 'stops': return `dry again by ${timeLabel(outlook.at)}`;
    case 'persists': return `wet ${partOfDay(now)}`;
  }
}

export function aheadPhrase(weather: Weather, now: number = Date.now()): string {
  const tomorrow = weather.days.find(day => day.time > now && zoned(day.time).day !== zoned(now).day);
  if (!tomorrow) return '';
  const weekday = zoned(tomorrow.time).weekday;
  const label = weekday === 'Saturday' || weekday === 'Sunday' ? weekday : 'tomorrow';
  return `${label} ${condition(tomorrow.code).state}, ${tomorrow.max}°`;
}

export function nextSunset(weather: Weather, now: number = Date.now()): number | null {
  return weather.days.map(day => day.sunset).find(sunset => sunset > now) ?? null;
}
