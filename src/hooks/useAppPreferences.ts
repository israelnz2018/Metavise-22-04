// Preferências de UI do app (som, música de fundo, cor de destaque) —
// mesmo padrão de persistência do useDarkMode: localStorage, default
// sensato, override do usuário gruda entre sessões.

import { useCallback, useEffect, useState } from 'react';
import { setSfxEnabled, setSfxVolume as setSfxVolumeModule } from '@/lib/sfx';

const KEYS = {
  sfx: 'metavise.sfxEnabled',
  sfxVolume: 'metavise.sfxVolume',
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

function readNumber(key: string, fallback: number, max = 1): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= max ? v : fallback;
}

function readAccent(): AccentColor {
  if (typeof window === 'undefined') return 'blue';
  const v = window.localStorage.getItem(KEYS.accent);
  return (ACCENT_COLORS.find((c) => c.id === v)?.id as AccentColor) || 'blue';
}

export function useAppPreferences() {
  const [sfxEnabled, setSfxEnabledState] = useState(() => readBool(KEYS.sfx, true));
  // Escala 0-2 (não 0-1): 1 já É o volume-base novo (30% mais alto que o
  // original) — o slider deixa o usuário ir além disso se quiser mais.
  const [sfxVolume, setSfxVolumeState] = useState(() => readNumber(KEYS.sfxVolume, 1, 2));
  const [bgMusicEnabled, setBgMusicEnabledState] = useState(() => readBool(KEYS.music, false));
  const [bgMusicVolume, setBgMusicVolumeState] = useState(() => readNumber(KEYS.musicVolume, 0.25));
  const [accentColor, setAccentColorState] = useState<AccentColor>(readAccent);

  // sfx.ts é módulo puro (sem estado React) — sincroniza os flags dele
  // sempre que a preferência muda, incluindo no mount.
  useEffect(() => {
    setSfxEnabled(sfxEnabled);
  }, [sfxEnabled]);

  useEffect(() => {
    setSfxVolumeModule(sfxVolume);
  }, [sfxVolume]);

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

  const setSfxVolume = useCallback((v: number) => {
    const clamped = Math.min(2, Math.max(0, v));
    setSfxVolumeState(clamped);
    window.localStorage.setItem(KEYS.sfxVolume, String(clamped));
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
    sfxVolume,
    setSfxVolume,
    bgMusicEnabled,
    setBgMusic,
    bgMusicVolume,
    setBgMusicVolume,
    accentColor,
    setAccentColor,
  };
}
