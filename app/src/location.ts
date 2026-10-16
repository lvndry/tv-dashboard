// Where the weather is for. Set on the TV (Settings → Weather location) or, by default, in config.ts.

import { config } from '../config';
import { fetchJson } from './net';
import { settings, updateSettings, type SavedLocation } from './store';

export function currentLocation(): SavedLocation {
  return settings.location ?? { name: config.place, latitude: config.latitude, longitude: config.longitude, timeZone: config.timeZone };
}

/** Short form for sentences: "Paris 15 Vaugirard" reads as "Paris". */
export function shortPlace(): string {
  return currentLocation().name.split(/[\s,]/)[0] ?? '';
}

export interface PlaceResult extends SavedLocation {
  detail: string;
}

interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  admin1?: string;
  admin2?: string;
  country?: string;
  postcodes?: string[];
}

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ name: query.trim(), count: '6', language: 'en', format: 'json' });
  const result = await fetchJson<{ results?: GeocodingResult[] }>(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  return (result.results ?? []).map(place => ({
    name: place.name,
    latitude: Math.round(place.latitude * 1000) / 1000,
    longitude: Math.round(place.longitude * 1000) / 1000,
    timeZone: place.timezone ?? config.timeZone,
    detail: [place.postcodes?.[0], place.admin2 ?? place.admin1, place.country].filter(Boolean).join(' · '),
  }));
}

export function saveLocation(place: SavedLocation | null): void {
  updateSettings({ location: place ? { name: place.name, latitude: place.latitude, longitude: place.longitude, timeZone: place.timeZone } : null });
}
