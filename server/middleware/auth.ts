import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

// Express middleware that verifies a Firebase ID token from the
// `Authorization: Bearer <token>` header and attaches the resulting uid to
// `req.user`. Apply only to routes that need a known user (credit-cost
// operations, per-user reads). Routes without this middleware stay
// open to unauthenticated callers as before.
//
// Dev fallback: when firebase-admin isn't initialized (no Application
// Default Credentials on this Mac), the middleware accepts the request
// and uses uid='dev-user' so local development isn't blocked. This
// matches how the rest of the codebase silently degrades when Firebase
// is unavailable (Storage uploads fall back to /generated/, etc).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { uid: string };
    }
  }
}

// Dev mode: skips strict verification so local development works without
// Application Default Credentials. Triggered by either NODE_ENV !== 'production'
// or AUTH_DISABLED=1. In dev, if a Bearer token is present we still extract
// the uid (best-effort decode without signature check) so the user sees
// their real balance; otherwise we fall back to 'dev-user'.
const DEV_MODE = process.env.NODE_ENV !== 'production' || process.env.AUTH_DISABLED === '1';

function decodeJwtUidUnsafe(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64').toString('utf-8'));
    return payload.user_id || payload.sub || null;
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  const token = match?.[1];

  if (DEV_MODE) {
    // Best-effort uid from token (no signature check). Falls back to dev-user.
    const uid = token ? decodeJwtUidUnsafe(token) : null;
    req.user = { uid: uid || 'dev-user' };
    return next();
  }

  if (admin.apps.length === 0) {
    return res.status(500).json({ error: 'Server auth not configured.' });
  }
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid };
    next();
  } catch (err: any) {
    return res.status(401).json({ error: `Invalid token: ${err.message}` });
  }
}
