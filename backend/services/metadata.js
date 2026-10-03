import axios from 'axios';
import NodeID3 from 'node-id3';

/**
 * Busca metadata en la API pública de iTunes, probando múltiples
 * estrategias de búsqueda hasta encontrar un match.
 */
export async function fetchMetadata(artist, title) {
  // Estrategias de búsqueda, de más específica a más genérica
  const queries = [];

  if (artist && title) queries.push(`${artist} ${title}`);
  if (title) queries.push(title);
  if (artist && title) {
    // Sin "feat." ni "&" extraños
    const cleanArtist = artist.split(/\s*(?:&|,|feat\.?|ft\.?|y\s)/i)[0].trim();
    if (cleanArtist && cleanArtist !== artist) {
      queries.push(`${cleanArtist} ${title}`);
    }
  }

  for (const q of queries) {
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=1`;
      const { data } = await axios.get(url, { timeout: 8000 });

      const track = data.results?.[0];
      if (track) {
        console.log(`   🎯 iTunes match con "${q}": ${track.artistName} - ${track.trackName}`);
        return {
          title: track.trackName || title,
          artist: track.artistName || artist,
          album: track.collectionName || '',
          year: track.releaseDate ? track.releaseDate.slice(0, 4) : '',
          genre: track.primaryGenreName || '',
          coverUrl: track.artworkUrl100?.replace('100x100', '600x600') || null,
        };
      }
    } catch (err) {
      console.warn(`   ⚠️  Búsqueda "${q}" falló: ${err.message}`);
    }
  }

  console.warn(`   ⚠️  iTunes no encontró nada para: "${artist} - ${title}"`);
  return null;
}

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
    comment: { language: 'spa', text: 'Descargado con Music Proxy' },
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