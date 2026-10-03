import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { drive } from './auth.js';
import { tagMp3 } from './metadata.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '..', 'tmp');
const COOKIES_FILE = path.resolve(__dirname, '..', 'cookies.txt');
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

await fsp.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

if (!fs.existsSync(COOKIES_FILE)) {
  console.warn(`⚠️  No se encontró ${COOKIES_FILE}`);
  console.warn(`   Exporta las cookies de YouTube con "Get cookies.txt LOCALLY"`);
}

// ═══════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════

function sanitizeDisplayName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/[»«–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Limpia un título de YouTube quitando sufijos típicos.
 */
function cleanYouTubeTitle(title) {
  let t = title || '';

  const patterns = [
    // ─── VIDEOCLIP / VIDEO OFICIAL (español) ─────────────
    /\s*[\(\[]\s*(videoclip|video\s*-?\s*clip|clip)\s*(oficial)?\s*[\)\]]/gi,
    /\s*[\(\[]\s*v[ií]deo\s*oficial\s*[\)\]]/gi,
    /\s*[\(\[]\s*oficial\s*[\)\]]/gi,
    /\s*[\(\[]\s*v[ií]deo\s*lyric\s*[\)\]]/gi,
    /\s*[\(\[]\s*lyric\s*video\s*(oficial)?\s*[\)\]]/gi,

    // ─── OFFICIAL VIDEO / AUDIO (inglés) ─────────────────
    /\s*[\(\[]\s*(official\s*)?(music\s*)?(video|audio|visualizer|clip)\s*[\)\]]/gi,
    /\s*[\(\[]\s*official\s*[\)\]]/gi,

    // ─── LYRICS / LETRA ──────────────────────────────────
    /\s*[\(\[]\s*(letra|lyrics?|lyric\s*video)\s*[\)\]]/gi,
    /\s*[\(\[]\s*lyric[s]?\s*[\)\]]/gi,
    /\s*[\(\[]\s*letra\s*\/\s*lyrics?\s*[\)\]]/gi,
    /\s*[\(\[]\s*letra\s*[\)\]]/gi,

    // ─── AUDIO ───────────────────────────────────────────
    /\s*[\(\[]\s*audio\s*(oficial)?\s*[\)\]]/gi,

    // ─── CALIDAD / RESOLUCIÓN ────────────────────────────
    /\s*[\(\[]\s*(HD|HQ|4K|8K|1080p|720p|Full\s*HD)\s*[\)\]]/gi,

    // ─── REMASTER ────────────────────────────────────────
    /\s*[\(\[]\s*(remaster(ed)?|remasterizad[oa])\s*[\)\]]/gi,

    // ─── PRODUCTOR ───────────────────────────────────────
    /\s*[\(\[]\s*prod\.?\s*[^\)\]]*[\)\]]/gi,

    // ─── @handles y #hashtags ────────────────────────────
    /\s+@[\w\.\-]+/g,
    /\s+#[\wáéíóúñ\-]+/gi,

    // ─── Caracteres rotos ────────────────────────────────
    /[�◆▪▫■□●○▲△▼▽♫♬♪]+/g,

    // ─── Cortar todo después de "//" ─────────────────────
    /\/\/.*$/g,
  ];

  for (const p of patterns) t = t.replace(p, '');

  // Quitar "- Topic" del final
  t = t.replace(/\s*-\s*Topic\s*$/i, '');

  // Colapsar espacios múltiples
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Detecta si un nombre parece "limpio" (no tiene basura).
 */
function looksClean(s) {
  if (!s) return false;
  // Muy largo probablemente tiene basura
  if (s.length > 60) return false;
  // Más de 8 palabras probablemente tiene basura
  if (s.split(/\s+/).length > 8) return false;
  // Caracteres sospechosos
  if (/[\/\\|\[\]{}<>+~]/.test(s)) return false;
  // Palabras que indican que NO se limpió bien
  if (/\b(sub|subtitled|traducci[oó]n|traducido|espa[nñ]ol|english|lyric|letra|official|oficial|video|audio|remaster|hd|hq|4k)\b/i.test(s)) {
    return false;
  }
  return true;
}

