// Fictional data for README screenshots: weather, feeds, and the ChatGPT endpoints.
// Every story, source and headline here is made up.

const hour = 3600 * 1000;
const minute = 60 * 1000;

export const feeds = {
  paris: [
    ['Paris turns the Pont de Sully car-free on weekends', 'From November, the bridge between the Marais and the Left Bank will be open only to pedestrians and bikes on Saturdays and Sundays.', 25],
    ['Night trains to the Alps return for the winter season', 'Sleeper services from Gare d’Austerlitz restart in December, with four departures a week to Bourg-Saint-Maurice.', 140],
    ['Vélib’ adds 3,000 electric bikes ahead of the holidays', 'The new bikes arrive first in the 11th and 20th arrondissements, where stations empty fastest in the evening.', 300],
  ],
  world: [
    ['Grain corridor reopens after a week-long pause', 'Shipping resumed on Thursday after insurers agreed new terms; the first convoy of eight vessels left port overnight.', 50],
    ['EU leaders agree a joint budget for cross-border rail', 'The plan funds twelve missing links, including a faster line between Lyon and Turin, over the next decade.', 190],
    ['Monsoon season ends early across South Asia', 'Forecasters say rainfall was close to average overall despite record downpours in August.', 420],
  ],
  tech: [
    ['An open standard for smart-TV apps gets its first release', 'Version 1.0 covers remote-control input, app launching and background refresh, with three manufacturers committing to support it.', 35],
    ['A European lab trains a physics model on collider data', 'Researchers say the model reproduces known particle decays and flags candidates for new measurements.', 210],
    ['Why e-ink tablets are quietly having a moment', 'Sales grew for a third year as readers look for screens that don’t keep them up at night.', 380],
  ],
  culture: [
    ['The Pompidou shows first plans for its 2030 reopening', 'A glass forecourt and a free ground-floor gallery are the headline changes; the building stays closed until then.', 95],
    ['A restoration brings the water lilies back to colour', 'Two years of cleaning removed a century of varnish from the panels at the Orangerie.', 260],
  ],
  sport: [
    ['The Paris derby moves to Sunday, 20:45', 'The league moved the fixture after Thursday’s European match went to extra time.', 15],
    ['A 160 km ultra-trail across a volcano island', 'Runners climb nearly 10,000 metres; this year’s winner finished in just under 24 hours.', 330],
  ],
};

const palettes = [['#2B3A67', '#F2DE6B'], ['#1F4E5F', '#9AD1C3'], ['#4A2C4F', '#FF9A7A'], ['#203A2E', '#C3E88D'], ['#3A2E5F', '#96CCFF'], ['#5A3A22', '#F7C873']];

