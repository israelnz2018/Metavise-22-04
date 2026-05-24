import React, { useState } from 'react';
import HookChooser from './HookChooser';
import { GoogleGenAI } from '@google/genai';
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  Check,
  Loader2,
  Zap,
  ChevronRight,
  History,
  Library,
  Mic,
  Film,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'react-hot-toast';

// Import Claude helper from existing service
// Note: We'll wrap the callClaude in a local function if needed or just use it
const RAILWAY_URL = 'https://analises-production.up.railway.app';

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2000
): Promise<string> {
  const response = await fetch(`${RAILWAY_URL}/metavise/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      user: userPrompt,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Railway Claude error: ${err}`);
  }

  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Erro Claude.');
  return data.text;
}

interface HookVisualGeneratorProps {
  approvedHook: string;
  projectId: string;
  hookVisual: {
    promptImagem: string;
    imagensGeradas: string[];
    imagemEscolhida: string;
    promptVideo: string;
    videoGerado: string;
    duracaoVideo: number;
    modeloImagem: string;
    modeloVideo: string;
  };
  onSave: (data: any) => void;
  onVideoGenerated?: (videoUrl: string) => void;
  onProceedToVoice?: () => void;
  language?: string;
  awarenessLevel?: string;
  approvedCopy?: string;
  hooksHistorico?: { hook: string; createdAt: string }[];
  onSaveHook?: (hook: string) => void;
  onDeleteHookFromHistory?: (hook: string) => void;
  onGoToVoz?: () => void;
  onGoToAvatar?: () => void;
  // Project-level flag: false means the user explicitly skipped the hook.
  // When false we show a banner with a "Reativar" button; when true we
  // show a "Pular gancho" button that lets them turn the flag off.
  useHookFlow?: boolean;
  onToggleUseHook?: (next: boolean) => void;
}

type StepType =
  | 'choose'
  | 'improve'
  | 'images'
  | 'approve-image'
  | 'video-prompt'
  | 'video'
  | 'done';

interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  model: string;
  quality: string;
}

interface GeneratedVideo {
  id: string;
  url: string;
  prompt: string;
  model: string;
  quality: string;
}

const MODELS_IMAGE = [{ id: 'gemini-imagen', label: 'Gemini Imagen 3', provider: 'Google AI' }];

const QUALITY_IMAGE = [
  {
    id: 'fast',
    label: 'Rápido',
    model: 'imagen-4.0-fast-generate-001',
    cost: 0.02,
    desc: '⚡ ~$0.06 (3 imagens)',
  },
  {
    id: 'standard',
    label: 'Padrão',
    model: 'imagen-4.0-generate-001',
    cost: 0.04,
    desc: '⭐ ~$0.12 (3 imagens)',
  },
  {
    id: 'pro',
    label: 'Ultra',
    model: 'imagen-4.0-ultra-generate-001',
    cost: 0.06,
    desc: '💎 ~$0.18 (3 imagens)',
  },
];

const QUALITY_VIDEO = [
  {
    id: 'lite',
    label: 'Lite',
    model: 'veo-3.0-fast-generate-001',
    costPerSec: 0.05,
    desc: '⚡ Econômico',
  },
  {
    id: 'fast',
    label: 'Fast',
    model: 'veo-3.0-generate-001',
    costPerSec: 0.1,
    desc: '⭐ Recomendado',
  },
  {
    id: 'pro',
    label: 'Pro',
    model: 'veo-3.1-generate-preview',
    costPerSec: 0.4,
    desc: '💎 Ultra Qualidade',
  },
];

const ASPECT_RATIOS = [
  { id: '9:16', label: '9:16 (Story/Reels)' },
  { id: '1:1', label: '1:1 (Feed)' },
  { id: '16:9', label: '16:9 (YouTube)' },
];

