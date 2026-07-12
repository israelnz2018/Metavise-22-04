import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { Sparkles, Plus, Trash2, Upload, Loader2, X } from 'lucide-react';
import { unzipSync } from 'fflate';
import { improveCopyWithSkill } from '@/lib/claudeService';
import {
  loadCopySkills,
  addCopySkill,
  deleteCopySkill,
  type CopySkill,
} from '@/lib/copySkills';

interface Props {
  /** Copy atual (a que será melhorada). */
  script: string;
  /** Respostas da copy (idioma, etc.) — passadas pra skill manter o contexto. */
  answers?: Record<string, any>;
  /** Aplica um texto novo na copy (o pai troca o script). */
  onApply: (text: string) => void;
  disabled?: boolean;
}

/**
 * Estágio 2 — "Melhorar com skill". Lista as skills que o usuário adicionou
 * (localStorage), deixa adicionar/excluir, e aplica a escolhida POR CIMA da copy
 * gerada. O resultado SUBSTITUI a copy, com botão Desfazer.
 */
export function CopySkillsButton({ script, answers, onApply, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<CopySkill[]>(() => loadCopySkills());
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');

  const hasScript = !!script && !!script.trim();

  const onUploadFile = async (file?: File | null) => {
    if (!file) return;
    const isZip =
      /\.zip$/i.test(file.name) ||
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed';
    try {
      let text = '';
      let suggestedName = file.name.replace(/\.(md|txt|zip)$/i, '');

      if (isZip) {
        // Skills baixadas vêm zipadas (uma pasta com SKILL.md dentro).
        const buf = new Uint8Array(await file.arrayBuffer());
        const entries = unzipSync(buf);
        const names = Object.keys(entries);
        const pick =
          names.find((n) => n.split('/').pop()?.toLowerCase() === 'skill.md') ||
          names.find((n) => /\.md$/i.test(n)) ||
          names.find((n) => /\.txt$/i.test(n));
        if (!pick) {
          toast.error('O .zip não tem SKILL.md (nem .md/.txt) dentro.');
          return;
        }
        text = new TextDecoder().decode(entries[pick]!);
        const folder = pick.split('/')[0];
        if (folder && folder !== pick) suggestedName = folder;
      } else {
        text = await file.text();
      }

      // Nome melhor a partir do frontmatter "name:" do SKILL.md, se houver.
      const fm = text.match(/^\s*name:\s*(.+)\s*$/m);
      if (fm && fm[1]) suggestedName = fm[1].trim().replace(/^["']|["']$/g, '');

      setNewContent(text);
      if (!newName.trim()) setNewName(suggestedName);
      toast.success('Arquivo carregado — confira e salve.');
    } catch (e: any) {
      toast.error(e?.message || 'Não consegui ler o arquivo (zip inválido?).');
    }
  };

  const handleAdd = () => {
    if (!newName.trim() || !newContent.trim()) {
      toast.error('Dê um nome e cole/envie o conteúdo da skill.');
      return;
    }
    setSkills(addCopySkill(newName, newContent));
    setNewName('');
    setNewContent('');
    setAdding(false);
    toast.success('Skill adicionada.');
  };

  const handleDelete = (id: string) => {
    setSkills(deleteCopySkill(id));
  };

  const handleApply = async (skill: CopySkill) => {
    if (!hasScript) {
      toast.error('Gere uma copy primeiro.');
      return;
    }
    const previous = script;
    setApplyingId(skill.id);
    const toastId = 'improve-skill';
    toast.loading(`Aplicando "${skill.name}"...`, { id: toastId });
    try {
      const improved = await improveCopyWithSkill({
        script,
        skillName: skill.name,
        skillContent: skill.content,
        answers,
      });
      if (improved && improved.trim() && improved.trim() !== previous.trim()) {
        onApply(improved);
        setOpen(false);
        toast.success(
          (t) => (
            <span className="flex items-center gap-3">
              Copy melhorada com "{skill.name}" ✨
              <button
                onClick={() => {
                  onApply(previous);
                  toast.dismiss(t.id);
                  toast.success('Desfeito');
                }}
                className="px-2 py-1 rounded-lg bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest"
              >
                Desfazer
              </button>
            </span>
          ),
          { id: toastId, duration: 8000 }
        );
      } else {
        toast.success('A skill não mudou nada relevante.', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao aplicar a skill.', { id: toastId });
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
        title="Aplica uma skill que você adicionou (guia, framework, estilo) por cima da copy pra melhorá-la de verdade. Substitui com Desfazer."
      >
        <Sparkles size={12} />
        Melhorar com skill
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-80 max-w-[90vw] right-0 bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
              Suas skills
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X size={14} />
            </button>
          </div>

          {skills.length === 0 && !adding && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 py-2">
              Nenhuma skill ainda. Adicione uma (cole o texto ou envie um .md/.txt) pra melhorar a
              copy por cima.
            </p>
          )}

          <div className="max-h-52 overflow-auto space-y-1.5">
            {skills.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 p-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-700"
              >
                <span
                  className="flex-1 text-xs font-bold text-gray-800 dark:text-gray-100 truncate"
                  title={s.name}
                >
                  {s.name}
                </span>
                <button
                  onClick={() => handleApply(s)}
                  disabled={!hasScript || applyingId !== null}
                  className="px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center gap-1"
                >
                  {applyingId === s.id ? <Loader2 size={11} className="animate-spin" /> : null}
                  Aplicar
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="text-gray-400 hover:text-red-500"
                  title="Excluir skill"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {adding ? (
            <div className="space-y-2 pt-1">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome da skill (ex.: Ganchos Stefan Georgi)"
                className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs dark:text-gray-100"
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Cole aqui o texto da skill (instruções/framework/estilo)…"
                rows={5}
                className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs dark:text-gray-100 resize-y"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300 hover:underline cursor-pointer flex items-center gap-1">
                  <Upload size={11} />
                  Enviar .md/.txt/.zip
                  <input
                    type="file"
                    accept=".md,.txt,.zip,text/markdown,text/plain,application/zip,application/x-zip-compressed"
                    className="hidden"
                    onChange={(e) => onUploadFile(e.target.files?.[0])}
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setAdding(false);
                      setNewName('');
                      setNewContent('');
                    }}
                    className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:underline"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleAdd}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                  >
                    Salvar skill
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:border-violet-400 hover:text-violet-600"
            >
              <Plus size={12} />
              Adicionar skill
            </button>
          )}
        </div>
      )}
    </div>
  );
}
