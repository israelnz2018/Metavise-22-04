// Pure data constants extracted from App.tsx. These are top-level (no
// closure over React state) so they live happily in a lib file. Imports
// are mirrored in App.tsx so behavior is identical to the inline version.
//
// The PERSONA_* groups feed the 9-question form in renderPersonaStep.
// They were inlined inside the render function; pulling them up avoids
// re-allocating the arrays on every re-render.
import {
  Clapperboard,
  Edit3,
  Layout,
  RefreshCw,
  Sparkles,
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


// ─── Persona-step form options ──────────────────────────────────────

export const PERSONA_CATEGORY_OPTIONS = [
  'Infoproduto',
  'Produto físico',
  'SaaS',
  'Serviço local',
  'Saúde/Bem-estar',
  'Estética',
  'Educação',
  'Finanças',
  'Negócios',
  'Relacionamento',
  'Carreira',
  'Pets',
  'Maternidade',
  'Consultoria',
  'E-commerce',
  'Afiliados',
  'Aplicativo',
  'B2B',
  'Outro',
];

export const PERSONA_URGENCY_OPTIONS = [
  { value: 'Crítica', label: '🔥 Crítica', desc: 'dor física/financeira agora' },
  { value: 'Alta', label: '⚡ Alta', desc: 'afeta o dia a dia' },
  { value: 'Média', label: '⏳ Média', desc: 'incomoda mas tolera' },
  { value: 'Baixa', label: '💭 Baixa', desc: 'curiosidade/melhoria' },
];

export const PERSONA_DIFFERENTIAL_OPTIONS = [
  'Mais rápido',
  'Mais simples',
  'Mais barato',
  'Personalizado',
  'Usa IA',
  'Tem acompanhamento',
  'Método próprio',
  'Prova científica',
  'Garantia',
  'Resultado prático',
  'Natural',
  'Pra iniciantes',
  'Pra avançados',
  'Único no mercado',
  'Recomendado por especialistas',
];

export const PERSONA_TRIED_BEFORE_OPTIONS = [
  'Outros cursos',
  'Remédios',
  'Aplicativos',
  'Planilhas',
  'Dietas',
  'Academia',
  'Consultorias',
  'Vídeos grátis',
  'Produtos concorrentes',
  'Dicas de internet',
  'Profissionais',
  'Métodos caseiros',
  'Nada ainda',
];

export const PERSONA_PAYING_CAPACITY_OPTIONS = [
  'Baixa (até R$200)',
  'Média (R$200-1.000)',
  'Alta (R$1.000-5.000)',
  'Premium (acima R$5.000)',
  'Recorrente (mensal/assinatura)',
  'Não sei ainda',
];

export const PERSONA_HIDDEN_DESIRE_OPTIONS = [
  { emoji: '🏆', label: 'Ser admirado(a) e respeitado(a)' },
  { emoji: '💪', label: 'Provar que consegue (pra si ou pros outros)' },
  { emoji: '✨', label: 'Recuperar autoestima e autoconfiança' },
  { emoji: '🌹', label: 'Parecer/sentir-se mais jovem ou atraente' },
  { emoji: '🕊️', label: 'Liberdade (financeira, de tempo, de chefe)' },
  { emoji: '👑', label: 'Ter controle sobre a própria vida' },
  { emoji: '🎯', label: 'Parar de depender de outras pessoas' },
  { emoji: '🏅', label: 'Sentir orgulho de si mesmo' },
  { emoji: '👨‍👩‍👧', label: 'Conexão com filhos/família/parceiro(a)' },
  { emoji: '😌', label: 'Paz de espírito / fim da ansiedade' },
  { emoji: '🌟', label: 'Reconhecimento profissional ou social' },
  { emoji: '💰', label: "Status / sentir-se 'alguém'" },
  { emoji: '🦋', label: 'Recomeço / virar de página na vida' },
  { emoji: '🛡️', label: 'Segurança e estabilidade' },
  { emoji: '❤️', label: 'Ser amado(a) / desejado(a)' },
];

// ─── Copy-step form schema ──────────────────────────────────────────

// Question section descriptor used by renderCopyStep. The `condition`
// callback narrows the question's visibility based on other answers
// (e.g. "Data da próxima turma" only shows for course-style products).
export interface CopyQuestion {
  id: string;
  label: string;
  type: 'select' | 'multi-select' | 'text' | 'date' | 'number';
  options?: string[];
  placeholder?: string;
  condition?: (ans: Record<string, any>) => boolean;
}

export interface CopySection {
  title: string;
  questions: CopyQuestion[];
}

export const COPY_SECTIONS: CopySection[] = [
  {
    title: 'AUDIÊNCIA',
    questions: [
      { id: 'language', label: 'Idioma', type: 'select', options: ['Português (Brasileiro)', 'Inglês', 'Espanhol'] },
      { id: 'audience', label: 'Público (quem vai ver)', type: 'text', placeholder: 'ex: Mães ocupadas' },
      { id: 'age', label: 'Idade', type: 'multi-select', options: ['18-24', '25-34', '35-44', '45-54', '55+'] },
      { id: 'situation', label: 'Situação atual', type: 'text', placeholder: 'ex: Tentando emagrecer sem sucesso' },
      { id: 'painPoints', label: 'Problema principal', type: 'text', placeholder: 'ex: Falta de tempo para exercícios' },
      { id: 'triedBefore', label: 'O que já tentou', type: 'text', placeholder: 'ex: Dietas restritivas, academia' },
      { id: 'mainObjection', label: 'Objeção principal do cliente', type: 'text', placeholder: 'ex: Já tentei tudo, não confio mais' },
      { id: 'hiddenDesire', label: 'Desejo profundo (não o resultado superficial)', type: 'text', placeholder: 'ex: Voltar a dançar com o marido nas festas' },
    ],
  },
  {
    title: 'PRODUTO',
    questions: [
      { id: 'productName', label: 'Nome do produto/serviço', type: 'text', placeholder: 'ex: Curso de Marketing Digital' },
      { id: 'productProblem', label: 'Qual problema resolve?', type: 'text', placeholder: 'ex: Pessoas que não sabem vender online' },
      { id: 'productResult', label: 'Resultado concreto que entrega', type: 'text', placeholder: 'ex: Primeira venda em 30 dias' },
      { id: 'uniqueMechanism', label: 'Mecanismo único (o que torna diferente)', type: 'text', placeholder: 'ex: Sistema exclusivo em 3 etapas' },
      { id: 'socialProof', label: 'Prova social (depoimento, número, resultado)', type: 'text', placeholder: 'ex: Mais de 500 alunos com primeira venda' },
    ],
  },
  {
    title: 'TIPO DE OFERTA',
    questions: [
      {
        id: 'businessModel',
        label: 'Qual o modelo da sua oferta?',
        type: 'select',
        options: [
          'Plataforma com acesso contínuo (sem turmas)',
          'Curso com turmas específicas (com data de início)',
          'Mentoria / consultoria com vagas limitadas',
          'Produto físico',
          'Serviço sob demanda',
          'SaaS / assinatura',
          'Outro (campo livre)',
        ],
      },
      {
        id: 'nextClassDate',
        label: 'Data da próxima turma',
        type: 'date',
        condition: (ans) => ans.businessModel === 'Curso com turmas específicas (com data de início)',
      },
      {
        id: 'slotsAvailable',
        label: 'Quantas vagas disponíveis',
        type: 'number',
        condition: (ans) =>
          [
            'Curso com turmas específicas (com data de início)',
            'Mentoria / consultoria com vagas limitadas',
          ].includes(ans.businessModel),
      },
      {
        id: 'promoDetails',
        label: 'Tem alguma promoção/desconto com prazo?',
        type: 'text',
        placeholder: 'Ex: 20% OFF até amanhã',
        condition: (ans) => ans.businessModel === 'SaaS / assinatura',
      },
      {
        id: 'limitedStock',
        label: 'Estoque limitado?',
        type: 'select',
        options: ['Sim', 'Não'],
        condition: (ans) => ans.businessModel === 'Produto físico',
      },
    ],
  },
  {
    title: 'EMOÇÃO PRINCIPAL',
    questions: [
      {
        id: 'emotion',
        label: 'Emoção',
        type: 'select',
        options: [
          'Frustração',
          'Vergonha',
          'Ansiedade',
          'Medo de julgamento',
          'Insegurança',
          'Raiva leve',
          'Confusão',
          'Cansaço',
          'Desmotivação',
          'Ambição',
          'Desejo de reconhecimento',
          'Desejo de controle',
          'Exclusividade',
          'Esperança',
          'Alívio',
        ],
      },
    ],
  },
  {
    title: 'ÂNGULO DA COPY',
    questions: [
      {
        id: 'angleIdea',
        label: 'Ângulo',
        type: 'select',
        options: [
          'Você está fazendo errado',
          'Não é culpa sua',
          'Ninguém te contou isso',
          'O problema não é o que você pensa',
          'Existe uma forma mais simples',
          'Você está sendo mal orientado',
          'Isso está te sabotando',
          'Você está focando no lugar errado',
          'Resultado imediato',
          'A solução definitiva',
        ],
      },
      {
        id: 'basePhrase',
        label: 'Frase base',
        type: 'text',
        placeholder: 'O verdadeiro problema não é ____, é ____',
      },
    ],
  },
];
