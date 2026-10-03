import express from 'express';
import { drive } from '../services/auth.js';

const router = express.Router();

router.get('/:id', async (req, res) => {
  try {
    const range = req.headers.range;

    // Pedir el archivo a Drive, respetando el Range (para seek)
    const driveRes = await drive.files.get(
      { fileId: req.params.id, alt: 'media' },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : {},
      }
    );

    // Reenviar headers importantes
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'audio/mpeg');
    if (driveRes.headers['content-length']) {
      res.setHeader('Content-Length', driveRes.headers['content-length']);
    }
    if (driveRes.headers['content-range']) {
      res.setHeader('Content-Range', driveRes.headers['content-range']);
    }

    res.status(range ? 206 : 200);

    // Pipe: Drive → Cliente
    driveRes.data.pipe(res);

    // Si el cliente corta (cambia de canción), cancelamos la descarga
    req.on('close', () => driveRes.data.destroy());
  } catch (err) {
    console.error('Stream error:', err.message);
    res.status(500).json({ error: 'Error al hacer streaming' });
  }
});

export default router;