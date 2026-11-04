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
import { tagMp3, resolveFromItunes } from './metadata.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '..', 'tmp');
const COOKIES_FILE = path.resolve(__dirname, '..', 'cookies.txt');
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

await fsp.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

if (!fs.existsSync(COOKIES_FILE)) {
  console.warn('Warning: No se encontro ' + COOKIES_FILE);
}

// Argumentos compartidos para búsqueda y descarga (Incluye el POT Provider)
const YTDLP_COMMON_ARGS = [
  '--extractor-args', '"youtube:player_client=web"',
  '--extractor-args', '"youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"',
  '--js-runtimes', 'deno',
  '--remote-components', 'ejs:github',
  '--socket-timeout', '15',
  '--force-ipv4',
  '--sleep-requests', '2',
  '--no-check-certificates',
  '--prefer-free-formats',
];

function sanitizeDisplayName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/[\u00BB\u00AB\u2013\u2014]/g, '-')
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
    /\s*\([^)]*(oficial|official|video|audio|version|versi\u00F3n|lyric|letra|remaster|hd|hq|4k|en vivo|en directo)[^)]*\)/gi,
    /\s*\[[^\]]*(oficial|official|video|audio|version|versi\u00F3n|lyric|letra|remaster|hd|hq|4k|en vivo|en directo)[^\]]*\]/gi,
    /\(\s*\)/g,
    /\[\s*\]/g,
    /\s*[-\u2013\u2014]\s*[\)\]]/g,
    /\s+@[\w.\-]+/g,
    /\s+#[\w\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1\-]+/gi,
    /[\uFFFD\u25C6\u25AA\u25AB\u25A0\u25A1\u25CF\u25CB\u25B2\u25B3\u25BC\u25BD\u266B\u266C\u266A]+/g,
    /\/\/.*$/g,
  ];
  for (const p of patterns) t = t.replace(p, '');
  t = t.replace(/\s*-\s*Topic\s*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

function looksClean(s) {
  if (!s) return false;
  if (s.length > 80) return false;
  const realWords = s.split(/\s+/).filter((w) => /[a-z0-9\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1]/i.test(w));
  if (realWords.length > 12) return false;
  if (/[\/\\|\[\]{}<>+~]/.test(s)) return false;
  if (/\b(sub|subtitled|traducci\u00F3n|traducido|espa\u00F1ol|english|lyric|letra|official|oficial|video|audio|remaster|hd|hq|4k)\b/i.test(s)) return false;
  return true;
}

function parseYtMetadata(stdout) {
  const result = { file: null, title: null, artist: null, track: null, uploader: null, url: null };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('@@FILE@@')) result.file = line.slice(8).trim();
    else if (line.startsWith('@@TITLE@@')) result.title = line.slice(9).trim();
    else if (line.startsWith('@@ARTIST@@')) result.artist = line.slice(10).trim();
    else if (line.startsWith('@@TRACK@@')) result.track = line.slice(9).trim();
    else if (line.startsWith('@@UPLOADER@@')) result.uploader = line.slice(12).trim();
    else if (line.startsWith('@@URL@@')) result.url = line.slice(7).trim();
  }
  return result;
}

