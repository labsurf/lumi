import axios from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ─── BILLBOARD HOT 100 (vía JSON de GitHub) ─────────────
async function getBillboardHot100() {
  const url = 'https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json';
  const { data } = await axios.get(url, { timeout: 10000 });

  // El JSON incluye la fecha en data.date (formato YYYY-MM-DD)
  const updateDate = data.date || new Date().toISOString().split('T')[0];

  const tracks = data.data.map((item) => ({
    position: item.this_week,
    title: item.song,
    artist: item.artist,
    query: `${item.artist} ${item.song}`,
    displayName: `${item.artist} - ${item.song}`,
  })).sort((a, b) => a.position - b.position);

  return { tracks, updateDate, sourceName: 'Billboard Hot 100' };
}

// ─── iTUNES TOP 100 (por país) ──────────────────────────
async function getItunesTop100(country = 'us') {
  const url = `https://itunes.apple.com/${country}/rss/topsongs/limit=100/json`;
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': UA },
    timeout: 15000,
  });

  if (!data?.feed?.entry) {
    throw new Error(`Respuesta inválida de iTunes (${country})`);
  }

  // iTunes incluye la fecha en feed.updated.label
  const updateDate = data.feed.updated?.label 
    ? new Date(data.feed.updated.label).toISOString().split('T')[0] 
    : new Date().toISOString().split('T')[0];

  const tracks = data.feed.entry.map((item, i) => {
    const artist = item['im:artist']?.label || 'Desconocido';
    const title = item['im:name']?.label || item.title?.label || 'Sin título';
    return {
      position: i + 1,
      title,
      artist,
      query: `${artist} ${title}`,
      displayName: `${artist} - ${title}`,
    };
  });

  return { tracks, updateDate, sourceName: `iTunes Top 100 (${country.toUpperCase()})` };
}

// ─── SPOTIFY TOP 50 (vía CSV público) ───────────────────
async function getSpotifyTop50() {
  try {
    const url = 'https://kworb.net/spotify/country/global_daily.html';
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });

    // Kworb no expone una fecha parseable fácilmente, usamos la fecha actual
    const updateDate = new Date().toISOString().split('T')[0];

    const rows = data.match(/<tr[\s\S]*?<\/tr>/g) || [];
    const tracks = [];

    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
      if (cells.length < 4) continue;

      const pos = parseInt(cells[0].replace(/<[^>]+>/g, '').trim(), 10);
      if (isNaN(pos)) continue;

      const artistCell = cells[2].replace(/<[^>]+>/g, '').trim();
      const titleCell = cells[1].replace(/<[^>]+>/g, '').trim();

      if (artistCell && titleCell) {
        tracks.push({
          position: pos,
          artist: artistCell,
          title: titleCell,
          query: `${artistCell} ${titleCell}`,
          displayName: `${artistCell} - ${titleCell}`,
        });
      }
      if (tracks.length >= 50) break;
    }

    return { tracks, updateDate, sourceName: 'Spotify Global Top 50' };
  } catch (err) {
    console.warn('⚠️  Spotify chart falló:', err.message);
    return { tracks: [], updateDate: new Date().toISOString().split('T')[0], sourceName: 'Spotify Global Top 50' };
  }
}

// ─── REGISTRO DE FUENTES ────────────────────────────────
export const CHART_SOURCES = {
  'billboard-hot-100': {
    name: 'Billboard Hot 100 (USA)',
    description: 'Ranking semanal de EE.UU.',
    fetch: () => getBillboardHot100(),
  },
  'itunes-us': {
    name: 'iTunes Top 100 (USA)',
    description: 'Más escuchadas en Apple Music USA',
    fetch: () => getItunesTop100('us'),
  },
  'itunes-mx': {
    name: 'iTunes Top 100 (México)',
    description: 'Más escuchadas en Apple Music México',
    fetch: () => getItunesTop100('mx'),
  },
  'itunes-es': {
    name: 'iTunes Top 100 (España)',
    description: 'Más escuchadas en Apple Music España',
    fetch: () => getItunesTop100('es'),
  },
  'itunes-ar': {
    name: 'iTunes Top 100 (Argentina)',
    description: 'Más escuchadas en Apple Music Argentina',
    fetch: () => getItunesTop100('ar'),
  },
  'itunes-co': {
    name: 'iTunes Top 100 (Colombia)',
    description: 'Más escuchadas en Apple Music Colombia',
    fetch: () => getItunesTop100('co'),
  },
  'itunes-pe': {
    name: 'iTunes Top 100 (Perú)',
    description: 'Más escuchadas en Apple Music Perú',
    fetch: () => getItunesTop100('pe'), // <-- NUEVA FUENTE
  },
  'spotify-global': {
    name: 'Spotify Global Top 50',
    description: 'Las más escuchadas globalmente',
    fetch: () => getSpotifyTop50(),
  },
};

// ─── API PÚBLICA ────────────────────────────────────────
export async function getChart(sourceId) {
  const source = CHART_SOURCES[sourceId];
  if (!source) throw new Error(`Fuente desconocida: ${sourceId}`);
  return source.fetch();
}

export function listSources() {
  return Object.entries(CHART_SOURCES).map(([id, s]) => ({
    id,
    name: s.name,
    description: s.description,
  }));
}

// Alias para compatibilidad con código viejo
export const getBillboardHot100Compat = getBillboardHot100;