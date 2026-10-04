import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

import { initUsers } from './services/users.js';
import { initPlaylists } from './services/playlists.js';
import { initAccessLog } from './services/accessLog.js';

import authRouter from './routes/auth.js';
import tracksRouter from './routes/tracks.js';
import streamRouter from './routes/stream.js';
import coverRouter from './routes/cover.js';
import chartsRouter from './routes/charts.js';
import playlistsRouter from './routes/playlists.js';
import { initUserSongs } from './services/userSongs.js';
import * as us from './services/userSongs.js';
import { drive } from './services/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Cookies desde variable de entorno (Render) ───────
if (process.env.COOKIES_CONTENT) {
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  fs.writeFileSync(cookiesPath, process.env.COOKIES_CONTENT, 'utf8');
  console.log('✅ cookies.txt creado desde variable de entorno');
}

const app = express();
// Confiar en el proxy de Render para obtener la IP real del cliente
app.set('trust proxy', 1);

// ─── CORS ─────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.endsWith('.github.io')) return callback(null, true);
    if (origin.endsWith('.onrender.com')) return callback(null, true);
    callback(new Error(`CORS no permitido: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, max: 300 }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rutas públicas ───────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/stream', streamRouter);
app.use('/api/cover', coverRouter);

// ─── Rutas protegidas ─────────────────────────────────
app.use('/api/tracks', tracksRouter);
app.use('/api/charts', chartsRouter);
app.use('/api/playlists', playlistsRouter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

// ─── Migración: asociar sueltas viejas al usuario más antiguo ──
async function migrateOldSueltas() {
  try {
    const { getCached } = await import('./services/driveData.js');
    const users = getCached('users.json').users;
    if (users.length === 0) {
      console.log('📦 Sin usuarios, no hay migración');
      return;
    }

    const oldest = [...users].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    )[0];

    const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const list = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed=false and mimeType='audio/mpeg'`,
      fields: 'files(id, name, properties)',
      pageSize: 1000,
    });

    const currentIds = new Set(us.getUserFileIds(oldest.id));
    let migrated = 0;

    for (const f of list.data.files) {
      const source = f.properties?.source || 'manual';
      if (source !== 'manual') continue;
      if (currentIds.has(f.id)) continue;

      const normKey = f.properties?.normKey || '';
      await us.addUserSong(oldest.id, f.id, normKey);
      migrated++;
    }

    if (migrated > 0) {
      console.log(`🔗 Migradas ${migrated} sueltas viejas a "${oldest.username}"`);
    }
  } catch (err) {
    console.warn('Migración falló:', err.message);
  }
}

// ─── Arranque ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    console.log('\n🚀 Iniciando LuMi...\n');
    await initUsers();
    await initPlaylists();
    await initAccessLog();
    await initUserSongs();
    await migrateOldSueltas();
    console.log('');

    app.listen(PORT, () => {
      console.log(`🎵 Servidor de música activo`);
      console.log(`   → http://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('❌ Error al iniciar:', err.message);
    process.exit(1);
  }
})();