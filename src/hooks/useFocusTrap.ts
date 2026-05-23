import { useEffect, useRef } from 'react';

/**
 * Focus trap for modals — keeps Tab/Shift+Tab cycling inside the
 * container instead of escaping to background elements. Standard a11y
 * pattern; the WAI-ARIA modal spec requires this.
 *
 * Usage:
 *   const ref = useFocusTrap<HTMLDivElement>(isOpen);
 *   return <div ref={ref}>...</div>;
 *
 * On open, focus moves to the first focusable child. On unmount /
 * close, focus restores to whatever element was focused before.
 */

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T extends HTMLElement = HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;

    // Focus first focusable element on open.
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusables[0];
    if (first) first.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // Re-query every keystroke because modal content can change.
      const items = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab: cycle backward at the start.
        if (activeEl === firstEl || !container.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        // Tab: cycle forward at the end.
        if (activeEl === lastEl || !container.contains(activeEl)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Restore previous focus on close.
      previousFocus?.focus?.();
    };
  }, [active]);

  return ref;
}
