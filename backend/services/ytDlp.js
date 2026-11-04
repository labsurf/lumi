import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
import { Readable, pipeline } from 'stream';
import { fileURLToPath } from 'url';
import { drive } from './auth.js';
import { tagMp3, resolveFromItunes } from './metadata.js';

const execAsync = promisify(exec);
const pipelineAsync = promisify(pipeline);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.resolve(__dirname, '..', 'tmp');
const COOKIES_FILE = path.resolve(__dirname, '..', 'cookies.txt');
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

await fsp.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

// Argumentos para el respaldo de yt-dlp
const YTDLP_COMMON_ARGS = [
  '--extractor-args', '"youtube:player_client=default"',
  '--extractor-args', '"youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"',
  '--js-runtimes', 'deno',
  '--remote-components', 'ejs:github',
  '--socket-timeout', '15',
  '--force-ipv4',
  '--sleep-requests', '2',
  '--no-check-certificates',
  '--prefer-free-formats',
];

// ═══════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════
//  MÉTODO 1: VIDSSAVE (Inspirado en MediaSaver)
// ═══════════════════════════════════════════════════════
async function downloadWithVidssave(videoId) {
  console.log('   Intentando descarga con Vidssave (Tier 1)...');

  let filePath = null;

  try {
    const infoRes = await fetch('https://api.vidssave.com/api/contentsite_api/media/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Origin': 'https://pk.vidssave.com',
        'Referer': 'https://pk.vidssave.com/',
      },
      body: new URLSearchParams({
        hostname: 'pk.vidssave.com',
        auth: '4c9b7d21',
        domain: 'api-ak.vidssave.com',
        origin: 'source',
        link: `https://www.youtube.com/watch?v=${videoId}`,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });

    // Leemos el cuerpo una sola vez para poder diagnosticar también respuestas no-JSON.
    const infoContentType = infoRes.headers.get('content-type') || '(sin content-type)';
    const infoText = await infoRes.text();

    let infoJson;
    try {
      infoJson = JSON.parse(infoText);
    } catch {
      console.warn(
        `   ⚠️ Vidssave parse: HTTP ${infoRes.status}; content-type=${infoContentType}; ` +
        `respuesta no JSON (${infoText.length} caracteres).`
      );
      throw new Error(`Vidssave parse devolvió una respuesta no JSON (HTTP ${infoRes.status}).`);
    }

    const rootKeys = infoJson && typeof infoJson === 'object'
      ? Object.keys(infoJson)
      : [];
    const dataKeys = infoJson?.data && typeof infoJson.data === 'object'
      ? Object.keys(infoJson.data)
      : [];
    const resources = Array.isArray(infoJson?.data?.resources)
      ? infoJson.data.resources
      : [];

    console.log(
      `   Vidssave parse: HTTP ${infoRes.status}; content-type=${infoContentType}; ` +
      `rootKeys=[${rootKeys.join(',')}]; dataKeys=[${dataKeys.join(',')}]; ` +
      `resources=${resources.length}.`
    );

    if (!infoRes.ok) {
      const apiMessage = String(
        infoJson?.message || infoJson?.error || infoJson?.data?.message || ''
      ).slice(0, 240);
      throw new Error(
        `Vidssave parse falló: HTTP ${infoRes.status}` +
        (apiMessage ? ` (${apiMessage})` : '')
      );
    }

    if (!Array.isArray(infoJson?.data?.resources)) {
      throw new Error(
        `Vidssave no devolvió data.resources. dataKeys=[${dataKeys.join(',')}].`
      );
    }

    const resourceTypes = resources
      .map((resource) => String(resource?.type || '(sin tipo)'))
      .slice(0, 12);
    console.log(`   Vidssave tipos de recursos: [${resourceTypes.join(', ')}].`);

    const audioResource = resources.find((resource) => resource?.type === 'audio');
    if (!audioResource || !audioResource.resource_content) {
      throw new Error('Vidssave no entregó un recurso de audio con resource_content.');
    }

    const dlRes = await fetch('https://api.vidssave.com/api/contentsite_api/media/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Origin': 'https://pk.vidssave.com',
        'Referer': 'https://pk.vidssave.com/',
      },
      body: new URLSearchParams({
        hostname: 'pk.vidssave.com',
        auth: '4c9b7d21',
        domain: 'api-ak.vidssave.com',
        request: audioResource.resource_content,
        no_encrypt: '1',
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });

    const dlContentType = dlRes.headers.get('content-type') || '(sin content-type)';
    const dlText = await dlRes.text();

    let dlJson;
    try {
      dlJson = JSON.parse(dlText);
    } catch {
      console.warn(
        `   ⚠️ Vidssave download: HTTP ${dlRes.status}; content-type=${dlContentType}; ` +
        `respuesta no JSON (${dlText.length} caracteres).`
      );
      throw new Error(`Vidssave download devolvió una respuesta no JSON (HTTP ${dlRes.status}).`);
    }

    const dlDataKeys = dlJson?.data && typeof dlJson.data === 'object'
      ? Object.keys(dlJson.data)
      : [];
    console.log(
      `   Vidssave download: HTTP ${dlRes.status}; content-type=${dlContentType}; ` +
      `dataKeys=[${dlDataKeys.join(',')}].`
    );

    if (!dlRes.ok) {
      const apiMessage = String(
        dlJson?.message || dlJson?.error || dlJson?.data?.message || ''
      ).slice(0, 240);
      throw new Error(
        `Vidssave download falló: HTTP ${dlRes.status}` +
        (apiMessage ? ` (${apiMessage})` : '')
      );
    }

    // Se conserva el contrato que ya utilizaba el proyecto; no se inventan campos nuevos.
    const finalUrl = dlJson?.data?.url || dlJson?.data?.download_url || dlJson?.data?.link;
    if (!finalUrl || typeof finalUrl !== 'string') {
      throw new Error(
        `Vidssave no devolvió data.url, data.download_url ni data.link. dataKeys=[${dlDataKeys.join(',')}].`
      );
    }

    const mp3Res = await fetch(finalUrl, { signal: AbortSignal.timeout(60000) });
    if (!mp3Res.ok) {
      throw new Error(`Error al descargar el audio desde Vidssave: HTTP ${mp3Res.status}`);
    }
    if (!mp3Res.body) {
      throw new Error('Vidssave devolvió una respuesta de descarga sin contenido.');
    }

    const jobId = crypto.randomUUID();
    filePath = path.join(TMP_DIR, `${jobId}.mp3`);

    // fetch() entrega un Web ReadableStream; se convierte al stream de Node.js.
    await pipelineAsync(
      Readable.fromWeb(mp3Res.body),
      fs.createWriteStream(filePath)
    );

    const stat = await fsp.stat(filePath);
    if (!stat.size) {
      throw new Error('Vidssave generó un archivo de audio vacío.');
    }

    console.log(`   ✅ Vidssave descargó el audio (${stat.size} bytes).`);
    return filePath;
  } catch (err) {
    if (filePath) await fsp.unlink(filePath).catch(() => {});
    console.warn('   ⚠️ Vidssave falló:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════
//  PROBE
// ═══════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════
//  DESCARGA PRINCIPAL
// ═══════════════════════════════════════════════════════
export async function downloadAndUpload(query, displayNameHint, source = 'manual') {
  const jobId = crypto.randomUUID();
  const tmpBase = path.join(TMP_DIR, jobId);
  const outTemplate = tmpBase + '.%(ext)s';
  const cookies = await getWritableCookiesPath();

  try {
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

  const videoId = yt.url.split('v=')[1];
  console.log('   URL del video:', yt.url);

  // 2. Intentar descarga con Vidssave (Tier 1)
  let ytFilePath = await downloadWithVidssave(videoId);

  // 3. Fallback a yt-dlp si Vidssave falló
  if (!ytFilePath) {
    console.log('   ⚠️ Vidssave falló, usando yt-dlp como respaldo...');
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

    try {
      const { stdout: dlStdout } = await execAsync(downloadCmd, { maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: 120000 });
      ytFilePath = parseYtMetadata(dlStdout).file;
    } catch (err) {
      const details = String(err?.stderr || err?.message || err).slice(0, 1800);
      console.error('   Error en yt-dlp:', details);

      if (/Sign in to confirm|not a bot|bot/i.test(details)) {
        throw new Error('YouTube rechazó la solicitud de descarga por verificación antibot.');
      }
      if (/video is unavailable|Error code: 152/i.test(details)) {
        throw new Error('YouTube indica que el video no está disponible para este método de extracción.');
      }
      throw new Error('Falló yt-dlp al obtener el audio. Revisa el log del servidor para ver el error original.');
    }
  }

  if (!ytFilePath || !fs.existsSync(ytFilePath)) {
    throw new Error('No se pudo descargar el archivo de audio.');
  }

  console.log('Descargado temporalmente: ' + path.basename(ytFilePath));
  
  // 4. Metadata y subida a Drive
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
  } finally {
    if (cookies) await fsp.unlink(cookies).catch(() => {});
  }
}