function resolveFinalName(yt, userInput) {
  let artist = ''; let title = ''; let origin = '';
  if (yt.artist && yt.artist !== 'NA' && yt.track && yt.track !== 'NA') {
    artist = yt.artist; title = yt.track; origin = 'youtube-music';
  } else if (userInput && userInput.includes(' - ')) {
    const parts = userInput.split(' - ');
    if (looksClean(parts[0].trim()) && looksClean(parts.slice(1).join(' - ').trim())) {
      artist = parts[0].trim(); title = parts.slice(1).join(' - ').trim(); origin = 'hint';
    }
  }
  if (!artist && !title && yt.title) {
    const cleaned = cleanYouTubeTitle(yt.title);
    let dashIdx = cleaned.indexOf(' - ');
    let sepLen = 3;
    if (dashIdx < 0) {
      for (const sep of [' \u2014 ', ' \u2013 ', ' | ', ' \u2022 ', ' \u00B7 ']) {
        const idx = cleaned.indexOf(sep);
        if (idx > 0) { dashIdx = idx; sepLen = sep.length; break; }
      }
    }
    if (dashIdx > 0) {
      artist = cleaned.slice(0, dashIdx).trim(); title = cleaned.slice(dashIdx + sepLen).trim();
    } else {
      const channel = (yt.uploader || '').replace(/\s*-\s*Topic$/i, '').trim();
      const isGeneric = /^(vibes|vibesonly|lyrics|lyric|letras|music|musica|m\u00FAsica|chill|chillout|relax|songs|canciones|top|hits|hitsmusic|urban|pop|indie|latino|reggaeton|official|oficial|brunotraductor|traductor|latin\s*union)/i.test(channel);
      if (isGeneric) { artist = ''; title = cleaned; } else { artist = channel; title = cleaned; }
    }
    origin = 'youtube-parse';
    if (!looksClean(artist) || !looksClean(title)) { origin = 'needs-itunes'; }
  }
  if (!title) { title = userInput || 'Sin titulo'; origin = origin || 'fallback'; }
  return { artist, title, displayName: sanitizeDisplayName(artist ? artist + ' - ' + title : title), origin };
}

async function resolveNameWithItunes(yt, userInput) {
  const cleaned = cleanYouTubeTitle(yt.title || '');
  let parts = null; let sep = ' - '; let idx = cleaned.indexOf(' - ');
  if (idx < 0) {
    for (const s of [' \u2014 ', ' \u2013 ', ' | ', ' \u2022 ', ' \u00B7 ']) {
      const i = cleaned.indexOf(s);
      if (i > 0) { idx = i; sep = s; break; }
    }
  }
  if (idx > 0) { parts = [cleaned.slice(0, idx).trim(), cleaned.slice(idx + sep.length).trim()]; }
  else { if (userInput && userInput.trim()) parts = [userInput.trim(), cleaned]; else return null; }
  parts = parts.map(p => p.replace(/\b(HQ|HD|4K|8K|AUDIO|VIDEO|OFICIAL|OFFICIAL|LYRICS?|LETRA)\b/gi, '').replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/[\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim()).filter(p => p.length > 0);
  if (parts.length < 2) return null;
  const itunes = await resolveFromItunes(parts[0], parts[1]).catch(() => null);
  if (!itunes) return null;
  return { artist: itunes.artist, title: itunes.title, displayName: sanitizeDisplayName(itunes.artist + ' - ' + itunes.title), origin: 'itunes-resolved' };
}

export function normalizeKey(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.mp3$/i, '').replace(/[^a-z0-9]/g, '');
}

async function getWritableCookiesPath() {
  if (!fs.existsSync(COOKIES_FILE)) return null;
  const tmpCookies = path.join(os.tmpdir(), 'lumi-cookies-' + crypto.randomUUID() + '.txt');
  await fsp.copyFile(COOKIES_FILE, tmpCookies);
  return tmpCookies;
}

export async function probeYoutube(query) {
  const cmd = [
    'yt-dlp',
    '--no-config',
    ...YTDLP_COMMON_ARGS,
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    `"ytsearch1:${query.replace(/"/g, '')}"`,
    '--print', '"@@TITLE@@%(title)s"',
    '--print', '"@@ARTIST@@%(artist)s"',
    '--print', '"@@TRACK@@%(track)s"',
    '--print', '"@@UPLOADER@@%(uploader)s"',
    '--print', '"@@URL@@%(webpage_url)s"',
  ].join(' ');

  const { stdout } = await execAsync(cmd, { maxBuffer: 5 * 1024 * 1024, windowsHide: true, timeout: 40000 });
  const yt = parseYtMetadata(stdout);
  return { ...yt, ...resolveFinalName(yt, query) };
}

