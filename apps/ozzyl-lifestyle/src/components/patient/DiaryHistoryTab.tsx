import { useState, useEffect, useMemo } from 'react';

interface LifestyleLog {
  logged_on: string;
  mood_score: number | null;
  energy_level: number | null;
  sleep_hours: number | null;
  sleep_quality: string | null;
  exercise_minutes: number | null;
  mood: string | null;
  notes: string | null;
  water_glasses?: number | null;
}

interface DiaryHistoryTabProps {
  isSessionReady: boolean;
}

const toBn = (n: number): string =>
  n.toString().replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const MOOD_MAP: Record<string, { emoji: string; labelBn: string }> = {
  excellent: { emoji: '😊', labelBn: 'চমৎকার' },
  good: { emoji: '🙂', labelBn: 'ভালো' },
  neutral: { emoji: '😐', labelBn: 'মোটামুটি' },
  okay: { emoji: '😐', labelBn: 'মোটামুটি' },
  low: { emoji: '😟', labelBn: 'খারাপ' },
  bad: { emoji: '😟', labelBn: 'খারাপ' },
  very_low: { emoji: '😢', labelBn: 'খুব খারাপ' },
  terrible: { emoji: '😢', labelBn: 'খুব খারাপ' },
};

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

const WEEKDAYS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহ', 'শুক্র', 'শনি'];

