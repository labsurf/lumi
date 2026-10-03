import express from 'express';
import * as pl from '../services/playlists.js';

const router = express.Router();

// Listar todas las playlists
router.get('/', async (req, res) => {
  try {
    res.json(await pl.listPlaylists());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una playlist nueva
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  try {
    const created = await pl.createPlaylist(name.trim());
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Borrar una playlist
router.delete('/:id', async (req, res) => {
  try {
    await pl.deletePlaylist(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Añadir un track a una playlist
router.post('/:id/tracks', async (req, res) => {
  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ error: 'Falta trackId' });
  try {
    await pl.addTrackToPlaylist(req.params.id, trackId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quitar un track de una playlist
router.delete('/:id/tracks/:trackId', async (req, res) => {
  try {
    await pl.removeTrackFromPlaylist(req.params.id, req.params.trackId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;