import { useState, useEffect, useRef, useCallback } from 'react';

type SessionType = 'breathing' | 'meditation' | 'stretching';
type SessionState = 'idle' | 'running' | 'paused' | 'done';

interface WellnessSession {
  id: string;
  type: SessionType;
  title: string;
  titleBn: string;
  emoji: string;
  duration: number; // seconds
  description: string;
  color: string;
  bgGradient: string;
}

const toBn = (n: number): string =>
  n.toString().replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const SESSIONS: WellnessSession[] = [
  {
    id: 'box-breathing', type: 'breathing', title: 'Box Breathing', titleBn: 'বক্স ব্রিদিং',
    emoji: '🫁', duration: 240, description: '৪-৪-৪-৪ প্যাটার্নে শ্বাস নিন — মানসিক চাপ কমায়, ফোকাস বাড়ায়',
    color: '#0ea5e9', bgGradient: 'linear-gradient(135deg, #e0f2fe, #bae6fd)',
  },
  {
    id: '478-breathing', type: 'breathing', title: '4-7-8 Breathing', titleBn: '৪-৭-৮ ব্রিদিং',
    emoji: '🌬️', duration: 180, description: 'ঘুমের আগে করুন — ৪ সেকেন্ড শ্বাস, ৭ সেকেন্ড ধরুন, ৮ সেকেন্ডে ছাড়ুন',
    color: '#8b5cf6', bgGradient: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
  },
  {
    id: 'body-scan', type: 'meditation', title: 'Body Scan', titleBn: 'বডি স্ক্যান মেডিটেশন',
    emoji: '🧘', duration: 300, description: 'পায়ের পাতা থেকে মাথা পর্যন্ত ধীরে ধীরে মনোযোগ দিন',
    color: '#f59e0b', bgGradient: 'linear-gradient(135deg, #fef3c7, #fde68a)',
  },
  {
    id: 'gratitude', type: 'meditation', title: 'Gratitude Meditation', titleBn: 'কৃতজ্ঞতার মেডিটেশন',
    emoji: '🙏', duration: 300, description: '৫ মিনিট চোখ বন্ধ করে আজকের জন্য কৃতজ্ঞ হন',
    color: '#10b981', bgGradient: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
  },
  {
    id: 'neck-stretch', type: 'stretching', title: 'Neck & Shoulders', titleBn: 'ঘাড় ও কাঁধ স্ট্রেচ',
    emoji: '🙆', duration: 180, description: 'কম্পিউটারে কাজ করলে প্রতি ২ ঘণ্টায় এটি করুন',
    color: '#ef4444', bgGradient: 'linear-gradient(135deg, #fee2e2, #fecaca)',
  },
  {
    id: 'morning-stretch', type: 'stretching', title: 'Morning Stretch', titleBn: 'সকালের স্ট্রেচিং',
    emoji: '🌅', duration: 300, description: 'ঘুম থেকে উঠে পুরো শরীর স্ট্রেচ করুন — দিন ভালো কাটবে',
    color: '#f97316', bgGradient: 'linear-gradient(135deg, #ffedd5, #fed7aa)',
  },
];

const TYPE_TABS: { key: SessionType | 'all'; label: string; emoji: string }[] = [
  { key: 'all', label: 'সব', emoji: '✨' },
  { key: 'breathing', label: 'শ্বাস-প্রশ্বাস', emoji: '🫁' },
  { key: 'meditation', label: 'মেডিটেশন', emoji: '🧘' },
  { key: 'stretching', label: 'স্ট্রেচিং', emoji: '🙆' },
];

// ── Breathing Animation Phases ──
const BOX_PHASES = [
  { label: 'শ্বাস নিন', duration: 4000 },
  { label: 'ধরে রাখুন', duration: 4000 },
  { label: 'শ্বাস ছাড়ুন', duration: 4000 },
  { label: 'ধরে রাখুন', duration: 4000 },
];

