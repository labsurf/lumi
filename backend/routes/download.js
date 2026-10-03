import express from 'express';
import { getBillboardHot100 } from '../services/charts.js';
import { downloadAndUpload } from '../services/ytDlp.js';
import pLimit from 'p-limit';

const router = express.Router();

router.get('/billboard', async (req, res) => {
  try {
    const tracks = await getBillboardHot100();
    res.json({ source: 'billboard-hot-100', count: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/billboard/download', async (req, res) => {
  const limit = Math.min(parseInt(req.body.limit || 10, 10), 100);
  const concurrency = Math.min(parseInt(req.body.concurrency || 2, 10), 4);

  try {
    const tracks = await getBillboardHot100();
    const subset = tracks.slice(0, limit);

    res.json({
      ok: true,
      queued: subset.length,
      message: `Descargando ${subset.length} canciones en background (concurrencia ${concurrency}). Revisa la consola del servidor.`,
    });

    const run = pLimit(concurrency);
    const results = { ok: [], failed: [] };

    subset.forEach((track) => {
      run(async () => {
        try {
          await downloadAndUpload(track.query, track.displayName);
          results.ok.push(track.displayName);
          console.log(`[${results.ok.length}/${subset.length}] ✅ ${track.displayName}`);
        } catch (err) {
          results.failed.push({ track: track.displayName, error: err.message });
          console.error(`❌ Falló "${track.displayName}": ${err.message}`);
        }
      });
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

export default router;