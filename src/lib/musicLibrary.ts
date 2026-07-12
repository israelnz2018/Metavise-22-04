/**
 * Biblioteca GLOBAL de músicas (Firestore CRUD).
 *
 * Cada user tem uma subcollection em users/{uid}/musicLibrary/{musicId}.
 * É opt-in: só entram aqui as músicas que o user clicou "Salvar na biblioteca".
 * Acessível de QUALQUER projeto/subprojeto — é a ferramenta de escolha.
 *
 * Guardamos só a URL da música (não o áudio). Deletar daqui remove a
 * referência, nunca o arquivo físico — a mesma URL pode estar em uso num
 * subprojeto. Espelha o padrão de personalCopyLibrary.ts.
 */
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp, query } from 'firebase/firestore';
import { db } from './firebase';
import type { MusicTrack } from '@/types/project';

const COL_NAME = 'musicLibrary';

/** Lista todas as músicas salvas pelo user, mais novas primeiro. */
export async function loadMusicLibrary(uid: string): Promise<MusicTrack[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'users', uid, COL_NAME)));
    const list: MusicTrack[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({
        id: d.id,
        url: data.url || '',
        label: data.label || data.originalFileName || data.fileName || 'Música',
        source: data.source === 'upload' ? 'upload' : 'ai',
        prompt: data.prompt || undefined,
        originalFileName: data.originalFileName || undefined,
        lengthMs: typeof data.lengthMs === 'number' ? data.lengthMs : undefined,
        sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
        // serverTimestamp() vira Timestamp; normaliza pra ISO.
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || '',
      });
    });
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    console.warn('[loadMusicLibrary] failed:', err);
    return [];
  }
}

/** Salva uma música na biblioteca global. Usa o id do track como id do doc
 *  (idempotente — salvar a mesma duas vezes não duplica). */
export async function addToMusicLibrary(uid: string, track: MusicTrack): Promise<void> {
  if (!uid || !track?.url) throw new Error('user id e url obrigatórios');
  const ref = doc(db, 'users', uid, COL_NAME, track.id);
  // Firestore rejeita undefined — monta só os campos presentes.
  const payload: Record<string, any> = {
    url: track.url,
    label: track.label,
    source: track.source,
    createdAt: serverTimestamp(),
  };
  if (track.prompt !== undefined) payload.prompt = track.prompt;
  if (track.originalFileName !== undefined) payload.originalFileName = track.originalFileName;
  if (track.lengthMs !== undefined) payload.lengthMs = track.lengthMs;
  if (track.sizeBytes !== undefined) payload.sizeBytes = track.sizeBytes;
  await setDoc(ref, payload);
}

/** Remove uma música da biblioteca global (só a referência). */
export async function deleteFromMusicLibrary(uid: string, musicId: string): Promise<void> {
  if (!uid || !musicId) return;
  await deleteDoc(doc(db, 'users', uid, COL_NAME, musicId));
}