const FOUR_SEVEN_EIGHT_PHASES = [
  { label: 'শ্বাস নিন', duration: 4000 },
  { label: 'ধরে রাখুন', duration: 7000 },
  { label: 'শ্বাস ছাড়ুন', duration: 8000 },
];

function BreathingCircle({ session, isRunning }: { session: WellnessSession; isRunning: boolean }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [scale, setScale] = useState(1);
  const phases = session.id === '478-breathing' ? FOUR_SEVEN_EIGHT_PHASES : BOX_PHASES;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isRunning) return;
    const phase = phases[phaseIdx];
    // Inhale = grow, exhale = shrink
    if (phase.label === 'শ্বাস নিন') setScale(1.4);
    else if (phase.label === 'শ্বাস ছাড়ুন') setScale(0.8);
    else setScale(s => s); // hold

    timerRef.current = setTimeout(() => {
      setPhaseIdx((prev) => (prev + 1) % phases.length);
    }, phase.duration);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phaseIdx, isRunning, phases]);

  useEffect(() => {
    if (!isRunning) { setPhaseIdx(0); setScale(1); }
  }, [isRunning]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-40 h-40 flex items-center justify-center">
        {/* Outer ring */}
        <div
          className="absolute inset-0 rounded-full opacity-20"
          style={{ background: session.color, transition: 'transform 3s ease-in-out', transform: `scale(${scale + 0.1})` }}
        />
        {/* Inner circle */}
        <div
          className="w-28 h-28 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: `radial-gradient(circle, ${session.color}22, ${session.color}44)`,
            border: `3px solid ${session.color}`,
            transition: 'transform 3s ease-in-out',
            transform: `scale(${scale})`,
          }}
        >
          <span className="text-3xl">{session.emoji}</span>
        </div>
      </div>
      <p className="text-lg font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
        {isRunning ? phases[phaseIdx].label : 'প্রস্তুত?'}
      </p>
    </div>
  );
}

function MeditationVisual({ session, isRunning }: { session: WellnessSession; isRunning: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-40 h-40 flex items-center justify-center">
        <div
          className={`absolute inset-0 rounded-full ${isRunning ? 'animate-pulse' : ''}`}
          style={{ background: `${session.color}15`, transition: 'all 2s ease' }}
        />
        <div
          className="w-28 h-28 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: session.bgGradient, border: `3px solid ${session.color}33` }}
        >
          <span className="text-4xl">{session.emoji}</span>
        </div>
      </div>
      <p className="text-lg font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
        {isRunning ? 'চোখ বন্ধ করুন, মনোযোগ দিন...' : 'শুরু করতে তৈরি?'}
      </p>
    </div>
  );
}

