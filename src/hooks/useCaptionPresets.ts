import { useCallback, useEffect, useState } from 'react';

// Presets de estilo de legenda (ZapCap etapa 4): salva os ajustes com um nome
// e reaplica depois. localStorage, cross-projeto. O `settings` é um objeto
// solto com os campos zap* de estilo (fonte, cores, highlight, etc.).
export interface CaptionPreset {
  id: string;
  name: string;
  settings: Record<string, any>;
}

const KEY = 'metavise-caption-presets';

function load(): CaptionPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function useCaptionPresets() {
  const [presets, setPresets] = useState<CaptionPreset[]>(load);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setPresets(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: CaptionPreset[]) => {
    setPresets(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  // Salva/atualiza pelo nome (se já existe um com o mesmo nome, sobrescreve).
  const save = useCallback(
    (name: string, settings: Record<string, any>) => {
      const list = load();
      const existing = list.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
      if (existing) {
        persist(list.map((p) => (p.id === existing.id ? { ...p, settings } : p)));
        return existing.id;
      }
      const item: CaptionPreset = {
        id: `cap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        settings,
      };
      persist([item, ...list]);
      return item.id;
    },
    [persist]
  );

  const remove = useCallback((id: string) => persist(load().filter((p) => p.id !== id)), [persist]);

  // Atualiza os VALORES de um preset existente (sobrescreve com os ajustes atuais).
  const update = useCallback(
    (id: string, settings: Record<string, any>) =>
      persist(load().map((p) => (p.id === id ? { ...p, settings } : p))),
    [persist]
  );

  // Renomeia um preset existente.
  const rename = useCallback(
    (id: string, name: string) =>
      persist(load().map((p) => (p.id === id ? { ...p, name: name.trim() } : p))),
    [persist]
  );

  return { presets, save, remove, update, rename };
}
