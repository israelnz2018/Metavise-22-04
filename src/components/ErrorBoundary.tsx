// React error boundary. Wrap around tab content so a crash inside one
// step (e.g. avatar rendering, an unexpected null in a mapper) doesn't
// take down the whole app — the user sees a friendly recovery screen
// instead of a white page.

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  // Label for the section that crashed (shown to the user).
  scope?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in console so the dev tab still gets the stack.
    console.error('[ErrorBoundary]', this.props.scope || 'app', error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="max-w-2xl mx-auto my-12 bg-red-50 dark:bg-red-950/30 border-2 border-red-200 dark:border-red-900/60 rounded-3xl p-8 text-center space-y-4">
        <div className="w-14 h-14 mx-auto bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center">
          <AlertTriangle size={28} />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-black text-red-900 dark:text-red-200">
            Algo quebrou nesta tela
          </h3>
          <p className="text-sm text-red-700">
            {this.props.scope
              ? `Erro em "${this.props.scope}". As outras abas continuam funcionando.`
              : 'Erro inesperado. As outras abas continuam funcionando.'}
          </p>
          <details className="text-xs text-red-600 mt-3">
            <summary className="cursor-pointer font-bold uppercase tracking-widest">
              Detalhes técnicos
            </summary>
            <pre className="text-left bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-red-200 dark:border-red-900/60 rounded-lg p-3 mt-2 overflow-auto max-h-48 text-[11px]">
              {this.state.error.message}
              {this.state.error.stack && '\n\n' + this.state.error.stack}
            </pre>
          </details>
        </div>
        <button
          onClick={this.handleReset}
          className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-black uppercase text-xs tracking-widest px-5 py-3 rounded-xl"
        >
          <RefreshCw size={14} />
          Tentar de novo
        </button>
      </div>
    );
  }
}
