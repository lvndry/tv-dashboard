// Where the weather is for. Priority: a place picked on the TV (Settings →
// Weather location) → a place detected from the TV's own IP (once a day) →
// the static default in config.ts.

import { config } from '../config';
import { fetchJson } from './net';
import { readCache, settings, updateSettings, writeCache, type SavedLocation } from './store';

const AUTO_TTL = 24 * 3600 * 1000;

function autoLocation(): SavedLocation | null {
  const cached = readCache<SavedLocation>('location');
  if (cached && Date.now() - cached.savedAt < AUTO_TTL) return cached.value;
  return null;
}

export function currentLocation(): SavedLocation {
  return settings.location ?? autoLocation() ?? { name: config.place, latitude: config.latitude, longitude: config.longitude, timeZone: config.timeZone };
}

/** Reverse-geocodes the TV's own IP so the place follows you when home moves. */
export async function autoDetectLocation(): Promise<boolean> {
  if (settings.location) return false; // a manual choice always wins
  try {
    const ip = await fetchJson<{ success?: boolean; city?: string; region?: string; country?: string; latitude?: number; longitude?: number; timezone?: { id?: string } }>('https://ipwho.is/', 8000);
    if (ip?.success && ip.city && ip.latitude != null && ip.longitude != null) {
      writeCache('location', {
        name: [ip.city, ip.region, ip.country].filter(Boolean).join(' '),
        latitude: Math.round(ip.latitude * 1000) / 1000,
        longitude: Math.round(ip.longitude * 1000) / 1000,
        timeZone: ip.timezone?.id ?? config.timeZone,
      });
      return true;
    }
  } catch {
    // Offline or blocked: keep whatever we already have (cached or config).
  }
  return false;
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
      detail: [place.postcodes?.[0], place.admin1 === 'Paris' ? place.admin2 : place.admin1, place.country].filter(Boolean).join(' · '),
  }));
}

export function saveLocation(place: SavedLocation | null): void {
  updateSettings({ location: place ? { name: place.name, latitude: place.latitude, longitude: place.longitude, timeZone: place.timeZone } : null });
}
