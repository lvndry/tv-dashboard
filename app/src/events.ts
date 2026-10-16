// The week's major events in Paris, from the City of Paris "Que faire à Paris" open data.
// The feed lists ~1,500 events a week; this keeps the City's own top picks in cultural
// and big-night-out categories, and drops health, prevention and community programmes.

import { fetchJson } from './net';

export interface CityEvent {
  id: string;
  title: string;
  lead: string;
  venue: string;
  start: number;
  end: number;
  dates: string;
  free: boolean;
  image: string;
  url: string;
  tags: string[];
}

const wantedTags = ['Expo', 'Concert', 'Festival', 'Théâtre', 'Danse', 'Spectacle musical', 'Ecrans', 'Art contemporain', 'Musique', 'Cinéma', 'Nuit', 'Histoire', 'Photo', 'Sport', 'Street-art', 'Humour', 'Cirque'];
const unwantedTags = ['Santé', 'Prévention', 'Solidarité', 'Senior', 'Emploi', 'Citoyenneté'];

interface QfapRecord {
  id: string;
  title: string | null;
  lead_text: string | null;
  address_name: string | null;
  date_start: string | null;
  date_end: string | null;
  date_description: string | null;
  price_type: string | null;
  cover_url: string | null;
  url: string | null;
  qfap_tags: string | null;
  weight: number | null;
}

/**
 * "On a vu, on a aimé « La Tendresse », de Julie Berès…" reads best as "La Tendresse": the quoted
 * name if there is one (up to its first full stop), otherwise the title without its label.
 */
function cleanTitle(title: string): string {
  const unlabelled = title
    .replace(/^on a vu,? on a aimé\s*(…|\.\.\.)?\s*/i, '')
    .replace(/^(l[’']expo(sition)?|exposition|expo|concert|festival|spectacle|cabaret)\s*:?\s*/i, '')
    .trim();
  const quoted = unlabelled.match(/«\s*([^»]+?)\s*»/)?.[1];
  const name = quoted ? quoted.split(/\.\s/)[0]! : unlabelled;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Culture first; family outings and nights out after. */
const categoryRank = (tags: string[]): number => {
  if (tags.some(tag => ['Expo', 'Théâtre', 'Concert', 'Danse', 'Spectacle musical', 'Festival', 'Cinéma', 'Art contemporain'].includes(tag))) return 2;
  if (tags.some(tag => ['Sport', 'Histoire', 'Photo', 'Humour', 'Cirque'].includes(tag))) return 1;
  return 0;
};

/** Round-ups and civic announcements aren't events to go to. */
const notAnEvent = /(programme|tout savoir|où |inauguration|visitez|mode d[’']emploi|guide)/i;

const plain = (html: string): string => html.replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export async function fetchParisEvents(): Promise<CityEvent[]> {
  const params = new URLSearchParams({
    where: 'date_start <= now(days=7) and date_end >= now() and weight >= 3',
    order_by: 'weight desc, rank desc',
    limit: '60',
    select: 'id,title,lead_text,address_name,date_start,date_end,date_description,price_type,cover_url,url,qfap_tags,weight',
  });
  const result = await fetchJson<{ results: QfapRecord[] }>(`https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records?${params}`, 20000);
  return result.results.flatMap(record => {
    const tags = (record.qfap_tags ?? '').split(';').map(tag => tag.trim()).filter(Boolean);
    if (!record.title || notAnEvent.test(record.title) || !tags.some(tag => wantedTags.includes(tag)) || tags.some(tag => unwantedTags.includes(tag))) return [];
    return [{
      id: record.id,
      title: cleanTitle(record.title),
      lead: plain(record.lead_text ?? ''),
      venue: record.address_name ?? '',
      start: Date.parse(record.date_start ?? ''),
      end: Date.parse(record.date_end ?? ''),
      dates: plain(record.date_description ?? '').split(' · ').map(part => part.replace(/\s*:\s*$/, '').trim()).filter(Boolean).slice(0, 2).join(' · '),
      free: record.price_type === 'gratuit',
      image: record.cover_url ?? '',
      url: record.url ?? '',
      tags,
    }];
  }).sort((first, second) => categoryRank(second.tags) - categoryRank(first.tags));
}
