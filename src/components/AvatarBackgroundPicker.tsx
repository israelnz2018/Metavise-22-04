import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Image as ImageIcon, Loader2, Palette, Sparkles, Upload, Video, X } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenAI } from '@google/genai';
import { storage, auth } from '@/lib/firebase';

// Fundo que o HeyGen compõe atrás do avatar. `value` é hex (#RRGGBB) p/ cor, ou
// URL pública (Firebase Storage) p/ imagem/vídeo. Espelha AdConfig.avatar.background.
export type AvatarBackground = { type: 'color' | 'image' | 'video'; value: string };

interface Props {
  value?: AvatarBackground;
  onChange: (bg: AvatarBackground | undefined) => void;
  disabled?: boolean;
  /** Proporção do vídeo — usada pra gerar o fundo com IA no formato certo. */
  aspectRatio?: '16:9' | '9:16' | '1:1';
}

// Cores prontas comuns em anúncios. Preto é o default histórico do app.
const COLOR_SWATCHES = [
  { label: 'Preto', value: '#000000' },
  { label: 'Branco', value: '#FFFFFF' },
  { label: 'Grafite', value: '#1F2937' },
  { label: 'Azul-noite', value: '#0B1220' },
  { label: 'Roxo', value: '#6D28D9' },
  { label: 'Bege', value: '#F5E6D3' },
  { label: 'Verde (chroma)', value: '#00B140' },
];

