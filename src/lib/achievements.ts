// Sistema de conquistas — inspirado no chess.com (Awards no perfil): uma
// biblioteca de marcos que o usuário desbloqueia usando o app. Guardado em
// users/{uid} (mesmo doc de credits/role) — mais um array simples, não
// justifica subcoleção própria pra ~6-20 conquistas.
import { doc, getDoc, setDoc, increment } from 'firebase/firestore';
import { toast } from 'react-hot-toast';
import { db } from './firebase';

export interface Achievement {
  id: string;
  title: string;
  description: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'primeiro_video', title: 'Primeiro vídeo', description: 'Gerou seu primeiro vídeo.' },
  {
    id: 'primeiro_audio',
    title: 'Primeira narração',
    description: 'Gerou seu primeiro áudio de voz com IA.',
  },
  {
    id: 'primeiro_criativo',
    title: 'Primeiro criativo',
    description: 'Marcou seu primeiro criativo como "no ar".',
  },
  { id: '5_videos', title: 'Maratonista', description: 'Gerou 5 vídeos.' },
  { id: '10_videos', title: 'Produção em massa', description: 'Gerou 10 vídeos.' },
  {
    id: 'primeira_venda',
    title: 'Primeira venda',
    description: 'Importou um relatório de performance com pelo menos 1 compra.',
  },
];

export interface UserAchievementsState {
  unlocked: string[];
  unlockedAt: Record<string, string>;
  videosGeneratedCount: number;
}

export async function getUserAchievements(uid: string): Promise<UserAchievementsState> {
  if (!uid) return { unlocked: [], unlockedAt: {}, videosGeneratedCount: 0 };
  const snap = await getDoc(doc(db, 'users', uid));
  const data = snap.exists() ? snap.data() : {};
  return {
    unlocked: Array.isArray(data?.achievements) ? data.achievements : [],
    unlockedAt: data?.achievementsUnlockedAt || {},
    videosGeneratedCount: Number(data?.videosGeneratedCount) || 0,
  };
}

function showUnlockToast(id: string) {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  // toast.success (não toast.custom) de propósito — assim herda o som de
  // sucesso já instalado globalmente (toastSound.ts) sem precisar duplicar.
  toast.success(`🏆 Conquista desbloqueada: ${a.title}`, { duration: 6000 });
}

/** Desbloqueia UMA conquista (idempotente — repetir não duplica nem re-notifica). */
export async function unlockAchievement(uid: string | undefined, id: string): Promise<void> {
  if (!uid) return;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    const current: string[] = (snap.exists() && snap.data()?.achievements) || [];
    if (current.includes(id)) return; // já tinha — silencioso
    await setDoc(
      ref,
      {
        achievements: [...current, id],
        achievementsUnlockedAt: { [id]: new Date().toISOString() },
      },
      { merge: true }
    );
    showUnlockToast(id);
  } catch (err) {
    // Conquista é cosmético — nunca deve quebrar o fluxo real (gerar vídeo/
    // áudio) por causa de uma falha aqui. Loga e segue.
    console.error('[achievements] Falha ao desbloquear', id, err);
  }
}

/** Chamado toda vez que um vídeo novo é gerado (qualquer pipeline — HeyGen
 *  avatar, fal Vídeo IA). Incrementa o contador e checa os 3 marcos de vídeo. */
export async function trackVideoGenerated(uid: string | undefined): Promise<void> {
  if (!uid) return;
  try {
    const ref = doc(db, 'users', uid);
    await setDoc(ref, { videosGeneratedCount: increment(1) }, { merge: true });
    const snap = await getDoc(ref);
    const count = Number(snap.data()?.videosGeneratedCount) || 0;
    if (count >= 1) await unlockAchievement(uid, 'primeiro_video');
    if (count >= 5) await unlockAchievement(uid, '5_videos');
    if (count >= 10) await unlockAchievement(uid, '10_videos');
  } catch (err) {
    console.error('[achievements] Falha ao contar vídeo', err);
  }
}
