/**
 * Desktop notification helpers.
 *
 * Renders take 3–5 min on HeyGen/Runway/ZapCap — long enough that the
 * user usually tabs away. The Notification API lets us pull them back
 * when the work finishes. We keep state in localStorage so we only
 * ask for permission once per browser profile and remember if the
 * user actively dismissed the prompt.
 *
 * Usage:
 *   await ensureNotificationPermission();        // call once on render-trigger
 *   notify('Vídeo pronto!', { body: 'Avatar terminou em 4m12s.' });
 */

const PERMISSION_KEY = 'metavise-notif-asked-v1';

type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationState(): PermissionState {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission as PermissionState;
}

/**
 * Request permission idempotently. Safe to call multiple times — the
 * browser only shows the prompt on the first call when state is
 * 'default'. We also stash a flag in localStorage so callers can
 * avoid noisy "Enable notifications?" toasts on every render.
 *
 * Returns the final permission state.
 */
export async function ensureNotificationPermission(): Promise<PermissionState> {
  if (!notificationsSupported()) return 'unsupported';

  const current = Notification.permission;
  if (current === 'granted' || current === 'denied') return current;

  try {
    const result = await Notification.requestPermission();
    localStorage.setItem(PERMISSION_KEY, '1');
    return result as PermissionState;
  } catch (err) {
    console.warn('[Notifications] requestPermission failed:', err);
    return 'denied';
  }
}

export function hasAskedBefore(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(PERMISSION_KEY) === '1';
}

/**
 * Fire a desktop notification. Silently no-ops if the user hasn't
 * granted permission or the browser doesn't support the API —
 * callers don't need to guard.
 *
 * `focusOnClick` (default true) brings the tab to the foreground
 * when the user clicks the notification — typically what you want
 * for "your render is done".
 */
export function notify(
  title: string,
  options: NotificationOptions & { focusOnClick?: boolean } = {}
): Notification | null {
  if (!notificationsSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  const { focusOnClick = true, ...rest } = options;

  try {
    const n = new Notification(title, {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      ...rest,
    });

    if (focusOnClick) {
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }

    return n;
  } catch (err) {
    console.warn('[Notifications] failed to display:', err);
    return null;
  }
}

/**
 * Only fire when the tab is in the background. Useful for
 * "render complete" — we don't want to nag the user when they're
 * already watching the progress UI.
 */
export function notifyIfHidden(
  title: string,
  options: NotificationOptions & { focusOnClick?: boolean } = {}
): Notification | null {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return null;
  }
  return notify(title, options);
}
