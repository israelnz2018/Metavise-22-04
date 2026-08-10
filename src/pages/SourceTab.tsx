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
import { extractProductInfo, type ProductInfo } from '@/lib/claudeService';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type Mode = 'choose' | 'auto';

interface Props {
  // Existing extracted info (persists across reopens via config.copy.productInfo).
  existingInfo?: ProductInfo | null;
  onExtracted: (info: ProductInfo, rawText: string) => void;
  // Manual flow → goes to Persona for hand-fill. Auto flow → goes to Plano
  // de Marketing because Source already populated persona+copy answers.
  onContinueManual: () => void;
  onContinueAuto: () => void;
  /** Blueprint Fase 4 — quando o cliente já escolheu sourceMode='vsl' no
   *  NewProjectModal, pula a tela "Manual vs Automática" e vai direto
   *  pro modo auto. Default 'choose' preserva o comportamento legacy. */
  initialMode?: Mode;
}

export function SourceTab({
  existingInfo,
  onExtracted,
  onContinueManual,
  onContinueAuto,
  initialMode = 'choose',
}: Props) {
  const { t } = useLanguage();
  const st = t.sourceTab;
  // Always start with the manual-vs-auto question — even if the user has
  // a previous extraction saved. They can still see the saved info by
  // clicking "Automática" again. Override via initialMode (Fase 4).
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ProductInfo | null>(existingInfo || null);

  if (mode === 'choose') {
    return (
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="space-y-2 text-center">
          <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            {st.choose.title}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{st.choose.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <button
            onClick={onContinueManual}
            className="group bg-white dark:bg-gray-900/80 ring-1 ring-gray-200/60 dark:ring-gray-800/60 hover:ring-purple-400 dark:hover:ring-purple-700 hover:shadow-xl hover:shadow-gray-200/40 dark:hover:shadow-black/40 hover:-translate-y-0.5 rounded-2xl p-7 text-left transition-all duration-200 space-y-4"
          >
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 group-hover:bg-purple-100 dark:group-hover:bg-purple-950/40 text-gray-600 dark:text-gray-400 group-hover:text-purple-700 dark:group-hover:text-purple-400 rounded-xl flex items-center justify-center ring-1 ring-gray-200/60 dark:ring-gray-700/60 group-hover:ring-purple-300 dark:group-hover:ring-purple-800 transition-all">
              <Hand size={24} />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
                {st.choose.manual.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {st.choose.manual.description}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-500 group-hover:text-purple-700 dark:group-hover:text-purple-400 transition-colors">
              {st.choose.manual.cta}
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          <button
            onClick={() => setMode('auto')}
            className="group relative bg-gradient-to-br from-white to-purple-50/30 dark:from-gray-900/80 dark:to-purple-950/20 ring-1 ring-purple-300/60 dark:ring-purple-800/60 hover:ring-purple-500 dark:hover:ring-purple-500 hover:shadow-xl hover:shadow-purple-200/40 dark:hover:shadow-purple-900/40 hover:-translate-y-0.5 rounded-2xl p-7 text-left transition-all duration-200 space-y-4"
          >
            <span className="absolute top-4 right-4 text-[10px] font-black uppercase tracking-widest bg-gradient-to-br from-purple-500 to-purple-700 text-white px-2.5 py-1 rounded-full shadow-xl shadow-purple-200/60 dark:shadow-purple-900/30 ring-1 ring-inset ring-white/20">
              {st.choose.auto.badge}
            </span>
            <div className="w-12 h-12 bg-gradient-to-br from-purple-100 to-purple-200/60 dark:from-purple-950/40 dark:to-purple-900/20 text-purple-700 dark:text-purple-400 rounded-xl flex items-center justify-center ring-1 ring-purple-200/60 dark:ring-purple-900/40 transition-all">
              <Wand2 size={24} />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
                {st.choose.auto.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {st.choose.auto.description}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 transition">
              {st.choose.auto.cta}
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        </div>
      </div>
    );
  }

  const handleExtract = async () => {
    if (!text.trim() && !url.trim() && !youtubeUrl.trim()) {
      toast.error(st.toasts.fillAtLeastOne);
      return;
    }
    setLoading(true);
    try {
      // Aceita link sem http:// — completa com https:// automaticamente.
      const withProtocol = (u: string) => (u && !/^https?:\/\//i.test(u) ? `https://${u}` : u);
      const product = await extractProductInfo({
        text: text.trim() || undefined,
        url: withProtocol(url.trim()) || undefined,
        youtubeUrl: withProtocol(youtubeUrl.trim()) || undefined,
      });
      setInfo(product);
      const summary = text.trim() || `[YouTube: ${youtubeUrl}]` || `[URL: ${url}]`;
      onExtracted(product, summary);
      toast.success(st.toasts.extracted);
      // Vai direto pra Persona — lá os campos preenchem sozinhos a partir do
      // material. Sem parar na Fonte mostrando os dados extraídos.
      onContinueAuto();
    } catch (err: any) {
      const msg = String(err?.message || '');
      // Falha ao buscar a URL → orienta o usuário (URL completa ou texto) em
      // vez de mostrar o erro técnico "fetch failed".
      if (url.trim() && /buscar URL|fetch failed/i.test(msg)) {
        toast.error(st.toasts.urlFetchFailed, { duration: 8000 });
      } else {
        toast.error(msg || st.toasts.extractError);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            {st.form.title}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 max-w-2xl">{st.form.subtitle}</p>
        </div>
        <button
          onClick={() => setMode('choose')}
          className="shrink-0 text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {st.form.switchModeButton}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* YouTube VSL */}
        <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-red-200/60 dark:ring-red-900/40 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Youtube size={20} className="text-red-600 dark:text-red-400" />
            <h3 className="font-black text-gray-900 dark:text-gray-50 uppercase text-sm tracking-widest">
              {st.form.youtube.title}
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{st.form.youtube.description}</p>
          <input
            type="url"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none transition-all dark:text-gray-100 dark:placeholder:text-gray-500"
            disabled={loading}
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{st.form.youtube.hint}</p>
        </div>

        {/* URL landing page */}
        <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <LinkIcon size={18} className="text-purple-600 dark:text-purple-400" />
            <h3 className="font-black text-gray-900 dark:text-gray-50 uppercase text-sm tracking-widest">
              {st.form.landingPage.title}
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {st.form.landingPage.description}
          </p>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://meuproduto.com.br/vendas"
            className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none transition-all dark:text-gray-100 dark:placeholder:text-gray-500"
            disabled={loading}
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{st.form.landingPage.hint}</p>
        </div>

        {/* Paste text */}
        <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-purple-600 dark:text-purple-400" />
            <h3 className="font-black text-gray-900 dark:text-gray-50 uppercase text-sm tracking-widest">
              {st.form.pasteText.title}
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {st.form.pasteText.description}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={st.form.pasteText.placeholder}
            rows={6}
            className="w-full p-3 bg-gray-50 dark:bg-gray-800/60 ring-1 ring-gray-200/60 dark:ring-gray-700/60 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none transition-all resize-none dark:text-gray-100 dark:placeholder:text-gray-500"
            disabled={loading}
          />
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            {st.form.pasteText.charsCount(text.length.toLocaleString())}
          </p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
        {st.form.combineHint}
      </p>

      <button
        onClick={handleExtract}
        disabled={loading || (!text.trim() && !url.trim() && !youtubeUrl.trim())}
        className="w-full bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 disabled:from-gray-200 disabled:to-gray-300 dark:disabled:from-gray-800 dark:disabled:to-gray-700 disabled:text-gray-400 disabled:shadow-none text-white font-black uppercase text-sm tracking-widest py-4 rounded-xl shadow-xl shadow-purple-200/60 dark:shadow-purple-900/30 ring-1 ring-inset ring-white/20 flex items-center justify-center gap-3 transition-all active:scale-[0.99] disabled:active:scale-100 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={20} />
            {st.form.extractButton.extracting}
          </>
        ) : (
          <>
            <Sparkles size={20} />
            {st.form.extractButton.idle}
          </>
        )}
      </button>

      {info && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 size={20} />
            <h3 className="font-black uppercase text-sm tracking-widest">
              {st.extractedInfo.title}
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard label={st.extractedInfo.labels.product} value={info.productName} />
            <InfoCard label={st.extractedInfo.labels.category} value={info.category} />
            <InfoCard label={st.extractedInfo.labels.offer} value={info.offer} span />
            <InfoCard label={st.extractedInfo.labels.promise} value={info.promise} span />
            <InfoCard label={st.extractedInfo.labels.mainPain} value={info.mainPain} span />
            <InfoCard label={st.extractedInfo.labels.audience} value={info.audience} span />
            <InfoCard label={st.extractedInfo.labels.awarenessLevel} value={info.awarenessLevel} />
            <InfoCard label={st.extractedInfo.labels.tone} value={info.tone} />
            <InfoCard
              label={st.extractedInfo.labels.differentiator}
              value={info.differentiator}
              span
            />
            {info.guarantee && (
              <InfoCard label={st.extractedInfo.labels.guarantee} value={info.guarantee} />
            )}
            {info.urgency && (
              <InfoCard label={st.extractedInfo.labels.urgency} value={info.urgency} />
            )}
          </div>

          {info.benefits?.length > 0 && (
            <ListCard label={st.extractedInfo.labels.benefits} items={info.benefits} />
          )}
          {info.secondaryPains?.length > 0 && (
            <ListCard label={st.extractedInfo.labels.secondaryPains} items={info.secondaryPains} />
          )}
          {info.hookAngles?.length > 0 && (
            <ListCard label={st.extractedInfo.labels.hookAngles} items={info.hookAngles} />
          )}
          {info.socialProof?.length > 0 && (
            <ListCard label={st.extractedInfo.labels.socialProof} items={info.socialProof} />
          )}

          <button
            onClick={onContinueAuto}
            className="w-full bg-gray-900 dark:bg-gray-100 hover:bg-black dark:hover:bg-white text-white dark:text-gray-900 font-black uppercase text-sm tracking-widest py-4 rounded-xl shadow-lg flex items-center justify-center gap-3 transition-all active:scale-[0.99]"
          >
            {st.extractedInfo.continueButton}
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
      className={`bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-xl p-4 ${span ? 'md:col-span-2' : ''}`}
    >
      <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-1">
        {label}
      </p>
      <p className="text-sm text-gray-900 dark:text-gray-100">{value || '—'}</p>
    </div>
  );
}

function ListCard({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="bg-white/80 dark:bg-gray-900/60 ring-1 ring-gray-200/60 dark:ring-gray-800/60 rounded-xl p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-2">
        {label}
      </p>
      <ul className="text-sm text-gray-900 dark:text-gray-100 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-purple-400 dark:text-purple-500">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
