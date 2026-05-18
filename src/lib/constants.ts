// Pure data constants extracted from App.tsx. These are top-level (no
// closure over React state) so they live happily in a lib file. Imports
// are mirrored in App.tsx so behavior is identical to the inline version.
import {
  Clapperboard,
  Edit3,
  Layout,
  RefreshCw,
  Sparkles,
  Star,
  User,
  Users,
  Video,
  Wand2,
  Zap,
} from 'lucide-react';
import type { Step } from '../types/project';

export const DURATION_OPTIONS = [
  { label: '15s', words: 38 },
  { label: '30s', words: 75 },
  { label: '45s', words: 113 },
  { label: '60s', words: 150 },
  { label: '90s', words: 225 },
  { label: '120s', words: 300 },
  { label: '180s', words: 450 },
];

export const HOOK_TYPES_BY_LEVEL: Record<string, string[]> = {
  '1': ['Surpresa / Choque', 'Curiosidade / Pergunta', 'Identificação'],
  '2': ['Identificação', 'Confissão / História', 'Quebra de Paradigma'],
  '3': ['Quebra de Paradigma', 'Contraste / Antes-Depois', 'Resultado / Promessa'],
  '4': ['Resultado / Promessa', 'Contraste / Antes-Depois', 'Surpresa / Choque'],
  '5': ['Resultado / Promessa', 'Urgência / Notícia', 'Humor / Absurdo'],
};

export const AVATAR_ENRICHMENT: Record<string, any> = {
  josh_lite_20230714: { gender: 'male', age: 'young', type: 'realistic' },
  erica_lite_20230714: { gender: 'female', age: 'young', type: 'realistic' },
  ann_lite_20230714: { gender: 'female', age: 'adult', type: 'realistic' },
  bryan_lite_20230714: { gender: 'male', age: 'adult', type: 'realistic' },
  lucas_lite_20230714: { gender: 'male', age: 'mature', type: 'realistic' },
  clara_lite_20230714: { gender: 'female', age: 'mature', type: 'realistic' },
};

export const HEYGEN_NAME_KEYWORDS = {
  styles: {
    Professional: [
      'business',
      'biztalk',
      'office',
      'formal',
      'executive',
      'suit',
      'corporate',
      'nurse',
      'doctor',
    ],
    Lifestyle: [
      'lounge',
      'casual',
      'yoga',
      'home',
      'outdoor',
      'sport',
      'fitness',
      'shirt',
      'bar',
      'sitting',
    ],
    UGC: ['ugc', 'selfie', 'creator', 'vlog', 'natural', 'authentic'],
    Community: ['community', 'group', 'social', 'friendly'],
  },
  ages: {
    'Young Adult': ['young', 'teen', 'student', 'junior'],
    'Middle Aged': ['adult', 'senior', 'middle', 'manager', 'parent'],
    Elderly: ['elderly', 'grandma', 'grandpa', 'senior', 'older'],
  },
  ethnicities: {
    White: ['adriana', 'amelia', 'annie', 'blanka', 'carla', 'chloe', 'ann', 'bahar'],
    Asian: ['aiko', 'yuna', 'mei', 'jin', 'kenji', 'sakura', 'hana'],
    'South Asian': ['priya', 'ananya', 'raj', 'vikram', 'aisha'],
    Latino: ['sofia', 'carlos', 'miguel', 'rosa', 'lucia', 'pedro'],
    'Middle Eastern': ['bahar', 'layla', 'omar', 'yasmin', 'zara'],
    Black: ['alicia', 'james', 'marcus', 'diana', 'jordan', 'nova'],
  },
};

export const AD_STYLES = [
  {
    id: 'direto',
    emoji: '🎯',
    label: 'Direto ao Ponto',
    desc: 'Vai direto para a oferta, sem enrolação',
  },
  {
    id: 'storytelling',
    emoji: '📖',
    label: 'Storytelling',
    desc: 'Prende com uma história antes de vender',
  },
  {
    id: 'problema_solucao',
    emoji: '🔁',
    label: 'Problema → Solução',
    desc: 'Mostra a dor do cliente e posiciona o produto como resposta',
  },
  {
    id: 'prova_social',
    emoji: '🏆',
    label: 'Prova Social',
    desc: 'Usa resultados reais e depoimentos para convencer',
  },
  {
    id: 'curiosidade',
    emoji: '🪝',
    label: 'Gancho de Curiosidade',
    desc: 'Abre uma pergunta que faz o espectador querer saber mais',
  },
  {
    id: 'urgencia',
    emoji: '⏳',
    label: 'Urgência / Escassez',
    desc: 'Cria pressão de tempo ou quantidade limitada',
  },
  {
    id: 'profissional',
    emoji: '💼',
    label: 'Profissional / Autoridade',
    desc: 'Tom sério e confiável, ideal para B2B ou serviços premium',
  },
  {
    id: 'humor',
    emoji: '😂',
    label: 'Humor / Entretenimento',
    desc: 'Usa leveza e humor para prender atenção e criar identificação',
  },
  {
    id: 'antes_depois',
    emoji: '🔄',
    label: 'Antes e Depois',
    desc: 'Mostra a transformação que o produto causa na vida do cliente',
  },
  {
    id: 'educativo',
    emoji: '💡',
    label: 'Educativo',
    desc: 'Ensina algo valioso antes de apresentar o produto como solução',
  },
  {
    id: 'inspirador',
    emoji: '❤️',
    label: 'Inspirador',
    desc: 'Desperta emoção e conecta o produto a uma aspiração maior',
  },
];

