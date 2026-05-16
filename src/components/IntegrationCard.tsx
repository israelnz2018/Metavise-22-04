import type { ReactNode } from 'react';
import {
  Loader2,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Key,
  Eye,
  EyeOff,
} from 'lucide-react';

export interface TestStatus {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
}

export interface IntegrationAdminConfig {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  onSave: () => void;
  envVarName: string;
  warningText: string;
}

interface IntegrationCardProps {
  icon: ReactNode;
  iconBgColor: string;
  iconColor: string;
  title: string;
  subtitle: string;
  testStatus: TestStatus;
  onTest: () => void;
  isAdmin: boolean;
  loading: boolean;
  adminConfig?: IntegrationAdminConfig;
}

// Reusable card for the Integrations tab — header with title/subtitle/icon,
// "Testar Conexão" button + status badge, optional admin-only section to
// save a new API key. Six different providers feed it different props.
export function IntegrationCard({
  icon,
  iconBgColor,
  iconColor,
  title,
  subtitle,
  testStatus,
  onTest,
  isAdmin,
  loading,
  adminConfig,
}: IntegrationCardProps) {
  return (
    <div className="p-6 bg-gray-50 rounded-2xl border-2 border-gray-100 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 ${iconBgColor} ${iconColor} rounded-full flex items-center justify-center`}
          >
            {icon}
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{title}</p>
            <p className="text-[10px] text-gray-500 uppercase font-bold">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTest}
            disabled={testStatus.status === 'loading'}
            className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            {testStatus.status === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Testar Conexão
          </button>
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold ${
              testStatus.status === 'success'
                ? 'bg-green-100 text-green-700'
                : testStatus.status === 'error'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-blue-100 text-blue-700'
            }`}
          >
            {testStatus.status === 'success' ? (
              <CheckCircle2 size={12} />
            ) : testStatus.status === 'error' ? (
              <AlertCircle size={12} />
            ) : (
              <RefreshCw size={12} />
            )}
            {testStatus.status === 'success'
              ? 'CONECTADO'
              : testStatus.status === 'error'
                ? 'ERRO'
                : 'VERIFICAR'}
          </div>
        </div>
      </div>

      {testStatus.message && (
        <p
          className={`text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg ${
            testStatus.status === 'success'
              ? 'bg-green-50 text-green-600'
              : 'bg-red-50 text-red-600'
          }`}
        >
          {testStatus.message}
        </p>
      )}

      {isAdmin && adminConfig && (
        <div className="pt-4 border-t border-gray-200 space-y-4">
          <div className="flex items-center gap-2 text-amber-600">
            <Key size={14} />
            <span className="text-[10px] font-bold uppercase tracking-widest">
              Gerenciar API Key (Admin Only)
            </span>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={adminConfig.showKey ? 'text' : 'password'}
                placeholder={`Insira a nova ${adminConfig.envVarName}`}
                value={adminConfig.apiKey || ''}
                onChange={(e) => adminConfig.onApiKeyChange(e.target.value)}
                className="w-full p-4 bg-white border-2 border-gray-200 rounded-2xl focus:border-blue-600 outline-none text-sm transition-all pr-12"
              />
              <button
                onClick={adminConfig.onToggleShowKey}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {adminConfig.showKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              onClick={adminConfig.onSave}
              disabled={loading || !adminConfig.apiKey}
              className="px-6 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Salvar'}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 font-medium">{adminConfig.warningText}</p>
        </div>
      )}
    </div>
  );
}
