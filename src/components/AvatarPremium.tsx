import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';
import { User, Image as ImageIcon, Video, Upload, Loader2, CheckCircle2, AlertCircle, DollarSign, Sparkles, Play, X, Search, Users } from 'lucide-react';
import { AvatarEngine, AspectRatio, HeyGenAvatarV3, GenerateParams, VideoStatus, ENGINE_LABELS, estimatePrice, estimateScriptSeconds, listAvatarsV3, uploadAsset, generateVideo, getVideoStatus, subscribeStatus } from '../lib/heygenPremiumService';

interface Props {
  approvedScript?: string;
  projectId?: string;
  audioUrl?: string;
  voiceId?: string;
  pendingVideoId?: string;
  onVideoReady?: (videoUrl: string, meta: { engine: AvatarEngine; cost: number }) => void;
  onVideoStarted?: (videoId: string) => void;
}

const RATIOS: { id: AspectRatio; label: string }[] = [
  { id: '9:16', label: 'Reels / TikTok' },
  { id: '1:1',  label: 'Feed quadrado'  },
  { id: '16:9', label: 'YouTube'        },
  { id: '4:5',  label: 'Instagram 4:5'  },
];

const AvatarPremium: React.FC<Props> = ({ approvedScript = '', projectId, audioUrl, voiceId, pendingVideoId, onVideoReady, onVideoStarted }) => {
  const [engine, setEngine]           = useState<AvatarEngine>('avatar3');
  const [ratio, setRatio]             = useState<AspectRatio>('9:16');
  const [script, setScript]           = useState(approvedScript);
  const [catalog, setCatalog]         = useState<HeyGenAvatarV3[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [avatarSearch, setAvatarSearch] = useState('');
  const [avatarGender, setAvatarGender] = useState<'all' | 'male' | 'female'>('all');
  const [selectedAvatar, setSelectedAvatar] = useState('');
  const [photoFile, setPhotoFile]     = useState<File | null>(null);
  const [photoAssetId, setPhotoAssetId] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [vidFile, setVidFile]         = useState<File | null>(null);
  const [vidAssetId, setVidAssetId]   = useState('');
  const [bgType, setBgType]           = useState<'color' | 'image' | 'video'>('color');
  const [bgColor, setBgColor]         = useState('#000000');
  const [bgFile, setBgFile]           = useState<File | null>(null);
  const [bgAssetId, setBgAssetId]     = useState('');
  const [generating, setGenerating]   = useState(false);
  const [status, setStatus]           = useState<VideoStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = (msg: string) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`]);

  const pollingRef = useRef<{ interval: any; timeout: any } | null>(null);
  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current.interval);
      clearTimeout(pollingRef.current.timeout);
      pollingRef.current = null;
    }
  };
  useEffect(() => () => stopPolling(), []);

  const price = useMemo(() => estimatePrice(engine, estimateScriptSeconds(script), '1080p'), [engine, script]);

  useEffect(() => {
    if (engine !== 'avatar3' || catalog.length > 0) return;
    setCatalogLoading(true);
    listAvatarsV3().then(setCatalog).catch(e => toast.error(e.message)).finally(() => setCatalogLoading(false));
  }, [engine]);

  useEffect(() => {
    if (!pendingVideoId || generating) return;
    addLog(`Retomando vídeo pendente: ${pendingVideoId}`);
    setGenerating(true);
    startPolling(pendingVideoId, 0);
  }, [pendingVideoId]);

  useEffect(() => {
    if (!photoFile) { setPhotoPreview(''); return; }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const handlePhoto = async (file: File) => {
    setPhotoFile(file);
    try { const { assetId } = await uploadAsset(file, 'image'); setPhotoAssetId(assetId); toast.success('Foto enviada.'); }
    catch (e: any) { toast.error(e.message); setPhotoFile(null); }
  };

  const handleRefVideo = async (file: File) => {
    if (file.size > 100 * 1024 * 1024) { toast.error('Máximo 100MB.'); return; }
    setVidFile(file);
    try { const { assetId } = await uploadAsset(file, 'video'); setVidAssetId(assetId); toast.success('Vídeo enviado.'); }
    catch (e: any) { toast.error(e.message); setVidFile(null); }
  };

  const handleBg = async (file: File) => {
    setBgFile(file);
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    try { const { assetId } = await uploadAsset(file, kind); setBgAssetId(assetId); setBgType(kind); }
    catch (e: any) { toast.error(e.message); }
  };

  const filteredCatalog = useMemo(() => {
    return catalog.filter(a => {
      const matchesSearch = !avatarSearch || a.avatar_name?.toLowerCase().includes(avatarSearch.toLowerCase());
      const matchesGender = avatarGender === 'all' || (a.gender?.toLowerCase() === avatarGender);
      return matchesSearch && matchesGender;
    });
  }, [catalog, avatarSearch, avatarGender]);

  const canGenerate = useMemo(() => {
    if (!script && !audioUrl) return false;
    if (engine === 'avatar3' && !selectedAvatar) return false;
    if (engine === 'avatar4' && !photoAssetId) return false;
    if (engine === 'avatar5' && !vidAssetId) return false;
    return true;
  }, [engine, script, audioUrl, selectedAvatar, photoAssetId, vidAssetId]);

  const startPolling = (id: string, estimatedCost: number) => {
    // Cancela qualquer polling anterior antes de começar novo
    stopPolling();
    addLog(`Polling iniciado para video ${id}`);
    const interval = setInterval(async () => {
      try {
        const s = await getVideoStatus(id);
        addLog(`Status: ${s.status}${s.videoUrl ? ' — URL recebida' : ''}`);
        setStatus(s);
        if (s.status === 'completed' || s.status === 'failed') {
          stopPolling();
          setGenerating(false);
          if (s.status === 'completed' && s.videoUrl) {
            addLog('Vídeo pronto!');
            toast.success('Vídeo pronto!');
            onVideoReady?.(s.videoUrl, { engine, cost: estimatedCost });
          } else if (s.status === 'failed') {
            addLog(`Falhou: ${s.errorMessage}`);
            toast.error(s.errorMessage || 'Falha na geração.');
          }
        }
      } catch (e: any) {
        addLog(`Erro no polling: ${e.message}`);
      }
    }, 5000);
    const timeout = setTimeout(async () => {
      // Última checagem antes de desistir
      try {
        const s = await getVideoStatus(id);
        if (s.status === 'completed' && s.videoUrl) {
          addLog('Vídeo pronto (após timeout)!');
          stopPolling();
          setGenerating(false);
          toast.success('Vídeo pronto!');
          onVideoReady?.(s.videoUrl, { engine, cost: estimatedCost });
          return;
        }
      } catch (e) {}
      stopPolling();
      setGenerating(false);
      addLog('Timeout — 5 min atingido. HeyGen pode estar com fila lenta.');
      toast.error('Vídeo demorou demais. Verifique no painel HeyGen ou tente novamente.');
    }, 5 * 60 * 1000);
    pollingRef.current = { interval, timeout };
  };

  const handleGenerate = async () => {
    if (!canGenerate) { toast.error('Preencha os campos obrigatórios.'); return; }
    stopPolling(); // Cancela qualquer polling antigo antes de iniciar
    setGenerating(true); setStatus(null); setLogs([]);
    addLog(`Iniciando geração — engine: ${engine}, formato: ${ratio}`);
    try {
      const params: GenerateParams = {
        engine, aspectRatio: ratio, resolution: '1080p',
        script: audioUrl ? undefined : script,
        audioUrl: audioUrl || undefined,
        voiceId: voiceId || undefined,
        title: projectId ? `metavise-${projectId.slice(0, 8)}` : undefined,
        background: { type: bgType, ...(bgType === 'color' ? { value: bgColor } : { assetId: bgAssetId }), ...(bgType === 'video' ? { playStyle: 'loop' } : {}) },
        avatarId:               engine === 'avatar3' ? selectedAvatar : undefined,
        imageAssetId:           engine === 'avatar4' ? photoAssetId  : undefined,
        referenceVideoAssetId:  engine === 'avatar5' ? vidAssetId    : undefined,
      };
      const result = await generateVideo(params);
      addLog(`Requisição enviada ao HeyGen — videoId: ${result.videoId}`);
      onVideoStarted?.(result.videoId);
      addLog(`Custo estimado: $${result.estimatedCostUsd}`);
      toast.success('Geração iniciada. Verificando a cada 5 segundos...');
      startPolling(result.videoId, result.estimatedCostUsd);
    } catch (e: any) { toast.error(e.message); setGenerating(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={20} className="text-amber-500" />
          <span className="text-xs uppercase tracking-wider text-amber-600 font-semibold">Premium</span>
        </div>
        <h2 className="text-3xl font-light text-gray-900">Avatar Premium</h2>
        <p className="text-gray-500 mt-2">Escolha o motor de avatar. Cada um tem qualidade, input e preço diferente.</p>
      </div>

      {/* Engine selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {(['avatar3', 'avatar4', 'avatar5'] as AvatarEngine[]).map(eng => {
          const info = ENGINE_LABELS[eng];
          const p = estimatePrice(eng, 60, '1080p');
          const active = engine === eng;
          return (
            <button key={eng} onClick={() => setEngine(eng)}
              className={`relative text-left rounded-2xl p-6 border-2 transition-all ${active ? 'border-amber-500 bg-amber-50/40 shadow-sm' : 'border-gray-100 hover:border-gray-300 bg-white'}`}>
              {active && <CheckCircle2 size={20} className="absolute top-4 right-4 text-amber-500" />}
              <div className="flex items-start gap-3 mb-3">
                {eng === 'avatar3' && <User size={22} className="text-gray-700 mt-0.5" />}
                {eng === 'avatar4' && <ImageIcon size={22} className="text-gray-700 mt-0.5" />}
                {eng === 'avatar5' && <Video size={22} className="text-gray-700 mt-0.5" />}
                <div>
                  <h3 className="font-medium text-gray-900">{info.label}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">{info.tagline}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-3">{info.input}</p>
              <div className="flex items-center gap-1 text-sm">
                <DollarSign size={14} className="text-gray-400" />
                <span className="font-medium text-gray-700">${p.costPerMinuteUsd}</span>
                <span className="text-gray-400 text-xs">/ min 1080p</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Engine input */}
      <AnimatePresence mode="wait">
        <motion.div key={engine} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
          className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          {engine === 'avatar3' && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                  <Users size={16} />
                </div>
                <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest">Catálogo HeyGen</h4>
                <span className="text-xs text-gray-400 ml-auto">{filteredCatalog.length} de {catalog.length} avatares</span>
              </div>

              {/* Filtros */}
              <div className="flex flex-col gap-3 mb-4">
                {/* Busca */}
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <Search size={14} className="text-gray-400 flex-shrink-0" />
                  <input
                    value={avatarSearch}
                    onChange={(e) => setAvatarSearch(e.target.value)}
                    placeholder="Buscar avatar por nome..."
                    className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder-gray-400"
                  />
                  {avatarSearch && (
                    <button onClick={() => setAvatarSearch('')} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                  )}
                </div>

                {/* Gênero */}
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest w-14">Gênero</p>
                  <div className="flex gap-2">
                    {[
                      { id: 'all', label: 'Todos' },
                      { id: 'female', label: 'Feminino' },
                      { id: 'male', label: 'Masculino' },
                    ].map(g => (
                      <button
                        key={g.id}
                        onClick={() => setAvatarGender(g.id as 'all' | 'male' | 'female')}
                        className={`px-4 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition ${
                          avatarGender === g.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {catalogLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 size={20} className="animate-spin mr-2" />Carregando avatares...
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="py-12 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                  <p className="text-gray-400 font-bold text-sm">Nenhum avatar encontrado com esses filtros.</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3 max-h-80 overflow-y-auto">
                  {filteredCatalog.map(a => (
                    <button key={a.avatar_id} onClick={() => setSelectedAvatar(a.avatar_id)}
                      className={`rounded-xl overflow-hidden border-2 transition hover:shadow-md ${
                        selectedAvatar === a.avatar_id
                          ? 'border-blue-500 ring-2 ring-blue-100 shadow-lg'
                          : 'border-gray-100 hover:border-gray-300'
                      }`}>
                      {a.preview_image_url
                        ? <img src={a.preview_image_url || undefined} alt={a.avatar_name} className="w-full aspect-[3/4] object-cover" />
                        : <div className="w-full aspect-[3/4] bg-gray-100 flex items-center justify-center"><User size={20} className="text-gray-300" /></div>}
                      <div className="px-1.5 py-1 text-[10px] text-gray-600 truncate text-center">{a.avatar_name}</div>
                      {a.gender && (
                        <div className={`text-[9px] text-center pb-1 font-bold uppercase tracking-wider ${
                          a.gender?.toLowerCase() === 'female' ? 'text-pink-400' : 'text-blue-400'
                        }`}>
                          {a.gender?.toLowerCase() === 'female' ? '♀' : '♂'}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {engine === 'avatar4' && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">Foto do cliente</h4>
              {!photoFile ? (
                <label className="block cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handlePhoto(e.target.files[0])} />
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center hover:border-gray-400 transition">
                    <Upload size={28} className="mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">Foto frontal e nítida</p>
                    <p className="text-xs text-gray-400 mt-1">Humanos, animais, anime</p>
                  </div>
                </label>
              ) : (
                <div className="relative inline-block">
                  <img src={photoPreview || undefined} alt="preview" className="rounded-xl max-h-80 object-cover" />
                  <button onClick={() => { setPhotoFile(null); setPhotoAssetId(''); }} className="absolute top-2 right-2 bg-white rounded-full p-1.5 shadow"><X size={16} className="text-gray-700" /></button>
                </div>
              )}
            </div>
          )}
          {engine === 'avatar5' && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-3">Vídeo de referência (15 segundos)</h4>
              <p className="text-xs text-gray-500 mb-3">O cliente grava um vídeo curto. O modelo aprende cadência, gestos e expressões.</p>
              {!vidFile ? (
                <label className="block cursor-pointer">
                  <input type="file" accept="video/*" className="hidden" onChange={e => e.target.files?.[0] && handleRefVideo(e.target.files[0])} />
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center hover:border-gray-400 transition">
                    <Video size={28} className="mx-auto text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">Vídeo de 15s</p>
                    <p className="text-xs text-gray-400 mt-1">Webcam frontal, boa iluminação</p>
                  </div>
                </label>
              ) : (
                <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                  <Video size={20} className="text-gray-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{vidFile.name}</p>
                    <p className="text-xs text-gray-400">{(vidFile.size/1024/1024).toFixed(1)} MB{vidAssetId ? ' · enviado' : ' · enviando...'}</p>
                  </div>
                  <button onClick={() => { setVidFile(null); setVidAssetId(''); }}><X size={16} className="text-gray-400" /></button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Format + Background + Price */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Formato</h4>
          <div className="grid grid-cols-2 gap-2">
            {RATIOS.map(r => (
              <button key={r.id} onClick={() => setRatio(r.id)}
                className={`text-left rounded-lg px-3 py-2 text-sm border transition ${ratio === r.id ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-100 hover:border-gray-300 text-gray-700'}`}>
                <div className="font-medium">{r.id}</div>
                <div className="text-xs opacity-70">{r.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Cenário</h4>
          <div className="flex gap-2 mb-3">
            {(['color', 'image', 'video'] as const).map(t => (
              <button key={t} onClick={() => setBgType(t)}
                className={`text-xs rounded-md px-3 py-1.5 border ${bgType === t ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600'}`}>
                {t === 'color' ? 'Cor' : t === 'image' ? 'Imagem' : 'Vídeo'}
              </button>
            ))}
          </div>
          {bgType === 'color'
            ? <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="w-full h-10 rounded cursor-pointer" />
            : <label className="block cursor-pointer">
                <input type="file" accept={bgType === 'image' ? 'image/*' : 'video/*'} className="hidden" onChange={e => e.target.files?.[0] && handleBg(e.target.files[0])} />
                <div className="border border-dashed border-gray-300 rounded-lg p-3 text-center text-sm text-gray-500 hover:border-gray-400">
                  {bgFile ? bgFile.name : `Enviar ${bgType === 'image' ? 'imagem' : 'vídeo'}`}
                </div>
              </label>
          }
        </div>
        <div className="bg-amber-50/50 rounded-2xl border border-amber-100 p-5">
          <h4 className="text-sm font-medium text-amber-900 mb-3">Custo estimado</h4>
          <div className="text-3xl font-light text-amber-900">${price.estimatedCostUsd.toFixed(2)}</div>
          <p className="text-xs text-amber-700/70 mt-1">{price.estimatedMinutes} min · ${price.costPerMinuteUsd}/min</p>
          <p className="text-xs text-amber-700/50 mt-2">Calculado pelo tamanho do roteiro</p>
        </div>
      </div>

      {/* Voz da etapa anterior */}
      {audioUrl ? (
        <div className="bg-green-50 rounded-2xl border border-green-200 p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-green-600" />
            <span className="text-sm font-medium text-green-800">Áudio recebido da aba Voz</span>
            {voiceId && <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Voice ID: {voiceId.slice(0, 8)}...</span>}
          </div>
          <audio controls src={audioUrl || undefined} className="w-full" />
          <p className="text-xs text-green-700/60 mt-2">Este áudio será usado na geração do vídeo.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Roteiro</label>
          <textarea value={script} onChange={e => setScript(e.target.value)} placeholder="Cole o roteiro aprovado..." rows={5}
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:border-amber-400" />
          <p className="text-xs text-gray-400 mt-2">
            {script.trim().split(/\s+/).filter(Boolean).length} palavras · ~{Math.round(estimateScriptSeconds(script))}s estimados
          </p>
        </div>
      )}

      {/* Generate */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">{audioUrl ? 'Áudio aprovado será usado' : 'Roteiro será sintetizado pela voz'}</p>
        <button onClick={handleGenerate} disabled={!canGenerate || generating}
          className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition ${!canGenerate || generating ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-black'}`}>
          {generating ? <><Loader2 size={18} className="animate-spin" />Gerando...</> : <><Play size={18} />Gerar vídeo</>}
        </button>
      </div>

      {/* Logs de debug */}
      {logs.length > 0 && (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Log de geração</h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {logs.map((log, i) => (
              <p key={i} className="text-xs font-mono text-gray-600">{log}</p>
            ))}
          </div>
        </div>
      )}

      {generating && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 rounded-2xl border border-amber-100 bg-amber-50/50 p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-amber-600" />
              <span className="font-medium text-amber-900">Gerando vídeo...</span>
            </div>
            <button
              onClick={() => {
                setGenerating(false);
                setStatus(null);
                setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} — Geração cancelada pelo usuário`]);
                toast.success('Geração cancelada.');
                onVideoStarted?.('');
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 transition"
            >
              Cancelar
            </button>
          </div>
          <p className="text-sm text-amber-700/70">
            {engine === 'avatar3' && 'Avatar III leva cerca de 2–4 minutos.'}
            {engine === 'avatar4' && 'Avatar IV com foto leva cerca de 3–5 minutos.'}
            {engine === 'avatar5' && 'Avatar V leva cerca de 5–8 minutos.'}
          </p>
          <p className="text-xs text-amber-600/60 mt-2">Você receberá uma notificação quando estiver pronto. Pode navegar para outras abas.</p>
        </motion.div>
      )}

      {/* Status */}
      {status && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 rounded-2xl border border-gray-100 bg-white p-5">
          <div className="flex items-center gap-3 mb-2">
            {status.status === 'completed'  && <CheckCircle2 size={20} className="text-green-600" />}
            {status.status === 'failed'     && <AlertCircle  size={20} className="text-red-600"   />}
            {(status.status === 'pending' || status.status === 'processing') && <Loader2 size={20} className="animate-spin text-amber-600" />}
            <span className="font-medium text-gray-900 capitalize">{status.status}</span>
          </div>
          {status.videoUrl    && <video src={status.videoUrl || undefined} controls className="w-full max-w-md rounded-lg mt-3" />}
          {status.errorMessage && <p className="text-sm text-red-600 mt-2">{status.errorMessage}</p>}
        </motion.div>
      )}
    </div>
  );
};

export default AvatarPremium;