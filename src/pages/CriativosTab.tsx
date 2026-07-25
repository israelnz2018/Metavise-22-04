import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { loadVariants } from '@/lib/variantStore';
import { Loader2, Star, Download, CheckSquare, Square, Rocket, Film } from 'lucide-react';

// BIBLIOTECA DE CRIATIVOS: junta os vídeos PRONTOS de todos os subprojetos do
// projeto atual num só lugar. Favoritar e marcar "publicado" (localStorage, como
// os outros favoritos do app), baixar em lote. É read-only sobre os subprojetos.

interface Props {
  projectId?: string | null;
  projectName?: string;
}

interface Creative {
  url: string;
  variantId: string;
  variantName: string;
  source: string;
  cover?: string;
}

const FAV_KEY = 'metavise-criativos-fav';
const PUB_KEY = 'metavise-criativos-pub';

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

export function CriativosTab({ projectId, projectName }: Props) {
  const [loading, setLoading] = useState(false);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [fav, setFav] = useState<Set<string>>(() => loadSet(FAV_KEY));
  const [pub, setPub] = useState<Set<string>>(() => loadSet(PUB_KEY));
  const [filter, setFilter] = useState<'todos' | 'favoritos' | 'publicados'>('todos');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Checklist de publicação: abre ao marcar "no ar" um criativo ainda não publicado.
  const [pubModalUrl, setPubModalUrl] = useState<string | null>(null);
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    (async () => {
      try {
        const variants = await loadVariants(projectId);
        const out: Creative[] = [];
        const seen = new Set<string>();
        const push = (url: string, variantId: string, variantName: string, source: string, cover?: string) => {
          if (!url || seen.has(url)) return;
          seen.add(url);
          out.push({ url, variantId, variantName, source, cover });
        };
        for (const v of variants) {
          const cfg = (v.config || {}) as any;
          const name = v.name || 'Sem nome';
          const cover = cfg?.montagem?.coverUrl || cfg?.montagem?.coverOptions?.[0];
          const edit = cfg?.edit || {};
          (edit.zapVersions || []).forEach((u: string) => push(u, v.id, name, 'Edição', cover));
          (edit.zapVslVersions || []).forEach((u: string) => push(u, v.id, name, 'Edição VSL', cover));
          (edit.zapHookVersions || []).forEach((u: string) => push(u, v.id, name, 'Gancho', cover));
          if (cfg?.montagem?.resultUrl) push(cfg.montagem.resultUrl, v.id, name, 'Montagem', cover);
          if (cfg?.videoUrl) push(cfg.videoUrl, v.id, name, 'Avatar', cover);
        }
        setCreatives(out);
      } catch (e: any) {
        toast.error(e?.message || 'Falha ao carregar os criativos.');
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const toggleFav = (url: string) => {
    setFav((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
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
      setPubModalUrl(url);
    }
  };
  const confirmPublish = (force = false) => {
    if (!pubModalUrl) return;
    if (!force && !checks.every(Boolean)) return;
    setPub((prev) => {
      const next = new Set(prev);
      next.add(pubModalUrl);
      saveSet(PUB_KEY, next);
      return next;
    });
    setPubModalUrl(null);
    toast.success('Marcado como no ar.');
  };
  const toggleSel = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  };

  const shown = useMemo(() => {
    if (filter === 'favoritos') return creatives.filter((c) => fav.has(c.url));
    if (filter === 'publicados') return creatives.filter((c) => pub.has(c.url));
    return creatives;
  }, [creatives, filter, fav, pub]);

  const baixarSelecionados = () => {
    const urls = shown.filter((c) => selected.has(c.url));
    if (urls.length === 0) return toast.error('Selecione pelo menos um criativo.');
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
    toast.success(`Baixando ${urls.length} criativo(s)…`);
  };

  if (!projectId) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center text-gray-500">
        Abra um projeto pra ver a biblioteca de criativos.
      </div>
    );
  }

  const chip = (id: typeof filter, label: string, n: number) => (
    <button
      onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-black ${
        filter === id ? 'bg-blue-700 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
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
          Criativos {projectName ? `· ${projectName}` : ''}
        </h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
        Todos os vídeos prontos dos seus subprojetos num só lugar. Favorite, marque{' '}
        <b>publicado</b> e baixe em lote.
      </p>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          {chip('todos', 'Todos', creatives.length)}
          {chip('favoritos', 'Favoritos', creatives.filter((c) => fav.has(c.url)).length)}
          {chip('publicados', 'Publicados', creatives.filter((c) => pub.has(c.url)).length)}
        </div>
        {selected.size > 0 && (
          <button
            onClick={baixarSelecionados}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-black"
          >
            <Download size={14} /> Baixar selecionados ({selected.size})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 p-8 justify-center">
          <Loader2 size={18} className="animate-spin" /> Carregando criativos…
        </div>
      ) : shown.length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">
          Nenhum criativo {filter !== 'todos' ? `em "${filter}"` : 'pronto ainda'}. Gere uma montagem
          ou edição e ele aparece aqui.
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
                    preload="metadata"
                    className="w-full aspect-[9/16] object-cover bg-black"
                  />
                  <button
                    onClick={() => toggleSel(c.url)}
                    className="absolute top-1 left-1 p-1 rounded-md bg-black/60 text-white hover:bg-black/80"
                    title="Selecionar pra baixar em lote"
                  >
                    {isSel ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  {isPub && (
                    <span className="absolute top-1 right-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-600 text-white text-[9px] font-black uppercase">
                      <Rocket size={9} /> no ar
                    </span>
                  )}
                </div>
                <div className="p-2 space-y-1.5">
                  <p className="text-[11px] font-bold text-gray-800 dark:text-gray-100 truncate" title={c.variantName}>
                    {c.variantName}
                  </p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{c.source}</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleFav(c.url)}
                      className={`p-1.5 rounded-lg ${isFav ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                      title="Favoritar"
                    >
                      <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={() => togglePub(c.url)}
                      className={`p-1.5 rounded-lg ${isPub ? 'text-green-600' : 'text-gray-300 hover:text-green-500'}`}
                      title={isPub ? 'Marcado como publicado' : 'Marcar como publicado'}
                    >
                      <Rocket size={14} />
                    </button>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 ml-auto"
                      title="Baixar"
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
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={() => setPubModalUrl(null)}>
          <div
            className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Rocket size={18} className="text-green-600" />
              <h3 className="text-base font-black text-gray-900 dark:text-gray-100">
                Antes de colocar no ar
              </h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Confira o básico pra não rodar mídia num criativo furado:
            </p>
            {[
              'Formato certo pra plataforma (9:16 Reels/Stories, 1:1 feed, 16:9 YouTube)',
              'Duração adequada pro objetivo',
              'Tem legenda (a maioria assiste no mudo)',
              'Gancho forte nos primeiros 3 segundos',
            ].map((item, i) => (
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
                publicar assim mesmo
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPubModalUrl(null)}
                  className="px-3 py-2 rounded-xl text-xs font-black text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => confirmPublish(false)}
                  disabled={!checks.every(Boolean)}
                  className="px-4 py-2 rounded-xl bg-green-600 text-white text-xs font-black hover:bg-green-700 disabled:opacity-40"
                >
                  Marcar no ar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
