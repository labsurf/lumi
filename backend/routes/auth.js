import express from 'express';
import { registerUser, loginUser, getUserById } from '../services/users.js';
import { requireAuth } from '../middleware/auth.js';
import * as pl from '../services/playlists.js';
import { logRegister, logLogin } from '../services/accessLog.js';

const router = express.Router();

// ─── Registro ─────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await registerUser(username, password);
    console.log(`🆕 Nuevo usuario: ${user.username}`);

    // Crear playlist base
    await pl.createBasePlaylistForUser(user.id, user.username);

    // Log
    await logRegister(user.id, user.username);

    // Login automático
    const { token } = await loginUser(username, password);
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Login ────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await loginUser(username, password);
    console.log(`🔑 Login: ${result.user.username}`);
    await logLogin(result.user.id, result.user.username, true);
    res.json({ ok: true, ...result });
  } catch (err) {
    await logLogin(null, username, false);
    res.status(401).json({ error: err.message });
  }
});

// ─── Perfil actual ────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(user);
});

export default router;