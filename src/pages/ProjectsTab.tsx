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
import type { Project, ProjectVariant, Step } from '../types/project';
import { VariantItem } from '../components/VariantItem';
import { getAuthorizedUrl } from '../lib/gemini';

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
  onNewSubproject: (p: Project) => void;
  onLoadVariant: (v: ProjectVariant, step?: Step) => void;
  onDeleteVariant: (pid: string, vid: string) => void | Promise<void>;
  onRenameVariant: (pid: string, vid: string, newName: string) => void | Promise<void>;
  onDeleteAudio: (audio: { url: string; storagePath: string | null }) => void;
  onDeleteVideoFromArray: (video: any) => void | Promise<void>;
  /** Creates a copy of the project with same config and "(cópia)"
   *  suffix; opens it in the Copy step. Wired from App.tsx. */
  onDuplicateProject: (p: Project) => void | Promise<void>;
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
  onDeleteAudio,
  onDeleteVideoFromArray,
  onDuplicateProject,
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
              className="p-3 bg-white border-2 border-gray-100 rounded-2xl text-gray-400 hover:text-blue-600 hover:border-blue-100 transition-all"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">{project.name}</h2>
              <p className="text-sm text-gray-400 font-medium">
                Gerencie as versões e conteúdos deste projeto.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onDeleteProject(project.id)}
              className="px-6 py-3 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all flex items-center gap-2"
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

        <div className="bg-white rounded-[40px] border-2 border-gray-100 shadow-xl overflow-hidden">
          <div className="p-8 border-b border-gray-50 bg-gray-50/30">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Tag size={14} /> Subprojetos / Versões ({project.variants?.length || 0})
              </h3>
              <button
                onClick={() => onNewSubproject(project)}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2"
              >
                <Sparkles size={12} />
                Novo Subprojeto
              </button>
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
                <div className="p-12 text-center bg-white rounded-3xl border-2 border-dashed border-gray-100">
                  <p className="text-gray-400 font-bold">Nenhuma versão arquivada ainda.</p>
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
                  <div className="w-8 h-8 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center">
                    <Edit3 size={16} />
                  </div>
                  <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">
                    Formulário Preenchido
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(viewingVariant.config.copy.answers).map(([key, value]) => {
                    if (key === 'existingCopy' || !value) return null;
                    return (
                      <div key={key} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                          {key}
                        </p>
                        <p className="text-sm font-bold text-gray-700">
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
                    <Sparkles size={16} />
                  </div>
                  <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs">
                    Conteúdo Gerado
                  </h4>
                </div>

                {viewingVariant.config.videoUrl && (
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
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
                                className="p-4 bg-amber-50/50 rounded-2xl border border-amber-100"
                              >
                                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2">
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
                      <div className="p-8 bg-gray-100 text-gray-800 rounded-[32px] shadow-sm relative overflow-hidden border-2 border-gray-200">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">
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
                  <div className="p-12 text-center bg-gray-50 rounded-[32px] border-2 border-dashed border-gray-200">
                    <p className="text-gray-400 font-bold">
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
          <h3 className="text-2xl font-black text-gray-900 tracking-tight">Meus Projetos</h3>
          <p className="text-gray-500 text-sm">Gerencie seus projetos e criações.</p>
        </div>
        <button
          onClick={() => setShowNewProjectModal(true)}
          className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2"
        >
          <Sparkles size={18} />
          Criar Novo Projeto
        </button>
      </div>

      {/* Search + filter row — hidden when there are 0 projects so the
          empty state below dominates. Shown otherwise even with a small
          list because muscle memory is more important than minimalism. */}
      {projects.length > 0 && (
        <div className="bg-white p-4 rounded-3xl border-2 border-gray-50 shadow-sm flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={16}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo nome…"
              className="w-full pl-11 pr-10 py-3 bg-gray-50 border border-transparent rounded-xl text-sm focus:bg-white focus:border-blue-400 outline-none transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
                title="Limpar"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 bg-gray-50 rounded-xl">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                  typeFilter === f.value
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="px-4 py-3 bg-gray-50 border border-transparent rounded-xl text-xs font-bold uppercase tracking-wider text-gray-600 focus:bg-white focus:border-blue-400 outline-none cursor-pointer"
          >
            <option value="recent">Mais recente</option>
            <option value="oldest">Mais antigo</option>
            <option value="name">Nome (A–Z)</option>
          </select>

          {(search || typeFilter !== 'all') && (
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-auto">
              {filteredProjects.length} de {projects.length}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {projects.length === 0 ? (
          <div className="col-span-full p-12 bg-white rounded-[40px] border-4 border-dashed border-gray-100 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 bg-gray-50 text-gray-300 rounded-3xl flex items-center justify-center">
              <Layout size={32} />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900">Nenhum projeto encontrado</p>
              <p className="text-sm text-gray-400">
                Comece criando seu primeiro projeto agora mesmo.
              </p>
            </div>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-8 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all"
            >
              Criar Primeiro Projeto
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="col-span-full p-10 bg-white rounded-[32px] border-2 border-dashed border-gray-100 text-center space-y-3">
            <p className="text-lg font-bold text-gray-900">
              Nenhum projeto bate com sua busca
            </p>
            <p className="text-sm text-gray-400">
              Tente outro termo ou limpe os filtros.
            </p>
            <button
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
              }}
              className="mt-2 px-5 py-2 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div
              key={project.id}
              className={`group p-6 bg-white rounded-[32px] border-4 transition-all hover:shadow-xl hover:scale-[1.02] cursor-pointer ${
                currentProjectId === project.id
                  ? 'border-blue-600 shadow-blue-50'
                  : 'border-gray-50 hover:border-blue-100'
              }`}
              onClick={() => setViewingProjectId(project.id)}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  {project.type === 'complete' ? (
                    <Video size={24} />
                  ) : project.type === 'copy' ? (
                    <Edit3 size={24} />
                  ) : project.type === 'video' ? (
                    <Play size={24} />
                  ) : (
                    <Maximize size={24} />
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicateProject(project);
                    }}
                    className="p-2 text-gray-300 hover:text-blue-600 transition-colors"
                    title="Duplicar Projeto"
                  >
                    <Copy size={18} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteProject(project.id);
                    }}
                    className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                    title="Excluir Projeto"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <h4 className="text-lg font-black text-gray-900 mb-1 truncate">{project.name}</h4>
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-4">
                {project.type === 'complete'
                  ? 'Projeto Completo'
                  : project.type === 'copy'
                    ? 'Apenas Copy'
                    : project.type === 'video'
                      ? 'Apenas Vídeo'
                      : 'Edição de Vídeo'}
              </p>

              <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  {project.createdAt?.toDate
                    ? project.createdAt.toDate().toLocaleDateString()
                    : 'Recentemente'}
                </span>
                <div className="flex items-center gap-1 text-blue-600 font-bold text-xs">
                  Ver Subprojetos ({project.variants?.length || 0}) <ChevronRight size={14} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
