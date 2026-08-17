import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import { SoundLibraryModal } from '@/components/SoundLibraryModal';
import { useSoundLibrary } from '@/hooks/useSoundLibrary';
import {
  AvatarFramingModal,
  AvatarFraming,
  DEFAULT_AVATAR_FRAMING,
} from '@/components/AvatarFramingModal';
import {
  Film,
  Upload,
  Loader2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Check,
  Music,
  X,
  Plus,
  Minus,
  Maximize,
  Play,
  Pause,
  GripVertical,
  Undo2,
  Redo2,
  ImageIcon,
  Download,
  Layers,
} from 'lucide-react';
import { useJobs } from '@/lib/jobsStore';
import { triggerProjectSave } from '@/lib/autosave';
import { logCreativeCost, COST_RATES } from '@/lib/creativeCost';
import { EmptyState } from '@/components/EmptyState';
import { useFileDrop } from '@/hooks/useFileDrop';
import { WatermarkPanel } from '@/components/WatermarkPanel';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface Clip {
  url: string;
  label: string;
  duration?: number; // duração detectada no upload
  // Modo SEQUÊNCIA (sem áudio base): trim do clipe.
  startSec?: number;
  endSec?: number;
}

// Lê a duração de um vídeo no navegador. Lida com duration=Infinity/NaN
// (comum em vídeos gravados): força o cálculo pulando pro fim.
const readDurationFromUrl = (src: string): Promise<number> =>
  new Promise((resolve) => {
    let settled = false;
    const v = document.createElement('video');
    v.preload = 'metadata';
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      try {
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    v.onloadedmetadata = () => {
      if (v.duration === Infinity || Number.isNaN(v.duration)) {
        v.ontimeupdate = () => {
          v.ontimeupdate = null;
          finish(v.duration);
        };
        try {
          v.currentTime = 1e7;
        } catch {
          finish(0);
        }
      } else {
        finish(v.duration);
      }
    };
    v.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000); // não trava se algo der errado
    v.src = src;
  });

const readDurationFromFile = async (file: File): Promise<number> => {
  const url = URL.createObjectURL(file);
  const d = await readDurationFromUrl(url);
  URL.revokeObjectURL(url);
  return d;
};

// Modo TIMELINE: cada item é um trecho POSICIONADO no tempo do áudio.
interface TLItem {
  clipIdx: number;
  /** SPLIT-SCREEN: 2º b-roll (lado direito). Renderiza clipIdx | clipIdx2. */
  clipIdx2?: number;
  /** Layout com AVATAR: 'avatar' (tela cheia) | 'pip' (círculo canto) |
   *  'split-left' | 'split-right'. Vazio/'full' = só o b-roll. Usa o "Avatar
   *  base" (sincronizado à narração). */
  layout?: 'full' | 'avatar' | 'pip' | 'split-left' | 'split-right' | 'split-top' | 'split-bottom';
  /** Reposicionamento (pan) do b-roll na METADE do split, 0..1 (0.5 = centro).
   *  Evita cortar/descentralizar o assunto quando o b-roll não cabe na metade. */
  brollCX?: number;
  brollCY?: number;
  /** Enquadramento do avatar SÓ deste trecho (crop/split/pip/proporção) —
   *  quando ausente, usa o enquadramento global (avatarFraming[avatarBase]). */
  frameOverride?: AvatarFraming;
  /** Zoom lento (Ken Burns) DURANTE o trecho inteiro — independente de
   *  transição de entrada/saída (pode ter as duas coisas juntas, ou só uma).
   *  '' / ausente = sem zoom. */
  zoom?: 'in' | 'out' | '';
  /** Ponto-alvo (0..1) do zoom — pra onde ele mira em vez do centro do quadro.
   *  Ausente = centro (0.5/0.5). */
  zoomCX?: number;
  zoomCY?: number;
  atSec: number; // começa em (seg do áudio)
  endSec: number; // termina em (seg do áudio)
  showSec?: number; // legado (drafts antigos)
  // Transição de ENTRADA (início do trecho) e de SAÍDA (fim do trecho).
  transIn?: string;
  transInDur?: number;
  soundIn?: string;
  transOut?: string;
  transOutDur?: number;
  soundOut?: string;
  /** Efeito sonoro CONTEXTUAL (ex.: Cash Register em "dinheiro"), tocado logo
   *  após a entrada do trecho. Escolhido pela IA no Auto-editar. */
  soundMid?: string;
  /** 'end' → o FIM do efeito alinha com o fim do trecho (ex.: SFX Reversed/riser). */
  soundMidAlign?: 'end' | '';
  /** Clipe em preto-e-branco (trechos de "antes"/passado). */
  bw?: boolean;
  /** Termo de b-roll usado pelo Auto-editar — reusado ao "trocar" o trecho. */
  keyword?: string;
}

// Migração: zoom já foi uma transição de entrada ('transIn' = 'zoomin'/
// 'zoomout'), virou um controle próprio do trecho (campo `zoom`). Sem isto,
// draft salvo antes desta mudança perderia o zoom (opção some do select).
function migrateZoomItems(items: TLItem[]): TLItem[] {
  return items.map((it) => {
    if (it.zoom || (it.transIn !== 'zoomin' && it.transIn !== 'zoomout')) return it;
    return { ...it, zoom: it.transIn === 'zoomin' ? 'in' : 'out', transIn: 'none' };
  });
}

// Texto cinético na tela (palavra grande animada, estilo VSL).
interface TextItem {
  text: string;
  atSec: number;
  endSec: number;
  color: string; // hex
  pos: 'middle' | 'top' | 'bottom';
  /** Efeito sonoro que toca junto com a entrada do texto (ex.: Swoosh Fight). */
  sound?: string;
}
const TEXT_COLORS = ['#39FF14', '#FFFFFF', '#FFE500', '#FF3B3B', '#00E0FF'];

// Slot planejado pelo Auto-editar: um trecho [start,end] com candidatos de
// b-roll do Pexels; o usuário escolhe o `chosen` (URL) de cada um.
interface AutoSlot {
  start: number;
  end: number;
  keyword: string;
  searchTerm: string;
  candidates: { url: string; thumb: string; duration?: number }[];
  chosen: string;
  /** Palavra FALADA mais forte do trecho + timing exato (pro texto na tela). */
  spokenWord?: string;
  wordStart?: number;
  wordEnd?: number;
  /** Frase impactante (PT) escolhida pela IA pra destacar na tela (ou vazio). */
  highlight?: string;
  /** Momento EXATO (s) em que a frase de destaque começa a ser dita. */
  highlightStart?: number;
  /** "animation" → busca b-roll em estilo animação/diagrama. */
  style?: string;
  /** "past" → trecho de "antes"/passado → clipe em P&B. */
  tone?: string;
  /** true → split-screen (2 b-rolls lado a lado neste trecho). */
  split?: boolean;
  /** Efeito sonoro contextual sugerido pela IA (nome + URL da biblioteca). */
  effectName?: string;
  effectUrl?: string;
}

// Fim do item (compat com drafts antigos que usavam showSec).
const itemEnd = (it: TLItem) => it.endSec ?? it.atSec + (it.showSec || 5);

// Campo numérico que guarda o TEXTO digitado localmente — evita o bug do
// type="number" controlado, onde limpar mostra "0" e digitar vira "098.5".
// Tira zeros à esquerda, deixa vazio enquanto edita, e faz o clamp só no blur.
function NumInput({
  value,
  onCommit,
  min = 0,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  className?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        // só dígitos + 1 ponto; remove zeros à esquerda ("098.5" → "98.5").
        let s = e.target.value.replace(/[^0-9.]/g, '');
        const dot = s.indexOf('.');
        if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
        s = s.replace(/^0+(\d)/, '$1');
        setRaw(s);
        if (s !== '' && s !== '.') {
          const n = Number(s);
          if (Number.isFinite(n)) onCommit(n);
        }
      }}
      onBlur={() => {
        setFocused(false);
        const n = Number(raw);
        const clamped = Math.max(min, Number.isFinite(n) && raw !== '' ? n : min);
        onCommit(clamped);
        setRaw(String(clamped));
      }}
      className={className}
    />
  );
}

// Ponto-alvo do zoom Ken Burns: clique/arraste na miniatura pra escolher a
// área que o zoom in/out mira (em vez de sempre o centro do quadro).
function ZoomTargetPicker({
  src,
  cx,
  cy,
  onChange,
}: {
  src: string;
  cx: number;
  cy: number;
  onChange: (cx: number, cy: number) => void;
}) {
  const { t } = useLanguage();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const setFromEvent = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onChange(Number(x.toFixed(2)), Number(y.toFixed(2)));
  };
  return (
    <div
      ref={boxRef}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        setFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) setFromEvent(e);
      }}
      title={t.montagemTab.zoomTargetPickerTitle}
      className="relative w-12 h-12 rounded-lg overflow-hidden bg-black cursor-crosshair shrink-0 ring-1 ring-amber-400 touch-none"
    >
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        className="w-full h-full object-cover pointer-events-none"
      />
      <div
        className="absolute w-2.5 h-2.5 rounded-full bg-amber-400 border border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}
      />
    </div>
  );
}

// Transições disponíveis. `css` = classe da animação no preview (definida no
// <style> da própria aba); o `id` é o que o backend (ffmpeg) entende. Os
// labels vêm de t.montagemTab.transitions (precisam reagir à língua atual).
const TRANSITIONS: { id: string; css: string }[] = [
  { id: 'none', css: '' },
  { id: 'fade', css: 'mv-fade' },
  { id: 'dissolve', css: 'mv-fade' },
  { id: 'slideleft', css: 'mv-slideleft' },
  { id: 'slideright', css: 'mv-slideright' },
  { id: 'slideup', css: 'mv-slideup' },
  { id: 'slidedown', css: 'mv-slidedown' },
  { id: 'whiteflash', css: 'mv-white' },
  { id: 'whip', css: 'mv-whip' },
  { id: 'glitch', css: 'mv-glitch' },
  { id: 'bw', css: 'mv-bw' },
];

// Som certo por TIPO de transição, mapeado pelos nomes exatos da biblioteca.
// NUNCA usa Impactos (ex.: Vine Boom) — esses o usuário põe à mão. Tipos sem
// mapeamento (fade/whiteflash/glitch/bw) ficam SEM som automático.
const TRANSITION_SOUND: Record<string, string> = {
  slideleft: 'Swoosh 7',
  slideright: 'Swoosh 7',
  slideup: 'Swoosh 7',
  slidedown: 'Swoosh 7',
  whip: 'Swoosh 7',
  dissolve: 'Swoosh 7',
};
function soundForTransition(type?: string): string {
  try {
    const lib = JSON.parse(localStorage.getItem('metavise-sound-library') || '[]') as any[];
    const findName = (name: string) =>
      lib.find((x) => (x?.name || '').trim().toLowerCase() === name.toLowerCase())?.url || '';
    // Fallback só dentro de "Transições" (nunca Efeitos/Impactos).
    const fallback = () =>
      lib.find((x) => x?.category === 'Transições' && /swoosh|whoosh/i.test(x?.name || ''))?.url ||
      lib.find((x) => x?.category === 'Transições')?.url ||
      '';
    if (type) {
      const wanted = TRANSITION_SOUND[type];
      if (!wanted) return ''; // tipo sem som mapeado → sem áudio automático
      return findName(wanted) || fallback();
    }
    return fallback();
  } catch {
    return '';
  }
}

interface Props {
  config: any;
  setConfig: (updater: any) => void;
  user?: { uid?: string } | null;
  onAddUploadedVideo?: (video: any, isHook: boolean) => void;
  onGoToEdit?: () => void;
  onRemix?: () => void;
}

type MontageMode = 'creative' | 'vsl';

// Workflow de UM bloco/cena da montagem (o que troca ao mudar de bloco).
type BlockWorkflow = {
  clips?: any[];
  items?: any[];
  texts?: any[];
  resultUrl?: string;
  resultHistory?: { url: string; at: number }[];
  coverUrl?: string;
  coverOptions?: string[];
  coverText?: string;
  muted?: boolean;
  audioUrl?: string;
  audioDuration?: number;
  avatarUrl?: string;
  avatarStartSec?: number;
};

function getMontagemDraft(config: any, mode: MontageMode) {
  return mode === 'vsl' ? (config?.montagemVsl as any) || {} : (config?.montagem as any) || {};
}

/**
 * MONTAGEM — usar os PRÓPRIOS vídeos (sem avatar IA).
 *  • COM áudio base → TIMELINE estilo "Mesclar": dá play no áudio, clica
 *    "Adicionar aqui" no segundo certo, escolhe o trecho e ajusta início/fim.
 *    Buracos = tela preta; a voz toca por cima.
 *  • SEM áudio → SEQUÊNCIA: cola os trechos em ordem.
 */
