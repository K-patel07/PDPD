// privacy_backend/middleware/jwt.js
const JWTService = require('../services/jwtService');

/**
 * Middleware: requireAuth
 * -----------------------
 * - Looks for Authorization: Bearer <token>
 * - Verifies JWT using JWTService
 * - Attaches decoded payload to req.user if valid
 * - Sends 401 Unauthorized if missing/invalid/expired
 */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, message: 'Missing token' });
  }

  try {
    // decoded payload → e.g. { sub, email, iat, exp }
    req.user = JWTService.verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };