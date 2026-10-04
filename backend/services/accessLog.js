import crypto from 'crypto';
import { loadData, mutate, getCached, saveTextFile } from './driveData.js';

const DATA_FILE = 'access-log.json';
const CSV_FILE = 'access-log.csv';
const MAX_ENTRIES = 5000;

// ─── Bootstrap ────────────────────────────────────────
export async function initAccessLog() {
  await loadData(DATA_FILE, { entries: [] });
  console.log('📋 Log de accesos cargado');
}

// ─── Generar CSV desde las entradas ───────────────────
function entriesToCSV(entries) {
  const headers = [
    'Fecha',
    'Hora',
    'Usuario',
    'Evento',
    'Exito',
    'IP',
    'Cancion',
    'Fuente',
    'CuotaRestante',
  ];

  const escape = (val) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.join(',')];

  // Más recientes primero
  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  for (const e of sorted) {
    const date = new Date(e.timestamp);
    const fecha = date.toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
    const hora = date.toLocaleTimeString('es-PE', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const m = e.meta || {};

    const row = [
      fecha,
      hora,
      e.username || '(anónimo)',
      e.event,
      e.success ? 'Sí' : 'No',
      m.ip || '',
      m.song || m.songName || '',
      m.source || '',
      m.quotaRemaining ?? '',
    ];

    lines.push(row.map(escape).join(','));
  }

  // BOM UTF-8 para Excel/Sheets
  return '\ufeff' + lines.join('\n');
}

// ─── Registrar evento ─────────────────────────────────
export async function logEvent({ userId, username, event, success = true, meta = {} }) {
  try {
    await mutate(DATA_FILE, (data) => {
      data.entries.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: userId || null,
        username: username || null,
        event,
        success,
        meta,
      });

      if (data.entries.length > MAX_ENTRIES) {
        data.entries = data.entries.slice(-MAX_ENTRIES);
      }

      return data;
    });

    // Guardar CSV (asíncrono)
    const entries = getCached(DATA_FILE).entries;
    const csv = entriesToCSV(entries);
    saveTextFile(CSV_FILE, csv).catch((err) =>
      console.warn('⚠️  CSV log falló:', err.message)
    );
  } catch (err) {
    console.error('Error en accessLog:', err.message);
  }
}

// ─── Helpers con IP ───────────────────────────────────
export const logRegister = (userId, username, ip = '') =>
  logEvent({ userId, username, event: 'register', meta: { ip } });

export const logLogin = (userId, username, success = true, ip = '') =>
  logEvent({ userId, username, event: 'login', success, meta: { ip } });

export const logDownload = (userId, username, song, source, quotaRemaining, ip = '') =>
  logEvent({
    userId,
    username,
    event: 'download',
    meta: { ip, song, source, quotaRemaining },
  });

export const logDelete = (userId, username, songId, songName, ip = '') =>
  logEvent({
    userId,
    username,
    event: 'delete',
    meta: { ip, song: songName, songId },
  });