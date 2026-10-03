import express from 'express';
import { drive } from '../services/auth.js';
import { downloadAndUpload, probeYoutube, normalizeKey } from '../services/ytDlp.js';
import * as pl from '../services/playlists.js';

const router = express.Router();
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ─── Listar todas las canciones ────────────────────────
router.get('/', async (req, res) => {
  try {
    const filterSource = req.query.source;
    const filterPlaylist = req.query.playlist;

    const list = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
      fields: 'files(id, name, size, createdTime, properties)',
      orderBy: 'createdTime desc',
    });

    const memberships = await pl.getMembershipsMap();

    let tracks = list.data.files.map((f) => {
      const coverId = f.properties?.coverId || null;
      return {
        id: f.id,
        name: f.name.replace(/\.mp3$/i, ''),
        size: parseInt(f.size || 0, 10),
        createdAt: f.createdTime,
        source: f.properties?.source || 'manual',
        playlists: memberships[f.id] || [],
        coverUrl: coverId ? `/api/cover/${coverId}` : null,
        streamUrl: `/api/stream/${f.id}`,
      };
    });

    if (filterSource && filterSource !== 'all') {
      tracks = tracks.filter((t) => t.source === filterSource);
    }
    if (filterPlaylist && filterPlaylist !== 'all') {
      tracks = tracks.filter((t) => t.playlists.includes(filterPlaylist));
    }

    res.json(tracks);
  } catch (err) {
    console.error('Error listando tracks:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Descargar con pre-check de duplicados ─────────────
router.post('/download', async (req, res) => {
  const { query, source } = req.body;
  if (!query) return res.status(400).json({ error: 'Falta el parámetro "query"' });

  try {
    // 1. Consultar YouTube (rápido, sin descargar) para saber el nombre final
    console.log(`🔍 Pre-check: "${query}"`);
    const probe = await probeYoutube(query);
    console.log(`   → Nombre detectado: "${probe.displayName}"`);

    // 2. Listar los archivos actuales en Drive y comparar
    const existing = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
      fields: 'files(id, name, properties)',
    });

    const targetKey = normalizeKey(probe.displayName);
    const duplicate = existing.data.files.find((f) => {
      // 2a. Comparar por normKey guardada en properties (rápido y exacto)
      const fKey = f.properties?.normKey;
      if (fKey && fKey === targetKey) return true;
      // 2b. Fallback: comparar por nombre de archivo normalizado (para archivos viejos)
      return normalizeKey(f.name) === targetKey;
    });

    if (duplicate) {
      console.log(`⚠️  Duplicado detectado: ${duplicate.name}`);
      return res.status(409).json({
        error: 'duplicate',
        message: `"${probe.displayName}" ya está en tu biblioteca`,
        existing: {
          id: duplicate.id,
          name: duplicate.name.replace(/\.mp3$/i, ''),
        },
      });
    }

    // 3. No es duplicado → descargar de verdad
    const file = await downloadAndUpload(query, undefined, source || 'manual');
    res.json({ ok: true, file });
  } catch (err) {
    console.error('Error descargando:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Eliminar canción + portada + membresías ───────────
router.delete('/:id', async (req, res) => {
  try {
    const file = await drive.files.get({
      fileId: req.params.id,
      fields: 'properties',
    });
    const coverId = file.data.properties?.coverId;

    await drive.files.delete({ fileId: req.params.id });
    if (coverId) {
      await drive.files.delete({ fileId: coverId }).catch((err) => {
        console.warn(`⚠️  No se pudo borrar la portada: ${err.message}`);
      });
    }
    await pl.removeTrackFromAllPlaylists(req.params.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;