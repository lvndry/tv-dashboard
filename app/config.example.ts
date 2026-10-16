// Template for app/config.ts, which is yours to edit and is never committed.
// `bun install` (or the first build) copies this file there if it doesn't exist yet.
// Rebuild and redeploy after changing it. Day-to-day preferences (ambient delay,
// highlighter colour, clock format, console HDMI port, ChatGPT) live in the on-TV settings.

import { defineConfig } from './src/configTypes';

export const config = defineConfig({
  name: '',
  place: 'Paris',
  latitude: 48.8566,
  longitude: 2.3522,
  timeZone: 'Europe/Paris',

  rack: [
    { kind: 'app', id: 'canal', name: 'Canal+', dot: '#E8E8E8', match: ['canal+', 'canal plus', 'mycanal'] },
    { kind: 'app', id: 'stremio', name: 'Stremio', dot: '#8A5CF6', match: ['stremio'] },
    { kind: 'app', id: 'tizentube', name: 'TizenTube', dot: '#FF3B30', match: ['tizentube'] },
    { kind: 'app', id: 'youtube', name: 'YouTube', dot: '#FF4E45', match: ['youtube'], appId: '111299001912' },
    { kind: 'input', id: 'ps5', name: 'PS5', dot: '#3D7BFF' },
    { kind: 'shortcut', id: 'news', name: 'News', dot: '#F2DE6B', target: 'news' },
    { kind: 'shortcut', id: 'settings', name: 'Settings', dot: '#9C9584', target: 'settings' },
  ],

  // Any RSS or Atom feed works. Their hosts are added to the app's network allowlist at build time.
  news: [
    { id: 'lemonde', name: 'Le Monde', section: 'France', url: 'https://www.lemonde.fr/rss/une.xml' },
    { id: 'lemonde-intl', name: 'Le Monde', section: 'World', url: 'https://www.lemonde.fr/international/rss_full.xml' },
    { id: 'france24', name: 'France 24', section: 'World', url: 'https://www.france24.com/fr/rss' },
    { id: 'lemonde-culture', name: 'Le Monde', section: 'Culture', url: 'https://www.lemonde.fr/culture/rss_full.xml' },
    { id: 'lemonde-sport', name: 'Le Monde', section: 'Sport', url: 'https://www.lemonde.fr/sport/rss_full.xml' },
    { id: 'ars', name: 'Ars Technica', section: 'Tech', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { id: 'numerama', name: 'Numerama', section: 'Tech', url: 'https://www.numerama.com/feed/' },
  ],

  brief: {
    model: 'gpt-6-luna',
    language: 'English',
    refreshMinutes: 60,
  },
});
