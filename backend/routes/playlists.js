import express from 'express';
import * as pl from '../services/playlists.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

// ─── Listar playlists del usuario ─────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pl.listPlaylists(req.user.userId);
    res.json(result);
  } catch (err) {
    console.error('Error listando playlists:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Crear playlist ───────────────────────────────────
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Falta el nombre' });
  }
  try {
    const created = await pl.createPlaylist(req.user.userId, name.trim());
    res.json(created);
  } catch (err) {
    console.error('Error creando playlist:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Borrar playlist ──────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pl.deletePlaylist(req.user.userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error borrando playlist:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Añadir track a playlist ──────────────────────────
router.post('/:id/tracks', async (req, res) => {
  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ error: 'Falta trackId' });
  try {
    await pl.addTrackToPlaylist(req.user.userId, req.params.id, trackId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error añadiendo track:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Quitar track de playlist ─────────────────────────
router.delete('/:id/tracks/:trackId', async (req, res) => {
  try {
    await pl.removeTrackFromPlaylist(req.user.userId, req.params.id, req.params.trackId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error quitando track:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;