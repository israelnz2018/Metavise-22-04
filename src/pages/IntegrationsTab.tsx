import { RefreshCw, Shield, Volume2, User, Sparkles, Zap, Film, Bot } from 'lucide-react';
import { IntegrationCard, type TestStatus } from '../components/IntegrationCard';

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
      iconBgColor: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      state: heygen,
      title: 'HeyGen Avatars',
      subtitle: 'Vídeos com Avatares AI',
      envVarName: 'HEYGEN_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para geração de vídeos com avatar HeyGen.',
      icon: <User size={20} />,
      iconBgColor: 'bg-purple-100',
      iconColor: 'text-purple-600',
    },
    {
      state: runway,
      title: 'Runway Gen-3 Alpha',
      subtitle: 'Vídeos Cinematográficos',
      envVarName: 'RUNWAY_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para todas as gerações de vídeo Runway da plataforma.',
      icon: <Sparkles size={20} />,
      iconBgColor: 'bg-orange-100',
      iconColor: 'text-orange-600',
    },
    {
      state: gemini,
      title: 'Google Gemini',
      subtitle: 'IA Generativa de Copy + Hooks',
      envVarName: 'GEMINI_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para geração de copy, hooks e roteiros via Google Gemini.',
      icon: <Sparkles size={20} />,
      iconBgColor: 'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    {
      state: claude,
      title: 'Anthropic Claude',
      subtitle: 'Copy, Hooks, Personas',
      envVarName: 'CLAUDE_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para gerar copy (beats Schwartz), hooks, otimização para ElevenLabs e descoberta de persona.',
      icon: <Bot size={20} />,
      iconBgColor: 'bg-indigo-100',
      iconColor: 'text-indigo-600',
    },
    {
      state: assemblyai,
      title: 'AssemblyAI',
      subtitle: 'Transcrição + Análise Neural',
      envVarName: 'ASSEMBLYAI_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para transcrição e análise de áudio via AssemblyAI.',
      icon: <Zap size={20} />,
      iconBgColor: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      state: zapcap,
      title: 'ZapCap Engine',
      subtitle: 'Legendas + Edição Automática',
      envVarName: 'ZAPCAP_API_KEY',
      warningText:
        '⚠️ Esta chave será salva no servidor e usada para edição de legendas + b-rolls via ZapCap.',
      icon: <Film size={20} />,
      iconBgColor: 'bg-purple-100',
      iconColor: 'text-purple-600',
    },
  ];

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      <div className="p-8 bg-white rounded-3xl border-4 border-blue-100 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white">
              <RefreshCw size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">
                Status das Integrações
              </h3>
              <p className="text-gray-500 text-sm">
                Verifique a conectividade com as plataformas parceiras.
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-[10px] font-bold">
              <Shield size={12} />
              MODO ADMIN
            </div>
          )}
        </div>

        <div className="space-y-4">
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

        <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="text-blue-600" size={18} />
            <h4 className="font-bold text-blue-900 text-sm">Sistema de Créditos</h4>
          </div>
          <p className="text-xs text-blue-700 leading-relaxed">
            Sua conta possui <strong>{credits} créditos</strong> disponíveis. Cada geração de voz
            consome créditos proporcionalmente ao tamanho do texto (1 crédito por 10 caracteres).
          </p>
        </div>
      </div>
    </div>
  );
}
