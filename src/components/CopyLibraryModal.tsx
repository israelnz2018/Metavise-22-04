/**
 * UX18 — Modal "Biblioteca de Copies".
 *
 * 2 abas:
 *   1. "Minhas" — copies do user. CRUD: ver, favoritar, deletar.
 *   2. "Metavise" — copies do sistema (read-only).
 *
 * Atribuição visível em cada item: vertical + awareness + language.
 * Click expande o card pra ler o script completo.
 */

import { useState } from 'react';
import {
  X,
  Star,
  Trash2,
  Library,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Plus,
  Save,
  Loader2,
  CheckSquare,
  Square,
  Target,
} from 'lucide-react';
import { COPY_LIBRARY, type CopyExample, type CopyVertical } from '@/data/copyLibrary';
import type { PersonalCopyDoc } from '@/lib/personalCopyLibrary';

const VERTICAL_LABEL: Record<CopyVertical, string> = {
  saude: 'Saúde',
  emagrecimento: 'Emagrecimento',
  financas: 'Finanças',
  info_produto: 'Info-produto',
  beleza: 'Beleza',
  fisico: 'Físico/Lifestyle',
  espiritual: 'Espiritual',
};

// UX20: form de upload manual SIMPLIFICADO. Só name + script.
// IA infere vertical/awareness/language/angle/whyItWorks via
// analyzeCopyForLibrary (chamado no parent handler).
export interface ManualCopyInput {
  name?: string;
  script: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  personalLibrary: PersonalCopyDoc[];
  onToggleStar: (copyId: string, starred: boolean) => void;
  onDelete: (copyId: string) => void;
  /** UX19: upload manual — cliente preenche form e salva na biblioteca */
  onAddManual: (input: ManualCopyInput) => Promise<void>;
  /** UX22: IDs das copies selecionadas como referência pra próxima geração.
   *  Vazio = IA escolhe automaticamente (top 2 por vertical/awareness). */
  selectedReferenceIds: string[];
  /** UX22: toggle de seleção de uma copy como referência */
  onToggleReference: (copyId: string) => void;
}

