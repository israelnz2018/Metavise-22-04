import React from 'react';
import { toast } from 'react-hot-toast';
import { saveVariant, deleteVariantDoc } from '@/lib/variantStore';
import {
  hydrateProjectConfig,
  ensurePersonaWeights,
  resolveDeepestStep,
} from '@/lib/projectConfig';
import type { AdConfig } from '@/App';
import type { Project, ProjectVariant, Step, TimelineEdit } from '@/types/project';
import type { ZapStatusBundle } from '@/hooks/useZapState';

interface UseVariantActionsArgs {
  projects: Project<AdConfig>[];
  setProjects: React.Dispatch<React.SetStateAction<Project<AdConfig>[]>>;
  currentProjectId: string | null;
  setCurrentProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  currentVariantId: string | null;
  setCurrentVariantId: React.Dispatch<React.SetStateAction<string | null>>;
  config: AdConfig;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;
  setCurrentStep: React.Dispatch<React.SetStateAction<Step>>;
  setIsProjectLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: (v: string | null) => void;
  setAudioUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setAudioStoragePath: React.Dispatch<React.SetStateAction<string | null>>;
  setAudios: React.Dispatch<
    React.SetStateAction<
      { url: string; storagePath: string | null; voiceId: string; createdAt: string }[]
    >
  >;
  setVideoUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setVideoStoragePath: React.Dispatch<React.SetStateAction<string | null>>;
  setVideos: React.Dispatch<
    React.SetStateAction<
      {
        url: string;
        storagePath: string | null;
        createdAt: string;
        aspectRatio?: '9:16' | '1:1' | '16:9';
        scale?: number;
        timelineEdits?: TimelineEdit[];
      }[]
    >
  >;
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
  setLastVideoMetadata: React.Dispatch<React.SetStateAction<any | null>>;
  setZapState: React.Dispatch<React.SetStateAction<ZapStatusBundle>>;
  setCopySubMode: React.Dispatch<React.SetStateAction<'zero' | 'improve' | 'ready'>>;
  setHasUnsavedCopyChanges: React.Dispatch<React.SetStateAction<boolean>>;
}

