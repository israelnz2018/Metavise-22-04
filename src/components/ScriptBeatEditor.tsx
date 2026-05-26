/**
 * UX16 — Script Beat Editor.
 *
 * Renderiza um script gerado pelo Claude (com markers [BEAT]) como uma
 * lista de cards editáveis, um por beat. Cada card tem botão "Regerar"
 * que pede ao Claude pra reescrever SÓ aquele beat preservando flow.
 *
 * Se o script não tem markers (legacy/monolítico), o componente devolve
 * null e o caller renderiza o script normal numa textarea só. Fallback
 * gracioso.
 *
 * Source of truth: script prop. Cada edit reparsea e re-monta — simples
 * e robusto. Parse é O(n) e script é curto (~200 palavras).
 */

import { useState } from 'react';
import { Loader2, RefreshCw, Edit3 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { parseScriptBeats, assembleScriptFromBeats, regenerateBeat } from '@/lib/claudeService';

interface Props {
  script: string;
  /** Callback chamado quando script muda (regen ou edit manual) */
  onChange: (newScript: string) => void;
  /** Answers do projeto pra contexto na regen */
  answers: Record<string, any>;
  /** Ângulo do brief/copy */
  angle: string;
}

const TAG_COLORS = [
  'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200/60 dark:ring-blue-800/60',
  'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-purple-200/60 dark:ring-purple-800/60',
  'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200/60 dark:ring-amber-800/60',
  'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 ring-green-200/60 dark:ring-green-800/60',
  'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200/60 dark:ring-rose-800/60',
];

export function ScriptBeatEditor({ script, onChange, answers, angle }: Props) {
  const beats = parseScriptBeats(script);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);

  if (beats.length === 0) return null;

  const handleEditBeat = (idx: number, newText: string) => {
    const updated = beats.map((b, i) => (i === idx ? { ...b, text: newText } : b));
    onChange(assembleScriptFromBeats(updated));
  };

  const handleRegenBeat = async (idx: number) => {
    const beat = beats[idx];
    if (!beat) return;
    setRegeneratingIdx(idx);
    const toastId = `regen-beat-${idx}`;
    toast.loading(`Regenerando [${beat.label}]...`, { id: toastId });
    try {
      const newText = await regenerateBeat({
        beatLabel: beat.label,
        beatCurrentText: beat.text,
        fullScript: assembleScriptFromBeats(beats),
        answers,
        angle,
      });
      if (newText && newText !== beat.text) {
        const updated = beats.map((b, i) => (i === idx ? { ...b, text: newText } : b));
        onChange(assembleScriptFromBeats(updated));
        toast.success(`[${beat.label}] regenerado`, { id: toastId, duration: 3000 });
      } else {
        toast.error('Não consegui regenerar — texto retornado é igual ao original.', {
          id: toastId,
        });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao regenerar beat.', { id: toastId });
    } finally {
      setRegeneratingIdx(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Edit3 size={14} className="text-gray-400 dark:text-gray-500" />
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
          Modo Beat-by-Beat — {beats.length} beats — regere ou edite cada um separadamente
        </p>
      </div>

      {beats.map((beat, idx) => {
        const isRegen = regeneratingIdx === idx;
        const color = TAG_COLORS[idx % TAG_COLORS.length];
        const wordCount = beat.text.split(/\s+/).filter(Boolean).length;
        return (
          <div
            key={`${beat.label}-${idx}`}
            className={`bg-gray-50 dark:bg-gray-800/40 rounded-2xl border-2 border-gray-200 dark:border-gray-800 p-4 space-y-3 transition-opacity ${
              isRegen ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md ring-1 ${color}`}
                >
                  {beat.label}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                  {wordCount} palavras
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleRegenBeat(idx)}
                disabled={isRegen || regeneratingIdx !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-900/80 ring-1 ring-gray-300 dark:ring-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-all"
              >
                {isRegen ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                {isRegen ? 'Regenerando…' : 'Regerar este beat'}
              </button>
            </div>
            <textarea
              value={beat.text}
              onChange={(e) => handleEditBeat(idx, e.target.value)}
              disabled={isRegen}
              rows={Math.max(2, Math.ceil(beat.text.length / 70))}
              className="w-full p-3 bg-white dark:bg-gray-900/80 rounded-xl border border-gray-200 dark:border-gray-800 outline-none focus:border-blue-500 text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-mono resize-y transition-all disabled:opacity-60"
            />
          </div>
        );
      })}
    </div>
  );
}
