import { RefreshCw, Shield, Volume2, User, Sparkles, Zap, Film, Bot } from 'lucide-react';
import { IntegrationCard, type TestStatus } from '@/components/IntegrationCard';
import { PreferencesSection } from '@/components/PreferencesSection';
import type { AccentColor } from '@/hooks/useAppPreferences';

// One provider's worth of state + callbacks. App.tsx still owns the state;
// this tab is pure presentation and just routes events back up.
export interface ProviderConnection {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  testStatus: TestStatus;
  onSave: () => void;
  onTest: () => void;
}

interface IntegrationsTabProps {
  userRole: string;
  credits: number;
  loading: boolean;
  elevenlabs: ProviderConnection;
  heygen: ProviderConnection;
  runway: ProviderConnection;
  gemini: ProviderConnection;
  claude: ProviderConnection;
  assemblyai: ProviderConnection;
  zapcap: ProviderConnection;
  preferences: {
    sfxEnabled: boolean;
    onToggleSfx: (v: boolean) => void;
    bgMusicEnabled: boolean;
    onToggleBgMusic: (v: boolean) => void;
    bgMusicVolume: number;
    onChangeBgMusicVolume: (v: number) => void;
    accentColor: AccentColor;
    onChangeAccentColor: (v: AccentColor) => void;
  };
}

export function IntegrationsTab({
  userRole,
  credits,
  loading,
  elevenlabs,
  heygen,
  runway,
  gemini,
  claude,
  assemblyai,
  zapcap,
  preferences,
}: IntegrationsTabProps) {
  const isAdmin = userRole === 'admin';

  // Trim noise: each card is configured by a small data record below.
  const providers: Array<{
    state: ProviderConnection;
    title: string;
    subtitle: string;
    envVarName: string;
    warningText: string;
    icon: React.ReactNode;
    iconBgColor: string;
    iconColor: string;
  }> = [
    {
      state: elevenlabs,
      title: 'ElevenLabs TTS',
      subtitle: 'Vozes de Alta Fidelidade',
      envVarName: 'ELEVENLABS_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para todas as gerações de voz da plataforma.',
      icon: <Volume2 size={20} />,
      iconBgColor: 'bg-blue-100 dark:bg-blue-950/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    {
      state: heygen,
      title: 'HeyGen Avatars',
      subtitle: 'Vídeos com Avatares AI',
      envVarName: 'HEYGEN_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para geração de vídeos com avatar HeyGen.',
      icon: <User size={20} />,
      iconBgColor: 'bg-purple-100 dark:bg-purple-950/40',
      iconColor: 'text-purple-600 dark:text-purple-400',
    },
    {
      state: runway,
      title: 'Runway Gen-3 Alpha',
      subtitle: 'Vídeos Cinematográficos',
      envVarName: 'RUNWAY_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para todas as gerações de vídeo Runway da plataforma.',
      icon: <Sparkles size={20} />,
      iconBgColor: 'bg-orange-100 dark:bg-orange-950/40',
      iconColor: 'text-orange-600 dark:text-orange-400',
    },
    {
      state: gemini,
      title: 'Google Gemini',
      subtitle: 'IA Generativa de Copy + Hooks',
      envVarName: 'GEMINI_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para geração de copy, hooks e roteiros via Google Gemini.',
      icon: <Sparkles size={20} />,
      iconBgColor: 'bg-amber-100 dark:bg-amber-950/40',
      iconColor: 'text-amber-600 dark:text-amber-400',
    },
    {
      state: claude,
      title: 'Anthropic Claude',
      subtitle: 'Copy, Hooks, Personas',
      envVarName: 'CLAUDE_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para gerar copy (beats Schwartz), hooks, otimização para ElevenLabs e descoberta de persona.',
      icon: <Bot size={20} />,
      iconBgColor: 'bg-indigo-100 dark:bg-indigo-950/40',
      iconColor: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      state: assemblyai,
      title: 'AssemblyAI',
      subtitle: 'Transcrição + Análise Neural',
      envVarName: 'ASSEMBLYAI_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para transcrição e análise de áudio via AssemblyAI.',
      icon: <Zap size={20} />,
      iconBgColor: 'bg-blue-100 dark:bg-blue-950/40',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    {
      state: zapcap,
      title: 'ZapCap Engine',
      subtitle: 'Legendas + Edição Automática',
      envVarName: 'ZAPCAP_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para edição de legendas + b-rolls via ZapCap.',
      icon: <Film size={20} />,
      iconBgColor: 'bg-purple-100 dark:bg-purple-950/40',
      iconColor: 'text-purple-600 dark:text-purple-400',
    },
  ];

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      <PreferencesSection {...preferences} />

      <div className="p-8 bg-white/80 dark:bg-gray-900/60 rounded-3xl ring-1 ring-gray-200/60 dark:ring-gray-800/60 shadow-xl shadow-gray-200/40 dark:shadow-black/30 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-200/60 dark:shadow-blue-900/30 ring-1 ring-inset ring-white/20">
              <RefreshCw size={22} />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
                Status das Integrações
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Verifique a conectividade com as plataformas parceiras.
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 rounded-full text-[10px] font-bold ring-1 ring-amber-200/60 dark:ring-amber-900/40">
              <Shield size={12} />
              MODO ADMIN
            </div>
          )}
        </div>

        <div className="space-y-3">
          {providers.map((p) => (
            <IntegrationCard
              key={p.title}
              icon={p.icon}
              iconBgColor={p.iconBgColor}
              iconColor={p.iconColor}
              title={p.title}
              subtitle={p.subtitle}
              testStatus={p.state.testStatus}
              onTest={p.state.onTest}
              isAdmin={isAdmin}
              loading={loading}
              adminConfig={{
                apiKey: p.state.apiKey,
                onApiKeyChange: p.state.onApiKeyChange,
                showKey: p.state.showKey,
                onToggleShowKey: p.state.onToggleShowKey,
                onSave: p.state.onSave,
                envVarName: p.envVarName,
                warningText: p.warningText,
              }}
            />
          ))}
        </div>

        <div className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/40 dark:from-blue-950/40 dark:to-blue-900/20 rounded-2xl ring-1 ring-blue-200/60 dark:ring-blue-900/40">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="text-blue-600 dark:text-blue-400" size={18} />
            <h4 className="font-bold text-blue-900 dark:text-blue-200 text-sm">
              Sistema de Créditos
            </h4>
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-300/90 leading-relaxed">
            Sua conta possui{' '}
            <strong className="font-black text-blue-900 dark:text-blue-100">
              {credits} créditos
            </strong>{' '}
            disponíveis. Cada geração de voz consome créditos proporcionalmente ao tamanho do texto
            (1 crédito por 10 caracteres).
          </p>
        </div>
      </div>
    </div>
  );
}