export function CopyLibraryModal({
  open,
  onClose,
  personalLibrary,
  onToggleStar,
  onDelete,
  onAddManual,
  selectedReferenceIds,
  onToggleReference,
}: Props) {
  const [tab, setTab] = useState<'mine' | 'system'>('mine');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // UX20: form simplificado — só nome (opcional) + script. IA infere
  // o resto. Estado mínimo.
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formName, setFormName] = useState('');
  const [formScript, setFormScript] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormScript('');
  };

  const handleSubmitForm = async () => {
    if (!formScript.trim() || formScript.trim().length < 20) {
      return;
    }
    setIsAdding(true);
    try {
      // Parent vai chamar analyzeCopyForLibrary e salvar.
      await onAddManual({
        name: formName.trim() || undefined,
        script: formScript.trim(),
      });
      resetForm();
      setShowAddForm(false);
    } finally {
      setIsAdding(false);
    }
  };

  if (!open) return null;

  const renderItem = (
    item: CopyExample | PersonalCopyDoc,
    isPersonal: boolean,
    starred?: boolean
  ) => {
    const isExpanded = expandedId === item.id;
    // UX22: copy marcada como referência manualmente?
    const isSelected = isPersonal && selectedReferenceIds.includes(item.id);
    return (
      <div
        key={item.id}
        className={`bg-white dark:bg-gray-900/80 rounded-2xl border-2 transition-all ${
          isSelected
            ? 'border-blue-500 dark:border-blue-500 shadow-md shadow-blue-100/60 dark:shadow-blue-900/30 ring-1 ring-blue-200/50 dark:ring-blue-700/50'
            : starred
              ? 'border-amber-300 dark:border-amber-700 shadow-sm shadow-amber-100/40'
              : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <div className="p-4 space-y-2">
          <div className="flex items-start gap-3">
            {/* UX22: checkbox de seleção como referência. Só nas Minhas. */}
            {isPersonal && (
              <button
                onClick={() => onToggleReference(item.id)}
                className={`flex-shrink-0 mt-0.5 p-1 rounded-lg transition-all ${
                  isSelected
                    ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                    : 'text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                title={
                  isSelected
                    ? 'Desmarcar como referência'
                    : 'Usar esta copy como referência na próxima geração'
                }
              >
                {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
              </button>
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-black uppercase tracking-widest">
                <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                  {VERTICAL_LABEL[item.vertical] || item.vertical}
                </span>
                <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  Consc. {item.awareness}
                </span>
                <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {item.language === 'pt' ? 'PT' : 'EN'}
                </span>
                {item.angle && (
                  <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 truncate max-w-[180px]">
                    {item.angle}
                  </span>
                )}
                {!isPersonal && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                    Metavise
                  </span>
                )}
              </div>
              {/* UX20: nome customizado da copy aparece como título */}
              {isPersonal && (item as PersonalCopyDoc).name && (
                <p className="text-sm font-black text-gray-900 dark:text-gray-50">
                  {(item as PersonalCopyDoc).name}
                </p>
              )}
              <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">
                {item.script.substring(0, 200)}
                {item.script.length > 200 ? '…' : ''}
              </p>
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              {isPersonal && (
                <>
                  <button
                    onClick={() => onToggleStar(item.id, !starred)}
                    className={`p-1.5 rounded-lg ${
                      starred
                        ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                        : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                    title={starred ? 'Desfavoritar' : 'Favoritar'}
                  >
                    <Star size={14} fill={starred ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          'Deletar esta copy da sua biblioteca? A ação não pode ser desfeita.'
                        )
                      ) {
                        onDelete(item.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    title="Deletar"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
              <button
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                title={isExpanded ? 'Recolher' : 'Ver completo'}
              >
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>
          {isExpanded && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
              <pre className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                {item.script}
              </pre>
              {item.whyItWorks && (
                <p className="text-[10px] italic text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-50 dark:border-gray-800">
                  💡 {item.whyItWorks}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-xl">
              <Library size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-900 dark:text-gray-50">
                Biblioteca de Copies
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Exemplos usados pela IA pra gerar suas copies
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-900 dark:hover:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* UX22: status de seleção. Mostra quantas copies estão marcadas
            como referência pra próxima geração. Quando 0, IA escolhe
            automaticamente. */}
        <div className="px-6 pt-4">
          {selectedReferenceIds.length > 0 ? (
            <div className="flex items-center justify-between gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl ring-1 ring-blue-200 dark:ring-blue-800/60">
              <div className="flex items-center gap-2 min-w-0">
                <Target size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <p className="text-xs text-blue-900 dark:text-blue-200">
                  <span className="font-black">
                    {selectedReferenceIds.length}{' '}
                    {selectedReferenceIds.length === 1 ? 'copy marcada' : 'copies marcadas'}
                  </span>{' '}
                  como referência. IA vai usar SÓ{' '}
                  {selectedReferenceIds.length === 1 ? 'essa' : 'essas'} na próxima geração.
                </p>
              </div>
              <button
                onClick={() => {
                  // Limpa todas as seleções: chama toggle pra cada uma
                  selectedReferenceIds.forEach((id) => onToggleReference(id));
                }}
                className="flex-shrink-0 text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 hover:underline"
              >
                Limpar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700/60">
              <Sparkles size={14} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-bold">Auto-seleção ativa.</span> IA escolhe as melhores 2
                copies baseado no tema/persona. Marque copies abaixo (☑) pra forçar quais usar.
              </p>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-4 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setTab('mine')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-black uppercase tracking-widest transition-colors ${
              tab === 'mine'
                ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-50'
            }`}
          >
            <BookOpen size={12} className="inline mr-1.5" />
            Minhas ({personalLibrary.length})
          </button>
          <button
            onClick={() => setTab('system')}
            className={`px-4 py-2.5 rounded-t-xl text-xs font-black uppercase tracking-widest transition-colors ${
              tab === 'system'
                ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-50'
            }`}
          >
            <Sparkles size={12} className="inline mr-1.5" />
            Metavise ({COPY_LIBRARY.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'mine' && (
            <div className="space-y-4">
              {/* UX19: form de upload manual */}
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow transition-all"
                >
                  <Plus size={14} />
                  Adicionar copy manualmente
                </button>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-800/40 rounded-2xl border-2 border-blue-200 dark:border-blue-900/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-200">
                      Nova copy na sua biblioteca
                    </h3>
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        resetForm();
                      }}
                      className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      title="Cancelar"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* UX20: form simplificado — só name + script. IA infere o resto. */}
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 italic">
                    ✨ A IA detecta automaticamente idioma, vertical, nível de consciência e ângulo.
                  </p>

                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 block mb-1">
                      Nome da copy (opcional)
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder='Ex: "Copy 1", "Vencedora outubro", "Hook do podcast"'
                      className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 block mb-1">
                      Texto da copy <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={formScript}
                      onChange={(e) => setFormScript(e.target.value)}
                      placeholder="Cola aqui a copy que você quer que a IA use como referência..."
                      rows={10}
                      className="w-full p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm font-mono leading-relaxed outline-none focus:border-blue-500 resize-y"
                    />
                    <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1 tabular-nums">
                      {formScript.trim().split(/\s+/).filter(Boolean).length} palavras — mínimo 20
                      caracteres
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        resetForm();
                      }}
                      disabled={isAdding}
                      className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSubmitForm}
                      disabled={isAdding || formScript.trim().length < 20}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAdding ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Save size={12} />
                      )}
                      {isAdding ? 'Analisando + salvando...' : 'Salvar na biblioteca'}
                    </button>
                  </div>
                </div>
              )}

              {personalLibrary.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <BookOpen size={32} className="mx-auto text-gray-300 dark:text-gray-700" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Você ainda não tem copies na sua biblioteca.
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md mx-auto">
                    Duas formas de adicionar: (1) clica em "+ Adicionar copy manualmente" aqui em
                    cima pra colar uma copy que você já tem, ou (2) quando gerar uma copy que
                    gostou, clica em "✓ Marcar como copy boa" lá fora. A IA usa as suas como
                    referência nas próximas gerações.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {personalLibrary.map((item) => renderItem(item, true, item.starred))}
                </div>
              )}
            </div>
          )}
          {tab === 'system' && (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-500 dark:text-gray-400 italic pb-2">
                Exemplos curados pela equipe Metavise que a IA usa como referência quando você não
                tem copies próprias da mesma vertical. Não dá pra editar — sua biblioteca pessoal
                substitui essas.
              </p>
              {/* UX19: biblioteca sistema-wide pode estar vazia — empty state */}
              {COPY_LIBRARY.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <Sparkles size={28} className="mx-auto text-gray-300 dark:text-gray-700" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Biblioteca Metavise em construção.
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md mx-auto">
                    Por enquanto sem exemplos curados. A IA usa só sua biblioteca pessoal. Adicione
                    copies suas em "Minhas" pra começar.
                  </p>
                </div>
              ) : (
                COPY_LIBRARY.map((item) => renderItem(item, false))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
