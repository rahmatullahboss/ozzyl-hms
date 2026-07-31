import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Area, AreaChart } from 'recharts';

interface TrendItem {
  date: string;
  overall: number;
  breakdown: {
    sleep: number;
    activity: number;
    nutrition: number;
    mood: number;
    medication: number;
    vitals: number;
  } | null;
}

interface WellnessTrendsTabProps {
  isSessionReady: boolean;
}

const toBn = (n: number): string =>
  n.toString().replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const DAY_LABELS = ['রবি', 'সো', 'মং', 'বু', 'বৃ', 'শু', 'শনি'];
const PERIOD_OPTIONS = [
  { value: 7, label: '৭ দিন' },
  { value: 30, label: '৩০ দিন' },
  { value: 90, label: '৯০ দিন' },
] as const;

export default function WellnessTrendsTab({ isSessionReady }: WellnessTrendsTabProps) {
  const [period, setPeriod] = useState<7 | 30 | 90>(7);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSessionReady) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/wellness/trends?days=${period}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('patient_token')}`
          }
        });
        if (res.ok) {
          const data = await res.json() as { trends?: TrendItem[] };
          if (mounted && data.trends) setTrends(data.trends);
        }
      } catch { /* silent */ }
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [isSessionReady, period]);

  // Transform daily_data to chart format
  const chartData = useMemo(() => {
    return trends.map((log, idx) => {
      const d = new Date(log.date);
      return {
        label: period <= 7 ? DAY_LABELS[d.getDay()] : `${d.getDate()}`,
        overall: log.overall ?? 0,
        sleep: log.breakdown?.sleep ?? 0,
        activity: log.breakdown?.activity ?? 0,
        nutrition: log.breakdown?.nutrition ?? 0,
        mood: log.breakdown?.mood ?? 0,
        idx,
      };
    });
  }, [trends, period]);

  const checkedDays = trends.length;
  
  // Calculate averages based on returned days
  let avgOverall = 0;
  let avgSleep = 0;
  let avgActivity = 0;
  
  if (checkedDays > 0) {
      avgOverall = trends.reduce((acc, curr) => acc + curr.overall, 0) / checkedDays;
      avgSleep = trends.reduce((acc, curr) => acc + (curr.breakdown?.sleep ?? 0), 0) / checkedDays;
      avgActivity = trends.reduce((acc, curr) => acc + (curr.breakdown?.activity ?? 0), 0) / checkedDays;
  }

  // Consistency = (days logged / period) * 100
  const consistency = Math.min(Math.round((checkedDays / period) * 100), 100);

  // SVG circle math for consistency ring
  const circleR = 58;
  const circumference = 2 * Math.PI * circleR;
  const dashOffset = circumference - (circumference * consistency) / 100;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-2xl h-48" />
        ))}
      </div>
    );
  }

  if (trends.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="text-5xl">📊</div>
        <h3 className="text-xl font-bold text-slate-800">এখনও কোনো ডেটা নেই</h3>
        <p className="text-sm text-slate-500 max-w-xs mx-auto">
          ট্রেন্ড দেখতে প্রতিদিন চেক-ইন করুন। আপনার মেজাজ, ঘুম ও ব্যায়ামের ধারা এখানে দেখানো হবে।
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-20">
      {/* Period Switcher */}
      <div className="flex justify-center">
        <div className="bg-[#e0e3e5] p-1.5 rounded-2xl flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                period === opt.value
                  ? 'bg-gradient-to-r from-[#006c49] to-[#10b981] text-white shadow-sm'
                  : 'text-[#3c4a42] hover:bg-[#e6e8ea]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

        {/* Overall Health Trend — Large */}
        <div className="md:col-span-8 bg-white p-6 rounded-2xl transition-transform duration-200 hover:scale-[1.005]">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h2 className="text-lg font-bold text-[#191c1e] flex items-center gap-2">
                সামগ্রিক স্বাস্থ্য স্কোর 💖
              </h2>
              <span className="inline-flex mt-2 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full">
                গড় স্কোর {toBn(Math.round(avgOverall))} — {avgOverall >= 80 ? 'চমৎকার' : avgOverall >= 60 ? 'ভালো' : 'উন্নতি দরকার'}
              </span>
            </div>
          </div>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(v) => [`${toBn(Number(v ?? 0))} পয়েন্ট`, 'স্কোর']}
                />
                <Area type="monotone" dataKey="overall" stroke="#006c49" strokeWidth={3} fill="url(#scoreGradient)" dot={{ r: 4, fill: '#006c49', strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Consistency Ring — Compact */}
        <div className="md:col-span-4 bg-gradient-to-br from-[#006c49] to-[#10b981] p-6 rounded-2xl text-white flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute -right-8 -top-8 w-28 h-28 bg-white/10 rounded-full blur-2xl" />
          <div className="relative w-28 h-28 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r={circleR} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
              <circle cx="64" cy="64" r={circleR} fill="none" stroke="white" strokeWidth="8" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold">{toBn(consistency)}%</span>
              <span className="text-[9px] font-medium opacity-80 uppercase tracking-wider">স্কোর</span>
            </div>
          </div>
          <h3 className="mt-3 font-bold text-base">ধারাবাহিকতা</h3>
          <p className="mt-1 text-xs opacity-90">
            আপনি {toBn(checkedDays)}/{toBn(period)} দিন ট্র্যাকিং করেছেন
          </p>
        </div>

        {/* Sleep Score Trend */}
        <div className="md:col-span-6 bg-white p-6 rounded-2xl border border-slate-100">
          <div className="flex justify-between items-start mb-5">
            <div>
              <h2 className="text-lg font-bold text-[#191c1e]">ঘুমের মান 🌙</h2>
              <p className="text-sm text-[#3c4a42] font-medium mt-1">
                গড় স্কোর {toBn(Math.round(avgSleep))}
              </p>
            </div>
          </div>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(v) => [`${toBn(Number(v ?? 0))}`, 'ঘুমের স্কোর']}
                />
                <Bar dataKey="sleep" fill="#60a5fa" radius={[6, 6, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activity Score Trend */}
        <div className="md:col-span-6 bg-white p-6 rounded-2xl border border-slate-100">
          <div className="flex justify-between items-center mb-5">
            <div>
               <h2 className="text-lg font-bold text-[#191c1e]">অ্যাক্টিভিটি ⚡</h2>
               <p className="text-sm text-[#3c4a42] font-medium mt-1">
                 গড় স্কোর {toBn(Math.round(avgActivity))}
               </p>
            </div>
          </div>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', fontSize: 12 }}
                  formatter={(v) => [`${toBn(Number(v ?? 0))}`, 'অ্যাক্টিভিটি']}
                />
                <Bar dataKey="activity" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Wellness CTA */}
      <div className="bg-[#e6e8ea]/50 p-6 rounded-2xl flex flex-col md:flex-row items-center gap-5">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-emerald-900">অসাধারণ! 🌿</h3>
          <p className="text-sm text-[#3c4a42] mt-2 leading-relaxed">
            {avgOverall >= 80
              ? 'আপনার স্বাস্থ্য স্কোর খুব ভালো! এই রুটিন বজায় রাখুন।'
              : 'নিয়মিত চেক-ইন করুন এবং আপনার স্বাস্থ্যের উন্নতি ট্র্যাক করুন।'}
          </p>
        </div>
      </div>
    </div>
  );
}
