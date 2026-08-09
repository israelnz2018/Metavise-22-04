// Preferências de UI do app (som, música de fundo, cor de destaque) —
// mesmo padrão de persistência do useDarkMode: localStorage, default
// sensato, override do usuário gruda entre sessões.

import { useCallback, useEffect, useState } from 'react';
import { setSfxEnabled } from '@/lib/sfx';

const KEYS = {
  sfx: 'metavise.sfxEnabled',
  music: 'metavise.bgMusicEnabled',
  musicVolume: 'metavise.bgMusicVolume',
  accent: 'metavise.accentColor',
} as const;

export type AccentColor = 'blue' | 'purple' | 'emerald' | 'orange' | 'rose' | 'teal';

export const ACCENT_COLORS: { id: AccentColor; label: string; hex: string }[] = [
  { id: 'blue', label: 'Azul', hex: '#2563eb' },
  { id: 'purple', label: 'Roxo', hex: '#9333ea' },
  { id: 'emerald', label: 'Verde', hex: '#059669' },
  { id: 'orange', label: 'Laranja', hex: '#ea580c' },
  { id: 'rose', label: 'Rosa', hex: '#e11d48' },
  { id: 'teal', label: 'Turquesa', hex: '#0d9488' },
];

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const v = Number(window.localStorage.getItem(key));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

function readAccent(): AccentColor {
  if (typeof window === 'undefined') return 'blue';
  const v = window.localStorage.getItem(KEYS.accent);
  return (ACCENT_COLORS.find((c) => c.id === v)?.id as AccentColor) || 'blue';
}

export function useAppPreferences() {
  const [sfxEnabled, setSfxEnabledState] = useState(() => readBool(KEYS.sfx, true));
  const [bgMusicEnabled, setBgMusicEnabledState] = useState(() => readBool(KEYS.music, false));
  const [bgMusicVolume, setBgMusicVolumeState] = useState(() => readNumber(KEYS.musicVolume, 0.25));
  const [accentColor, setAccentColorState] = useState<AccentColor>(readAccent);

  // sfx.ts é módulo puro (sem estado React) — sincroniza o flag dele
  // sempre que a preferência muda, incluindo no mount.
  useEffect(() => {
    setSfxEnabled(sfxEnabled);
  }, [sfxEnabled]);

  // Aplica a cor de destaque como CSS var no <html> — só alguns elementos
  // (nav ativo, botões primários) leem essa var; não é um reskin completo
  // do app (que teria que trocar milhares de classes bg-blue-* hardcoded).
  useEffect(() => {
    const hex = ACCENT_COLORS.find((c) => c.id === accentColor)?.hex || '#2563eb';
    document.documentElement.style.setProperty('--accent', hex);
  }, [accentColor]);

  const setSfx = useCallback((v: boolean) => {
    setSfxEnabledState(v);
    window.localStorage.setItem(KEYS.sfx, String(v));
  }, []);

  const setBgMusic = useCallback((v: boolean) => {
    setBgMusicEnabledState(v);
    window.localStorage.setItem(KEYS.music, String(v));
  }, []);

  const setBgMusicVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setBgMusicVolumeState(clamped);
    window.localStorage.setItem(KEYS.musicVolume, String(clamped));
  }, []);

  const setAccentColor = useCallback((v: AccentColor) => {
    setAccentColorState(v);
    window.localStorage.setItem(KEYS.accent, v);
  }, []);

  return {
    sfxEnabled,
    setSfx,
    bgMusicEnabled,
    setBgMusic,
    bgMusicVolume,
    setBgMusicVolume,
    accentColor,
    setAccentColor,
  };
}