// Carregar/duplicar/renomear/excluir subprojeto (variant). Extraído do
// App.tsx — puro code-motion, mesmo comportamento. Esse domínio mexe em
// bastante state "global" do app (não só o dele) porque carregar um
// subprojeto precisa resetar praticamente toda a UI pra refletir o
// conteúdo carregado — por isso a lista grande de parâmetros abaixo.
export function useVariantActions({
  projects,
  setProjects,
  currentProjectId,
  setCurrentProjectId,
  currentVariantId,
  setCurrentVariantId,
  config,
  setConfig,
  setCurrentStep,
  setIsProjectLoading,
  setError,
  setAudioUrl,
  setAudioStoragePath,
  setAudios,
  setVideoUrl,
  setVideoStoragePath,
  setVideos,
  setGenerationStage,
  setCopyDiscoveryMode,
  setLastVideoMetadata,
  setZapState,
  setCopySubMode,
  setHasUnsavedCopyChanges,
}: UseVariantActionsArgs) {
  const handleLoadVariant = async (variant: ProjectVariant, step?: Step, projectId?: string) => {
    if (process.env.NODE_ENV !== 'production') console.log('[Debug] Loading Variant:', variant.id);
    setIsProjectLoading(true);

    try {
      // Set project context. CRÍTICO: resolver o projeto-pai pelo projectId
      // EXPLÍCITO de quem chamou — NUNCA por `variants.some(v => v.id === variant.id)`,
      // porque os ids de subprojeto (brief_1, brief_2…) SE REPETEM entre projetos,
      // e a busca por id pegava o primeiro projeto da lista (errado), corrompendo
      // currentProjectId e contaminando o config entre projetos. Ver memória
      // bug-colisao-id-variant. Fallback por id só se nenhum projectId vier.
      const parentProject =
        (projectId ? projects.find((p) => p.id === projectId) : null) ||
        projects.find((p) => p.variants?.some((v) => v.id === variant.id));
      if (parentProject) {
        setCurrentProjectId(parentProject.id);
      }

      // Reset local states before loading new ones
      setAudioUrl(null);
      setAudioStoragePath(null);
      setAudios([]);
      setVideoUrl(null);
      setVideoStoragePath(null);
      setVideos([]);
      setGenerationStage('idle');

      // Hydrate and set config
      const loadedConfig = ensurePersonaWeights(hydrateProjectConfig({ ...variant.config }));

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Debug] Variant Config Hydrated:', {
          discoveryMode: loadedConfig.copy.discoveryMode,
          hasAnswers: Object.keys(loadedConfig.copy.answers || {}).length,
          hasScript: !!loadedConfig.copy.generatedScript,
        });
      }

      // Um subprojeto vindo do plano já tem persona/answers — nunca deve cair no
      // gate "quem é o cliente". Se ficou 'unknown' mas há conteúdo, sobe pra
      // 'done' (tem script) ou 'known' (tem answers/brief). Corrige os variants
      // antigos, criados antes do fix na criação.
      const ans = loadedConfig.copy.answers || {};
      const hasContent =
        !!loadedConfig.copy.finalScript ||
        !!loadedConfig.copy.generatedScript ||
        !!(loadedConfig.copy as any).activeBriefId ||
        !!ans.audience ||
        !!ans.productName ||
        !!ans.awarenessLevel;
      if (
        (!loadedConfig.copy.discoveryMode || loadedConfig.copy.discoveryMode === 'unknown') &&
        hasContent
      ) {
        loadedConfig.copy.discoveryMode =
          loadedConfig.copy.finalScript || loadedConfig.copy.generatedScript ? 'done' : 'known';
      }

      setConfig(loadedConfig);
      setCopyDiscoveryMode(loadedConfig.copy.discoveryMode as any);

      // Restaurar states independentes do config se necessário
      setVideoUrl(loadedConfig.videoUrl || null);
      setVideoStoragePath(loadedConfig.videoStoragePath || null);
      setVideos(loadedConfig.videos || []);
      setLastVideoMetadata(loadedConfig.lastVideoMetadata || null);
      setAudioUrl(loadedConfig.audioUrl || null);
      setAudioStoragePath(loadedConfig.audioStoragePath || null);
      setAudios(loadedConfig.audios || []);

      // Restore the Edição Zap version gallery from config so previously
      // edited videos show up after a reload.
      const persistedZapVersions =
        ((loadedConfig.edit as any)?.zapVersions as string[] | undefined) || [];
      setZapState((prev) => ({
        ...prev,
        versions: persistedZapVersions,
        status: persistedZapVersions.length > 0 ? 'completed' : prev.status,
        finalVideoUrl: persistedZapVersions[persistedZapVersions.length - 1] || prev.finalVideoUrl,
      }));

      if (loadedConfig.generationStage) {
        setGenerationStage(loadedConfig.generationStage as any);
      }

      if (loadedConfig.copy?.subMode) {
        setCopySubMode(loadedConfig.copy.subMode as any);
      }

      setCurrentVariantId(variant.id);
      setHasUnsavedCopyChanges(false);
      // step explícito (botões "Voz", "Avatar", etc.) tem prioridade; sem ele
      // ("Carregar Versão"), cai na aba mais avançada com conteúdo.
      setCurrentStep(step || resolveDeepestStep(loadedConfig));
      toast.success(`Versão "${variant.name}" carregada!`);
    } catch (err) {
      console.error('[Debug] Error loading variant:', err);
      toast.error('Erro ao carregar versão.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  /**
   * MM — Duplicate current project as an A/B variant.
   *
   * Clones the current in-memory config (copy, persona, plan, hook visual)
   * but resets the avatar + generated outputs so the user can pick a
   * different avatar on the same script. Saves the new variant onto the
   * SAME parent project (variants[] grows), loads it as the active
   * variant, then jumps to the Avatar tab where the actual A/B work
   * happens.
   *
   * If there's no currentProjectId yet (the user hasn't created the
   * project), we no-op and toast a friendlier prompt.
   */
  const handleDuplicateAsVariant = async () => {
    if (!currentProjectId) {
      toast.error('Salve o projeto antes de criar uma variante.');
      return;
    }
    try {
      const existingVariants =
        (projects.find((p) => p.id === currentProjectId)?.variants as any[]) || [];
      const variantNumber = existingVariants.length + 1;

      // Strip generated outputs — the whole point is to re-render
      // with a different avatar. Keep all the upstream creative work
      // (copy, persona, plan, hook visual, format).
      const clonedConfig: AdConfig = {
        ...config,
        // Reset render outputs so the user is forced to re-generate
        // them against the new avatar choice.
        videoUrl: null,
        videoStoragePath: null,
        videos: [],
        lastVideoMetadata: null,
        generationStage: 'idle',
        edit: {
          ...config.edit,
          zapVersions: [],
          zapHookVersions: [],
          zapJoinedVersions: [],
        },
        // Montagem referencia os clipes do avatar ANTERIOR — não faz sentido
        // manter numa variante que vai renderizar com outro avatar.
        montagem: undefined,
        montagemVsl: undefined,
      };

      const newVariant = {
        id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `Variante A/B ${variantNumber}`,
        config: clonedConfig,
        createdAt: new Date().toISOString(),
      };

      await saveVariant(currentProjectId, newVariant);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === currentProjectId
            ? ({ ...p, variants: [...((p.variants as any[]) || []), newVariant] } as any)
            : p
        )
      );

      // Activate the new variant in the UI and navigate to the Avatar
      // tab — that's where the A/B differentiation lives.
      setCurrentVariantId(newVariant.id);
      setConfig(clonedConfig);
      setCurrentStep('avatar');

      toast.success(`Variante criada! Escolha um avatar diferente pra rodar o A/B.`);
    } catch (err) {
      console.error('Error duplicating as variant:', err);
      toast.error('Falha ao criar variante.');
    }
  };

  const handleRenameVariant = async (projectId: string, variantId: string, newName: string) => {
    if (!newName.trim()) {
      toast.error('Nome não pode ser vazio.');
      return;
    }
    try {
      // Renomeia direto no doc do subprojeto (subcoleção). Acha o variant na
      // memória pra reescrever só ele com o nome novo.
      const proj = projects.find((p) => p.id === projectId);
      const target = ((proj?.variants as any[]) || []).find((v) => v.id === variantId);
      if (!target) {
        toast.error('Subprojeto não encontrado.');
        return;
      }
      const renamed = { ...target, name: newName.trim() };
      await saveVariant(projectId, renamed);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? ({
                ...p,
                variants: ((p.variants as any[]) || []).map((v) =>
                  v.id === variantId ? renamed : v
                ),
              } as any)
            : p
        )
      );
      toast.success('Subprojeto renomeado!');
    } catch (err) {
      console.error('Error renaming variant:', err);
      toast.error('Falha ao renomear subprojeto.');
    }
  };

  // Exclui na hora e oferece DESFAZER no toast (~7s) — recupera delete por engano
  // sem a fricção do "tem certeza?". O subprojeto é re-salvável (temos o dado).
  const handleDeleteVariant = async (projectId: string, variantId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    const variant = ((proj?.variants as any[]) || []).find((v) => v.id === variantId);
    if (!variant) return;
    const wasCurrent = currentVariantId === variantId;
    try {
      await deleteVariantDoc(projectId, variantId);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? ({
                ...p,
                variants: ((p.variants as any[]) || []).filter((v) => v.id !== variantId),
              } as any)
            : p
        )
      );
      if (wasCurrent) setCurrentVariantId(null);
      toast(
        (t) => (
          <span className="flex items-center gap-3">
            Versão excluída.
            <button
              onClick={async () => {
                toast.dismiss(t.id);
                try {
                  await saveVariant(projectId, variant);
                  setProjects((prev) =>
                    prev.map((p) =>
                      p.id === projectId
                        ? ({ ...p, variants: [...((p.variants as any[]) || []), variant] } as any)
                        : p
                    )
                  );
                  toast.success('Versão restaurada.');
                } catch {
                  toast.error('Falha ao desfazer.');
                }
              }}
              className="font-black underline text-blue-600"
            >
              Desfazer
            </button>
          </span>
        ),
        { duration: 7000 }
      );
    } catch (err) {
      console.error('Error deleting variant:', err);
      setError('Falha ao excluir versão.');
    }
  };

  return { handleLoadVariant, handleDuplicateAsVariant, handleRenameVariant, handleDeleteVariant };
}
