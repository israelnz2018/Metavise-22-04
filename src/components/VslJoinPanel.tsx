import { useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Loader2, Film } from 'lucide-react';

interface Props {
  /** URLs dos grupos crus (vindos da Montagem). */
  groups: string[];
  /** Versões editadas disponíveis (config.edit.zapVslVersions). */
  versions: string[];
  userId?: string;
  /** Por grupo: a URL escolhida pra o vídeo final (cru ou versão editada). */
  chosen: string[];
  onChoose: (groupIndex: number, url: string) => void;
  onJoined: (url: string) => void;
}

// Painel VSL da Edição: pra cada grupo você escolhe qual vídeo entra no final
// (o grupo cru ou uma versão que você editou), e junta tudo num VSL só.
export function VslJoinPanel({ groups, versions, userId, chosen, onChoose, onJoined }: Props) {
  const [joining, setJoining] = useState(false);
  const [finalUrl, setFinalUrl] = useState('');

  // Vídeo final por grupo = escolha do usuário, senão o grupo cru.
  const finals = useMemo(
    () => groups.map((g, i) => chosen[i] || g),
    [groups, chosen]
  );

  const join = async () => {
    if (!userId) return;
    if (finals.some((u) => !u)) {
      toast.error('Escolha um vídeo para cada grupo.');
      return;
    }
    setJoining(true);
    const toastId = 'vsl-join';
    toast.loading('Juntando os grupos da VSL...', { id: toastId });
    try {
      const r = await fetch('/api/video/concat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: finals, userId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao juntar.');
      setFinalUrl(d.url);
      onJoined(d.url);
      toast.success('VSL final montada!', { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao juntar.', { id: toastId });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900/80 rounded-2xl border-2 border-purple-200/60 dark:border-purple-800/50 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Film size={16} className="text-purple-600 dark:text-purple-400" />
        <span className="text-sm font-black text-gray-800 dark:text-gray-200">
          VSL em grupos ({groups.length})
        </span>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Selecione um grupo abaixo (na Etapa 1) pra editá-lo com legenda/música/silêncio. Pra cada
        grupo, escolha aqui qual vídeo entra no final — o grupo cru ou uma versão editada — e junte.
      </p>

      <div className="space-y-2">
        {groups.map((g, i) => {
          const opts = [
            { url: g, label: `Grupo ${i + 1} (cru)` },
            ...versions.map((url, vi) => ({ url, label: `Versão ${vi + 1}` })),
          ];
          const value = chosen[i] || g;
          return (
            <div
              key={i}
              className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-200 dark:border-gray-800"
            >
              <span className="text-xs font-black text-gray-700 dark:text-gray-300 w-16 shrink-0">
                Grupo {i + 1}
              </span>
              <select
                value={value}
                onChange={(e) => onChoose(i, e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-xs"
              >
                {opts.map((o, oi) => (
                  <option key={oi} value={o.url}>
                    {o.label}
                  </option>
                ))}
              </select>
              {value && (
                <button
                  onClick={() => window.open(value, '_blank')}
                  className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 shrink-0"
                >
                  ▶ Ver
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={join}
          disabled={joining}
          className={`flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl transition ${
            joining
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          {joining ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Juntando…
            </>
          ) : (
            'Juntar grupos → VSL final'
          )}
        </button>
      </div>

      {finalUrl && (
        <video src={finalUrl} controls className="w-full max-h-[420px] rounded-xl bg-black" />
      )}
    </div>
  );
}
