import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Trash2,
  Edit3,
  Tag,
  Sparkles,
  Volume2,
  Layout,
  Video,
  Play,
  Maximize,
  ChevronRight,
  Search,
  X,
  Copy,
} from 'lucide-react';
import type {
  Project,
  ProjectVariant,
  Step,
  CreativeBrief,
  WeightedPersona,
} from '@/types/project';
import { VariantItem } from '@/components/VariantItem';
import { getAuthorizedUrl } from '@/lib/gemini';

type ProjectTypeFilter = 'all' | Project['type'];
type SortMode = 'recent' | 'oldest' | 'name';

// Defined outside the component so the chip-list reference is stable
// across renders (avoids unnecessary re-renders of the filter row).
const TYPE_FILTERS: { value: ProjectTypeFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'complete', label: 'Completo' },
  { value: 'copy', label: 'Copy' },
  { value: 'video', label: 'Vídeo' },
  { value: 'editing', label: 'Edição' },
];

interface ProjectsTabProps {
  projects: Project[];
  currentProjectId: string | null;
  viewingProjectId: string | null;
  setViewingProjectId: (id: string | null) => void;
  viewingVariant: ProjectVariant | null;
  setViewingVariant: (v: ProjectVariant | null) => void;
  platformApiKey: string | null;
  setShowNewProjectModal: (show: boolean) => void;
  onDeleteProject: (id: string) => void;
  onLoadProject: (p: Project) => void;
  /** Blueprint Fase 4 — não é mais usado (botão removido), mas mantido na
   *  interface por compat com App.tsx que ainda passa o handler. */
  onNewSubproject?: (p: Project) => void;
  onLoadVariant: (v: ProjectVariant, step?: Step) => void;
  onDeleteVariant: (pid: string, vid: string) => void | Promise<void>;
  onRenameVariant: (pid: string, vid: string, newName: string) => void | Promise<void>;
  onDeleteAudio: (audio: { url: string; storagePath: string | null }) => void;
  onDeleteVideoFromArray: (video: any) => void | Promise<void>;
  /** Creates a copy of the project with same config and "(cópia)"
   *  suffix; opens it in the Copy step. Wired from App.tsx. */
  onDuplicateProject: (p: Project) => void | Promise<void>;
  /** Blueprint Fase 4 — Porta B: cliente clica num dos 15 briefs da
   *  seção "Dados do Projeto". App.tsx faz o projeto virar current,
   *  abre o popup de confirmação e cria a variant (reusa Fase 3.4). */
  onSelectBriefFromProject?: (p: Project, brief: CreativeBrief) => void;
  /** Blueprint Fase 4 — Porta A: cliente clica em 1 dos 3 personas da
   *  seção "Dados do Projeto" pra criar subprojeto sem passar pelo plano.
   *  Carrega productInfo + persona como base, sem brief associado. */
  onSelectPersonaFromProject?: (p: Project, persona: any) => void;
  /** Blueprint Fase 5 — abre BriefEditModal em mode='create' pra criar
   *  Criativo 16+ (variação grande). Só aparece se o projeto já tem
   *  briefs no plano (faz sentido falar em "16+" só se tem os primeiros). */
  onStartBigVariation?: (p: Project) => void;
}

