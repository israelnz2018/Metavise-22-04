/**
 * Biblioteca GLOBAL de enquadramentos de avatar (Firestore CRUD).
 *
 * Cada user tem uma subcollection em users/{uid}/framingLibrary/{id}. É
 * opt-in: só entram aqui os enquadramentos que o user salvou com um nome.
 * Acessível de QUALQUER projeto/subprojeto — escolhe um preset e ele já
 * vem calibrado (crop, split, PiP, proporção), igual pra qualquer vídeo.
 * Espelha o padrão de musicLibrary.ts / personalCopyLibrary.ts.
 */
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp, query } from 'firebase/firestore';
import { db } from './firebase';
import type { AvatarFraming } from '@/components/AvatarFramingModal';

const COL_NAME = 'framingLibrary';

export interface SavedFraming extends AvatarFraming {
  id: string;
  label: string;
  createdAt: string;
}

/** Lista todos os enquadramentos salvos pelo user, mais novos primeiro. */
export async function loadFramingLibrary(uid: string): Promise<SavedFraming[]> {
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, 'users', uid, COL_NAME)));
    const list: SavedFraming[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({
        id: d.id,
        label: data.label || 'Enquadramento',
        splitCX: Number(data.splitCX ?? 0.5),
        splitCY: Number(data.splitCY ?? 0.4),
        splitSize: Number(data.splitSize ?? 1),
        splitRatio: Number(data.splitRatio ?? 0.5),
        pipCX: Number(data.pipCX ?? 0.5),
        pipCY: Number(data.pipCY ?? 0.28),
        pipSize: Number(data.pipSize ?? 0.72),
        cropL: Number(data.cropL ?? 0),
        cropR: Number(data.cropR ?? 0),
        cropT: Number(data.cropT ?? 0),
        cropB: Number(data.cropB ?? 0),
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || '',
      });
    });
    return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch (err) {
    console.warn('[loadFramingLibrary] failed:', err);
    return [];
  }
}

/** Salva o enquadramento atual na biblioteca global, com um nome. */
export async function addToFramingLibrary(
  uid: string,
  label: string,
  framing: AvatarFraming
): Promise<string> {
  if (!uid) throw new Error('user id obrigatório');
  const id = `fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ref = doc(db, 'users', uid, COL_NAME, id);
  await setDoc(ref, {
    label: label || 'Enquadramento',
    splitCX: framing.splitCX,
    splitCY: framing.splitCY,
    splitSize: framing.splitSize,
    splitRatio: framing.splitRatio,
    pipCX: framing.pipCX,
    pipCY: framing.pipCY,
    pipSize: framing.pipSize,
    cropL: framing.cropL,
    cropR: framing.cropR,
    cropT: framing.cropT,
    cropB: framing.cropB,
    createdAt: serverTimestamp(),
  });
  return id;
}

/** Remove um enquadramento da biblioteca global. */
export async function deleteFromFramingLibrary(uid: string, id: string): Promise<void> {
  if (!uid || !id) return;
  await deleteDoc(doc(db, 'users', uid, COL_NAME, id));
}
