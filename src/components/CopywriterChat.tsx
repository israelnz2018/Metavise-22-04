import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { X, Send, Sparkles, Loader2, Check } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { copywriterChat, type CopywriterMessage } from '@/lib/claudeService';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Copy atual (corpo) que o copywriter discute/revisa. */
  script: string;
  answers: Record<string, any>;
  angle: string;
  /** Aplica uma versão reescrita pelo copywriter na copy do projeto. */
  onApplyScript: (newScript: string) => void;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  revisedScript?: string | null;
  applied?: boolean;
}

// Chat com o "copywriter mestre": conversa sobre a copy atual e, quando ele
// reescreve, oferece "Aplicar esta versão". Toda a persona + regras anti-IA
// vivem no backend (copywriterChat). O histórico é local ao modal.
export function CopywriterChat({ open, onClose, script, answers, angle, onApplyScript }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rola pro fim a cada mensagem nova.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  if (!open) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const nextMsgs: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMsgs);
    setInput('');
    setLoading(true);
    try {
      const history: CopywriterMessage[] = nextMsgs.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await copywriterChat({ messages: history, script, answers, angle });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.reply, revisedScript: res.revisedScript },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: err?.message || 'Erro ao falar com o copywriter.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const apply = (idx: number, newScript: string) => {
    onApplyScript(newScript);
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, applied: true } : m)));
    toast.success('Versão aplicada na copy');
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md animate-in fade-in duration-150 p-4"
      style={{ zIndex: 99999 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-xl h-[80vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-black text-gray-900 dark:text-gray-50 tracking-tight leading-tight">
                Falar com o copywriter
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                Mestre de copy · discute e revisa a copy atual
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-sm text-gray-400 dark:text-gray-500 mt-8 space-y-2">
              <p className="font-bold text-gray-500 dark:text-gray-400">
                Converse sobre a copy atual.
              </p>
              <p className="text-xs">
                Ex.: "deixa a escalada mais raivosa", "esse gancho tá fraco, me dá 3 opções",
                "tira a cara de IA do beat da descoberta", "encurta pra 45s".
              </p>
            </div>
          )}
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'
                }`}
              >
                {m.content}
                {m.role === 'assistant' && m.revisedScript && (
                  <button
                    onClick={() => apply(idx, m.revisedScript!)}
                    disabled={m.applied}
                    className={`mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                      m.applied
                        ? 'bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                  >
                    <Check size={12} />
                    {m.applied ? 'Aplicada' : 'Aplicar esta versão'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-2.5">
                <Loader2 size={16} className="animate-spin text-gray-400" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Fale com o copywriter… (Enter envia, Shift+Enter quebra linha)"
            rows={2}
            className="flex-1 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-800 text-sm outline-none focus:border-purple-400 resize-none"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="p-3 rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-all shrink-0"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