export function ProjectsTab({
  projects,
  currentProjectId,
  viewingProjectId,
  setViewingProjectId,
  viewingVariant,
  setViewingVariant,
  platformApiKey,
  setShowNewProjectModal,
  onDeleteProject,
  onLoadProject,
  // onNewSubproject removido do destructuring — botão "Novo Subprojeto" não
  // existe mais (Fase 4). Mantido como prop opcional pra compat.
  onLoadVariant,
  onDeleteVariant,
  onRenameVariant,
  onDeleteAudio,
  onDeleteVideoFromArray,
  onDuplicateProject,
  onSelectBriefFromProject,
  onSelectPersonaFromProject,
  onStartBigVariation,
}: ProjectsTabProps) {
  // Search + filter state for the list view. Persisted only in memory —
  // navigating away resets the filters, which is the right default
  // for now (most users search for one project, find it, go in).
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ProjectTypeFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  // Memoized so unrelated parent re-renders don't reapply filters when
  // the project list itself didn't change.
  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = projects;
    if (term) {
      list = list.filter((p) => p.name.toLowerCase().includes(term));
    }
    if (typeFilter !== 'all') {
      list = list.filter((p) => p.type === typeFilter);
    }
    const toDate = (p: Project): number => {
      const v = p.createdAt;
      if (v?.toDate) return v.toDate().getTime();
      if (v?.seconds) return v.seconds * 1000;
      return 0;
    };
    if (sortMode === 'recent') {
      list = [...list].sort((a, b) => toDate(b) - toDate(a));
    } else if (sortMode === 'oldest') {
      list = [...list].sort((a, b) => toDate(a) - toDate(b));
    } else {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    return list;
  }, [projects, search, typeFilter, sortMode]);
  // Detail view: a specific project is selected, show its subprojects and
  // a preview of the currently-viewed variant.
  if (viewingProjectId) {
    const project = projects.find((p) => p.id === viewingProjectId);
    if (!project) {
      setViewingProjectId(null);
      return null;
    }

    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setViewingProjectId(null);
                setViewingVariant(null);
              }}
              className="p-3 bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-800 rounded-2xl text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-100 dark:hover:border-blue-900 transition-all"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
                {project.name}
              </h2>
              <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
                Gerencie as versões e conteúdos deste projeto.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onDeleteProject(project.id)}
              className="px-6 py-3 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center gap-2"
            >
              <Trash2 size={18} />
              Excluir Projeto
            </button>
            <button
              onClick={() => onLoadProject(project)}
              className="px-6 py-3 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all flex items-center gap-2"
            >
              <Edit3 size={18} />
              Abrir no Editor
            </button>
          </div>
        </div>

        {/* Blueprint Fase 4 — "Dados do Projeto": agrupa material da fonte
            (VSL/URL/texto), 3 personas identificadas e 15 briefs sugeridos.
            Nada disso é subprojeto ainda — viram subprojeto SÓ via popup
            quando cliente clica num brief ou persona (Porta A ou Porta B).
            Não renderiza pra projetos legacy sem nenhum desses campos. */}
        <ProjectDataSection
          project={project}
          onSelectBrief={
            onSelectBriefFromProject ? (b) => onSelectBriefFromProject(project, b) : undefined
          }
          onSelectPersona={
            onSelectPersonaFromProject ? (p) => onSelectPersonaFromProject(project, p) : undefined
          }
          onStartBigVariation={onStartBigVariation ? () => onStartBigVariation(project) : undefined}
        />

        <div className="bg-white dark:bg-gray-900/80 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
          <div className="p-8 border-b border-gray-50 bg-gray-50/30 dark:bg-gray-800/60">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest flex items-center gap-2">
                <Tag size={14} /> Subprojetos / Versões ({project.variants?.length || 0})
              </h3>
              {/* Blueprint Fase 4 — "Novo Subprojeto" removido. Subprojetos
                  agora nascem só via 2 portas na seção Dados do Projeto:
                    Porta A → clica em persona → popup → variant
                    Porta B → clica em brief → popup → variant
                  Pra projetos legacy sem dados, a UI fica sem botão de
                  criar variant. Solução futura: oferecer "Gerar Plano"
                  como fallback explícito. */}
            </div>
            <div className="space-y-4">
              {project.variants && project.variants.length > 0 ? (
                project.variants.map((v) => (
                  <VariantItem
                    key={v.id}
                    variant={v}
                    project={project}
                    onLoad={onLoadVariant}
                    onDelete={onDeleteVariant}
                    onRename={onRenameVariant}
                    isViewing={viewingVariant?.id === v.id}
                    onView={setViewingVariant}
                    platformApiKey={platformApiKey}
                    onDeleteAudio={(audio) =>
                      onDeleteAudio({ url: audio.url, storagePath: audio.storagePath })
                    }
                    onDeleteVideo={onDeleteVideoFromArray}
                  />
                ))
              ) : (
                <div className="p-12 text-center bg-white dark:bg-gray-900/80 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-800">
                  <p className="text-gray-400 dark:text-gray-500 font-bold">
                    Nenhuma versão arquivada ainda.
                  </p>
                </div>
              )}
            </div>
          </div>

          {viewingVariant && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-8 space-y-12"
            >
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center">
                    <Edit3 size={16} />
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest text-xs">
                    Formulário Preenchido
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(viewingVariant.config.copy.answers).map(([key, value]) => {
                    if (key === 'existingCopy' || !value) return null;
                    return (
                      <div
                        key={key}
                        className="p-4 bg-gray-50 dark:bg-gray-800/60 rounded-2xl border border-gray-200 dark:border-gray-800"
                      >
                        <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
                          {key}
                        </p>
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center">
                    <Sparkles size={16} />
                  </div>
                  <h4 className="font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest text-xs">
                    Conteúdo Gerado
                  </h4>
                </div>

                {viewingVariant.config.videoUrl && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                      Vídeo Finalizado
                    </p>
                    <div className="aspect-video w-full max-w-2xl mx-auto bg-black rounded-[32px] overflow-hidden shadow-2xl border-4 border-white">
                      <video
                        src={
                          getAuthorizedUrl(
                            viewingVariant.config.videoUrl || '',
                            platformApiKey || undefined
                          ) || undefined
                        }
                        controls
                        className="w-full h-full object-contain"
                        referrerPolicy={
                          viewingVariant.config.videoUrl?.includes(
                            'generativelanguage.googleapis.com'
                          )
                            ? ('no-referrer' as const)
                            : undefined
                        }
                        crossOrigin={
                          viewingVariant.config.videoUrl?.includes(
                            'generativelanguage.googleapis.com'
                          )
                            ? ('anonymous' as const)
                            : undefined
                        }
                        onError={(e) => {
                          if (viewingVariant.config.videoUrl?.startsWith('/generated/')) {
                            console.warn(
                              '[Video Expired] Viewing Variant:',
                              viewingVariant.config.videoUrl
                            );
                            e.currentTarget.style.display = 'none';
                          } else {
                            console.error(
                              '[Video Error] Viewing Variant:',
                              e.currentTarget.error?.message,
                              viewingVariant.config.videoUrl
                            );
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                {viewingVariant.config.copy.generatedScript ? (
                  <div className="space-y-6">
                    {viewingVariant.config.copy.generatedHooks &&
                      viewingVariant.config.copy.generatedHooks.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {viewingVariant.config.copy.generatedHooks.map((hook: any, i: number) => {
                            const hookText = typeof hook === 'object' ? hook.texto : hook;
                            return (
                              <div
                                key={`variant-hook-${i}-${hookText}`}
                                className="p-4 bg-amber-50/50 dark:bg-amber-950/40 rounded-2xl border border-amber-100"
                              >
                                <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-2">
                                  Hook {i + 1}
                                </p>
                                <p className="text-sm font-medium text-gray-800 italic">
                                  "{hookText}"
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    <div className="space-y-4">
                      <div className="p-8 bg-gray-100 dark:bg-gray-800 text-gray-800 rounded-[32px] shadow-sm relative overflow-hidden border-2 border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">
                          Copy Original
                        </p>
                        <p className="text-sm font-medium leading-relaxed relative z-10 whitespace-pre-wrap">
                          {viewingVariant.config.copy.generatedScript}
                        </p>
                      </div>

                      {viewingVariant.config.copy.optimizedScript && (
                        <div className="p-8 bg-gray-900 text-white rounded-[32px] shadow-2xl relative overflow-hidden border-4 border-amber-400">
                          <div className="absolute top-0 right-0 p-4 opacity-10">
                            <Volume2 size={80} />
                          </div>
                          <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-4">
                            Copy Otimizada (ElevenLabs)
                          </p>
                          <p className="text-lg font-medium leading-relaxed relative z-10 whitespace-pre-wrap">
                            {viewingVariant.config.copy.optimizedScript}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center bg-gray-50 dark:bg-gray-800/60 rounded-[32px] border-2 border-dashed border-gray-200 dark:border-gray-700">
                    <p className="text-gray-400 dark:text-gray-500 font-bold">
                      Nenhum conteúdo gerado para esta versão.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  // List view: shows all projects in a grid + create-new button.
  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            Meus Projetos
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Gerencie seus projetos e criações.
          </p>
        </div>
        <button
          onClick={() => setShowNewProjectModal(true)}
          className="px-5 py-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-bold hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20 flex items-center gap-2"
        >
          <Sparkles size={16} />
          Criar Novo Projeto
        </button>
      </div>

      {/* Search + filter row — hidden when there are 0 projects so the
          empty state below dominates. Shown otherwise even with a small
          list because muscle memory is more important than minimalism. */}
      {projects.length > 0 && (
        <div className="bg-white/80 dark:bg-gray-900/60 p-3.5 rounded-2xl ring-1 ring-gray-200/60 dark:ring-gray-800/60 shadow-sm flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-500"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo nome…"
              className="w-full pl-11 pr-10 py-3 bg-gray-50 dark:bg-gray-800/60 border border-transparent rounded-xl text-sm focus:bg-white dark:focus:bg-gray-800 focus:border-blue-400 dark:focus:border-blue-700 outline-none transition-all text-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300"
                title="Limpar"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                  typeFilter === f.value
                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-300 shadow-sm'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border border-transparent rounded-xl text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 focus:bg-white dark:focus:bg-gray-800 focus:border-blue-400 dark:focus:border-blue-700 outline-none cursor-pointer"
          >
            <option value="recent">Mais recente</option>
            <option value="oldest">Mais antigo</option>
            <option value="name">Nome (A–Z)</option>
          </select>

          {(search || typeFilter !== 'all') && (
            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest ml-auto">
              {filteredProjects.length} de {projects.length}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.length === 0 ? (
          <div className="col-span-full p-14 bg-white/60 dark:bg-gray-900/40 rounded-3xl ring-1 ring-dashed ring-gray-300/60 dark:ring-gray-700/60 flex flex-col items-center justify-center text-center space-y-5">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 text-blue-500 dark:text-blue-400 rounded-2xl flex items-center justify-center ring-1 ring-blue-100/60 dark:ring-blue-900/40">
              <Layout size={28} />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
                Nenhum projeto encontrado
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Comece criando seu primeiro projeto agora mesmo.
              </p>
            </div>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-6 py-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-bold hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30"
            >
              Criar Primeiro Projeto
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="col-span-full p-10 bg-white/60 dark:bg-gray-900/40 rounded-3xl ring-1 ring-dashed ring-gray-300/60 dark:ring-gray-700/60 text-center space-y-3">
            <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
              Nenhum projeto bate com sua busca
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tente outro termo ou limpe os filtros.
            </p>
            <button
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
              }}
              className="mt-2 px-5 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          filteredProjects.map((project) => {
            const isActive = currentProjectId === project.id;
            return (
              <div
                key={project.id}
                className={`group relative p-5 rounded-2xl ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-gray-200/60 dark:hover:shadow-black/40 cursor-pointer bg-white dark:bg-gray-900/80 ${
                  isActive
                    ? 'ring-blue-500/60 dark:ring-blue-400/60 shadow-lg shadow-blue-500/10 dark:shadow-blue-900/30'
                    : 'ring-gray-200/60 dark:ring-gray-800/60 hover:ring-blue-200 dark:hover:ring-blue-800/60'
                }`}
                onClick={() => setViewingProjectId(project.id)}
              >
                {isActive && (
                  <span className="absolute top-3 right-3 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-blue-500 text-white rounded-full shadow shadow-blue-500/40">
                    Ativo
                  </span>
                )}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 dark:text-blue-400 dark:from-blue-950/40 dark:to-blue-900/30 dark:text-blue-400 rounded-xl flex items-center justify-center ring-1 ring-blue-100/60 dark:ring-blue-900/40 group-hover:from-blue-500 group-hover:to-blue-600 group-hover:text-white group-hover:ring-blue-400 transition-all">
                    {project.type === 'complete' ? (
                      <Video size={22} />
                    ) : project.type === 'copy' ? (
                      <Edit3 size={22} />
                    ) : project.type === 'video' ? (
                      <Play size={22} />
                    ) : (
                      <Maximize size={22} />
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDuplicateProject(project);
                      }}
                      className="p-1.5 text-gray-300 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors"
                      title="Duplicar Projeto"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project.id);
                      }}
                      className="p-1.5 text-gray-300 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                      title="Excluir Projeto"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <h4 className="text-base font-black text-gray-900 dark:text-gray-50 mb-1 truncate">
                  {project.name}
                </h4>
                <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-4">
                  {project.type === 'complete'
                    ? 'Projeto Completo'
                    : project.type === 'copy'
                      ? 'Apenas Copy'
                      : project.type === 'video'
                        ? 'Apenas Vídeo'
                        : 'Edição de Vídeo'}
                </p>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest">
                    {project.createdAt?.toDate
                      ? project.createdAt.toDate().toLocaleDateString()
                      : 'Recentemente'}
                  </span>
                  <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-bold text-xs">
                    Subprojetos ({project.variants?.length || 0})
                    <ChevronRight
                      size={14}
                      className="group-hover:translate-x-0.5 transition-transform"
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Blueprint Fase 4 ────────────────────────────────────────────────
// "Dados do Projeto" — agrupa material extraído + personas + briefs.
// Decoupled from the parent for clarity; reads everything from project.config.
// Renders 3 subseções condicionais (só aparece se há dados pra mostrar):
//   1. Material da fonte (VSL URL, sourceText snippet, productInfo extraído)
//   2. 3 Personas identificadas (cards clicáveis → Porta A)
//   3. 15 Briefs sugeridos (lista bullet vertical → Porta B)
// Fallback graceful pra projetos sem nenhum dado.
function ProjectDataSection({
  project,
  onSelectBrief,
  onSelectPersona,
  onStartBigVariation,
}: {
  project: Project;
  onSelectBrief?: (brief: CreativeBrief) => void;
  onSelectPersona?: (persona: any) => void;
  /** Blueprint Fase 5 — clica no CTA "Criar variação grande" abaixo dos briefs.
   *  Só aparece se há pelo menos 1 brief no plano. */
  onStartBigVariation?: () => void;
}) {
  const cfg: any = project.config || {};
  const copy: any = cfg.copy || {};
  const productInfo: any = copy.productInfo || null;
  const sourceText: string = copy.sourceText || '';
  const briefs: CreativeBrief[] = Array.isArray(copy.creativeBriefs) ? copy.creativeBriefs : [];
  const personas: WeightedPersona[] = Array.isArray(copy.personasWithWeights)
    ? copy.personasWithWeights
    : [];

  // Variant lookup pra marcar brief executado (✓) vs pendente (○).
  // Reusa a mesma regra do PlanTab/handleBriefClick: brief.id === variant.id
  // OU brief.executedVariantId === variant.id.
  const variants: ProjectVariant[] = project.variants || [];
  const isBriefExecuted = (briefId: string): boolean =>
    variants.some(
      (v: any) =>
        v?.brief?.id === briefId ||
        (v as any)?.id === briefId ||
        (v as any)?.id === (briefs.find((b) => b.id === briefId) as any)?.executedVariantId
    );

  // Esconde a seção inteira se o projeto não tem nada disso. Pra projetos
  // legacy isso é o caso normal. Quando a UI da Fase 4 estiver completa,
  // adicionaremos um CTA "Gerar Plano agora" aqui.
  const hasSource = !!productInfo || !!sourceText.trim();
  const hasPersonas = personas.length > 0;
  const hasBriefs = briefs.length > 0;
  if (!hasSource && !hasPersonas && !hasBriefs) return null;

  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
      <div className="p-8 space-y-8">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
          <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
            Dados do Projeto
          </h3>
        </div>

        {hasSource && (
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
              🎬 Material da fonte
            </h4>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 space-y-2 ring-1 ring-gray-200/60 dark:ring-gray-700/60">
              {productInfo?.productName && (
                <div className="text-xs">
                  <span className="font-bold text-gray-900 dark:text-gray-100">Produto: </span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {productInfo.productName}
                  </span>
                </div>
              )}
              {productInfo?.offer && (
                <div className="text-xs">
                  <span className="font-bold text-gray-900 dark:text-gray-100">Oferta: </span>
                  <span className="text-gray-700 dark:text-gray-300">{productInfo.offer}</span>
                </div>
              )}
              {productInfo?.mainPain && (
                <div className="text-xs">
                  <span className="font-bold text-gray-900 dark:text-gray-100">
                    Dor principal:{' '}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300">{productInfo.mainPain}</span>
                </div>
              )}
              {sourceText && (
                <div className="text-[10px] text-gray-500 dark:text-gray-500 italic pt-2 border-t border-gray-200 dark:border-gray-700">
                  Texto fonte: {sourceText.length.toLocaleString()} caracteres
                </div>
              )}
            </div>
          </section>
        )}

        {hasPersonas && (
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
              👥 Personas identificadas ({personas.length})
              {onSelectPersona && (
                <span className="ml-2 normal-case font-medium text-gray-400 dark:text-gray-500">
                  · clique pra criar subprojeto
                </span>
              )}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {personas.map((p: any) => {
                const conf =
                  typeof p?.confidence === 'number' ? `${Math.round(p.confidence * 100)}%` : null;
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectPersona?.(p)}
                    disabled={!onSelectPersona}
                    className="text-left bg-gradient-to-br from-blue-50/50 to-purple-50/30 dark:from-blue-950/30 dark:to-purple-950/20 rounded-2xl p-4 space-y-2 ring-1 ring-blue-200/60 dark:ring-blue-800/40 hover:ring-blue-500 dark:hover:ring-blue-500 hover:shadow-md transition-all disabled:cursor-default disabled:hover:ring-blue-200/60 disabled:hover:shadow-none"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-black text-gray-900 dark:text-gray-100 leading-tight">
                        {p.label || p.name || 'Persona'}
                      </p>
                      {conf && (
                        <span className="shrink-0 px-1.5 py-0.5 bg-white dark:bg-gray-900 rounded text-[9px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                          {conf}
                        </span>
                      )}
                    </div>
                    {p?.raw?.mainPain && (
                      <p className="text-[10px] text-gray-600 dark:text-gray-400 line-clamp-2">
                        {p.raw.mainPain}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {hasBriefs && (
          <section className="space-y-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
              💡 Sugestões de criativos ({briefs.length})
              {onSelectBrief && (
                <span className="ml-2 normal-case font-medium text-gray-400 dark:text-gray-500">
                  · clique pra criar subprojeto
                </span>
              )}
            </h4>
            <ol className="space-y-1.5">
              {briefs.map((b, idx) => {
                const executed = isBriefExecuted(b.id);
                return (
                  <li key={b.id}>
                    <button
                      onClick={() => onSelectBrief?.(b)}
                      disabled={!onSelectBrief}
                      className="w-full text-left flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-blue-50 dark:hover:bg-blue-950/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60 hover:ring-blue-500 dark:hover:ring-blue-500 transition-all disabled:cursor-default disabled:hover:bg-gray-50 disabled:hover:ring-gray-200/60"
                    >
                      <span className="shrink-0 w-7 h-7 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center text-[10px] font-black text-gray-600 dark:text-gray-300 ring-1 ring-gray-200 dark:ring-gray-700">
                        {executed ? '✓' : idx + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100 leading-tight">
                          {b.hook?.substring(0, 80) || 'Brief sem hook'}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-2">
                          <span>{b.angle}</span>
                          <span>·</span>
                          <span>{b.style}</span>
                          <span>·</span>
                          <span>{b.durationTarget}s</span>
                          {executed && (
                            <>
                              <span>·</span>
                              <span className="text-green-700 dark:text-green-400 font-bold">
                                executado
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Blueprint Fase 5 — CTA Criativo 16+. Só aparece se já há
                briefs no plano (faz sentido falar em "16+" só depois dos
                primeiros). Estilo amber pra reforçar que é exceção, não
                regra: cliente deve esgotar os 15 antes de partir pra cá. */}
            {onStartBigVariation && (
              <button
                onClick={onStartBigVariation}
                className="w-full mt-2 px-4 py-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-300 dark:ring-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-950/50 hover:ring-amber-500 transition-all flex items-center justify-center gap-2 group"
              >
                <Sparkles
                  size={14}
                  className="text-amber-700 dark:text-amber-400 group-hover:scale-110 transition-transform"
                />
                <span className="text-xs font-black uppercase tracking-widest text-amber-900 dark:text-amber-200">
                  Criar Criativo {briefs.length + 1} (variação grande)
                </span>
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
