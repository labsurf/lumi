import crypto from 'crypto';
import { loadData, mutate, getCached } from './driveData.js';
import { drive } from './auth.js';

const DATA_FILE = 'playlists.json';
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ─── Bootstrap ────────────────────────────────────────
export async function initPlaylists() {
  await loadData(DATA_FILE, { playlists: [], memberships: {} });
  console.log('📚 Playlists cargadas');
}

// ─── Helpers ──────────────────────────────────────────
function data() {
  return getCached(DATA_FILE);
}

// ─── Listar playlists de un usuario ───────────────────
export async function listPlaylists(userId) {
  const d = data();
  const counts = {};
  for (const plIds of Object.values(d.memberships)) {
    for (const id of plIds) counts[id] = (counts[id] || 0) + 1;
  }
  return d.playlists
    .filter((p) => p.userId === userId)
    .map((p) => ({ ...p, count: counts[p.id] || 0 }));
}

// ─── Crear playlist ───────────────────────────────────
export async function createPlaylist(userId, name) {
  const pl = {
    id: crypto.randomUUID(),
    userId,
    name,
    createdAt: new Date().toISOString(),
  };
  await mutate(DATA_FILE, (d) => {
    d.playlists.push(pl);
    return d;
  });
  return pl;
}

// ─── Borrar playlist ──────────────────────────────────
export async function deletePlaylist(userId, id) {
  const d = data();
  const pl = d.playlists.find((p) => p.id === id);
  if (!pl || pl.userId !== userId) throw new Error('Playlist no encontrada');

  await mutate(DATA_FILE, (d) => {
    d.playlists = d.playlists.filter((p) => p.id !== id);
    for (const fileId of Object.keys(d.memberships)) {
      d.memberships[fileId] = d.memberships[fileId].filter((pid) => pid !== id);
      if (d.memberships[fileId].length === 0) delete d.memberships[fileId];
    }
    return d;
  });
}

// ─── Añadir track a playlist ──────────────────────────
export async function addTrackToPlaylist(userId, playlistId, fileId) {
  const d = data();
  const pl = d.playlists.find((p) => p.id === playlistId);
  if (!pl || pl.userId !== userId) throw new Error('Playlist no encontrada');

  await mutate(DATA_FILE, (d) => {
    if (!d.memberships[fileId]) d.memberships[fileId] = [];
    if (!d.memberships[fileId].includes(playlistId)) {
      d.memberships[fileId].push(playlistId);
    }
    return d;
  });
}

// ─── Quitar track de playlist ─────────────────────────
export async function removeTrackFromPlaylist(userId, playlistId, fileId) {
  const d = data();
  const pl = d.playlists.find((p) => p.id === playlistId);
  if (!pl || pl.userId !== userId) throw new Error('Playlist no encontrada');

  await mutate(DATA_FILE, (d) => {
    if (d.memberships[fileId]) {
      d.memberships[fileId] = d.memberships[fileId].filter((pid) => pid !== playlistId);
      if (d.memberships[fileId].length === 0) delete d.memberships[fileId];
    }
    return d;
  });
}

// ─── Obtener membresías filtradas por usuario ─────────
export async function getMembershipsMap(userId) {
  const d = data();
  const userPlaylistIds = new Set(
    d.playlists.filter((p) => p.userId === userId).map((p) => p.id)
  );
  const result = {};
  for (const [fileId, plIds] of Object.entries(d.memberships)) {
    const filtered = plIds.filter((id) => userPlaylistIds.has(id));
    if (filtered.length > 0) result[fileId] = filtered;
  }
  return result;
}

// ─── Quitar track de todas las playlists ──────────────
export async function removeTrackFromAllPlaylists(fileId) {
  await mutate(DATA_FILE, (d) => {
    delete d.memberships[fileId];
    return d;
  });
}

// ─── Crear playlist base al registrarse ───────────────
export async function createBasePlaylistForUser(userId, username) {
  try {
    const d = data();
    if (d.playlists.find((p) => p.userId === userId)) return null;

    const basePlaylist = {
      id: crypto.randomUUID(),
      userId,
      name: `Base · ${username}`,
      isBase: true,
      createdAt: new Date().toISOString(),
    };

    // Listar canciones de Drive (las que NO son 'manual')
    const list = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
      fields: 'files(id, properties)',
      pageSize: 1000,
    });

    const chartFiles = (list.data.files || []).filter((f) => {
      const src = f.properties?.source || 'manual';
      return src !== 'manual';
    });

    await mutate(DATA_FILE, (d) => {
      d.playlists.push(basePlaylist);
      for (const f of chartFiles) {
        if (!d.memberships[f.id]) d.memberships[f.id] = [];
        if (!d.memberships[f.id].includes(basePlaylist.id)) {
          d.memberships[f.id].push(basePlaylist.id);
        }
      }
      return d;
    });

    console.log(`📚 Playlist base creada para ${username}: ${chartFiles.length} canciones`);
    return { ...basePlaylist, count: chartFiles.length };
  } catch (err) {
    console.error('Error creando playlist base:', err.message);
    return null;
  }
}