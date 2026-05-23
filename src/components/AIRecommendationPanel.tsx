import { useEffect, useState } from 'react';
import { Sparkles, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { recommendAvatarAndVoice, type AvatarVoiceRecommendation } from '@/lib/claudeService';

// Cache shape includes a fingerprint of the inputs that produced the
// recommendation. When the current inputs no longer match the cached
// fingerprint (copy or persona was edited), the panel auto-refetches.
export interface CachedRecommendation {
  rec: AvatarVoiceRecommendation;
  inputsKey: string;
}

interface Props {
  // Project context — used to build the prompt sent to Claude.
  persona?: any;
  copyAnswers?: any;
  copy?: string;
  productInfo?: any;

  // Which side of the recommendation to display (avatar vs voice). The
  // panel always fetches both — the unused side stays hidden.
  variant: 'avatar' | 'voice';

  // Optional cached recommendation. Auto-refetches when its inputsKey
  // doesn't match the panel's current inputs.
  cached?: CachedRecommendation | null;
  onChange?: (cached: CachedRecommendation) => void;

  // Apply the suggested criteria to the parent's filter state.
  onApplyFilters?: (rec: AvatarVoiceRecommendation) => void;
}

// Stable serialization of the inputs Claude sees. Same string ⇒ same
// recommendation should still be valid. Different ⇒ cache is stale.
function buildInputsKey(
  persona: any,
  copyAnswers: any,
  copy: string | undefined,
  productInfo: any
) {
  return JSON.stringify({
    p: persona ?? null,
    a: copyAnswers ?? null,
    c: copy ?? '',
    pi: productInfo ?? null,
  });
}

const AVATAR_LABEL_PT: Record<string, string> = {
  young: 'Jovem',
  adult: 'Adulto',
  mature: 'Maduro',
  elderly: 'Sênior',
  white: 'Branco',
  asian: 'Asiático',
  south_asian: 'Sul-asiático',
  latino: 'Latino',
  middle_eastern: 'Oriente Médio',
  black: 'Negro',
  mixed: 'Misto',
  professional: 'Profissional',
  lifestyle: 'Lifestyle',
  ugc: 'UGC',
  creative: 'Criativo',
  energetic: 'Energético',
  calm: 'Calmo',
  authoritative: 'Autoritário',
  friendly: 'Amigável',
  serious: 'Sério',
  male: 'Masculino',
  female: 'Feminino',
  middle_aged: 'Adulto',
  old: 'Sênior',
  brazilian: 'Brasileiro',
  american: 'Americano',
  european: 'Europeu',
  british: 'Britânico',
  'latin american': 'Latino',
  advertisement: 'Publicidade',
  social_media: 'Social Media',
  narrative_story: 'Narração',
  conversational: 'Conversacional',
  informative_educational: 'Educativo',
  confident: 'Confiante',
  casual: 'Casual',
  deep: 'Grave',
  upbeat: 'Animado',
  pleasant: 'Agradável',
  excited: 'Empolgado',
};

const t = (v?: string) => (v ? (AVATAR_LABEL_PT[v] ?? v) : '—');

export function AIRecommendationPanel({
  persona,
  copyAnswers,
  copy,
  productInfo,
  variant,
  cached,
  onChange,
  onApplyFilters,
}: Props) {
  const currentInputsKey = buildInputsKey(persona, copyAnswers, copy, productInfo);
  const cacheIsValid = cached && cached.inputsKey === currentInputsKey;

  const [rec, setRec] = useState<AvatarVoiceRecommendation | null>(
    cacheIsValid ? cached!.rec : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRec = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await recommendAvatarAndVoice({ persona, copyAnswers, copy, productInfo });
      setRec(r);
      onChange?.({ rec: r, inputsKey: currentInputsKey });
    } catch (err: any) {
      setError(err?.message || 'Erro ao buscar recomendação.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on first mount when nothing is cached OR cache is stale.
  // Re-runs only when the inputs hash changes — not on every render.
  useEffect(() => {
    if (!rec && !loading && !error) {
      void fetchRec();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentInputsKey]);

  const section = variant === 'avatar' ? rec?.avatar : rec?.voice;

  return (
    <div className="bg-gradient-to-br from-purple-50 via-blue-50 to-purple-50 border-2 border-purple-200 rounded-3xl p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-600 text-white rounded-2xl flex items-center justify-center shadow-md">
            <Sparkles size={20} />
          </div>
          <div>
            <h4 className="text-sm font-black uppercase tracking-widest text-purple-900">
              IA recomenda — {variant === 'avatar' ? 'Avatar ideal' : 'Voz ideal'}
            </h4>
            <p className="text-xs text-purple-600 mt-0.5">Baseado na persona + copy do projeto</p>
          </div>
        </div>
        <button
          onClick={fetchRec}
          disabled={loading}
          className="text-xs font-bold uppercase tracking-widest text-purple-700 hover:text-purple-900 flex items-center gap-1.5 disabled:opacity-50"
          title="Recalcular com Claude"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Recalcular
        </button>
      </div>

      {loading && !rec && (
        <div className="flex items-center gap-3 text-purple-700 py-4">
          <Loader2 className="animate-spin" size={18} />
          <span className="text-sm">Analisando persona + copy…</span>
        </div>
      )}

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="font-bold mb-1">
              {error.includes('529') || error.toLowerCase().includes('overloaded')
                ? 'Claude está sobrecarregado agora.'
                : 'Não consegui gerar a recomendação.'}
            </p>
            <p className="text-xs text-amber-800">
              Você pode continuar escolhendo manualmente e tentar novamente em alguns minutos.
            </p>
          </div>
          <button
            onClick={fetchRec}
            disabled={loading}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-widest px-3 py-2 rounded-lg disabled:opacity-50"
          >
            {loading ? '...' : 'Tentar de novo'}
          </button>
        </div>
      )}

      {section && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {Object.entries(section).map(([k, v]) => (
              <span
                key={k}
                className="bg-white border-2 border-purple-200 rounded-xl px-3 py-1.5 text-xs"
              >
                <span className="text-purple-500 uppercase font-bold mr-1.5">{k}:</span>
                <span className="font-black text-gray-900">{t(String(v))}</span>
              </span>
            ))}
          </div>

          {rec?.reasoning && (
            <div className="bg-white/60 rounded-xl p-3 text-xs text-gray-700 leading-relaxed border border-purple-100">
              <span className="font-bold text-purple-700">Por quê: </span>
              {rec.reasoning}
            </div>
          )}

          {onApplyFilters && (
            <button
              onClick={() => rec && onApplyFilters(rec)}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-black uppercase text-xs tracking-widest py-3 rounded-xl flex items-center justify-center gap-2 shadow-md"
            >
              <Wand2 size={14} />
              Aplicar filtros sugeridos
            </button>
          )}
        </div>
      )}
    </div>
  );
}