function parseYtMetadata(stdout) {
  const result = { file: null, title: null, artist: null, track: null, uploader: null };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('@@FILE@@')) result.file = line.slice(8).trim();
    else if (line.startsWith('@@TITLE@@')) result.title = line.slice(9).trim();
    else if (line.startsWith('@@ARTIST@@')) result.artist = line.slice(10).trim();
    else if (line.startsWith('@@TRACK@@')) result.track = line.slice(9).trim();
    else if (line.startsWith('@@UPLOADER@@')) result.uploader = line.slice(12).trim();
  }
  return result;
}

/**
 * Determina el nombre final con esta jerarquía:
 *   1. YouTube Music metadata oficial (artist + track)
 *   2. Hint con formato "Artista - Título" (charts) → LIMPIO
 *   3. Parseo del título de YouTube (último recurso)
 */
function resolveFinalName(yt, userInput) {
  let artist = '';
  let title = '';
  let origin = '';

  // ─── 1. YouTube Music metadata (lo más confiable) ─────
  if (yt.artist && yt.artist !== 'NA' && yt.track && yt.track !== 'NA') {
    artist = yt.artist;
    title = yt.track;
    origin = 'youtube-music';
  }
  // ─── 2. Hint con formato "Artist - Title" (limpio) ────
  else if (userInput && userInput.includes(' - ')) {
    const [a, ...rest] = userInput.split(' - ');
    const candidateArtist = a.trim();
    const candidateTitle = rest.join(' - ').trim();

    if (looksClean(candidateArtist) && looksClean(candidateTitle)) {
      artist = candidateArtist;
      title = candidateTitle;
      origin = 'hint';
    }
  }

  // ─── 3. Parseo del título de YouTube (último recurso) ─
  if (!artist && !title && yt.title) {
    const cleaned = cleanYouTubeTitle(yt.title);

    // Buscar separador
    let dashIdx = cleaned.indexOf(' - ');
    let sepLen = 3;
    if (dashIdx < 0) {
      for (const sep of [' — ', ' – ', ' | ', ' • ', ' · ']) {
        const idx = cleaned.indexOf(sep);
        if (idx > 0) { dashIdx = idx; sepLen = sep.length; break; }
      }
    }

    if (dashIdx > 0) {
      artist = cleaned.slice(0, dashIdx).trim();
      title = cleaned.slice(dashIdx + sepLen).trim();
    } else {
      const channel = (yt.uploader || '').replace(/\s*-\s*Topic$/i, '').trim();
      const isGeneric = /^(vibes|vibesonly|lyrics|lyric|letras|music|musica|música|chill|chillout|relax|songs|canciones|top|hits|hitsmusic|urban|pop|indie|latino|reggaeton|official|oficial|brunotraductor|traductor|latin\s*union)/i.test(channel);

      if (isGeneric) {
        artist = '';
        title = cleaned;
      } else {
        artist = channel;
        title = cleaned;
      }
    }
    origin = 'youtube-parse';

    // Validar; si parece sucio, usar el input del usuario
    if (!looksClean(artist) || !looksClean(title)) {
      if (userInput) {
        artist = '';
        title = userInput;
        origin = 'user-input-fallback';
      }
    }
  }

  // ─── Fallback final ────────────────────────────────────
  if (!title) {
    title = userInput || 'Sin título';
    origin = origin || 'fallback';
  }

  const combined = artist ? `${artist} - ${title}` : title;
  return {
    artist,
    title,
    displayName: sanitizeDisplayName(combined),
    origin,
  };
}

export function normalizeKey(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.mp3$/i, '')
    .replace(/[^a-z0-9]/g, '');
}

// ═══════════════════════════════════════════════════════
//  PROBE
// ═══════════════════════════════════════════════════════

export async function probeYoutube(query) {
  const cmd = [
    'yt-dlp',
    '--cookies', `"${COOKIES_FILE}"`,
    '--no-config',
    `"ytsearch1:${query.replace(/"/g, '')}"`,
    '--skip-download',
    '--no-warnings',
    '--print', '"@@TITLE@@%(title)s"',
    '--print', '"@@ARTIST@@%(artist)s"',
    '--print', '"@@TRACK@@%(track)s"',
    '--print', '"@@UPLOADER@@%(uploader)s"',
  ].join(' ');

  const { stdout } = await execAsync(cmd, {
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
  });

  const yt = parseYtMetadata(stdout);
  const resolved = resolveFinalName(yt, query);
  return { ...yt, ...resolved };
}

