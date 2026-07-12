import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, setLogLevel } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Suppress backend unreachable warnings during WebChannel negotiation
setLogLevel('silent');

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
}, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);

// Anexa o token do Firebase em TODA chamada ao backend (/api/...) de forma
// central — assim os endpoints protegidos por requireAuth (na nuvem) funcionam
// sem precisar mexer em cada um dos ~70 fetch do app. Em dev o backend ignora
// o token (fica aberto), então isto é inócuo localmente. Só adiciona o header
// quando há usuário logado e a URL é do próprio backend.
if (typeof window !== 'undefined' && !(window as any).__apiAuthPatched) {
  (window as any).__apiAuthPatched = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      // Só same-origin (relativo ou mesma origem) E caminho /api/ → nunca vaza
      // o token pra hosts externos (Firebase Storage, Pexels, etc.).
      const sameOrigin = raw.startsWith('/') || raw.startsWith(window.location.origin);
      const pathname = new URL(raw, window.location.origin).pathname;
      if (sameOrigin && pathname.startsWith('/api/') && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const headers = new Headers(
          init?.headers || (input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
        init = { ...init, headers };
      }
    } catch {
      /* sem token → segue sem header (dev ignora; prod bloqueia como esperado) */
    }
    return origFetch(input, init);
  };
}
