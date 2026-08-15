import React from 'react';
import { toast } from 'react-hot-toast';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, setDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { saveVariant } from '@/lib/variantStore';
import { pushRecentProject } from '@/lib/recentProjects';
import { hydrateProjectConfig, ensurePersonaWeights } from '@/lib/projectConfig';
import { getErrorMessage } from '@/lib/errors';
import { createProjectViaRest, CREATE_PROJECT_TIMEOUT_MS } from '@/lib/firestoreRest';
import type { AdConfig } from '@/App';
import type {
  Project,
  ProjectVariant,
  Step,
  CreativeBrief,
  WeightedPersona,
} from '@/types/project';

interface UseProjectActionsArgs {
  user: FirebaseUser | null;
  projects: Project<AdConfig>[];
  setProjects: React.Dispatch<React.SetStateAction<Project<AdConfig>[]>>;
  currentProjectId: string | null;
  setCurrentProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  currentVariantId: string | null;
  setCurrentVariantId: React.Dispatch<React.SetStateAction<string | null>>;
  viewingProjectId: string | null;
  setViewingProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  config: AdConfig;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<Step>>;
  isProjectLoading: boolean;
  setIsProjectLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  dirtyBaselineRef: React.MutableRefObject<string>;
  setLastSavedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setError: (v: string | null) => void;
  addLog: (message: string) => void;

  // Novo projeto (modal)
  newProjectName: string;
  setNewProjectName: React.Dispatch<React.SetStateAction<string>>;
  newProjectType: 'complete' | 'copy' | 'video' | 'editing';
  setShowNewProjectModal: React.Dispatch<React.SetStateAction<boolean>>;
  setNewSourceMode: React.Dispatch<React.SetStateAction<'vsl' | 'product' | null>>;
  copySubMode: 'zero' | 'improve' | 'ready';
  setCopySubMode: React.Dispatch<React.SetStateAction<'zero' | 'improve' | 'ready'>>;

  // Excluir projeto (confirmação)
  deleteProjectConfirmId: string | null;
  setDeleteProjectConfirmId: React.Dispatch<React.SetStateAction<string | null>>;

  // Assets/config restaurados ao carregar/criar projeto
  audioUrl: string | null;
  setAudioUrl: React.Dispatch<React.SetStateAction<string | null>>;
  audioStoragePath: string | null;
  setAudioStoragePath: React.Dispatch<React.SetStateAction<string | null>>;
  audios: { url: string; storagePath: string | null; voiceId: string; createdAt: string }[];
  setAudios: React.Dispatch<
    React.SetStateAction<
      { url: string; storagePath: string | null; voiceId: string; createdAt: string }[]
    >
  >;
  videoUrl: string | null;
  setVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;
  videoStoragePath: string | null;
  setVideoStoragePath: React.Dispatch<React.SetStateAction<string | null>>;
  videos: {
    url: string;
    storagePath: string | null;
    createdAt: string;
    aspectRatio?: '9:16' | '1:1' | '16:9';
    scale?: number;
  }[];
  setVideos: React.Dispatch<
    React.SetStateAction<
      {
        url: string;
        storagePath: string | null;
        createdAt: string;
        aspectRatio?: '9:16' | '1:1' | '16:9';
        scale?: number;
      }[]
    >
  >;
  lastVideoMetadata: any | null;
  setLastVideoMetadata: React.Dispatch<React.SetStateAction<any | null>>;
  generationStage:
    | 'idle'
    | 'audio'
    | 'audio_ready'
    | 'video'
    | 'video_ready'
    | 'subtitles'
    | 'subtitles_ready'
    | 'edit'
    | 'completed';
  setGenerationStage: React.Dispatch<
    React.SetStateAction<
      | 'idle'
      | 'audio'
      | 'audio_ready'
      | 'video'
      | 'video_ready'
      | 'subtitles'
      | 'subtitles_ready'
      | 'edit'
      | 'completed'
    >
  >;
  setCopyDiscoveryMode: React.Dispatch<
    React.SetStateAction<'unknown' | 'known' | 'discovering' | 'done'>
  >;
  setHasUnsavedCopyChanges: React.Dispatch<React.SetStateAction<boolean>>;
  setGeneratedPersona: React.Dispatch<React.SetStateAction<any>>;
  setPersonasSaved: React.Dispatch<React.SetStateAction<boolean>>;

