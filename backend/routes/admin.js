import express from 'express';
import {
  listAllUsers,
  adminResetPassword,
  adminUpdateQuota,
  adminUpdateRole,
  adminDeleteUser,
} from '../services/users.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as us from '../services/userSongs.js';
import * as pl from '../services/playlists.js';
import { logEvent } from '../services/accessLog.js';

const router = express.Router();

// Todas las rutas de admin requieren auth + rol admin
router.use(requireAuth);
router.use(requireAdmin);

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    ''
  );
}

// ─── Listar todos los usuarios ────────────────────────
router.get('/users', async (req, res) => {
  try {
    res.json(await listAllUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Resetear contraseña ──────────────────────────────
router.post('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;
  try {
    await adminResetPassword(req.params.id, newPassword);
    await logEvent({
      userId: req.user.userId,
      username: req.user.username,
      event: 'admin-reset-password',
      meta: { targetUserId: req.params.id, ip: getClientIp(req) },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Actualizar cuota ─────────────────────────────────
router.put('/users/:id/quota', async (req, res) => {
  const { quota } = req.body;
  try {
    const updated = await adminUpdateQuota(req.params.id, quota);
    await logEvent({
      userId: req.user.userId,
      username: req.user.username,
      event: 'admin-update-quota',
      meta: { targetUserId: req.params.id, newQuota: quota, ip: getClientIp(req) },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Cambiar rol ──────────────────────────────────────
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  try {
    const updated = await adminUpdateRole(req.params.id, role);
    await logEvent({
      userId: req.user.userId,
      username: req.user.username,
      event: 'admin-update-role',
      meta: { targetUserId: req.params.id, newRole: role, ip: getClientIp(req) },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Eliminar usuario (y sus playlists + asociaciones) ─
router.delete('/users/:id', async (req, res) => {
  try {
    const targetId = req.params.id;

    // No permitir auto-eliminarse
    if (targetId === req.user.userId) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }

    // 1. Eliminar playlists del usuario
    const userPlaylists = await pl.listPlaylists(targetId);
    for (const p of userPlaylists) {
      await pl.deletePlaylist(targetId, p.id).catch(() => {});
    }

    // 2. Eliminar sus asociaciones de canciones sueltas
    const fileIds = us.getUserFileIds(targetId);
    for (const fileId of fileIds) {
      await us.removeUserSong(targetId, fileId).catch(() => {});
    }

    // 3. Eliminar el usuario
    const deleted = await adminDeleteUser(targetId);

    await logEvent({
      userId: req.user.userId,
      username: req.user.username,
      event: 'admin-delete-user',
      meta: {
        targetUserId: targetId,
        targetUsername: deleted?.username,
        ip: getClientIp(req),
      },
    });

    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;