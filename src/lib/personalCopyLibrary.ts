/**
 * UX18 — Personal Copy Library (Firestore CRUD)
 *
 * Cada user tem uma subcollection em users/{uid}/copyLibrary/{copyId}.
 * O algoritmo de seleção em selectCopyExamples (copyLibrary.ts) já aceita
 * clientLibrary como parâmetro — esse modulo só plumba o Firestore.
 *
 * Schema do documento:
 *   id          (string, doc id)
 *   vertical    ('saude' | 'emagrecimento' | etc)
 *   awareness   ('1'..'5')
 *   angle       (string curto, livre)
 *   language    ('pt' | 'en')
 *   script      (string, a copy completa)
 *   whyItWorks  (string opcional — anotação do user)
 *   starred     (boolean, "favoritado" entra com prioridade ainda maior)
 *   source      ('manual' | 'auto-from-generated')
 *   createdAt   (Date)
 */

import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { CopyExample, CopyVertical, AwarenessLevel } from '@/data/copyLibrary';

export interface PersonalCopyDoc extends CopyExample {
  /** UX20: nome opcional dado pelo user ("Copy 1", "Hook do podcast", etc).
   *  Quando ausente, UI mostra "Copy #N" baseado em ordem de criação. */
  name?: string;
  starred?: boolean;
  source: 'manual' | 'auto-from-generated';
  createdAt: Date | null;
}

const COL_NAME = 'copyLibrary';

/** Lista todas as copies do user, ordenadas por starred → createdAt desc. */
export async function loadPersonalLibrary(uid: string): Promise<PersonalCopyDoc[]> {
  if (!uid) return [];
  try {
    const q = query(collection(db, 'users', uid, COL_NAME), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list: PersonalCopyDoc[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      list.push({
        id: d.id,
        name: typeof data.name === 'string' ? data.name : undefined,
        vertical: (data.vertical || 'fisico') as CopyVertical,
        awareness: (data.awareness || '3') as AwarenessLevel,
        angle: data.angle || '',
        language: data.language === 'en' ? 'en' : 'pt',
        script: data.script || '',
        whyItWorks: data.whyItWorks || '',
        starred: !!data.starred,
        source: data.source === 'auto-from-generated' ? 'auto-from-generated' : 'manual',
        createdAt: data.createdAt?.toDate?.() || null,
      });
    });
    // Re-sort: starred primeiro, depois createdAt desc
    return list.sort((a, b) => {
      if ((b.starred ? 1 : 0) !== (a.starred ? 1 : 0)) {
        return (b.starred ? 1 : 0) - (a.starred ? 1 : 0);
      }
      const aT = a.createdAt?.getTime() || 0;
      const bT = b.createdAt?.getTime() || 0;
      return bT - aT;
    });
  } catch (err) {
    console.warn('[loadPersonalLibrary] failed:', err);
    return [];
  }
}

/** Adiciona uma copy nova. Retorna o id criado. */
export async function addToPersonalLibrary(
  uid: string,
  input: Omit<PersonalCopyDoc, 'id' | 'createdAt'>
): Promise<string> {
  if (!uid) throw new Error('user id obrigatório');
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ref = doc(db, 'users', uid, COL_NAME, id);
  // UX20: strip undefined — Firestore rejeita campos undefined
  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) sanitized[k] = v;
  }
  await setDoc(ref, {
    ...sanitized,
    createdAt: serverTimestamp(),
  });
  return id;
}

/** Marca/desmarca favorito. */
export async function toggleStarPersonalCopy(
  uid: string,
  copyId: string,
  starred: boolean
): Promise<void> {
  if (!uid || !copyId) return;
  const ref = doc(db, 'users', uid, COL_NAME, copyId);
  await updateDoc(ref, { starred });
}

/** Deleta uma copy. */
export async function deletePersonalCopy(uid: string, copyId: string): Promise<void> {
  if (!uid || !copyId) return;
  const ref = doc(db, 'users', uid, COL_NAME, copyId);
  await deleteDoc(ref);
}
