import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { loadVariants, saveVariant } from '@/lib/variantStore';
import type { ProjectVariant } from '@/types/project';
import {
  Star,
  Download,
  CheckSquare,
  Square,
  Rocket,
  Film,
  Smartphone,
  X,
  ShieldAlert,
  ShieldCheck,
  GitBranch,
  Loader2,
  Check,
  Languages,
  Package,
  Copy as CopyIcon,
} from 'lucide-react';
import { Skeleton } from '@/components/Skeleton';
import { FeedMockup } from '@/components/FeedMockup';
import { scanForRisks } from '@/lib/contentRiskScanner';
import { CATEGORY_LABELS, SEVERITY_META } from '@/data/contentRiskTerms';
import {
  generateOriginalHooks,
  translateScript,
  type OriginalHookGroup,
} from '@/lib/claudeService';
import { generateAudio } from '@/lib/vozPremiumService';
import { unlockAchievement } from '@/lib/achievements';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// BIBLIOTECA DE CRIATIVOS: junta os vídeos PRONTOS de todos os subprojetos do
// projeto atual num só lugar. Favoritar e marcar "publicado" (localStorage, como
// os outros favoritos do app), baixar em lote. É read-only sobre os subprojetos.

interface Props {
  projectId?: string | null;
  projectName?: string;
  uid?: string;
}

interface Creative {
  url: string;
  variantId: string;
  variantName: string;
  source: string;
  cover?: string;
  aspect?: string;
  /** Texto do subprojeto (script + hook + texto da capa) — pra checagem de
   *  compliance antes de publicar. */
  riskText: string;
}

const FAV_KEY = 'metavise-criativos-fav';
const PUB_KEY = 'metavise-criativos-pub';
const TAGS_KEY = 'metavise-criativos-tags';

function loadSet(key: string): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set<string>();
  }
}
function saveSet(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* ignora */
  }
}
function loadTags(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(TAGS_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveTags(t: Record<string, string[]>) {
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(t));
  } catch {
    /* ignora */
  }
}

