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
    setPub((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      saveSet(PUB_KEY, next);
      return next;
    });
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
    </div>
  );
}