// ═══════════════════════════════════════════════════════
//  DESCARGA + SUBIDA
// ═══════════════════════════════════════════════════════

export async function downloadAndUpload(query, displayNameHint, source = 'manual') {
  const jobId = crypto.randomUUID();
  const tmpBase = path.join(TMP_DIR, jobId);
  const outTemplate = `${tmpBase}.%(ext)s`;

  console.log(`🎵 Buscando en YouTube: "${query}"  [source=${source}]`);

  const cmd = [
    'yt-dlp',
    '--cookies', `"${COOKIES_FILE}"`,
    '--no-config',
    `"ytsearch1:${query.replace(/"/g, '')}"`,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--no-warnings',
    '-o', `"${outTemplate}"`,
    '--print', '"@@TITLE@@%(title)s"',
    '--print', '"@@ARTIST@@%(artist)s"',
    '--print', '"@@TRACK@@%(track)s"',
    '--print', '"@@UPLOADER@@%(uploader)s"',
    '--print', '"after_move:@@FILE@@%(filepath)s"',
  ].join(' ');

  const { stdout } = await execAsync(cmd, {
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });

  const yt = parseYtMetadata(stdout);

  if (!yt.file || !fs.existsSync(yt.file)) {
    throw new Error(`No se encontró el archivo descargado.\nstdout:\n${stdout}`);
  }

  console.log(`✅ Descargado temporalmente: ${path.basename(yt.file)}`);
  console.log(`📺 Título YouTube: "${yt.title}"`);
  if (yt.artist && yt.artist !== 'NA') console.log(`🎤 Artista YouTube: "${yt.artist}"`);
  if (yt.uploader) console.log(`📡 Canal: "${yt.uploader}"`);

  const { artist, title, displayName, origin } = resolveFinalName(yt, displayNameHint);
  console.log(`📝 Nombre final: "${displayName}"  (origen: ${origin})`);
  console.log(`🔎 iTunes buscará: "${artist}" / "${title}"`);

  // ─── Metadata ID3 ─────────────────────────────────────
  console.log(`🏷️  Buscando metadata en iTunes...`);
  const meta = await tagMp3(yt.file, artist, title).catch((err) => {
    console.warn(`⚠️  Metadata falló: ${err.message}`);
    return null;
  });

  if (meta) {
    console.log(`   → ${meta.artist} - ${meta.title}`);
    if (meta.album) console.log(`   → Álbum: ${meta.album}${meta.year ? ` (${meta.year})` : ''}`);
    if (meta.coverBuffer) console.log(`   → Portada descargada ✅`);
  } else {
    console.log(`   → Sin metadata`);
  }

  // ─── Subir portada ────────────────────────────────────
  let coverFileId = null;
  if (meta?.coverBuffer) {
    try {
      const coverRes = await drive.files.create({
        requestBody: {
          name: `${displayName}.cover.jpg`,
          parents: [FOLDER_ID],
          mimeType: 'image/jpeg',
        },
        media: {
          mimeType: 'image/jpeg',
          body: Readable.from(meta.coverBuffer),
        },
        fields: 'id',
      });
      coverFileId = coverRes.data.id;
      console.log(`   → Portada subida: ${coverFileId}`);
    } catch (err) {
      console.warn(`⚠️  No se pudo subir la portada: ${err.message}`);
    }
  }

  // ─── Subir MP3 ────────────────────────────────────────
  const uploadName = `${displayName}.mp3`;
  const fileProperties = {
    source,
    ytTitle: yt.title || '',
    ytUploader: yt.uploader || '',
    normKey: normalizeKey(displayName),
  };
  if (coverFileId) fileProperties.coverId = coverFileId;

  const created = await drive.files.create({
    requestBody: {
      name: uploadName,
      parents: [FOLDER_ID],
      properties: fileProperties,
    },
    media: {
      mimeType: 'audio/mpeg',
      body: fs.createReadStream(yt.file),
    },
    fields: 'id, name, size, createdTime, properties',
  });

  await fsp.unlink(yt.file).catch(() => {});
  console.log(`☁️  Subido a Drive: ${created.data.name} (${created.data.id})`);

  return { ...created.data, coverFileId };
}