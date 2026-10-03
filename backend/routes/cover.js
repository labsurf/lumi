import express from 'express';
import { drive } from '../services/auth.js';

const router = express.Router();

router.get('/:id', async (req, res) => {
  try {
    const driveRes = await drive.files.get(
      { fileId: req.params.id, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 1 día
    if (driveRes.headers['content-length']) {
      res.setHeader('Content-Length', driveRes.headers['content-length']);
    }

    driveRes.data.pipe(res);
    req.on('close', () => driveRes.data.destroy());
  } catch (err) {
    console.error('Cover error:', err.message);
    res.status(404).send('Cover not found');
  }
});

export default router;