export function AvatarBackgroundPicker({ value, onChange, disabled, aspectRatio }: Props) {
  // Aba ativa segue o tipo atual; default 'color'.
  const [tab, setTab] = useState<'color' | 'image' | 'video'>(
    value?.type === 'image' || value?.type === 'video' ? value.type : 'color'
  );
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [generatingAI, setGeneratingAI] = useState(false);
  const [validatingUrl, setValidatingUrl] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Aplica uma URL colada (imagem/vídeo já hospedado) sem upload. Precisa ser
  // link público e DIRETO pro arquivo — o HeyGen baixa de lá. Validamos
  // carregando o recurso no navegador: se for uma página (HTML) em vez do
  // arquivo, o load falha e avisamos ANTES de gastar um render do HeyGen.
  function applyUrl() {
    const url = urlInput.trim();
    const kind: 'image' | 'video' = tab === 'video' ? 'video' : 'image';
    if (!/^https?:\/\/.+/i.test(url)) {
      toast.error('Cole uma URL válida (começando com http:// ou https://).');
      return;
    }
    setValidatingUrl(true);
    const finish = (ok: boolean) => {
      setValidatingUrl(false);
      if (ok) {
        onChange({ type: kind, value: url });
        setUrlInput('');
        toast.success('Fundo aplicado pela URL.');
      } else {
        toast.error(
          `Esse link não abriu como ${kind === 'video' ? 'vídeo' : 'imagem'} — parece ser uma página, não o arquivo. ` +
            'Clique com o botão direito na imagem → "Copiar endereço da imagem".',
          { duration: 10000 }
        );
      }
    };
    // Timeout de segurança: se nada disparar em 12s, trata como inválido.
    const timer = setTimeout(() => finish(false), 12000);
    const ok = () => {
      clearTimeout(timer);
      finish(true);
    };
    const fail = () => {
      clearTimeout(timer);
      finish(false);
    };
    if (kind === 'image') {
      const img = new Image();
      img.onload = ok;
      img.onerror = fail;
      img.src = url;
    } else {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = ok;
      v.onerror = fail;
      v.src = url;
    }
  }

  const colorValue = value?.type === 'color' ? value.value : '#000000';

  // Sobe um Blob/File pro Storage e aplica como fundo. Prefixo `projects/` já é
  // permitido pelas regras do Storage; a URL tokenizada do getDownloadURL é
  // fetchável pelo HeyGen mesmo com leitura protegida.
  async function putBlob(blob: Blob, filename: string, kind: 'image' | 'video') {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      toast.error('Login expirado. Recarregue a página.');
      return;
    }
    setUploading(true);
    try {
      const safeName = filename.replace(/[^a-z0-9.-]/gi, '_');
      // Prefixo `video/` é o que as regras de Storage PUBLICADAS já permitem
      // (é onde o app salva os vídeos). Evita precisar publicar regra nova. A
      // URL tokenizada do getDownloadURL é fetchável pelo HeyGen.
      const path = `video/${uid}/avatar-bg/${Date.now()}-${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, blob);
      const url = await getDownloadURL(storageRef);
      onChange({ type: kind, value: url });
      toast.success(`Fundo (${kind === 'video' ? 'vídeo' : 'imagem'}) aplicado.`);
    } catch (err: any) {
      toast.error(`Falha ao enviar: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }

  function uploadToStorage(file: File, kind: 'image' | 'video') {
    // Limite defensivo — imagem 15MB, vídeo 50MB.
    const maxMB = kind === 'video' ? 50 : 15;
    if (file.size > maxMB * 1024 * 1024) {
      toast.error(`Arquivo muito grande (>${maxMB}MB).`);
      return;
    }
    return putBlob(file, file.name, kind);
  }

  // Gera um fundo com IA (Imagen) no formato do vídeo, sobe pro Storage e aplica.
  async function generateWithAI() {
    if (!aiPrompt.trim()) {
      toast.error('Descreva o fundo que quer gerar.');
      return;
    }
    setGeneratingAI(true);
    try {
      // Chave: tenta a build-time (VITE_) e, se não houver, busca a do servidor
      // (GEMINI_API_KEY) via /api/gemini/key — mesma rota que o app já usa.
      let key = (import.meta as any).env.VITE_GEMINI_API_KEY as string | undefined;
      if (!key) {
        const r = await fetch('/api/gemini/key');
        if (r.ok) key = (await r.json()).apiKey;
      }
      if (!key) {
        toast.error('Chave Gemini não configurada no servidor (GEMINI_API_KEY).');
        return;
      }
      const ai = new GoogleGenAI({ apiKey: key });
      // Reforça que é fundo pra talking-head: desfoque, espaço negativo, sem
      // texto e sem pessoas no centro (pra não competir com o avatar).
      const prompt = `${aiPrompt.trim()}. Background scene for a talking-head video, softly blurred with shallow depth of field, leaving negative space, clean and professional, no text, no people in the center.`;
      const resp = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt,
        config: { numberOfImages: 1, aspectRatio: (aspectRatio || '16:9') as any },
      });
      const b64 = (resp.generatedImages || [])[0]?.image?.imageBytes;
      if (!b64) throw new Error('Nenhuma imagem foi gerada.');
      // base64 → Blob (pra subir pro Storage e ter URL pública pro HeyGen).
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      await putBlob(new Blob([arr], { type: 'image/png' }), 'ai-bg.png', 'image');
      setAiPrompt('');
    } catch (err: any) {
      toast.error(`Falha ao gerar com IA: ${err.message}`, { duration: 8000 });
    } finally {
      setGeneratingAI(false);
    }
  }

  const TabButton = ({
    id,
    icon,
    label,
  }: {
    id: 'color' | 'image' | 'video';
    icon: React.ReactNode;
    label: string;
  }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      disabled={disabled}
      className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all ${
        tab === id
          ? 'bg-blue-600 text-white shadow-sm'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-2xl ring-1 ring-gray-200/60 dark:ring-gray-700/60">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
          Fundo do avatar
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={disabled}
            className="text-[10px] font-bold text-gray-500 hover:text-red-600 flex items-center gap-1"
          >
            <X size={11} /> Limpar
          </button>
        )}
      </div>

      <div className="flex gap-1.5">
        <TabButton id="color" icon={<Palette size={13} />} label="Cor" />
        <TabButton id="image" icon={<ImageIcon size={13} />} label="Imagem" />
        <TabButton id="video" icon={<Video size={13} />} label="Vídeo" />
      </div>

      {tab === 'color' && (
        <div className="space-y-2">
          {/* "Nenhum" = não força fundo escolhido; o servidor usa o padrão
              neutro (preto). Clicar limpa a seleção. */}
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={disabled}
            className={`w-full py-1.5 rounded-lg text-[11px] font-bold transition-all ${
              !value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 ring-1 ring-gray-200 dark:ring-gray-700'
            }`}
          >
            Nenhum (padrão)
          </button>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_SWATCHES.map((c) => {
              const active = value?.type === 'color' && value.value.toLowerCase() === c.value.toLowerCase();
              return (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => onChange({ type: 'color', value: c.value })}
                  disabled={disabled}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    active
                      ? 'border-blue-600 scale-110 shadow'
                      : 'border-gray-300 dark:border-gray-600 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
            Personalizada:
            <input
              type="color"
              value={colorValue}
              onChange={(e) => onChange({ type: 'color', value: e.target.value })}
              disabled={disabled}
              className="w-9 h-7 rounded cursor-pointer bg-transparent"
            />
            <span className="font-mono">{colorValue}</span>
          </label>
        </div>
      )}

      {(tab === 'image' || tab === 'video') && (
        <div className="space-y-2">
          <input
            ref={tab === 'image' ? imageInputRef : videoInputRef}
            type="file"
            accept={tab === 'image' ? 'image/*' : 'video/mp4,video/quicktime,video/webm'}
            className="hidden"
            disabled={disabled || uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadToStorage(f, tab);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => (tab === 'image' ? imageInputRef : videoInputRef).current?.click()}
            disabled={disabled || uploading}
            className="w-full p-5 border-2 border-dashed border-blue-300 dark:border-blue-800/60 rounded-2xl text-blue-700 dark:text-blue-300 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} />}
            <span className="text-xs font-black uppercase tracking-widest">
              {uploading
                ? 'Enviando...'
                : `Escolher ${tab === 'image' ? 'imagem' : 'vídeo'} de fundo`}
            </span>
            <span className="text-[10px] opacity-70">
              {tab === 'image' ? 'jpg/png/webp · max 15MB' : 'mp4/mov/webm · max 50MB'}
            </span>
          </button>

          {/* Alternativa ao upload: colar um link já hospedado. */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">ou</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyUrl();
                }
              }}
              placeholder={`Cole o link da ${tab === 'image' ? 'imagem' : 'vídeo'} (https://...)`}
              disabled={disabled || uploading}
              className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 rounded-xl text-xs ring-1 ring-gray-200 dark:ring-gray-700 focus:ring-2 focus:ring-blue-500 outline-none dark:text-gray-100"
            />
            <button
              type="button"
              onClick={applyUrl}
              disabled={disabled || uploading || validatingUrl || !urlInput.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {validatingUrl ? <Loader2 className="animate-spin" size={12} /> : null}
              {validatingUrl ? '...' : 'Usar'}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 leading-snug">
            Use um link <strong>direto e público</strong> do arquivo (termina em .jpg/.png/.mp4).
            Link de página (ex: a página do Unsplash) não funciona — precisa ser o arquivo em si.
          </p>

          {tab === 'image' && (
            <div className="rounded-xl bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 ring-1 ring-purple-200/60 dark:ring-purple-800/40 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-purple-700 dark:text-purple-300">
                <Sparkles size={13} /> Gerar fundo com IA
              </div>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="ex: consultório médico moderno e desfocado, tons suaves de azul"
                rows={2}
                disabled={disabled || generatingAI || uploading}
                className="w-full p-2.5 bg-white dark:bg-gray-900 rounded-lg text-xs ring-1 ring-purple-200/60 dark:ring-purple-800/40 focus:ring-2 focus:ring-purple-500 outline-none resize-none dark:text-gray-100"
              />
              <button
                type="button"
                onClick={generateWithAI}
                disabled={disabled || generatingAI || uploading || !aiPrompt.trim()}
                className="w-full py-2 bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-lg text-[11px] font-black uppercase tracking-widest hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {generatingAI ? (
                  <>
                    <Loader2 className="animate-spin" size={13} /> Gerando ({aspectRatio || '16:9'})...
                  </>
                ) : (
                  <>
                    <Sparkles size={13} /> Gerar imagem de fundo
                  </>
                )}
              </button>
              <p className="text-[10px] text-purple-700/70 dark:text-purple-300/60 leading-snug">
                Gera no formato do vídeo ({aspectRatio || '16:9'}), já desfocado e com espaço
                pro avatar. Usa o Imagen (consome cota Gemini).
              </p>
            </div>
          )}

          {value?.type === tab && value.value.startsWith('http') && (
            <div className="rounded-xl overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700">
              {tab === 'image' ? (
                <img src={value.value} alt="fundo" className="w-full max-h-32 object-cover" />
              ) : (
                <video src={value.value} className="w-full max-h-32" controls muted />
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
        O HeyGen compõe o avatar sobre este fundo. Avatares com fundo neutro/removível
        ficam melhores. Vale pro vídeo normal e pro Modo Econômico.
      </p>
    </div>
  );
}
