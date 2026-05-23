import { useEffect, useRef, useState } from 'react';
import { Clock, Folder, Video, Edit3, Play, Maximize } from 'lucide-react';
import { readRecentProjects, type RecentEntry } from '@/lib/recentProjects';
import type { Project } from '@/types/project';

/**
 * Header-mounted "jump back to recent project" button. Shows a clock
 * icon with a dropdown that lists up to 5 recently-opened projects.
 *
 * Hidden when there are no recent projects (first-time users / cleared
 * localStorage). Auto-refreshes its list when the dropdown opens.
 */
export function RecentProjectsButton({
  projects,
  currentProjectId,
  onPick,
}: {
  /** Full project list — we filter the recent entries against it to
   *  skip ones that were deleted upstream. */
  projects: Project[];
  currentProjectId: string | null;
  onPick: (project: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Recompute on open so deletions / new entries are picked up.
  useEffect(() => {
    if (open) setRecent(readRecentProjects());
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Skip current project + any that no longer exist.
  const visible = recent.filter(
    (r) => r.id !== currentProjectId && projects.some((p) => p.id === r.id)
  );

  if (visible.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Projetos recentes"
        className={`p-2 rounded-xl transition-colors ${
          open
            ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
            : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/60'
        }`}
      >
        <Clock size={18} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl shadow-gray-200/60 dark:shadow-black/40 ring-1 ring-gray-100 dark:ring-gray-800 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
            <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
              Projetos recentes
            </p>
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {visible.map((r) => {
              const project = projects.find((p) => p.id === r.id);
              if (!project) return null;
              const Icon = ICONS[r.type] || Folder;
              return (
                <button
                  key={r.id}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onPick(project);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                >
                  <span className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 dark:from-blue-950/40 dark:to-blue-900/30 dark:text-blue-400 flex items-center justify-center ring-1 ring-blue-100/60 dark:ring-blue-900/40">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.name}</span>
                    <span className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      {relative(r.viewedAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const ICONS: Record<RecentEntry['type'], typeof Folder> = {
  complete: Video,
  copy: Edit3,
  video: Play,
  editing: Maximize,
};

function relative(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'Há poucos segundos';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Há ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `Há ${diffD}d`;
}
