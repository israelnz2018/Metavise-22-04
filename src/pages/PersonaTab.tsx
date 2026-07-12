// Persona discovery tab — 9-question form that feeds Claude to generate
// 3 ranked personas (principal / secondary / tertiary) with awareness
// levels. Receives state via props so App.tsx still owns the canonical
// `config`, `generatedPersona`, etc. Extracting this trimmed App.tsx
// by ~560 lines without changing any behavior.

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { AdConfig } from '@/App';
import { Users, Sparkles, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PERSONA_CATEGORY_OPTIONS,
  PERSONA_URGENCY_OPTIONS,
  PERSONA_DIFFERENTIAL_OPTIONS,
  PERSONA_TRIED_BEFORE_OPTIONS,
  PERSONA_PAYING_CAPACITY_OPTIONS,
  PERSONA_BILLING_OPTIONS,
  PERSONA_HIDDEN_DESIRE_OPTIONS,
  SALE_CURRENCY_OPTIONS,
  currencySymbol,
  COPY_SECTIONS,
} from '@/lib/constants';
import { personaFromProduct, extractProductInfo, type ProductInfo } from '@/lib/claudeService';

interface Props {
  // Single source of truth for the form. Read `config.copy.answers` and
  // `config.copy.productInfo`; write via `updateConfig` (deep merge) or
  // `setConfig` (full overwrite, used by the auto-fill button).
  config: AdConfig;
  // Section/sub/field stay loose because the deep-merge pattern reads
  // arbitrary nested paths — typing them strictly would require a giant
  // discriminated union for every (section, sub, field) triple.
  updateConfig: (section: any, sub: any, field: any, value: any) => void;
  setConfig: React.Dispatch<React.SetStateAction<AdConfig>>;

  // Result of the last persona generation. `personasSaved` gates the
  // "Enviar persona pra Copy" button.
  generatedPersona: any;
  personasSaved: boolean;

  // Parent-owned async handlers.
  loading: boolean;
  onGeneratePersona: (answers: Record<string, any>) => Promise<void> | void;
  onSavePersonas: () => Promise<void> | void;
  /** Blueprint Path 2 — when set, shows the "Ir pro Plano de Marketing"
   *  CTA below the 3-persona grid. Receives the personas the user
   *  checked (could be 1-3) so the parent can wire them into the
   *  marketing-plan endpoint. Optional so callers that haven't migrated
   *  to the blueprint flow keep working. */
  onGoToPlan?: (selectedPersonas: any[]) => void;
}