export function MontagemTab({
  config,
  setConfig,
  user,
  onAddUploadedVideo,
  onGoToEdit,
  onRemix,
}: Props) {
  const { t } = useLanguage();
  const mt = t.montagemTab;
  const transitionLabel = (id: string): string =>
    (mt.transitions as Record<string, string>)[id] || id;
  const { addJob, updateJob } = useJobs();
  const vslCfg = ((config as any)?.copyVsl || {}) as any;
  const hasVslWorkflow = Boolean(
    vslCfg.audioUrl ||
    vslCfg.finalScript ||
    vslCfg.generatedScript ||
    ((vslCfg.blockAudios as any[]) || []).some((b) => b?.url && b?.status === 'done') ||
    ((vslCfg.avatarVideos as any[]) || []).some((v) => v?.url)
  );
  const [montagemMode, setMontagemMode] = useState<MontageMode>('creative');
  const draft = getMontagemDraft(config, montagemMode);
  const [clips, setClips] = useState<Clip[]>(() => (Array.isArray(draft.clips) ? draft.clips : []));
  const [items, setItems] = useState<TLItem[]>(() =>
    migrateZoomItems(Array.isArray(draft.items) ? draft.items : [])
  );
  const [texts, setTexts] = useState<TextItem[]>(() =>
    Array.isArray(draft.texts) ? draft.texts : []
  );
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [resultUrl, setResultUrl] = useState<string>(draft.resultUrl || '');
  // Histórico de versões do vídeo montado (rollback). Cada render/música/marca
  // d'água entra aqui; o usuário pode voltar a uma versão anterior.
  const [resultHistory, setResultHistory] = useState<{ url: string; at: number }[]>(
    Array.isArray(draft.resultHistory) ? draft.resultHistory : []
  );
  const [muted, setMuted] = useState<boolean>(!!draft.muted);
  const [audioUrl, setAudioUrl] = useState<string>(draft.audioUrl || '');
  const [audioDuration, setAudioDuration] = useState<number>(Number(draft.audioDuration) || 0);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [picking, setPicking] = useState<number | null>(null); // atSec aguardando escolha do clipe
  const [pexQuery, setPexQuery] = useState('');
  const [pexResults, setPexResults] = useState<any[]>([]);
  const [pexSearching, setPexSearching] = useState(false);
  // PRÉVIA RÁPIDA: render em baixa resolução (draft) só pra conferir o corte.
  // NÃO vai pra Edição nem vira o vídeo final — abre num player à parte.
  const [previewUrl, setPreviewUrl] = useState('');
  // Qual som (de qual trecho) está sendo escolhido na biblioteca de efeitos.
  const [soundPicker, setSoundPicker] = useState<{
    idx: number;
    field: 'soundIn' | 'soundOut' | 'soundMid';
  } | null>(null);
  // Abre a biblioteca só pra GERENCIAR (enviar/aparar/deletar), sem trecho-alvo.
  const [soundLibManage, setSoundLibManage] = useState(false);
  const { sounds: libSounds } = useSoundLibrary();
  const sfxAudioRef = useRef<HTMLAudioElement | null>(null);
  const playSfx = useCallback((url: string) => {
    if (!sfxAudioRef.current) sfxAudioRef.current = new Audio();
    const a = sfxAudioRef.current;
    a.src = url;
    a.currentTime = 0;
    a.play().catch(() => {});
  }, []);
  // Nome do efeito (biblioteca) a partir da URL — pra mostrar nos badges.
  const soundName = (url?: string) =>
    url ? libSounds.find((s) => s.url === url)?.name || 'efeito' : '';
  const [autoEditing, setAutoEditing] = useState(false);
  // Ritmo do Auto-editar: base de duração dos cortes (s). Menor = MAIS trechos.
  const [cutPace, setCutPace] = useState<number>(10);
  // Moldes de criativo: salvam formato + enquadramento + ritmo pra reaplicar.
  const [templates, setTemplates] = useState<
    { name: string; aspect: string; fit: string; cutPace: number }[]
  >(() => {
    try {
      return JSON.parse(localStorage.getItem('metavise-montagem-templates') || '[]');
    } catch {
      return [];
    }
  });
  // Candidate picker: slots planejados pela IA, cada um com candidatos do Pexels.
  const [autoSlots, setAutoSlots] = useState<AutoSlot[]>([]);
  const [researchingSlot, setResearchingSlot] = useState<number | null>(null);
  // Duração (s) dos "Meus vídeos do projeto", lida do metadata → mostra no canto.
  const [myVidDur, setMyVidDur] = useState<Record<string, number>>({});
  // Qual trecho está com o painel "Meus vídeos" aberto (só mostra ao clicar).
  const [myVidOpen, setMyVidOpen] = useState<Record<number, boolean>>({});
  // "Meus vídeos" aberto no modal de TROCAR.
  const [swapMyVid, setSwapMyVid] = useState(false);
  // Gerar música (arco emocional) e colar embaixo do vídeo montado.
  const [musicGen, setMusicGen] = useState(false);
  // Capa/thumbnail do criativo (Nano Banana redesenha um frame do vídeo).
  // coverUrl = a escolhida; coverOptions = as variações geradas pra escolher.
  const [coverGen, setCoverGen] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string>(draft.coverUrl || '');
  const [coverOptions, setCoverOptions] = useState<string[]>(
    Array.isArray(draft.coverOptions) ? draft.coverOptions : draft.coverUrl ? [draft.coverUrl] : []
  );
  // Texto do gancho a queimar na capa — pré-preenchido com o hook escolhido na
  // Copy (editável; some deixa a capa sem texto). useAtPlayhead força o instante
  // atual em vez da escolha automática (brilho/nitidez/posição).
  const [coverText, setCoverText] = useState<string>(
    draft.coverText || (config.copy as any)?.hookSelecionado || ''
  );
  const [coverUseAtPlayhead, setCoverUseAtPlayhead] = useState(false);
  // Trocar b-roll de um trecho JÁ aplicado na timeline (busca Pexels por item).
  const [brollSwap, setBrollSwap] = useState<{
    itemIdx: number;
    term: string;
    candidates: { url: string; thumb: string }[];
    loading: boolean;
    // 'swap' = troca o b-roll do trecho; 'split' = adiciona 2º b-roll (split).
    mode?: 'swap' | 'split';
  } | null>(null);
  // Player pra ouvir o trecho enquanto escolhe o b-roll.
  const segAudioRef = useRef<HTMLAudioElement | null>(null);
  const playSegment = (start: number, end: number) => {
    if (!audioUrl) return;
    if (!segAudioRef.current) segAudioRef.current = new Audio();
    const a = segAudioRef.current as any;
    if (a.src !== audioUrl) a.src = audioUrl;
    a.currentTime = Math.max(0, start);
    a.play().catch(() => {});
    clearTimeout(a._segTimer);
    a._segTimer = setTimeout(() => a.pause(), Math.max(300, (end - start) * 1000));
  };
  // Formato do vídeo + enquadramento. Padrão: preencher (sem barras pretas).
  const [aspect, setAspect] = useState<'1:1' | '9:16' | '16:9' | '4:5'>(
    (draft.aspect as any) || ((config as any)?.format?.aspectRatio as any) || '1:1'
  );
  const [fit, setFit] = useState<'cover' | 'contain'>((draft.fit as any) || 'cover');
  // Orientação do Pexels segue o FORMATO da montagem. 1:1 busca LANDSCAPE (o
  // Pexels quase não tem quadrado — "woman" tem 8; landscape tem milhares) e o
  // "Preencher" corta as laterais pro quadrado, mantendo a altura/cabeça. 9:16
  // e 4:5 (ambos mais altos que largos) buscam retrato.
  const pexOrient = aspect === '9:16' || aspect === '4:5' ? 'portrait' : 'landscape';
  // Vídeos do PRÓPRIO subprojeto (Vídeo IA, avatar HeyGen, uploads) — pra
  // escolher como b-roll no picker, além do Pexels. Exclui os "Auto N" (Pexels).
  const myProjectVideos = (() => {
    const out: { url: string; label: string; duration?: number }[] = [];
    const seen = new Set<string>();
    const push = (url: any, label: string, duration?: number) => {
      const u = String(url || '');
      if (u && !seen.has(u)) {
        seen.add(u);
        out.push({
          url: u,
          label,
          duration: duration && isFinite(duration) ? duration : undefined,
        });
      }
    };
    // SÓ os teus mesmo: clipes do Vídeo IA (label "IA …") e uploads manuais
    // ("Subir trechos") — NÃO os Pexels (label "Auto N"/"Auto NB", vindos do
    // Auto-editar). Avatar (HeyGen) e ganchos vêm do config.
    clips.forEach((c) => {
      if (!/^Auto \d+B?$/.test(c.label || '')) push(c.url, c.label || 'Vídeo', c.duration);
    });
    (((config as any).videos as any[]) || []).forEach((v, i) => push(v?.url, `Avatar #${i + 1}`));
    (((config.copy as any)?.hookVideos as any[]) || []).forEach((v, i) =>
      push(v?.url, `Gancho #${i + 1}`)
    );
    return out;
  })();
  // Preenche a duração dos "Meus vídeos" que não vêm com ela (ex.: avatar) via
  // um probe dedicado (createElement) — mais confiável que o metadata da
  // miniatura, que às vezes não dispara com muitos vídeos na tela.
  const needDurKey = myProjectVideos
    .filter((mv) => !mv.duration && !myVidDur[mv.url])
    .map((mv) => mv.url)
    .join('|');
  useEffect(() => {
    if (!needDurKey) return;
    needDurKey.split('|').forEach((url) => {
      if (!url) return;
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = () => {
        const d = v.duration;
        if (d && isFinite(d)) setMyVidDur((prev) => (prev[url] ? prev : { ...prev, [url]: d }));
      };
      v.src = url;
    });
  }, [needDurKey]);
  // Vídeo do AVATAR (HeyGen), sincronizado à narração — usado no PiP/split.
  const [avatarBase, setAvatarBase] = useState<string>((draft.avatarUrl as any) || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Início do bloco DENTRO do avatar base (quando a base é a VSL inteira e você
  // monta um bloco do meio): o seek do avatar em cada trecho vira
  // avatarStartSec + atSec → usa só a janela do bloco e mantém o lip-sync.
  const avatarPreviewRef = useRef<HTMLVideoElement | null>(null);
  const [avatarStartSec, setAvatarStartSec] = useState<number>(Number(draft.avatarStartSec) || 0);
  // BLOCOS: fatia a VSL longa em pedaços de ~2 min cujos cortes caem em SILÊNCIOS
  // (respiros entre frases). Cada bloco é montado separado (áudio cortado + avatar
  // no offset certo); no fim junta tudo. fullAudioUrl = a voz inteira original.
  const [fullAudioUrl, setFullAudioUrl] = useState<string>((draft.fullAudioUrl as any) || '');
  const [blockSizeSec, setBlockSizeSec] = useState<number>(Number(draft.blockSizeSec) || 120);
  const [blockEnds, setBlockEnds] = useState<number[]>(
    Array.isArray(draft.blockEnds) ? draft.blockEnds : []
  );
  const [fatiando, setFatiando] = useState(false);
  const [activeBlock, setActiveBlock] = useState<number>(
    Number.isFinite(draft.activeBlock) ? Number(draft.activeBlock) : 0
  );
  // Workflows por bloco/cena: cada um guarda sua própria montagem (clips,
  // trechos, resultado, avatar, áudio). Trocar de bloco salva o atual e carrega
  // o outro — sem perder trabalho. VSL: blocos = fatias do áudio. Creativo: cenas.
  const [blockDrafts, setBlockDrafts] = useState<Record<number, BlockWorkflow>>(
    draft.blockDrafts && typeof draft.blockDrafts === 'object' ? draft.blockDrafts : {}
  );
  const [blockCount, setBlockCount] = useState<number>(Math.max(1, Number(draft.blockCount) || 1));
  // Ordem escolhida pra juntar as cenas/blocos já montados num vídeo só.
  // null = ordem numérica padrão (1,2,3...); só passa a valer quando o
  // usuário reordena manualmente com as setas.
  const [joinOrderOverride, setJoinOrderOverride] = useState<number[] | null>(null);
  const [joiningScenes, setJoiningScenes] = useState(false);
  // URL do último vídeo juntado — mostrado num player aqui mesmo na
  // Montagem, além de ir pra Edição. Persiste no draft (config.montagem)
  // pra sobreviver à troca de aba.
  const [joinedResultUrl, setJoinedResultUrl] = useState<string>(draft.joinedResultUrl || '');
  const fmtT = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // Fatia a VSL em blocos ~blockSizeSec, encaixando cada fim no SILÊNCIO mais
  // próximo (via /api/video/silences).
  const fatiarEmBlocos = async () => {
    if (!audioUrl) {
      toast.error(mt.toasts.loadVslVoiceFirst);
      return;
    }
    setFatiando(true);
    const tid = 'fatiar';
    toast.loading(mt.toasts.findingSilences, { id: tid });
    try {
      const r = await fetch('/api/video/silences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || mt.toasts.silenceDetectFailed);
      const dur = Number(d.duration) || audioDuration || 0;
      if (dur <= 0) throw new Error(mt.toasts.cantReadAudioDuration);
      const mids: number[] = (d.silences || []).map((s: any) => (s.start + s.end) / 2);
      const ends: number[] = [];
      let start = 0;
      let guard = 0;
      while (start < dur - 1 && guard++ < 200) {
        const target = start + blockSizeSec;
        if (target >= dur - Math.min(20, blockSizeSec * 0.3)) {
          ends.push(dur);
          break;
        }
        const near = mids
          .filter((m) => m > start + blockSizeSec * 0.4 && m < dur - 1)
          .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
        const end = near != null && Math.abs(near - target) < blockSizeSec * 0.5 ? near : target;
        ends.push(Math.min(Math.round(end * 10) / 10, dur));
        start = end;
      }
      setFullAudioUrl(audioUrl);
      setBlockEnds(ends);
      setActiveBlock(-1);
      setBlockDrafts({}); // refatiar realinha tudo — zera os workflows por bloco
      setBlockCount(ends.length);
      toast.success(mt.toasts.blocksCreated(ends.length), { id: tid });
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.sliceFailed, { id: tid });
    } finally {
      setFatiando(false);
    }
  };
  // Snapshot do workflow ao vivo (campos específicos da montagem do bloco ativo).
  const currentWorkflow = (): BlockWorkflow => ({
    clips,
    items,
    texts,
    resultUrl,
    resultHistory,
    coverUrl,
    coverOptions,
    coverText,
    muted,
    audioUrl,
    audioDuration,
    avatarUrl: avatarBase,
    avatarStartSec,
  });
  // Carrega um workflow salvo nos campos ao vivo (ou limpa tudo, se vazio).
  const applyWorkflow = (wf: BlockWorkflow | undefined) => {
    const w = wf || {};
    setClips(Array.isArray(w.clips) ? w.clips : []);
    setItems(migrateZoomItems(Array.isArray(w.items) ? w.items : []));
    setTexts(Array.isArray(w.texts) ? w.texts : []);
    setResultUrl(w.resultUrl || '');
    setResultHistory(Array.isArray(w.resultHistory) ? w.resultHistory : []);
    setCoverUrl(w.coverUrl || '');
    setCoverOptions(
      Array.isArray(w.coverOptions) ? w.coverOptions : w.coverUrl ? [w.coverUrl] : []
    );
    setCoverText(w.coverText || (config.copy as any)?.hookSelecionado || '');
    setMuted(!!w.muted);
    setAudioUrl(w.audioUrl || '');
    setAudioDuration(Number(w.audioDuration) || 0);
    setAvatarBase(w.avatarUrl || '');
    setAvatarStartSec(Number(w.avatarStartSec) || 0);
  };
  const blockHasWork = (wf: BlockWorkflow | undefined) =>
    !!wf && ((Array.isArray(wf.clips) && wf.clips.length > 0) || !!wf.resultUrl || !!wf.audioUrl);
  // Troca de cena preservando o workflow (Creativo): salva o atual e carrega o
  // alvo. Sem preparo de áudio.
  const selectBlock = (idx: number) => {
    if (idx === activeBlock) return;
    const from = Math.max(0, activeBlock);
    const cur = currentWorkflow();
    setBlockDrafts((prev) => ({ ...prev, [from]: cur }));
    // Cena NOVA (sem workflow salvo) carrega o MESMO avatar base da atual — sem
    // isto o avatar sumia (virava '') ao criar uma cena, e reescolher errado na
    // hora dava vídeo/lip-sync trocado. Cena já existente respeita o que tem
    // salvo (pode legitimamente não ter avatar).
    applyWorkflow(blockDrafts[idx] || { avatarUrl: avatarBase });
    setActiveBlock(idx);
  };
  // Troca pro bloco da VSL preservando o workflow. Se o bloco já tem montagem
  // salva, restaura. Se é novo, corta o áudio [start,end] e começa limpo.
  const trabalharNoBloco = async (idx: number) => {
    if (idx === activeBlock) return;
    const start = idx === 0 ? 0 : blockEnds[idx - 1]!;
    const end = blockEnds[idx]!;
    const src = fullAudioUrl || audioUrl;
    if (end <= start) return;
    const from = Math.max(0, activeBlock);
    const cur = currentWorkflow();
    const saved = blockDrafts[idx];
    // Bloco já montado → só restaura (mantém áudio/clips/trechos salvos).
    if (blockHasWork(saved)) {
      if (activeBlock >= 0) setBlockDrafts((prev) => ({ ...prev, [from]: cur }));
      applyWorkflow(saved);
      setActiveBlock(idx);
      toast.success(mt.toasts.blockRestored(idx + 1));
      return;
    }
    // Bloco novo → corta o áudio e começa limpo.
    if (!src) return;
    const tid = 'bloco';
    toast.loading(mt.toasts.preparingBlock(idx + 1), { id: tid });
    try {
      const r = await fetch('/api/elevenlabs/trim-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: src, start, end, userId: uid }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || mt.toasts.blockAudioCutFailed);
      if (activeBlock >= 0) setBlockDrafts((prev) => ({ ...prev, [from]: cur }));
      // Bloco NOVO carrega o MESMO avatar base do bloco atual — é o mesmo
      // avatar longo fatiado, só muda o offset (avatarStartSec abaixo). Sem
      // isto o avatar base zerava a cada bloco novo (bug: causava lip-sync
      // errado quando o usuário reescolhia o vídeo errado pra repor).
      applyWorkflow({ avatarUrl: avatarBase });
      setAudioUrl(d.url);
      setAudioDuration(end - start);
      setAvatarStartSec(start); // avatar alinhado ao início do bloco no vídeo de 19 min
      setActiveBlock(idx);
      toast.success(mt.toasts.blockReady(idx + 1, fmtT(start), fmtT(end)), { id: tid });
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.blockPrepFailed, { id: tid });
    }
  };
  // Enquadramento do avatar por URL (calibrado 1× e reaproveitado em TODOS os
  // trechos daquele avatar): faixa do split (splitFocusX) e círculo do PiP
  // (pipCX, pipCY, pipSize). Sem calibração → defaults (centro / topo-centro).
  const [avatarFraming, setAvatarFraming] = useState<Record<string, AvatarFraming>>(() =>
    draft.avatarFraming && typeof draft.avatarFraming === 'object' ? draft.avatarFraming : {}
  );
  const [framingModalOpen, setFramingModalOpen] = useState(false);
  // Enquadramento POR TRECHO (opcional): idx do item sendo editado, ou null.
  // Sobrepõe o enquadramento global só para esse trecho (it.frameOverride).
  const [perTrechoFraming, setPerTrechoFraming] = useState<number | null>(null);
  const framing: AvatarFraming =
    (avatarBase && avatarFraming[avatarBase]) || DEFAULT_AVATAR_FRAMING;
  // Avatares JÁ GERADOS neste subprojeto (VSL + corpo) — pra usar de base sem
  // precisar reupload. Cada um: {url, aspectRatio, createdAt}.
  // Cada opção ganha o MESMO nome da aba Avatar ("Vídeo N", cronológico por grupo)
  // + o bloco de voz usado (blockLabel), quando gravado na geração.
  const avatarVideoOptions = [
    ...(((config as any)?.copyVsl?.avatarVideos as any[]) || []).map((v, i) => ({
      ...v,
      from: 'VSL',
      name: `Vídeo ${i + 1}`,
    })),
    ...(((config as any)?.videos as any[]) || []).map((v, i) => ({
      ...v,
      from: 'Corpo',
      name: `Vídeo ${i + 1}`,
    })),
  ].filter((v) => v?.url);
  const avatarVideoOptionsForMode =
    montagemMode === 'vsl'
      ? avatarVideoOptions.filter((v) => v.from === 'VSL')
      : avatarVideoOptions.filter((v) => v.from !== 'VSL');
  // Probe de duração das opções de avatar (reusa myVidDur).
  const needAvatarDurKey = avatarVideoOptions
    .filter((v) => !v.duration && !myVidDur[v.url])
    .map((v) => v.url)
    .join('|');
  useEffect(() => {
    if (!needAvatarDurKey) return;
    needAvatarDurKey.split('|').forEach((url) => {
      if (!url) return;
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      el.onloadedmetadata = () => {
        const d = el.duration;
        if (d && isFinite(d)) setMyVidDur((prev) => (prev[url] ? prev : { ...prev, [url]: d }));
      };
      el.src = url;
    });
  }, [needAvatarDurKey]);

  const uid = user?.uid || auth.currentUser?.uid;
  // Vozes já geradas no subprojeto (etapa Voz): corpo, gancho e VSL. Cada uma
  // vira uma opção de trilha base pra montar por cima.
  // Blocos da VSL já gerados (config.copyVsl.blockAudios) — cada um vira uma
  // voz-base própria, pra você montar UM bloco de cada vez (fluxo por bloco).
  const vslBlockAudios = ((vslCfg.blockAudios as any[]) || [])
    .map((b, i) =>
      b?.url && b?.status === 'done'
        ? { key: `vslbloco${i}`, label: `VSL — Bloco ${i + 1}`, url: b.url as string }
        : null
    )
    .filter(Boolean) as { key: string; label: string; url: string }[];
  // Mesma ideia dos blocos da VSL, mas pro roteiro do corpo (criativo normal)
  // — sem isso, só dava pra usar o áudio "ativo" (o último marcado como uso
  // na aba Voz), e não tinha como escolher um bloco específico aqui.
  const bodyBlockAudios = (((config?.copy as any)?.blockAudios as any[]) || [])
    .map((b, i) =>
      b?.url && b?.status === 'done'
        ? { key: `bloco${i}`, label: `Bloco ${i + 1}`, url: b.url as string }
        : null
    )
    .filter(Boolean) as { key: string; label: string; url: string }[];
  const vozOptions = [
    { key: 'corpo', label: 'Voz do Corpo', url: (config?.audioUrl as string) || '' },
    ...bodyBlockAudios,
    {
      key: 'gancho',
      label: 'Voz do Gancho',
      url: ((config?.copy as any)?.hookAudioUrl as string) || '',
    },
    {
      key: 'vsl',
      label: 'Voz da VSL (juntada)',
      url: ((config as any)?.copyVsl?.audioUrl as string) || '',
    },
    ...vslBlockAudios,
    // Áudios JUNTADOS na Edição (gancho + corpo etc.) — voiceId 'joined'.
    ...(((config as any)?.audios as any[]) || [])
      .filter((a) => a?.voiceId === 'joined' && a?.url)
      .map((a, i) => ({
        key: `joined-${i}`,
        label: `Áudio juntado #${i + 1}`,
        url: a.url as string,
      })),
  ].filter((o) => !!o.url);
  const vozOptionsForMode =
    montagemMode === 'vsl'
      ? vozOptions.filter((o) => o.key.startsWith('vsl'))
      : vozOptions.filter((o) => !o.key.startsWith('vsl'));
  const isTimeline = !!audioUrl;
  // Double-buffer: dois <video> (A/B). Mantém o atual visível até o próximo
  // carregar → sem tela preta entre trechos colados.
  const vARef = useRef<HTMLVideoElement | null>(null);
  const vBRef = useRef<HTMLVideoElement | null>(null);
  const aFrontRef = useRef<boolean>(true);
  const rafRef = useRef<number>(0);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeIdxRef = useRef<number>(-1);
  const exitDoneRef = useRef<number>(-1);
  const playingRef = useRef<boolean>(false);
  const hydratingDraftRef = useRef(false);

  const frontEl = () => (aFrontRef.current ? vARef.current : vBRef.current);
  const backEl = () => (aFrontRef.current ? vBRef.current : vARef.current);

  const goFullscreen = () => {
    const d = document as any;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
      return;
    }
    const el = previewWrapRef.current as any;
    if (!el) return;
    (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen)?.call(el);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seekAudio = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * audioDuration;
    syncPreview(a.currentTime, true);
  };

  useEffect(() => {
    if (!hasVslWorkflow && montagemMode === 'vsl') setMontagemMode('creative');
  }, [hasVslWorkflow, montagemMode]);

  useEffect(() => {
    hydratingDraftRef.current = true;
    const modeDraft = getMontagemDraft(config, montagemMode);
    const bd =
      modeDraft.blockDrafts && typeof modeDraft.blockDrafts === 'object'
        ? modeDraft.blockDrafts
        : {};
    // -1 só quando persistido (VSL fatiada sem bloco preparado). Sem valor → 0.
    const ai = Number.isFinite(modeDraft.activeBlock) ? Number(modeDraft.activeBlock) : 0;
    // Campos do workflow vêm do bloco ativo salvo; se não houver, do draft "flat"
    // (compat com montagens antigas de bloco único).
    const wf: BlockWorkflow = ai >= 0 && bd[ai] ? bd[ai] : modeDraft;
    setClips(Array.isArray(wf.clips) ? wf.clips : []);
    setItems(migrateZoomItems(Array.isArray(wf.items) ? wf.items : []));
    setTexts(Array.isArray(wf.texts) ? wf.texts : []);
    setResultUrl(wf.resultUrl || '');
    setResultHistory(Array.isArray(wf.resultHistory) ? wf.resultHistory : []);
    setMuted(!!wf.muted);
    setAudioUrl(wf.audioUrl || '');
    setAudioDuration(Number(wf.audioDuration) || 0);
    setCoverUrl(wf.coverUrl || '');
    setCoverOptions(
      Array.isArray(wf.coverOptions) ? wf.coverOptions : wf.coverUrl ? [wf.coverUrl] : []
    );
    setCoverText(wf.coverText || (config.copy as any)?.hookSelecionado || '');
    setAvatarBase((wf.avatarUrl as any) || '');
    setAvatarStartSec(Number(wf.avatarStartSec) || 0);
    // Compartilhados entre blocos (formato, enquadramento, fatiamento).
    setAspect((modeDraft.aspect as any) || ((config as any)?.format?.aspectRatio as any) || '1:1');
    setFit((modeDraft.fit as any) || 'cover');
    setAvatarFraming(
      modeDraft.avatarFraming && typeof modeDraft.avatarFraming === 'object'
        ? modeDraft.avatarFraming
        : {}
    );
    setFullAudioUrl((modeDraft.fullAudioUrl as any) || '');
    setBlockSizeSec(Number(modeDraft.blockSizeSec) || 120);
    setBlockEnds(Array.isArray(modeDraft.blockEnds) ? modeDraft.blockEnds : []);
    setBlockDrafts(bd);
    setBlockCount(Math.max(1, Number(modeDraft.blockCount) || 1));
    setJoinedResultUrl((modeDraft.joinedResultUrl as any) || '');
    setPreviewUrl('');
    setPexQuery('');
    setPexResults([]);
    setPicking(null);
    setAutoSlots([]);
    setBrollSwap(null);
    setActiveBlock(ai);
    const release = window.setTimeout(() => {
      hydratingDraftRef.current = false;
    }, 0);
    return () => window.clearTimeout(release);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montagemMode]);

  useEffect(() => {
    if (hydratingDraftRef.current) return;
    if (
      clips.length === 0 &&
      !resultUrl &&
      !audioUrl &&
      Object.keys(blockDrafts).length === 0 &&
      blockCount <= 1
    )
      return;
    // Bloco ativo (>=0) grava seu workflow no mapa; assim o draft carrega TODOS
    // os blocos, não só o que está aberto.
    const mergedBlockDrafts =
      activeBlock >= 0 ? { ...blockDrafts, [activeBlock]: currentWorkflow() } : blockDrafts;
    const nextDraft = {
      // "flat" = bloco ativo (compat com EditZap / montagens antigas)
      clips,
      items,
      texts,
      resultUrl,
      resultHistory,
      coverUrl,
      coverOptions,
      coverText,
      muted,
      audioUrl,
      audioDuration,
      avatarUrl: avatarBase,
      avatarStartSec,
      // compartilhados
      aspect,
      fit,
      avatarFraming,
      fullAudioUrl,
      blockSizeSec,
      blockEnds,
      // por bloco/cena
      blockDrafts: mergedBlockDrafts,
      blockCount,
      activeBlock,
      joinedResultUrl,
    };
    setConfig((prev: any) => ({
      ...prev,
      ...(montagemMode === 'vsl' ? { montagemVsl: nextDraft } : { montagem: nextDraft }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    montagemMode,
    clips,
    items,
    texts,
    resultUrl,
    resultHistory,
    coverUrl,
    coverOptions,
    coverText,
    muted,
    audioUrl,
    audioDuration,
    aspect,
    fit,
    avatarBase,
    avatarFraming,
    avatarStartSec,
    fullAudioUrl,
    blockSizeSec,
    blockEnds,
    blockDrafts,
    blockCount,
    activeBlock,
    joinedResultUrl,
  ]);

  // Toda vez que sai um vídeo montado novo, guarda no histórico (dedup, últimos 10).
  useEffect(() => {
    if (!resultUrl) return;
    setResultHistory((prev) => {
      if (prev[0]?.url === resultUrl) return prev;
      const without = prev.filter((v) => v.url !== resultUrl);
      return [{ url: resultUrl, at: Date.now() }, ...without].slice(0, 10);
    });
  }, [resultUrl]);

  // Preenche a duração de trechos que ainda não têm (1 por vez, sem travar).
  useEffect(() => {
    const i = clips.findIndex((c) => !c.duration && c.url);
    if (i === -1) return;
    let cancelled = false;
    (async () => {
      const d = await readDurationFromUrl(clips[i]!.url);
      if (cancelled || !d) return;
      setClips((prev) => prev.map((c, k) => (k === i && !c.duration ? { ...c, duration: d } : c)));
    })();
    return () => {
      cancelled = true;
    };
  }, [clips]);

  // ── Preview: o áudio dirige o tempo; a tela mostra o item ativo (buraco=preto).
  // O clipe TOCA naturalmente (suave); só troco/seek quando o item muda OU quando
  // o usuário arrasta o áudio (force). Sem seek por timeupdate (era o que travava).
  const syncPreview = (t: number, force = false) => {
    setPlayhead(t);
    let active = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (t >= it.atSec && t < itemEnd(it)) {
        active = i;
        break;
      }
    }
    if (active === -1) {
      if (activeIdxRef.current !== -1) {
        activeIdxRef.current = -1;
        [vARef.current, vBRef.current].forEach((v) => {
          if (v) {
            v.pause();
            v.style.opacity = '0';
          }
        });
      }
      return;
    }
    const it = items[active]!;
    const src = clips[it.clipIdx]?.url;
    if (!src) return;
    const desired = t - it.atSec;

    // SAÍDA: anima o trecho atual saindo perto do fim (uma vez).
    const tOut = it.transOut || 'none';
    const dOut = Math.max(0.05, it.transOutDur || 0.1);
    if (tOut !== 'none' && t > itemEnd(it) - dOut && exitDoneRef.current !== active) {
      exitDoneRef.current = active;
      const fe = frontEl();
      if (fe) {
        fe.style.zIndex = '3';
        fe.style.transition = `opacity ${dOut}s ease, transform ${dOut}s ease`;
        if (tOut === 'fade' || tOut === 'dissolve') fe.style.opacity = '0';
        else if (tOut === 'slideleft') fe.style.transform = 'translateX(-100%)';
        else if (tOut === 'slideright') fe.style.transform = 'translateX(100%)';
        else if (tOut === 'slideup') fe.style.transform = 'translateY(-100%)';
        else if (tOut === 'slidedown') fe.style.transform = 'translateY(100%)';
      }
    }

    // Pré-carrega o PRÓXIMO trecho no buffer de trás (mata o gap de load).
    {
      let nextSrc: string | undefined;
      let nextStart = Infinity;
      for (const it2 of items) {
        const s2 = clips[it2.clipIdx]?.url;
        if (s2 && it2.atSec > t && it2.atSec < nextStart) {
          nextStart = it2.atSec;
          nextSrc = s2;
        }
      }
      if (nextSrc && nextStart - t < 1.5) {
        const bb = backEl();
        if (bb && bb.getAttribute('src') !== nextSrc) {
          bb.style.opacity = '0';
          bb.src = nextSrc;
        }
      }
    }

    if (activeIdxRef.current !== active) {
      activeIdxRef.current = active;
      const b = backEl();
      const f = frontEl();
      if (!b) return;
      const trans = it.transIn || 'none';
      const d = Math.max(0.05, it.transInDur || 0.1);
      const applySwap = () => {
        try {
          b.currentTime = desired;
        } catch {
          /* ignore */
        }
        if (playingRef.current) b.play().catch(() => {});
        b.style.zIndex = '2';
        if (f) f.style.zIndex = '1';
        b.style.transition = 'none';
        if (trans === 'slideleft') {
          b.style.transform = 'translateX(100%)';
          b.style.opacity = '1';
        } else if (trans === 'slideright') {
          b.style.transform = 'translateX(-100%)';
          b.style.opacity = '1';
        } else if (trans === 'slideup') {
          b.style.transform = 'translateY(100%)';
          b.style.opacity = '1';
        } else if (trans === 'slidedown') {
          b.style.transform = 'translateY(-100%)';
          b.style.opacity = '1';
        } else if (trans === 'none') {
          b.style.transform = 'none';
          b.style.opacity = '1';
        } else {
          b.style.transform = 'none';
          b.style.opacity = '0';
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            b.style.transition = `opacity ${d}s ease, transform ${d}s ease`;
            b.style.opacity = '1';
            b.style.transform = 'none';
          })
        );
        const fEl = f;
        window.setTimeout(
          () => {
            if (fEl) {
              fEl.style.opacity = '0';
              fEl.pause();
            }
          },
          trans === 'none' ? 0 : d * 1000
        );
        aFrontRef.current = !aFrontRef.current;
      };
      // Se o próximo já foi pré-carregado nesse <video>, troca na hora; senão espera carregar.
      if (b.getAttribute('src') === src && b.readyState >= 2) {
        applySwap();
      } else {
        b.src = src;
        b.onloadeddata = applySwap;
      }
    } else if (force) {
      const f = frontEl();
      if (f) {
        try {
          f.currentTime = desired;
        } catch {
          /* ignore */
        }
      }
    }
  };

  // Loop suave no play (troca no ms certo, não só a cada timeupdate ~4Hz).
  const startRaf = () => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const a = audioRef.current;
      if (a && !a.paused) {
        syncPreview(a.currentTime);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const stopRaf = () => cancelAnimationFrame(rafRef.current);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const onUpload = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    if (!uid) return toast.error(mt.common.loginToUpload);
    setUploading(true);
    const toastId = 'montagem-upload';
    toast.loading(mt.toasts.uploadingClips(files.length), { id: toastId });
    try {
      const added: Clip[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('video/')) continue;
        const duration = await readDurationFromFile(file);
        const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
        const r = ref(storage, `video/${uid}/montagem/${Date.now()}-${safe}`);
        await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
        const url = await getDownloadURL(r);
        added.push({ url, label: file.name.replace(/\.[^.]+$/, ''), duration });
      }
      if (added.length) {
        setClips((prev) => [...prev, ...added]);
        toast.success(mt.toasts.clipsInLibrary(added.length), { id: toastId });
      } else toast.error(mt.toasts.noValidVideo, { id: toastId });
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.uploadFailed, { id: toastId });
    } finally {
      setUploading(false);
    }
  };
  const { dragging: dragUpload, dropHandlers: uploadDrop } = useFileDrop((files) =>
    onUpload(files)
  );

  const onUploadAudio = async (file?: File | null) => {
    if (!file) return;
    if (!uid) return toast.error(mt.common.login);
    setUploadingAudio(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `audio/${uid}/montagem/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'audio/mpeg' });
      const url = await getDownloadURL(r);
      setAudioUrl(url);
      toast.success(mt.toasts.audioLoaded);
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.audioUploadFailed);
    } finally {
      setUploadingAudio(false);
    }
  };

  // Sobe o vídeo do AVATAR (HeyGen) que serve de base pro PiP/split. Deve estar
  // sincronizado à MESMA narração (o render busca o avatar no tempo do trecho).
  const onUploadAvatar = async (file?: File | null) => {
    if (!file) return;
    if (!uid) return toast.error(mt.common.login);
    setUploadingAvatar(true);
    try {
      const safe = file.name.replace(/[^a-z0-9.-]/gi, '_');
      const r = ref(storage, `video/${uid}/montagem-avatar/${Date.now()}-${safe}`);
      await uploadBytes(r, file, { contentType: file.type || 'video/mp4' });
      const url = await getDownloadURL(r);
      setAvatarBase(url);
      toast.success(mt.toasts.avatarLoaded);
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.avatarUploadFailed);
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Busca no Pexels e adiciona o clipe escolhido à BIBLIOTECA (pool), pra você
  // posicionar na timeline igual aos seus trechos.
  const doPexSearch = async () => {
    const q = pexQuery.trim();
    if (!q) return;
    setPexSearching(true);
    try {
      const params = new URLSearchParams({ query: q, orientation: pexOrient, perPage: '12' });
      const r = await fetch(`/api/pexels/search?${params.toString()}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || mt.common.searchFailed);
      setPexResults(Array.isArray(data.clips) ? data.clips : []);
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.pexelsError);
    } finally {
      setPexSearching(false);
    }
  };
  const addPexClip = (clip: any) => {
    setClips((prev) => [
      ...prev,
      {
        url: clip.url,
        label: `Pexels ${prev.length + 1}`,
        duration: Number(clip.duration) || undefined,
      },
    ]);
    toast.success(mt.toasts.brollAdded);
  };

  // "Adicionar aqui": marca o segundo do playhead e pede pra escolher o clipe.
  const addHere = () => {
    if (clips.length === 0) return toast.error(mt.toasts.uploadClipsFirst);
    setPicking(Number(playhead.toFixed(2)));
  };
  const pickClip = async (clipIdx: number) => {
    if (picking == null) return;
    const at = picking;
    setPicking(null);
    let dur = clips[clipIdx]?.duration || 0;
    if (!dur) {
      const url = clips[clipIdx]?.url;
      dur = (url ? await readDurationFromUrl(url) : 0) || 5;
      // guarda no clipe pra próxima vez
      if (clips[clipIdx])
        setClips((prev) => prev.map((c, k) => (k === clipIdx ? { ...c, duration: dur } : c)));
    }
    pushHistory(items);
    setItems((prev) => [...prev, { clipIdx, atSec: at, endSec: Number((at + dur).toFixed(2)) }]);
  };
  const updateItem = (idx: number, key: 'atSec' | 'endSec', val: string) => {
    pushHistory(items);
    setItems((prev) =>
      prev.map((it, k) => {
        if (k !== idx) return it;
        const n = Math.max(0, Number(val) || 0);
        if (key === 'atSec') {
          // mover o início mantém a duração: o fim acompanha.
          const dur = itemEnd(it) - it.atSec;
          return { ...it, atSec: n, endSec: Number((n + dur).toFixed(2)) };
        }
        return { ...it, endSec: n };
      })
    );
  };
  // RIPPLE DELETE: apaga o trecho e desliza pra trás tudo que começa depois
  // dele, fechando o buraco automaticamente. Antes ficava um vazio (tela
  // preta, ver "Timeline vazia" acima) até o usuário reposicionar cada
  // trecho seguinte na mão — igual editor de vídeo de verdade faz.
  const removeItem = (idx: number) => {
    pushHistory(items);
    setItems((prev) => {
      const target = prev[idx];
      const remaining = prev.filter((_, k) => k !== idx);
      if (!target) return remaining;
      // Vizinhos NO TEMPO (o trecho apagado leva junto efeitos/som/transições).
      const before = remaining
        .filter((it) => it.atSec <= target.atSec)
        .sort((a, b) => b.atSec - a.atSec)[0];
      const after = remaining
        .filter((it) => it.atSec >= target.atSec)
        .sort((a, b) => a.atSec - b.atSec)[0];
      let relinked = remaining;
      if (before && after && before !== after) {
        // Re-linka: a SAÍDA do anterior casa com a ENTRADA do próximo (transição
        // linkável + whoosh), pra conectar smooth sem sobra da transição apagada.
        const LINKABLE = new Set([
          'slideleft',
          'slideright',
          'slideup',
          'slidedown',
          'dissolve',
          'whip',
        ]);
        const whoosh = soundForTransition('slideleft');
        const link = LINKABLE.has(after.transIn || '') ? after.transIn! : 'dissolve';
        relinked = remaining.map((it) => {
          if (it === before)
            return { ...it, transOut: link, transOutDur: it.transOutDur || 0.15, soundOut: whoosh };
          if (it === after) return { ...it, transIn: link, transInDur: it.transInDur || 0.15 };
          return it;
        });
      }
      const targetEnd = itemEnd(target);
      const gap = targetEnd - target.atSec;
      if (gap <= 0) return relinked;
      return relinked.map((it) => {
        // Tolerância de 1ms pra arredondamento de float não deixar de fora
        // um trecho que colava exatamente na borda do apagado.
        if (it.atSec < targetEnd - 0.001) return it;
        return {
          ...it,
          atSec: Number((it.atSec - gap).toFixed(2)),
          endSec: it.endSec !== undefined ? Number((it.endSec - gap).toFixed(2)) : it.endSec,
        };
      });
    });
  };
  const setItemField = (idx: number, patch: Partial<TLItem>) => {
    pushHistory(items);
    setItems((prev) => prev.map((it, k) => (k === idx ? { ...it, ...patch } : it)));
  };

  // Desfazer / refazer da timeline: pilha de snapshots dos trechos. Protege o
  // usuário de apagar/limpar/mesclar por engano (Ctrl+Z / Ctrl+Shift+Z também).
  const historyRef = useRef<{ past: TLItem[][]; future: TLItem[][] }>({ past: [], future: [] });
  // Comprimentos espelhados em state (não o ref direto) — os botões de
  // desfazer/refazer leem daqui, nunca de historyRef.current no render.
  const [histLens, setHistLens] = useState({ past: 0, future: 0 });
  const pushHistory = (snap: TLItem[]) => {
    const h = historyRef.current;
    h.past.push(snap);
    if (h.past.length > 60) h.past.shift();
    h.future = [];
    setHistLens({ past: h.past.length, future: h.future.length });
  };
  const undo = () => {
    const h = historyRef.current;
    if (!h.past.length) return;
    setItems((cur) => {
      const prev = h.past.pop()!;
      h.future.push(cur);
      return prev;
    });
    setHistLens({ past: h.past.length, future: h.future.length });
  };
  const redo = () => {
    const h = historyRef.current;
    if (!h.future.length) return;
    setItems((cur) => {
      const nxt = h.future.pop()!;
      h.past.push(cur);
      return nxt;
    });
    setHistLens({ past: h.past.length, future: h.future.length });
  };

  // Arrastar um trecho na horizontal pra reposicionar no tempo (mantém a duração).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [snap, setSnap] = useState(true); // "imã": gruda na borda do vizinho / grade
  const [zoom, setZoom] = useState(1); // precisão do arraste (zoom in = mais fino)
  const onDragStart = (idx: number, e: React.PointerEvent) => {
    e.preventDefault();
    pushHistory(items);
    const startX = e.clientX;
    const startAt = items[idx]?.atSec ?? 0;
    const SENS = 0.04 / zoom; // segundos por pixel; zoom maior = arraste mais fino
    // Bordas dos OUTROS trechos (início e fim) — pra o snap grudar nelas.
    const edges = items
      .filter((_, k) => k !== idx)
      .flatMap((it) => [Number(it.atSec.toFixed(2)), Number(itemEnd(it).toFixed(2))]);
    const move = (ev: PointerEvent) => {
      let newAt = Math.max(0, startAt + (ev.clientX - startX) * SENS);
      if (snap) {
        const near = edges.find((edge) => Math.abs(edge - newAt) < 0.3);
        newAt = near != null ? near : Math.round(newAt * 4) / 4; // grade de 0,25s
      }
      newAt = Number(newAt.toFixed(2));
      setItems((prev) =>
        prev.map((it, k) => {
          if (k !== idx) return it;
          const dur = itemEnd(it) - it.atSec;
          return { ...it, atSec: newAt, endSec: Number((newAt + dur).toFixed(2)) };
        })
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragIdx(null);
    };
    setDragIdx(idx);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Atalhos: Ctrl/Cmd+Z desfaz, Ctrl/Cmd+Shift+Z (ou Ctrl+Y) refaz.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Texto cinético na tela.
  const addText = () =>
    setTexts((prev) => [
      ...prev,
      {
        text: 'PALAVRA',
        atSec: Number(playhead.toFixed(2)),
        endSec: Number((playhead + 1.5).toFixed(2)),
        color: '#39FF14',
        pos: 'middle',
      },
    ]);
  const updateText = (i: number, patch: Partial<TextItem>) =>
    setTexts((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const removeText = (i: number) => setTexts((prev) => prev.filter((_, k) => k !== i));

  // ── AUTO-EDITAR ───────────────────────────────────────────────────────────
  // Transcreve a voz base → fatia em slots pelo RITMO da VSL de referência →
  // busca 1 b-roll no Pexels por trecho (palavra-chave) → aplica transições +
  // SFX + alguns textos. Preenche a timeline pra você revisar e trocar o que
  // quiser (o b-roll exato de cada trecho fica fácil de trocar depois).
  const STOPWORDS = new Set(
    'the a an and or but of to in on for with is are was were it that this you your i we they he she a o os as e ou que com para um uma do da no na se em por como mais mas se sua seu meu minha isso este esta'.split(
      ' '
    )
  );
  // Acha o TEMPO (s) em que uma frase começa a ser dita, casando as palavras da
  // frase com as palavras transcritas do trecho. Retorna null se não achar.
  const phraseStartSec = (
    words: { text: string; start: number; end: number }[],
    phrase: string
  ): number | null => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '');
    const pw = phrase.split(/\s+/).map(norm).filter(Boolean);
    if (!pw.length) return null;
    const ww = words.map((w) => norm(w.text));
    // 1) match EXATO da frase inteira (ideal).
    for (let i = 0; i + pw.length <= ww.length; i++) {
      let ok = true;
      for (let j = 0; j < pw.length; j++)
        if (ww[i + j] !== pw[j]) {
          ok = false;
          break;
        }
      if (ok) return words[i]!.start / 1000;
    }
    // 2) melhor casamento PARCIAL: a posição onde MAIS palavras da frase batem
    //    em sequência — pega o início dessa sequência (robusto a 1-2 palavras
    //    diferentes por paráfrase/pontuação).
    let bestStart = -1;
    let bestRun = 0;
    for (let i = 0; i < ww.length; i++) {
      let run = 0;
      for (let j = 0; j < pw.length && i + j < ww.length; j++) {
        if (ww[i + j] === pw[j]) run++;
      }
      if (run > bestRun) {
        bestRun = run;
        bestStart = i;
      }
    }
    if (bestRun >= 1 && bestStart >= 0) return words[bestStart]!.start / 1000;
    // 3) fallback: 1ª palavra "forte" da frase em qualquer lugar.
    for (const p of pw) {
      const idx = ww.findIndex((w) => w === p);
      if (idx >= 0) return words[idx]!.start / 1000;
    }
    return null;
  };
  const autoEdit = async () => {
    if (!audioUrl) {
      toast.error(mt.toasts.chooseVslVoiceFirst);
      return;
    }
    setAutoEditing(true);
    const tid = 'auto-edit';
    toast.loading(mt.toasts.transcribing, { id: tid });
    try {
      const tr = await fetch('/api/video/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl }),
      });
      const td = await tr.json();
      if (!tr.ok) throw new Error(td.error || mt.toasts.transcribeFailed);
      const words: { text: string; start: number; end: number }[] = td.words || [];
      if (words.length === 0) throw new Error(mt.toasts.transcribeNoWords);

      // Ritmo escolhido pelo usuário (base dos cortes, em s). Menor = mais trechos.
      // Menos ~12-15s · Médio ~9-11s · Mais ~6-8s · Muito ~4-5s.
      const avgCutSec = Math.max(3, Math.min(cutPace, 20));
      // Variação leve (±15%) DENTRO da banda escolhida — natural, sem robótico e
      // sem estourar a faixa (nada de rajadas de 2s que furavam o "Menos").
      const rand = (a: number, b: number) => a + Math.random() * (b - a);
      const nextTargetMs = (): number => rand(avgCutSec * 0.85, avgCutSec * 1.15) * 1000;
      let curTargetMs = nextTargetMs();

      // Fatia em slots (snap no fim da palavra), guardando o TEXTO do trecho E
      // a palavra FALADA mais forte com o TIMING EXATO dela (pro texto na tela
      // aparecer no momento em que é dita — não o termo de busca em inglês).
      const slots: {
        start: number;
        end: number;
        text: string;
        keyword: string;
        spokenWord: string;
        wordStart: number;
        wordEnd: number;
        words: { text: string; start: number; end: number }[];
      }[] = [];
      let s0 = words[0]!.start;
      let cur: { text: string; start: number; end: number }[] = [];
      for (let i = 0; i < words.length; i++) {
        cur.push(words[i]!);
        const last = i === words.length - 1;
        if (words[i]!.end - s0 >= curTargetMs || last) {
          const text = cur.map((w) => w.text).join(' ');
          const clean = (w: string) => w.replace(/[^a-zA-ZÀ-ÿ]/g, '');
          const best =
            cur
              .filter((w) => {
                const c = clean(w.text);
                return c.length > 3 && !STOPWORDS.has(c.toLowerCase());
              })
              .sort((a, b) => clean(b.text).length - clean(a.text).length)[0] || cur[0]!;
          slots.push({
            start: s0 / 1000,
            end: words[i]!.end / 1000,
            text,
            keyword: clean(best.text) || cur[0]!.text || 'business',
            spokenWord: clean(best.text),
            wordStart: best.start / 1000,
            wordEnd: best.end / 1000,
            words: [...cur],
          });
          s0 = words[i]!.end;
          cur = [];
          curTargetMs = nextTargetMs(); // próximo corte com duração variada
        }
      }

      // Efeitos sonoros CONTEXTUAIS disponíveis (categoria "Efeitos" da
      // biblioteca) — NUNCA Impactos (Vine Boom fica só no manual).
      let libEffects: { name: string; url: string }[] = [];
      try {
        const lib = JSON.parse(localStorage.getItem('metavise-sound-library') || '[]') as any[];
        libEffects = lib
          .filter((x) => x?.category === 'Efeitos' && x?.name && x?.url)
          .map((x) => ({ name: String(x.name), url: String(x.url) }));
      } catch {
        /* sem efeitos */
      }

      // IA: gera um termo de busca VISUAL por trecho (entende a frase inteira,
      // não uma palavra solta) e, se encaixar, um efeito sonoro contextual.
      // Fallback pra keyword se a IA falhar.
      toast.loading(mt.toasts.aiPlanning, { id: tid });
      const queries: string[] = slots.map((s) => s.keyword);
      const effectNames: (string | null)[] = slots.map(() => null);
      const styles: string[] = slots.map(() => 'real');
      const tones: string[] = slots.map(() => 'now');
      const highlights: (string | null)[] = slots.map(() => null);
      const splits: boolean[] = slots.map(() => false);
      try {
        const qr = await fetch('/api/claude/broll-queries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            segments: slots.map((s) => s.text),
            effects: libEffects.map((e) => e.name),
          }),
        });
        const qd = await qr.json();
        if (qd?.success && Array.isArray(qd.queries)) {
          qd.queries.forEach((q: string, i: number) => {
            if (q && q.trim()) queries[i] = q.trim();
          });
          if (Array.isArray(qd.effects)) {
            qd.effects.forEach((name: string, i: number) => {
              if (
                name &&
                libEffects.some(
                  (e) => e.name.trim().toLowerCase() === String(name).trim().toLowerCase()
                )
              )
                effectNames[i] = name;
            });
          }
          if (Array.isArray(qd.styles))
            qd.styles.forEach((v: string, i: number) => (styles[i] = v));
          if (Array.isArray(qd.tones)) qd.tones.forEach((v: string, i: number) => (tones[i] = v));
          if (Array.isArray(qd.highlights))
            qd.highlights.forEach((v: string, i: number) => (highlights[i] = v || null));
          if (Array.isArray(qd.splits))
            qd.splits.forEach((v: boolean, i: number) => (splits[i] = !!v));
          window.dispatchEvent(new Event('claude-usage-changed'));
        }
      } catch {
        /* mantém keywords */
      }

      // Estilo "animação" → busca b-roll de animação/diagrama (bom pra conceitos
      // científicos: intestino, bactérias, corpo por dentro…).
      const searchQueries = queries.map((q, i) =>
        styles[i] === 'animation' ? `${q} animation` : q
      );

      // Busca CANDIDATOS por query única (cache) — 6 opções por termo.
      const cache: Record<string, { url: string; thumb: string; duration?: number }[]> = {};
      const uniq = Array.from(new Set(searchQueries.map((q) => q.toLowerCase())));
      for (let k = 0; k < uniq.length; k++) {
        toast.loading(mt.toasts.searchingBroll(k + 1, uniq.length), { id: tid });
        try {
          const pr = await fetch(
            `/api/pexels/search?query=${encodeURIComponent(uniq[k]!)}&orientation=${pexOrient}`
          );
          const pd = await pr.json();
          const list = (pd?.clips || pd?.data?.clips || []) as any[];
          cache[uniq[k]!] = list
            .slice(0, 6)
            .map((c) => ({ url: c.url, thumb: c.thumb || c.image || '', duration: c.duration }));
        } catch {
          cache[uniq[k]!] = [];
        }
      }

      const built: AutoSlot[] = slots.map((s, i) => {
        const q = searchQueries[i] || s.keyword;
        const cands = cache[q.toLowerCase()] || [];
        const effName = effectNames[i];
        const eff = effName
          ? libEffects.find((e) => e.name.trim().toLowerCase() === effName.trim().toLowerCase())
          : undefined;
        const hlPhrase = highlights[i] || undefined;
        const hlStart = hlPhrase ? (phraseStartSec(s.words, hlPhrase) ?? s.start) : undefined;
        return {
          start: Number(s.start.toFixed(2)),
          end: Number(s.end.toFixed(2)),
          keyword: q,
          searchTerm: q,
          candidates: cands,
          chosen: cands[0]?.url || '',
          spokenWord: s.spokenWord,
          wordStart: s.wordStart,
          wordEnd: s.wordEnd,
          highlight: hlPhrase,
          highlightStart: hlStart,
          style: styles[i],
          tone: tones[i],
          split: splits[i],
          effectName: eff?.name,
          effectUrl: eff?.url,
        };
      });
      setAutoSlots(built);
      // Diagnóstico: mostra quantos efeitos/destaques/P&B/animação a IA marcou —
      // ajuda a ver se o problema é escolha (nenhum marcado) ou render (link ruim).
      const nFx = built.filter((b) => b.effectUrl).length;
      const nHl = built.filter((b) => b.highlight).length;
      const nBw = built.filter((b) => b.tone === 'past').length;
      const nAnim = built.filter((b) => b.style === 'animation').length;
      const nSplit = built.filter((b) => b.split).length;
      toast.success(mt.toasts.autoEditSummary(built.length, nFx, nHl, nBw, nAnim, nSplit), {
        id: tid,
        duration: 7000,
      });
      if (libEffects.length === 0)
        toast(mt.toasts.noEffectsInLibraryHint, {
          duration: 7000,
          icon: '🔊',
        });
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.autoEditError, { id: tid });
    } finally {
      setAutoEditing(false);
    }
  };

  const chooseCandidate = (i: number, url: string) =>
    setAutoSlots((prev) => prev.map((s, k) => (k === i ? { ...s, chosen: url } : s)));

  const researchSlot = async (i: number, term: string) => {
    if (!term.trim()) return;
    setResearchingSlot(i);
    try {
      const pr = await fetch(
        `/api/pexels/search?query=${encodeURIComponent(term)}&orientation=${pexOrient}`
      );
      const pd = await pr.json();
      const list = (pd?.clips || pd?.data?.clips || []) as any[];
      const cands = list
        .slice(0, 6)
        .map((c) => ({ url: c.url, thumb: c.thumb || c.image || '', duration: c.duration }));
      setAutoSlots((prev) =>
        prev.map((s, k) =>
          k === i ? { ...s, searchTerm: term, candidates: cands, chosen: cands[0]?.url || '' } : s
        )
      );
    } catch {
      toast.error(mt.common.searchFailed);
    } finally {
      setResearchingSlot(null);
    }
  };

  // Aplica os slots escolhidos na timeline (clipes + transições + SFX + textos).
  const applyAutoSlots = () => {
    const chosenSlots = autoSlots.filter((s) => s.chosen);
    if (chosenSlots.length === 0) {
      toast.error(mt.toasts.chooseAtLeastOneBroll);
      return;
    }
    // VARIEDADE de transições — SÓ tipos "linkáveis" (slides / crossfade / whip),
    // que rodam nos DOIS lados do corte (saída do trecho + entrada do próximo).
    // Assim TODO corte tem transição de verdade (sem "vazio") e sem tela preta.
    // (Zoom/glitch/flash ficam no manual, por trecho.) Swoosh 7 em todo corte.
    const VARIETY = [
      'slideleft',
      'dissolve',
      'whip',
      'slideright',
      'dissolve',
      'slideup',
      'whip',
      'slideleft',
      'dissolve',
      'slideright',
    ];
    const LINKABLE = new Set([
      'slideleft',
      'slideright',
      'slideup',
      'slidedown',
      'dissolve',
      'whip',
    ]);
    const whoosh = soundForTransition('slideleft'); // Swoosh 7
    const base = clips.length;
    // Agrupa trechos SEGUIDOS com o MESMO clipe → vira 1 item CONTÍNUO (ex.: teu
    // vídeo cobrindo vários trechos), sem transição/som no meio. Pexels normal
    // (URLs diferentes em cada trecho) não agrupa — segue trecho a trecho.
    const groups: (typeof chosenSlots)[] = [];
    chosenSlots.forEach((s) => {
      const last = groups[groups.length - 1];
      if (last && last[last.length - 1]!.chosen === s.chosen) last.push(s);
      else groups.push([s]);
    });
    // Monta os clipes; trechos SPLIT (só quando é um trecho único) ganham um 2º
    // b-roll usando outro candidato do mesmo termo.
    const newClips: { url: string; label: string }[] = [];
    const newItems = groups.map((grp, k) => {
      const first = grp[0]!;
      const lastSlot = grp[grp.length - 1]!;
      const clipIdx = base + newClips.length;
      newClips.push({ url: first.chosen, label: `Auto ${k + 1}` });
      let clipIdx2: number | undefined;
      if (grp.length === 1 && first.split) {
        const right =
          first.candidates.find((c) => c.url && c.url !== first.chosen)?.url || first.chosen;
        clipIdx2 = base + newClips.length;
        newClips.push({ url: right, label: `Auto ${k + 1}B` });
      }
      return {
        clipIdx,
        clipIdx2,
        atSec: first.start,
        endSec: lastSlot.end, // grupo mesclado cobre do 1º ao último trecho
        transIn: k > 0 ? VARIETY[(k - 1) % VARIETY.length]! : 'none',
        transInDur: 0.15,
        soundIn: '',
        transOut: 'none' as string, // preenchido no 2º passo (link com o próximo)
        transOutDur: 0.15,
        soundOut: '',
        // Efeito sonoro contextual DESMARCADO por padrão (só sons de transição).
        soundMid: '',
        soundMidAlign: '' as const,
        // P&B DESMARCADO por padrão.
        bw: false,
        keyword: first.searchTerm || first.keyword,
      };
    });
    // 2º passo: transição + Swoosh 7 ENTRE grupos (dentro do grupo é contínuo).
    for (let k = 0; k < newItems.length - 1; k++) {
      const nextIn = newItems[k + 1]!.transIn;
      newItems[k]!.transOut = LINKABLE.has(nextIn) ? nextIn : 'none';
      newItems[k]!.soundOut = whoosh;
    }
    // Textos na tela vêm DESATIVADOS por padrão — o Auto-editar NÃO adiciona
    // texto sozinho. O usuário adiciona manualmente (botão "+ no playhead") se
    // quiser. (A IA ainda detecta os destaques, só não vira texto automático.)
    pushHistory(items);
    setClips((prev) => [...prev, ...newClips]);
    setItems((prev) => [...prev, ...newItems]);
    setAutoSlots([]);
    toast.success(mt.toasts.slotsApplied(newItems.length));
  };

  // Trocar o b-roll de um TRECHO já na timeline (busca Pexels e substitui o clipe).
  const searchSwap = async (term: string) => {
    setBrollSwap((prev) => (prev ? { ...prev, term, loading: true } : prev));
    try {
      const pr = await fetch(
        `/api/pexels/search?query=${encodeURIComponent(term || 'nature')}&orientation=${pexOrient}`
      );
      const pd = await pr.json();
      const list = (pd?.clips || pd?.data?.clips || []) as any[];
      setBrollSwap((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              candidates: list
                .slice(0, 12)
                .map((c) => ({ url: c.url, thumb: c.thumb || c.image || '' })),
            }
          : prev
      );
    } catch {
      setBrollSwap((prev) => (prev ? { ...prev, loading: false } : prev));
    }
  };
  const openSwap = (idx: number) => {
    const term = (items[idx]?.keyword as string) || '';
    setBrollSwap({ itemIdx: idx, term, candidates: [], loading: !!term, mode: 'swap' });
    if (term) searchSwap(term);
  };
  // "+ split": ESCOLHE sozinho um 2º b-roll (busca pelo termo do trecho e pega
  // um diferente do atual). Sem modal — o usuário só troca no ⇄ se quiser.
  const autoAddSplit = async (idx: number) => {
    const it = items[idx];
    if (!it) return;
    const term = ((it.keyword as string) || '').trim() || 'lifestyle';
    const currentUrl = clips[it.clipIdx]?.url;
    toast.loading(mt.toasts.choosingSplitBroll, { id: 'auto-split' });
    try {
      const pr = await fetch(
        `/api/pexels/search?query=${encodeURIComponent(term)}&orientation=${pexOrient}`
      );
      const pd = await pr.json();
      const list = (pd?.clips || pd?.data?.clips || []) as any[];
      const pick = list.find((c) => c.url && c.url !== currentUrl) || list[0];
      if (!pick?.url) throw new Error('sem b-roll');
      setClips((prev) => {
        const newIdx = prev.length;
        setItemField(idx, { clipIdx2: newIdx });
        return [...prev, { url: pick.url, label: `Split ${idx + 1}` }];
      });
      toast.success(mt.toasts.splitCreatedSwap, { id: 'auto-split' });
    } catch {
      toast.error(mt.toasts.splitBrollNotFound, { id: 'auto-split' });
    }
  };
  // Abre o picker pra TROCAR o 2º b-roll (split) do trecho.
  const openAddSplit = (idx: number) => {
    const term = (items[idx]?.keyword as string) || '';
    setBrollSwap({ itemIdx: idx, term, candidates: [], loading: !!term, mode: 'split' });
    if (term) searchSwap(term);
  };
  const pickSwap = (url: string) => {
    if (!brollSwap) return;
    const it = items[brollSwap.itemIdx];
    if (!it) {
      setBrollSwap(null);
      return;
    }
    if (brollSwap.mode === 'split') {
      if (it.clipIdx2 != null) {
        // Troca o 2º b-roll que já existe.
        const idx2 = it.clipIdx2;
        setClips((prev) =>
          prev.map((c, k) => (k === idx2 ? { ...c, url, duration: undefined } : c))
        );
        toast.success(mt.toasts.split2ndSwapped);
      } else {
        // (fallback) cria o split apontando pro novo clipe.
        setClips((prev) => {
          const newIdx = prev.length;
          setItemField(brollSwap.itemIdx, { clipIdx2: newIdx });
          return [...prev, { url, label: `Split ${brollSwap.itemIdx + 1}` }];
        });
        toast.success(mt.toasts.splitCreated);
      }
      setBrollSwap(null);
      return;
    }
    setClips((prev) =>
      prev.map((c, k) => (k === it.clipIdx ? { ...c, url, duration: undefined } : c))
    );
    setBrollSwap(null);
    toast.success(mt.toasts.brollSwapped);
  };

  // Excluir um trecho da biblioteca + reindexar os itens da timeline.
  const deletePoolClip = (ci: number) => {
    setItems((prev) =>
      prev
        .filter((it) => it.clipIdx !== ci)
        .map((it) => (it.clipIdx > ci ? { ...it, clipIdx: it.clipIdx - 1 } : it))
    );
    setClips((prev) => prev.filter((_, k) => k !== ci));
  };

  // Sequência (sem áudio)
  const move = (i: number, dir: -1 | 1) =>
    setClips((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const out = [...prev];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });
  const removeClip = (i: number) => setClips((prev) => prev.filter((_, k) => k !== i));
  const setTrim = (i: number, key: 'startSec' | 'endSec', val: string) => {
    const n = val === '' ? undefined : Math.max(0, Number(val) || 0);
    setClips((prev) => prev.map((c, k) => (k === i ? { ...c, [key]: n } : c)));
  };

  // Trechos com AVATAR CONTÍNUO (mesmo layout e lado: avatar tela cheia, PiP no
  // mesmo canto, ou split no mesmo lado) NÃO levam transição no meio — ela
  // sacudiria o avatar à toa. 'full' (só b-roll) não conta. Se o lado/layout
  // muda (split-left→split-right, avatar→full, etc.), a transição fica.
  const avatarContinuousBoundary = (a?: TLItem, b?: TLItem) =>
    !!avatarBase && !!a?.layout && a.layout !== 'full' && a.layout === b?.layout;

  // Monta o payload de clipes da timeline (mesmo pro render final e pro rascunho).
  const buildTimelineClips = () => {
    const sorted = [...items].sort((a, b) => a.atSec - b.atSec);
    return sorted.map((it, i, arr) => {
      // Avatar contínuo → sem transição (nem som) no corte do meio.
      const inCut = i > 0 && avatarContinuousBoundary(arr[i - 1], it);
      const outCut = i < arr.length - 1 && avatarContinuousBoundary(it, arr[i + 1]);
      // Enquadramento efetivo: override deste trecho, senão o global do avatar.
      const fr = it.frameOverride || framing;
      return {
        url: clips[it.clipIdx]?.url,
        url2: it.clipIdx2 != null ? clips[it.clipIdx2]?.url : undefined,
        layout: it.layout && it.layout !== 'full' && avatarBase ? it.layout : undefined,
        avatarUrl: it.layout && it.layout !== 'full' && avatarBase ? avatarBase : undefined,
        avatarSeek:
          it.layout && it.layout !== 'full' && avatarBase ? avatarStartSec + it.atSec : undefined,
        splitCX: it.layout && it.layout !== 'full' && avatarBase ? fr.splitCX : undefined,
        splitCY: it.layout && it.layout !== 'full' && avatarBase ? fr.splitCY : undefined,
        splitSize: it.layout && it.layout !== 'full' && avatarBase ? fr.splitSize : undefined,
        splitRatio: it.layout && it.layout !== 'full' && avatarBase ? fr.splitRatio : undefined,
        pipCX: it.layout && it.layout !== 'full' && avatarBase ? fr.pipCX : undefined,
        pipCY: it.layout && it.layout !== 'full' && avatarBase ? fr.pipCY : undefined,
        pipSize: it.layout && it.layout !== 'full' && avatarBase ? fr.pipSize : undefined,
        cropL: it.layout && it.layout !== 'full' && avatarBase ? fr.cropL : undefined,
        cropR: it.layout && it.layout !== 'full' && avatarBase ? fr.cropR : undefined,
        cropT: it.layout && it.layout !== 'full' && avatarBase ? fr.cropT : undefined,
        cropB: it.layout && it.layout !== 'full' && avatarBase ? fr.cropB : undefined,
        brollCX: it.brollCX,
        brollCY: it.brollCY,
        zoom: it.zoom || undefined,
        zoomCX: it.zoomCX,
        zoomCY: it.zoomCY,
        atSec: it.atSec,
        endSec: itemEnd(it),
        trimStart: 0,
        transIn: inCut ? 'none' : it.transIn || 'none',
        transInDur: it.transInDur || 0.1,
        soundIn: inCut ? '' : it.soundIn || '',
        soundMid: it.soundMid || '',
        soundMidAlign: it.soundMidAlign || '',
        bw: it.bw || false,
        transOut: outCut ? 'none' : it.transOut || 'none',
        transOutDur: it.transOutDur || 0.1,
        soundOut: outCut ? '' : it.soundOut || '',
      };
    });
  };

  const [previewing, setPreviewing] = useState(false);
  const composeDraft = async () => {
    if (!uid) return;
    if (!isTimeline) return toast.error(mt.toasts.timelineOnlyPreview);
    if (items.length === 0) return toast.error(mt.toasts.addAtLeastOneClip);
    setPreviewing(true);
    const tid = 'montagem-preview';
    const jid = addJob('Prévia rápida (rascunho)');
    toast.loading(mt.toasts.generatingPreview, { id: tid });
    try {
      const r = await fetch('/api/video/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: uid,
          audioUrl,
          durationSec: audioDuration,
          aspectRatio: aspect,
          fit,
          texts,
          draft: true,
          clips: buildTimelineClips(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || mt.toasts.previewFailed);
      setPreviewUrl(data.url);
      toast.success(mt.toasts.previewReady, { id: tid });
      updateJob(jid, { status: 'done' });
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.previewError, { id: tid });
      updateJob(jid, { status: 'error' });
    } finally {
      setPreviewing(false);
    }
  };

  const compose = async () => {
    if (!uid) return;
    setRendering(true);
    const toastId = 'montagem-render';
    const jid = addJob('Montagem (render do vídeo)');
    toast.loading(isTimeline ? mt.toasts.composingTimeline : mt.toasts.composingSequence, {
      id: toastId,
    });
    try {
      let data: any;
      if (isTimeline) {
        if (items.length === 0) throw new Error(mt.toasts.addAtLeastOneClip);
        const r = await fetch('/api/video/timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: uid,
            audioUrl,
            durationSec: audioDuration,
            aspectRatio: aspect,
            fit,
            texts,
            clips: buildTimelineClips(),
          }),
        });
        data = await r.json();
        if (!r.ok) throw new Error(data.error || mt.toasts.composeFailed);
      } else {
        if (clips.length === 0) throw new Error(mt.toasts.uploadClipsPlain);
        const r = await fetch('/api/video/sequence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: uid,
            muted,
            aspectRatio: aspect,
            clips: clips.map((c) => ({ url: c.url, startSec: c.startSec, endSec: c.endSec })),
          }),
        });
        data = await r.json();
        if (!r.ok) throw new Error(data.error || mt.toasts.composeFailed);
      }
      setResultUrl(data.url);
      onAddUploadedVideo?.(
        { url: data.url, uploaded: true, aspectRatio: aspect, createdAt: new Date().toISOString() },
        false
      );
      toast.success(mt.toasts.readyInEditing, { id: toastId });
      updateJob(jid, { status: 'done' });
    } catch (e: any) {
      const msg = String(e?.message || '');
      const friendly = /áudio|audio/i.test(msg)
        ? msg
        : mt.toasts.composeErrorFriendly(msg || mt.toasts.composeErrorGeneric);
      toast.error(friendly, { id: toastId, duration: 6000 });
      updateJob(jid, { status: 'error' });
    } finally {
      setRendering(false);
    }
  };

  // Junta TODAS as cenas/blocos já montados (cada um já com seu áudio/voz
  // embutido) num vídeo só, na ordem escolhida (padrão: numérica), e já
  // deixa disponível pra Edição — igual o compose() normal, só que
  // concatenando N cenas em vez de renderizar só a ativa.
  const joinScenes = async (order: number[]) => {
    if (!uid || order.length < 2) return;
    setJoiningScenes(true);
    const toastId = 'montagem-join-scenes';
    const jid = addJob(mt.joinScenes.jobLabel);
    toast.loading(mt.joinScenes.joiningToast, { id: toastId });
    try {
      const clips = order.map((i) => ({
        url: i === activeBlock ? resultUrl : blockDrafts[i]?.resultUrl || '',
      }));
      const r = await fetch('/api/video/sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid, muted: false, aspectRatio: aspect, clips }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || mt.joinScenes.failedToast);
      setJoinedResultUrl(data.url);
      onAddUploadedVideo?.(
        { url: data.url, uploaded: true, aspectRatio: aspect, createdAt: new Date().toISOString() },
        false
      );
      toast.success(mt.joinScenes.readyToast, { id: toastId });
      updateJob(jid, { status: 'done' });
    } catch (e: any) {
      toast.error(e?.message || mt.joinScenes.failedToast, { id: toastId, duration: 6000 });
      updateJob(jid, { status: 'error' });
    } finally {
      setJoiningScenes(false);
    }
  };

  // Gera a música (arco emocional a partir da copy) e COLA embaixo do vídeo
  // montado, num clique — plan → generate → add-music. Casa com a montagem.
  const gerarMusicaEColar = async () => {
    if (!uid) return toast.error(mt.common.login);
    if (!resultUrl) return toast.error(mt.toasts.composeVideoFirst);
    const copyText =
      ((config.copy as any)?.finalScript as string) ||
      ((config.copy as any)?.optimizedScript as string) ||
      ((config.copy as any)?.generatedScript as string) ||
      ((config as any)?.copyVsl?.finalScript as string) ||
      '';
    setMusicGen(true);
    const tid = 'montagem-music';
    const jid = addJob('Música (arco emocional)');
    toast.loading(mt.toasts.planningMusic, { id: tid });
    try {
      const pr = await fetch('/api/elevenlabs/music/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copy: copyText,
          totalDurationSec: Math.max(5, Math.round(audioDuration)),
        }),
      });
      const plan = await pr.json();
      if (!pr.ok) throw new Error(plan.error || mt.toasts.musicPlanFailed);
      toast.loading(mt.toasts.composingTrack, { id: tid });
      const gr = await fetch('/api/elevenlabs/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compositionPlan: plan, forceInstrumental: true }),
      });
      const gd = await gr.json();
      if (!gr.ok || !gd.audioUrl) throw new Error(gd.error || mt.toasts.musicGenFailed);
      toast.loading(mt.toasts.pastingMusic, { id: tid });
      const ar = await fetch('/api/video/add-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: resultUrl,
          musicUrl: gd.audioUrl,
          volume: 0.12,
          userId: uid,
        }),
      });
      const ad = await ar.json();
      if (!ar.ok || !ad.url) throw new Error(ad.error || mt.toasts.musicPasteFailed);
      setResultUrl(ad.url);
      onAddUploadedVideo?.(
        { url: ad.url, uploaded: true, aspectRatio: aspect, createdAt: new Date().toISOString() },
        false
      );
      toast.success(mt.toasts.musicAdded, { id: tid });
      updateJob(jid, { status: 'done' });
      logCreativeCost('Música (ElevenLabs)', COST_RATES.music);
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.musicError, { id: tid });
      updateJob(jid, { status: 'error' });
    } finally {
      setMusicGen(false);
    }
  };

  // Gera a CAPA/THUMBNAIL a partir do vídeo montado (Nano Banana). Por padrão
  // escolhe sozinho os 3 melhores instantes (brilho + nitidez + posição no
  // vídeo) e queima o texto do gancho por cima — legível, grafia exata.
  // coverUseAtPlayhead força usar o instante atual (comportamento manual antigo).
  const gerarCapa = async () => {
    if (!uid) return toast.error(mt.common.login);
    if (!resultUrl) return toast.error(mt.toasts.composeVideoFirst);
    setCoverGen(true);
    const tid = 'montagem-cover';
    const jid = addJob('Capa/thumbnail (Nano Banana)');
    toast.loading(
      coverUseAtPlayhead ? mt.toasts.generatingCoverFromCurrent : mt.toasts.choosingBestMoments,
      { id: tid }
    );
    try {
      const atSec = coverUseAtPlayhead
        ? playhead > 0.2
          ? Number(playhead.toFixed(1))
          : 1
        : undefined;
      const r = await fetch('/api/fal/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: resultUrl,
          atSec,
          text: coverText,
          aspectRatio: aspect,
          count: 3,
          userId: uid,
        }),
      });
      const d = await r.json();
      const urls: string[] = Array.isArray(d.urls) ? d.urls : d.url ? [d.url] : [];
      if (!r.ok || urls.length === 0) throw new Error(d.error || mt.toasts.coverGenFailed);
      setCoverOptions(urls);
      setCoverUrl(urls[0]!); // pré-seleciona a 1ª; o usuário troca clicando
      toast.success(mt.toasts.coverOptionsReady(urls.length), { id: tid });
      updateJob(jid, { status: 'done' });
      logCreativeCost('Capa/thumbnail (Nano Banana)', COST_RATES.covers(urls.length));
      triggerProjectSave('capa');
    } catch (e: any) {
      toast.error(e?.message || mt.toasts.coverError, { id: tid });
      updateJob(jid, { status: 'error' });
    } finally {
      setCoverGen(false);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem('metavise-montagem-templates', JSON.stringify(templates));
    } catch {
      /* ignora */
    }
  }, [templates]);

  const saveTemplate = () => {
    const name = (window.prompt(mt.toasts.templateNamePrompt) || '').trim();
    if (!name) return;
    setTemplates((prev) => [
      ...prev.filter((tpl) => tpl.name !== name),
      { name, aspect, fit, cutPace },
    ]);
    toast.success(mt.toasts.templateSaved(name));
  };
  const applyTemplate = (name: string) => {
    const tpl = templates.find((x) => x.name === name);
    if (!tpl) return;
    setAspect(tpl.aspect as any);
    setFit(tpl.fit as any);
    setCutPace(tpl.cutPace);
    toast.success(mt.toasts.templateApplied(name));
  };

  const displayItems = items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => a.it.atSec - b.it.atSec);

  // VALIDAÇÃO PRÉ-RENDER: aponta problemas ANTES de gastar um render — buracos na
  // timeline, trecho menor que o slot (congela/repete), sobreposição, áudio
  // faltando. Não bloqueia (Metavise nunca proíbe) — só avisa.
  const timelineWarnings = useMemo(() => {
    if (!isTimeline) return [] as string[];
    const w: string[] = [];
    const GAP = 0.35; // tolerância em segundos
    if (!audioUrl) w.push(mt.warnings.noAudio);
    if (items.length === 0) return w;
    const sorted = [...items].sort((a, b) => a.atSec - b.atSec);
    // Buraco no começo.
    if (sorted[0]!.atSec > GAP) {
      w.push(mt.warnings.startGap(sorted[0]!.atSec.toFixed(1)));
    }
    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i]!;
      const end = itemEnd(it);
      const slot = end - it.atSec;
      // Clipe mais curto que o slot → congela/repete o último frame.
      const clipDur = clips[it.clipIdx]?.duration || 0;
      if (clipDur > 0 && clipDur < slot - GAP) {
        w.push(
          mt.warnings.clipShorterThanSlot(
            i + 1,
            clips[it.clipIdx]?.label || mt.segments.clipFallback,
            clipDur.toFixed(1),
            slot.toFixed(1)
          )
        );
      }
      // Buraco/sobreposição com o próximo.
      const next = sorted[i + 1];
      if (next) {
        if (next.atSec > end + GAP) {
          w.push(mt.warnings.gapBetween((next.atSec - end).toFixed(1), i + 1, i + 2));
        } else if (next.atSec < end - GAP) {
          w.push(mt.warnings.overlap(i + 1, i + 2, (end - next.atSec).toFixed(1)));
        }
      }
    }
    // Buraco no fim.
    const last = sorted[sorted.length - 1]!;
    if (audioDuration && itemEnd(last) < audioDuration - GAP) {
      w.push(mt.warnings.endGap((audioDuration - itemEnd(last)).toFixed(1)));
    }
    return w;
  }, [isTimeline, audioUrl, items, clips, audioDuration]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <SoundLibraryModal
        open={!!soundPicker || soundLibManage}
        userId={uid}
        onClose={() => {
          setSoundPicker(null);
          setSoundLibManage(false);
        }}
        onPick={(url) => {
          if (!soundPicker) return;
          const patch: any = { [soundPicker.field]: url };
          if (soundPicker.field === 'soundMid') {
            const nm = libSounds.find((s) => s.url === url)?.name || '';
            patch.soundMidAlign = /reversed|riser|reverse/i.test(nm) ? 'end' : '';
          }
          setItemField(soundPicker.idx, patch);
        }}
      />

      {/* Enquadrar avatar (split + PiP) — calibrado 1× por avatar */}
      {framingModalOpen && avatarBase && (
        <AvatarFramingModal
          avatarUrl={avatarBase}
          aspect={aspect}
          value={framing}
          uid={uid}
          onClose={() => setFramingModalOpen(false)}
          onSave={(f) => {
            setAvatarFraming((prev) => ({ ...prev, [avatarBase]: f }));
            setFramingModalOpen(false);
            toast.success(mt.toasts.framingSavedGlobal);
          }}
        />
      )}

      {/* Enquadrar SÓ este trecho — sobrepõe o enquadramento global. */}
      {perTrechoFraming != null && avatarBase && items[perTrechoFraming] && (
        <AvatarFramingModal
          title={mt.perSegmentFramingTitle(perTrechoFraming + 1)}
          perTrecho
          avatarUrl={avatarBase}
          aspect={aspect}
          value={items[perTrechoFraming]!.frameOverride || framing}
          uid={uid}
          verticalSplit={
            items[perTrechoFraming]!.layout === 'split-top' ||
            items[perTrechoFraming]!.layout === 'split-bottom'
          }
          onClose={() => setPerTrechoFraming(null)}
          onSave={(f) => {
            setItemField(perTrechoFraming, { frameOverride: f });
            setPerTrechoFraming(null);
            toast.success(mt.toasts.framingSavedPerSegment);
          }}
        />
      )}

      {/* Trocar b-roll de um trecho da timeline */}
      {brollSwap && (
        <div
          className="fixed inset-0 z-[121] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setBrollSwap(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden bg-white dark:bg-gray-900 rounded-3xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 p-4 border-b border-gray-200 dark:border-gray-800">
              <input
                autoFocus
                value={brollSwap.term}
                onChange={(e) => setBrollSwap((p) => (p ? { ...p, term: e.target.value } : p))}
                onKeyDown={(e) => e.key === 'Enter' && searchSwap(brollSwap.term)}
                placeholder={mt.brollSwapModal.placeholder}
                className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm"
              />
              <button
                onClick={() => searchSwap(brollSwap.term)}
                disabled={brollSwap.loading}
                className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-50"
              >
                {brollSwap.loading ? '…' : mt.pexelsSearch.button}
              </button>
              {myProjectVideos.length > 0 && (
                <button
                  onClick={() => setSwapMyVid((v) => !v)}
                  className={`text-xs font-black uppercase tracking-widest px-3 py-2 rounded-xl border-2 ${
                    swapMyVid
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                  }`}
                >
                  {mt.brollSwapModal.myVideos}
                </button>
              )}
              <button
                onClick={() => setBrollSwap(null)}
                className="p-1.5 text-gray-400 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {swapMyVid && myProjectVideos.length > 0 && (
                <div className="mb-4 space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-400">
                    {mt.brollSwapModal.myProjectVideos}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {myProjectVideos.map((mv) => (
                      <button
                        key={mv.url}
                        onClick={() => pickSwap(mv.url)}
                        onMouseEnter={(e) =>
                          e.currentTarget
                            .querySelector('video')
                            ?.play()
                            .catch(() => {})
                        }
                        onMouseLeave={(e) => e.currentTarget.querySelector('video')?.pause()}
                        title={mv.label}
                        className="relative aspect-video rounded-lg overflow-hidden border-2 border-blue-300/50 hover:border-blue-400"
                      >
                        <video
                          src={mv.url}
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const d = (e.target as HTMLVideoElement).duration;
                            if (d && isFinite(d))
                              setMyVidDur((prev) =>
                                prev[mv.url] ? prev : { ...prev, [mv.url]: d }
                              );
                          }}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 flex items-center justify-between gap-1">
                          <span className="truncate">{mv.label}</span>
                          {(mv.duration ?? myVidDur[mv.url]) ? (
                            <span className="tabular-nums shrink-0 font-black">
                              {(mv.duration ?? myVidDur[mv.url])!.toFixed(1)}s
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {brollSwap.candidates.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  {mt.brollSwapModal.searchHint}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {brollSwap.candidates.map((c) => (
                    <button
                      key={c.url}
                      onClick={() => pickSwap(c.url)}
                      onMouseEnter={(e) =>
                        e.currentTarget
                          .querySelector('video')
                          ?.play()
                          .catch(() => {})
                      }
                      onMouseLeave={(e) => e.currentTarget.querySelector('video')?.pause()}
                      className="relative aspect-video rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-400"
                    >
                      <video
                        src={c.url}
                        poster={c.thumb || undefined}
                        muted
                        loop
                        playsInline
                        preload="none"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AUTO-EDITAR — picker de b-roll por trecho */}
      {autoSlots.length > 0 && (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black/70 backdrop-blur-sm p-3 sm:p-6">
          <div className="flex-1 min-h-0 w-full max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-3xl border-2 border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="text-lg font-black text-gray-900 dark:text-gray-50">
                  {mt.autoSlotsModal.title}
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {mt.autoSlotsModal.subtitle(autoSlots.length)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setAutoSlots([])}
                  className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg text-gray-500 hover:text-red-500"
                >
                  {mt.common.cancel}
                </button>
                <button
                  onClick={applyAutoSlots}
                  className="text-xs font-black uppercase tracking-widest px-4 py-2.5 rounded-xl bg-purple-600 text-white hover:bg-purple-700"
                >
                  {mt.autoSlotsModal.applyButton}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {autoSlots.map((s, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-gray-700 dark:text-gray-300">
                      {mt.autoSlotsModal.segmentLabel(i + 1)}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {Math.round(s.start)}–{Math.round(s.end)}s
                    </span>
                    <button
                      onClick={() => playSegment(s.start, s.end)}
                      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                      title={mt.autoSlotsModal.listenTitle}
                    >
                      <Play size={11} /> {mt.common.listen}
                    </button>
                    <input
                      value={s.searchTerm}
                      onChange={(e) =>
                        setAutoSlots((prev) =>
                          prev.map((x, k) => (k === i ? { ...x, searchTerm: e.target.value } : x))
                        )
                      }
                      onKeyDown={(e) => e.key === 'Enter' && researchSlot(i, s.searchTerm)}
                      className="flex-1 min-w-[120px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-xs"
                    />
                    <button
                      onClick={() => researchSlot(i, s.searchTerm)}
                      disabled={researchingSlot === i}
                      className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-50"
                    >
                      {researchingSlot === i ? '…' : mt.pexelsSearch.button}
                    </button>
                  </div>
                  {myProjectVideos.length > 0 && (
                    <div className="space-y-1">
                      <button
                        onClick={() => setMyVidOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                        className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-800 rounded-lg px-2.5 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center gap-1"
                      >
                        {mt.autoSlotsModal.myVideosCount(myProjectVideos.length)}{' '}
                        {myVidOpen[i] ? '▲' : '▼'}
                      </button>
                      {myVidOpen[i] && (
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {myProjectVideos.map((mv) => (
                            <button
                              key={mv.url}
                              onClick={() => chooseCandidate(i, mv.url)}
                              onMouseEnter={(e) => {
                                const v = e.currentTarget.querySelector('video');
                                if (v) (v as HTMLVideoElement).play().catch(() => {});
                              }}
                              onMouseLeave={(e) => {
                                const v = e.currentTarget.querySelector('video');
                                if (v) (v as HTMLVideoElement).pause();
                              }}
                              title={mv.label}
                              className={`relative aspect-video rounded-lg overflow-hidden border-2 ${
                                s.chosen === mv.url
                                  ? 'border-purple-500 ring-2 ring-purple-300'
                                  : 'border-blue-300/50 hover:border-blue-400'
                              }`}
                            >
                              <video
                                src={mv.url}
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                onLoadedMetadata={(e) => {
                                  const d = (e.target as HTMLVideoElement).duration;
                                  if (d && isFinite(d))
                                    setMyVidDur((prev) =>
                                      prev[mv.url] ? prev : { ...prev, [mv.url]: d }
                                    );
                                }}
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-1 flex items-center justify-between gap-1">
                                <span className="truncate">{mv.label}</span>
                                {(mv.duration ?? myVidDur[mv.url]) ? (
                                  <span className="tabular-nums shrink-0 font-black">
                                    {(mv.duration ?? myVidDur[mv.url])!.toFixed(1)}s
                                  </span>
                                ) : null}
                              </span>
                              {s.chosen === mv.url && (
                                <span className="absolute top-1 right-1 bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                                  ✓
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {s.candidates.length === 0 ? (
                    <p className="text-[11px] text-gray-400">{mt.autoSlotsModal.noBrollHint}</p>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {s.candidates.map((c) => (
                        <button
                          key={c.url}
                          onClick={() => chooseCandidate(i, c.url)}
                          onMouseEnter={(e) => {
                            const v = e.currentTarget.querySelector('video');
                            if (v) (v as HTMLVideoElement).play().catch(() => {});
                          }}
                          onMouseLeave={(e) => {
                            const v = e.currentTarget.querySelector('video');
                            if (v) (v as HTMLVideoElement).pause();
                          }}
                          className={`relative aspect-video rounded-lg overflow-hidden border-2 ${
                            s.chosen === c.url
                              ? 'border-purple-500 ring-2 ring-purple-300'
                              : 'border-transparent hover:border-gray-300'
                          }`}
                        >
                          <video
                            src={c.url}
                            poster={c.thumb || undefined}
                            muted
                            loop
                            playsInline
                            preload="none"
                            className="w-full h-full object-cover"
                          />
                          {s.chosen === c.url && (
                            <span className="absolute top-1 right-1 bg-purple-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">
                              ✓
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {(s.highlight || s.tone === 'past' || s.style === 'animation' || s.split) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      {s.highlight && (
                        <span className="px-2 py-1 rounded-lg bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 font-black uppercase tracking-widest">
                          ✍ {s.highlight}
                        </span>
                      )}
                      {s.tone === 'past' && (
                        <span className="px-2 py-1 rounded-lg bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-black uppercase tracking-widest">
                          {mt.autoSlotsModal.bwBadge}
                        </span>
                      )}
                      {s.style === 'animation' && (
                        <span className="px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-black uppercase tracking-widest">
                          {mt.autoSlotsModal.animationBadge}
                        </span>
                      )}
                      {s.split && (
                        <button
                          onClick={() =>
                            setAutoSlots((prev) =>
                              prev.map((x, k) => (k === i ? { ...x, split: !x.split } : x))
                            )
                          }
                          className="px-2 py-1 rounded-lg bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-black uppercase tracking-widest"
                          title={mt.autoSlotsModal.splitToggleTitle}
                        >
                          ⊞ split ✕
                        </button>
                      )}
                    </div>
                  )}
                  {s.effectName && (
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-black uppercase tracking-widest">
                        🔊 {s.effectName}
                      </span>
                      <button
                        onClick={() =>
                          setAutoSlots((prev) =>
                            prev.map((x, k) =>
                              k === i ? { ...x, effectName: undefined, effectUrl: undefined } : x
                            )
                          )
                        }
                        className="text-gray-400 hover:text-red-500 font-bold"
                        title={mt.autoSlotsModal.dontUseEffectTitle}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes mvFade { 0%{opacity:0} 60%,100%{opacity:1} }
        @keyframes mvSL { 0%{transform:translateX(100%)} 60%,100%{transform:translateX(0)} }
        @keyframes mvSR { 0%{transform:translateX(-100%)} 60%,100%{transform:translateX(0)} }
        @keyframes mvSU { 0%{transform:translateY(100%)} 60%,100%{transform:translateY(0)} }
        @keyframes mvSD { 0%{transform:translateY(-100%)} 60%,100%{transform:translateY(0)} }
        @keyframes mvZI { 0%{transform:scale(1)} 70%,100%{transform:scale(1.18)} }
        @keyframes mvZO { 0%{transform:scale(1.18)} 70%,100%{transform:scale(1)} }
        @keyframes mvWF { 0%{filter:brightness(6)} 35%,100%{filter:brightness(1)} }
        @keyframes mvWH { 0%{transform:translateX(75%);filter:blur(9px)} 45%,100%{transform:translateX(0);filter:blur(0)} }
        @keyframes mvGL {
          0%,100%{transform:translateX(0);box-shadow:none;filter:none}
          18%{transform:translateX(-5px);box-shadow:-4px 0 0 rgba(255,0,255,.6),4px 0 0 rgba(0,255,255,.6)}
          36%{transform:translateX(5px);box-shadow:4px 0 0 rgba(255,0,255,.6),-4px 0 0 rgba(0,255,255,.6)}
          54%{transform:translateX(-2px);filter:contrast(1.6) brightness(1.2)}
          72%{transform:translateX(0);box-shadow:none;filter:none}
        }
        /* Preview anima SÓ no hover do card (mv-card). Parado, mostra estático. */
        .mv-card:hover .mv-fade{animation:mvFade 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slideleft{animation:mvSL 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slideright{animation:mvSR 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slideup{animation:mvSU 1.6s ease-in-out infinite}
        .mv-card:hover .mv-slidedown{animation:mvSD 1.6s ease-in-out infinite}
        .mv-card:hover .mv-white{animation:mvWF 1.6s ease-in-out infinite}
        /* Zoom (Ken Burns) não é mais transição — é um controle próprio do
           trecho; o selo animado abaixo roda sempre, não só no hover. */
        .mv-zoom-live-in{animation:mvZI 1.6s ease-in-out infinite}
        .mv-zoom-live-out{animation:mvZO 1.6s ease-in-out infinite}
        .mv-card:hover .mv-whip{animation:mvWH 1.6s ease-in-out infinite}
        .mv-card:hover .mv-glitch{animation:mvGL 1.2s linear infinite}
        .mv-bw{filter:grayscale(1)}
      `}</style>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Film
            size={22}
            className={
              montagemMode === 'vsl'
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-blue-600 dark:text-blue-400'
            }
          />
          <h2 className="text-2xl font-black text-gray-900 dark:text-gray-50">
            {montagemMode === 'vsl' ? mt.header.titleVsl : mt.header.titleCreative}
          </h2>
        </div>
        {(hasVslWorkflow || montagemMode === 'vsl') && (
          <div className="max-w-3xl">
            <div className="bg-white dark:bg-gray-900/80 p-2 rounded-2xl border-2 border-gray-100 dark:border-gray-800 shadow-sm flex gap-1">
              <button
                onClick={() => setMontagemMode('creative')}
                className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  montagemMode === 'creative'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                }`}
              >
                {mt.header.toggleCreative}
              </button>
              <button
                onClick={() => setMontagemMode('vsl')}
                className={`flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  montagemMode === 'vsl'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-purple-50 dark:hover:bg-purple-950/40'
                }`}
              >
                {mt.header.toggleVsl}
              </button>
            </div>
          </div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {montagemMode === 'vsl' ? mt.header.subtitleVsl : mt.header.subtitleCreative}
        </p>
      </div>

      {/* SELETOR DE BLOCO/CENA — troca o workflow inteiro (áudio, trechos,
          resultado) sem perder o trabalho de cada bloco. VSL: um bloco por
          parte da VSL (cada um com seu áudio). Creativo: cenas. */}
      {(() => {
        const usingSlices = montagemMode === 'vsl' && blockEnds.length > 0;
        const noun =
          montagemMode === 'vsl' ? mt.blockSelector.nounBlock : mt.blockSelector.nounScene;
        const n = usingSlices ? blockEnds.length : blockCount;
        return (
          <div className="flex items-center gap-2 flex-wrap bg-white dark:bg-gray-900/70 p-2.5 rounded-2xl border-2 border-blue-200 dark:border-blue-900/50">
            <span className="text-[11px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 shrink-0">
              {montagemMode === 'vsl' ? mt.blockSelector.vslLabel : mt.blockSelector.creativeLabel}
            </span>
            {Array.from({ length: n }, (_, i) => i).map((i) => {
              const isActive = activeBlock === i;
              const hasWork = blockHasWork(isActive ? currentWorkflow() : blockDrafts[i]);
              return (
                <button
                  key={i}
                  onClick={() => (usingSlices ? trabalharNoBloco(i) : selectBlock(i))}
                  title={mt.blockSelector.switchTitle(noun.toLowerCase(), i + 1)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-300'
                  }`}
                >
                  {`${noun} ${i + 1}`}
                  {hasWork && (
                    <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 align-middle" />
                  )}
                </button>
              );
            })}
            {/* Blocos manuais (Creativo sempre; VSL quando não fatiou um áudio
                longo — cada bloco recebe seu próprio áudio na base abaixo). */}
            {!usingSlices && (
              <>
                <button
                  onClick={() => {
                    const next = blockCount;
                    setBlockCount((c) => c + 1);
                    selectBlock(next);
                  }}
                  className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border border-dashed border-blue-300 dark:border-blue-700 text-blue-500 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  {mt.blockSelector.addButton(noun)}
                </button>
                {blockCount > 1 && (
                  <button
                    onClick={() => {
                      const removed = Math.max(0, activeBlock);
                      if (!window.confirm(mt.blockSelector.deleteConfirm(noun, removed + 1)))
                        return;
                      const reindexed: Record<number, BlockWorkflow> = {};
                      Object.keys(blockDrafts)
                        .map(Number)
                        .filter((k) => k !== removed)
                        .forEach((k) => {
                          reindexed[k > removed ? k - 1 : k] = blockDrafts[k]!;
                        });
                      const target = Math.min(removed, blockCount - 2);
                      setBlockDrafts(reindexed);
                      setBlockCount((c) => Math.max(1, c - 1));
                      applyWorkflow(reindexed[target]);
                      setActiveBlock(target);
                    }}
                    className="px-2 py-1.5 rounded-xl text-[11px] font-black text-red-500 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title={mt.blockSelector.deleteTitle(noun)}
                  >
                    🗑
                  </button>
                )}
              </>
            )}
            <span className="text-[10px] text-gray-400 ml-auto hidden sm:block">
              {activeBlock < 0 && usingSlices
                ? mt.blockSelector.clickToStart
                : mt.blockSelector.alreadyEditedHint}
            </span>
          </div>
        );
      })()}

      {/* JUNTAR CENAS/BLOCOS — concatena os vídeos já montados de cada
          cena/bloco num único vídeo final, na ordem escolhida (padrão
          numérica, reordenável), e já disponibiliza pra Edição. */}
      {(() => {
        const sceneUrl = (i: number) =>
          (i === activeBlock ? resultUrl : blockDrafts[i]?.resultUrl) || '';
        const withResult = Array.from({ length: blockCount }, (_, i) => i).filter(
          (i) => !!sceneUrl(i)
        );
        if (withResult.length < 2) return null;
        const noun =
          montagemMode === 'vsl' ? mt.blockSelector.nounBlock : mt.blockSelector.nounScene;
        const order =
          joinOrderOverride &&
          joinOrderOverride.length === withResult.length &&
          joinOrderOverride.every((i) => withResult.includes(i))
            ? joinOrderOverride
            : withResult;
        const move = (pos: number, dir: -1 | 1) => {
          const next = order.slice();
          const target = pos + dir;
          if (target < 0 || target >= next.length) return;
          [next[pos], next[target]] = [next[target]!, next[pos]!];
          setJoinOrderOverride(next);
        };
        return (
          <div className="bg-white dark:bg-gray-900/70 p-4 rounded-2xl border-2 border-purple-200 dark:border-purple-900/50 space-y-3">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-purple-600 dark:text-purple-400" />
              <span className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
                {mt.joinScenes.heading(noun)}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {mt.joinScenes.description}
            </p>
            <div className="space-y-1.5">
              {order.map((i, pos) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-xl border border-gray-200 dark:border-gray-800"
                >
                  <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 w-6 shrink-0">
                    {mt.joinScenes.positionLabel(pos + 1)}
                  </span>
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-200 flex-1">
                    {`${noun} ${i + 1}`}
                  </span>
                  <button
                    onClick={() => move(pos, -1)}
                    disabled={pos === 0}
                    className="p-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:border-purple-300"
                    title={mt.joinScenes.moveUpTitle}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => move(pos, 1)}
                    disabled={pos === order.length - 1}
                    className="p-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:border-purple-300"
                    title={mt.joinScenes.moveDownTitle}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => joinScenes(order)}
              disabled={joiningScenes}
              className="w-full py-3 rounded-xl bg-purple-600 text-white text-xs font-black uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {joiningScenes ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {mt.joinScenes.joining}
                </>
              ) : (
                mt.joinScenes.joinButton(order.length)
              )}
            </button>
            {/* Player do último vídeo juntado — pra assistir aqui mesmo na
                Montagem, sem precisar ir pra Edição só pra conferir. */}
            {joinedResultUrl && (
              <div className="pt-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400">
                    {mt.joinScenes.resultHeading}
                  </span>
                  <button
                    onClick={() => setJoinedResultUrl('')}
                    className="text-[10px] text-gray-400 hover:text-red-500"
                    title={mt.joinScenes.clearResultTitle}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <video
                  key={joinedResultUrl}
                  src={joinedResultUrl}
                  controls
                  className="w-full max-h-[420px] rounded-xl bg-black"
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* ÁUDIO BASE */}
      <div className="bg-white dark:bg-gray-900/70 p-4 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-3">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-blue-600 dark:text-blue-400" />
          <span className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
            {mt.audioBase.heading}
          </span>
        </div>
        {audioUrl ? (
          <div className="space-y-3">
            {/* PREVIEW 1:1 */}
            <div
              ref={previewWrapRef}
              className={`relative bg-black rounded-xl overflow-hidden mx-auto max-h-[440px] w-full ${
                aspect === '9:16'
                  ? 'aspect-[9/16] max-w-[260px]'
                  : aspect === '4:5'
                    ? 'aspect-[4/5] max-w-[340px]'
                    : aspect === '16:9'
                      ? 'aspect-video max-w-[640px]'
                      : 'aspect-square max-w-[420px]'
              } [&:fullscreen]:max-h-none [&:fullscreen]:max-w-none [&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none`}
            >
              <video
                ref={vARef}
                className={`absolute inset-0 w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
                style={{ opacity: 0 }}
                muted
                playsInline
              />
              <video
                ref={vBRef}
                className={`absolute inset-0 w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
                style={{ opacity: 0 }}
                muted
                playsInline
              />
              {/* Barra de controle (fica dentro do container → funciona em tela cheia) */}
              <div
                style={{ zIndex: 10 }}
                className="absolute left-0 right-0 bottom-0 px-3 py-2 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent"
              >
                <button
                  onClick={togglePlay}
                  className="text-white shrink-0"
                  title={isPlaying ? mt.audioBase.pause : mt.audioBase.play}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <div onClick={seekAudio} className="flex-1 h-2 bg-white/30 rounded cursor-pointer">
                  <div
                    className="h-full bg-white rounded"
                    style={{ width: `${audioDuration ? (playhead / audioDuration) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] text-white tabular-nums shrink-0">
                  {playhead.toFixed(0)}/{audioDuration.toFixed(0)}s
                </span>
                <button
                  onClick={goFullscreen}
                  className="text-white shrink-0"
                  title={mt.audioBase.fullscreenTitle}
                >
                  <Maximize size={16} />
                </button>
              </div>
            </div>
            <button
              onClick={addHere}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black uppercase tracking-widest flex items-center justify-center gap-2"
            >
              <Plus size={16} /> {mt.audioBase.addHereButton(playhead.toFixed(1))}
            </button>

            {/* Seletor de clipe ao "adicionar aqui" */}
            {picking != null && (
              <div className="p-3 rounded-xl ring-2 ring-blue-400 bg-blue-50/60 dark:bg-blue-950/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                    {mt.audioBase.chooseClipFor(picking.toFixed(1))}
                  </span>
                  <button
                    onClick={() => setPicking(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X size={14} />
                  </button>
                </div>
                {clips.length === 0 ? (
                  <p className="text-[11px] text-gray-500">{mt.audioBase.uploadClipsFirstHint}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {clips.map((c, ci) => (
                      <div
                        key={c.url + ci}
                        className="relative rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-blue-500"
                      >
                        <button onClick={() => pickClip(ci)} className="block w-full text-left">
                          <div className="relative">
                            <video
                              src={c.url}
                              preload="metadata"
                              className="w-full h-20 object-cover bg-black"
                            />
                            {c.duration ? (
                              <span className="absolute bottom-1 right-1 text-[9px] font-black bg-black/70 text-white px-1 rounded">
                                {c.duration.toFixed(1)}s
                              </span>
                            ) : null}
                          </div>
                          <span className="block text-[9px] truncate px-1 py-0.5 text-gray-600 dark:text-gray-300">
                            {c.label}
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePoolClip(ci);
                          }}
                          title={mt.audioBase.deleteClipTitle}
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white hover:bg-red-600"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              onLoadedMetadata={(e) =>
                setAudioDuration((e.target as HTMLAudioElement).duration || 0)
              }
              onTimeUpdate={(e) => syncPreview((e.target as HTMLAudioElement).currentTime, false)}
              onSeeked={(e) => syncPreview((e.target as HTMLAudioElement).currentTime, true)}
              onPlay={() => {
                playingRef.current = true;
                setIsPlaying(true);
                frontEl()
                  ?.play()
                  .catch(() => {});
                startRaf();
              }}
              onPause={() => {
                playingRef.current = false;
                setIsPlaying(false);
                frontEl()?.pause();
                stopRaf();
              }}
              className="w-full"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">
                {mt.audioBase.durationLabel(
                  audioDuration ? `${audioDuration.toFixed(1)}s` : mt.audioBase.durationPending
                )}
              </span>
              <button
                onClick={() => {
                  pushHistory(items);
                  setAudioUrl('');
                  setItems([]);
                }}
                className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
              >
                <X size={12} /> {mt.audioBase.removeAudioButton}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vozOptionsForMode.map((o) => (
              <button
                key={o.key}
                onClick={() => setAudioUrl(o.url)}
                className={`px-3 py-2 rounded-xl text-white text-[10px] font-black uppercase tracking-widest ${
                  o.key.startsWith('vsl')
                    ? 'bg-purple-600 hover:bg-purple-700'
                    : o.key === 'gancho'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : o.key.startsWith('joined')
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {mt.audioBase.useVoiceButton(o.label)}
              </button>
            ))}
            <label className="px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:border-blue-400 cursor-pointer flex items-center gap-1">
              {uploadingAudio ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Upload size={12} />
              )}
              {mt.audioBase.uploadAudioLabel}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => onUploadAudio(e.target.files?.[0])}
              />
            </label>
            <span className="text-[11px] text-gray-400 self-center">
              {mt.audioBase.noAudioHint}
            </span>
          </div>
        )}
      </div>

      {/* TIMELINE: itens posicionados */}
      {isTimeline && displayItems.length > 0 && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            {mt.transitionsPreviewLabel}
          </span>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {TRANSITIONS.map((trans) => (
              <div key={trans.id} className="space-y-1">
                <div className="mv-card relative w-full h-14 rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 cursor-pointer">
                  <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500 to-rose-500" />
                  <div
                    className={`absolute inset-0 bg-gradient-to-br from-blue-500 to-cyan-400 ${trans.css}`}
                  />
                </div>
                <span className="block text-[9px] text-center text-gray-500">
                  {transitionLabel(trans.id)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BIBLIOTECA DE EFEITOS SONOROS — preview (ouça e aplique nos trechos abaixo) */}
      {isTimeline && displayItems.length > 0 && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              {mt.soundLibrary.heading}
            </span>
            <button
              onClick={() => setSoundLibManage(true)}
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 flex items-center gap-1 shrink-0"
              title={mt.soundLibrary.manageTitle}
            >
              <Music size={12} /> {mt.soundLibrary.manageButton}
            </button>
          </div>
          {libSounds.length === 0 ? (
            <p className="text-[11px] text-gray-400">{mt.soundLibrary.emptyHint}</p>
          ) : (
            ['Transições', 'Efeitos', 'Impactos', 'Outros']
              .filter((cat) => libSounds.some((s) => (s.category || 'Outros') === cat))
              .map((cat) => (
                <div key={cat} className="space-y-1">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-gray-400">
                    {cat}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {libSounds
                      .filter((s) => (s.category || 'Outros') === cat)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => playSfx(s.url)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[11px] text-gray-700 dark:text-gray-200 hover:border-purple-400"
                          title={mt.common.listen}
                        >
                          <Play size={10} /> {s.name}
                        </button>
                      ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* AVATAR BASE — vídeo do HeyGen (mesma narração) pro PiP/split */}
      {isTimeline && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-violet-200 dark:border-violet-900/60 space-y-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400">
            {mt.avatarBase.heading}
          </span>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {mt.avatarBase.explanation}
          </p>
          {avatarBase ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <video
                  ref={avatarPreviewRef}
                  src={avatarBase}
                  controls
                  className="w-40 h-24 object-cover rounded-lg bg-black"
                />
                <span className="text-[10px] font-black uppercase tracking-widest text-green-600 dark:text-green-400">
                  {mt.avatarBase.activeBadge}
                </span>
                <button
                  onClick={() => setFramingModalOpen(true)}
                  className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 hover:underline"
                  title={mt.avatarBase.frameTitle}
                >
                  {mt.avatarBase.frameButton}
                </button>
                <button
                  onClick={() => setAvatarBase('')}
                  className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
                >
                  {mt.common.swap}
                </button>
              </div>
              {/* Início do bloco no avatar: se a base é a VSL inteira (10 min) e
                  você monta um bloco no meio, marque onde ele começa — a montagem
                  usa só daqui pra frente (pelo tempo do bloco) e o lip-sync bate. */}
              <div className="flex items-center gap-2 flex-wrap text-[10px]">
                <span className="font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {mt.avatarBase.blockStartLabel}
                </span>
                <span className="font-mono font-black text-violet-600 dark:text-violet-400">
                  {`${Math.floor(avatarStartSec / 60)}:${String(Math.floor(avatarStartSec % 60)).padStart(2, '0')}`}
                </span>
                <button
                  onClick={() => {
                    const t = avatarPreviewRef.current?.currentTime;
                    if (t == null) return;
                    setAvatarStartSec(Math.max(0, Math.round(t * 10) / 10));
                    toast.success(mt.toasts.avatarStartMarked);
                  }}
                  className="px-2 py-1 rounded-lg border border-violet-300 dark:border-violet-800 font-black uppercase tracking-widest text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                  title={mt.avatarBase.cutFromHereTitle}
                >
                  {mt.avatarBase.cutFromHereButton}
                </button>
                {avatarStartSec > 0 && (
                  <button
                    onClick={() => setAvatarStartSec(0)}
                    className="font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
                  >
                    {mt.avatarBase.resetButton}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {avatarVideoOptionsForMode.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    {mt.avatarBase.chooseGeneratedHint}
                  </span>
                  <div className="flex flex-wrap gap-2 items-end">
                    {avatarVideoOptionsForMode.map((v) => {
                      const ar = String(v.aspectRatio || '16:9').replace(':', '/');
                      const durSec = v.duration || myVidDur[v.url];
                      const nome = v.name + (v.blockLabel ? ` · ${v.blockLabel}` : '');
                      const active = avatarBase === v.url;
                      return (
                        <button
                          key={v.url}
                          onClick={() => setAvatarBase(v.url)}
                          style={{ aspectRatio: ar }}
                          className={`relative h-20 rounded-lg overflow-hidden bg-black ring-1 hover:ring-2 hover:ring-violet-500 ${
                            active
                              ? 'ring-2 ring-violet-500'
                              : 'ring-violet-300 dark:ring-violet-700'
                          }`}
                          title={nome}
                        >
                          <video
                            src={v.url}
                            muted
                            playsInline
                            loop
                            preload="metadata"
                            onMouseEnter={(e) =>
                              (e.currentTarget as HTMLVideoElement).play().catch(() => {})
                            }
                            onMouseLeave={(e) => {
                              const el = e.currentTarget as HTMLVideoElement;
                              el.pause();
                              el.currentTime = 0;
                            }}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute top-0 left-0 bg-black/60 text-white text-[8px] font-black px-1 py-0.5">
                            {nome}
                          </span>
                          {durSec ? (
                            <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] font-black px-1 py-0.5 tabular-nums">
                              {Math.round(durSec)}s
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <label className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border-2 border-violet-200 dark:border-violet-800 text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300 hover:border-violet-400 cursor-pointer">
                {uploadingAvatar ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Upload size={12} />
                )}
                {avatarVideoOptionsForMode.length > 0
                  ? mt.avatarBase.uploadOtherLabel
                  : mt.avatarBase.uploadLabel}
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => onUploadAvatar(e.target.files?.[0])}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {isTimeline && displayItems.length === 0 && (
        <EmptyState icon={Film} title={mt.emptyTimeline.title} hint={mt.emptyTimeline.hint} />
      )}

      {/* Seletor de bloco/cena — troca o workflow inteiro (clips, trechos,
          resultado) sem perder o trabalho de cada bloco. VSL: blocos = fatias
          do áudio. Creativo: cenas manuais. */}
      {isTimeline && displayItems.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              {mt.segments.heading}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {/* Imã (snap) + zoom/precisão do arraste */}
              <button
                onClick={() => setSnap((s) => !s)}
                title={snap ? mt.segments.snapOnTitle : mt.segments.snapOffTitle}
                className={`px-2 py-1.5 rounded-lg border text-[11px] font-black ${
                  snap
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500'
                }`}
              >
                {mt.segments.snapLabel}
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.5).toFixed(1))))}
                title={mt.segments.zoomOutTitle}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400"
              >
                <Minus size={14} />
              </button>
              <span className="text-[10px] font-black text-gray-400 w-8 text-center">{zoom}×</span>
              <button
                onClick={() => setZoom((z) => Math.min(4, Number((z + 0.5).toFixed(1))))}
                title={mt.segments.zoomInTitle}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={undo}
                disabled={histLens.past === 0}
                title={mt.segments.undoTitle}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 disabled:opacity-30"
              >
                <Undo2 size={14} />
              </button>
              <button
                onClick={redo}
                disabled={histLens.future === 0}
                title={mt.segments.redoTitle}
                className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-400 disabled:opacity-30"
              >
                <Redo2 size={14} />
              </button>
            </div>
          </div>
          {displayItems.map(({ it, idx }, pos) => (
            <div
              key={idx}
              className={`p-2 rounded-xl ring-1 bg-white dark:bg-gray-900/60 space-y-2 ${
                dragIdx === idx ? 'ring-2 ring-blue-500' : 'ring-gray-200 dark:ring-gray-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  onPointerDown={(e) => onDragStart(idx, e)}
                  title={mt.segments.dragTitle}
                  className="shrink-0 p-1 -ml-1 rounded text-gray-300 hover:text-gray-600 dark:hover:text-gray-200 cursor-ew-resize touch-none"
                >
                  <GripVertical size={16} />
                </button>
                <video
                  src={clips[it.clipIdx]?.url}
                  preload="metadata"
                  muted
                  loop
                  playsInline
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                  title={mt.segments.hoverPreviewTitle}
                  className="w-24 h-16 object-cover rounded bg-black shrink-0 cursor-pointer"
                />
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                  <span className="truncate font-bold text-gray-800 dark:text-gray-100 max-w-[100px]">
                    {clips[it.clipIdx]?.label || mt.segments.clipFallback}
                  </span>
                  <button
                    onClick={() => openSwap(idx)}
                    className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                    title={mt.segments.swapTitle}
                  >
                    {mt.segments.swapButton}
                  </button>
                  <button
                    onClick={() => playSegment(it.atSec, itemEnd(it))}
                    disabled={!audioUrl}
                    className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md border border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 disabled:opacity-40 inline-flex items-center gap-1"
                    title={mt.segments.listenTitle}
                  >
                    <Play size={10} /> {mt.segments.listenButton}
                  </button>
                  {mt.segments.startsAt}
                  <NumInput
                    value={it.atSec}
                    min={0}
                    onCommit={(n) => updateItem(idx, 'atSec', String(n))}
                    className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {mt.segments.endsAt}
                  <NumInput
                    value={itemEnd(it)}
                    min={0.5}
                    onCommit={(n) => updateItem(idx, 'endSec', String(n))}
                    className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {mt.segments.seconds}
                </div>
                <button
                  onClick={() => removeItem(idx)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 shrink-0"
                  title={mt.segments.removeTitle}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {/* Controles editáveis do trecho: destaque, P&B, split, efeito */}
              {(() => {
                const hlI = texts.findIndex((t) => t.atSec < itemEnd(it) && t.endSec > it.atSec);
                const hl = hlI >= 0 ? texts[hlI] : null;
                return (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] pl-1">
                    {/* Destaque (texto na tela) — editável */}
                    {hl ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-green-100 dark:bg-green-950/40">
                        <span className="text-green-700 dark:text-green-300">✍</span>
                        <input
                          value={hl.text}
                          onChange={(e) => updateText(hlI, { text: e.target.value })}
                          className="bg-transparent text-green-800 dark:text-green-200 font-black uppercase tracking-widest w-40 outline-none"
                        />
                        <button
                          onClick={() => removeText(hlI)}
                          className="text-green-600 hover:text-red-500"
                          title={mt.segments.removeHighlightTitle}
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() =>
                          setTexts((prev) => [
                            ...prev,
                            {
                              text: 'DESTAQUE',
                              atSec: Number(it.atSec.toFixed(2)),
                              endSec: Number(Math.min(itemEnd(it), it.atSec + 2.5).toFixed(2)),
                              color: '#39FF14',
                              pos: 'middle',
                            },
                          ])
                        }
                        className="px-2 py-0.5 rounded-lg border border-green-300 dark:border-green-800 text-green-700 dark:text-green-300 font-black uppercase tracking-widest hover:bg-green-50 dark:hover:bg-green-950/40"
                      >
                        {mt.segments.addHighlightButton}
                      </button>
                    )}
                    {/* P&B — toggle */}
                    <button
                      onClick={() => setItemField(idx, { bw: !it.bw })}
                      className={`px-2 py-0.5 rounded-lg font-black uppercase tracking-widest ${
                        it.bw
                          ? 'bg-gray-700 text-white'
                          : 'border border-gray-300 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                      title={mt.segments.bwTitle}
                    >
                      {mt.autoSlotsModal.bwBadge}
                    </button>
                    {/* Zoom (Ken Burns) — DURANTE o trecho inteiro, independente
                        de qualquer transição de entrada/saída. */}
                    <span className="inline-flex items-center rounded-lg border border-orange-300 dark:border-orange-800 overflow-hidden">
                      {(
                        [
                          { v: '', label: mt.segments.zoomNone },
                          { v: 'in', label: mt.segments.zoomInLabel },
                          { v: 'out', label: mt.segments.zoomOutLabel },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.v || 'none'}
                          onClick={() => setItemField(idx, { zoom: opt.v })}
                          title={
                            opt.v === 'in'
                              ? mt.segments.zoomInTitle2
                              : opt.v === 'out'
                                ? mt.segments.zoomOutTitle2
                                : mt.segments.zoomNoneTitle
                          }
                          className={`px-2 py-0.5 font-black uppercase tracking-widest inline-block ${
                            (it.zoom || '') === opt.v
                              ? `bg-orange-500 text-white ${opt.v === 'in' ? 'mv-zoom-live-in' : opt.v === 'out' ? 'mv-zoom-live-out' : ''}`
                              : 'text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/40'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </span>
                    {(it.zoom === 'in' || it.zoom === 'out') && clips[it.clipIdx]?.url && (
                      <ZoomTargetPicker
                        src={clips[it.clipIdx]!.url}
                        cx={it.zoomCX ?? 0.5}
                        cy={it.zoomCY ?? 0.5}
                        onChange={(zoomCX, zoomCY) => setItemField(idx, { zoomCX, zoomCY })}
                      />
                    )}
                    {/* Split de B-ROLL (2 b-rolls lado a lado) — add/trocar/remover */}
                    {it.clipIdx2 != null ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-black uppercase tracking-widest">
                        {mt.segments.splitBadge}
                        <button
                          onClick={() => openAddSplit(idx)}
                          className="hover:text-blue-600"
                          title={mt.segments.swapSplitTitle}
                        >
                          ⇄
                        </button>
                        <button
                          onClick={() => setItemField(idx, { clipIdx2: undefined })}
                          className="hover:text-red-500"
                          title={mt.segments.removeSplitTitle}
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => autoAddSplit(idx)}
                        className="px-2 py-0.5 rounded-lg border border-cyan-300 dark:border-cyan-800 text-cyan-700 dark:text-cyan-300 font-black uppercase tracking-widest hover:bg-cyan-50 dark:hover:bg-cyan-950/40"
                        title={mt.segments.addSplitTitle}
                      >
                        {mt.segments.addSplitButton}
                      </button>
                    )}
                    {/* Efeito contextual — trocar/remover/ouvir */}
                    {it.soundMid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-black uppercase tracking-widest">
                        🔊 {soundName(it.soundMid)}
                        <button
                          onClick={() => playSfx(it.soundMid!)}
                          className="hover:text-amber-600"
                          title={mt.segments.effectPlayTitle}
                        >
                          ▶
                        </button>
                        <button
                          onClick={() => setSoundPicker({ idx, field: 'soundMid' })}
                          className="hover:text-blue-600"
                          title={mt.segments.effectSwapTitle}
                        >
                          ⇄
                        </button>
                        <button
                          onClick={() => setItemField(idx, { soundMid: '' })}
                          className="hover:text-red-500"
                          title={mt.segments.effectRemoveTitle}
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setSoundPicker({ idx, field: 'soundMid' })}
                        className="px-2 py-0.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-black uppercase tracking-widest hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      >
                        {mt.segments.addEffectButton}
                      </button>
                    )}
                    {/* Layout com AVATAR — PiP (canto) ou split. Precisa do Avatar base. */}
                    <select
                      value={it.layout || 'full'}
                      onChange={(e) =>
                        setItemField(idx, { layout: e.target.value as TLItem['layout'] })
                      }
                      title={
                        avatarBase
                          ? mt.segments.layoutTitleWithAvatar
                          : mt.segments.layoutTitleNoAvatar
                      }
                      className={`px-2 py-1 rounded-lg border font-black uppercase tracking-widest ${
                        it.layout && it.layout !== 'full'
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 bg-transparent'
                      }`}
                    >
                      <option value="full">{mt.segments.layoutFull}</option>
                      <option value="avatar">{mt.segments.layoutAvatar}</option>
                      <option value="pip">{mt.segments.layoutPip}</option>
                      <option value="split-left">{mt.segments.layoutSplitLeft}</option>
                      <option value="split-right">{mt.segments.layoutSplitRight}</option>
                      <option value="split-top">{mt.segments.layoutSplitTop}</option>
                      <option value="split-bottom">{mt.segments.layoutSplitBottom}</option>
                    </select>
                    {/* Enquadramento SÓ deste trecho — sobrepõe o global (crop/split/
                        PiP/proporção). Útil quando um trecho precisa de mais espaço
                        (ex.: avatar + boneca) e os outros não. */}
                    {it.layout && it.layout !== 'full' && avatarBase && (
                      <span className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setPerTrechoFraming(idx)}
                          className={`px-2 py-0.5 rounded-lg font-black uppercase tracking-widest ${
                            it.frameOverride
                              ? 'bg-fuchsia-600 text-white'
                              : 'border border-fuchsia-300 dark:border-fuchsia-800 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/40'
                          }`}
                          title={mt.segments.frameTitle}
                        >
                          {it.frameOverride
                            ? mt.segments.frameOwnButton
                            : mt.segments.frameGenericButton}
                        </button>
                        {it.frameOverride && (
                          <button
                            onClick={() => setItemField(idx, { frameOverride: undefined })}
                            className="text-fuchsia-500 hover:text-red-500"
                            title={mt.segments.frameResetTitle}
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    )}
                    {/* Pan do b-roll no split — reposiciona pra não cortar o assunto. */}
                    {it.layout &&
                      it.layout.startsWith('split') &&
                      (() => {
                        const horiz = it.layout === 'split-left' || it.layout === 'split-right';
                        const key = horiz ? 'brollCX' : 'brollCY';
                        const val = ((it as any)[key] ?? 0.5) as number;
                        return (
                          <label
                            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-500"
                            title={mt.segments.brollPanTitle}
                          >
                            {horiz ? mt.segments.brollPanTitleH : mt.segments.brollPanTitleV}
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(val * 100)}
                              onChange={(e) =>
                                setItemField(idx, { [key]: Number(e.target.value) / 100 } as any)
                              }
                              className="w-20 accent-violet-600"
                            />
                          </label>
                        );
                      })()}
                    {/* Prévia AO VIVO do split (CSS) — reflete o pan e a proporção
                        efetiva (override do trecho, senão o global) sem renderizar. */}
                    {it.layout &&
                      it.layout.startsWith('split') &&
                      avatarBase &&
                      clips[it.clipIdx]?.url &&
                      (() => {
                        const fr = it.frameOverride || framing;
                        const vertical = it.layout === 'split-top' || it.layout === 'split-bottom';
                        const avatarFirst = it.layout === 'split-left' || it.layout === 'split-top';
                        const brCX = it.brollCX ?? 0.5;
                        const brCY = it.brollCY ?? 0.5;
                        const ratioPct = Math.round((fr.splitRatio ?? 0.5) * 100);
                        const aspectClass =
                          aspect === '1:1'
                            ? 'aspect-square'
                            : aspect === '16:9'
                              ? 'aspect-video'
                              : aspect === '4:5'
                                ? 'aspect-[4/5]'
                                : 'aspect-[9/16]';
                        const av = (
                          <video
                            src={avatarBase}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover"
                            style={{
                              objectPosition: `${(fr.splitCX ?? 0.5) * 100}% ${(fr.splitCY ?? 0.4) * 100}%`,
                            }}
                          />
                        );
                        const br = (
                          <video
                            src={clips[it.clipIdx]?.url}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover"
                            style={{ objectPosition: `${brCX * 100}% ${brCY * 100}%` }}
                          />
                        );
                        const avStyle = { flex: `${ratioPct} 0 0%` };
                        const brStyle = { flex: `${100 - ratioPct} 0 0%` };
                        return (
                          <div className="basis-full flex items-center gap-2 pt-1">
                            <span className="text-[9px] text-gray-400 uppercase tracking-widest">
                              {mt.segments.previewLabel}{' '}
                              {it.frameOverride && (
                                <span className="text-fuchsia-500">{mt.segments.previewOwn}</span>
                              )}
                            </span>
                            <div
                              className={`w-28 ${aspectClass} rounded-lg overflow-hidden bg-black flex ${vertical ? 'flex-col' : 'flex-row'} ring-1 ring-violet-400`}
                            >
                              <div
                                className="min-w-0 min-h-0 overflow-hidden"
                                style={avatarFirst ? avStyle : brStyle}
                              >
                                {avatarFirst ? av : br}
                              </div>
                              <div
                                className="min-w-0 min-h-0 overflow-hidden"
                                style={avatarFirst ? brStyle : avStyle}
                              >
                                {avatarFirst ? br : av}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                  </div>
                );
              })()}
              {(['In', 'Out'] as const).map((side) => {
                const typeKey = side === 'In' ? 'transIn' : 'transOut';
                const durKey = side === 'In' ? 'transInDur' : 'transOutDur';
                const sndKey = side === 'In' ? 'soundIn' : 'soundOut';
                const type = (it as any)[typeKey] || 'none';
                const dur = (it as any)[durKey] ?? 0.1;
                const snd = (it as any)[sndKey];
                // Avatar contínuo (mesmo layout no vizinho) → transição cancelada
                // nesse corte; mostra aviso em vez de um select que não é aplicado.
                const cancelled =
                  side === 'In'
                    ? pos > 0 && avatarContinuousBoundary(displayItems[pos - 1]!.it, it)
                    : pos < displayItems.length - 1 &&
                      avatarContinuousBoundary(it, displayItems[pos + 1]!.it);
                if (cancelled) {
                  return (
                    <div
                      key={side}
                      className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400 pl-1"
                    >
                      <span className="w-12 font-bold">
                        {side === 'In' ? mt.segments.transitionIn : mt.segments.transitionOut}
                      </span>
                      <span className="italic">{mt.segments.noTransitionContinuous}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={side}
                    className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 pl-1"
                  >
                    <span className="w-12 font-bold">
                      {side === 'In' ? mt.segments.transitionIn : mt.segments.transitionOut}
                    </span>
                    <select
                      value={type}
                      onChange={(e) => {
                        const v = e.target.value;
                        const patch: any = { [typeKey]: v };
                        // Qualquer transição (≠ none) → aplica o som certo pelo
                        // tipo, se aquele lado ainda não tiver som.
                        if (v !== 'none' && !(it as any)[sndKey]) {
                          const snd = soundForTransition(v);
                          if (snd) patch[sndKey] = snd;
                        }
                        setItemField(idx, patch);
                      }}
                      className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                    >
                      {TRANSITIONS.map((trans) => (
                        <option key={trans.id} value={trans.id}>
                          {transitionLabel(trans.id)}
                        </option>
                      ))}
                    </select>
                    {type !== 'none' && (
                      <>
                        {mt.segments.durationLabel}
                        <NumInput
                          value={dur}
                          min={0.1}
                          onCommit={(n) => setItemField(idx, { [durKey]: Math.max(0.1, n) })}
                          className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                        />
                        {mt.segments.seconds2}
                        <button
                          type="button"
                          onClick={() => setSoundPicker({ idx, field: sndKey })}
                          className="cursor-pointer text-blue-700 dark:text-blue-300 font-bold hover:underline"
                        >
                          {snd ? mt.segments.soundApplied : mt.segments.addSound}
                        </button>
                        {snd && (
                          <button
                            onClick={() => {
                              const a = new Audio(snd as string);
                              a.play().catch(() => {});
                            }}
                            className="text-purple-600 dark:text-purple-400 hover:text-purple-800"
                            title={mt.segments.playSoundTitle}
                          >
                            <Play size={11} />
                          </button>
                        )}
                        {snd && (
                          <button
                            onClick={() => setItemField(idx, { [sndKey]: '' })}
                            className="text-gray-400 hover:text-red-500"
                            title={mt.segments.removeSoundTitle}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* BLOCOS — fatia VSL longa em pedaços de ~2 min cortados nos silêncios */}
      {isTimeline && (audioDuration > 150 || blockEnds.length > 0) && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-amber-300 dark:border-amber-900/60 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
              {mt.blocks.heading}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {mt.blocks.description(Math.round(blockSizeSec / 60))}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-gray-500 dark:text-gray-400">{mt.blocks.sizeLabel}</span>
            <input
              type="number"
              min={30}
              max={600}
              value={blockSizeSec}
              onChange={(e) =>
                setBlockSizeSec(Math.max(30, Math.min(600, Number(e.target.value) || 120)))
              }
              className="w-16 px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-transparent"
            />
            <span className="text-gray-500 dark:text-gray-400">
              {mt.blocks.secondsMinSuffix(Math.round(blockSizeSec / 60))}
            </span>
            <button
              onClick={fatiarEmBlocos}
              disabled={fatiando}
              className="px-3 py-1 rounded-lg bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600 disabled:opacity-60"
            >
              {fatiando
                ? mt.blocks.findingSilences
                : blockEnds.length > 0
                  ? mt.blocks.reslice
                  : mt.blocks.slice}
            </button>
          </div>
          {blockEnds.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {blockEnds.map((end, i) => {
                const start = i === 0 ? 0 : blockEnds[i - 1]!;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 p-1.5 rounded-lg text-[11px] ${
                      activeBlock === i
                        ? 'bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-400'
                        : 'bg-gray-50 dark:bg-gray-800'
                    }`}
                  >
                    <span className="font-black text-amber-700 dark:text-amber-300 w-16 shrink-0">
                      {mt.blocks.blockLabel(i + 1)}
                    </span>
                    <span className="font-mono text-gray-600 dark:text-gray-300">
                      {fmtT(start)} –
                    </span>
                    {/* Fim EDITÁVEL: mexer aqui empurra o início do próximo bloco */}
                    <input
                      type="text"
                      defaultValue={fmtT(end)}
                      onBlur={(e) => {
                        const parts = e.target.value.split(':').map((x) => Number(x) || 0);
                        const secs = parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]!;
                        if (secs > start + 5) {
                          setBlockEnds((prev) => {
                            const next = [...prev];
                            next[i] = Math.round(secs * 10) / 10;
                            // mantém encadeado: fins seguintes >= este
                            for (let k = i + 1; k < next.length; k++) {
                              if (next[k]! <= next[k - 1]!) next[k] = next[k - 1]! + blockSizeSec;
                            }
                            return next;
                          });
                        }
                      }}
                      className="w-16 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-800 bg-transparent font-mono"
                      title={mt.blocks.endTitle}
                    />
                    <span className="text-gray-400">({fmtT(end - start)})</span>
                    <button
                      onClick={() => trabalharNoBloco(i)}
                      className="ml-auto px-2 py-0.5 rounded-lg bg-amber-500 text-white font-black uppercase tracking-widest hover:bg-amber-600"
                    >
                      {activeBlock === i ? mt.blocks.workingOnThis : mt.blocks.workOn}
                    </button>
                  </div>
                );
              })}
              <p className="text-[10px] text-gray-400 pt-1">{mt.blocks.hint}</p>
            </div>
          )}
        </div>
      )}

      {/* AUTO-EDITAR — monta a timeline sozinho a partir da voz da VSL */}
      {isTimeline && (
        <div className="bg-gradient-to-br from-purple-600 to-fuchsia-600 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm font-black text-white">{mt.autoEditBanner.title}</p>
            <p className="text-[11px] text-white/80">{mt.autoEditBanner.description}</p>
            {/* Ritmo — quantos trechos (menor base = mais trechos) */}
            <div className="mt-2 flex items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-white/80 mr-1">
                {mt.autoEditBanner.segmentsLabel}
              </span>
              {[
                { label: mt.autoEditBanner.paceLess, sec: 13.5 },
                { label: mt.autoEditBanner.paceMedium, sec: 10 },
                { label: mt.autoEditBanner.paceMore, sec: 7 },
                { label: mt.autoEditBanner.paceALot, sec: 4.5 },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setCutPace(o.sec)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                    cutPace === o.sec
                      ? 'bg-white text-purple-700'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={mt.autoEditBanner.paceTitle(o.sec)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={autoEdit}
            disabled={autoEditing}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-white text-purple-700 font-black uppercase tracking-widest text-xs hover:bg-purple-50 disabled:opacity-60 flex items-center gap-2"
          >
            {autoEditing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> {mt.autoEditBanner.composing}
              </>
            ) : (
              mt.autoEditBanner.button
            )}
          </button>
        </div>
      )}

      {/* TEXTO CINÉTICO NA TELA (estilo VSL) */}
      {isTimeline && (
        <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              {mt.kineticText.heading}
            </span>
            <button
              onClick={addText}
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
            >
              {mt.kineticText.addAtPlayhead(playhead.toFixed(1))}
            </button>
          </div>
          {texts.length === 0 ? (
            <p className="text-[10px] text-gray-400">{mt.kineticText.emptyHint}</p>
          ) : (
            <div className="space-y-2">
              {texts.map((t, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 p-2 rounded-xl border border-gray-200 dark:border-gray-800"
                >
                  <input
                    value={t.text}
                    onChange={(e) => updateText(i, { text: e.target.value })}
                    className="flex-1 min-w-[120px] px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-sm font-black uppercase"
                  />
                  <span className="text-[10px] text-gray-400">{mt.kineticText.from}</span>
                  <NumInput
                    value={t.atSec}
                    min={0}
                    onCommit={(n) => updateText(i, { atSec: n })}
                    className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <span className="text-[10px] text-gray-400">{mt.kineticText.to}</span>
                  <NumInput
                    value={t.endSec}
                    min={0.1}
                    onCommit={(n) => updateText(i, { endSec: n })}
                    className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <div className="flex items-center gap-1">
                    {TEXT_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => updateText(i, { color: c })}
                        className={`w-5 h-5 rounded-full border-2 ${t.color === c ? 'border-gray-900 dark:border-white' : 'border-transparent'}`}
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                  <select
                    value={t.pos}
                    onChange={(e) => updateText(i, { pos: e.target.value as any })}
                    className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100 text-[11px]"
                  >
                    <option value="top">{mt.kineticText.positionTop}</option>
                    <option value="middle">{mt.kineticText.positionMiddle}</option>
                    <option value="bottom">{mt.kineticText.positionBottom}</option>
                  </select>
                  <button
                    onClick={() => removeText(i)}
                    className="p-1 rounded text-gray-400 hover:text-red-500"
                    title={mt.kineticText.removeTitle}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BUSCAR B-ROLL NO PEXELS → adiciona à biblioteca */}
      <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 space-y-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
          {mt.pexelsSearch.heading}
        </span>
        <div className="flex gap-2">
          <input
            value={pexQuery}
            onChange={(e) => setPexQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doPexSearch()}
            placeholder="Ex: dry cracked earth, water tap, empty shelves…"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-gray-100"
          />
          <button
            onClick={doPexSearch}
            disabled={pexSearching}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50"
          >
            {pexSearching ? <Loader2 size={14} className="animate-spin" /> : mt.pexelsSearch.button}
          </button>
        </div>
        {pexResults.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {pexResults.map((c) => (
              <button
                key={c.id}
                onClick={() => addPexClip(c)}
                title={mt.pexelsSearch.addTitle}
                className="relative rounded-lg overflow-hidden ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-blue-500"
              >
                <video
                  src={c.url}
                  poster={c.thumb}
                  muted
                  loop
                  playsInline
                  preload="none"
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                  onMouseLeave={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    v.pause();
                    v.currentTime = 0;
                  }}
                  className="w-full h-24 object-cover bg-black"
                />
                <span className="absolute bottom-1 right-1 text-[9px] font-black bg-black/70 text-white px-1 rounded pointer-events-none">
                  {Number(c.duration).toFixed(0)}s
                </span>
                <span className="absolute top-1 left-1 bg-blue-600 text-white rounded-full p-0.5">
                  <Plus size={11} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* BIBLIOTECA de trechos (upload) — clique OU arraste os vídeos aqui */}
      <label
        {...uploadDrop}
        className={`flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed text-sm font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 cursor-pointer transition-colors ${
          dragUpload
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
            : 'border-gray-300 dark:border-gray-700 hover:border-blue-400'
        }`}
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {dragUpload
          ? mt.uploadLibrary.dropHere
          : isTimeline
            ? mt.uploadLibrary.uploadTimeline
            : mt.uploadLibrary.uploadSequence}
        <input
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
      </label>

      {/* Em modo SEQUÊNCIA, a biblioteca É a ordem dos clipes */}
      {!isTimeline && clips.length > 0 && (
        <div className="space-y-3">
          {clips.map((c, i) => (
            <div
              key={c.url + i}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl ring-1 ring-gray-200 dark:ring-gray-700 bg-white dark:bg-gray-900/60"
            >
              <span className="text-xs font-black text-gray-400 w-6 shrink-0">{i + 1}</span>
              <video
                src={c.url}
                controls
                preload="metadata"
                className="w-36 h-24 object-cover rounded-lg bg-black shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">
                  {c.label}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                  {mt.sequence.usesFrom}
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder={mt.sequence.startPlaceholder}
                    value={c.startSec ?? ''}
                    onChange={(e) => setTrim(i, 'startSec', e.target.value)}
                    className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {mt.sequence.to}
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder={mt.sequence.endPlaceholder}
                    value={c.endSec ?? ''}
                    onChange={(e) => setTrim(i, 'endSec', e.target.value)}
                    className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-gray-100"
                  />
                  {mt.sequence.secondsEmptyFull}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === clips.length - 1}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={() => removeClip(i)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!isTimeline && clips.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => setMuted(false)}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${!muted ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
          >
            {mt.mutedToggle.keepAudio}
          </button>
          <button
            onClick={() => setMuted(true)}
            className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all ${muted ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
          >
            {mt.mutedToggle.muted}
          </button>
        </div>
      )}

      {/* Formato + enquadramento do vídeo montado */}
      <div className="bg-white dark:bg-gray-900/70 p-3 rounded-2xl border-2 border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Moldes: salva formato+enquadramento+ritmo pra reaplicar num clique */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            {mt.formatSection.templateLabel}
          </span>
          {templates.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && applyTemplate(e.target.value)}
              className="px-2 py-1 rounded-lg border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[11px] dark:text-gray-100"
            >
              <option value="">{mt.formatSection.applyPlaceholder}</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={saveTemplate}
            className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border-2 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40"
          >
            {mt.formatSection.saveTemplateButton}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            {mt.formatSection.formatLabel}
          </span>
          {(['9:16', '4:5', '1:1', '16:9'] as const).map((ar) => (
            <button
              key={ar}
              onClick={() => setAspect(ar)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border-2 transition-all ${
                aspect === ar
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {ar === '9:16'
                ? mt.formatSection.vertical
                : ar === '4:5'
                  ? mt.formatSection.feed
                  : ar === '1:1'
                    ? mt.formatSection.square
                    : mt.formatSection.horizontal}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
            {mt.formatSection.fitLabel}
          </span>
          {(
            [
              { id: 'cover', label: mt.formatSection.fitCover },
              { id: 'contain', label: mt.formatSection.fitContain },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFit(f.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border-2 transition-all ${
                fit === f.id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isTimeline && timelineWarnings.length > 0 && (
        <div className="p-3 rounded-2xl ring-1 ring-amber-300 dark:ring-amber-800 bg-amber-50/70 dark:bg-amber-950/20 space-y-1.5">
          <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
            <span className="text-sm">⚠️</span>
            <span className="text-[11px] font-black uppercase tracking-widest">
              {mt.warnings.countBeforeCompose(timelineWarnings.length)}
            </span>
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {timelineWarnings.map((wmsg, i) => (
              <li key={i} className="text-[11px] text-amber-800/90 dark:text-amber-300/90">
                {wmsg}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70">
            {mt.warnings.composeAnywayHint}
          </p>
        </div>
      )}

      <button
        onClick={compose}
        disabled={
          rendering || (isTimeline ? items.length === 0 || !audioDuration : clips.length === 0)
        }
        className="w-full py-3.5 bg-blue-700 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {rendering ? (
          <>
            <Loader2 size={16} className="animate-spin" /> {mt.composeButton.composing}
          </>
        ) : (
          <>
            <Check size={16} />{' '}
            {isTimeline
              ? mt.composeButton.composeTimeline(items.length)
              : mt.composeButton.composeSequence(clips.length)}
          </>
        )}
      </button>

      {/* PRÉVIA RÁPIDA: rascunho em baixa resolução pra ver o corte antes do
          render final (bem mais rápido). Só na timeline. */}
      {isTimeline && (
        <button
          onClick={composeDraft}
          disabled={previewing || rendering || items.length === 0 || !audioDuration}
          className="w-full -mt-1 py-2.5 rounded-2xl font-black uppercase tracking-widest text-xs border-2 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          title={mt.previewDraft.title}
        >
          {previewing ? (
            <>
              <Loader2 size={14} className="animate-spin" /> {mt.previewDraft.generating}
            </>
          ) : (
            <>
              <Play size={14} /> {mt.previewDraft.button}
            </>
          )}
        </button>
      )}

      {previewUrl && (
        <div className="space-y-2 p-3 rounded-2xl ring-1 ring-blue-200 dark:ring-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
              {mt.previewDraft.label}
            </p>
            <button
              onClick={() => setPreviewUrl('')}
              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
            >
              <X size={12} /> {mt.previewDraft.close}
            </button>
          </div>
          <video src={previewUrl} controls className="w-full max-h-[360px] rounded-xl bg-black" />
          <p className="text-[10px] text-gray-500">{mt.previewDraft.footnote}</p>
        </div>
      )}

      {resultUrl && (
        <div className="space-y-3 p-4 rounded-2xl ring-1 ring-green-200 dark:ring-green-900 bg-green-50/60 dark:bg-green-950/30">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-widest text-green-700 dark:text-green-300">
              {mt.result.readyLabel}
            </p>
            <button
              onClick={() => setResultUrl('')}
              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500"
              title={mt.result.deleteTitle}
            >
              <Trash2 size={12} /> {mt.result.deleteButton}
            </button>
          </div>
          <video src={resultUrl} controls className="w-full max-h-[420px] rounded-xl bg-black" />
          {resultHistory.length > 1 && (
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                {mt.result.versionsLabel(resultHistory.length)}
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {resultHistory.map((v, i) => {
                  const atual = v.url === resultUrl;
                  return (
                    <div key={v.url} className="shrink-0 w-24 space-y-1">
                      <video
                        src={v.url}
                        muted
                        preload="metadata"
                        className={`w-24 h-16 object-cover rounded-lg bg-black ring-2 ${atual ? 'ring-green-500' : 'ring-transparent'}`}
                      />
                      <button
                        onClick={() => setResultUrl(v.url)}
                        disabled={atual}
                        className={`w-full text-[9px] font-black uppercase tracking-widest px-1 py-1 rounded ${atual ? 'bg-green-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
                      >
                        {atual ? mt.result.current : i === 0 ? mt.result.newest : mt.result.use}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <button
            onClick={gerarMusicaEColar}
            disabled={musicGen}
            className="w-full py-3 bg-purple-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-purple-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {musicGen ? (
              <>
                <Loader2 size={16} className="animate-spin" /> {mt.result.generatingMusic}
              </>
            ) : (
              <>
                <Music size={16} /> {mt.result.generateMusicButton}
              </>
            )}
          </button>
          <div className="space-y-1.5">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
              {mt.result.coverTextLabel}
            </span>
            <input
              type="text"
              value={coverText}
              onChange={(e) => setCoverText(e.target.value)}
              placeholder={mt.result.coverTextPlaceholder}
              maxLength={60}
              className="w-full px-3 py-2 rounded-xl ring-1 ring-gray-200 dark:ring-gray-800 bg-white dark:bg-gray-900 text-sm font-bold text-gray-800 dark:text-gray-100"
            />
            <label className="flex items-center gap-2 text-[11px] font-bold text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={coverUseAtPlayhead}
                onChange={(e) => setCoverUseAtPlayhead(e.target.checked)}
                className="rounded"
              />
              {mt.result.useCurrentMomentLabel}
            </label>
          </div>
          <button
            onClick={gerarCapa}
            disabled={coverGen}
            className="w-full py-3 bg-pink-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-pink-700 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {coverGen ? (
              <>
                <Loader2 size={16} className="animate-spin" /> {mt.result.generatingCovers}
              </>
            ) : (
              <>
                <ImageIcon size={16} /> {mt.result.generateCoversButton}
              </>
            )}
          </button>
          {coverOptions.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
                {mt.result.chooseCoverLabel}
              </span>
              <div
                className={`grid gap-2 ${coverOptions.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}
              >
                {coverOptions.map((u, i) => {
                  const chosen = u === coverUrl;
                  return (
                    <div key={u} className="space-y-1">
                      <button
                        onClick={() => setCoverUrl(u)}
                        className={`relative w-full rounded-xl overflow-hidden ring-2 ${
                          chosen ? 'ring-pink-500' : 'ring-transparent hover:ring-gray-300'
                        }`}
                        title={chosen ? mt.result.coverChosenTitle : mt.result.coverUseTitle}
                      >
                        <img
                          src={u}
                          alt={`capa ${i + 1}`}
                          className="w-full object-contain bg-black max-h-[280px]"
                        />
                        {chosen && (
                          <span className="absolute top-1 right-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-pink-600 text-white text-[9px] font-black uppercase">
                            <Check size={10} /> {mt.result.coverChosenBadge}
                          </span>
                        )}
                      </button>
                      <a
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:underline"
                      >
                        <Download size={11} /> {mt.result.download}
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <WatermarkPanel
            videoUrl={resultUrl}
            uid={uid}
            aspect={aspect}
            onApplied={(url) => {
              setResultUrl(url);
              onAddUploadedVideo?.(
                { url, uploaded: true, aspectRatio: aspect, createdAt: new Date().toISOString() },
                false
              );
              triggerProjectSave('marca-dagua');
            }}
          />
          {onRemix && (
            <button
              onClick={onRemix}
              className="w-full py-3 rounded-2xl font-black uppercase tracking-widest text-sm border-2 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 flex items-center justify-center gap-2"
              title={mt.result.remixTitle}
            >
              <Plus size={16} /> {mt.result.remixButton}
            </button>
          )}
          {onGoToEdit && (
            <button
              onClick={onGoToEdit}
              className="w-full py-3 bg-gray-900 dark:bg-gray-50 text-white dark:text-gray-900 rounded-2xl font-black uppercase tracking-widest text-sm hover:opacity-90"
            >
              {mt.result.goToEditButton}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
