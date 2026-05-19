import { Edit3, X } from 'lucide-react';

// Edit dialog for the currently-selected persona. The persona blob is
// stored as a JSON string on config.copy.answers.selectedPersonaFull
// (legacy serialization). App.tsx hands us the parsed object + an
// onChange callback that re-serializes and writes it back.
interface Persona {
  name?: string;
  age?: string;
  gender?: string;
  awarenessLevel?: string;
  description?: string;
  currentSituation?: string;
  mainPain?: string;
  hiddenDesire?: string;
  dominantFear?: string;
  mainObjection?: string;
  emotionalTrigger?: string;
  strongestPromise?: string;
  communicationTone?: string;
}

interface Props {
  open: boolean;
  persona: Persona | null;
  onChange: (next: Persona) => void;
  onClose: () => void;
  onSave: () => void;
}

// Single-line fields (left) and textarea fields (right). Render shape
// is uniform — defining them once cuts the JSX from ~200 lines to ~30.
const INPUT_FIELDS: { key: keyof Persona; label: string }[] = [
  { key: 'name', label: 'Nome simbólico' },
  { key: 'age', label: 'Idade' },
  { key: 'gender', label: 'Gênero' },
];

const TEXTAREA_FIELDS: { key: keyof Persona; label: string; rows?: number }[] = [
  { key: 'description', label: 'Descrição' },
  { key: 'currentSituation', label: 'Situação atual' },
  { key: 'mainPain', label: 'Dor principal' },
  { key: 'hiddenDesire', label: 'Desejo profundo' },
  { key: 'mainObjection', label: 'Objeção principal' },
  { key: 'emotionalTrigger', label: 'Gatilho emocional' },
  { key: 'strongestPromise', label: 'Promessa mais forte' },
];

const SINGLE_LINE_FIELDS: { key: keyof Persona; label: string }[] = [
  { key: 'dominantFear', label: 'Medo dominante' },
  { key: 'communicationTone', label: 'Tom de comunicação' },
];

export function PersonaEditModal({ open, persona, onChange, onClose, onSave }: Props) {
  if (!open || !persona) return null;

  const update = (field: keyof Persona, value: string) => {
    onChange({ ...persona, [field]: value });
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b-2 border-gray-100 p-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 flex items-center justify-center">
              <Edit3 size={20} className="text-blue-600" />
            </div>
            <h3 className="text-xl font-black text-gray-900">Editar Persona</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {INPUT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <input
                  type="text"
                  value={persona[f.key] || ''}
                  onChange={(e) => update(f.key, e.target.value)}
                  className="mt-1 w-full px-4 py-2 border-2 border-gray-100 rounded-xl text-sm focus:border-blue-600 focus:outline-none"
                />
              </Field>
            ))}
            <Field label="Nível de Consciência (1-5)">
              <select
                value={persona.awarenessLevel || '3'}
                onChange={(e) => update('awarenessLevel', e.target.value)}
                className="mt-1 w-full px-4 py-2 border-2 border-gray-100 rounded-xl text-sm focus:border-blue-600 focus:outline-none"
              >
                <option value="1">1 — Inconsciente</option>
                <option value="2">2 — Consciente do problema</option>
                <option value="3">3 — Consciente da solução</option>
                <option value="4">4 — Consciente do produto</option>
                <option value="5">5 — Muito consciente</option>
              </select>
            </Field>
          </div>

          {TEXTAREA_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <textarea
                value={persona[f.key] || ''}
                onChange={(e) => update(f.key, e.target.value)}
                rows={f.rows || 2}
                className="mt-1 w-full px-4 py-2 border-2 border-gray-100 rounded-xl text-sm focus:border-blue-600 focus:outline-none resize-none"
              />
            </Field>
          ))}

          {SINGLE_LINE_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                type="text"
                value={persona[f.key] || ''}
                onChange={(e) => update(f.key, e.target.value)}
                className="mt-1 w-full px-4 py-2 border-2 border-gray-100 rounded-xl text-sm focus:border-blue-600 focus:outline-none"
              />
            </Field>
          ))}
        </div>

        <div className="sticky bottom-0 bg-white border-t-2 border-gray-100 p-6 flex flex-col md:flex-row gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-3 bg-gray-100 text-gray-900 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all"
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
          >
            Salvar Alterações
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-black text-gray-700 uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}
