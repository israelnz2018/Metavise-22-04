import { useCallback, useEffect, useState } from 'react';

// Biblioteca pessoal de efeitos sonoros (reutilizável entre projetos). Os
// arquivos ficam no Firebase Storage (URL durável); aqui guardamos só a LISTA
// (id/nome/categoria/url) em localStorage. Cross-projeto, mesmo dispositivo.
export interface LibSound {
  id: string;
  name: string;
  url: string;
  category: string; // ex.: 'Transições', 'Efeitos', 'Impactos'
  /** URL do áudio ORIGINAL (antes de qualquer trim) — permite reajustar a
   *  duração padrão sem perder o som inteiro. */
  origUrl?: string;
  /** Duração padrão (trim) salva: início/fim em segundos, pra referência. */
  trimStart?: number;
  trimEnd?: number;
}

const KEY = 'metavise-sound-library';

function load(): LibSound[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function useSoundLibrary() {
  const [sounds, setSounds] = useState<LibSound[]>(load);

  // Sincroniza entre abas/instâncias do componente.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSounds(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: LibSound[]) => {
    setSounds(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* cota cheia — ignora */
    }
  }, []);

  const add = useCallback(
    (s: Omit<LibSound, 'id'>) => {
      const item: LibSound = {
        ...s,
        id: `snd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      };
      persist([item, ...load()]);
      return item;
    },
    [persist]
  );

  const remove = useCallback(
    (id: string) => persist(load().filter((s) => s.id !== id)),
    [persist]
  );

  const rename = useCallback(
    (id: string, name: string) =>
      persist(load().map((s) => (s.id === id ? { ...s, name } : s))),
    [persist]
  );

  const update = useCallback(
    (id: string, patch: Partial<LibSound>) =>
      persist(load().map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [persist]
  );

  return { sounds, add, remove, rename, update };
}
