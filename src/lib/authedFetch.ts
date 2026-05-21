// Wrapper around fetch() that injects the current Firebase Auth ID
// token as `Authorization: Bearer <token>`. Use for any backend route
// behind the requireAuth middleware (/api/user/credits, /api/heygen/generate).
// Falls back to a plain fetch when the user isn't signed in.

import { auth } from './firebase';

export async function authedFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) return fetch(input, init);
  const token = await user.getIdToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
