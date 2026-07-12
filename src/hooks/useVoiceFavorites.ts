// Per-browser favorites for ElevenLabs voices. Same rationale as
// useAvatarFavorites: pinning the handful of voices you actually use beats
// re-searching the paged shared-voices catalog every time, in any
// project/subproject.
//
// Unlike avatars (whose full list is always loaded, so we can store just the
// id and resolve the rest), the voice catalog is PAGED/filtered — a favorited
// voice may not be on the current page. So we persist the whole lightweight
// voice object (id + name + preview + labels) and render the Favoritos strip
// straight from storage, no lookup needed.
//
// Why localStorage and not Firestore: this is "browser preference" data, same
// as useAvatarFavorites and the dark-mode toggle. If cross-device sync ever
// becomes a real need, swap both to `users/{uid}/preferences` with the same
// API surface.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'metavise.voiceFavorites';

export interface FavoriteVoice {
  voice_id: string;
  name: string;
  preview_url?: string;
  labels?: {
    gender?: string;
    age?: string;
    language?: string;
    accent?: string;
    use_case?: string;
    descriptive?: string;
  };
}

function readFromStorage(): FavoriteVoice[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((v) => v && v.voice_id) : [];
  } catch {
    return [];
  }
}

export function useVoiceFavorites() {
  const [voices, setVoices] = useState<FavoriteVoice[]>(readFromStorage);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(voices));
    } catch {
      // Storage full / disabled / private mode — favorites still work for
      // the rest of this session.
    }
  }, [voices]);

  const isFavorite = useCallback(
    (voiceId: string) => voices.some((v) => v.voice_id === voiceId),
    [voices],
  );

  // Add (or update metadata of) a favorite. Idempotent by voice_id.
  const add = useCallback((voice: FavoriteVoice) => {
    if (!voice?.voice_id) return;
    setVoices((prev) => {
      const without = prev.filter((v) => v.voice_id !== voice.voice_id);
      return [
        { voice_id: voice.voice_id, name: voice.name, preview_url: voice.preview_url, labels: voice.labels },
        ...without,
      ];
    });
  }, []);

  const remove = useCallback((voiceId: string) => {
    setVoices((prev) => prev.filter((v) => v.voice_id !== voiceId));
  }, []);

  const toggle = useCallback((voice: FavoriteVoice) => {
    if (!voice?.voice_id) return;
    setVoices((prev) =>
      prev.some((v) => v.voice_id === voice.voice_id)
        ? prev.filter((v) => v.voice_id !== voice.voice_id)
        : [{ voice_id: voice.voice_id, name: voice.name, preview_url: voice.preview_url, labels: voice.labels }, ...prev],
    );
  }, []);

  return {
    voices,
    favoriteCount: voices.length,
    isFavorite,
    add,
    remove,
    toggle,
  };
}