  // Fluxos externos que os handlers de projeto disparam mas não possuem
  // (ficam no App.tsx — brief/persona/big-variation não são domínio de projeto).
  handleBriefClick: (brief: CreativeBrief, projectId?: string) => void;
  setPendingPersonaExec: React.Dispatch<React.SetStateAction<WeightedPersona | null>>;
  handleStartBigVariation: (project: Project) => Promise<void>;
}

// CRUD de projeto: criar/salvar/renomear/duplicar/excluir/carregar. Extraído
// do App.tsx — puro code-motion, mesmo comportamento. É o domínio mais
// acoplado dos três (auth → variant → project) porque é literalmente o
// "container" de tudo — carregar/criar projeto precisa resetar a MESMA UI
// inteira que o variant reseta, então o objeto de parâmetros é grande de
// propósito.
export function useProjectActions({
  user,
  projects,
  setProjects,
  currentProjectId,
  setCurrentProjectId,
  currentVariantId,
  setCurrentVariantId,
  viewingProjectId,
  setViewingProjectId,
  config,
  setConfig,
  setCurrentStep,
  isProjectLoading,
  setIsProjectLoading,
  setIsSaving,
  setIsDirty,
  dirtyBaselineRef,
  setLastSavedAt,
  setError,
  addLog,
  newProjectName,
  setNewProjectName,
  newProjectType,
  setShowNewProjectModal,
  setNewSourceMode,
  copySubMode,
  setCopySubMode,
  deleteProjectConfirmId,
  setDeleteProjectConfirmId,
  audioUrl,
  setAudioUrl,
  audioStoragePath,
  setAudioStoragePath,
  audios,
  setAudios,
  videoUrl,
  setVideoUrl,
  videoStoragePath,
  setVideoStoragePath,
  videos,
  setVideos,
  lastVideoMetadata,
  setLastVideoMetadata,
  generationStage,
  setGenerationStage,
  setCopyDiscoveryMode,
  setHasUnsavedCopyChanges,
  setGeneratedPersona,
  setPersonasSaved,
  handleBriefClick,
  setPendingPersonaExec,
  handleStartBigVariation,
}: UseProjectActionsArgs) {
  // Trava de reentrância pro handleSaveProject: evita que o auto-save
  // (debounce) e o clique manual em "Salvar" disparem dois setDoc concorrentes
  // pro mesmo doc — o que perde/sobrescrever silenciosamente um dos dois.
  const savingRef = React.useRef(false);
  const handleCreateProject = async () => {
    if (!user || !newProjectName.trim()) return;

    setIsSaving(true);
    try {
      const projectConfig = {
        angle: 'podcast',
        copy: {
          mode: 'questions',
          subMode: copySubMode,
          // Blueprint Fase 4 — só persiste pra projetos 'complete'. Pros
          // outros tipos fica undefined (e.g. video-only não precisa).
          answers: {},
          generatedScript: '',
          generatedHooks: [],
        },
        avatar: { faceId: '', customFaceUrl: null, voiceId: '' },
        subtitles: { style: 'simple' },
        format: { aspectRatio: '9:16', duration: 15 },
        hookVisual: {
          promptImagem: '',
          imagensGeradas: [],
          imagemEscolhida: '',
          promptVideo: '',
          videoGerado: '',
          duracaoVideo: 4,
          modeloImagem: 'imagen-4.0-generate-001',
          modeloVideo: 'veo-3.1-fast-generate-preview',
        },
        edit: {
          transition: 'none',
          backgroundMusic: 'none',
          timelineEdits: [],
        },
        audios: [],
      };

      const projectData = {
        userId: user.uid,
        name: newProjectName,
        type: newProjectType,
        createdAt: serverTimestamp(),
      };

      // Cria primeiro um "shell" minimo do projeto. O config completo fica
      // no estado local imediatamente e vai para o Firestore no primeiro save
      // normal do projeto. Isso evita spinner infinito na criacao quando
      // algum campo mais novo do config prende a escrita inicial.
      const docRef = doc(collection(db, 'projects'));
      const createWithSdk = setDoc(docRef, projectData);
      let projectId = docRef.id;
      try {
        await Promise.race([
          createWithSdk,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Firestore SDK create timed out')),
              CREATE_PROJECT_TIMEOUT_MS
            )
          ),
        ]);
      } catch (err) {
        console.warn('[ProjectCreate] SDK write did not finish, trying REST fallback.', err);
        projectId = await createProjectViaRest(user, docRef.id, projectData);
      }

      setCurrentProjectId(projectId);
      setConfig(projectConfig as AdConfig);
      // UX8: reset comprehensive — antes só config era trocado. Top-level
      // state (audios, videos, audioUrl, etc) + currentVariantId continuavam
      // apontando pro projeto ANTERIOR. Auto-save 2s depois persistia esses
      // assets antigos no projeto novo. Mesma família de bugs que UX6
      // (variant) e agora aplicado pra criar projeto novo. Espelha o reset
      // que handleLoadProject ja faz.
      setCurrentVariantId(null);
      setAudioUrl(null);
      setAudioStoragePath(null);
      setAudios([]);
      setVideoUrl(null);
      setVideoStoragePath(null);
      setVideos([]);
      setLastVideoMetadata(null);
      setGenerationStage('idle');
      // Limpa personas de QUALQUER projeto anterior (mesmo geradas e não
      // salvas) pra não vazar pro projeto novo.
      setGeneratedPersona(null);
      setPersonasSaved(false);
      setHasUnsavedCopyChanges(false);
      setShowNewProjectModal(false);
      setNewProjectName('');
      // Reset Blueprint Fase 4 escolha pra não vazar pra próximo projeto.
      setNewSourceMode(null);
      if (newProjectType === 'complete') {
        setCurrentVariantId(null);
        setCopyDiscoveryMode('known');
        setCurrentStep('persona');
      } else {
        // Tipos legacy (não criados mais pelo modal).
        const firstStepByType: Record<string, any> = {
          copy: 'persona',
          video: 'voz-premium',
          editing: 'edit-zap',
        };
        setCurrentStep(firstStepByType[newProjectType] || 'persona');
      }
      setProjects((prev) => [
        { id: projectId, ...projectData, config: projectConfig, createdAt: new Date() } as any,
        ...prev,
      ]);
    } catch (err) {
      const message = getErrorMessage(err);
      console.error('Error creating project:', message, err);
      toast.error(`Nao consegui gravar o projeto: ${message}`, {
        duration: 12000,
      });
      setError('Falha ao criar projeto.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectBriefFromProject = async (project: Project, brief: CreativeBrief) => {
    if (project.id !== currentProjectId) {
      // Carrega o projeto sem trocar de aba (step='projects' = fica aqui).
      await handleLoadProject(project, 'projects');
    }
    // Passa project.id EXPLÍCITO — não depende do currentProjectId ter
    // propagado (evita carregar o subprojeto do projeto errado).
    setTimeout(() => handleBriefClick(brief, project.id), 0);
  };

  /** Blueprint Fase 4 — Porta A: cliente clica em 1 persona da seção
   *  "Dados do Projeto". Abre popup de confirmação (handleConfirmPersonaExec). */
  const handleSelectPersonaFromProject = async (project: Project, persona: WeightedPersona) => {
    if (project.id !== currentProjectId) {
      await handleLoadProject(project, 'projects');
    }
    setTimeout(() => setPendingPersonaExec(persona), 0);
  };

  const handleSaveProject = async (
    overridesOrEvent?: Partial<AdConfig> | React.MouseEvent,
    opts?: { silent?: boolean }
  ): Promise<boolean> => {
    // Já tem um save em andamento (auto-save ou manual) — não dispara outro
    // setDoc concorrente pro mesmo doc, senão o que terminar por último pode
    // sobrescrever com um config mais antigo.
    if (savingRef.current) return false;
    // Robust event detection to prevent circular structure errors
    const isEvent = !!(
      overridesOrEvent &&
      typeof overridesOrEvent === 'object' &&
      ('nativeEvent' in overridesOrEvent ||
        'target' in overridesOrEvent ||
        ('type' in overridesOrEvent && (overridesOrEvent as any).type.includes('click')))
    );

    const overrides = isEvent ? {} : (overridesOrEvent as Partial<AdConfig>) || {};
    // UX2: auto-save é silencioso por padrão. Toast só aparece quando o
    // chamador explicita { silent: false } (botão "Salvar" do header).
    // Antes esse toast pipocava a cada 2s porque o debounce roda em todo
    // change de config.
    const silent = opts?.silent !== false;
    if (!user || isProjectLoading) return false;

    if (!currentProjectId) {
      // Auto-save silencioso NÃO abre o modal de novo projeto — só o clique
      // manual em "Salvar" faz isso. Sem projeto aberto, o save vira no-op.
      if (!silent) setShowNewProjectModal(true);
      return false;
    }

    savingRef.current = true;
    setIsSaving(true);
    if (process.env.NODE_ENV !== 'production') console.log('VOICE_SAVE_STARTED');
    try {
      const awarenessLevel = config.copy.answers.awarenessLevel || 'Geral';
      const variantId = currentVariantId || Date.now().toString();

      // Update config with current videoUrl and audioUrl before saving, allowing overrides.
      // IMPORTANTE: os campos abaixo (videoUrl, audioUrl, audios, etc.) já são
      // resolvidos campo a campo (usa overrides.X se veio, senão o valor AO
      // VIVO do estado). Por isso NÃO espalhamos `...overrides` de novo depois
      // — se um chamador passar um `overrides` que por engano carrega um
      // snapshot inteiro e desatualizado do config (ex.: `{...config, copy: {...}}`
      // capturado no momento do clique), esse spread final sobrescrevia esses
      // campos já corretos com valores antigos quando esse save (geralmente
      // mais lento) terminava depois de outro save mais recente — silenciosamente
      // revertia a voz/vídeo ativos pra uma versão anterior. `restOverrides`
      // carrega só os OUTROS campos (ex.: `copy`) que o chamador quis mudar.
      const {
        videoUrl: _ovVideoUrl,
        videoStoragePath: _ovVideoStoragePath,
        audioUrl: _ovAudioUrl,
        audioStoragePath: _ovAudioStoragePath,
        audios: _ovAudios,
        videos: _ovVideos,
        lastVideoMetadata: _ovLastVideoMetadata,
        generationStage: _ovGenerationStage,
        ...restOverrides
      } = overrides || {};
      const configToSave = JSON.parse(
        JSON.stringify({
          ...config,
          videoUrl: overrides?.videoUrl !== undefined ? overrides.videoUrl : videoUrl,
          videoStoragePath:
            overrides?.videoStoragePath !== undefined
              ? overrides.videoStoragePath
              : videoStoragePath,
          audioUrl: overrides?.audioUrl !== undefined ? overrides.audioUrl : audioUrl,
          audioStoragePath:
            overrides?.audioStoragePath !== undefined
              ? overrides.audioStoragePath
              : audioStoragePath,
          audios: overrides?.audios !== undefined ? overrides.audios : audios,
          videos: overrides?.videos !== undefined ? overrides.videos : videos,
          lastVideoMetadata:
            overrides?.lastVideoMetadata !== undefined
              ? overrides.lastVideoMetadata
              : lastVideoMetadata,
          generationStage:
            overrides?.generationStage !== undefined ? overrides.generationStage : generationStage,
          ...restOverrides,
        })
      );

      const projectRef = doc(db, 'projects', currentProjectId);
      // Subprojeto existente vem do estado em memória — a subcoleção
      // `projects/{id}/variants` já foi carregada no loader. Não relê o doc do
      // projeto: ele não guarda mais o array de variants.
      const currentProj = projects.find((p) => p.id === currentProjectId);
      const existingVariant = currentVariantId
        ? ((currentProj?.variants as any[]) || []).find((v) => v.id === currentVariantId) || null
        : null;

      // Cleanup and Pruning to solve the 1MB Firestore limit (3.8MB reported)
      const cleanConfigForStorage = (cfg: any) => {
        if (!cfg) return cfg;
        const cloned = JSON.parse(JSON.stringify(cfg));
        if (cloned.edit?.segments) {
          cloned.edit.segments = cloned.edit.segments.map((s: any) => {
            if (s.visualConcept?.imageUrl?.startsWith('data:')) {
              // We prune base64 instead of uploading it in a loop to avoid hitting storage too hard
              // The user can re-generate if needed, or we hope they approval/upload happened elsewhere
              s.visualConcept.imageUrl = '';
            }
            return s;
          });
        }
        // UX25-C1: lastDebug é um snapshot de até 50KB do prompt + resposta.
        // Útil em runtime mas estoura o budget do Firestore se persistido.
        // Remove na hora de salvar — fica só na memória durante a sessão.
        if (cloned.copy?.lastDebug) {
          delete cloned.copy.lastDebug;
        }
        // aiRecommendation é cache da recomendação de avatar (~34KB por
        // subprojeto). É regenerável — se refaz sozinho via inputsKey quando
        // o painel reabre. Multiplicado por todos os variants num único doc,
        // era o maior responsável por estourar o limite de 1MB do Firestore.
        // Mesmo critério do lastDebug: fica em runtime, não é persistido.
        if (cloned.copy?.aiRecommendation) {
          delete cloned.copy.aiRecommendation;
        }
        return cloned;
      };

      // UX3: preserva campos do variant existente que NÃO derivam de config:
      //   - `name`: pode ser "Criativo X - Consc.Y - Angle" (set por
      //     handleConfirmBriefExec). Antes era sobrescrito por awarenessLevel.
      //   - `brief`: snapshot do CreativeBrief que gerou o subprojeto. Sem
      //     ele, handleBriefClick não acha o variant e mostra popup falso
      //     de "Criar este subprojeto?". (Sintoma reportado pelo user.)
      //   - `status`: 'brief_only' / outros. Apenas metadata, mas perder
      //     ela é confuso pro futuro.
      const existingAny = existingVariant as any;
      const newVariant: ProjectVariant = {
        id: variantId,
        name: existingAny?.name || awarenessLevel,
        config: configToSave,
        createdAt: existingVariant ? existingVariant.createdAt : new Date(),
        ...(existingAny?.brief ? { brief: existingAny.brief } : {}),
        ...(existingAny?.status ? { status: existingAny.status } : {}),
      } as ProjectVariant;

      // Fase de ESTRATÉGIA (sem subprojeto ativo): NÃO cria subprojeto. O
      // subprojeto/criativo só nasce ao "Produzir" um brief/persona; aqui sem
      // currentVariantId salvamos só o config do projeto.
      const cleanedVariant: ProjectVariant | null = currentVariantId
        ? ({ ...newVariant, config: cleanConfigForStorage(newVariant.config) } as ProjectVariant)
        : null;

      // Timeout de segurança: o Firestore às vezes fica em retry SILENCIOSO
      // (conexão ruim) e o setDoc nunca resolve nem rejeita — o botão "Salvar"
      // girava pra sempre. Se passar de 15s, lança erro pra o finally resetar o
      // botão e avisar. O rascunho local (metavise-draft-config-v1) preserva o
      // conteúdo de qualquer forma.
      const withTimeout = (p: Promise<unknown>) =>
        Promise.race([
          p,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Firestore não respondeu em 15s (timeout de save).')),
              15000
            )
          ),
        ]);

      // Doc do projeto SEM o array de variants (eles vivem na subcoleção, cada
      // um com seu próprio teto de 1 MiB) + o subprojeto ativo na subcoleção.
      await withTimeout(
        Promise.all([
          setDoc(
            projectRef,
            { config: cleanConfigForStorage(configToSave), updatedAt: serverTimestamp() },
            { merge: true }
          ),
          ...(cleanedVariant ? [saveVariant(currentProjectId, cleanedVariant)] : []),
        ])
      );

      addLog('PROJETO_SALVO');
      if (process.env.NODE_ENV !== 'production') console.log('VOICE_SAVE_COMPLETED');
      // Salvou com sucesso → não há mais trabalho pendente. Atualiza o baseline
      // pro estado atual virar o "limpo" (senão o detector reabriria o pop-up).
      dirtyBaselineRef.current = JSON.stringify({ config, audios, videos, audioUrl, videoUrl });
      setIsDirty(false);

      // Atualiza a lista local pra refletir o que foi salvo (sem onSnapshot,
      // o array `projects` não se atualiza sozinho). Mantém "Dados do Projeto",
      // contagem de subprojetos e badges de brief executado em sincronia.
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== currentProjectId) return p;
          const nextVariants = ((p.variants as any[]) || []).slice();
          if (cleanedVariant) {
            const idx = nextVariants.findIndex((v) => v.id === cleanedVariant.id);
            if (idx !== -1) nextVariants[idx] = cleanedVariant;
            else nextVariants.push(cleanedVariant);
          }
          return { ...p, config: configToSave, variants: nextVariants } as any;
        })
      );

      if (!silent) {
        toast.success(
          currentVariantId
            ? `Versão "${awarenessLevel}" atualizada com sucesso!`
            : 'Projeto salvo com sucesso!'
        );
      }
      return true;
    } catch (err: any) {
      console.error('Error saving project:', err);
      setError('Falha ao salvar projeto.');
      // Aviso visível quando NÃO é auto-save (botão manual). Sem isso, o
      // timeout só resetava o botão sem explicar — parecia que sumiu.
      if (!silent) {
        const msg = String(err?.message || '');
        if (msg.includes('timeout')) {
          toast.error(
            'O salvar demorou demais (Firestore não respondeu). Seu rascunho está guardado localmente — tente salvar de novo.',
            { duration: 7000 }
          );
        } else {
          toast.error('Falha ao salvar. Seu rascunho local está guardado — tente de novo.', {
            duration: 6000,
          });
        }
      }
      return false;
    } finally {
      savingRef.current = false;
      setIsSaving(false);
      setHasUnsavedCopyChanges(false);
      // Stamp the last-saved time so AutoSaveIndicator can show
      // "Salvo agora" → "Salvo há Xmin" instead of staying stale.
      setLastSavedAt(Date.now());
    }
  };

  const handleRenameProject = async (projectId: string, newName: string) => {
    if (!newName.trim()) {
      toast.error('Nome não pode ser vazio.');
      return;
    }
    try {
      const projectRef = doc(db, 'projects', projectId);
      await setDoc(projectRef, { name: newName.trim() }, { merge: true });
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? ({ ...p, name: newName.trim() } as any) : p))
      );
      toast.success('Projeto renomeado!');
    } catch (err) {
      console.error('Error renaming project:', err);
      toast.error('Falha ao renomear projeto.');
    }
  };

  const handleDeleteProject = (projectId: string) => {
    setDeleteProjectConfirmId(projectId);
  };

  // Creates a copy of the project at its current state (config snapshot,
  // variants NOT carried over — those are per-render and re-makeable),
  // assigns a "(cópia)" name, persists to Firestore, and opens it in
  // the Copy step so the user can immediately tweak the duplicate.
  const handleDuplicateProject = async (source: Project) => {
    if (!user) {
      toast.error('Você precisa estar logado para duplicar.');
      return;
    }
    try {
      const dup = {
        userId: user.uid,
        name: `${source.name} (cópia)`,
        type: source.type,
        // Strip variants — they're per-render artifacts, not source data.
        // Same for the top-level audio/video URLs (kept on `audios`/`videos`).
        config: {
          ...source.config,
          audios: source.config.audios || [],
          videos: source.config.videos || [],
        } as AdConfig,
        createdAt: serverTimestamp(),
      };
      // Espera a gravação confirmar antes de abrir — garante que a cópia
      // REALMENTE existe no Firestore (não some ao recarregar).
      const newId = doc(collection(db, 'projects')).id;
      await setDoc(doc(db, 'projects', newId), dup);
      setProjects((prev) => [{ id: newId, ...dup, createdAt: new Date() } as any, ...prev]);
      setCurrentProjectId(newId);
      setConfig(dup.config);
      setCurrentStep('copy');
      toast.success(`"${source.name}" duplicado!`);
    } catch (err: any) {
      toast.error(`Erro ao duplicar: ${err?.message || 'tente novamente'}`);
    }
  };

  const confirmDeleteProject = async () => {
    if (!deleteProjectConfirmId) return;
    const projectId = deleteProjectConfirmId;
    setDeleteProjectConfirmId(null);
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      // Remove da lista local (sem onSnapshot, o estado não some sozinho).
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (currentProjectId === projectId) {
        setCurrentProjectId(null);
      }
      if (viewingProjectId === projectId) {
        setViewingProjectId(null);
      }
      toast.success('Projeto excluído!');
    } catch (err) {
      console.error('Error deleting project:', err);
      setError('Falha ao excluir projeto.');
    }
  };

  const handleLoadProject = async (project: Project, step?: Step) => {
    if (process.env.NODE_ENV !== 'production') console.log('[Debug] Loading Project:', project.id);
    setIsProjectLoading(true);

    // Track for the "recent projects" quick-back chip in the header.
    pushRecentProject({ id: project.id, name: project.name, type: project.type });

    try {
      setCurrentProjectId(project.id);

      const loadedConfig = ensurePersonaWeights(hydrateProjectConfig({ ...project.config }));

      // Sincroniza as personas com ESTE projeto (evita vazar de outro).
      const savedRaw = loadedConfig.copy?.answers?.savedPersonas;
      let loadedPersonas: any[] = [];
      if (savedRaw) {
        try {
          const parsed = JSON.parse(savedRaw);
          if (Array.isArray(parsed)) loadedPersonas = parsed;
        } catch (e) {}
      }
      setGeneratedPersona(loadedPersonas.length ? { personas: loadedPersonas } : null);
      setPersonasSaved(loadedPersonas.length > 0);

      // Tentar encontrar uma variante que coincida com o config atual do projeto (Bug 1)
      const matchingVariant = (project.variants || []).find(
        (v: any) =>
          v.config.copy.generatedScript === loadedConfig.copy.generatedScript &&
          v.config.copy.answers.awarenessLevel === loadedConfig.copy.answers.awarenessLevel
      );

      if (matchingVariant) {
        setCurrentVariantId(matchingVariant.id);
      } else {
        setCurrentVariantId(null);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Debug] Project Config Hydrated:', {
          discoveryMode: loadedConfig.copy.discoveryMode,
          hasAnswers: Object.keys(loadedConfig.copy.answers || {}).length,
          hasScript: !!loadedConfig.copy.generatedScript,
        });
      }

      if (loadedConfig.copy?.subMode) {
        setCopySubMode(loadedConfig.copy.subMode as any);
      }

      setConfig(loadedConfig);
      setCopyDiscoveryMode(loadedConfig.copy.discoveryMode as any);

      setVideoUrl(loadedConfig.videoUrl || null);
      setVideoStoragePath(loadedConfig.videoStoragePath || null);
      setAudioUrl(loadedConfig.audioUrl || null);
      setAudioStoragePath(loadedConfig.audioStoragePath || null);
      setAudios(loadedConfig.audios || []);
      setVideos(loadedConfig.videos || []);
      setLastVideoMetadata(loadedConfig.lastVideoMetadata || null);
      setGenerationStage((loadedConfig.generationStage as any) || 'idle');

      setHasUnsavedCopyChanges(false);

      // Carregar projeto cai na aba Produto e Persona (que agora tem o
      // material/VSL no topo). Tipos especiais pulam mais fundo no fluxo.
      const firstStepByType: Record<string, string> = {
        complete: 'persona',
        copy: 'persona',
        video: 'voz-premium',
        editing: 'edit-zap',
      };
      const resolvedStep = step || firstStepByType[project.type] || 'persona';
      setCurrentStep(resolvedStep as Step);
      toast.success(`Projeto "${project.name}" carregado!`);
    } catch (err) {
      console.error('[Debug] Error loading project:', err);
      toast.error('Erro ao carregar projeto.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  const handleNewSubproject = (project: Project) => {
    // Fluxo ÚNICO de "novo criativo": reaproveita material/VSL + personas +
    // plano que já existem e abre o editor de UM brief. Não regera persona
    // nem o plano dos demais — cria só este criativo e segue pra Copy.
    handleStartBigVariation(project);
  };

  return {
    handleCreateProject,
    handleSelectBriefFromProject,
    handleSelectPersonaFromProject,
    handleSaveProject,
    handleRenameProject,
    handleDeleteProject,
    handleDuplicateProject,
    confirmDeleteProject,
    handleLoadProject,
    handleNewSubproject,
  };
}
