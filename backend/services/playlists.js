import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'playlists.json');

// ─── Init ─────────────────────────────────────────────
async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(FILE);
  } catch {
    await fs.writeFile(FILE, JSON.stringify({ playlists: [], memberships: {} }, null, 2));
  }
}

async function read() {
  await ensureFile();
  const raw = await fs.readFile(FILE, 'utf8');
  return JSON.parse(raw);
}

async function write(data) {
  await fs.writeFile(FILE, JSON.stringify(data, null, 2));
}

// ─── Playlists ────────────────────────────────────────
export async function listPlaylists() {
  const data = await read();
  const counts = {};
  for (const plIds of Object.values(data.memberships)) {
    for (const id of plIds) counts[id] = (counts[id] || 0) + 1;
  }
  return data.playlists.map((p) => ({ ...p, count: counts[p.id] || 0 }));
}

export async function createPlaylist(name) {
  const data = await read();
  const pl = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  data.playlists.push(pl);
  await write(data);
  return pl;
}

export async function deletePlaylist(id) {
  const data = await read();
  data.playlists = data.playlists.filter((p) => p.id !== id);
  for (const fileId of Object.keys(data.memberships)) {
    data.memberships[fileId] = data.memberships[fileId].filter((pid) => pid !== id);
    if (data.memberships[fileId].length === 0) delete data.memberships[fileId];
  }
  await write(data);
}

// ─── Membresías (track ↔ playlists) ───────────────────
export async function addTrackToPlaylist(playlistId, fileId) {
  const data = await read();
  if (!data.memberships[fileId]) data.memberships[fileId] = [];
  if (!data.memberships[fileId].includes(playlistId)) {
    data.memberships[fileId].push(playlistId);
  }
  await write(data);
}

export async function removeTrackFromPlaylist(playlistId, fileId) {
  const data = await read();
  if (data.memberships[fileId]) {
    data.memberships[fileId] = data.memberships[fileId].filter((pid) => pid !== playlistId);
    if (data.memberships[fileId].length === 0) delete data.memberships[fileId];
  }
  await write(data);
}

// ─── Consultas ────────────────────────────────────────
export async function getMembershipsMap() {
  const data = await read();
  return data.memberships;
}

export async function removeTrackFromAllPlaylists(fileId) {
  const data = await read();
  delete data.memberships[fileId];
  await write(data);
}