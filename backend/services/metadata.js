import axios from 'axios';
import NodeID3 from 'node-id3';

/**
 * Busca metadata en iTunes con múltiples estrategias.
 * Devuelve el match con más confianza + info extra.
 */
export async function fetchMetadata(artist, title) {
  const queries = [];

  // Combinaciones de búsqueda a probar
  if (artist && title) queries.push({ q: `${artist} ${title}`, source: 'artist-title' });
  if (title && artist) queries.push({ q: `${title} ${artist}`, source: 'title-artist' });
  if (title) queries.push({ q: title, source: 'title-only' });
  if (artist && title) {
    const cleanArtist = artist.split(/\s*(?:&|,|feat\.?|ft\.?|y\s)/i)[0].trim();
    if (cleanArtist && cleanArtist !== artist) {
      queries.push({ q: `${cleanArtist} ${title}`, source: 'clean-artist' });
    }
  }

  for (const { q, source } of queries) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=3`;
      const { data } = await axios.get(url, { timeout: 8000 });

      if (!data.results || data.results.length === 0) continue;

      // De todas las respuestas, elegir la mejor por similitud
      const best = pickBestMatch(data.results, artist, title);
      if (best) {
        console.log(`   🎯 iTunes match (${source}): ${best.artistName} - ${best.trackName}`);
        return {
          title: best.trackName || title,
          artist: best.artistName || artist,
          album: best.collectionName || '',
          year: best.releaseDate ? best.releaseDate.slice(0, 4) : '',
          genre: best.primaryGenreName || '',
          coverUrl: best.artworkUrl100?.replace('100x100', '600x600') || null,
          itunesTrack: best.trackName,
          itunesArtist: best.artistName,
        };
      }
    } catch (err) {
      console.warn(`   ⚠️  Búsqueda "${q}" falló: ${err.message}`);
    }
  }

  return null;
}

/**
 * Elige el mejor match de iTunes comparando similitud con los términos buscados.
 */
function pickBestMatch(results, artist, title) {
  let best = null;
  let bestScore = 0;

  for (const r of results) {
    const score = similarity(r.trackName, title) + similarity(r.artistName, artist);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  // Requerir al menos un 40% de similitud para aceptar
  return bestScore >= 0.4 ? best : null;
}

/**
 * Similitud simple entre dos strings (0 a 1).
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const normalize = (s) =>
    s.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, '')
      .trim();

  const A = normalize(a);
  const B = normalize(b);

  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.8;

  // Similitud por palabras en común
  const wordsA = new Set(A.split(/\s+/));
  const wordsB = new Set(B.split(/\s+/));
  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  const total = Math.max(wordsA.size, wordsB.size);
  return total > 0 ? common / total : 0;
}

/**
 * Descarga la portada como Buffer.
 */
export async function downloadCover(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    return Buffer.from(res.data);
  } catch (err) {
    console.warn(`⚠️  No se pudo descargar la portada:`, err.message);
    return null;
  }
}

/**
 * Escribe los tags ID3 en un MP3.
 */
export async function tagMp3(filePath, artist, title) {
  const meta = await fetchMetadata(artist, title);
  if (!meta) return null;

  const coverBuffer = await downloadCover(meta.coverUrl);

  const tags = {
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    year: meta.year,
    genre: meta.genre,
    comment: { language: 'spa', text: 'Descargado con LuMi' },
  };

  if (coverBuffer) {
    tags.image = {
      mime: 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBuffer: coverBuffer,
    };
  }

  const result = NodeID3.write(tags, filePath);
  if (!result) throw new Error('No se pudo escribir el ID3');

  return { ...meta, coverBuffer };
}

/**
 * 🆕 FUNCIÓN CLAVE: Dado un título de YouTube ambiguo,
 * devuelve { artist, title } usando iTunes como validador.
 *
 * Ejemplo:
 *   input: "AUNQUE TU NO LO SEPAS - CLARA LAGO"
 *   output: { artist: "Clara Lago", title: "Aunque tú no lo sepas" }
 */
export async function resolveFromItunes(partA, partB) {
  if (!partA || !partB) return null;

  // Probar 2 interpretaciones:
  //   1. partA = canción, partB = artista  (formato común "Canción - Artista")
  //   2. partA = artista, partB = canción  (formato "Artista - Canción")

  const candidates = [
    { artist: partB, title: partA, order: 'canción-artista' },
    { artist: partA, title: partB, order: 'artista-canción' },
  ];

  let bestResult = null;
  let bestScore = 0;
  let bestOrder = null;

  for (const c of candidates) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(c.artist + ' ' + c.title)}&media=music&entity=song&limit=5`;
      const { data } = await axios.get(url, { timeout: 8000 });

      if (!data.results || data.results.length === 0) continue;

      for (const r of data.results) {
        const artistScore = similarity(r.artistName, c.artist);
        const titleScore = similarity(r.trackName, c.title);
        const total = (artistScore + titleScore) / 2;

        if (total > bestScore && total >= 0.5) {
          bestScore = total;
          bestResult = r;
          bestOrder = c.order;
        }
      }
    } catch (err) {
      console.warn(`   ⚠️  Consulta iTunes falló: ${err.message}`);
    }
  }

  if (!bestResult) return null;

  console.log(`   ✅ iTunes confirmó: "${bestResult.artistName} - ${bestResult.trackName}" (orden: ${bestOrder}, score: ${bestScore.toFixed(2)})`);

  return {
    artist: bestResult.artistName,
    title: bestResult.trackName,
    album: bestResult.collectionName || '',
    year: bestResult.releaseDate ? bestResult.releaseDate.slice(0, 4) : '',
    genre: bestResult.primaryGenreName || '',
    coverUrl: bestResult.artworkUrl100?.replace('100x100', '600x600') || null,
  };
}