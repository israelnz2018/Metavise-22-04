import { useEffect } from 'react';
import { useToasterStore, toast } from 'react-hot-toast';

/**
 * Caps the number of visible toasts. react-hot-toast doesn't have a
 * built-in `limit` prop on <Toaster>, so we subscribe to its store
 * and dismiss the oldest visible toast whenever the count exceeds
 * the limit.
 *
 * "Visible" excludes toasts that are already in the dismiss transition
 * (`visible: false`) — important because dismiss is animated, so
 * recently-dismissed toasts hang around for ~300ms.
 *
 * Mount once next to <Toaster>; it returns null (renders nothing).
 */
export function ToastLimiter({ max = 3 }: { max?: number }) {
  const { toasts } = useToasterStore();

  useEffect(() => {
    const visible = toasts.filter((t) => t.visible);
    if (visible.length <= max) return;
    // Dismiss the oldest. react-hot-toast orders newest-first in the
    // store, so the tail is the oldest.
    const excess = visible.length - max;
    visible.slice(-excess).forEach((t) => toast.dismiss(t.id));
  }, [toasts, max]);

  return null;
}
