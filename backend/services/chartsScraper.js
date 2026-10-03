import axios from 'axios';
import * as cheerio from 'cheerio';

// Billboard Hot 100 (scraping básico de la web pública)
export async function getBillboardHot100() {
  const { data } = await axios.get(
    'https://www.billboard.com/charts/hot-100/',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const $ = cheerio.load(data);
  const tracks = [];
  $('ul.lrv-a-unstyle-list li.o-chart-results-list__item').each((i, el) => {
    const title = $(el).find('h3').text().trim();
    const artist = $(el).find('span.c-label').first().text().trim();
    if (title) tracks.push({ position: i + 1, title, artist });
  });
  return tracks.slice(0, 100);
}

// Alternativa: Spotify Charts via CSV público (más estable que scraping)
export async function getSpotifyTop50() {
  // Puedes usar la API oficial de Spotify (requiere Client ID/Secret)
  // o descargar CSV desde https://charts.spotify.com/
  // Ejemplo simplificado:
  const { data } = await axios.get(
    'https://charts.spotify.com/charts/view/regional-global-weekly/latest',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  // Parsear HTML/JSON según estructura actual
  return data; // adaptar según necesidad
}