export default function WellnessContentPlayer() {
  const [selectedType, setSelectedType] = useState<SessionType | 'all'>('all');
  const [activeSession, setActiveSession] = useState<WellnessSession | null>(null);
  const [state, setState] = useState<SessionState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [completedToday, setCompletedToday] = useState(0);

  const filteredSessions = selectedType === 'all'
    ? SESSIONS
    : SESSIONS.filter(s => s.type === selectedType);

  const startSession = useCallback((session: WellnessSession) => {
    setActiveSession(session);
    setState('running');
    setElapsed(0);
  }, []);

  const pauseSession = useCallback(() => setState('paused'), []);
  const resumeSession = useCallback(() => setState('running'), []);

  const stopSession = useCallback(() => {
    setActiveSession(null);
    setState('idle');
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (state === 'running') {
      intervalRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1;
          if (activeSession && next >= activeSession.duration) {
            setState('done');
            setCompletedToday(c => c + 1);
            return activeSession.duration;
          }
          return next;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state, activeSession]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${toBn(m)}:${toBn(s).padStart(2, '০')}`;
  };

  // ── Active Session Player ──
  if (activeSession) {
    const progress = activeSession.duration > 0 ? (elapsed / activeSession.duration) * 100 : 0;
    const remaining = activeSession.duration - elapsed;

    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 py-8">
        {/* Visual */}
        {activeSession.type === 'breathing' ? (
          <BreathingCircle session={activeSession} isRunning={state === 'running'} />
        ) : (
          <MeditationVisual session={activeSession} isRunning={state === 'running'} />
        )}

        {/* Timer */}
        <div className="mt-6 text-center">
          <p className="text-3xl font-extrabold text-slate-900" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {formatTime(remaining > 0 ? remaining : 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{activeSession.titleBn}</p>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-xs mt-5">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${progress}%`, background: activeSession.color }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-3 mt-6">
          {state === 'done' ? (
            <>
              <button
                onClick={stopSession}
                className="px-6 py-3 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition active:scale-95"
              >
                ← ফিরে যান
              </button>
              <button
                onClick={() => startSession(activeSession)}
                className="px-6 py-3 rounded-xl text-sm font-bold text-white transition active:scale-95"
                style={{ background: `linear-gradient(135deg, ${activeSession.color}, ${activeSession.color}cc)` }}
              >
                🔁 আবার শুরু
              </button>
            </>
          ) : (
            <>
              <button
                onClick={stopSession}
                className="px-5 py-3 rounded-xl bg-slate-100 text-sm font-bold text-slate-600 transition active:scale-95"
              >
                ✕ বন্ধ
              </button>
              <button
                onClick={state === 'running' ? pauseSession : resumeSession}
                className="px-8 py-3 rounded-xl text-sm font-bold text-white transition active:scale-95"
                style={{ background: `linear-gradient(135deg, ${activeSession.color}, ${activeSession.color}cc)` }}
              >
                {state === 'running' ? '⏸ বিরতি' : '▶ চালু'}
              </button>
            </>
          )}
        </div>

        {/* Done message */}
        {state === 'done' && (
          <div className="mt-6 text-center animate-in fade-in duration-500">
            <span className="text-4xl">🎉</span>
            <p className="text-lg font-bold text-[#006c49] mt-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
              অসাধারণ! সেশন সম্পন্ন!
            </p>
            <p className="text-sm text-slate-500 mt-1">
              আজ {toBn(completedToday)}টি সেশন সম্পন্ন করেছেন
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Session Picker ──
  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-[#191c1e]" style={{ fontFamily: 'Manrope, sans-serif' }}>
          🧘 ওয়েলনেস কন্টেন্ট
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">শ্বাস-প্রশ্বাস, মেডিটেশন ও স্ট্রেচিং</p>
      </div>

      {/* Today's progress */}
      {completedToday > 0 && (
        <div className="rounded-2xl p-4 border border-emerald-100" style={{ background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)' }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏅</span>
            <div>
              <p className="text-sm font-bold text-[#006c49]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                আজ {toBn(completedToday)}টি সেশন সম্পন্ন!
              </p>
              <p className="text-xs text-emerald-600">চালিয়ে যান, আপনি দারুণ করছেন 💪</p>
            </div>
          </div>
        </div>
      )}

      {/* Type filter */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSelectedType(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all active:scale-95 ${
              selectedType === tab.key
                ? 'bg-[#006c49] text-white shadow-md shadow-emerald-900/20'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>{tab.emoji}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* Session cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filteredSessions.map((session) => (
          <button
            key={session.id}
            onClick={() => startSession(session)}
            className="text-left rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all p-5 active:scale-[0.98] group"
            style={{ background: session.bgGradient }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 shadow-sm"
                style={{ background: `${session.color}22`, border: `2px solid ${session.color}33` }}
              >
                {session.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-900 group-hover:text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  {session.titleBn}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  ⏱ {toBn(Math.floor(session.duration / 60))} মিনিট
                </p>
              </div>
            </div>
            <p className="text-[13px] text-slate-600 mt-3 leading-relaxed">
              {session.description}
            </p>
            <div className="mt-3 flex justify-end">
              <span className="text-xs font-bold px-3 py-1.5 rounded-full text-white transition-all group-hover:shadow-md"
                style={{ background: session.color }}>
                শুরু করুন →
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
