// Demo configuration for README screenshots: a neutral name and fictional news sources.
import { config as example } from '../../app/config.example';
import { defineConfig } from '../../app/src/configTypes';

export const config = defineConfig({
  ...example,
  name: 'Sam',
  place: 'Paris 11ᵉ',
  news: [
    { id: 'paris', name: 'Paris Daily', section: 'France', url: 'https://feeds.example.com/paris' },
    { id: 'world', name: 'The Wire', section: 'World', url: 'https://feeds.example.com/world' },
    { id: 'tech', name: 'Circuit', section: 'Tech', url: 'https://feeds.example.com/tech' },
    { id: 'culture', name: 'Salon', section: 'Culture', url: 'https://feeds.example.com/culture' },
    { id: 'sport', name: 'Touchline', section: 'Sport', url: 'https://feeds.example.com/sport' },
  ],
});