export function CriativosTab({ projectId, projectName, uid }: Props) {
  const { t } = useLanguage();
  const crt = t.criativosTab;
  const [loading, setLoading] = useState(false);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  // Variants crus (não só os vídeos prontos) — precisamos do config completo
  // pra clonar em "Criar variações A/B".
  const [variants, setVariants] = useState<ProjectVariant[]>([]);
  const [fav, setFav] = useState<Set<string>>(() => loadSet(FAV_KEY));
  const [pub, setPub] = useState<Set<string>>(() => loadSet(PUB_KEY));
  const [filter, setFilter] = useState<'todos' | 'favoritos' | 'publicados'>('todos');
  const [fmtFilter, setFmtFilter] = useState<'todos' | '9:16' | '1:1' | '16:9'>('todos');
  const [srcFilter, setSrcFilter] = useState<string>('todos');
  const [tags, setTags] = useState<Record<string, string[]>>(() => loadTags());
  const [tagFilter, setTagFilter] = useState<string>('todos');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Checklist de publicação: abre ao marcar "no ar" um criativo ainda não publicado.
  const [pubModalUrl, setPubModalUrl] = useState<string | null>(null);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const [riskAck, setRiskAck] = useState(false);
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);

  const refresh = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const vs = await loadVariants(projectId);
      setVariants(vs);
      const out: Creative[] = [];
      const seen = new Set<string>();
      const push = (
        url: string,
        variantId: string,
        variantName: string,
        source: string,
        cover: string | undefined,
        aspect: string | undefined,
        riskText: string
      ) => {
        // False positive: the rule misattributes this Set.has() read to
        // mutating `crt` (the i18n dict from useLanguage()), which isn't
        // touched here at all.
        // eslint-disable-next-line react-hooks/immutability
        if (!url || seen.has(url)) return;
        seen.add(url);
        out.push({ url, variantId, variantName, source, cover, aspect, riskText });
      };
      for (const v of vs) {
        const cfg = (v.config || {}) as any;
        const name = v.name || crt.noNameFallback;
        const cover = cfg?.montagem?.coverUrl || cfg?.montagem?.coverOptions?.[0];
        const aspect = cfg?.montagem?.aspect; // formato do subprojeto (proxy)
        // Junta todo texto do subprojeto que vai pro público — script final,
        // hook escolhido e o texto queimado na capa — pra escanear risco
        // ANTES de marcar o criativo como publicado (não só na Copy).
        const riskText = [
          cfg?.copy?.hookSelecionado,
          cfg?.copy?.finalScript,
          cfg?.copy?.optimizedScript,
          cfg?.copy?.generatedScript,
          cfg?.montagem?.coverText,
          cfg?.montagemVsl?.coverText,
        ]
          .filter(Boolean)
          .join('\n');
        const edit = cfg?.edit || {};
        (edit.zapVersions || []).forEach((u: string) =>
          push(u, v.id, name, crt.sourceLabels.edicao, cover, aspect, riskText)
        );
        (edit.zapVslVersions || []).forEach((u: string) =>
          push(u, v.id, name, crt.sourceLabels.edicaoVsl, cover, aspect, riskText)
        );
        (edit.zapHookVersions || []).forEach((u: string) =>
          push(u, v.id, name, crt.sourceLabels.gancho, cover, aspect, riskText)
        );
        if (cfg?.montagem?.resultUrl)
          push(
            cfg.montagem.resultUrl,
            v.id,
            name,
            crt.sourceLabels.montagem,
            cover,
            aspect,
            riskText
          );
        if (cfg?.videoUrl)
          push(cfg.videoUrl, v.id, name, crt.sourceLabels.avatar, cover, aspect, riskText);
      }
      setCreatives(out);
    } catch (e: any) {
      toast.error(e?.message || crt.toasts.loadCreativesFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const toggleFav = (url: string) => {
    setFav((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      saveSet(FAV_KEY, next);
      return next;
    });
  };
  const togglePub = (url: string) => {
    if (pub.has(url)) {
      // Já publicado → desmarca na hora.
      setPub((prev) => {
        const next = new Set(prev);
        next.delete(url);
        saveSet(PUB_KEY, next);
        return next;
      });
    } else {
      // Vai publicar → abre o checklist antes.
      setChecks([false, false, false, false]);
      setRiskAck(false);
      setPubModalUrl(url);
    }
  };
  const activePub = useMemo(
    () => creatives.find((c) => c.url === pubModalUrl),
    [creatives, pubModalUrl]
  );
  // Compliance por nicho — mesmo scanner da Copy (medicamento, celebridade,
  // discriminação, alegação médica, promessa financeira etc.), mas rodado
  // aqui no PORTÃO de publicação, não só durante a edição do texto.
  const riskScan = useMemo(() => scanForRisks(activePub?.riskText || ''), [activePub]);
  const confirmPublish = (force = false) => {
    if (!pubModalUrl) return;
    if (!force && (!checks.every(Boolean) || (riskScan.hasRisk && !riskAck))) return;
    setPub((prev) => {
      const next = new Set(prev);
      next.add(pubModalUrl);
      saveSet(PUB_KEY, next);
      return next;
    });
    setPubModalUrl(null);
    toast.success(crt.toasts.markedOnAir);
    void unlockAchievement(uid, 'primeiro_criativo');
  };
  const addTag = (url: string) => {
    const raw = (window.prompt(crt.card.addTagPrompt) || '').trim();
    if (!raw) return;
    setTags((prev) => {
      const cur = prev[url] || [];
      if (cur.includes(raw)) return prev;
      const next = { ...prev, [url]: [...cur, raw] };
      saveTags(next);
      return next;
    });
  };
  const removeTag = (url: string, tag: string) => {
    setTags((prev) => {
      const next = { ...prev, [url]: (prev[url] || []).filter((t) => t !== tag) };
      saveTags(next);
      return next;
    });
  };
  const toggleSel = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  // Variações A/B automáticas — a partir de um criativo aprovado, gera N hooks
  // originais (mesmo motor do Hook Lab) e cria um subprojeto novo por hook
  // escolhido (clone do original, resultados zerados). O usuário ainda monta
  // cada um manualmente — só automatiza a parte chata de duplicar N vezes.
  const [abVariantUrl, setAbVariantUrl] = useState<string | null>(null);
  const [abGenerating, setAbGenerating] = useState(false);
  const [abGroups, setAbGroups] = useState<OriginalHookGroup[]>([]);
  const [abSelected, setAbSelected] = useState<Set<string>>(new Set());
  const [abCreating, setAbCreating] = useState(false);

  const abSourceVariant = useMemo(
    () => variants.find((v) => v.id === creatives.find((c) => c.url === abVariantUrl)?.variantId),
    [variants, creatives, abVariantUrl]
  );

  const openAbModal = (url: string) => {
    setAbVariantUrl(url);
    setAbGroups([]);
    setAbSelected(new Set());
  };

  const handleGenerateAbHooks = async () => {
    const cfg = (abSourceVariant?.config || {}) as any;
    const approvedCopy: string =
      cfg?.copy?.finalScript || cfg?.copy?.optimizedScript || cfg?.copy?.generatedScript || '';
    if (!approvedCopy) {
      toast.error(crt.toasts.noApprovedCopyForHooks);
      return;
    }
    setAbGenerating(true);
    try {
      const copyAny = cfg?.copy || {};
      const activeBriefId: string | undefined = copyAny?.activeBriefId;
      const briefs: any[] = Array.isArray(copyAny?.creativeBriefs) ? copyAny.creativeBriefs : [];
      const personas: any[] = Array.isArray(copyAny?.personasWithWeights)
        ? copyAny.personasWithWeights
        : [];
      const activeBrief = activeBriefId ? briefs.find((b) => b.id === activeBriefId) : undefined;
      const targetPersona = activeBrief
        ? personas.find((p) => p.id === activeBrief.targetPersonaId)
        : undefined;
      const personaRaw = (targetPersona as any)?.raw || {};
      const groups = await generateOriginalHooks({
        productInfo: copyAny?.productInfo
          ? {
              produto: copyAny.productInfo.produto || copyAny.productInfo.name,
              oferta: copyAny.productInfo.oferta || copyAny.productInfo.offer,
              dorPrincipal:
                copyAny.productInfo.dorPrincipal ||
                copyAny.productInfo.painPoint ||
                copyAny.productInfo.mainPain,
            }
          : null,
        persona: targetPersona
          ? {
              name: targetPersona.name,
              mainPain: personaRaw.mainPain || targetPersona.painPoints?.[0],
              dominantFear: personaRaw.dominantFear,
              hiddenDesire: personaRaw.hiddenDesire,
              mainObjection: personaRaw.mainObjection,
              currentSituation: personaRaw.currentSituation,
            }
          : null,
        brief: activeBrief
          ? {
              angle: String(activeBrief.angle || ''),
              emotion: String(activeBrief.emotion || ''),
              style: String(activeBrief.style || ''),
              promiseFocus: activeBrief.promiseFocus,
            }
          : null,
        approvedCopy,
        language: copyAny?.answers?.language,
        awarenessLevel: String(copyAny?.answers?.awarenessLevel || ''),
      });
      if (groups.length === 0) {
        toast.error(crt.toasts.aiCouldNotGenerateHooks);
        return;
      }
      setAbGroups(groups);
    } catch (e: any) {
      toast.error(e?.message || crt.toasts.errorGeneratingHooks);
    } finally {
      setAbGenerating(false);
    }
  };

  const toggleAbHook = (hook: string) => {
    setAbSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hook)) next.delete(hook);
      else next.add(hook);
      return next;
    });
  };

  const handleCreateAbVariants = async () => {
    if (!projectId || !abSourceVariant || abSelected.size === 0) return;
    setAbCreating(true);
    try {
      const hooks = Array.from(abSelected);
      for (const hook of hooks) {
        // Clone profundo — não pode compartilhar referência com o original.
        const cloned = JSON.parse(JSON.stringify(abSourceVariant.config || {}));
        cloned.costs = [];
        cloned.montagem = {
          ...(cloned.montagem || {}),
          resultUrl: '',
          coverUrl: '',
          coverOptions: [],
          coverText: '',
        };
        cloned.edit = {
          ...(cloned.edit || {}),
          zapVersions: [],
          zapHookVersions: [],
          zapVslVersions: [],
          zapJoinedVersions: [],
        };
        cloned.copy = { ...(cloned.copy || {}) };
        cloned.copy.hookSelecionado = hook;
        const existingHistorico = Array.isArray(cloned.copy.hooksHistorico)
          ? cloned.copy.hooksHistorico
          : [];
        cloned.copy.hooksHistorico = [
          { hook, createdAt: new Date().toISOString() },
          ...existingHistorico,
        ].slice(0, 50);
        const newVariant: ProjectVariant = {
          id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: `${abSourceVariant.name || crt.variantFallbackName} · A/B: ${hook.slice(0, 28)}${hook.length > 28 ? '…' : ''}`,
          config: cloned,
          createdAt: new Date().toISOString(),
        };
        await saveVariant(projectId, newVariant);
      }
      toast.success(crt.toasts.abVariantsCreated(hooks.length));
      setAbVariantUrl(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || crt.toasts.abVariantsCreateFailed);
    } finally {
      setAbCreating(false);
    }
  };

  // Multi-idioma — traduz o script + hook (Claude) e reduble com a MESMA voz
  // (ElevenLabs multilingual). Entrega um subprojeto novo já com o áudio
  // dublado carregado como "áudio cheio" — o corte/legenda/b-roll é refeito
  // pelo Fatiar automático já existente na Montagem (ele re-transcreve o
  // áudio novo, então o timing sai certo pra língua nova).
  const COMMON_LANGUAGES = [
    'English',
    'Español',
    'Français',
    'Deutsch',
    'Italiano',
    '中文',
    '日本語',
  ];
  const [translateUrl, setTranslateUrl] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translateResult, setTranslateResult] = useState<{
    script: string;
    hook: string;
    audioUrl: string;
  } | null>(null);
  const [creatingTranslated, setCreatingTranslated] = useState(false);

  const translateSourceVariant = useMemo(
    () => variants.find((v) => v.id === creatives.find((c) => c.url === translateUrl)?.variantId),
    [variants, creatives, translateUrl]
  );

  const openTranslateModal = (url: string) => {
    setTranslateUrl(url);
    setTargetLang('');
    setTranslateResult(null);
  };

  const handleTranslate = async () => {
    const cfg = (translateSourceVariant?.config || {}) as any;
    const approvedCopy: string =
      cfg?.copy?.finalScript || cfg?.copy?.optimizedScript || cfg?.copy?.generatedScript || '';
    const hook: string = cfg?.copy?.hookSelecionado || '';
    const voiceId: string = cfg?.avatar?.voiceId || '';
    if (!approvedCopy) {
      toast.error(crt.toasts.noApprovedCopyForTranslate);
      return;
    }
    if (!targetLang.trim()) {
      toast.error(crt.toasts.chooseTargetLanguage);
      return;
    }
    setTranslating(true);
    try {
      const [script, translatedHook] = await Promise.all([
        translateScript({ text: approvedCopy, targetLanguage: targetLang }),
        hook ? translateScript({ text: hook, targetLanguage: targetLang }) : Promise.resolve(''),
      ]);
      if (!script) {
        toast.error(crt.toasts.translationFailed);
        return;
      }
      let audioUrl = '';
      if (voiceId) {
        try {
          const audio = await generateAudio({
            voiceId,
            script,
            modelId: 'eleven_multilingual_v2',
            userId: uid,
          });
          audioUrl = audio.audioUrl;
        } catch (e: any) {
          toast.error(crt.toasts.dubbingFailedButTranslated(e?.message || 'erro'));
        }
      } else {
        toast.error(crt.toasts.noSavedVoiceTranslatedOnly);
      }
      setTranslateResult({ script, hook: translatedHook, audioUrl });
    } catch (e: any) {
      toast.error(e?.message || crt.toasts.translateError);
    } finally {
      setTranslating(false);
    }
  };

  const handleCreateTranslatedVariant = async () => {
    if (!projectId || !translateSourceVariant || !translateResult) return;
    setCreatingTranslated(true);
    try {
      const cloned = JSON.parse(JSON.stringify(translateSourceVariant.config || {}));
      cloned.costs = [];
      cloned.copy = { ...(cloned.copy || {}) };
      cloned.copy.generatedScript = translateResult.script;
      cloned.copy.finalScript = translateResult.script;
      cloned.copy.optimizedScript = translateResult.script;
      if (translateResult.hook) cloned.copy.hookSelecionado = translateResult.hook;
      cloned.copy.answers = { ...(cloned.copy.answers || {}), language: targetLang };
      // Reseta a montagem inteira — cortes/legendas antigos são do timing da
      // língua original e não valem pro áudio novo. fullAudioUrl carrega o
      // áudio dublado pronto pro Fatiar automático re-transcrever do zero.
      cloned.montagem = {
        resultUrl: '',
        coverUrl: '',
        coverOptions: [],
        coverText: '',
        fullAudioUrl: translateResult.audioUrl,
      };
      cloned.montagemVsl = {
        resultUrl: '',
        coverUrl: '',
        coverOptions: [],
        coverText: '',
        fullAudioUrl: translateResult.audioUrl,
      };
      cloned.edit = {
        ...(cloned.edit || {}),
        zapVersions: [],
        zapHookVersions: [],
        zapVslVersions: [],
        zapJoinedVersions: [],
      };
      const newVariant: ProjectVariant = {
        id: `variant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: `${translateSourceVariant.name || crt.variantFallbackName} · ${targetLang}`,
        config: cloned,
        createdAt: new Date().toISOString(),
      };
      await saveVariant(projectId, newVariant);
      toast.success(crt.toasts.translatedVariantCreated(targetLang));
      setTranslateUrl(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || crt.toasts.translatedVariantCreateFailed);
    } finally {
      setCreatingTranslated(false);
    }
  };

  // Pacote de publicação — a conexão direta com o Meta Ads está desligada de
  // propósito (contas caindo ao linkar com o Claude), então em vez de publicar
  // sozinho, juntamos tudo que o Meta Ads Manager pede num painel de
  // copiar/colar: vídeo, capa, texto principal, título e CTA sugerido.
  const [pkgUrl, setPkgUrl] = useState<string | null>(null);
  const pkgCreative = useMemo(() => creatives.find((c) => c.url === pkgUrl), [creatives, pkgUrl]);
  const pkgSourceVariant = useMemo(
    () => variants.find((v) => v.id === pkgCreative?.variantId),
    [variants, pkgCreative]
  );
  const pkgCopy = (() => {
    const cfg = (pkgSourceVariant?.config || {}) as any;
    const headline = cfg?.copy?.hookSelecionado || '';
    const primaryText =
      cfg?.copy?.finalScript || cfg?.copy?.optimizedScript || cfg?.copy?.generatedScript || '';
    const offer = cfg?.copy?.productInfo?.oferta || cfg?.copy?.productInfo?.offer || '';
    return { headline, primaryText, offer };
  })();

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(crt.toasts.copiedLabel(label));
    } catch {
      toast.error(crt.toasts.copyFailed);
    }
  };

  // Fontes presentes (pra montar o filtro dinamicamente).
  const sources = useMemo(() => Array.from(new Set(creatives.map((c) => c.source))), [creatives]);
  // Todas as tags em uso (pra o filtro).
  const allTags = useMemo(() => Array.from(new Set(Object.values(tags).flat())).sort(), [tags]);

  const shown = useMemo(() => {
    return creatives.filter((c) => {
      if (filter === 'favoritos' && !fav.has(c.url)) return false;
      if (filter === 'publicados' && !pub.has(c.url)) return false;
      if (fmtFilter !== 'todos' && c.aspect !== fmtFilter) return false;
      if (srcFilter !== 'todos' && c.source !== srcFilter) return false;
      if (tagFilter !== 'todos' && !(tags[c.url] || []).includes(tagFilter)) return false;
      return true;
    });
  }, [creatives, filter, fav, pub, fmtFilter, srcFilter, tagFilter, tags]);

  const baixarSelecionados = () => {
    const urls = shown.filter((c) => selected.has(c.url));
    if (urls.length === 0) return toast.error(crt.toasts.selectAtLeastOne);
    // Dispara os downloads em sequência (com folga pro navegador não bloquear).
    urls.forEach((c, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = c.url;
        a.download = `${c.variantName}-${c.source}.mp4`.replace(/[^a-z0-9.-]/gi, '_');
        a.target = '_blank';
        a.rel = 'noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
    toast.success(crt.toasts.downloadingCount(urls.length));
  };

  if (!projectId) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center text-gray-500">
        {crt.header.noProjectMessage}
      </div>
    );
  }

  const chip = (id: typeof filter, label: string, n: number) => (
    <button
      onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-black ${
        filter === id
          ? 'bg-blue-700 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
      }`}
    >
      {label} ({n})
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-4 p-2">
      <div className="flex items-center gap-2">
        <Film size={20} className="text-blue-700 dark:text-blue-400" />
        <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">
          {crt.header.titlePrefix} {projectName ? `· ${projectName}` : ''}
        </h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        {crt.header.subtitlePart1} <b>{crt.header.publishedBold}</b> {crt.header.subtitlePart2}
      </p>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {chip('todos', crt.filters.all, creatives.length)}
          {chip('favoritos', crt.filters.favorites, creatives.filter((c) => fav.has(c.url)).length)}
          {chip(
            'publicados',
            crt.filters.published,
            creatives.filter((c) => pub.has(c.url)).length
          )}
          <select
            value={fmtFilter}
            onChange={(e) => setFmtFilter(e.target.value as any)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-black bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-none outline-none"
          >
            <option value="todos">{crt.filters.allFormats}</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
          </select>
          <select
            value={srcFilter}
            onChange={(e) => setSrcFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-black bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-none outline-none"
          >
            <option value="todos">{crt.filters.allSources}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-black bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-none outline-none"
            >
              <option value="todos">{crt.filters.allTags}</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
        </div>
        {selected.size > 0 && (
          <button
            onClick={baixarSelecionados}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-black"
          >
            <Download size={14} /> {crt.filters.downloadSelectedButton(selected.size)}
          </button>
        )}
      </div>

      {loading ? (
        <Skeleton.GalleryGrid count={8} />
      ) : shown.length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">
          {crt.emptyState.message(
            filter !== 'todos'
              ? crt.emptyState.filteredSuffix(filter)
              : crt.emptyState.defaultSuffix
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {shown.map((c) => {
            const isFav = fav.has(c.url);
            const isPub = pub.has(c.url);
            const isSel = selected.has(c.url);
            return (
              <div
                key={c.url}
                className={`rounded-xl overflow-hidden ring-1 bg-white dark:bg-gray-900/60 ${
                  isSel ? 'ring-2 ring-blue-500' : 'ring-gray-200 dark:ring-gray-800'
                }`}
              >
                <div className="relative">
                  <video
                    src={c.url}
                    poster={c.cover}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) =>
                      (e.currentTarget as HTMLVideoElement).play().catch(() => {})
                    }
                    onMouseLeave={(e) => {
                      const v = e.currentTarget as HTMLVideoElement;
                      v.pause();
                      v.currentTime = 0;
                    }}
                    className="w-full aspect-[9/16] object-cover bg-black"
                  />
                  <button
                    onClick={() => toggleSel(c.url)}
                    className="absolute top-1 left-1 p-1 rounded-md bg-black/60 text-white hover:bg-black/80"
                    title={crt.card.selectForBatchTitle}
                  >
                    {isSel ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  {isPub && (
                    <span className="absolute top-1 right-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-600 text-white text-[9px] font-black uppercase">
                      <Rocket size={9} /> {crt.card.onAirBadge}
                    </span>
                  )}
                </div>
                <div className="p-2 space-y-1.5">
                  <p
                    className="text-[11px] font-bold text-gray-800 dark:text-gray-100 truncate"
                    title={c.variantName}
                  >
                    {c.variantName}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                    {c.source}
                  </p>
                  {/* Tags */}
                  <div className="flex flex-wrap items-center gap-1">
                    {(tags[c.url] || []).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 text-[9px] font-bold"
                      >
                        #{t}
                        <button
                          onClick={() => removeTag(c.url, t)}
                          className="hover:text-red-500"
                          title={crt.card.removeTagTitle}
                        >
                          <X size={9} />
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => addTag(c.url)}
                      className="px-1.5 py-0.5 rounded-md border border-dashed border-gray-300 dark:border-gray-700 text-gray-400 hover:text-blue-600 hover:border-blue-400 text-[9px] font-bold"
                      title={crt.card.addTagTitle}
                    >
                      {crt.card.addTagButton}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleFav(c.url)}
                      className={`p-1.5 rounded-lg ${isFav ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                      title={crt.card.favoriteTitle}
                    >
                      <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => togglePub(c.url)}
                      className={`p-1.5 rounded-lg ${isPub ? 'text-green-600' : 'text-gray-300 hover:text-green-500'}`}
                      title={isPub ? crt.card.markedPublishedTitle : crt.card.markPublishedTitle}
                    >
                      <Rocket size={14} />
                    </button>
                    <button
                      onClick={() => openAbModal(c.url)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-indigo-600"
                      title={crt.card.abVariantsTitle}
                    >
                      <GitBranch size={14} />
                    </button>
                    <button
                      onClick={() => openTranslateModal(c.url)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-teal-600"
                      title={crt.card.translateTitle}
                    >
                      <Languages size={14} />
                    </button>
                    <button
                      onClick={() => setPkgUrl(c.url)}
                      className="p-1.5 rounded-lg text-gray-300 hover:text-blue-600"
                      title={crt.card.packageTitle}
                    >
                      <Package size={14} />
                    </button>
                    <button
                      onClick={() => setMockupUrl(c.url)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-purple-600 ml-auto"
                      title={crt.card.feedPreviewTitle}
                    >
                      <Smartphone size={14} />
                    </button>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600"
                      title={crt.card.downloadTitle}
                    >
                      <Download size={14} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Checklist de publicação — nudge pra conferir antes de marcar "no ar". */}
      {pubModalUrl && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPubModalUrl(null)}
        >
          <div
            className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Rocket size={18} className="text-green-600" />
              <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                {crt.pubModal.title}
              </h3>
            </div>

            {/* Compliance por nicho — mesmo scanner da Copy, rodado aqui de novo
                (o texto pode ter mudado, ou nunca ter passado por lá). Não
                bloqueia — só avisa; "publicar assim mesmo" sempre disponível. */}
            {riskScan.hasRisk ? (
              <div className="rounded-xl border-2 border-amber-300 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                  <ShieldAlert size={16} />
                  <span className="text-xs font-black uppercase tracking-widest">
                    {crt.pubModal.riskCountLabel(riskScan.hits.length)}
                  </span>
                </div>
                <ul className="space-y-1">
                  {riskScan.hits.map((h, idx) => (
                    <li
                      key={`${h.term.pattern}-${idx}`}
                      className="text-xs text-amber-900 dark:text-amber-200"
                    >
                      <span className="font-bold">"{h.matched}"</span>
                      <span className="text-amber-700/80 dark:text-amber-300/70">
                        {' '}
                        · {CATEGORY_LABELS[h.term.category]} ({SEVERITY_META[h.term.severity].label}
                        ) — {h.term.reason}
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-start gap-2 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={riskAck}
                    onChange={(e) => setRiskAck(e.target.checked)}
                    className="mt-0.5 accent-amber-600"
                  />
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    {crt.pubModal.riskAckLabel}
                  </span>
                </label>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs font-bold text-green-700 dark:text-green-400">
                <ShieldCheck size={14} />
                {crt.pubModal.noRiskFound}
              </div>
            )}

            <p className="text-xs text-gray-500 dark:text-gray-400">
              {crt.pubModal.checklistIntro}
            </p>
            {crt.pubModal.checklistItems.map((item, i) => (
              <label key={i} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={(e) =>
                    setChecks((prev) => prev.map((c, k) => (k === i ? e.target.checked : c)))
                  }
                  className="mt-0.5 accent-green-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">{item}</span>
              </label>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                onClick={() => confirmPublish(true)}
                className="text-[11px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {crt.pubModal.publishAnywayButton}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPubModalUrl(null)}
                  className="px-3 py-2 rounded-xl text-xs font-black text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {crt.pubModal.cancelButton}
                </button>
                <button
                  onClick={() => confirmPublish(false)}
                  disabled={!checks.every(Boolean) || (riskScan.hasRisk && !riskAck)}
                  className="px-4 py-2 rounded-xl bg-green-600 text-white text-xs font-black hover:bg-green-700 disabled:opacity-40"
                >
                  {crt.pubModal.confirmButton}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Variações A/B — gera hooks originais e cria um subprojeto clonado por
          hook escolhido, pronto pra montar e testar. */}
      {abVariantUrl && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !abCreating && setAbVariantUrl(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch size={18} className="text-indigo-600" />
                <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                  {crt.abModal.title}
                </h3>
              </div>
              <button
                onClick={() => setAbVariantUrl(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{crt.abModal.description}</p>

            {abGroups.length === 0 ? (
              <button
                onClick={handleGenerateAbHooks}
                disabled={abGenerating}
                className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {abGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> {crt.abModal.generatingButton}
                  </>
                ) : (
                  <>{crt.abModal.generateButton}</>
                )}
              </button>
            ) : (
              <>
                <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                  {abGroups.map((g) => (
                    <div key={g.formula} className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        {g.formula}
                      </p>
                      {g.hooks.map((hook, i) => {
                        const isSel = abSelected.has(hook);
                        return (
                          <button
                            key={`${g.formula}-${i}`}
                            onClick={() => toggleAbHook(hook)}
                            className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-start gap-2 ring-1 ${
                              isSel
                                ? 'bg-indigo-50 dark:bg-indigo-950/30 ring-indigo-400 text-indigo-900 dark:text-indigo-200'
                                : 'bg-gray-50 dark:bg-gray-800/50 ring-gray-200 dark:ring-gray-800 text-gray-700 dark:text-gray-300 hover:ring-gray-300'
                            }`}
                          >
                            <span
                              className={`mt-0.5 w-4 h-4 shrink-0 rounded flex items-center justify-center ${
                                isSel
                                  ? 'bg-indigo-600 text-white'
                                  : 'ring-1 ring-gray-300 dark:ring-gray-600'
                              }`}
                            >
                              {isSel && <Check size={11} />}
                            </span>
                            {hook}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    onClick={handleGenerateAbHooks}
                    disabled={abGenerating}
                    className="text-[11px] font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {crt.abModal.generateOthersButton}
                  </button>
                  <button
                    // False positive: the rule claims this handler mutates
                    // `crt` (the i18n dict) — it only calls saveVariant/refresh.
                    // eslint-disable-next-line react-hooks/immutability
                    onClick={handleCreateAbVariants}
                    disabled={abSelected.size === 0 || abCreating}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-2"
                  >
                    {abCreating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <GitBranch size={14} />
                    )}
                    {crt.abModal.createButton(abSelected.size)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Multi-idioma — traduz o script e reduble com a mesma voz, cria um
          subprojeto novo já com o áudio pronto pra Fatiar automático. */}
      {translateUrl && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !translating && !creatingTranslated && setTranslateUrl(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Languages size={18} className="text-teal-600" />
                <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                  {crt.translateModal.title}
                </h3>
              </div>
              <button
                onClick={() => setTranslateUrl(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {crt.translateModal.descriptionPart1} <b>{crt.translateModal.autoSliceBold}</b>{' '}
              {crt.translateModal.descriptionPart2}
            </p>

            {!translateResult ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    {crt.translateModal.targetLangLabel}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_LANGUAGES.map((l) => (
                      <button
                        key={l}
                        onClick={() => setTargetLang(l)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-black ${
                          targetLang === l
                            ? 'bg-teal-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    placeholder={crt.translateModal.targetLangPlaceholder}
                    className="w-full px-3 py-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 bg-white dark:bg-gray-900 text-sm font-bold text-gray-800 dark:text-gray-100"
                  />
                </div>
                <button
                  onClick={handleTranslate}
                  disabled={translating || !targetLang.trim()}
                  className="w-full py-3 bg-teal-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-teal-700 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {translating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />{' '}
                      {crt.translateModal.translatingButton}
                    </>
                  ) : (
                    <>{crt.translateModal.translateButton}</>
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="rounded-xl bg-teal-50/60 dark:bg-teal-950/20 ring-1 ring-teal-200 dark:ring-teal-900/40 p-3 space-y-2 max-h-[35vh] overflow-y-auto">
                  {translateResult.hook && (
                    <p className="text-sm font-black text-gray-900 dark:text-gray-100">
                      {translateResult.hook}
                    </p>
                  )}
                  <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {translateResult.script}
                  </p>
                </div>
                {translateResult.audioUrl ? (
                  <audio src={translateResult.audioUrl} controls className="w-full h-9" />
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {crt.translateModal.noAudioHint}
                  </p>
                )}
                <button
                  // False positive: the rule claims this handler mutates
                  // `crt` (the i18n dict) — it only calls saveVariant/refresh.
                  // eslint-disable-next-line react-hooks/immutability
                  onClick={handleCreateTranslatedVariant}
                  disabled={creatingTranslated}
                  className="w-full py-3 bg-teal-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-teal-700 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {creatingTranslated ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />{' '}
                      {crt.translateModal.creatingButton}
                    </>
                  ) : (
                    <>{crt.translateModal.createButton(targetLang)}</>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Pacote de publicação — junta vídeo, capa, texto e título prontos pra
          colar no Ads Manager. Alternativa segura à publicação direta (a
          conexão com a API do Meta está desligada de propósito). */}
      {pkgUrl && pkgCreative && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPkgUrl(null)}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-blue-600" />
                <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                  {crt.pkgModal.title}
                </h3>
              </div>
              <button
                onClick={() => setPkgUrl(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{crt.pkgModal.description}</p>

            <div className="grid grid-cols-2 gap-2">
              <a
                href={pkgCreative.url}
                target="_blank"
                rel="noreferrer"
                download
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-black"
              >
                <Download size={13} /> {crt.pkgModal.videoButton}
              </a>
              {pkgCreative.cover ? (
                <a
                  href={pkgCreative.cover}
                  target="_blank"
                  rel="noreferrer"
                  download
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 text-xs font-black"
                >
                  <Download size={13} /> {crt.pkgModal.coverButton}
                </a>
              ) : (
                <span className="flex items-center justify-center py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-gray-400 text-[10px] font-bold">
                  {crt.pkgModal.noCoverLabel}
                </span>
              )}
            </div>

            {[
              {
                label: crt.pkgModal.titleLabel,
                value: pkgCopy.headline || crt.pkgModal.noHookSaved,
              },
              {
                label: crt.pkgModal.mainTextLabel,
                value: pkgCopy.primaryText || crt.pkgModal.noApprovedCopySaved,
              },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                    {label}
                  </span>
                  <button
                    onClick={() => copyText(value, label)}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-600"
                    title={crt.pkgModal.copyFieldTitle(label.toLowerCase())}
                  >
                    <CopyIcon size={12} />
                  </button>
                </div>
                <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 max-h-32 overflow-y-auto">
                  {value}
                </p>
              </div>
            ))}

            <div className="rounded-xl bg-blue-50/60 dark:bg-blue-950/20 ring-1 ring-blue-200/60 dark:ring-blue-900/40 p-3 space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                {crt.pkgModal.ctaSuggestedLabel}
              </span>
              <p className="text-xs text-blue-900 dark:text-blue-200">
                {crt.pkgModal.ctaSuggestedTextPart1}
                {pkgCopy.offer ? crt.pkgModal.ctaSuggestedOfferSuffix(pkgCopy.offer) : ''}.
              </p>
            </div>

            <button
              onClick={() =>
                copyText(
                  crt.pkgModal.copyAllTemplate(
                    pkgCopy.headline,
                    pkgCopy.primaryText,
                    pkgCreative.url,
                    pkgCreative.cover || crt.pkgModal.noCoverPlaceholder
                  ),
                  crt.pkgModal.copyAllLabel
                )
              }
              className="w-full py-3 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-700 flex items-center justify-center gap-2"
            >
              <CopyIcon size={16} /> {crt.pkgModal.copyAllButton}
            </button>
          </div>
        </div>
      )}

      <FeedMockup
        open={!!mockupUrl}
        onClose={() => setMockupUrl(null)}
        videoUrl={mockupUrl || ''}
      />
    </div>
  );
}
