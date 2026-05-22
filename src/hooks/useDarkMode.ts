// Class-based dark mode controller. Tailwind's `dark:` variant fires
// when the `.dark` class is on <html>; this hook owns that class and
// persists the user's choice to localStorage so reloads keep the same
// theme.
//
// Default = system preference (prefers-color-scheme: dark). User can
// override via the header toggle; the override sticks across sessions.
//
// Returns:
//   isDark      — current state (boolean)
//   toggle()    — flip between modes
//   setDark(b)  — explicit set
//
// Implementation notes:
//   - We sync to <html> in a useEffect rather than during render so
//     server-side rendering (if added later) doesn't get a hydration
//     mismatch.
//   - Listens to OS-level changes only when the user hasn't set an
//     explicit preference — once they've toggled, we respect that.

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'metavise.darkMode';

function getInitialMode(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function useDarkMode() {
  const [isDark, setIsDark] = useState<boolean>(getInitialMode);

  // Sync the class on <html> every time isDark changes.
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [isDark]);

  // Follow OS preference changes ONLY when the user hasn't explicitly
  // chosen yet — once they toggle, the choice sticks.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'true' || stored === 'false') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setDark = useCallback((value: boolean) => {
    setIsDark(value);
    window.localStorage.setItem(STORAGE_KEY, String(value));
  }, []);

  const toggle = useCallback(() => setDark(!isDark), [isDark, setDark]);

  return { isDark, toggle, setDark };
}
