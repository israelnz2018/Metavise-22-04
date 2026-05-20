import { useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  FileText,
  Link as LinkIcon,
  Youtube,
  Sparkles,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Hand,
  Wand2,
} from 'lucide-react';
import { extractProductInfo, type ProductInfo } from '../lib/claudeService';

type Mode = 'choose' | 'auto';

interface Props {
  // Existing extracted info (persists across reopens via config.copy.productInfo).
  existingInfo?: ProductInfo | null;
  onExtracted: (info: ProductInfo, rawText: string) => void;
  onContinue: () => void;
}

export function SourceTab({ existingInfo, onExtracted, onContinue }: Props) {
  // Always start with the manual-vs-auto question — even if the user has
  // a previous extraction saved. They can still see the saved info by
  // clicking "Automática" again.
  const [mode, setMode] = useState<Mode>('choose');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ProductInfo | null>(existingInfo || null);

  if (mode === 'choose') {
    return (
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="space-y-2 text-center">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            Como quer descobrir a persona e criar a copy?
          </h2>
          <p className="text-sm text-gray-600">
            Escolha o caminho que faz mais sentido pro teu projeto.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={onContinue}
            className="group bg-white border-2 border-gray-200 hover:border-purple-500 hover:shadow-lg rounded-3xl p-8 text-left transition space-y-4"
          >
            <div className="w-14 h-14 bg-gray-100 group-hover:bg-purple-100 text-gray-600 group-hover:text-purple-700 rounded-2xl flex items-center justify-center transition">
              <Hand size={26} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-gray-900">De forma manual</h3>
              <p className="text-sm text-gray-600">
                Você responde as perguntas sobre persona e produto direto na próxima aba.
                Mais controle, ideal se você já conhece bem o avatar do cliente.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500 group-hover:text-purple-700 transition">
              Ir para Identificar Persona
              <ArrowRight size={14} />
            </div>
          </button>

          <button
            onClick={() => setMode('auto')}
            className="group bg-white border-2 border-purple-300 hover:border-purple-600 hover:shadow-lg rounded-3xl p-8 text-left transition space-y-4 relative"
          >
            <span className="absolute top-4 right-4 text-[10px] font-black uppercase tracking-widest bg-purple-600 text-white px-2 py-1 rounded-full">
              Recomendado
            </span>
            <div className="w-14 h-14 bg-purple-100 group-hover:bg-purple-200 text-purple-700 rounded-2xl flex items-center justify-center transition">
              <Wand2 size={26} />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-black text-gray-900">De forma automática</h3>
              <p className="text-sm text-gray-600">
                Cole a transcrição da sua VSL ou link da landing page. A IA extrai persona,
                dores, oferta, ângulos — e popula as próximas etapas automaticamente.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-purple-600 transition">
              Usar IA pra extrair
              <ArrowRight size={14} />
            </div>
          </button>
        </div>
      </div>
    );
  }

  const handleExtract = async () => {
    if (!text.trim() && !url.trim() && !youtubeUrl.trim()) {
      toast.error('Preencha pelo menos uma das opções.');
      return;
    }
    setLoading(true);
    try {
      const product = await extractProductInfo({
        text: text.trim() || undefined,
        url: url.trim() || undefined,
        youtubeUrl: youtubeUrl.trim() || undefined,
      });
      setInfo(product);
      const summary =
        text.trim() ||
        `[YouTube: ${youtubeUrl}]` ||
        `[URL: ${url}]`;
      onExtracted(product, summary);
      toast.success('Informações extraídas!');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao extrair informações.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            Material do Produto
          </h2>
          <p className="text-sm text-gray-600">
            Cole a transcrição da sua VSL, copy da landing page, ou link da página de vendas.
            A IA extrai tudo: persona, dores, oferta, ângulos — e popula as próximas etapas
            automaticamente.
          </p>
        </div>
        <button
          onClick={() => setMode('choose')}
          className="shrink-0 text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-gray-700"
        >
          ← Trocar modo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* YouTube VSL */}
        <div className="bg-white border-2 border-red-100 rounded-3xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <Youtube size={20} className="text-red-600" />
            <h3 className="font-black text-gray-900 uppercase text-sm tracking-widest">
              Link da VSL no YouTube
            </h3>
          </div>
          <p className="text-xs text-gray-500">
            A IA pega a transcrição automática do YouTube — sem download, sem custo
            adicional. Funciona pra ~90% dos vídeos.
          </p>
          <input
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full p-4 border-2 border-gray-200 rounded-xl text-sm focus:border-red-500 focus:outline-none"
            disabled={loading}
          />
          <p className="text-[10px] text-gray-400">
            Funciona com youtu.be e youtube.com/shorts também.
          </p>
        </div>

        {/* URL landing page */}
        <div className="bg-white border-2 border-gray-100 rounded-3xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <LinkIcon size={18} className="text-purple-600" />
            <h3 className="font-black text-gray-900 uppercase text-sm tracking-widest">
              URL da landing page
            </h3>
          </div>
          <p className="text-xs text-gray-500">
            A IA acessa a página, extrai o texto e processa. Funciona com a maioria
            das LPs públicas.
          </p>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://meuproduto.com.br/vendas"
            className="w-full p-4 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:outline-none"
            disabled={loading}
          />
          <p className="text-[10px] text-gray-400">
            Funciona com a maioria das LPs públicas.
          </p>
        </div>

        {/* Paste text */}
        <div className="bg-white border-2 border-gray-100 rounded-3xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-purple-600" />
            <h3 className="font-black text-gray-900 uppercase text-sm tracking-widest">
              Colar transcrição / copy
            </h3>
          </div>
          <p className="text-xs text-gray-500">
            Texto da VSL, sales letter, bullets — qualquer coisa colada.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Cole aqui o texto bruto..."
            rows={6}
            className="w-full p-4 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:outline-none resize-none"
            disabled={loading}
          />
          <p className="text-[10px] text-gray-400">
            {text.length.toLocaleString()} caracteres
          </p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 text-center">
        Pode usar qualquer um dos três — ou combinar. Se preencher múltiplos, a IA
        junta tudo na análise.
      </p>

      <button
        onClick={handleExtract}
        disabled={loading || (!text.trim() && !url.trim())}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-black uppercase text-sm tracking-widest py-5 rounded-2xl shadow-lg flex items-center justify-center gap-3 transition"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={20} />
            Extraindo informações...
          </>
        ) : (
          <>
            <Sparkles size={20} />
            Extrair informações com IA
          </>
        )}
      </button>

      {info && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 size={20} />
            <h3 className="font-black uppercase text-sm tracking-widest">
              Informações extraídas
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard label="Produto" value={info.productName} />
            <InfoCard label="Categoria" value={info.category} />
            <InfoCard label="Oferta" value={info.offer} span />
            <InfoCard label="Promessa" value={info.promise} span />
            <InfoCard label="Dor principal" value={info.mainPain} span />
            <InfoCard label="Público-alvo" value={info.audience} span />
            <InfoCard label="Nível de consciência" value={info.awarenessLevel} />
            <InfoCard label="Tom recomendado" value={info.tone} />
            <InfoCard label="Diferencial" value={info.differentiator} span />
            {info.guarantee && <InfoCard label="Garantia" value={info.guarantee} />}
            {info.urgency && <InfoCard label="Urgência" value={info.urgency} />}
          </div>

          {info.benefits?.length > 0 && (
            <ListCard label="Principais benefícios" items={info.benefits} />
          )}
          {info.secondaryPains?.length > 0 && (
            <ListCard label="Dores secundárias" items={info.secondaryPains} />
          )}
          {info.hookAngles?.length > 0 && (
            <ListCard label="Ângulos sugeridos para hook" items={info.hookAngles} />
          )}
          {info.socialProof?.length > 0 && (
            <ListCard label="Prova social mencionada" items={info.socialProof} />
          )}

          <button
            onClick={onContinue}
            className="w-full bg-gray-900 hover:bg-black text-white font-black uppercase text-sm tracking-widest py-5 rounded-2xl shadow-lg flex items-center justify-center gap-3"
          >
            Ir para Identificar Persona
            <ArrowRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div
      className={`bg-white border-2 border-gray-100 rounded-xl p-4 ${span ? 'md:col-span-2' : ''}`}
    >
      <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-1">
        {label}
      </p>
      <p className="text-sm text-gray-900">{value || '—'}</p>
    </div>
  );
}

function ListCard({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="bg-white border-2 border-gray-100 rounded-xl p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-2">
        {label}
      </p>
      <ul className="text-sm text-gray-900 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-purple-400">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
