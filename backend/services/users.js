import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { loadData, mutate, getCached, flush } from './driveData.js';

const JWT_SECRET = process.env.JWT_SECRET || 'lumi-dev-secret-change-me';
const JWT_EXPIRES = '30d';
const DEFAULT_QUOTA = parseInt(process.env.DEFAULT_DOWNLOAD_QUOTA || '50', 10);
const DATA_FILE = 'users.json';

// ─── Bootstrap ────────────────────────────────────────
export async function initUsers() {
  await loadData(DATA_FILE, { users: [] });
  console.log(`👥 Usuarios cargados (cuota default: ${DEFAULT_QUOTA})`);
}

// ─── Helpers ──────────────────────────────────────────
function users() {
  return getCached(DATA_FILE).users;
}

// ─── Registro ─────────────────────────────────────────
export async function registerUser(username, password) {
  const clean = (username || '').trim().toLowerCase();
  if (clean.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres');
  if (!/^[a-z0-9_\-]+$/.test(clean)) throw new Error('Solo letras, números, "_" y "-"');
  if (!password || password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');

  if (users().find((u) => u.username === clean)) {
    throw new Error('Ese usuario ya existe');
  }

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    username: clean,
    passwordHash: hash,
    downloadCount: 0,
    downloadQuota: DEFAULT_QUOTA,
    role: 'user',
    createdAt: new Date().toISOString(),
  };

  await mutate(DATA_FILE, (data) => {
    data.users.push(user);
    return data;
  });

  return {
    id: user.id,
    username: user.username,
    downloadCount: 0,
    downloadQuota: DEFAULT_QUOTA,
    role: user.role,
  };
}

// ─── Login ────────────────────────────────────────────
export async function loginUser(username, password) {
  const clean = (username || '').trim().toLowerCase();
  const user = users().find((u) => u.username === clean);
  if (!user) throw new Error('Usuario o contraseña incorrectos');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Usuario o contraseña incorrectos');

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      downloadCount: user.downloadCount,
      downloadQuota: user.downloadQuota,
      role: user.role || 'user',
    },
  };
}

// ─── Verificar token ──────────────────────────────────
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Obtener usuario ──────────────────────────────────
export async function getUserById(id) {
  const user = users().find((u) => u.id === id);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    downloadCount: user.downloadCount,
    downloadQuota: user.downloadQuota,
    role: user.role || 'user',
  };
}

// ─── Cuota ────────────────────────────────────────────
export async function checkQuota(userId, amount = 1) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Usuario no encontrado');
  const remaining = user.downloadQuota - user.downloadCount;
  if (remaining < amount) {
    throw new Error(`Cuota agotada. Tienes ${remaining} descargas restantes de ${user.downloadQuota}.`);
  }
  return { remaining, quota: user.downloadQuota, used: user.downloadCount };
}

export async function incrementDownloadCount(userId, amount = 1) {
  let result = null;
  await mutate(DATA_FILE, (data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuario no encontrado');
    user.downloadCount += amount;
    result = {
      downloadCount: user.downloadCount,
      downloadQuota: user.downloadQuota,
      remaining: user.downloadQuota - user.downloadCount,
    };
    return data;
  });
  return result;
}

export const QUOTA = DEFAULT_QUOTA;