import { X, Keyboard } from 'lucide-react';

interface Shortcut {
  keys: string[];
  label: string;
}
interface Group {
  title: string;
  shortcuts: Shortcut[];
}

// Atalhos reais do app — cada linha aqui espelha um listener de keydown que
// já existe em algum lugar (App.tsx, CopyTab.tsx, MontagemTab.tsx). Se um
// atalho novo for adicionado, adiciona a entrada aqui também — isso é só a
// documentação, não a implementação.
const GROUPS: Group[] = [
  {
    title: 'Em qualquer lugar',
    shortcuts: [
      { keys: ['⌘/Ctrl', 'K'], label: 'Paleta de comandos — pular pra aba/projeto/ação' },
      { keys: ['?'], label: 'Abrir este painel de atalhos' },
    ],
  },
  {
    title: 'Aba Copy',
    shortcuts: [
      { keys: ['⌘/Ctrl', '↵'], label: 'Gerar copy' },
      { keys: ['⌘/Ctrl', 'B'], label: 'Abrir biblioteca' },
      { keys: ['⌘/Ctrl', 'H'], label: 'Abrir histórico' },
      { keys: ['⌘/Ctrl', 'D'], label: 'Abrir debug (quando disponível)' },
    ],
  },
  {
    title: 'Aba Montagem',
    shortcuts: [
      { keys: ['⌘/Ctrl', 'Z'], label: 'Desfazer' },
      { keys: ['⌘/Ctrl', 'Shift', 'Z'], label: 'Refazer (ou Ctrl+Y)' },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-black ring-1 ring-gray-200 dark:ring-gray-700 shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 text-white flex items-center justify-center">
              <Keyboard size={16} />
            </div>
            <h2 className="text-base font-black text-gray-900 dark:text-gray-50">
              Atalhos de teclado
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-gray-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                {group.title}
              </p>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-4 py-1.5">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{s.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <Kbd>{k}</Kbd>
                          {i < s.keys.length - 1 && (
                            <span className="text-gray-300 dark:text-gray-600 text-xs">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
