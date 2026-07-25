import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';

// COMMAND PALETTE (Cmd/Ctrl+K): busca e salta pra qualquer aba/projeto/ação sem
// caçar na barra. Setas navegam, Enter executa, Esc fecha.

export interface Command {
  id: string;
  label: string;
  sub?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: Props) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      // Foca o input ao abrir.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands.slice(0, 50);
    return commands
      .filter((c) => (c.label + ' ' + (c.sub || '')).toLowerCase().includes(t))
      .slice(0, 50);
  }, [q, commands]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered, active]);

  if (!open) return null;

  const runAt = (i: number) => {
    const cmd = filtered[i];
    if (cmd) {
      onClose();
      cmd.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Search size={16} className="text-gray-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(active);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            placeholder="Buscar aba, projeto, ação…"
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          <kbd className="text-[10px] font-bold text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Nada encontrado.</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => runAt(i)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left ${
                  i === active ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                    {c.label}
                  </div>
                  {c.sub && <div className="text-[11px] text-gray-400 truncate">{c.sub}</div>}
                </div>
                {i === active && <CornerDownLeft size={14} className="text-gray-400 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
