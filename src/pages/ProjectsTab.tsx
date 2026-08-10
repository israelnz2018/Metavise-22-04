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
  ChevronDown,
  Search,
  X,
  Copy,
  Plus,
} from 'lucide-react';
import type {
  Project,
  ProjectVariant,
  Step,
  CreativeBrief,
  WeightedPersona,
} from '@/types/project';
import { VariantItem } from '@/components/VariantItem';
import { CreativeInfoButton } from '@/components/CreativeInfoButton';
import { getAuthorizedUrl } from '@/lib/gemini';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type ProjectTypeFilter = 'all' | Project['type'];
type SortMode = 'recent' | 'oldest' | 'name';

// Defined outside the component so the array reference is stable across
// renders (avoids unnecessary re-renders of the filter row). Labels come
// from t.projects.filters[value] at render time (needs the current language).
const TYPE_FILTER_VALUES: ProjectTypeFilter[] = ['all', 'complete', 'copy', 'video', 'editing'];

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
  onLoadVariant: (v: ProjectVariant, step?: Step, projectId?: string) => void;
  onDeleteVariant: (pid: string, vid: string) => void | Promise<void>;
  onRenameVariant: (pid: string, vid: string, newName: string) => void | Promise<void>;
  onRenameProject: (pid: string, newName: string) => void | Promise<void>;
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
  /** Catálogo HeyGen carregado no App — resolve nome/preview do avatar
   *  no painel de info (criativos antigos só salvaram o id). */
  heygenAvatars?: any[];
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
  onNewSubproject,
  onLoadVariant,
  onDeleteVariant,
  onRenameVariant,
  onRenameProject,
  onDeleteAudio,
  onDeleteVideoFromArray,
  onDuplicateProject,
  onSelectBriefFromProject,
  onSelectPersonaFromProject,
  heygenAvatars = [],
}: ProjectsTabProps) {
  const { t } = useLanguage();
  // Search + filter state for the list view. Persisted only in memory —
  // navigating away resets the filters, which is the right default
  // for now (most users search for one project, find it, go in).
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ProjectTypeFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  // Edição inline do NOME do projeto (mesmo padrão do subprojeto).
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const [projectRenameValue, setProjectRenameValue] = useState('');

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

    // Planejamento "feito" = já tem personas ou plano gerado. Sem isso, o
    // projeto ainda não tem estratégia, então criar subprojeto não faz
    // sentido — o cliente precisa ir pro Planejamento primeiro.
    const planningCopy: any = project.config?.copy || {};
    const hasPlanning =
      (Array.isArray(planningCopy.personasWithWeights) &&
        planningCopy.personasWithWeights.length > 0) ||
      (Array.isArray(planningCopy.creativeBriefs) && planningCopy.creativeBriefs.length > 0);

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
              {isRenamingProject ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={projectRenameValue}
                    onChange={(e) => setProjectRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (projectRenameValue.trim() && projectRenameValue !== project.name) {
                          onRenameProject(project.id, projectRenameValue);
                        }
                        setIsRenamingProject(false);
                      } else if (e.key === 'Escape') {
                        setIsRenamingProject(false);
                      }
                    }}
                    autoFocus
                    className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight border-2 border-blue-400 rounded-xl px-3 py-1 outline-none bg-white dark:bg-gray-900"
                  />
                  <button
                    onClick={() => {
                      if (projectRenameValue.trim() && projectRenameValue !== project.name) {
                        onRenameProject(project.id, projectRenameValue);
                      }
                      setIsRenamingProject(false);
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all"
                  >
                    {t.projects.detail.save}
                  </button>
                  <button
                    onClick={() => setIsRenamingProject(false)}
                    className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                  >
                    {t.projects.detail.cancel}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
                    {project.name}
                  </h2>
                  <button
                    onClick={() => {
                      setProjectRenameValue(project.name);
                      setIsRenamingProject(true);
                    }}
                    className="p-1.5 rounded-lg text-gray-300 dark:text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all"
                    title={t.projects.detail.renameProjectTitle}
                  >
                    <Edit3 size={18} />
                  </button>
                </div>
              )}
              <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
                {t.projects.detail.subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onDeleteProject(project.id)}
              className="px-6 py-3 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center gap-2"
            >
              <Trash2 size={18} />
              {t.projects.detail.deleteProject}
            </button>
            <button
              onClick={() => onLoadProject(project)}
              className="px-6 py-3 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all flex items-center gap-2"
            >
              <Edit3 size={18} />
              {t.projects.detail.openInEditor}
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
          onReviewPlan={() => onLoadProject(project)}
        />

        <div className="bg-white dark:bg-gray-900/80 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
          <div className="p-8 border-b border-gray-50 bg-gray-50/30 dark:bg-gray-800/60">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest flex items-center gap-2">
                <Tag size={14} />{' '}
                {t.projects.detail.subprojectsHeading(project.variants?.length || 0)}
              </h3>
              {/* Botão "Adicionar Subprojeto" só aparece DEPOIS do
                  planejamento (personas/plano). Sem estratégia não faz
                  sentido criar criativo — abaixo mostramos o aviso pra ir
                  pro Planejamento primeiro. */}
              {onNewSubproject && hasPlanning && (
                <button
                  onClick={() => onNewSubproject(project)}
                  className="px-4 py-2 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-bold text-xs hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20 flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  {t.projects.detail.addSubproject}
                </button>
              )}
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
                    heygenAvatars={heygenAvatars}
                  />
                ))
              ) : hasPlanning ? (
                <div className="p-12 text-center bg-white dark:bg-gray-900/80 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-800">
                  <p className="text-gray-400 dark:text-gray-500 font-bold">
                    {t.projects.detail.noVersionsYet}
                  </p>
                </div>
              ) : (
                // Sem planejamento ainda → guia o cliente pro Planejamento
                // em vez de oferecer criar subprojeto sem estratégia.
                <div className="p-12 text-center bg-white dark:bg-gray-900/80 rounded-3xl border-2 border-dashed border-blue-200 dark:border-blue-900/50 space-y-4">
                  <p className="text-gray-700 dark:text-gray-300 font-bold">
                    {t.projects.detail.noPlanningTitle}
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto">
                    {t.projects.detail.noPlanningBody}
                  </p>
                  <button
                    onClick={() => onLoadProject(project)}
                    className="px-6 py-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl font-bold hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20 inline-flex items-center gap-2"
                  >
                    <Sparkles size={16} />
                    {t.projects.detail.doPlanning}
                  </button>
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
                    {t.projects.detail.filledForm}
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
                    {t.projects.detail.generatedContent}
                  </h4>
                </div>

                {viewingVariant.config.videoUrl && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                      {t.projects.detail.finalVideo}
                    </p>
                    <div className="relative aspect-video w-full max-w-2xl mx-auto bg-black rounded-[32px] overflow-hidden shadow-2xl border-4 border-white">
                      <CreativeInfoButton
                        variant={viewingVariant}
                        heygenAvatars={heygenAvatars}
                        placement="overlay"
                      />
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
                                  {t.projects.detail.hookLabel(i + 1)}
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
                          {t.projects.detail.originalCopy}
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
                            {t.projects.detail.optimizedCopy}
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
                      {t.projects.detail.noGeneratedContent}
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
            {t.projects.list.title}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t.projects.list.subtitle}</p>
        </div>
        <button
          onClick={() => setShowNewProjectModal(true)}
          className="px-5 py-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-bold hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20 flex items-center gap-2"
        >
          <Sparkles size={16} />
          {t.projects.list.createNew}
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
              placeholder={t.projects.list.searchPlaceholder}
              className="w-full pl-11 pr-10 py-3 bg-gray-50 dark:bg-gray-800/60 border border-transparent rounded-xl text-sm focus:bg-white dark:focus:bg-gray-800 focus:border-blue-400 dark:focus:border-blue-700 outline-none transition-all text-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-300"
                title={t.projects.list.clearSearch}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl">
            {TYPE_FILTER_VALUES.map((value) => (
              <button
                key={value}
                onClick={() => setTypeFilter(value)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                  typeFilter === value
                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-300 shadow-sm'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {t.projects.filters[value]}
              </button>
            ))}
          </div>

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border border-transparent rounded-xl text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 focus:bg-white dark:focus:bg-gray-800 focus:border-blue-400 dark:focus:border-blue-700 outline-none cursor-pointer"
          >
            <option value="recent">{t.projects.list.sortRecent}</option>
            <option value="oldest">{t.projects.list.sortOldest}</option>
            <option value="name">{t.projects.list.sortName}</option>
          </select>

          {(search || typeFilter !== 'all') && (
            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest ml-auto">
              {t.projects.list.filteredCount(filteredProjects.length, projects.length)}
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
                {t.projects.list.emptyTitle}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t.projects.list.emptyBody}
              </p>
            </div>
            {/* Onboarding leve: 3 passos do que vem pela frente. */}
            <div className="flex flex-col sm:flex-row gap-3 text-left max-w-2xl">
              {[
                [t.projects.list.onboardingStep1Title, t.projects.list.onboardingStep1Body],
                [t.projects.list.onboardingStep2Title, t.projects.list.onboardingStep2Body],
                [t.projects.list.onboardingStep3Title, t.projects.list.onboardingStep3Body],
              ].map(([title, d]) => (
                <div
                  key={title}
                  className="flex-1 bg-white/70 dark:bg-gray-900/40 rounded-xl p-3 ring-1 ring-gray-200/60 dark:ring-gray-800/60"
                >
                  <p className="text-[11px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">
                    {title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{d}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-6 py-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl font-bold hover:from-blue-600 hover:to-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30"
            >
              {t.projects.list.createFirst}
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="col-span-full p-10 bg-white/60 dark:bg-gray-900/40 rounded-3xl ring-1 ring-dashed ring-gray-300/60 dark:ring-gray-700/60 text-center space-y-3">
            <p className="text-lg font-bold text-gray-900 dark:text-gray-50">
              {t.projects.list.noMatchTitle}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t.projects.list.noMatchBody}
            </p>
            <button
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
              }}
              className="mt-2 px-5 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black dark:hover:bg-white transition-colors"
            >
              {t.projects.list.clearFilters}
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
                    {t.projects.list.active}
                  </span>
                )}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center ring-1 ring-blue-100/60 dark:ring-blue-900/40 group-hover:from-blue-500 group-hover:to-blue-600 group-hover:text-white group-hover:ring-blue-400 transition-all">
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
                      title={t.projects.list.duplicateProject}
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProject(project.id);
                      }}
                      className="p-1.5 text-gray-300 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                      title={t.projects.list.deleteProject}
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
                    ? t.projects.list.typeComplete
                    : project.type === 'copy'
                      ? t.projects.list.typeCopyOnly
                      : project.type === 'video'
                        ? t.projects.list.typeVideoOnly
                        : t.projects.list.typeEditing}
                </p>

                <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-widest">
                    {project.createdAt?.toDate
                      ? project.createdAt.toDate().toLocaleDateString()
                      : t.projects.list.recently}
                  </span>
                  <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-bold text-xs">
                    {t.projects.list.subprojectsCount(project.variants?.length || 0)}
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
  onReviewPlan,
}: {
  project: Project;
  onSelectBrief?: (brief: CreativeBrief) => void;
  onSelectPersona?: (persona: any) => void;
  /** Abre o projeto na aba Planejamento pra revisar/editar a estratégia
   *  completa (material, persona, plano) — onde tudo isso já é editável. */
  onReviewPlan?: () => void;
}) {
  const { t } = useLanguage();
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

  // UX5: bloco fica colapsado por default — antes ocupava metade da tela
  // mesmo quando o user só queria ver os subprojetos. Botão no header
  // abre/fecha; chips ao lado mostram resumo do que tem dentro.
  // (useState DEVE vir antes de qualquer early return — rules of hooks.)
  const [isExpanded, setIsExpanded] = useState(false);

  // Esconde a seção inteira se o projeto não tem nada disso. Pra projetos
  // legacy isso é o caso normal. Quando a UI da Fase 4 estiver completa,
  // adicionaremos um CTA "Gerar Plano agora" aqui.
  const hasSource = !!productInfo || !!sourceText.trim();
  const hasPersonas = personas.length > 0;
  const hasBriefs = briefs.length > 0;
  if (!hasSource && !hasPersonas && !hasBriefs) return null;

  // Resumo textual do que está dentro — mostrado quando colapsado pra
  // dar contexto sem precisar abrir.
  const summaryChips: { label: string; color: string }[] = [];
  if (productInfo?.productName) {
    summaryChips.push({
      label: productInfo.productName,
      color:
        'bg-gradient-to-br from-indigo-50 to-purple-50/60 dark:from-indigo-950/40 dark:to-purple-950/30 text-indigo-700 dark:text-indigo-300 ring-indigo-200/60 dark:ring-indigo-800/40',
    });
  }
  if (hasPersonas) {
    summaryChips.push({
      label: `${personas.length} persona${personas.length > 1 ? 's' : ''}`,
      color:
        'bg-gradient-to-br from-blue-50 to-purple-50/30 dark:from-blue-950/30 dark:to-purple-950/20 text-blue-700 dark:text-blue-300 ring-blue-200/60 dark:ring-blue-800/40',
    });
  }
  if (hasBriefs) {
    const executedCount = briefs.filter((b) => isBriefExecuted(b.id)).length;
    summaryChips.push({
      label: `${briefs.length} criativo${briefs.length > 1 ? 's' : ''}${
        executedCount > 0 ? ` · ${executedCount} executado${executedCount > 1 ? 's' : ''}` : ''
      }`,
      color:
        'bg-gradient-to-br from-amber-50 to-orange-50/60 dark:from-amber-950/30 dark:to-orange-950/20 text-amber-700 dark:text-amber-300 ring-amber-200/60 dark:ring-amber-800/40',
    });
  }

  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
      {/* Header sempre visível — clicável pra expandir/recolher.
          Mostra resumo (chips) à direita pro user saber o que tem dentro
          sem precisar abrir. */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-3 p-6 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors text-left"
      >
        <Sparkles size={18} className="text-purple-600 dark:text-purple-400 flex-shrink-0" />
        <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest flex-shrink-0">
          {t.projects.dataSection.heading}
        </h3>
        {/* Chips resumo — somem em telas pequenas pra não quebrar */}
        <div className="hidden sm:flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {summaryChips.map((c) => (
            <span
              key={c.label}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 truncate max-w-[180px] ${c.color}`}
            >
              {c.label}
            </span>
          ))}
        </div>
        <ChevronDown
          size={18}
          className={`text-gray-400 dark:text-gray-500 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Conteúdo expansível — só monta DOM quando aberto pra economizar
          renders em projetos com 15 briefs. Anim leve via max-height +
          transition (Tailwind não tem animate-height nativo). */}
      {isExpanded && (
        <div className="px-8 pb-8 space-y-8 border-t border-gray-100 dark:border-gray-800 pt-6">
          {hasSource && (
            <section className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {t.projects.dataSection.sourceHeading}
              </h4>
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 space-y-2 ring-1 ring-gray-200/60 dark:ring-gray-700/60">
                {productInfo?.productName && (
                  <div className="text-xs">
                    <span className="font-bold text-gray-900 dark:text-gray-100">
                      {t.projects.dataSection.product}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {productInfo.productName}
                    </span>
                  </div>
                )}
                {productInfo?.offer && (
                  <div className="text-xs">
                    <span className="font-bold text-gray-900 dark:text-gray-100">
                      {t.projects.dataSection.offer}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{productInfo.offer}</span>
                  </div>
                )}
                {productInfo?.mainPain && (
                  <div className="text-xs">
                    <span className="font-bold text-gray-900 dark:text-gray-100">
                      {t.projects.dataSection.mainPain}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{productInfo.mainPain}</span>
                  </div>
                )}
                {sourceText && (
                  <div className="text-[10px] text-gray-500 dark:text-gray-500 italic pt-2 border-t border-gray-200 dark:border-gray-700">
                    {t.projects.dataSection.sourceTextChars(sourceText.length)}
                  </div>
                )}
              </div>
            </section>
          )}

          {hasPersonas && (
            <section className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                {t.projects.dataSection.personasHeading(personas.length)}
                {onSelectPersona && (
                  <span className="ml-2 normal-case font-medium text-gray-400 dark:text-gray-500">
                    {t.projects.dataSection.personasHint}
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
                          {p.label || p.name || t.projects.dataSection.personaFallback}
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
                {t.projects.dataSection.briefsHeading(briefs.length)}
                {onSelectBrief && (
                  <span className="ml-2 normal-case font-medium text-gray-400 dark:text-gray-500">
                    {t.projects.dataSection.briefsHint}
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
                            {b.hook?.substring(0, 80) || t.projects.dataSection.briefNoHook}
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
                                  {t.projects.dataSection.executed}
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
            </section>
          )}

          {/* Revisar/editar a estratégia completa — abre o projeto na aba
              Planejamento, onde material, persona e plano já são editáveis.
              Evita duplicar o editor aqui (seria 2 lugares fazendo o mesmo). */}
          {onReviewPlan && (
            <button
              onClick={onReviewPlan}
              className="w-full px-4 py-3.5 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-blue-200/50 dark:shadow-blue-900/30 hover:from-blue-600 hover:to-blue-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2 group"
            >
              <Sparkles size={16} className="group-hover:scale-110 transition-transform" />
              <span className="text-xs font-black uppercase tracking-widest">
                {t.projects.dataSection.reviewPlan}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
