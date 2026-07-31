import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router';
import axios from 'axios';
import { authHeader } from '../utils/auth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface NowServingEntry {
  token_no: string;
  counter_no: string | null;
  patient_name: string;
  doctor_name: string | null;
  status?: string;
}

interface WaitingEntry {
  id: number;
  token_no: string;
  token_number: number;
  patient_name: string;
  patient_code: string;
  priority: 'normal' | 'urgent' | 'emergency' | 'vip';
  status: string;
  estimated_wait_minutes: number | null;
  department_name: string | null;
  doctor_name: string | null;
  counter_no: string | null;
  check_in_time: string | null;
}

interface QueueStats {
  total: number;
  waiting: number;
  called: number;
  serving: number;
  completed: number;
  no_show: number;
  cancelled: number;
  nowServing: NowServingEntry[];
}

interface Announcement {
  token_no: string;
  patient_name: string;
  counter_no: string | null;
  doctor_name: string | null;
  announced_at: string;
}

// ─── Priority helpers ────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { ring: string; badge: string; bg: string; label: string }> = {
  emergency: {
    ring: 'ring-2 ring-red-500/60',
    badge: 'bg-red-500 text-white',
    bg: 'from-red-500/20 to-red-600/10',
    label: 'EMERGENCY',
  },
  urgent: {
    ring: 'ring-2 ring-amber-500/60',
    badge: 'bg-amber-500 text-black',
    bg: 'from-amber-500/20 to-amber-600/10',
    label: 'URGENT',
  },
  vip: {
    ring: 'ring-2 ring-purple-400/60',
    badge: 'bg-purple-500 text-white',
    bg: 'from-purple-500/20 to-purple-600/10',
    label: 'VIP',
  },
  normal: {
    ring: '',
    badge: 'bg-slate-600 text-slate-200',
    bg: '',
    label: '',
  },
};

