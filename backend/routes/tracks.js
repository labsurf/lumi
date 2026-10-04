import express from 'express';
import { drive } from '../services/auth.js';
import { downloadAndUpload, probeYoutube, normalizeKey } from '../services/ytDlp.js';
import { requireAuth } from '../middleware/auth.js';
import { checkQuota, incrementDownloadCount } from '../services/users.js';
import { logDownload, logDelete } from '../services/accessLog.js';
import * as pl from '../services/playlists.js';
import * as us from '../services/userSongs.js';

const router = express.Router();
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

router.use(requireAuth);

// Helper para IP real
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    ''
  );
}

// ─── Listar tracks ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filterSource = req.query.source;
    const filterPlaylist = req.query.playlist;
    const userId = req.user.userId;

    const list = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
      fields: 'files(id, name, size, createdTime, properties)',
      orderBy: 'createdTime desc',
      pageSize: 1000,
    });

    const memberships = await pl.getMembershipsMap(userId);
    const myFileIds = new Set(us.getUserFileIds(userId));

    let tracks = list.data.files
      .map((f) => {
        const coverId = f.properties?.coverId || null;
        const source = f.properties?.source || 'manual';
        const isChart = source !== 'manual';
        const isMine = myFileIds.has(f.id);

        if (!isChart && !isMine) return null;

        return {
          id: f.id,
          name: f.name.replace(/\.mp3$/i, ''),
          size: parseInt(f.size || 0, 10),
          createdAt: f.createdTime,
          source,
          isChart,
          isMine,
          playlists: memberships[f.id] || [],
          coverUrl: coverId ? `/api/cover/${coverId}` : null,
          streamUrl: `/api/stream/${f.id}`,
        };
      })
      .filter(Boolean);

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

// ─── Descargar ────────────────────────────────────────
router.post('/download', async (req, res) => {
  const { query, source } = req.body;
  if (!query) return res.status(400).json({ error: 'Falta el parámetro "query"' });

  const isManual = !source || source === 'manual';
  const ip = getClientIp(req);

  try {
    console.log(`🔍 Pre-check: "${query}" por ${req.user.username}`);
    const probe = await probeYoutube(query);
    const normKey = normalizeKey(probe.displayName);
    console.log(`   → Nombre detectado: "${probe.displayName}"`);

    const list = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
      fields: 'files(id, name, size, properties)',
      pageSize: 1000,
    });

    const existing = list.data.files.find((f) => {
      const fKey = f.properties?.normKey;
      return (fKey && fKey === normKey) || normalizeKey(f.name) === normKey;
    });

    // ─── CASO A: ya existe ─────────────────────────────
    if (existing) {
      const existingSource = existing.properties?.source || 'manual';
      const isChart = existingSource !== 'manual';

      if (isChart) {
        return res.status(409).json({
          error: 'duplicate',
          message: `"${probe.displayName}" ya está en tu biblioteca`,
        });
      }

      if (us.hasUserSong(req.user.userId, existing.id)) {
        return res.status(409).json({
          error: 'duplicate',
          message: `"${probe.displayName}" ya está en tu biblioteca`,
        });
      }

      console.log(`♻️  Reutilizando archivo existente: ${existing.name}`);
      await checkQuota(req.user.userId, 1);
      await us.addUserSong(req.user.userId, existing.id, normKey);
      const quota = await incrementDownloadCount(req.user.userId, 1);

      await logDownload(
        req.user.userId,
        req.user.username,
        existing.name,
        'manual',
        quota.remaining,
        ip
      );

      return res.json({
        ok: true,
        reused: true,
        file: { id: existing.id, name: existing.name.replace(/\.mp3$/i, '') },
        quota,
      });
    }

    // ─── CASO B: descargar de YouTube ──────────────────
    console.log(`🆕 Descargando de YouTube: "${query}"`);

    if (isManual) {
      await checkQuota(req.user.userId, 1);
    }

    const downloaded = await downloadAndUpload(query, probe.displayName, source || 'manual');

    let quota = null;
    if (isManual) {
      await us.addUserSong(req.user.userId, downloaded.id, normKey);
      quota = await incrementDownloadCount(req.user.userId, 1);
    }

    await logDownload(
      req.user.userId,
      req.user.username,
      downloaded.name,
      source || 'manual',
      quota ? quota.remaining : 'chart',
      ip
    );

    res.json({
      ok: true,
      reused: false,
      file: downloaded,
      quota,
    });
  } catch (err) {
    console.error('Error descargando:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ─── Eliminar ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const fileId = req.params.id;
  const userId = req.user.userId;
  const ip = getClientIp(req);

  try {
    const file = await drive.files.get({
      fileId,
      fields: 'name, properties',
    });
    const coverId = file.data.properties?.coverId;
    const source = file.data.properties?.source || 'manual';

    if (source === 'manual') {
      const removed = await us.removeUserSong(userId, fileId);
      if (!removed) {
        return res.status(403).json({ error: 'No tienes esta canción en tu biblioteca' });
      }
      await pl.removeTrackFromAllPlaylists(fileId);

      const stillUsedBy = us.getUsersForFile(fileId);
      if (stillUsedBy.length === 0) {
        console.log(`🗑️  Borrando definitivamente: ${file.data.name}`);
        await drive.files.delete({ fileId });
        if (coverId) {
          await drive.files.delete({ fileId: coverId }).catch(() => {});
        }
      } else {
        console.log(`👥 ${stillUsedBy.length} usuario(s) más conservan: ${file.data.name}`);
      }
    } else {
      await drive.files.delete({ fileId });
      if (coverId) {
        await drive.files.delete({ fileId: coverId }).catch(() => {});
      }
      await pl.removeTrackFromAllPlaylists(fileId);
      await us.removeFileFromAllUsers(fileId);
    }

    await logDelete(userId, req.user.username, fileId, file.data.name, ip);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;