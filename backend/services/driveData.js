import { drive } from './auth.js';
import { Readable } from 'stream';

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const DATA_FOLDER_NAME = '_lumi_data';

// ─── Estado en memoria ────────────────────────────────
const cache = new Map(); // name -> { data, dirty, fileId }
let dataFolderId = null;
let syncTimer = null;
let isSyncing = false;

// ═══════════════════════════════════════════════════════
//  CARPETA _lumi_data EN DRIVE
// ═══════════════════════════════════════════════════════

async function getDataFolderId() {
  if (dataFolderId) return dataFolderId;

  const res = await drive.files.list({
    q: `'${PARENT_FOLDER_ID}' in parents and name='${DATA_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });

  if (res.data.files.length > 0) {
    dataFolderId = res.data.files[0].id;
    return dataFolderId;
  }

  const created = await drive.files.create({
    requestBody: {
      name: DATA_FOLDER_NAME,
      parents: [PARENT_FOLDER_ID],
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  dataFolderId = created.data.id;
  console.log(`📁 Carpeta de datos creada en Drive: ${dataFolderId}`);
  return dataFolderId;
}

// ═══════════════════════════════════════════════════════
//  LEER / ESCRIBIR ARCHIVOS
// ═══════════════════════════════════════════════════════

async function findFile(name) {
  const folderId = await getDataFolderId();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name='${name}' and trashed=false`,
    fields: 'files(id, modifiedTime)',
  });
  return res.data.files[0] || null;
}

async function readFromDrive(name) {
  const file = await findFile(name);
  if (!file) return null;

  const res = await drive.files.get(
    { fileId: file.id, alt: 'media' },
    { responseType: 'text' }
  );
  return { fileId: file.id, content: res.data };
}

async function writeToDrive(name, data, fileId = null) {
  const folderId = await getDataFolderId();
  const body = JSON.stringify(data, null, 2);
  const stream = Readable.from([body]);

  if (fileId) {
    await drive.files.update({
      fileId,
      media: { mimeType: 'application/json', body: stream },
    });
    return fileId;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: { mimeType: 'application/json', body: stream },
    fields: 'id',
  });
  return created.data.id;
}

/**
 * Guarda un archivo de texto plano (no JSON) en la carpeta _lumi_data.
 * Se usa para el CSV del log.
 */
export async function saveTextFile(name, content, mimeType = 'text/csv') {
  try {
    const folderId = await getDataFolderId();
    const stream = Readable.from([content]);

    // Buscar si ya existe
    const res = await drive.files.list({
      q: `'${folderId}' in parents and name='${name}' and trashed=false`,
      fields: 'files(id)',
    });

    if (res.data.files.length > 0) {
      // Actualizar
      await drive.files.update({
        fileId: res.data.files[0].id,
        media: { mimeType, body: stream },
      });
    } else {
      // Crear
      await drive.files.create({
        requestBody: {
          name,
          parents: [folderId],
          mimeType,
        },
        media: { mimeType, body: stream },
        fields: 'id',
      });
    }
    return true;
  } catch (err) {
    console.error(`Error guardando ${name}:`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════

export async function loadData(name, defaultValue) {
  if (cache.has(name)) return cache.get(name).data;

  console.log(`⬇️  Cargando ${name} desde Drive...`);
  const result = await readFromDrive(name);
  let data, fileId;

  if (result) {
    data = JSON.parse(result.content);
    fileId = result.fileId;
    console.log(`✅ ${name} cargado`);
  } else {
    data = defaultValue;
    fileId = null;
    console.log(`📝 ${name} no existe, usando default`);
  }

  cache.set(name, { data, dirty: false, fileId });
  return data;
}

export function getCached(name) {
  const entry = cache.get(name);
  if (!entry) throw new Error(`Data "${name}" no cargada. ¿Llamaste a loadData?`);
  return entry.data;
}

export function setData(name, data) {
  const entry = cache.get(name);
  if (!entry) throw new Error(`Data "${name}" no cargada`);
  entry.data = data;
  entry.dirty = true;
  scheduleSync();
}

export async function mutate(name, mutatorFn) {
  const entry = cache.get(name);
  if (!entry) throw new Error(`Data "${name}" no cargada`);
  const result = await mutatorFn(entry.data);
  entry.data = result ?? entry.data;
  entry.dirty = true;
  scheduleSync();
  return entry.data;
}

// ─── Sincronización con Drive ─────────────────────────
function scheduleSync() {
  if (syncTimer) return;
  syncTimer = setTimeout(flush, 2000);
}

export async function flush() {
  if (isSyncing) return;
  isSyncing = true;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  try {
    for (const [name, entry] of cache.entries()) {
      if (!entry.dirty) continue;
      try {
        const newFileId = await writeToDrive(name, entry.data, entry.fileId);
        entry.fileId = newFileId;
        entry.dirty = false;
        console.log(`💾 ${name} → Drive OK`);
      } catch (err) {
        console.error(`❌ Error sincronizando ${name}:`, err.message);
      }
    }
  } finally {
    isSyncing = false;
  }
}

// Sync automático cada 30 seg
setInterval(() => flush().catch(() => {}), 30000);

// Sync al apagar
const shutdown = async () => {
  console.log('🛑 Cerrando, sincronizando datos...');
  await flush().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);