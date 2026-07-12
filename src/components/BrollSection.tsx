import { useRef, useState } from 'react';
import { Film, Search, Loader2, Plus, X, Check, AlertTriangle, Clock } from 'lucide-react';

/** Um clipe candidato vindo do Pexels. */
interface PexelsClip {
  id: number;
  duration: number;
  thumb: string;
  url: string;
  width?: number;
  height?: number;
  author?: string;
}

/** Um clipe já escolhido + onde/por quanto tempo ele entra no vídeo. */
interface SelectedClip {
  key: string;
  clip: PexelsClip;
  atSec: number;
  durationSec: number;
}

interface Props {
  /** Vídeo base atual (avatar) — o b-roll é inserido nele, ANTES da legenda. */
  videoUrl: string | null;
  userId?: string;
  /** Formato do vídeo — define a orientação da busca no Pexels. */
  format?: '16:9' | '1:1' | '9:16';
  /** Chamado com a URL do novo vídeo (com b-roll). O App seta como fonte do ZapCap. */
  onApplied: (newUrl: string) => void;
  disabled?: boolean;
}

const orientationFor = (f?: string) =>
  f === '9:16' ? 'portrait' : f === '1:1' ? 'square' : 'landscape';

export function BrollSection({ videoUrl, userId, format, onApplied, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PexelsClip[]>([]);
  const [selected, setSelected] = useState<SelectedClip[]>([]);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [playhead, setPlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        query: q,
        orientation: orientationFor(format),
        perPage: '12',
      });
      const r = await fetch(`/api/pexels/search?${params.toString()}`);
      const data = await r.json();
      if (!r.ok) {
        if ((data.error || '').includes('não configurada')) setNeedKey(true);
        throw new Error(data.error || 'Falha na busca.');
      }
      setNeedKey(false);
      setResults(Array.isArray(data.clips) ? data.clips : []);
    } catch (e: any) {
      setError(e?.message || 'Erro ao buscar no Pexels.');
    } finally {
      setSearching(false);
    }
  };

  const saveKey = async () => {
    const k = keyInput.trim();
    if (!k) return;
    try {
      const r = await fetch('/api/pexels/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: k }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || 'Falha ao salvar a chave.');
      }
      setNeedKey(false);
      setKeyInput('');
      if (query.trim()) doSearch();
    } catch (e: any) {
      setError(e?.message || 'Erro ao salvar a chave.');
    }
  };

  const addClip = (clip: PexelsClip) => {
    // Entra no SEGUNDO em que o player está agora (você ouve a voz e adiciona ali).
    const at = Math.round(playhead * 10) / 10;
    setSelected((prev) => [
      ...prev,
      {
        key: `${clip.id}-${prev.length}`,
        clip,
        atSec: at || prev.length * 6 + 3,
        durationSec: Math.min(3, clip.duration || 3),
      },
    ]);
  };

  const updateSel = (key: string, field: 'atSec' | 'durationSec', value: number) => {
    setSelected((prev) =>
      prev.map((s) => (s.key === key ? { ...s, [field]: Math.max(0, value) } : s))
    );
  };
  const removeSel = (key: string) => setSelected((prev) => prev.filter((s) => s.key !== key));

  const apply = async () => {
    if (!videoUrl || !userId || selected.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const r = await fetch('/api/video/broll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          userId,
          inserts: selected.map((s) => ({
            clipUrl: s.clip.url,
            atSec: s.atSec,
            durationSec: s.durationSec,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao aplicar o b-roll.');
      onApplied(data.url);
      setSelected([]);
      setResults([]);
      setQuery('');
    } catch (e: any) {
      setError(e?.message || 'Erro ao aplicar o b-roll.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-3xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Film size={18} className="text-blue-600 dark:text-blue-400" />
        <h3 className="font-black uppercase text-xs tracking-widest text-gray-700 dark:text-gray-300">
          Etapa 2 — B-roll (Pexels)
        </h3>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Busque clipes, escolha quais quer e onde entram, e clique em aplicar. O b-roll entra{' '}
        <strong>antes da legenda</strong> — depois é só gerar o vídeo legendado normalmente.
      </p>

      {!videoUrl && (
        <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">
          Selecione o vídeo do avatar primeiro (Etapa 1).
        </p>
      )}

      {/* Player da fonte COM SOM — dá play, ouve a voz e o "Adicionar" usa o
          segundo em que você está. */}
      {videoUrl && (
        <div className="space-y-1">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            onTimeUpdate={(e) => setPlayhead((e.target as HTMLVideoElement).currentTime)}
            className="w-full max-h-64 rounded-xl bg-black"
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Clock size={12} /> Tempo atual: <strong>{playhead.toFixed(1)}s</strong> — clicar em
            "adicionar" num clipe o coloca nesse segundo (ajustável abaixo).
          </p>
        </div>
      )}

      {/* Chave Pexels (aparece se não estiver configurada) */}
      {needKey && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 space-y-2">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Chave do Pexels não configurada. Cole sua API key (grátis em pexels.com/api):
          </p>
          <div className="flex gap-2">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Pexels API key"
              className="flex-1 px-3 py-2 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
            />
            <button
              onClick={saveKey}
              className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-widest"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {/* Busca */}
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="Ex: senior man hands, elderly walking, feet pain…"
          disabled={disabled}
          className="flex-1 px-3 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={doSearch}
          disabled={searching || !query.trim()}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 flex items-center gap-2"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Buscar
        </button>
      </div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 -mt-2">
        Dica: inclua idade/etnia na busca (ex.: "senior", "elderly") pra casar com o público.
      </p>

      {/* Resultados */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {results.map((clip) => (
            <div
              key={clip.id}
              className="relative rounded-xl overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 group"
            >
              <img src={clip.thumb} alt="" className="w-full h-48 object-cover" />
              <span className="absolute bottom-1 left-1 text-[9px] font-black px-1.5 py-0.5 rounded bg-black/60 text-white">
                {clip.duration}s
              </span>
              <button
                onClick={() => addClip(clip)}
                className="absolute inset-0 flex items-center justify-center bg-blue-600/0 group-hover:bg-blue-600/70 text-white opacity-0 group-hover:opacity-100 transition-all text-xs font-black uppercase tracking-widest"
              >
                <Plus size={16} className="mr-1" /> Adicionar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Selecionados (confirmação) */}
      {selected.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            Selecionados ({selected.length})
          </p>
          <ul className="space-y-1.5">
            {selected.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-2 p-2 rounded-xl bg-gray-50 dark:bg-gray-800/40 ring-1 ring-gray-200/60 dark:ring-gray-700/60"
              >
                <img src={s.clip.thumb} alt="" className="w-14 h-10 object-cover rounded-md shrink-0" />
                <label className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  em
                  <input
                    type="number"
                    min={0}
                    value={s.atSec}
                    onChange={(e) => updateSel(s.key, 'atSec', Number(e.target.value))}
                    className="w-14 px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-xs dark:text-gray-100"
                  />
                  s
                  <button
                    onClick={() => updateSel(s.key, 'atSec', Math.round(playhead * 10) / 10)}
                    title="Usar o tempo atual do player"
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700"
                  >
                    <Clock size={13} />
                  </button>
                </label>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  por
                  <input
                    type="number"
                    min={1}
                    value={s.durationSec}
                    onChange={(e) => updateSel(s.key, 'durationSec', Number(e.target.value))}
                    className="w-12 px-1.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-xs dark:text-gray-100"
                  />
                  s
                </label>
                <button
                  onClick={() => removeSel(s.key)}
                  className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                  title="Remover"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-200 text-xs">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Aplicar */}
      <button
        onClick={apply}
        disabled={applying || !videoUrl || !userId || selected.length === 0}
        className="w-full py-3.5 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {applying ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Aplicando b-roll…
          </>
        ) : (
          <>
            <Check size={16} /> Aplicar b-roll ao vídeo
          </>
        )}
      </button>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
        Depois de aplicar, o vídeo com b-roll vira a fonte da legenda. É só gerar o vídeo abaixo.
      </p>
    </div>
  );
}
