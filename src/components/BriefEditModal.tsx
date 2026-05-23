import { useEffect, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { CreativeBrief, WeightedPersona } from '@/types/project';
import { useFocusTrap } from '@/hooks/useFocusTrap';

/**
 * Edit modal for a single creative brief.
 *
 * All 9 brief fields are editable. The user can:
 *   - Re-assign the brief to a different persona (dropdown)
 *   - Change awareness level / angle / duration / emotion / style /
 *     ctaStyle / promiseFocus / hook / rationale
 *
 * On save the modal calls back with the updated brief — parent
 * persists into config.copy.creativeBriefs.
 *
 * "Cancelar" closes without saving. Click outside the modal also
 * cancels (same convention as the other modals).
 */

const AWARENESS_OPTIONS: Array<{ value: CreativeBrief['awareness']; label: string }> = [
  { value: 'unaware', label: '1 · Inconsciente' },
  { value: 'problem_aware', label: '2 · Consciente do problema' },
  { value: 'solution_aware', label: '3 · Consciente da solução' },
  { value: 'product_aware', label: '4 · Consciente do produto' },
  { value: 'most_aware', label: '5 · Muito consciente' },
];

const ANGLE_OPTIONS = [
  'Curiosidade',
  'Urgência',
  'Prova Social',
  'Transformação',
  'Mecanismo Revelado',
  'Autoridade',
  'Contra-Intuitivo',
  'Medo de Perda',
  'Desejo Aspiracional',
];

const STYLE_OPTIONS = [
  'Depoimento',
  'Mecanismo Revelado',
  'Antes e Depois',
  'Demo',
  'História Pessoal',
  'Comparação',
  'Lista de Benefícios',
  'Autoridade Explica',
];

const EMOTION_OPTIONS = [
  'Curiosidade',
  'Medo',
  'Desejo',
  'Validação',
  'Raiva',
  'Esperança',
  'Urgência',
  'Pertencimento',
];

const CTA_OPTIONS: Array<{ value: CreativeBrief['ctaStyle']; label: string }> = [
  { value: 'soft', label: 'Soft — "descubra", "saiba mais"' },
  { value: 'hard', label: 'Hard — "compre agora", "clique já"' },
  { value: 'curiosity_gap', label: 'Curiosity gap — "veja por que..."' },
];

const DURATION_OPTIONS: Array<{ value: CreativeBrief['durationTarget']; label: string }> = [
  { value: 15, label: '15 segundos' },
  { value: 30, label: '30 segundos' },
  { value: 45, label: '45 segundos' },
  { value: 60, label: '60 segundos' },
  { value: 90, label: '90 segundos' },
  { value: 120, label: '120 segundos (2 min)' },
];

export function BriefEditModal({
  isOpen,
  brief,
  personas,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  brief: CreativeBrief | null;
  personas: WeightedPersona[];
  onClose: () => void;
  onSave: (updated: CreativeBrief) => void;
}) {
  // Local copy of the brief so the user can edit without committing
  // until they hit "Salvar". `null` while the modal is closed.
  const [draft, setDraft] = useState<CreativeBrief | null>(brief);

  // Re-sync draft whenever a new brief is opened.
  useEffect(() => {
    setDraft(brief);
  }, [brief]);

  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
  if (!isOpen || !draft) return null;

  const set = <K extends keyof CreativeBrief>(key: K, value: CreativeBrief[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md animate-in fade-in duration-150 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-3xl shadow-2xl shadow-black/20 ring-1 ring-gray-200/60 dark:ring-gray-800 animate-in fade-in zoom-in-95 duration-150 my-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20">
              <Pencil size={16} />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-900 dark:text-gray-50 tracking-tight">
                Editar Criativo {draft.index}
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                "Sugerimos, ele decide" — mude o que quiser
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Persona alvo */}
          <Field label="Persona alvo">
            <select
              value={draft.targetPersonaId}
              onChange={(e) => {
                const p = personas.find((x) => x.id === e.target.value);
                set('targetPersonaId', e.target.value);
                if (p) set('targetPersonaName', p.name);
              }}
              className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Awareness */}
          <Field label="Nível de Consciência">
            <select
              value={draft.awareness}
              onChange={(e) => set('awareness', e.target.value as CreativeBrief['awareness'])}
              className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
            >
              {AWARENESS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Angle */}
          <Field label="Ângulo">
            <input
              list="angle-options"
              value={String(draft.angle)}
              onChange={(e) => set('angle', e.target.value as any)}
              className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
              placeholder="ex: Curiosidade, Urgência, Mecanismo Revelado..."
            />
            <datalist id="angle-options">
              {ANGLE_OPTIONS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>

          {/* Hook — multiline */}
          <Field label="Hook (primeira frase do anúncio — texto pronto)">
            <textarea
              value={draft.hook}
              onChange={(e) => set('hook', e.target.value)}
              rows={3}
              className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100 resize-none"
              placeholder="A primeira frase que o avatar vai falar literalmente."
            />
          </Field>

          {/* Duration + Style row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Duração alvo">
              <select
                value={draft.durationTarget}
                onChange={(e) =>
                  set('durationTarget', Number(e.target.value) as CreativeBrief['durationTarget'])
                }
                className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
              >
                {DURATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estilo / Formato">
              <input
                list="style-options"
                value={String(draft.style)}
                onChange={(e) => set('style', e.target.value as any)}
                className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
                placeholder="ex: Depoimento, Demo, História Pessoal"
              />
              <datalist id="style-options">
                {STYLE_OPTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
          </div>

          {/* Emotion + CTA row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Emoção primária">
              <input
                list="emotion-options"
                value={String(draft.emotion)}
                onChange={(e) => set('emotion', e.target.value as any)}
                className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
                placeholder="ex: Curiosidade, Medo, Desejo"
              />
              <datalist id="emotion-options">
                {EMOTION_OPTIONS.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
            </Field>
            <Field label="Estilo de CTA">
              <select
                value={draft.ctaStyle}
                onChange={(e) => set('ctaStyle', e.target.value as CreativeBrief['ctaStyle'])}
                className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
              >
                {CTA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Promise focus */}
          <Field label="Promessa em foco (benefício específico)">
            <input
              type="text"
              value={draft.promiseFocus}
              onChange={(e) => set('promiseFocus', e.target.value)}
              className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
              placeholder="Qual benefício do produto esse criativo destaca"
            />
          </Field>

          {/* Rationale */}
          <Field label="Rationale (por que essa combinação faz sentido)">
            <textarea
              value={draft.rationale}
              onChange={(e) => set('rationale', e.target.value)}
              rows={2}
              className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100 resize-none"
              placeholder="1 linha explicando a lógica desse criativo"
            />
          </Field>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-bold text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(draft)}
            className="px-5 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest text-white bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20"
          >
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 block">
        {label}
      </label>
      {children}
    </div>
  );
}
