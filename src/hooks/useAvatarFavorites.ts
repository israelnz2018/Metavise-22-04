// Per-browser favorites for HeyGen avatars. Pinning the 5-10 avatars
// you actually use addresses the long-standing issue that most of the
// dynamic filters (style/age/ethnicity) work poorly for real-world
// search intent — gender is the only filter that reliably narrows
// the list, and you still scroll a lot.
//
// Why localStorage and not Firestore: this is "browser preference"
// data, not "project data." It's the same kind of state as the dark
// mode toggle. Putting it in Firestore would add 1 round-trip on
// every avatar interaction without any benefit unless the user
// switches devices often. If that ever becomes a real need, swap to
// `users/{uid}/preferences` doc with the same API surface.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'metavise.avatarFavorites';

function readFromStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

export function useAvatarFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(readFromStorage);

  // Persist on every change. JSON serialization of a small Set is
  // cheap — even at 100+ favorites this is sub-ms.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...favorites]),
      );
    } catch {
      // Storage full / disabled / Safari private mode — silently skip;
      // favorites still work for the rest of this session.
    }
  }, [favorites]);

  const isFavorite = useCallback(
    (avatarId: string) => favorites.has(avatarId),
    [favorites],
  );

  const toggle = useCallback((avatarId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(avatarId)) next.delete(avatarId);
      else next.add(avatarId);
      return next;
    });
  }, []);

  return {
    favorites,
    favoriteCount: favorites.size,
    isFavorite,
    toggle,
  };
}
