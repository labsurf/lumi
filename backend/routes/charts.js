import express from 'express';
import { getChart, listSources } from '../services/charts.js';
import { downloadAndUpload, probeYoutube, normalizeKey } from '../services/ytDlp.js';
import { drive } from '../services/auth.js';
import pLimit from 'p-limit';

const router = express.Router();
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ─── Listar fuentes disponibles ────────────────────────
router.get('/sources', (req, res) => {
  res.json(listSources());
});

// ─── Ver un chart específico ───────────────────────────
router.get('/', async (req, res) => {
  const sourceId = req.query.source || 'billboard-hot-100';
  try {
    const tracks = await getChart(sourceId);
    res.json({ source: sourceId, count: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Descargar N canciones de un chart ─────────────────
router.post('/download', async (req, res) => {
  const sourceId = req.body.source || 'billboard-hot-100';
  const limit = Math.min(parseInt(req.body.limit || 10, 10), 100);
  const concurrency = Math.min(parseInt(req.body.concurrency || 2, 10), 4);

  try {
    const tracks = await getChart(sourceId);
    const subset = tracks.slice(0, limit);

    if (subset.length === 0) {
      return res.status(400).json({ error: 'La fuente devolvió un chart vacío' });
    }

    res.json({
      ok: true,
      source: sourceId,
      queued: subset.length,
      message: `Descargando ${subset.length} canciones en background (concurrencia ${concurrency}).`,
    });

    const run = pLimit(concurrency);
    const results = { ok: [], failed: [], skipped: [] };

    // 👇 Guardamos los promises para poder esperarlos después
    const promises = subset.map((track) =>
      run(async () => {
        try {
          const probe = await probeYoutube(track.query).catch(() => null);

          if (probe) {
            const existing = await drive.files.list({
              q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
              fields: 'files(id, name, properties)',
            });
            const targetKey = normalizeKey(probe.displayName);
            const dup = existing.data.files.find((f) => {
              const fKey = f.properties?.normKey;
              return (fKey && fKey === targetKey) ||
                     normalizeKey(f.name) === targetKey;
            });

            if (dup) {
              console.log(`⏭️  Ya existe: ${probe.displayName}`);
              results.skipped.push(track.displayName);
              return;
            }
          }

          await downloadAndUpload(track.query, track.displayName, sourceId);
          results.ok.push(track.displayName);
          console.log(
            `[${results.ok.length + results.failed.length + results.skipped.length}/${subset.length}] ✅ ${track.displayName}`
          );
        } catch (err) {
          results.failed.push({ track: track.displayName, error: err.message });
          console.error(`❌ Falló "${track.displayName}": ${err.message}`);
        }
      })
    );

    // 👇 Aquí se espera que TODAS terminen y se imprime el resumen
    Promise.all(promises).then(() => {
      console.log('\n═══════════════════════════════════════');
      console.log(`🏁 Descarga de chart terminada (${sourceId})`);
      console.log(`   ✅ Descargadas: ${results.ok.length}`);
      console.log(`   ⏭️  Ya existían: ${results.skipped.length}`);
      console.log(`   ❌ Fallidas:    ${results.failed.length}`);
      if (results.failed.length > 0) {
        console.log('   Fallos:');
        results.failed.forEach((f) => console.log(`      - ${f.track}: ${f.error}`));
      }
      console.log('═══════════════════════════════════════\n');
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

export default router;