export const STEPS: { id: Step; label: string; icon: any }[] = [
  { id: 'integrations', label: 'Integrações', icon: RefreshCw },
  { id: 'projects', label: 'Meus Projetos', icon: Layout },
  { id: 'persona', label: 'Identificar Persona', icon: Users },
  { id: 'copy', label: 'Copy', icon: Edit3 },
  { id: 'hook-visual', label: 'Copy do Gancho', icon: Clapperboard },
  { id: 'voz-premium', label: 'Voz', icon: Sparkles },
  { id: 'avatar', label: 'Avatar', icon: User },
  { id: 'edit-zap', label: 'Edição Zap', icon: Zap },
  { id: 'edit2', label: 'Edição Premium', icon: Wand2 },

  { id: 'final', label: 'Exportar', icon: Video },
];

export const VEO_MODELS = [
  {
    id: 'veo-3.1-lite-generate-preview',
    label: 'VEO 3.1 Lite',
    desc: 'Rápido e econômico (Rascunho)',
    icon: Zap,
    engine: 'veo',
  },
  {
    id: 'veo-3.1-generate-preview',
    label: 'VEO 3.1 Premium',
    desc: 'Alta qualidade e realismo',
    icon: Star,
    engine: 'veo',
  },
  {
    id: 'gen3a_turbo',
    label: 'Runway Gen-3 Turbo',
    desc: 'Realismo cinematográfico',
    icon: Sparkles,
    engine: 'runway',
    hidden: true,
  },
];

export const SUBTITLE_STYLES = [
  { id: 'simple', label: 'Simples', class: 'text-white font-sans' },
  {
    id: 'bold_ad',
    label: 'Negrito (Estilo Anúncio)',
    class: 'text-yellow-400 font-bold uppercase italic',
  },
  {
    id: 'animated',
    label: 'Animado',
    class: 'text-white font-black uppercase tracking-widest',
  },
  {
    id: 'word_by_word',
    label: 'Palavra por Palavra',
    class: 'text-white bg-black/50 px-2',
  },
  {
    id: 'highlighted',
    label: 'Destaque de Palavra-chave',
    class: 'text-white bg-blue-600 px-2',
  },
  {
    id: 'neon',
    label: 'Brilho Neon',
    class: 'text-[#39FF14] font-mono font-bold',
  },
  { id: 'minimal', label: 'Minimalista', class: 'text-gray-200 font-light' },
  {
    id: 'caption_box',
    label: 'Caixa de Legenda',
    class: 'text-black bg-white px-2',
  },
  { id: 'retro', label: 'Retro VHS', class: 'text-cyan-300 font-mono italic' },
  {
    id: 'gradient',
    label: 'Gradiente',
    class: 'text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 font-bold',
  },
];

export const AVATARS = [
  // Men
  {
    id: 'm1',
    name: 'Alex',
    gender: 'male',
    img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'm2',
    name: 'Marcus',
    gender: 'male',
    img: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'm3',
    name: 'David',
    gender: 'male',
    img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'm4',
    name: 'James',
    gender: 'male',
    img: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'm5',
    name: 'Leo',
    gender: 'male',
    img: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&h=400',
  },
  // Women
  {
    id: 'f1',
    name: 'Sarah',
    gender: 'female',
    img: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'f2',
    name: 'Elena',
    gender: 'female',
    img: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'f3',
    name: 'Maya',
    gender: 'female',
    img: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'f4',
    name: 'Chloe',
    gender: 'female',
    img: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=400&h=400',
  },
  {
    id: 'f5',
    name: 'Sofia',
    gender: 'female',
    img: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&h=400',
  },
];

