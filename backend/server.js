import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

import { initUsers, promoteAdminsFromEnv } from './services/users.js';
import { initPlaylists } from './services/playlists.js';
import { initAccessLog } from './services/accessLog.js';
import { initUserSongs } from './services/userSongs.js';
import authRouter from './routes/auth.js';
import tracksRouter from './routes/tracks.js';
import streamRouter from './routes/stream.js';
import coverRouter from './routes/cover.js';
import chartsRouter from './routes/charts.js';
import playlistsRouter from './routes/playlists.js';
import adminRouter from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Cookies desde variable de entorno (Render) ───────
if (process.env.COOKIES_CONTENT) {
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  fs.writeFileSync(cookiesPath, process.env.COOKIES_CONTENT, 'utf8');
  console.log('✅ cookies.txt creado desde variable de entorno');
}

const app = express();

// Confiar en el proxy de Render para obtener la IP real
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
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: Date.now() });
});

// ─── Arranque ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    console.log('\n🚀 Iniciando LuMi...\n');
    await initUsers();
    await promoteAdminsFromEnv();
    await initPlaylists();
    await initAccessLog();
    await initUserSongs();
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