export const HookVisualGenerator: React.FC<HookVisualGeneratorProps> = ({
  approvedHook,
  hookVisual,
  onSave,
  onVideoGenerated,
  onProceedToVoice,
  language,
  awarenessLevel,
  approvedCopy,
  hooksHistorico,
  onSaveHook,
  onDeleteHookFromHistory,
  onGoToVoz,
  onGoToAvatar,
  useHookFlow = true,
  onToggleUseHook,
}) => {
  const [currentStep, setCurrentStep] = useState<StepType>(
    hookVisual?.videoGerado
      ? 'done'
      : hookVisual?.imagemEscolhida
        ? 'video-prompt'
        : hookVisual?.imagensGeradas?.length > 0
          ? 'images'
          : 'choose'
  );
  const [sessionHook, setSessionHook] = useState<string>('');
  const [improvedImagePrompt, setImprovedImagePrompt] = useState(hookVisual?.promptImagem || '');
  const [isImproving, setIsImproving] = useState(false);

  // Image Step States
  const [selectedImageModel, setSelectedImageModel] = useState(
    hookVisual?.modeloImagem || 'gemini-imagen'
  );
  const [selectedImageQuality, setSelectedImageQuality] = useState('standard');
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  // Lazy init: Math.random() runs only once during mount (not every render),
  // satisfying the react-hooks/purity rule and producing stable IDs.
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>(
    () =>
      hookVisual?.imagensGeradas?.map((url) => ({
        id: Math.random().toString(36).substr(2, 9),
        url,
        prompt: hookVisual?.promptImagem || '',
        model: hookVisual?.modeloImagem || '',
        quality: 'standard',
      })) || []
  );
  const [imageHistory, setImageHistory] = useState<GeneratedImage[]>([]);

  // Selection
  const [approvedImage, setApprovedImage] = useState<GeneratedImage | null>(
    hookVisual?.imagemEscolhida
      ? {
          id: 'approved',
          url: hookVisual.imagemEscolhida,
          prompt: hookVisual?.promptImagem || '',
          model: hookVisual?.modeloImagem || '',
          quality: 'standard',
        }
      : null
  );
  const [imagePromptUsado, setImagePromptUsado] = useState(hookVisual?.promptImagem || '');

  // Video Step States
  const [videoPrompt, setVideoPrompt] = useState(hookVisual?.promptVideo || '');
  const [isGeneratingVideoPrompt, setIsGeneratingVideoPrompt] = useState(false);
  const [selectedVideoQuality, setSelectedVideoQuality] = useState('fast');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('9:16');
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoGenerationProgress, setVideoGenerationProgress] = useState(0);
  const [finalVideo, setFinalVideo] = useState<GeneratedVideo | null>(
    hookVisual?.videoGerado
      ? {
          id: 'final',
          url: hookVisual.videoGerado,
          prompt: hookVisual.promptVideo,
          model: hookVisual.modeloVideo,
          quality: 'fast',
        }
      : null
  );

  // Labels for the stepper
  const STEPS = [
    { id: 'choose', label: 'Escolher Hook', icon: Library },
    { id: 'improve', label: 'Melhorar Hook', icon: Sparkles },
    { id: 'images', label: 'Gerar Imagens', icon: ImageIcon },
    { id: 'video-prompt', label: 'Produção', icon: Video },
  ];

  const GEMINI_API_KEY = (import.meta as any).env.VITE_GEMINI_API_KEY;

  const calcularDuracaoVideo = (hook: string): number => {
    const palavras = hook.trim().split(/\s+/).length;
    const segundos = Math.ceil(palavras / 2.5);
    if (segundos <= 4) return 4;
    if (segundos <= 6) return 6;
    return 8;
  };

  const duracaoVideo = calcularDuracaoVideo(approvedHook);
  const palavrasHook = approvedHook
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  // -- Step 1: Improve Hook via Claude --
  const handleImproveHook = async () => {
    setIsImproving(true);
    try {
      const systemPrompt = `You are a world-class visual prompt engineer specializing 
in photorealistic AI image generation for direct response 
advertising on Meta, TikTok, and YouTube. You think like a 
documentary photographer and casting director who understands 
that scroll-stopping images feel REAL, not staged.

Your job: Transform a marketing hook into a single highly 
detailed image generation prompt optimized for Imagen 4. The 
image must be the perfect FIRST FRAME of a short video that 
visually amplifies the hook's emotional message.

EXAMPLE OF GREAT OUTPUT:
'A 55-year-old Brazilian woman with silver-streaked dark hair 
pulled back loosely, sitting at her worn kitchen table at 6am, 
slowly looking down at her trembling hand with a confused, 
worried expression, warm golden window light from the left 
creating soft shadow on the right side of her face, half-empty 
coffee cup nearby on a wooden surface, sheer curtains softly 
diffusing the light, shot on 85mm portrait lens at f/1.8, 
shallow depth of field with subject sharp and background gently 
blurred, photorealistic documentary style, raw unedited Canon 
EOS R5 look, authentic skin texture with visible pores and 
natural imperfections, no filters, no stock photo aesthetic'

REQUIRED ELEMENTS IN ORDER:
1. Subject — age, ethnicity if relevant, hair, clothing
2. Action — ONE precise micro-action that conveys hook emotion
3. Setting — specific real environment with sensory details
4. Lighting — direction, quality, color temperature
5. Camera — lens (85mm, 50mm, 35mm), aperture, depth of field
6. Style — 'photorealistic documentary', 'raw unedited', 
   specific camera body for credibility
7. Negative — 'no stock photo look, no oversaturated colors, 
   no perfect studio lighting, no model-like beauty'

RULES:
- Hook emotion is PRIMARY — every visual choice reinforces it
- Subject must look like the TARGET AUDIENCE, not a model
- Include skin texture details ('visible pores', 'natural 
  imperfections') to defeat the AI plastic look
- Use specific cameras and lenses for photorealism credibility
- Setting must feel REAL and lived-in, never staged
- Match the aspect ratio provided by the user
- Output ONLY the image prompt in English
- Single flowing paragraph, no bullets, no headers
- Maximum 150 words

INPUTS YOU WILL RECEIVE:
- Hook text (Portuguese or English)
- Aspect ratio chosen by user

OUTPUT: Only the optimized image prompt. Nothing else.`;

      const userPrompt = `APPROVED HOOK: "${approvedHook}"`;

      const result = await callClaude(systemPrompt, userPrompt);
      setImprovedImagePrompt(result.trim());
      onSave({ promptImagem: result.trim() });
      setCurrentStep('images');
      toast.success('Prompt de imagem gerado com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao melhorar o hook. Tente novamente.');
    } finally {
      setIsImproving(false);
    }
  };

  // -- Step 2: Generate 3 Images via Gemini Imagen API --
  const handleGenerateImages = async () => {
    if (!improvedImagePrompt) {
      toast.error('Por favor, defina um prompt de imagem.');
      return;
    }

    if (!GEMINI_API_KEY) {
      toast.error('Chave Gemini não configurada. Adicione VITE_GEMINI_API_KEY no .env');
      return;
    }

    setIsGeneratingImages(true);
    try {
      const quality = QUALITY_IMAGE.find((q) => q.id === selectedImageQuality) || QUALITY_IMAGE[1]!;
      const model = quality.model;
      const aspectRatio = selectedImageQuality === 'pro' ? '9:16' : '1:1';

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const response = await ai.models.generateImages({
        model: model,
        prompt: improvedImagePrompt,
        config: {
          numberOfImages: 3,
          aspectRatio: aspectRatio as any,
        },
      });

      const generations = (response.generatedImages || []).map((gen: any) => ({
        id: Math.random().toString(36).substr(2, 9),
        url: `data:image/png;base64,${gen.image.imageBytes}`,
        prompt: improvedImagePrompt,
        model: model,
        quality: selectedImageQuality,
      }));

      if (generations.length === 0) throw new Error('Nenhuma imagem foi gerada pela IA.');

      setGeneratedImages(generations);
      setImageHistory((prev) => [...generations, ...prev]);
      onSave({
        promptImagem: improvedImagePrompt,
        imagensGeradas: generations.map((g: any) => g.url),
        modeloImagem: model,
      });
      toast.success('3 variações geradas com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar imagens com Gemini. Verifique sua chave API.');
    } finally {
      setIsGeneratingImages(false);
    }
  };

  const handleSelectImage = (img: GeneratedImage) => {
    setApprovedImage(img);
    setImagePromptUsado(img.prompt);
    onSave({
      imagemEscolhida: img.url,
      promptImagem: img.prompt,
      modeloImagem: img.model,
    });
    setCurrentStep('video-prompt');
  };

  // -- Step 3: Generate Video Prompt via Claude --
  const handleGenerateVideoPrompt = async () => {
    if (!approvedImage) return;
    setIsGeneratingVideoPrompt(true);
    try {
      const systemPrompt = `You are a Veo video director using Timestamp Prompting 
technique — the professional standard for controlled 
AI video generation.

Structure your output as a second-by-second timeline:

EXAMPLE FOR 5-SECOND VIDEO:
'0-1s: [opening frame description with subject, expression, 
framing]
2-3s: [middle action — what shifts or develops]
4-5s: [closing moment — emotional payoff, camera 
finalization]'

GUIDELINES:
- Hook text is your emotional anchor for the entire timeline
- Describe only what is in the approved image
- One subject, continuous emotional arc
- Camera options: static / slow push-in / slow pull-back
- Each segment must connect smoothly to the next
- Silent video, no audio
- Total duration: ${duracaoVideo} seconds
- Output ONLY the timestamped prompt in English`;

      const userPrompt = `Hook: "${approvedHook}"
Duração: ${duracaoVideo} segundos
Imagem: "${imagePromptUsado}"

Gere the prompt onde o vídeo reforça visualmente a emoção do hook do início ao fim.`;

      const result = await callClaude(systemPrompt, userPrompt, 300);
      setVideoPrompt(result.trim());
      onSave({
        promptVideo: result.trim(),
        duracaoVideo: duracaoVideo,
      });
      toast.success('Prompt de vídeo gerado!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar prompt de vídeo. Tente novamente.');
    } finally {
      setIsGeneratingVideoPrompt(false);
    }
  };

  // -- Step 4: Generate Video via Gemini Veo API --
  const handleGenerateVideo = async () => {
    if (!approvedImage || !videoPrompt) return;

    if (!GEMINI_API_KEY) {
      toast.error('Chave Gemini não configurada. Adicione VITE_GEMINI_API_KEY no .env');
      return;
    }

    setIsGeneratingVideo(true);
    setVideoGenerationProgress(5);

    try {
      const quality = QUALITY_VIDEO.find((q) => q.id === selectedVideoQuality) || QUALITY_VIDEO[1]!;
      const model = quality.model;

      // Converter imagem para base64 puro (sem prefixo data:...)
      let base64Imagem = approvedImage.url;
      if (approvedImage.url.startsWith('data:')) {
        base64Imagem = approvedImage.url.split(',')[1] || '';
      }

      const duracaoSegura = [4, 6, 8].includes(duracaoVideo) ? duracaoVideo : 6;

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

      // Iniciar geração
      let operation = await ai.models.generateVideos({
        model: model,
        prompt: videoPrompt,
        image: {
          imageBytes: base64Imagem,
          mimeType: 'image/png',
        },
        config: {
          aspectRatio: '9:16',
          durationSeconds: duracaoSegura,
          numberOfVideos: 1,
        },
      });

      // Polling a cada 5s
      let attempts = 0;
      const maxAttempts = 50; // Aprox 4-5 minutos

      while (!operation.done && attempts < maxAttempts) {
        attempts++;
        setVideoGenerationProgress(Math.min(5 + attempts * 2, 98));

        await new Promise((r) => setTimeout(r, 5000));

        operation = await (ai as any).operations.getVideosOperation({
          operation,
        });
      }

      if (!operation.done) {
        throw new Error('Tempo limite de geração excedido.');
      }

      setVideoGenerationProgress(100);

      console.log('Operation response completa:', JSON.stringify(operation.response, null, 2));

      // Verificar se houve erro na operação
      if (operation.error) {
        const msg = (operation.error as any).message || JSON.stringify(operation.error);
        throw new Error(`Erro na geração do vídeo: ${msg}`);
      }

      // Verificar se gerou com sucesso
      const videos = operation.response?.generatedVideos;
      if (!videos || videos.length === 0) {
        throw new Error(
          'Vídeo não gerado. Pode ter sido bloqueado por filtro de segurança. ' +
            'Tente um prompt diferente.'
        );
      }

      // URI precisa da API key para ser acessível
      const videoUri = videos[0]?.video?.uri;
      if (!videoUri) {
        throw new Error('URI do vídeo não encontrada na resposta');
      }

      // Concatenar API key na URI
      const videoUrl = `${videoUri}&key=${(import.meta as any).env.VITE_GEMINI_API_KEY}`;

      // Adicionar log para debug
      console.log('Video gerado com sucesso:', videoUrl);

      const videoData: GeneratedVideo = {
        id: (operation as any).name || 'final',
        url: videoUrl,
        prompt: videoPrompt,
        model: model,
        quality: selectedVideoQuality,
      };

      setFinalVideo(videoData);
      onSave({
        promptVideo: videoPrompt,
        videoGerado: videoUrl,
        modeloVideo: model,
        duracaoVideo: duracaoVideo,
      });
      setCurrentStep('done');
      if (onVideoGenerated) onVideoGenerated(videoUrl);
      toast.success('Vídeo produzido com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Ocorreu um erro na geração do vídeo.');
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const getEstimatedCost = () => {
    if (currentStep === 'images') {
      const q = QUALITY_IMAGE.find((q) => q.id === selectedImageQuality);
      return ((q?.cost || 0) * 3).toFixed(2);
    }
    if (currentStep === 'video-prompt' || currentStep === 'video') {
      const q = QUALITY_VIDEO.find((q) => q.id === selectedVideoQuality);
      return ((q?.costPerSec || 0) * duracaoVideo).toFixed(2);
    }
    return '0.00';
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-8 space-y-12">
      {/* Skip hook flow / re-enable banner. Lets users opt out of the
          separate gancho production for projects that don't need one. */}
      {onToggleUseHook &&
        (useHookFlow ? (
          <div className="bg-gray-50 dark:bg-gray-800/60 border-2 border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              <strong className="font-black text-gray-900 dark:text-gray-50">
                Não vai usar gancho separado?
              </strong>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                Pula esta aba, esconde o toggle de gancho em Voz/Avatar/Edição e o botão de juntar.
              </span>
            </div>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    'Pular o gancho neste projeto? Você pode reativar depois nesta mesma aba.'
                  )
                ) {
                  onToggleUseHook(false);
                  onGoToVoz?.();
                }
              }}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black whitespace-nowrap"
            >
              Pular gancho
            </button>
          </div>
        ) : (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="text-sm text-amber-900">
              <strong className="font-black">Gancho pulado neste projeto</strong>
              <span className="block text-xs text-amber-700 dark:text-amber-400 mt-1">
                A aba está dormente. Reative se mudou de ideia — os toggles de gancho voltam em Voz,
                Avatar e Edição.
              </span>
            </div>
            <button
              onClick={() => onToggleUseHook(true)}
              className="px-5 py-2.5 bg-amber-500 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-amber-600 whitespace-nowrap"
            >
              Reativar gancho
            </button>
          </div>
        ))}

      {/* Stepper Header */}
      <div className="flex items-center justify-between px-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive =
            currentStep === step.id ||
            idx < STEPS.findIndex((s) => s.id === currentStep) ||
            (currentStep === 'done' && idx <= STEPS.length);
          const isCurrent = currentStep === step.id;

          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                  } ${isCurrent ? 'ring-4 ring-blue-50' : ''}`}
                >
                  <Icon size={18} />
                </div>
                <span
                  className={`text-[10px] font-black uppercase tracking-widest ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-4 mb-6 rounded-full ${
                    idx < STEPS.findIndex((s) => s.id === currentStep)
                      ? 'bg-blue-600'
                      : 'bg-gray-100 dark:bg-gray-800'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Main Content Area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-white dark:bg-gray-900/80 rounded-[40px] border-2 border-gray-200 dark:border-gray-800 shadow-2xl p-8 md:p-12 overflow-hidden relative"
        >
          {/* Step 1: Improve Hook */}
          {currentStep === 'choose' && (
            <div className="space-y-8">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                    <Library size={16} />
                  </div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase">
                    A. Escolher Hook
                  </h3>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Escolha um hook da biblioteca, filtre por tipo/tom/nível, ou escreva o seu
                  próprio.
                </p>
              </div>

              <HookChooser
                language={language}
                awarenessLevel={awarenessLevel}
                approvedCopy={approvedCopy}
                hooksHistorico={hooksHistorico}
                onSaveHook={(hook) => {
                  setSessionHook(hook);
                  onSaveHook?.(hook);
                }}
                onDeleteHookFromHistory={onDeleteHookFromHistory}
              />

              <div className="mt-6 bg-gray-900 rounded-3xl p-6 shadow-xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-amber-400 p-1.5 rounded-lg text-gray-900 dark:text-gray-50">
                    <Sparkles size={16} />
                  </div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">
                    Próximo Passo
                  </h3>
                  {!sessionHook && (
                    <span className="ml-auto text-xs text-orange-300 font-bold">
                      ⚠ Salve um hook primeiro
                    </span>
                  )}
                  {sessionHook && (
                    <span className="ml-auto text-xs text-green-300 font-bold truncate max-w-xs">
                      ✅ "{sessionHook.substring(0, 40)}
                      {sessionHook.length > 40 ? '...' : ''}"
                    </span>
                  )}
                </div>
                {!sessionHook && (
                  <p className="text-xs text-white/50 mb-2">
                    Escolha e salve um hook nas opções acima para liberar os próximos passos.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                  <button
                    onClick={() => (sessionHook ? onGoToVoz?.() : null)}
                    className={`group rounded-2xl p-5 text-left transition-all border-2 ${sessionHook ? 'bg-white dark:bg-gray-900/80 hover:bg-blue-50 dark:hover:bg-blue-950/40 border-transparent hover:border-blue-300 hover:shadow-lg cursor-pointer' : 'bg-gray-800 border-gray-700 cursor-not-allowed opacity-50'}`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center ${sessionHook ? 'bg-blue-100 dark:bg-blue-950/30 group-hover:bg-blue-200' : 'bg-gray-700'}`}
                      >
                        <Mic
                          size={18}
                          className={
                            sessionHook
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }
                        />
                      </div>
                      <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                        Caminho 1
                      </p>
                    </div>
                    <h4
                      className={`text-base font-black mb-1 ${sessionHook ? 'text-gray-900 dark:text-gray-50' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      Gerar Voz do Hook
                    </h4>
                    <p
                      className={`text-xs leading-relaxed ${sessionHook ? 'text-gray-500 dark:text-gray-400' : 'text-gray-600 dark:text-gray-400'}`}
                    >
                      Vai para a aba Voz para gerar áudio do gancho.
                    </p>
                  </button>

                  <button
                    onClick={() => (sessionHook ? onGoToAvatar?.() : null)}
                    className={`group rounded-2xl p-5 text-left transition-all border-2 ${sessionHook ? 'bg-white dark:bg-gray-900/80 hover:bg-purple-50 dark:hover:bg-purple-950/40 border-transparent hover:border-purple-300 hover:shadow-lg cursor-pointer' : 'bg-gray-800 border-gray-700 cursor-not-allowed opacity-50'}`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center ${sessionHook ? 'bg-purple-100 group-hover:bg-purple-200' : 'bg-gray-700'}`}
                      >
                        <Film
                          size={18}
                          className={
                            sessionHook
                              ? 'text-purple-600 dark:text-purple-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }
                        />
                      </div>
                      <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                        Caminho 2
                      </p>
                    </div>
                    <h4
                      className={`text-base font-black mb-1 ${sessionHook ? 'text-gray-900 dark:text-gray-50' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      Gerar Vídeo com Avatar
                    </h4>
                    <p
                      className={`text-xs leading-relaxed ${sessionHook ? 'text-gray-500 dark:text-gray-400' : 'text-gray-600 dark:text-gray-400'}`}
                    >
                      Vai para a aba Avatar (HeyGen).
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentStep === 'improve' && (
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                    <Sparkles size={16} />
                  </div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase">
                    1. Melhorar Hook
                  </h3>
                </div>
                <div className="p-6 bg-gray-50 dark:bg-gray-800/60 rounded-3xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">
                    Hook Aprovado
                  </p>
                  <p className="text-lg font-bold text-gray-700 dark:text-gray-300 italic">
                    "{approvedHook}"
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 flex-wrap">
                {onProceedToVoice && (
                  <button
                    onClick={onProceedToVoice}
                    className="px-10 py-5 bg-white dark:bg-gray-900/80 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:border-gray-300 transition-all shadow-lg flex items-center gap-3"
                  >
                    Ir para Voz Premium
                    <ChevronRight />
                  </button>
                )}
                <button
                  onClick={handleImproveHook}
                  disabled={isImproving}
                  className="px-10 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center gap-3 disabled:opacity-50"
                >
                  {isImproving ? <Loader2 className="animate-spin" /> : <ChevronRight />}
                  Melhorar Hook para Imagem
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Generate Images */}
          {currentStep === 'images' && (
            <div className="space-y-8">
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                    <ImageIcon size={16} />
                  </div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase">
                    2. Gerar Visual
                  </h3>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                    Prompt da Imagem (Pode editar)
                  </p>
                  <textarea
                    value={improvedImagePrompt}
                    onChange={(e) => setImprovedImagePrompt(e.target.value)}
                    className="w-full p-6 bg-gray-50 dark:bg-gray-800/60 rounded-3xl border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:bg-white dark:bg-gray-900/80 transition-all text-sm font-medium leading-relaxed min-h-[120px]"
                    placeholder="Descreva a imagem..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                      Modelo de IA
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {MODELS_IMAGE.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setSelectedImageModel(m.id)}
                          className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                            selectedImageModel === m.id
                              ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40'
                              : 'border-gray-200 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                          }`}
                        >
                          <div className="text-left">
                            <p className="font-black text-sm text-gray-900 dark:text-gray-50 uppercase">
                              {m.label}
                            </p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase">
                              {m.provider}
                            </p>
                          </div>
                          {selectedImageModel === m.id && (
                            <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-white">
                              <Check size={12} />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                      Qualidade & Custo
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {QUALITY_IMAGE.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => setSelectedImageQuality(q.id)}
                          className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                            selectedImageQuality === q.id
                              ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40'
                              : 'border-gray-200 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                          }`}
                        >
                          <div className="text-left">
                            <p className="font-black text-sm text-gray-900 dark:text-gray-50 uppercase">
                              {q.label}
                            </p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase">
                              {q.desc}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-gray-500 dark:text-gray-400">
                              ${q.cost}
                            </span>
                            {selectedImageQuality === q.id && (
                              <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-white">
                                <Check size={12} />
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950/40 p-6 rounded-3xl border-2 border-blue-100 dark:border-blue-900 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-blue-600 dark:text-blue-400">
                      <Zap size={20} />
                    </div>
                    <div>
                      <p className="text-xs font-black text-blue-900 uppercase">
                        Custo Estimado:{' '}
                        <span className="text-blue-600 dark:text-blue-400">
                          ${getEstimatedCost()}
                        </span>
                      </p>
                      <p className="text-[10px] text-blue-800/60 font-bold uppercase">
                        Gerar 3 variações simultâneas
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateImages}
                    disabled={isGeneratingImages}
                    className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2 disabled:opacity-50"
                  >
                    {isGeneratingImages ? <Loader2 className="animate-spin" size={18} /> : null}
                    Gerar 3 Variações
                  </button>
                </div>

                {/* Image Grid */}
                {(generatedImages.length > 0 || isGeneratingImages) && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 border-t border-gray-200 dark:border-gray-800">
                    {isGeneratingImages
                      ? Array(3)
                          .fill(0)
                          .map((_, i) => (
                            <div
                              key={i}
                              className="aspect-square bg-gray-50 dark:bg-gray-800/60 rounded-[32px] animate-pulse flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-200 dark:border-gray-700"
                            >
                              <Loader2
                                className="animate-spin text-gray-300 dark:text-gray-600"
                                size={32}
                              />
                              <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase">
                                Gerando...
                              </span>
                            </div>
                          ))
                      : generatedImages.map((img) => (
                          <motion.div
                            key={img.id}
                            whileHover={{ scale: 1.02 }}
                            className="group relative aspect-square bg-gray-900 rounded-[32px] overflow-hidden shadow-xl"
                          >
                            <img
                              src={img.url || undefined}
                              alt="IA Generated"
                              className="w-full h-full object-cover transition-all group-hover:scale-110"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-6">
                              <button
                                onClick={() => handleSelectImage(img)}
                                className="w-full py-4 bg-white dark:bg-gray-900/80 text-gray-900 dark:text-gray-50 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-blue-600 hover:text-white transition-all shadow-xl"
                              >
                                Escolher esta
                              </button>
                            </div>
                          </motion.div>
                        ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Video Prompt & Production */}
          {currentStep === 'video-prompt' && (
            <div className="space-y-8">
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                    <Video size={16} />
                  </div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-gray-50 uppercase">
                    3. Produção de Vídeo
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Chosen Image Card */}
                  <div className="space-y-4">
                    <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                      Imagem Escolhida
                    </p>
                    <div className="rounded-[32px] overflow-hidden border-4 border-white shadow-2xl relative aspect-square">
                      {approvedImage && (
                        <img
                          src={approvedImage.url || undefined}
                          alt="Imagem aprovada"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* Duration Info */}
                    <div className="p-6 bg-blue-50 dark:bg-blue-950/40 rounded-3xl border-2 border-blue-100 dark:border-blue-900">
                      <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest mb-1">
                        ✅ Duração do vídeo: {duracaoVideo}s
                      </p>
                      <p className="text-[10px] text-blue-800 font-bold uppercase">
                        {palavrasHook} palavras · ~{duracaoVideo}s
                      </p>
                    </div>

                    <div className="space-y-4">
                      {/* Formato / Proporção Select */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                          Formato
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {ASPECT_RATIOS.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => setSelectedAspectRatio(a.id)}
                              className={`py-2 rounded-xl border-2 text-[10px] font-black transition-all ${
                                selectedAspectRatio === a.id
                                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                                  : 'border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-700'
                              }`}
                            >
                              {a.id}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Editable Video Prompt Textarea */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                        Prompt do Vídeo (editável)
                      </label>
                      <textarea
                        value={videoPrompt}
                        onChange={(e) => setVideoPrompt(e.target.value)}
                        className="w-full p-6 bg-gray-50 dark:bg-gray-800/60 rounded-[32px] border-2 border-gray-200 dark:border-gray-800 focus:border-blue-600 focus:bg-white dark:bg-gray-900/80 transition-all text-sm font-medium leading-relaxed min-h-[160px]"
                        placeholder="Clique em 'Gerar Prompt' para criar o prompt do vídeo baseado no seu hook..."
                      />
                    </div>

                    {/* Quality Selector */}
                    <div className="space-y-3">
                      <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">
                        Qualidade de Vídeo
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        {QUALITY_VIDEO.map((q) => (
                          <button
                            key={q.id}
                            onClick={() => setSelectedVideoQuality(q.id)}
                            className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                              selectedVideoQuality === q.id
                                ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40'
                                : 'border-gray-200 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                            }`}
                          >
                            <div className="text-left">
                              <p className="font-black text-xs text-gray-900 dark:text-gray-50 uppercase">
                                {q.desc}
                              </p>
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase">
                                {q.id}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-black text-gray-500 dark:text-gray-400">
                                {duracaoVideo}s = ~${(duracaoVideo * q.costPerSec).toFixed(2)}
                              </span>
                              {selectedVideoQuality === q.id && (
                                <div className="w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center text-white">
                                  <Check size={10} />
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Generating Video Progress UI */}
                    {isGeneratingVideo && (
                      <div className="space-y-3 p-6 bg-gray-900 rounded-[32px] text-center">
                        <div className="flex items-center justify-center gap-3 mb-2">
                          <Loader2 className="animate-spin text-blue-500" size={16} />
                          <span className="text-[10px] font-black text-white uppercase tracking-widest">
                            Produzindo vídeo... {Math.round(videoGenerationProgress)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-500"
                            style={{ width: `${videoGenerationProgress}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium italic">
                          Aguarde, sua copy visual está sendo preparada.
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    {!isGeneratingVideo && (
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={handleGenerateVideoPrompt}
                          disabled={isGeneratingVideoPrompt}
                          className="py-6 bg-white dark:bg-gray-900/80 border-2 border-blue-600 text-blue-600 dark:text-blue-400 rounded-[32px] font-black text-sm flex items-center justify-center gap-2 shadow-xl transition-all hover:bg-blue-50 dark:hover:bg-blue-950/40 active:scale-95 disabled:opacity-50"
                        >
                          {isGeneratingVideoPrompt ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          ✨ Gerar Prompt
                        </button>

                        <button
                          onClick={handleGenerateVideo}
                          disabled={!videoPrompt || isGeneratingVideo || isGeneratingVideoPrompt}
                          className={`py-6 bg-blue-600 text-white rounded-[32px] font-black text-sm flex items-center justify-center gap-2 shadow-xl transition-all hover:bg-blue-700 active:scale-95 disabled:bg-gray-300 disabled:opacity-50 disabled:shadow-none`}
                        >
                          <Video size={16} />
                          🎬 Gerar Vídeo ~${getEstimatedCost()} ({duracaoVideo}s)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Done */}
          {currentStep === 'done' && (
            <div className="space-y-12 py-6 text-center">
              <div className="space-y-4">
                <div className="w-20 h-20 bg-green-50 dark:bg-green-950/40 text-green-600 dark:text-green-400 rounded-[32px] flex items-center justify-center mx-auto shadow-xl shadow-green-100">
                  <Check size={40} />
                </div>
                <h3 className="text-3xl font-black text-gray-900 dark:text-gray-50 uppercase tracking-tighter">
                  Produção Finalizada!
                </h3>
                <p className="text-gray-400 dark:text-gray-500 font-medium max-w-md mx-auto">
                  Sua copy visual foi gerada com sucesso pela nossa inteligência artificial.
                </p>
              </div>

              <div className="max-w-2xl mx-auto rounded-[40px] overflow-hidden shadow-2xl bg-gray-900 border-8 border-white p-2">
                {finalVideo && (
                  <video
                    src={finalVideo.url || undefined}
                    controls
                    autoPlay
                    loop
                    className="w-full h-full rounded-[32px]"
                  />
                )}
              </div>

              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => setCurrentStep('improve')}
                  className="px-8 py-4 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                >
                  Desejo refazer
                </button>
                <button
                  onClick={() => {
                    toast.success('Vídeo enviado para a biblioteca!');
                  }}
                  className="px-10 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-100"
                >
                  Concluir Produção
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* History Sidebar/Section (Optional bottom section) */}
      {imageHistory.length > 0 && currentStep !== 'done' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="flex items-center gap-3">
            <History size={18} className="text-gray-400 dark:text-gray-500" />
            <h4 className="text-sm font-black text-gray-900 dark:text-gray-50 uppercase tracking-widest">
              Histórico de Imagens
            </h4>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {imageHistory.map((img) => (
              <div
                key={img.id}
                onClick={() => setApprovedImage(img)}
                className={`flex-shrink-0 w-24 h-24 rounded-2xl overflow-hidden cursor-pointer border-4 transition-all ${
                  approvedImage?.id === img.id
                    ? 'border-blue-600 ring-4 ring-blue-50 scale-105'
                    : 'border-white shadow-md'
                }`}
              >
                <img
                  src={img.url || undefined}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default HookVisualGenerator;
