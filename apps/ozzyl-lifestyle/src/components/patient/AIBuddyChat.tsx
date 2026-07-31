import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const QUICK_PROMPT_KEYS = [
  { emoji: '😴', key: 'aiBuddy.prompts.sleep' },
  { emoji: '🏃', key: 'aiBuddy.prompts.exercise' },
  { emoji: '😰', key: 'aiBuddy.prompts.stress' },
  { emoji: '🥗', key: 'aiBuddy.prompts.food' },
  { emoji: '💧', key: 'aiBuddy.prompts.water' },
  { emoji: '🧘', key: 'aiBuddy.prompts.meditation' },
];

export default function AIBuddyChat() {
  const { t, i18n } = useTranslation('patientPortal');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: t('aiBuddy.welcome'),
        timestamp: Date.now(),
      }]);
    }
  }, [t, messages.length]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      setUnread(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim(), timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Build conversation history (skip welcome, last 10)
      const history = messages
        .slice(1) // Skip welcome message
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));

      const response = await fetch('/api/patient-phr/ai-buddy/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          conversationHistory: history,
        }),
      });

      const data = await response.json() as { reply?: string; error?: boolean; rateLimited?: boolean };
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.reply || t('aiBuddy.errors.noReply'),
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMsg]);

      if (!isOpen) {
        setUnread(prev => prev + 1);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t('aiBuddy.errors.connection'),
        timestamp: Date.now(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    const hourStr = hour12.toLocaleString(i18n.language);
    const minStr = m.toLocaleString(i18n.language).padStart(i18n.language === 'bn' ? 2 : 2, i18n.language === 'bn' ? '০' : '0');
    return `${hourStr}:${minStr} ${ampm}`;
  };

  return (
    <>
      {/* ── Floating Action Button ── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-24 right-5 z-50 w-14 h-14 rounded-full shadow-2xl shadow-emerald-900/30 flex items-center justify-center transition-all duration-300 active:scale-90 hover:scale-105 md:bottom-8 md:right-8"
        style={{
          background: 'linear-gradient(135deg, #006c49, #10b981)',
        }}
        aria-label={t('aiBuddy.openLabel', { defaultValue: 'Open AI Buddy' })}
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <span className="text-2xl" role="img" aria-label="bot">🤖</span>
        )}
        {/* Unread badge */}
        {unread > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-bounce">
            {unread.toLocaleString(i18n.language)}
          </span>
        )}
      </button>

      {/* ── Chat Panel ── */}
      {isOpen && (
        <div
          className="fixed z-50 flex flex-col bg-white rounded-2xl shadow-2xl shadow-black/15 border border-slate-200 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300"
          style={{
            bottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))',
            right: '1.25rem',
            width: 'min(360px, calc(100vw - 2.5rem))',
            height: 'min(520px, calc(100vh - 12rem))',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{ background: 'linear-gradient(135deg, #006c49, #059669)' }}
          >
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">
              🤖
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-bold text-sm" style={{ fontFamily: 'Manrope, sans-serif' }}>
                {t('aiBuddy.name')}
              </h3>
              <p className="text-emerald-200 text-[11px]">
                {t('aiBuddy.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              <span className="text-emerald-200 text-[10px] font-medium">{t('aiBuddy.status.online')}</span>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 shrink-0">
            <p className="text-[10px] text-amber-700 leading-relaxed">
              {t('aiBuddy.disclaimer')}
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ overscrollBehavior: 'contain' }}>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#006c49] text-white rounded-br-md'
                      : 'bg-[#f2f4f6] text-[#1a2e22] rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-emerald-200' : 'text-slate-400'} text-right`}>
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-[#f2f4f6] rounded-2xl rounded-bl-md px-4 py-3 flex gap-1.5 items-center">
                  <span className="w-2 h-2 rounded-full bg-[#006c49] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[#006c49] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[#006c49] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick prompts — only show if no user messages yet */}
          {messages.length <= 1 && (
            <div className="px-4 py-2 border-t border-slate-100 shrink-0">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPT_KEYS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => void sendMessage(t(p.key))}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-emerald-50 text-[11px] font-medium text-[#006c49] hover:bg-emerald-100 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <span>{p.emoji}</span> {t(p.key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-3 border-t border-slate-100 shrink-0 bg-white">
            <div className="flex gap-2 items-center">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('aiBuddy.inputPlaceholder')}
                disabled={isLoading}
                className="flex-1 px-4 py-2.5 rounded-full bg-[#f2f4f6] text-sm text-[#1a2e22] placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#10b981]/30 transition-all disabled:opacity-60"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              />
              <button
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                style={{
                  background: input.trim() ? 'linear-gradient(135deg, #006c49, #10b981)' : '#e5e7eb',
                }}
                aria-label={t('aiBuddy.send')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
