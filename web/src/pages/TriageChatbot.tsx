import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, AlertTriangle, Clock, Stethoscope, ArrowLeft, Calendar, RefreshCw } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { api } from '../lib/apiClient';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────
interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  data?: TriageResult;
  timestamp: Date;
}

interface TriageResult {
  reply: string;
  suggestedDepartment: string | null;
  urgency: 'routine' | 'urgent' | 'emergency';
  followUpQuestion: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const URGENCY_CFG = {
  routine:   { label: 'Routine',   color: 'bg-emerald-500 text-white', icon: Clock },
  urgent:    { label: 'Urgent',    color: 'bg-amber-500 text-white',   icon: AlertTriangle },
  emergency: { label: 'Emergency', color: 'bg-red-600 text-white',     icon: AlertTriangle },
} as const;

const QUICK_SYMPTOMS = [
  { bn: 'জ্বর ও মাথাব্যথা', en: 'Fever and headache' },
  { bn: 'বুকে ব্যথা', en: 'Chest pain' },
  { bn: 'পেটে ব্যথা', en: 'Stomach pain' },
  { bn: 'শ্বাসকষ্ট', en: 'Breathing difficulty' },
  { bn: 'চামড়ায় ফুসকুড়ি', en: 'Skin rash' },
  { bn: 'চোখে সমস্যা', en: 'Eye problems' },
];

// ─── Component ───────────────────────────────────────────────────────────────
export default function TriageChatbot() {
  const role = localStorage.getItem('hms_role') ?? 'patient';
  const { t, i18n } = useTranslation(['common']);
  const lang = i18n.language === 'bn' ? 'bn' : 'en';
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────
  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setInput('');

    const userMsg: ChatMsg = { role: 'user', content: msg, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.data?.reply ?? m.content }));

      const data = await api.post<TriageResult & { reply?: string; suggestedDepartment?: string; urgency?: string; followUpQuestion?: string }>('/api/ai/triage', {
        message: msg,
        conversationHistory: history,
      });

      const result: TriageResult = {
        reply: data.reply ?? 'Sorry, I could not process that.',
        suggestedDepartment: data.suggestedDepartment ?? null,
        urgency: (data.urgency as TriageResult['urgency']) ?? 'routine',
        followUpQuestion: data.followUpQuestion ?? null,
      };

      const aiMsg: ChatMsg = { role: 'assistant', content: result.reply, data: result, timestamp: new Date() };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(errMsg);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: lang === 'bn' ? 'দুঃখিত, এই মুহূর্তে AI সেবা পাওয়া যাচ্ছে না।' : 'Sorry, AI service is unavailable right now.',
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
    }
  };

  // ── New conversation ─────────────────────────────────────────────────
  const reset = () => { setMessages([]); setInput(''); };

  // ── Last triage result ───────────────────────────────────────────────
  const lastResult = [...messages].reverse().find(m => m.data)?.data;

  return (
    <DashboardLayout role={role}>
      <div className="max-w-2xl mx-auto px-4 py-6 h-[calc(100vh-80px)] flex flex-col">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-dark)] flex items-center justify-center text-white">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {lang === 'bn' ? 'AI ট্রায়াজ সহকারী' : 'AI Triage Assistant'}
              </h1>
              <p className="text-xs text-[var(--color-text-muted)]">
                {lang === 'bn' ? 'আপনার লক্ষণ জানান — সঠিক ডিপার্টমেন্টে যেতে সাহায্য করবো' : 'Describe your symptoms to find the right department'}
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <button onClick={reset} className="btn-ghost text-xs flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> {lang === 'bn' ? 'নতুন' : 'New'}
            </button>
          )}
        </div>

        {/* ── Chat area ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto space-y-4 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-border)] p-4">

          {/* Welcome message */}
          {messages.length === 0 && (
            <div className="text-center py-8 space-y-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[var(--color-primary)]/10 to-[var(--color-primary)]/20 flex items-center justify-center">
                <Bot className="w-8 h-8 text-[var(--color-primary)]" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                  {lang === 'bn' ? 'আপনার কি সমস্যা?' : 'How can I help you?'}
                </h2>
                <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto">
                  {lang === 'bn'
                    ? 'আপনার লক্ষণগুলো বলুন। আমি সবচেয়ে উপযুক্ত ডিপার্টমেন্ট সাজেস্ট করবো। আমি কোনো রোগ নির্ণয় করি না — শুধুমাত্র গাইড করি।'
                    : 'Describe your symptoms and I\'ll suggest the most appropriate department. I don\'t diagnose — I only guide you.'}
                </p>
              </div>

              {/* Quick symptoms */}
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_SYMPTOMS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(lang === 'bn' ? s.bn : s.en)}
                    className="px-3 py-1.5 rounded-full text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-primary)]/10 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                  >
                    {lang === 'bn' ? s.bn : s.en}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-[var(--color-primary)]" />
                </div>
              )}

              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === 'user'
                  ? 'bg-[var(--color-primary)] text-white rounded-br-sm'
                  : 'bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-bl-sm'
              }`}>
                <p className="whitespace-pre-wrap">{m.content}</p>

                {/* Triage result badges */}
                {m.data && (
                  <div className="mt-2 space-y-2 pt-2 border-t border-white/10">
                    {/* Urgency badge */}
                    {m.data.urgency && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${URGENCY_CFG[m.data.urgency].color}`}>
                        {(() => { const Icon = URGENCY_CFG[m.data.urgency].icon; return <Icon className="w-3 h-3" />; })()}
                        {URGENCY_CFG[m.data.urgency].label}
                      </span>
                    )}

                    {/* Suggested department */}
                    {m.data.suggestedDepartment && (
                      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                        <ArrowLeft className="w-3 h-3" />
                        <span className="font-medium">{lang === 'bn' ? 'প্রস্তাবিত:' : 'Suggested:'}</span>
                        <span className="px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold">
                          {m.data.suggestedDepartment}
                        </span>
                      </div>
                    )}

                    {/* Emergency warning */}
                    {m.data.urgency === 'emergency' && (
                      <div className="mt-1 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                        {lang === 'bn'
                          ? 'জরুরি! এখনই নিকটস্থ হাসপাতালের ইমার্জেন্সি বিভাগে যান।'
                          : 'EMERGENCY! Please visit the nearest hospital Emergency department immediately.'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {m.role === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)] flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-[var(--color-primary)]" />
              </div>
              <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-[var(--color-text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* ── Triage summary card ───────────────────────────────────── */}
        {lastResult?.suggestedDepartment && !sending && (
          <div className="mt-3 p-3 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-primary)]/20 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">
                {lang === 'bn' ? 'প্রস্তাবিত ডিপার্টমেন্ট' : 'Recommended Department'}
              </p>
              <p className="text-sm font-semibold text-[var(--color-primary)]">{lastResult.suggestedDepartment}</p>
            </div>
            <a
              href={`appointments?dept=${encodeURIComponent(lastResult.suggestedDepartment)}`}
              className="btn-primary text-xs flex items-center gap-1.5 px-3 py-2"
            >
              <Calendar className="w-3.5 h-3.5" />
              {lang === 'bn' ? 'অ্যাপয়েন্টমেন্ট' : 'Book Appointment'}
            </a>
          </div>
        )}

        {/* ── Input bar ──────────────────────────────────────────────── */}
        <form
          onSubmit={e => { e.preventDefault(); send(); }}
          className="mt-3 flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={lang === 'bn' ? 'আপনার লক্ষণ লিখুন...' : 'Describe your symptoms...'}
            className="input flex-1"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="btn-primary w-10 h-10 flex items-center justify-center rounded-xl disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* ── Disclaimer ─────────────────────────────────────────────── */}
        <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-2">
          {lang === 'bn'
            ? 'এটি রোগ নির্ণয় নয়। সবসময় যোগ্য চিকিৎসকের পরামর্শ নিন।'
            : 'This is not a diagnosis. Always consult a qualified healthcare professional.'}
        </p>
      </div>
    </DashboardLayout>
  );
}
