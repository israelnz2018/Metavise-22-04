import { useEffect, useState } from 'react';
import { X, Trophy, Lock } from 'lucide-react';
import { ACHIEVEMENTS, getUserAchievements } from '@/lib/achievements';

interface Props {
  open: boolean;
  onClose: () => void;
  uid?: string;
}

export function AchievementsModal({ open, onClose, uid }: Props) {
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [unlockedAt, setUnlockedAt] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !uid) return;
    setLoading(true);
    getUserAchievements(uid)
      .then((state) => {
        setUnlocked(new Set(state.unlocked));
        setUnlockedAt(state.unlockedAt);
      })
      .finally(() => setLoading(false));
  }, [open, uid]);

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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center">
              <Trophy size={16} />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 dark:text-gray-50">Conquistas</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {unlocked.size}/{ACHIEVEMENTS.length} desbloqueadas
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-gray-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!uid ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
              Faça login pra ver suas conquistas.
            </p>
          ) : loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Carregando…</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {ACHIEVEMENTS.map((a) => {
                const done = unlocked.has(a.id);
                return (
                  <div
                    key={a.id}
                    className={`rounded-2xl p-4 ring-1 space-y-2 ${
                      done
                        ? 'bg-amber-50/80 dark:bg-amber-950/20 ring-amber-200/60 dark:ring-amber-900/40'
                        : 'bg-gray-50 dark:bg-gray-800/50 ring-gray-200/60 dark:ring-gray-800/60 opacity-60'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        done
                          ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {done ? <Trophy size={16} /> : <Lock size={14} />}
                    </div>
                    <p className="text-sm font-black text-gray-900 dark:text-gray-100">{a.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                      {a.description}
                    </p>
                    {done && unlockedAt[a.id] && (
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                        {new Date(unlockedAt[a.id]!).toLocaleDateString('pt-BR')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
