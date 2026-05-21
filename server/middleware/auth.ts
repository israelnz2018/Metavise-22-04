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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Dev fallback when firebase-admin couldn't initialize (no creds).
  if (admin.apps.length === 0) {
    req.user = { uid: 'dev-user' };
    return next();
  }

  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token.' });
  }
  const token = match[1]!;

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid };
    next();
  } catch (err: any) {
    return res.status(401).json({ error: `Invalid token: ${err.message}` });
  }
}