export function PersonaTab({
  config,
  updateConfig,
  setConfig,
  generatedPersona,
  personasSaved,
  loading,
  onGeneratePersona,
  onSavePersonas,
  onGoToPlan,
}: Props) {
  // Selected persona indices for the Blueprint Path 2 CTA. We key by
  // index (not id) because the existing persona objects don't have
  // stable IDs yet — they're generated from the LLM each call. When
  // the personas array changes (regeneration), we reset selection
  // using the "include if confident enough and not a stretch" rule.
  const [selectedIdxSet, setSelectedIdxSet] = useState<Set<number>>(new Set());

  // Material do produto (VSL/link/texto) — fica no topo da aba. Ao extrair,
  // salva productInfo + sourceText; o auto-preencher (useEffect abaixo) então
  // preenche as perguntas. 1 clique extrai E preenche.
  const [matUrl, setMatUrl] = useState('');
  const [matText, setMatText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const handleExtractMaterial = async () => {
    if (!matText.trim() && !matUrl.trim()) {
      toast.error('Cole o link ou o texto do produto.');
      return;
    }
    setExtracting(true);
    try {
      const withProtocol = (u: string) => (u && !/^https?:\/\//i.test(u) ? `https://${u}` : u);
      const product = await extractProductInfo({
        text: matText.trim() || undefined,
        url: withProtocol(matUrl.trim()) || undefined,
      });
      const rawText = matText.trim() || `[URL: ${matUrl}]`;
      // Salva o material e marca personaAutoFilled:true pra o useEffect NÃO
      // disparar um 2º preenchimento — quem preenche é a chamada direta abaixo.
      setConfig((prev: any) => ({
        ...prev,
        copy: { ...prev.copy, productInfo: product, sourceText: rawText, personaAutoFilled: true },
      }));
      toast.success('Material extraído! Preenchendo as perguntas…');
      // 1 CLIQUE: preenche já, passando o product recém-extraído (não depende
      // do config ter atualizado). Resolve o "tive que clicar duas vezes".
      await handleFillFromSource(product);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (matUrl.trim() && /buscar URL|fetch failed/i.test(msg)) {
        toast.error(
          'Não consegui acessar esse link. Cole a URL COMPLETA (ex: https://www.seusite.com/pagina) — ou cole o TEXTO/transcrição no campo de texto.',
          { duration: 8000 }
        );
      } else {
        toast.error(msg || 'Erro ao extrair.');
      }
    } finally {
      setExtracting(false);
    }
  };

  // Pre-select personas with confidence >= 0.5 and not stretched.
  // Falls back to "include all" when the LLM didn't return the new
  // fields (back-compat with old saved personas).
  useEffect(() => {
    const list = (generatedPersona?.personas || []) as any[];
    if (list.length === 0) {
      setSelectedIdxSet(new Set());
      return;
    }
    const next = new Set<number>();
    let anyHasNewFields = false;
    list.forEach((p, idx) => {
      if (typeof p?.confidence === 'number' || typeof p?.isStretch === 'boolean') {
        anyHasNewFields = true;
        if ((p.confidence ?? 0.5) >= 0.5 && p.isStretch !== true) next.add(idx);
      }
    });
    // Old data: include all by default (preserves existing UX).
    if (!anyHasNewFields) list.forEach((_, idx) => next.add(idx));
    // Always make sure at least 1 is selected (the principal, idx 0).
    if (next.size === 0) next.add(0);
    setSelectedIdxSet(next);
  }, [generatedPersona?.personas]);

  // Pretty-format confidence as percentage. Missing → "—".
  const fmtPct = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—';
  const a = config.copy.answers;
  const differentials: string[] = a.differentials || [];
  const personaTriedBefore: string[] = a.personaTriedBefore || [];
  const hiddenDesires: string[] = a.hiddenDesires || [];

  // Auto-fill from the ProductInfo extracted in SourceTab — runs ONCE
  // per project on the first visit after Source ran. Idempotent via
  // the `personaAutoFilled` flag persisted in config. After this
  // effect runs the user sees a 100%-filled form ready to "Gerar".
  //
  // Skip when:
  //   - There's no ProductInfo (Source step skipped — manual path)
  //   - The form is clearly already filled (user came back to edit)
  //   - We've already auto-filled in a previous mount
  useEffect(() => {
    const flag = (config.copy as any)?.personaAutoFilled === true;
    const product = (config.copy as any)?.productInfo;
    if (flag || !product) return;
    // "Mostly empty" heuristic: if the required fields are all empty,
    // it's safe to auto-fill. If user already typed something, leave
    // it alone.
    const looksEmpty =
      !a.product?.trim() &&
      !a.category?.trim() &&
      !a.whatItDoes?.trim() &&
      personaTriedBefore.length === 0 &&
      differentials.length === 0 &&
      hiddenDesires.length === 0;
    if (!looksEmpty) {
      // Mark as filled anyway so we don't keep retrying when the user
      // is just iterating manually.
      setConfig((prev: any) => ({
        ...prev,
        copy: { ...prev.copy, personaAutoFilled: true },
      }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const allQuestions = COPY_SECTIONS.flatMap((s) => s.questions);
        const optionsFor = (id: string): string[] => {
          const q = allQuestions.find((q) => q.id === id);
          return (q as any)?.options || [];
        };
        const filled = await personaFromProduct({
          productInfo: product,
          options: {
            categories: PERSONA_CATEGORY_OPTIONS,
            urgencies: PERSONA_URGENCY_OPTIONS.map((o) => o.value),
            differentials: PERSONA_DIFFERENTIAL_OPTIONS,
            triedBefores: PERSONA_TRIED_BEFORE_OPTIONS,
            payingCapacities: PERSONA_PAYING_CAPACITY_OPTIONS,
            hiddenDesires: PERSONA_HIDDEN_DESIRE_OPTIONS.map((o) => o.label),
            languages: optionsFor('language'),
            ageBuckets: optionsFor('age'),
            businessModels: optionsFor('businessModel'),
            emotions: optionsFor('emotion'),
            angles: optionsFor('angleIdea'),
          },
        });
        if (cancelled) return;
        setConfig((prev: any) => ({
          ...prev,
          copy: {
            ...prev.copy,
            answers: { ...prev.copy.answers, ...filled },
            personaAutoFilled: true,
          },
        }));
        toast.success('Persona preenchida automaticamente pelo material do produto.', {
          icon: '✨',
        });
      } catch (err: any) {
        // Silent failure — don't pop a scary error toast for an
        // optional convenience. Mark the flag anyway so we don't
        // retry on every render.
        console.warn('[Persona auto-fill] failed:', err?.message);
        if (!cancelled) {
          setConfig((prev: any) => ({
            ...prev,
            copy: { ...prev.copy, personaAutoFilled: true },
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only react to productInfo identity — re-runs only
    // when the user re-extracts the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(config.copy as any)?.productInfo]);

  const toggleArrayValue = (field: string, value: string, max?: number) => {
    const current: string[] = a[field] || [];
    let next: string[];
    if (current.includes(value)) {
      next = current.filter((v) => v !== value);
    } else {
      if (max && current.length >= max) {
        toast.error(`Máximo de ${max} opções.`);
        return;
      }
      next = [...current, value];
    }
    updateConfig('copy', 'answers', field, next);
  };

  // Campos obrigatórios pra gerar personas — cada um com um rótulo amigável
  // pra avisar exatamente o que falta quando o usuário tenta gerar.
  const requiredFields: Array<{ ok: boolean; label: string }> = [
    { ok: (a.product || '').trim().length > 0, label: 'Produto' },
    { ok: (a.category || '').trim().length > 0, label: 'Categoria' },
    { ok: (a.whatItDoes || '').trim().length > 0, label: 'O que o produto faz' },
    { ok: (a.transformationFrom || '').trim().length > 0, label: 'Situação antes (de)' },
    { ok: (a.transformationTo || '').trim().length > 0, label: 'Situação depois (para)' },
    { ok: (a.urgency || '').trim().length > 0, label: 'Urgência' },
    { ok: differentials.length > 0, label: 'Diferenciais' },
    { ok: personaTriedBefore.length > 0, label: 'O que já tentou antes' },
    { ok: Number(a.salePrice) > 0, label: 'Preço de venda' },
    { ok: hiddenDesires.length > 0, label: 'Desejos ocultos' },
  ];
  const missingFields = requiredFields.filter((f) => !f.ok).map((f) => f.label);
  const allRequired = missingFields.length === 0;

  // Avisa o que falta quando o usuário clica sem completar. Mantemos o botão
  // SEMPRE clicável (não mais cinza/desabilitado) pra poder mostrar o aviso.
  const handleGenerateClick = () => {
    if (loading) return;
    if (!allRequired) {
      toast.error(
        `Complete o questionário antes de gerar. Falta preencher: ${missingFields.join(', ')}.`,
        { duration: 7000 }
      );
      return;
    }
    onGeneratePersona(a as any);
  };

  const personas: any[] = generatedPersona?.personas || [];
  const productInfo = config.copy?.productInfo as ProductInfo | null;

  const handleFillFromSource = async (productOverride?: ProductInfo | null) => {
    // Aceita um product recém-extraído (productOverride) pra não depender do
    // config já ter atualizado — é o que faz o "Extrair e preencher" rodar em
    // 1 clique só (sem isso, o productInfo do closure ainda era o antigo).
    const source = productOverride || productInfo;
    if (!source) return;
    const toastId = 'fill-from-source';
    toast.loading('Preenchendo campos com IA...', { id: toastId });
    try {
      // Pull enum options out of the COPY_SECTIONS schema so Claude
      // returns exact values the form accepts.
      const allQuestions = COPY_SECTIONS.flatMap((s) => s.questions);
      const optionsFor = (id: string): string[] => {
        const q = allQuestions.find((q) => q.id === id);
        return (q as any)?.options || [];
      };
      const filled = await personaFromProduct({
        productInfo: source,
        options: {
          categories: PERSONA_CATEGORY_OPTIONS,
          urgencies: PERSONA_URGENCY_OPTIONS.map((o) => o.value),
          differentials: PERSONA_DIFFERENTIAL_OPTIONS,
          triedBefores: PERSONA_TRIED_BEFORE_OPTIONS,
          payingCapacities: PERSONA_PAYING_CAPACITY_OPTIONS,
          hiddenDesires: PERSONA_HIDDEN_DESIRE_OPTIONS.map((o) => o.label),
          languages: optionsFor('language'),
          ageBuckets: optionsFor('age'),
          businessModels: optionsFor('businessModel'),
          emotions: optionsFor('emotion'),
          angles: optionsFor('angleIdea'),
        },
      });
      setConfig((prev: any) => ({
        ...prev,
        copy: {
          ...prev.copy,
          answers: { ...prev.copy.answers, ...filled },
          personaAutoFilled: true,
        },
      }));
      toast.success('Campos preenchidos!', { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao preencher.', { id: toastId });
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight flex items-center gap-2">
            <Users size={28} className="text-blue-600 dark:text-blue-400" />
            Identificar Persona
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            Responda 9 perguntas — a IA gera 3 personas com nível de consciência. Escolha uma para
            continuar.
          </p>
        </div>
        {productInfo && (
          <button
            onClick={() => handleFillFromSource()}
            className="shrink-0 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow flex items-center gap-2"
            title="Usa a IA pra preencher os 9 campos automaticamente com base na Fonte do Produto"
          >
            <Sparkles size={14} />
            Preencha automaticamente
          </button>
        )}
      </div>

      {/* Material do produto (VSL/link/texto) — preenche as perguntas abaixo */}
      <div className="bg-purple-50/50 dark:bg-purple-950/20 ring-1 ring-purple-100 dark:ring-purple-900/40 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-600 dark:text-purple-400" />
          <h4 className="font-black uppercase text-xs tracking-widest text-gray-900 dark:text-gray-50">
            Tem material do produto? (opcional)
          </h4>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Cole uma das 2 opções e a IA preenche as perguntas abaixo automaticamente. Sem material? É
          só responder na mão.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="url"
            value={matUrl}
            onChange={(e) => setMatUrl(e.target.value)}
            placeholder="Link da landing page"
            disabled={extracting}
            className="w-full p-2.5 bg-white dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <input
            type="text"
            value={matText}
            onChange={(e) => setMatText(e.target.value)}
            placeholder="Ou cole o texto/transcrição"
            disabled={extracting}
            className="w-full p-2.5 bg-white dark:bg-gray-800/60 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none dark:text-gray-100 dark:placeholder:text-gray-500"
          />
        </div>
        <button
          onClick={handleExtractMaterial}
          disabled={extracting}
          className="w-full md:w-auto px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow flex items-center justify-center gap-2"
        >
          {extracting ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          Extrair e preencher
        </button>
      </div>

      {/* ETAPA 1 — Produto */}
      <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 1
          </span>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Sobre o produto</h4>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            1. O que você está vendendo?
          </label>
          <input
            type="text"
            value={a.product || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'product', e.target.value)}
            placeholder="Ex: Suplemento natural pra neuropatia"
            className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            2. Categoria do produto
          </label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_CATEGORY_OPTIONS.map((cat) => (
              <button
                key={cat}
                onClick={() => updateConfig('copy', 'answers', 'category', cat)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  a.category === cat
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-300'
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            3. Em uma frase, o que ele faz?
          </label>
          <input
            type="text"
            value={a.whatItDoes || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'whatItDoes', e.target.value)}
            placeholder="Ex: Reduz queimação e formigamento causados por nervos danificados"
            className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            4. Transformação prometida
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                De:
              </span>
              <input
                type="text"
                value={a.transformationFrom || ''}
                onChange={(e) =>
                  updateConfig('copy', 'answers', 'transformationFrom', e.target.value)
                }
                placeholder="Ex: acordando com pés ardendo"
                className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
              />
            </div>
            <div>
              <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                Para:
              </span>
              <input
                type="text"
                value={a.transformationTo || ''}
                onChange={(e) =>
                  updateConfig('copy', 'answers', 'transformationTo', e.target.value)
                }
                placeholder="Ex: dormindo a noite inteira"
                className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm"
              />
            </div>
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 dark:text-blue-400 font-bold text-xs uppercase tracking-widest">
            + Adicionar contexto sobre o produto (opcional)
          </summary>
          <textarea
            value={a.productComment || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'productComment', e.target.value)}
            placeholder="Algo específico que a IA precisa saber sobre o produto?"
            rows={2}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
          />
        </details>
      </div>

      {/* ETAPA 2 — Problema */}
      <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 2
          </span>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Sobre o problema</h4>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            5. Quão urgente é o problema pra quem compra?
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {PERSONA_URGENCY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => updateConfig('copy', 'answers', 'urgency', opt.value)}
                className={cn(
                  'p-3 rounded-2xl border-2 transition-all text-left',
                  a.urgency === opt.value
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-600'
                    : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-blue-200'
                )}
              >
                <div className="text-sm font-black text-gray-900 dark:text-gray-50">
                  {opt.label}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold">
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            6. Diferenciais do seu produto
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold ml-2">
              (escolha 2-5)
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_DIFFERENTIAL_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => toggleArrayValue('differentials', d, 5)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  differentials.includes(d)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-300'
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 dark:text-blue-400 font-bold text-xs uppercase tracking-widest">
            + Adicionar contexto sobre o problema (opcional)
          </summary>
          <textarea
            value={a.problemComment || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'problemComment', e.target.value)}
            rows={2}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
          />
        </details>
      </div>

      {/* ETAPA 3 — Cliente */}
      <div className="bg-white dark:bg-gray-900/80 p-6 md:p-8 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
            Etapa 3
          </span>
          <h4 className="text-lg font-black text-gray-900 dark:text-gray-50">Sobre o cliente</h4>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            7. O que esse cliente já tentou e não funcionou?
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold ml-2">
              (1-5 opções)
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            {PERSONA_TRIED_BEFORE_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => toggleArrayValue('personaTriedBefore', t, 5)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  personaTriedBefore.includes(t)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-300'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            8. Qual o preço de venda do produto?
          </label>

          {/* pontual vs recorrente */}
          <div className="flex flex-wrap gap-2">
            {PERSONA_BILLING_OPTIONS.map((b) => (
              <button
                key={b}
                onClick={() => updateConfig('copy', 'answers', 'billingModel', b)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all',
                  a.billingModel === b
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-300'
                )}
              >
                {b}
              </button>
            ))}
          </div>

          {/* moeda do país de venda (dropdown) + valor — a IA puxa da VSL */}
          <div className="flex items-center gap-3 flex-wrap mt-2">
            <select
              value={a.saleCurrency || 'USD'}
              onChange={(e) => updateConfig('copy', 'answers', 'saleCurrency', e.target.value)}
              className="px-3 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm font-bold bg-white dark:bg-gray-900/80 dark:text-gray-100 max-w-[260px]"
            >
              {SALE_CURRENCY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} · {c.country} ({c.code})
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={a.salePrice ?? ''}
              onChange={(e) => updateConfig('copy', 'answers', 'salePrice', e.target.value)}
              placeholder={a.billingModel === 'Recorrente (mensal/assinatura)' ? '9.99' : '297'}
              className="w-32 px-3 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm font-bold"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400 font-bold">
              {a.billingModel === 'Recorrente (mensal/assinatura)'
                ? 'por mês'
                : 'valor da compra (pagamento único)'}
            </span>
          </div>

          {/* anualização quando recorrente — na moeda escolhida */}
          {a.billingModel === 'Recorrente (mensal/assinatura)' && Number(a.salePrice) > 0 && (
            <p className="text-xs text-blue-700 dark:text-blue-300 font-bold">
              Valor anualizado: {currencySymbol(a.saleCurrency)}{' '}
              {(Number(a.salePrice) * 12).toLocaleString('pt-BR')}/ano
              <span className="font-medium text-gray-500 dark:text-gray-400">
                {' '}
                — usamos o valor anual porque é assim que o público realmente compra.
              </span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-black text-gray-900 dark:text-gray-50">
            9. Qual é o maior desejo profundo que esse produto realiza?
            <span className="text-[10px] text-gray-400 dark:text-gray-500 font-bold ml-2">
              (escolha 1-3)
            </span>
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed">
            Não é o que o produto faz na superfície (ex: "perder peso") — é o que a pessoa REALMENTE
            quer ao resolver o problema (ex: "ser admirada nas fotos", "se sentir desejada de
            novo"). Pense no que ela diria se ninguém estivesse ouvindo.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            {PERSONA_HIDDEN_DESIRE_OPTIONS.map((d) => (
              <button
                key={d.label}
                onClick={() => toggleArrayValue('hiddenDesires', d.label, 3)}
                className={cn(
                  'p-3 rounded-2xl border-2 transition-all text-left flex items-start gap-2',
                  hiddenDesires.includes(d.label)
                    ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-600'
                    : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-blue-200'
                )}
              >
                <span className="text-xl shrink-0">{d.emoji}</span>
                <span className="text-xs font-bold text-gray-900 dark:text-gray-50 leading-tight">
                  {d.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-blue-600 dark:text-blue-400 font-bold text-xs uppercase tracking-widest">
            + Adicionar contexto sobre o cliente (opcional)
          </summary>
          <textarea
            value={a.clientComment || ''}
            onChange={(e) => updateConfig('copy', 'answers', 'clientComment', e.target.value)}
            rows={2}
            className="mt-2 w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
          />
        </details>

        {/* Método de estratégia — escolhido ANTES de gerar as personas.
            Calibra as personas, o plano de marketing e o checklist de criativos. */}
        <div className="space-y-2 pt-2">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Como você quer montar o plano?
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {[
              { id: 'baiano', title: 'Método Baiano', desc: '3-7 criativos ótimos, 1 por vez, ~50 conjuntos a baixo custo/dia.' },
              { id: 'metodo15', title: 'Método 15', desc: '~15 criativos diversos rodando juntos (Advantage+ amplo).' },
              { id: 'ia', title: 'IA escolhe', desc: 'Não sei — deixa a IA decidir o melhor pelo produto.' },
            ].map((m) => {
              const selected = (a.strategyMethod || 'ia') === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => updateConfig('copy', 'answers', 'strategyMethod', m.id)}
                  className={cn(
                    'p-3 rounded-2xl border-2 transition-all text-left',
                    selected
                      ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-600'
                      : 'bg-white dark:bg-gray-900/80 border-gray-200 dark:border-gray-800 hover:border-blue-200',
                  )}
                >
                  <span className="block text-xs font-black text-gray-900 dark:text-gray-50">{m.title}</span>
                  <span className="block text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-1">{m.desc}</span>
                </button>
              );
            })}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 font-bold text-[11px] uppercase tracking-widest">
              + Prefiro descrever meu próprio plano (avançado)
            </summary>
            <textarea
              value={a.strategyCustom || ''}
              onChange={(e) => {
                const v = e.target.value;
                updateConfig('copy', 'answers', 'strategyCustom', v);
                updateConfig('copy', 'answers', 'strategyMethod', v.trim() ? 'custom' : 'ia');
              }}
              rows={3}
              placeholder="Ex: 5 criativos, todos VSL longa, foco em prova social, R$30/dia por conjunto..."
              className="mt-2 w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-800 rounded-2xl focus:border-blue-600 focus:outline-none text-sm resize-none"
            />
          </details>
        </div>
      </div>

      {/* Botão Gerar — sempre clicável; se faltar campo, avisa o que falta. */}
      <button
        onClick={handleGenerateClick}
        disabled={loading}
        className={`w-full py-6 text-white rounded-[32px] font-black uppercase tracking-widest transition-all shadow-2xl shadow-blue-100 disabled:opacity-50 flex items-center justify-center gap-3 text-lg ${
          allRequired ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-600/50 hover:bg-blue-600/70'
        }`}
      >
        {loading ? <Loader2 className="animate-spin" size={24} /> : <Sparkles size={24} />}
        {personas.length > 0 ? 'Regerar 3 Personas' : 'Gerar 3 Personas com IA'}
      </button>
      {!allRequired && (
        <p className="text-center text-[11px] text-gray-500 dark:text-gray-400 mt-2">
          Falta preencher: {missingFields.join(', ')}.
        </p>
      )}
      {!allRequired && (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest">
          Preencha todas as 9 perguntas obrigatórias para gerar
        </p>
      )}

      {/* RESULTADO — 3 personas */}
      {personas.length > 0 && (
        <div className="space-y-4 pt-8">
          <h4 className="text-xl font-black text-gray-900 dark:text-gray-50 text-center">
            ✨ 3 Personas Identificadas — Escolha uma para continuar
          </h4>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {personas.map((p, idx) => {
              const rankColor =
                p.rank === 'principal' ? 'blue' : p.rank === 'secundaria' ? 'purple' : 'gray';
              return (
                <div
                  key={idx}
                  className={cn(
                    'bg-white dark:bg-gray-900/80 p-6 rounded-[28px] border-4 shadow-sm space-y-3 flex flex-col',
                    rankColor === 'blue' && 'border-blue-600',
                    rankColor === 'purple' && 'border-purple-400',
                    rankColor === 'gray' && 'border-gray-200 dark:border-gray-700'
                  )}
                >
                  {/* Top row: checkbox (Path 2 selection), rank badge, awareness pill */}
                  <div className="flex items-center justify-between gap-2">
                    {/* Checkbox: only meaningful when Path 2 (onGoToPlan) is wired */}
                    {onGoToPlan && (
                      <label
                        className="flex items-center gap-1.5 cursor-pointer select-none"
                        title="Incluir esta persona no plano de marketing"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIdxSet.has(idx)}
                          onChange={(e) => {
                            setSelectedIdxSet((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(idx);
                              else next.delete(idx);
                              // Don't allow zero selection — always keep ≥1
                              if (next.size === 0) next.add(idx);
                              return next;
                            });
                          }}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                          Incluir
                        </span>
                      </label>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest',
                          rankColor === 'blue' && 'bg-blue-600 text-white',
                          rankColor === 'purple' && 'bg-purple-400 text-white',
                          rankColor === 'gray' &&
                            'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        )}
                      >
                        {p.rank}
                      </span>
                      <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest">
                        Nível {p.awarenessLevel}
                      </span>
                    </div>
                  </div>

                  {/* Confidence + weight + stretch warning. Hidden when the
                      LLM output doesn't have these fields (old data). */}
                  {(typeof p?.confidence === 'number' ||
                    typeof p?.suggestedWeight === 'number' ||
                    p?.isStretch === true) && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {typeof p?.confidence === 'number' && (
                        <span
                          className={cn(
                            'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ring-1',
                            p.confidence >= 0.7
                              ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 ring-green-200/60 dark:ring-green-900/40'
                              : p.confidence >= 0.5
                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200/60 dark:ring-amber-900/40'
                                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-red-200/60 dark:ring-red-900/40'
                          )}
                          title="Confiança da extração: o quanto a fonte sustenta essa persona"
                        >
                          {fmtPct(p.confidence)} conf.
                        </span>
                      )}
                      {typeof p?.suggestedWeight === 'number' && (
                        <span
                          className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200/60 dark:ring-blue-900/40"
                          title="Fatia sugerida dos criativos para essa persona"
                        >
                          {fmtPct(p.suggestedWeight)} dos criativos
                        </span>
                      )}
                      {p?.isStretch === true && (
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-1 ring-orange-200/60 dark:ring-orange-900/40"
                          title="Persona inferida da fonte, não citada diretamente — use com cuidado"
                        >
                          <AlertTriangle size={9} />
                          inferência fraca
                        </span>
                      )}
                    </div>
                  )}
                  <div>
                    <h5 className="text-lg font-black text-gray-900 dark:text-gray-50">{p.name}</h5>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug mt-1">
                      {p.description}
                    </p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/40 p-3 rounded-2xl border border-blue-100 dark:border-blue-900">
                    <p className="text-[10px] font-black text-blue-900 dark:text-blue-200 uppercase tracking-widest mb-1">
                      🎯 Nível {p.awarenessLevel} de Consciência
                    </p>
                    <p className="text-xs text-blue-800 dark:text-blue-300 leading-snug">
                      {p.awarenessReason}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="text-gray-500 dark:text-gray-400">
                      <strong className="text-gray-900 dark:text-gray-50">Idade:</strong> {p.age}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400">
                      <strong className="text-gray-900 dark:text-gray-50">Gênero:</strong>{' '}
                      {p.gender}
                    </div>
                  </div>
                  <div className="space-y-2 text-xs flex-1">
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Dor principal
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.mainPain}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Desejo oculto
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.hiddenDesire}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Medo dominante
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.dominantFear}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Objeção principal
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.mainObjection}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Gatilho emocional
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.emotionalTrigger}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Ângulo de vídeo
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">
                        {p.recommendedVideoAngle}
                      </span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Hook recomendado
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">
                        {p.recommendedHookType}
                      </span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Tom
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">
                        {p.communicationTone}
                      </span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Promessa
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.strongestPromise}</span>
                    </div>
                    <div>
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        CTA
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300">{p.recommendedCTA}</span>
                    </div>
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                      <strong className="text-gray-900 dark:text-gray-50 block text-[10px] uppercase tracking-widest">
                        Por que é {p.rank}?
                      </strong>{' '}
                      <span className="text-gray-700 dark:text-gray-300 italic">
                        {p.whyMainOrSecondaryOrTertiary}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-4">
            <button
              onClick={onSavePersonas}
              disabled={personasSaved}
              className="w-full py-5 bg-green-600 text-white rounded-[28px] font-black uppercase tracking-widest text-sm hover:bg-green-700 transition-all shadow-2xl shadow-green-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {personasSaved ? (
                <>
                  <CheckCircle2 size={20} />3 Personas Salvos no Projeto
                </>
              ) : (
                <>💾 Salvar os 3 Personas no Projeto</>
              )}
            </button>
          </div>

          {/* Resumo pós-salvar: escolher QUAIS personas entram no plano.
              Marcar/desmarcar re-popula o plano de marketing (embaixo). */}
          {personasSaved && (
            <div className="pt-2 space-y-3">
              <h4 className="text-sm font-black text-gray-900 dark:text-gray-50">
                Quais personas incluir no plano de marketing?
              </h4>
              <div className="space-y-2">
                {personas.map((p, idx) => {
                  const checked = selectedIdxSet.has(idx);
                  return (
                    <label
                      key={idx}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-2xl border-2 cursor-pointer transition-all',
                        checked
                          ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30'
                          : 'border-gray-200 dark:border-gray-800 hover:border-blue-200'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedIdxSet);
                          if (e.target.checked) next.add(idx);
                          else next.delete(idx);
                          if (next.size === 0) next.add(idx);
                          setSelectedIdxSet(next);
                          if (onGoToPlan) {
                            const list = (generatedPersona?.personas || []) as any[];
                            onGoToPlan(list.filter((_, i) => next.has(i)));
                          }
                        }}
                        className="w-5 h-5 accent-blue-600 mt-0.5 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-gray-900 dark:text-gray-50">
                            {p.name}
                          </span>
                          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500">
                            {p.rank}
                          </span>
                          {typeof p?.suggestedWeight === 'number' && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                              {fmtPct(p.suggestedWeight)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                          {p.mainPain || p.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-center text-[10px] text-gray-500 dark:text-gray-500 font-bold uppercase tracking-widest">
                O plano de marketing abaixo usa as personas marcadas
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
