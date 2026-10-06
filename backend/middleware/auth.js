import { verifyToken, getUserById } from '../services/users.js';

/**
 * Middleware que exige un JWT válido en el header Authorization: Bearer <token>.
 * Consulta el usuario actual en la DB para reflejar cambios de rol en caliente.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autorizado (falta token)' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // 👇 Leer usuario actual del DB para reflejar cambios de rol sin re-login
  try {
    const user = await getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'Usuario no existe' });
    }

    req.user = {
      userId: user.id,
      username: user.username,
      role: user.role || 'user',
    };
    next();
  } catch (err) {
    console.error('Error en requireAuth:', err.message);
    return res.status(500).json({ error: 'Error verificando usuario' });
  }
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

/**
 * Middleware que exige rol admin. Debe usarse después de requireAuth.
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo admins pueden acceder' });
  }
  next();
}