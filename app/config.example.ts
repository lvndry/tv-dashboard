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
    // Sideloaded apps keep their own Tizen package ids, which don't match by
    // display name. Pin appId to the real id (the one you installed it with)
    // so the chip never reports "not installed".
    { kind: 'app', id: 'stremio', name: 'Stremio', dot: '#8A5CF6', match: ['stremio'], appId: 'newslO9NqF' },
    { kind: 'app', id: 'tizentube', name: 'TizenTube', dot: '#FF3B30', match: ['tizentube'], appId: 'xvvl3S1TT1.TizenTubeStandalone' },
    { kind: 'app', id: 'youtube', name: 'YouTube', dot: '#FF4E45', match: ['youtube'], appId: '111299001912' },
    { kind: 'input', id: 'ps5', name: 'PS5', dot: '#3D7BFF' },
    { kind: 'shortcut', id: 'whatson', name: 'What’s on', dot: '#7FD1AE', target: 'whatson' },
    { kind: 'shortcut', id: 'news', name: 'News', dot: '#F2DE6B', target: 'news' },
    { kind: 'shortcut', id: 'gallery', name: 'Gallery', dot: '#C9A66B', target: 'gallery' },
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
    { id: 'franceinfo-france', name: 'franceinfo', section: 'France', url: 'https://www.francetvinfo.fr/france.rss' },
    { id: 'franceinfo-monde', name: 'franceinfo', section: 'World', url: 'https://www.francetvinfo.fr/monde.rss' },
    { id: 'bbc-world', name: 'BBC News', section: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'courrier', name: 'Courrier international', section: 'World', url: 'https://www.courrierinternational.com/feed/all/rss.xml' },
    { id: 'verge', name: 'The Verge', section: 'Tech', url: 'https://www.theverge.com/rss/index.xml' },
    { id: 'wired', name: 'Wired', section: 'Tech', url: 'https://www.wired.com/feed/rss' },
    { id: 'lemonde-pixels', name: 'Le Monde', section: 'Tech', url: 'https://www.lemonde.fr/pixels/rss_full.xml' },
    { id: 'franceinfo-culture', name: 'franceinfo', section: 'Culture', url: 'https://www.francetvinfo.fr/culture.rss' },
    { id: 'telerama', name: 'Télérama', section: 'Culture', url: 'https://www.telerama.fr/rss/une.xml' },
    { id: 'franceinfo-sports', name: 'franceinfo', section: 'Sport', url: 'https://www.francetvinfo.fr/sports.rss' },
  ],

  sports: {
    leagues: [
      { id: 'uefa.champions', name: 'Champions League' },
      { id: 'fra.1', name: 'Ligue 1' },
      { id: 'eng.1', name: 'Premier League' },
      { id: 'esp.1', name: 'La Liga' },
    ],
    teams: ['Paris Saint-Germain'],
  },
  parisEvents: true,
  // Turn on for OLED TVs: nudges the screensaver clock every 45 s against burn-in.
  burnInShift: false,

  // Ambient mode shows public-domain art, from ancient Egypt to Romanticism.
  art: {
    from: -3500,
    until: 1850,
    museums: [
      { name: 'Louvre', city: 'Paris', wikidata: 'Q19675', minSitelinks: 1, limit: 600 },
      { name: 'British Museum', city: 'London', wikidata: 'Q6373', minSitelinks: 1, limit: 600 },
      { name: 'Musée du quai Branly', city: 'Paris', wikidata: 'Q167863', minSitelinks: 0, region: 'Africa' },
      { name: 'Egyptian Museum', city: 'Cairo', wikidata: 'Q201219', minSitelinks: 0, region: 'Egypt' },
      { name: 'Grand Egyptian Museum', city: 'Giza', wikidata: 'Q2583681', minSitelinks: 0, region: 'Egypt' },
      { name: 'Museo Egizio', city: 'Turin', wikidata: 'Q19877', minSitelinks: 0, region: 'Egypt' },
      { name: 'Neues Museum', city: 'Berlin', wikidata: 'Q157316', minSitelinks: 0, region: 'Egypt' },
      { name: 'Pergamon Museum', city: 'Berlin', wikidata: 'Q157298', minSitelinks: 0, region: 'Middle East' },
      { name: 'Acropolis Museum', city: 'Athens', wikidata: 'Q421084', minSitelinks: 0, region: 'Greece & Rome' },
      { name: 'National Archaeological Museum', city: 'Athens', wikidata: 'Q637187', minSitelinks: 0, region: 'Greece & Rome' },
      { name: 'National Archaeological Museum', city: 'Naples', wikidata: 'Q637248', minSitelinks: 0, region: 'Greece & Rome' },
      { name: 'Capitoline Museums', city: 'Rome', wikidata: 'Q333906', minSitelinks: 0, region: 'Greece & Rome' },
      { name: 'Vatican Museums', city: 'Vatican City', wikidata: 'Q182955', minSitelinks: 1 },
      { name: 'Uffizi', city: 'Florence', wikidata: 'Q51252', minSitelinks: 2 },
      { name: 'Prado', city: 'Madrid', wikidata: 'Q160112', minSitelinks: 2 },
      { name: 'National Gallery', city: 'London', wikidata: 'Q180788', minSitelinks: 2 },
      { name: 'Rijksmuseum', city: 'Amsterdam', wikidata: 'Q190804', minSitelinks: 2 },
      { name: 'Kunsthistorisches Museum', city: 'Vienna', wikidata: 'Q95569', minSitelinks: 2 },
      { name: 'Hermitage', city: 'Saint Petersburg', wikidata: 'Q132783', minSitelinks: 2 },
      { name: 'Alte Pinakothek', city: 'Munich', wikidata: 'Q154568', minSitelinks: 1 },
      { name: 'Palace of Versailles', city: 'Versailles', wikidata: 'Q2946', minSitelinks: 1 },
      { name: 'Musée de Cluny', city: 'Paris', wikidata: 'Q1124095', minSitelinks: 0 },
      { name: 'Musée Guimet', city: 'Paris', wikidata: 'Q860994', minSitelinks: 0, region: 'Asia' },
      { name: 'Musée Cernuschi', city: 'Paris', wikidata: 'Q1667022', minSitelinks: 0, region: 'Asia' },
      { name: 'Tokyo National Museum', city: 'Tokyo', wikidata: 'Q653433', minSitelinks: 0, region: 'Asia' },
      { name: 'Kyoto National Museum', city: 'Kyoto', wikidata: 'Q147286', minSitelinks: 0, region: 'Asia' },
      { name: 'Nara National Museum', city: 'Nara', wikidata: 'Q147312', minSitelinks: 0, region: 'Asia' },
      { name: 'Palace Museum', city: 'Beijing', wikidata: 'Q2047427', minSitelinks: 0, region: 'Asia', limit: 600 },
      { name: 'National Palace Museum', city: 'Taipei', wikidata: 'Q540668', minSitelinks: 0, region: 'Asia', limit: 600 },
      { name: 'Shanghai Museum', city: 'Shanghai', wikidata: 'Q1051293', minSitelinks: 0, region: 'Asia', limit: 600 },
      { name: 'National Museum of Korea', city: 'Seoul', wikidata: 'Q494407', minSitelinks: 0, region: 'Asia' },
      { name: 'National Museum', city: 'New Delhi', wikidata: 'Q1356138', minSitelinks: 0, region: 'Asia' },
      { name: 'Indian Museum', city: 'Kolkata', wikidata: 'Q1364900', minSitelinks: 0, region: 'Asia' },
      { name: 'Freer Gallery of Art', city: 'Washington', wikidata: 'Q1075126', minSitelinks: 0, region: 'Asia' },
    ],
    egyptianTombs: true,
    africanCultures: true,
    // Ancient Near East, Africa/Oceania/Americas, Asia, Egypt, European paintings and sculpture, Greek and Roman, Islamic, Medieval.
    metDepartments: [3, 5, 6, 10, 11, 12, 13, 14, 17],
    cleveland: true,
    storyModel: 'gpt-6-luna',
  },

  brief: {
    // Perplexity API key (https://www.perplexity.ai/settings/api). Writes the daily letter.
    perplexityKey: 'pplx-your-key-here',
    perplexityModel: 'perplexity/sonar',
    language: 'English',
    refreshMinutes: 60,
  },
});
