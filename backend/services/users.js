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
// ─── Admin: bootstrap desde env ───────────────────────
export async function promoteAdminsFromEnv() {
  const list = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (list.length === 0) return;

  let changed = 0;
  await mutate(DATA_FILE, (d) => {
    for (const name of list) {
      const u = d.users.find((x) => x.username === name);
      if (u && u.role !== 'admin') {
        u.role = 'admin';
        changed++;
      }
    }
    return d;
  });
  if (changed > 0) console.log(`👑 ${changed} usuario(s) promovidos a admin`);
}

// ─── Admin: listar todos los usuarios ─────────────────
export async function listAllUsers() {
  return users().map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role || 'user',
    downloadCount: u.downloadCount,
    downloadQuota: u.downloadQuota,
    createdAt: u.createdAt,
  }));
}

// ─── Admin: resetear contraseña ───────────────────────
export async function adminResetPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('La contraseña debe tener al menos 4 caracteres');
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await mutate(DATA_FILE, (d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u) throw new Error('Usuario no encontrado');
    u.passwordHash = hash;
    return d;
  });
}

// ─── Admin: actualizar cuota ──────────────────────────
export async function adminUpdateQuota(userId, newQuota) {
  const quota = parseInt(newQuota, 10);
  if (isNaN(quota) || quota < 0) throw new Error('Cuota inválida');
  await mutate(DATA_FILE, (d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u) throw new Error('Usuario no encontrado');
    u.downloadQuota = quota;
    return d;
  });
  return await getUserById(userId);
}

// ─── Admin: cambiar rol ───────────────────────────────
export async function adminUpdateRole(userId, newRole) {
  if (!['user', 'admin'].includes(newRole)) throw new Error('Rol inválido');
  await mutate(DATA_FILE, (d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u) throw new Error('Usuario no encontrado');
    u.role = newRole;
    return d;
  });
  return await getUserById(userId);
}

// ─── Admin: eliminar usuario ──────────────────────────
export async function adminDeleteUser(userId) {
  let deleted = null;
  await mutate(DATA_FILE, (d) => {
    const u = d.users.find((x) => x.id === userId);
    if (!u) throw new Error('Usuario no encontrado');
    deleted = { username: u.username };
    d.users = d.users.filter((x) => x.id !== userId);
    return d;
  });
  return deleted;
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