/** Abstract artwork as a data: URI, so screenshots use no real photos. */
function artwork(seed) {
  const [base, accent] = palettes[seed % palettes.length];
  const cx = 30 + (seed * 37) % 50;
  const cy = 30 + (seed * 53) % 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 160 90">
    <defs><radialGradient id="g" cx="${cx}%" cy="${cy}%" r="70%"><stop offset="0" stop-color="${accent}" stop-opacity=".9"/><stop offset="1" stop-color="${base}"/></radialGradient></defs>
    <rect width="160" height="90" fill="url(#g)"/>
    <circle cx="${120 - (seed * 13) % 60}" cy="${60 - (seed * 7) % 30}" r="${18 + (seed * 5) % 14}" fill="${accent}" opacity=".35"/>
    <rect x="0" y="${62 + (seed % 4) * 4}" width="160" height="40" fill="${base}" opacity=".55"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const escapeXml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function storyLink(feedId, index) {
  return `https://news.example.com/${feedId}/${index}`;
}

export function rss(feedId, now) {
  const items = (feeds[feedId] ?? []).map(([title, description, minutesAgo], index) => `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${storyLink(feedId, index)}</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${new Date(now - minutesAgo * minute).toUTCString()}</pubDate>
      <media:content url="${artwork(feedId.length * 7 + index * 3)}" medium="image" width="1280" height="720"/>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${feedId}</title>${items}</channel></rss>`;
}

/** Same hash as app/src/news.ts, so the brief can reference story ids. */
export function storyId(link) {
  let value = 5381;
  for (let index = 0; index < link.length; index++) value = (value * 33) ^ link.charCodeAt(index);
  return (value >>> 0).toString(36);
}

/** An evening of light rain that clears before midnight, then a sunny Saturday. Paris is UTC+2 in October. */
export function weather(now) {
  const seconds = value => Math.round(value / 1000);
  const currentHour = Math.floor(now / hour) * hour;
  const hourly = { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], weather_code: [] };
  const rain = [[0.6, 80, 61], [0.4, 70, 61], [0.1, 30, 3], [0, 10, 3], [0, 5, 2], [0, 0, 1]];
  for (let step = 0; step < 36; step++) {
    const [mm, probability, code] = rain[step] ?? [0, 0, step < 12 ? 1 : 0];
    hourly.time.push(seconds(currentHour + step * hour));
    hourly.temperature_2m.push(14 - Math.min(step, 10) * 0.45 + Math.max(0, step - 12) * 0.6);
    hourly.precipitation_probability.push(probability);
    hourly.precipitation.push(mm);
    hourly.weather_code.push(code);
  }
  const localMidnight = Math.floor((now + 2 * hour) / (24 * hour)) * 24 * hour - 2 * hour;
  const days = [[9, 16, 61, 80], [9, 19, 1, 5], [10, 17, 2, 10], [8, 13, 63, 75], [9, 15, 3, 20], [7, 14, 0, 0], [8, 15, 1, 5]];
  const daily = { time: [], temperature_2m_min: [], temperature_2m_max: [], weather_code: [], precipitation_probability_max: [], sunrise: [], sunset: [] };
  days.forEach(([low, high, code, probability], index) => {
    const midnight = localMidnight + index * 24 * hour;
    daily.time.push(seconds(midnight));
    daily.temperature_2m_min.push(low);
    daily.temperature_2m_max.push(high);
    daily.weather_code.push(code);
    daily.precipitation_probability_max.push(probability);
    daily.sunrise.push(seconds(midnight + 8 * hour + (12 + index) * minute));
    daily.sunset.push(seconds(midnight + 18 * hour + (48 - index * 2) * minute));
  });
  return {
    current: { time: seconds(now), temperature_2m: 14, apparent_temperature: 12, weather_code: 61, wind_speed_10m: 14, wind_direction_10m: 225, precipitation: 0.3, is_day: 0 },
    hourly,
    daily,
  };
}

export function brief() {
  const id = (feedId, index) => storyId(storyLink(feedId, index));
  return {
    stories: [
      { headline: 'The Paris derby moves to Sunday night', short: 'the derby moved to Sunday', summary: 'The league moved the fixture to Sunday at 20:45 after Thursday’s European match went to extra time.', section: 'Sport', story_ids: [id('sport', 0)] },
      { headline: 'Pont de Sully goes car-free on weekends', short: 'a car-free Pont de Sully', summary: 'From November the bridge between the Marais and the Left Bank is open only to pedestrians and bikes on Saturdays and Sundays.', section: 'France', story_ids: [id('paris', 0)] },
      { headline: 'Smart-TV apps get an open standard', short: 'an open standard for TV apps', summary: 'Version 1.0 covers remote input, app launching and background refresh, and three manufacturers have committed to support it.', section: 'Tech', story_ids: [id('tech', 0)] },
      { headline: 'Grain corridor reopens after a week-long pause', short: 'the grain corridor reopening', summary: 'Shipping resumed on Thursday after insurers agreed new terms, and the first convoy of eight vessels left port overnight.', section: 'World', story_ids: [id('world', 0)] },
      { headline: 'The Pompidou unveils its 2030 plans', short: 'the Pompidou’s 2030 plans', summary: 'A glass forecourt and a free ground-floor gallery lead the plans; the building stays closed for renovation until 2030.', section: 'Culture', story_ids: [id('culture', 0)] },
      { headline: 'Night trains to the Alps are back this winter', short: 'night trains to the Alps', summary: 'Sleeper services from Gare d’Austerlitz restart in December with four departures a week to Bourg-Saint-Maurice.', section: 'France', story_ids: [id('paris', 1)] },
    ],
  };
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function tokens() {
  const access = [base64url({ alg: 'none' }), base64url({ 'https://api.openai.com/auth': { chatgpt_account_id: 'demo-account', chatgpt_plan_type: 'plus' } }), 'demo'].join('.');
  return { access_token: access, refresh_token: 'demo-refresh-token', expires_in: 3600 };
}

/** The Responses API event stream shape the ChatGPT backend sends. */
export function responseStream(text) {
  const events = [
    { type: 'response.created', response: { id: 'demo' } },
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: { id: 'demo', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } },
  ];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}
