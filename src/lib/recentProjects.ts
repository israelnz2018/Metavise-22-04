/**
 * Track the user's recently-opened projects in localStorage so we can
 * offer a quick "jump back" affordance in the header. The user
 * shouldn't have to open the Projects tab + scroll/search just to
 * switch between two active projects.
 *
 * Storage:
 *   metavise-recent-projects-v1 → JSON array of RecentEntry, newest first.
 *
 * Cap at MAX entries. Each push removes any duplicate of the same id
 * before prepending, so the order is "most-recently touched first".
 */

const KEY = 'metavise-recent-projects-v1';
const MAX = 5;

export interface RecentEntry {
  id: string;
  name: string;
  type: 'complete' | 'copy' | 'video' | 'editing';
  /** Unix millis when last opened. */
  viewedAt: number;
}

export function readRecentProjects(): RecentEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentEntry =>
        x &&
        typeof x.id === 'string' &&
        typeof x.name === 'string' &&
        typeof x.viewedAt === 'number'
    );
  } catch {
    return [];
  }
}

export function pushRecentProject(entry: Omit<RecentEntry, 'viewedAt'>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const list = readRecentProjects();
    const filtered = list.filter((x) => x.id !== entry.id);
    filtered.unshift({ ...entry, viewedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, MAX)));
  } catch {
    /* silent — telemetry, not critical */
  }
}

export function clearRecentProjects(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