function getPriorityStyle(priority: string) {
  return PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.normal;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function QueueDisplay() {
  const { slug } = useParams<{ slug: string }>();

  const [time, setTime] = useState(new Date());
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [waitingList, setWaitingList] = useState<WaitingEntry[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Fetch data ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const headers = authHeader();
      const [statsRes, tokensRes, announcementsRes] = await Promise.all([
        axios.get('/api/queue/tokens/stats', { headers }),
        axios.get('/api/queue/tokens?status=waiting', { headers }),
        axios.get('/api/queue/announcements?limit=10', { headers }),
      ]);

      setStats(statsRes.data.Results ?? null);
      setWaitingList(tokensRes.data.Results ?? []);
      setAnnouncements(announcementsRes.data.Results ?? []);
      setError(null);
    } catch (err) {
      console.error('Queue display fetch error:', err);
      setError('Unable to connect to queue service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Auto-scroll waiting list ─────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const scrollStep = () => {
      if (!el) return;
      if (el.scrollHeight <= el.clientHeight) {
        scrollPosition.current = 0;
        el.scrollTop = 0;
        return;
      }
      scrollPosition.current += 1;
      if (scrollPosition.current >= el.scrollHeight - el.clientHeight) {
        scrollPosition.current = 0;
      }
      el.scrollTop = scrollPosition.current;
    };

    const scrollInterval = setInterval(scrollStep, 50);
    return () => clearInterval(scrollInterval);
  }, [waitingList]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const nowServing: NowServingEntry[] = stats?.nowServing ?? [];
  const totalWaiting = stats?.waiting ?? 0;
  const totalCalled = stats?.called ?? 0;
  const totalServing = stats?.serving ?? 0;

  const hospitalName = slug
    ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Hospital';

  const dateStr = time.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeStr = time.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  // ── Announcement text ────────────────────────────────────────────────────
  const announcementText = announcements.length > 0
    ? announcements
        .map((a) => {
          const counter = a.counter_no ? ` -- Counter ${a.counter_no}` : '';
          return `Token ${a.token_no} (${a.patient_name})${counter}`;
        })
        .join('    \u2022    ')
    : 'Welcome to ' + hospitalName + '. Please wait for your token number to be called.';

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-xl text-slate-300">Loading Queue Display...</p>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error && !stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-2xl text-red-300 mb-2">Connection Error</p>
          <p className="text-slate-400">{error}</p>
          <p className="text-slate-500 mt-4 text-sm">Retrying every 10 seconds...</p>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white overflow-hidden flex flex-col select-none">

      {/* ━━━ TOP BAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header className="flex-shrink-0 flex items-center justify-between px-8 py-4 bg-slate-900/80 border-b border-slate-700/50 backdrop-blur">
        {/* Left: Hospital name */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-wide">{hospitalName}</h1>
            <p className="text-sm text-slate-400">Patient Queue Display</p>
          </div>
        </div>

        {/* Center: Waiting count */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-teal-500/10 border border-teal-500/30 rounded-2xl px-6 py-2">
            <svg className="w-6 h-6 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div className="text-center">
              <span className="text-3xl font-bold text-teal-300">{totalWaiting}</span>
              <p className="text-xs text-teal-400/80 uppercase tracking-wider">Waiting</p>
            </div>
          </div>

          {(totalCalled + totalServing) > 0 && (
            <div className="flex items-center gap-3 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl px-6 py-2">
              <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <div className="text-center">
                <span className="text-3xl font-bold text-cyan-300">{totalCalled + totalServing}</span>
                <p className="text-xs text-cyan-400/80 uppercase tracking-wider">Serving</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Date & Time */}
        <div className="text-right">
          <p className="text-3xl font-mono font-bold text-white tracking-wider">{timeStr}</p>
          <p className="text-sm text-slate-400 mt-0.5">{dateStr}</p>
        </div>
      </header>

      {/* ━━━ MAIN CONTENT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <main className="flex-1 flex gap-6 p-6 min-h-0">

        {/* ── LEFT: NOW SERVING (60%) ─────────────────────────────────────── */}
        <section className="w-[60%] flex flex-col min-h-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/50" />
            <h2 className="text-3xl font-bold tracking-wide uppercase text-white">Now Serving</h2>
          </div>

          {nowServing.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-dashed border-slate-600 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-2xl text-slate-500 font-medium">No Active Tokens</p>
                <p className="text-slate-600 mt-1">Waiting for the next patient to be called</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-2 gap-5 auto-rows-fr content-start">
              {nowServing.slice(0, 6).map((entry, idx) => {
                const isCalled = entry.status === 'called';
                return (
                  <div
                    key={`${entry.token_no}-${idx}`}
                    className={`
                      relative rounded-2xl p-6 flex flex-col items-center justify-center
                      bg-gradient-to-br from-teal-500/20 via-cyan-500/10 to-slate-800
                      border border-teal-500/30
                      shadow-xl shadow-teal-500/10
                      ${isCalled ? 'animate-pulse' : ''}
                    `}
                  >
                    {/* Called badge */}
                    {isCalled && (
                      <div className="absolute top-3 right-3">
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500 text-black text-xs font-bold uppercase tracking-wider animate-bounce">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                          Called
                        </span>
                      </div>
                    )}

                    {/* Token number */}
                    <span className="text-7xl font-black tracking-tight text-white leading-none mb-3 drop-shadow-lg">
                      {entry.token_no}
                    </span>

                    {/* Patient name */}
                    <p className="text-xl font-semibold text-teal-100 mb-2 truncate max-w-full text-center">
                      {entry.patient_name}
                    </p>

                    {/* Counter / Doctor */}
                    <div className="flex items-center gap-4 text-sm text-slate-300">
                      {entry.counter_no && (
                        <span className="flex items-center gap-1.5 bg-slate-700/60 px-3 py-1 rounded-full">
                          <svg className="w-4 h-4 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          Counter {entry.counter_no}
                        </span>
                      )}
                      {entry.doctor_name && (
                        <span className="flex items-center gap-1.5 bg-slate-700/60 px-3 py-1 rounded-full">
                          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {entry.doctor_name}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── RIGHT: WAITING LIST (40%) ───────────────────────────────────── */}
        <section className="w-[40%] flex flex-col min-h-0 bg-slate-800/50 rounded-2xl border border-slate-700/50 overflow-hidden">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-slate-800/80 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h2 className="text-2xl font-bold uppercase tracking-wide text-slate-200">Waiting</h2>
            </div>
            <span className="text-lg font-bold bg-slate-700 text-slate-300 px-4 py-1 rounded-full">
              {totalWaiting}
            </span>
          </div>

          {/* Table header */}
          <div className="flex-shrink-0 grid grid-cols-[80px_1fr_100px_90px] gap-2 px-6 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-700/30">
            <span>Token</span>
            <span>Patient</span>
            <span className="text-center">Priority</span>
            <span className="text-right">Est. Wait</span>
          </div>

          {/* Scrollable list */}
          <div ref={scrollRef} className="flex-1 overflow-hidden">
            {waitingList.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <svg className="w-16 h-16 text-slate-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-slate-500 text-lg">No patients waiting</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {waitingList.map((entry) => {
                  const ps = getPriorityStyle(entry.priority);
                  return (
                    <div
                      key={entry.id}
                      className={`
                        grid grid-cols-[80px_1fr_100px_90px] gap-2 items-center px-6 py-3
                        hover:bg-slate-700/20 transition-colors
                        ${entry.priority !== 'normal' ? `bg-gradient-to-r ${ps.bg}` : ''}
                        ${ps.ring}
                      `}
                    >
                      {/* Token */}
                      <span className="text-xl font-bold text-white">{entry.token_no}</span>

                      {/* Patient */}
                      <div className="truncate">
                        <p className="text-base font-medium text-slate-200 truncate">{entry.patient_name}</p>
                        {entry.department_name && (
                          <p className="text-xs text-slate-500 truncate">{entry.department_name}</p>
                        )}
                      </div>

                      {/* Priority */}
                      <div className="text-center">
                        {entry.priority !== 'normal' ? (
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ps.badge}`}>
                            {ps.label}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">--</span>
                        )}
                      </div>

                      {/* Estimated wait */}
                      <div className="text-right">
                        {entry.estimated_wait_minutes != null ? (
                          <span className="text-base font-semibold text-slate-300">
                            ~{entry.estimated_wait_minutes}<span className="text-xs text-slate-500 ml-0.5">min</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">--</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ━━━ BOTTOM BAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <footer className="flex-shrink-0 bg-slate-900/90 border-t border-slate-700/50 backdrop-blur">
        {/* Announcement marquee */}
        <div className="relative overflow-hidden h-12 flex items-center">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-slate-900 to-transparent z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-slate-900 to-transparent z-10" />

          <div
            className="whitespace-nowrap text-lg font-medium text-teal-300/80"
            style={{
              animation: 'queueMarquee 30s linear infinite',
            }}
          >
            <span className="mx-4 text-amber-400">{'\u25B6'}</span>
            {announcementText}
            <span className="mx-8">{'\u2022'}</span>
            {announcementText}
          </div>
        </div>

        {/* Bottom info line */}
        <div className="flex items-center justify-between px-8 py-2 border-t border-slate-800/50 text-xs text-slate-600">
          <span>Auto-refreshes every 10 seconds</span>
          <span>Powered by <span className="text-teal-500 font-semibold">Ozzyl Health</span></span>
        </div>
      </footer>

      {/* ── Marquee keyframes (injected via style tag) ──────────────────── */}
      <style>{`
        @keyframes queueMarquee {
          0% { transform: translateX(50%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
