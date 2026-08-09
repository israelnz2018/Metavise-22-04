import { Volume2, Music, Palette, Check, Compass, Languages } from 'lucide-react';
import { ACCENT_COLORS, type AccentColor } from '@/hooks/useAppPreferences';
import { useLanguage, type Language } from '@/lib/i18n/LanguageContext';

interface Props {
  sfxEnabled: boolean;
  onToggleSfx: (v: boolean) => void;
  sfxVolume: number;
  onChangeSfxVolume: (v: number) => void;
  bgMusicEnabled: boolean;
  onToggleBgMusic: (v: boolean) => void;
  bgMusicVolume: number;
  onChangeBgMusicVolume: (v: number) => void;
  accentColor: AccentColor;
  onChangeAccentColor: (v: AccentColor) => void;
  onReplayTour: () => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-700'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[20px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// Idioma da CASCA do app — não a língua da copy gerada pela IA (essa segue
// a VSL, tem seletor próprio dentro do fluxo de Copy). Fase 0 da tradução:
// infraestrutura + tela de login + header já traduzidos; o resto do app
// segue em português até ser migrado nas próximas fases.
const LANGUAGES: { id: Language; label: string; flag: string }[] = [
  { id: 'pt', label: 'Português', flag: '🇧🇷' },
  { id: 'en', label: 'English', flag: '🇺🇸' },
];

function LanguageSection() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 ring-1 ring-gray-200/60 dark:ring-gray-800/60 space-y-3">
      <div className="flex items-center gap-3">
        <Languages size={18} className="text-gray-500 dark:text-gray-400 shrink-0" />
        <div>
          <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Idioma do app</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Em tradução aos poucos — telas ainda não traduzidas continuam em português.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-9">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLanguage(l.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 ring-1 transition-colors ${
              language === l.id
                ? 'bg-blue-600 text-white ring-blue-600'
                : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 ring-gray-200 dark:ring-gray-700 hover:ring-gray-300'
            }`}
          >
            <span>{l.flag}</span> {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PreferencesSection({
  sfxEnabled,
  onToggleSfx,
  sfxVolume,
  onChangeSfxVolume,
  bgMusicEnabled,
  onToggleBgMusic,
  bgMusicVolume,
  onChangeBgMusicVolume,
  accentColor,
  onChangeAccentColor,
  onReplayTour,
}: Props) {
  return (
    <div className="p-8 bg-white/80 dark:bg-gray-900/60 rounded-3xl ring-1 ring-gray-200/60 dark:ring-gray-800/60 shadow-xl shadow-gray-200/40 dark:shadow-black/30 space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-600 dark:to-gray-800 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-gray-300/40 dark:shadow-black/30 ring-1 ring-inset ring-white/20">
          <Palette size={22} />
        </div>
        <div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
            Preferências
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Como o app soa e parece pra você — fica só no seu navegador.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 ring-1 ring-gray-200/60 dark:ring-gray-800/60 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Volume2 size={18} className="text-gray-500 dark:text-gray-400 shrink-0" />
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                  Sons de clique e feedback
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Um tique curto ao clicar, e um som ao terminar uma ação (sucesso/erro).
                </p>
              </div>
            </div>
            <Toggle checked={sfxEnabled} onChange={onToggleSfx} />
          </div>
          {sfxEnabled && (
            <div className="flex items-center gap-3 pl-9">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 shrink-0">
                Volume
              </span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={sfxVolume}
                onChange={(e) => onChangeSfxVolume(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 ring-1 ring-gray-200/60 dark:ring-gray-800/60 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Music size={18} className="text-gray-500 dark:text-gray-400 shrink-0" />
              <div>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                  Música de fundo
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ambiente suave enquanto você trabalha — nada a ver com a trilha dos seus vídeos.
                </p>
              </div>
            </div>
            <Toggle checked={bgMusicEnabled} onChange={onToggleBgMusic} />
          </div>
          {bgMusicEnabled && (
            <div className="flex items-center gap-3 pl-9">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 shrink-0">
                Volume
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={bgMusicVolume}
                onChange={(e) => onChangeBgMusicVolume(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 ring-1 ring-gray-200/60 dark:ring-gray-800/60 space-y-3">
          <div className="flex items-center gap-3">
            <Palette size={18} className="text-gray-500 dark:text-gray-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Cor de destaque</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Muda a navegação e os botões principais. O resto do app continua no visual padrão.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-9">
            {ACCENT_COLORS.map((c) => (
              <button
                key={c.id}
                onClick={() => onChangeAccentColor(c.id)}
                title={c.label}
                aria-label={c.label}
                className="w-8 h-8 rounded-full flex items-center justify-center ring-2 ring-offset-2 ring-offset-gray-50 dark:ring-offset-gray-800/50 transition-all"
                style={{
                  backgroundColor: c.hex,
                  ['--tw-ring-color' as any]: accentColor === c.id ? c.hex : 'transparent',
                }}
              >
                {accentColor === c.id && <Check size={14} className="text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <LanguageSection />

        <button
          onClick={onReplayTour}
          className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50 ring-1 ring-gray-200/60 dark:ring-gray-800/60 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Compass size={16} className="text-gray-500 dark:text-gray-400" />
          Ver o tour de boas-vindas de novo
        </button>
      </div>
    </div>
  );
}
