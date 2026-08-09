import { useState } from 'react';
import {
  X,
  Rocket,
  Layout,
  Users,
  Edit3,
  Sparkles,
  User,
  Film,
  Clapperboard,
  BarChart3,
} from 'lucide-react';

interface Slide {
  icon: React.ElementType;
  title: string;
  body: string;
}

// Espelha a ordem REAL do fluxo (STEPS em lib/constants.ts) — só o caminho
// principal, sem os ramais opcionais (Copy VSL, Remotion, Imagem/Vídeo IA,
// Recortar, Mesclar) pra não virar um tour de 15 telas.
const SLIDES: Slide[] = [
  {
    icon: Rocket,
    title: 'Bem-vindo ao Metavise',
    body: 'Um tour rápido de como o app funciona, do zero até o anúncio pronto. Leva menos de 1 minuto — dá pra pular a qualquer momento.',
  },
  {
    icon: Layout,
    title: 'Meus Projetos',
    body: 'Tudo começa aqui. Cada projeto pode ter vários subprojetos (criativos) dentro — variações de persona, ângulo ou formato do mesmo produto.',
  },
  {
    icon: Users,
    title: 'Planejamento',
    body: 'Responde algumas perguntas sobre o produto, a IA gera 3 personas e um plano de marketing calibrado pelo seu orçamento diário.',
  },
  {
    icon: Edit3,
    title: 'Copy',
    body: 'A partir da persona escolhida, a IA escreve o roteiro do anúncio — hook, corpo e CTA — seguindo o nível de consciência do público certo.',
  },
  {
    icon: Sparkles,
    title: 'Voz',
    body: 'O roteiro vira narração com IA (ElevenLabs) — escolhe a voz, gera o áudio.',
  },
  {
    icon: User,
    title: 'Avatar',
    body: 'A voz vira vídeo com um avatar falando — ou você já pode pular direto pra Montagem se preferir b-roll sem rosto.',
  },
  {
    icon: Film,
    title: 'Montagem',
    body: 'Corta e monta o criativo: b-roll, transições, legenda, capa. Tem "Auto-editar" pra IA montar sozinha a partir do ritmo da narração.',
  },
  {
    icon: Clapperboard,
    title: 'Criativos',
    body: 'Todos os vídeos prontos do projeto ficam aqui — favoritar, gerar variações A/B, traduzir, ou montar o pacote pra colar no Ads Manager.',
  },
  {
    icon: BarChart3,
    title: 'Performance',
    body: 'Importe o relatório do Meta Ads Manager e feche o ciclo: gerou → rodou → o que vendeu. Isso é tudo — bom trabalho!',
  },
];

const STORAGE_KEY = 'metavise.tourSeen';

export function hasSeenTour(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

export function markTourSeen() {
  window.localStorage.setItem(STORAGE_KEY, 'true');
}

export function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  if (!open) return null;

  const finish = () => {
    markTourSeen();
    setStep(0);
    onClose();
  };

  const slide = SLIDES[step]!;
  const Icon = slide.icon;
  const isLast = step === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={finish}
    >
      <div
        className="bg-white dark:bg-gray-950 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative p-8 pb-6 text-center">
          <button
            onClick={finish}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-400 hover:text-gray-900 dark:hover:text-gray-50"
            aria-label="Pular tour"
          >
            <X size={16} />
          </button>
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 mb-4">
            <Icon size={28} />
          </div>
          <h2 className="text-xl font-black text-gray-900 dark:text-gray-50 mb-2">{slide.title}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{slide.body}</p>
        </div>

        <div className="flex items-center justify-center gap-1.5 pb-4">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Passo ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-blue-600' : 'w-1.5 bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={finish}
            className="text-xs font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Pular
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Voltar
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setStep((s) => s + 1))}
              className="px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700"
            >
              {isLast ? 'Concluir' : 'Próximo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
