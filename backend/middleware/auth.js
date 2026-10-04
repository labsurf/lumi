import { verifyToken } from '../services/users.js';

/**
 * Middleware que exige un JWT válido en el header Authorization: Bearer <token>.
 * Si es válido, setea req.user = { userId, username, role }.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autorizado (falta token)' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  req.user = {
    userId: payload.userId,
    username: payload.username,
    role: payload.role || 'user',
  };
  next();
}

/**
 * Variante opcional: si hay token válido lo usa, si no, deja pasar sin user.
 */
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = {
        userId: payload.userId,
        username: payload.username,
        role: payload.role || 'user',
      };
    }
  }
  next();
}