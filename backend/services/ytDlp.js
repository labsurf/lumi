import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
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
}

// ═══════════════════════════════════════════════════════
//  ARGS COMPARTIDOS PARA YT-DLP
// ═══════════════════════════════════════════════════════
const YTDLP_COMMON_ARGS = [
  '--extractor-args', 'youtube:player_client=tv,mweb,web_safari',
  '--js-runtimes', 'deno',
  '--remote-components', 'ejs:github',
  '--no-check-certificates',
  '--prefer-free-formats',
];

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

function cleanYouTubeTitle(title) {
  let t = title || '';
  const patterns = [
    /\s*[\(\[]\s*(videoclip|video\s*-?\s*clip|clip)\s*(oficial)?\s*[\)\]]/gi,
    /\s*[\(\[]\s*v[ií]deo\s*oficial\s*[\)\]]/gi,
    /\s*[\(\[]\s*oficial\s*[\)\]]/gi,
    /\s*[\(\[]\s*v[ií]deo\s*lyric\s*[\)\]]/gi,
    /\s*[\(\[]\s*lyric\s*video\s*(oficial)?\s*[\)\]]/gi,
    /\s*[\(\[]\s*(official\s*)?(music\s*)?(video|audio|visualizer|clip)\s*[\)\]]/gi,
    /\s*[\(\[]\s*official\s*[\)\]]/gi,
    /\s*[\(\[]\s*(letra|lyrics?|lyric\s*video)\s*[\)\]]/gi,
    /\s*[\(\[]\s*lyric[s]?\s*[\)\]]/gi,
    /\s*[\(\[]\s*letra\s*\/\s*lyrics?\s*[\)\]]/gi,
    /\s*[\(\[]\s*letra\s*[\)\]]/gi,
    /\s*[\(\[]\s*audio\s*(oficial)?\s*[\)\]]/gi,
    /\s*[\(\[]\s*(HD|HQ|4K|8K|1080p|720p|Full\s*HD)\s*[\)\]]/gi,
    /\s*[\(\[]\s*(remaster(ed)?|remasterizad[oa])\s*[\)\]]/gi,
    /\s*[\(\[]\s*prod\.?\s*[^\)\]]*[\)\]]/gi,
    /\s+@[\w\.\-]+/g,
    /\s+#[\wáéíóúñ\-]+/gi,
    /[�◆▪▫■□●○▲△▼▽♫♬♪]+/g,
    /\/\/.*$/g,
  ];
  for (const p of patterns) t = t.replace(p, '');
  t = t.replace(/\s*-\s*Topic\s*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

function looksClean(s) {
  if (!s) return false;
  if (s.length > 60) return false;
  if (s.split(/\s+/).length > 8) return false;
  if (/[\/\\|\[\]{}<>+~]/.test(s)) return false;
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

function resolveFinalName(yt, userInput) {
  let artist = '';
  let title = '';
  let origin = '';

  if (yt.artist && yt.artist !== 'NA' && yt.track && yt.track !== 'NA') {
    artist = yt.artist; title = yt.track; origin = 'youtube-music';
  } else if (userInput && userInput.includes(' - ')) {
    const [a, ...rest] = userInput.split(' - ');
    const candidateArtist = a.trim();
    const candidateTitle = rest.join(' - ').trim();
    if (looksClean(candidateArtist) && looksClean(candidateTitle)) {
      artist = candidateArtist; title = candidateTitle; origin = 'hint';
    }
  }

  if (!artist && !title && yt.title) {
    const cleaned = cleanYouTubeTitle(yt.title);
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
      if (isGeneric) { artist = ''; title = cleaned; }
      else { artist = channel; title = cleaned; }
    }
    origin = 'youtube-parse';
    if (!looksClean(artist) || !looksClean(title)) {
      if (userInput) { artist = ''; title = userInput; origin = 'user-input-fallback'; }
    }
  }
  if (!title) { title = userInput || 'Sin título'; origin = origin || 'fallback'; }
  const combined = artist ? `${artist} - ${title}` : title;
  return { artist, title, displayName: sanitizeDisplayName(combined), origin };
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
//  COOKIES: copiar a un archivo escribible
// ═══════════════════════════════════════════════════════
async function getWritableCookiesPath() {
  if (!fs.existsSync(COOKIES_FILE)) return null;
  const tmpCookies = path.join(os.tmpdir(), `lumi-cookies-${crypto.randomUUID()}.txt`);
  await fsp.copyFile(COOKIES_FILE, tmpCookies);
  return tmpCookies;
}

// ═══════════════════════════════════════════════════════
//  PROBE
// ═══════════════════════════════════════════════════════

export async function probeYoutube(query) {
  const cookies = await getWritableCookiesPath();
  const cmd = [
    'yt-dlp',
    ...(cookies ? ['--cookies', `"${cookies}"`] : []),
    '--no-config',
    ...YTDLP_COMMON_ARGS,
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

  if (cookies) await fsp.unlink(cookies).catch(() => {});

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
  const cookies = await getWritableCookiesPath();

  console.log(`🎵 Buscando en YouTube: "${query}"  [source=${source}]`);

  const cmd = [
    'yt-dlp',
    ...(cookies ? ['--cookies', `"${cookies}"`] : []),
    '--no-config',
    ...YTDLP_COMMON_ARGS,
    `"ytsearch1:${query.replace(/"/g, '')}"`,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--no-warnings',
    '-f', '"bestaudio*/best"',
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

  if (cookies) await fsp.unlink(cookies).catch(() => {});

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

  let coverFileId = null;
  if (meta?.coverBuffer) {
    try {
      const coverRes = await drive.files.create({
        requestBody: {
          name: `${displayName}.cover.jpg`,
          parents: [FOLDER_ID],
          mimeType: 'image/jpeg',
        },
        media: { mimeType: 'image/jpeg', body: Readable.from(meta.coverBuffer) },
        fields: 'id',
      });
      coverFileId = coverRes.data.id;
      console.log(`   → Portada subida: ${coverFileId}`);
    } catch (err) {
      console.warn(`⚠️  No se pudo subir la portada: ${err.message}`);
    }
  }

  // ─── Subir el MP3 a Drive ─────────────────────────────
  // ⚠️ CAMBIO: ya no guardamos ownerId/ownerUsername en las properties.
  //    La asociación usuario↔canción vive en user-songs.json.
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
    media: { mimeType: 'audio/mpeg', body: fs.createReadStream(yt.file) },
    fields: 'id, name, size, createdTime, properties',
  });

  await fsp.unlink(yt.file).catch(() => {});
  console.log(`☁️  Subido a Drive: ${created.data.name} (${created.data.id})`);

  return { ...created.data, coverFileId };
}