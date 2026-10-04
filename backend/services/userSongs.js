import { loadData, mutate, getCached } from './driveData.js';

const DATA_FILE = 'user-songs.json';

export async function initUserSongs() {
  await loadData(DATA_FILE, { associations: [] });
  console.log('🔗 Asociaciones usuario↔canción cargadas');
}

function data() {
  return getCached(DATA_FILE);
}

export function hasUserSong(userId, fileId) {
  return data().associations.some(a => a.userId === userId && a.fileId === fileId);
}

export function getUserFileIds(userId) {
  return data().associations.filter(a => a.userId === userId).map(a => a.fileId);
}

export function getUsersForFile(fileId) {
  return data().associations.filter(a => a.fileId === fileId).map(a => a.userId);
}

export async function addUserSong(userId, fileId, normKey) {
  if (hasUserSong(userId, fileId)) return false;
  await mutate(DATA_FILE, (d) => {
    d.associations.push({
      userId,
      fileId,
      normKey: normKey || '',
      addedAt: new Date().toISOString(),
    });
    return d;
  });
  return true;
}

export async function removeUserSong(userId, fileId) {
  let removed = false;
  await mutate(DATA_FILE, (d) => {
    const before = d.associations.length;
    d.associations = d.associations.filter(
      a => !(a.userId === userId && a.fileId === fileId)
    );
    removed = d.associations.length < before;
    return d;
  });
  return removed;
}

export async function removeFileFromAllUsers(fileId) {
  await mutate(DATA_FILE, (d) => {
    d.associations = d.associations.filter(a => a.fileId !== fileId);
    return d;
  });
}