function getMonthDays(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function DiaryHistoryTab({ isSessionReady }: DiaryHistoryTabProps) {
  const [logs, setLogs] = useState<LifestyleLog[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  useEffect(() => {
    if (!isSessionReady) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/patient-phr/lifestyle-logs?limit=90', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json() as { lifestyle_logs?: LifestyleLog[] };
          if (mounted && data.lifestyle_logs) setLogs(data.lifestyle_logs);
        }
      } catch { /* silent */ }
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [isSessionReady]);

  // Set of dates that have check-ins
  const checkedDates = useMemo(
    () => new Set(logs.map((l) => l.logged_on.slice(0, 10))),
    [logs],
  );

  // Calendar grid
  const totalDays = getMonthDays(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const calendarCells: (null | number)[] = Array.from({ length: firstDay }, () => null);
  for (let d = 1; d <= totalDays; d++) calendarCells.push(d);

  const isToday = (day: number) => {
    return day === now.getDate() && viewMonth === now.getMonth() && viewYear === now.getFullYear();
  };

  const dayHasLog = (day: number) => {
    const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return checkedDates.has(key);
  };

  // Filtered logs for current month, sorted descending
  const monthLogs = useMemo(() => {
    const prefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    return logs
      .filter((l) => l.logged_on.startsWith(prefix))
      .sort((a, b) => b.logged_on.localeCompare(a.logged_on));
  }, [logs, viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const formatLogDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = toBn(d.getDate());
    const month = MONTHS_BN[d.getMonth()];
    const weekday = WEEKDAYS_BN[d.getDay()];
    return `${day} ${month}, ${weekday}`;
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl h-40" />
        <div className="bg-white rounded-2xl h-48" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Month Navigation */}
      <div className="flex items-center justify-between px-2">
        <button
          onClick={prevMonth}
          className="p-2 bg-[#f2f4f6] rounded-full active:scale-95 transition-all hover:bg-[#e6e8ea]"
        >
          <span className="text-[#3c4a42] text-lg">‹</span>
        </button>
        <h2 className="font-bold text-lg text-[#006c49]" style={{ fontFamily: 'Manrope, sans-serif' }}>
          {MONTHS_BN[viewMonth]} {toBn(viewYear)}
        </h2>
        <button
          onClick={nextMonth}
          className="p-2 bg-[#f2f4f6] rounded-full active:scale-95 transition-all hover:bg-[#e6e8ea]"
        >
          <span className="text-[#3c4a42] text-lg">›</span>
        </button>
      </div>

      {/* Heat-map Calendar */}
      <div className="bg-[#f2f4f6] p-5 rounded-2xl relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#10b981]/10 rounded-full blur-3xl" />
        <div className="relative z-10">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-2 mb-3 text-center">
            {WEEKDAYS_BN.map((wd) => (
              <span key={wd} className="text-[10px] font-bold text-slate-400 uppercase">{wd}</span>
            ))}
          </div>
          {/* Day dots */}
          <div className="grid grid-cols-7 gap-2 justify-items-center">
            {calendarCells.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="w-[10px] h-[10px]" />;
              const hasLog = dayHasLog(day);
              const today = isToday(day);
              return (
                <div
                  key={day}
                  className={`w-[10px] h-[10px] rounded-full transition-all duration-200 ${
                    hasLog ? 'bg-[#10b981]' : 'bg-[#e0e3e5]'
                  } ${today ? 'ring-4 ring-[#10b981]/30 ring-offset-2 ring-offset-[#f2f4f6]' : ''}`}
                  title={`${toBn(day)} — ${hasLog ? 'চেক-ইন ✓' : 'মিস'}`}
                />
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex justify-center gap-5 text-xs font-medium text-[#3c4a42] mt-4">
            <div className="flex items-center gap-2">
              <div className="w-[10px] h-[10px] rounded-full bg-[#10b981]" />
              <span>✓ চেক-ইন</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-[10px] h-[10px] rounded-full bg-[#e0e3e5]" />
              <span>- মিস</span>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Cards */}
      {monthLogs.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <div className="text-4xl">📚</div>
          <p className="text-sm text-slate-500">এই মাসে কোনো চেক-ইন নেই</p>
        </div>
      ) : (
        <div className="space-y-5">
          {monthLogs.map((log, idx) => {
            const moodInfo = MOOD_MAP[log.mood ?? 'okay'] ?? MOOD_MAP.okay;
            const isFirst = idx === 0;

            return (
              <article
                key={log.logged_on}
                className={`bg-white p-5 rounded-2xl shadow-sm transition-all hover:shadow-md ${
                  isFirst ? 'border-l-4 border-[#006c49]' : ''
                }`}
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-[#3c4a42] text-sm font-medium">{formatLogDate(log.logged_on)}</p>
                    <h3 className="font-bold text-lg mt-0.5" style={{ fontFamily: 'Manrope, sans-serif' }}>
                      Mood: {moodInfo.emoji} {moodInfo.labelBn}
                    </h3>
                  </div>
                  {isFirst && (
                    <div className="bg-[#10b981]/10 px-3 py-1 rounded-full text-[#006c49] text-xs font-bold">
                      আজকের ডায়েরি
                    </div>
                  )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {/* Energy */}
                  <div className="bg-[#f2f4f6] p-3 rounded-xl">
                    <p className="text-[10px] text-[#3c4a42] mb-1">এনার্জি লেভেল</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-[#e6e8ea] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#10b981] rounded-full transition-all"
                          style={{ width: `${({ very_low: 25, low: 50, moderate: 75, high: 100 } as Record<string, number>)[String(log.energy_level)] ?? 50}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-[#006c49]">
                        {({ very_low: 'কম', low: 'হালকা', moderate: 'মাঝারি', high: 'ভালো' } as Record<string, string>)[String(log.energy_level)] ?? '—'}
                      </span>
                    </div>
                  </div>
                  {/* Sleep */}
                  <div className="bg-[#f2f4f6] p-3 rounded-xl flex items-center gap-2.5">
                    <span className="text-lg">🌙</span>
                    <div>
                      <p className="text-[9px] text-[#3c4a42] leading-none">ঘুম</p>
                      <p className="text-sm font-bold">
                        {toBn(log.sleep_hours ?? 0)} ঘণ্টা{' '}
                        <span className="text-[9px] font-normal">({log.sleep_quality ?? 'গভীর'})</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  {/* Exercise */}
                  <div className={`flex-1 bg-[#f2f4f6] p-3 rounded-xl flex items-center gap-2.5 ${
                    (log.exercise_minutes ?? 0) === 0 ? 'opacity-60' : ''
                  }`}>
                    <span className="text-lg">🏃</span>
                    <div>
                      <p className="text-[9px] text-[#3c4a42] leading-none">ব্যায়াম</p>
                      <p className="text-sm font-bold">{toBn(log.exercise_minutes ?? 0)} মিনিট</p>
                    </div>
                  </div>
                  {/* Water */}
                  <div className="flex-1 bg-[#f2f4f6] p-3 rounded-xl flex items-center gap-2.5">
                    <span className="text-lg">💧</span>
                    <div>
                      <p className="text-[9px] text-[#3c4a42] leading-none">পানি</p>
                      <p className="text-sm font-bold">{toBn(log.water_glasses ?? 0)}/৮ গ্লাস</p>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {log.notes && (
                  <div className="mt-3 pt-3 border-t border-[#e6e8ea]">
                    <p className="text-[#3c4a42] text-sm italic">"{log.notes}"</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Load more hint */}
      {monthLogs.length > 0 && (
        <div className="text-center pb-4">
          <p className="text-[#3c4a42]/60 text-xs flex items-center justify-center gap-2">
            আরো পুরনো তথ্য দেখতে মাস পরিবর্তন করুন ↑
          </p>
        </div>
      )}
    </div>
  );
}