export async function downloadAndUpload(query, displayNameHint, source = 'manual') {
  const jobId = crypto.randomUUID();
  const tmpBase = path.join(TMP_DIR, jobId);
  const outTemplate = tmpBase + '.%(ext)s';
  const cookies = await getWritableCookiesPath();

  console.log('Buscando en YouTube: "' + query + '"  [source=' + source + ']');

  // 1. Buscar el video
  const searchCmd = [
    'yt-dlp',
    '--no-config',
    ...YTDLP_COMMON_ARGS,
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    `"ytsearch1:${query.replace(/"/g, '')}"`,
    '--print', '"@@TITLE@@%(title)s"',
    '--print', '"@@ARTIST@@%(artist)s"',
    '--print', '"@@TRACK@@%(track)s"',
    '--print', '"@@UPLOADER@@%(uploader)s"',
    '--print', '"@@URL@@%(webpage_url)s"',
  ].join(' ');

  const { stdout: searchStdout } = await execAsync(searchCmd, { maxBuffer: 5 * 1024 * 1024, windowsHide: true, timeout: 40000 });
  const yt = parseYtMetadata(searchStdout);

  if (!yt.url || !yt.url.includes('/watch?v=')) {
    throw new Error('La búsqueda no devolvió un video válido. Intenta con otro nombre.');
  }

  console.log('   URL del video:', yt.url);

  // 2. Descargar con yt-dlp (usando cookies y POT)
  const downloadCmd = [
    'yt-dlp',
    ...(cookies ? ['--cookies', `"${cookies}"`] : []),
    '--no-config',
    ...YTDLP_COMMON_ARGS,
    `"${yt.url}"`,
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--no-warnings',
    '-f', '"bestaudio*/best"',
    '-o', `"${outTemplate}"`,
    '--print', '"after_move:@@FILE@@%(filepath)s"',
  ].join(' ');

  let ytFilePath = null;
  try {
    const { stdout: dlStdout } = await execAsync(downloadCmd, { maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: 120000 });
    ytFilePath = parseYtMetadata(dlStdout).file;
  } catch (err) {
    console.error('   Error en yt-dlp:', err.message);
    throw new Error('YouTube bloqueó la descarga. Intenta de nuevo más tarde.');
  } finally {
    if (cookies) await fsp.unlink(cookies).catch(() => {});
  }

  if (!ytFilePath || !fs.existsSync(ytFilePath)) {
    throw new Error('No se pudo descargar el archivo de audio.');
  }

  console.log('Descargado temporalmente: ' + path.basename(ytFilePath));
  
  let resolved = resolveFinalName(yt, displayNameHint);
  let { artist, title, displayName, origin } = resolved;

  if (origin === 'needs-itunes') {
    const itunesResolved = await resolveNameWithItunes(yt, displayNameHint).catch(() => null);
    if (itunesResolved) {
      artist = itunesResolved.artist; title = itunesResolved.title; displayName = itunesResolved.displayName; origin = itunesResolved.origin;
    } else if (displayNameHint) {
      artist = ''; title = displayNameHint; displayName = sanitizeDisplayName(displayNameHint); origin = 'user-input-fallback';
    }
  }

  console.log('Nombre final: "' + displayName + '"  (origen: ' + origin + ')');

  const meta = await tagMp3(ytFilePath, artist, title).catch(() => null);

  let coverFileId = null;
  if (meta && meta.coverBuffer) {
    try {
      const coverRes = await drive.files.create({
        requestBody: { name: displayName + '.cover.jpg', parents: [FOLDER_ID], mimeType: 'image/jpeg' },
        media: { mimeType: 'image/jpeg', body: Readable.from(meta.coverBuffer) }, fields: 'id',
      });
      coverFileId = coverRes.data.id;
    } catch (err) { console.warn('No se pudo subir la portada: ' + err.message); }
  }

  const uploadName = displayName + '.mp3';
  const fileProperties = { source, ytTitle: yt.title || '', ytUploader: yt.uploader || '', normKey: normalizeKey(displayName) };
  if (coverFileId) fileProperties.coverId = coverFileId;

  const created = await drive.files.create({
    requestBody: { name: uploadName, parents: [FOLDER_ID], properties: fileProperties },
    media: { mimeType: 'audio/mpeg', body: fs.createReadStream(ytFilePath) },
    fields: 'id, name, size, createdTime, properties',
  });

  await fsp.unlink(ytFilePath).catch(() => {});
  console.log('Subido a Drive: ' + created.data.name + ' (' + created.data.id + ')');

  return { ...created.data, coverFileId };
}