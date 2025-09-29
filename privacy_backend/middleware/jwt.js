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

/**
 * Middleware: optionalAuth
 * ------------------------
 * - Like requireAuth, but allows requests without token
 * - Used for extension read-only endpoints that validate via ext_user_id
 * - If token present and valid, attaches req.user
 * - If no token or invalid, continues without req.user
 */
function optionalAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    // No token provided - continue without authentication
    return next();
  }

  try {
    // Token provided - verify and attach user if valid
    req.user = JWTService.verifyToken(token);
    return next();
  } catch {
    // Invalid token - continue without authentication (don't block the request)
    return next();
  }
}

module.exports = { requireAuth, optionalAuth };