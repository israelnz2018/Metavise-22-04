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
    <div className="p-5 bg-gray-50/70 dark:bg-gray-800/40 rounded-2xl ring-1 ring-gray-200/60 dark:ring-gray-800/60 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 ${iconBgColor} ${iconColor} rounded-xl flex items-center justify-center ring-1 ring-inset ring-white/30 dark:ring-white/10`}
          >
            {icon}
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-50">{title}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase font-bold tracking-widest">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTest}
            disabled={testStatus.status === 'loading'}
            className="px-3.5 py-1.5 bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-700 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {testStatus.status === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Testar
          </button>
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
              testStatus.status === 'success'
                ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 ring-1 ring-green-200/60 dark:ring-green-900/40'
                : testStatus.status === 'error'
                  ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 ring-1 ring-red-200/60 dark:ring-red-900/40'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 ring-1 ring-blue-200/60 dark:ring-blue-900/40'
            }`}
          >
            {testStatus.status === 'success' ? (
              <CheckCircle2 size={11} />
            ) : testStatus.status === 'error' ? (
              <AlertCircle size={11} />
            ) : (
              <RefreshCw size={11} />
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
              ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
              : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
          }`}
        >
          {testStatus.message}
        </p>
      )}

      {isAdmin && adminConfig && (
        <div className="pt-4 border-t border-gray-200/60 dark:border-gray-700/60 space-y-3">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
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
                className="w-full p-3.5 bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all pr-12 dark:text-gray-100 dark:placeholder:text-gray-500"
              />
              <button
                onClick={adminConfig.onToggleShowKey}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {adminConfig.showKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              onClick={adminConfig.onSave}
              disabled={loading || !adminConfig.apiKey}
              className="px-5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-xl font-bold text-sm hover:bg-black dark:hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : 'Salvar'}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
            {adminConfig.warningText}
          </p>
        </div>
      )}
    </div>
  );
}
