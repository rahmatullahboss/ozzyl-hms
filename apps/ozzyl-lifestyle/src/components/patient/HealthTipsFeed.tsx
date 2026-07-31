import { useState, useEffect } from 'react';

interface HealthTip {
  id: string;
  emoji: string;
  category: string;
  categoryBn: string;
  title: string;
  summary?: string;
  brief?: string;
  readTime?: string;
  bgColor?: string;
  categoryColor?: string;
  personalized?: boolean;
}

// Fallback tips if API is unavailable
const STATIC_TIPS: HealthTip[] = [
  {
    id: 'tip-1', emoji: '🥗', category: 'nutrition', categoryBn: 'পুষ্টি',
    title: 'রাতে ভারি খাবার এড়িয়ে চলুন',
    brief: 'রাত ৮টার পর হালকা খাবার খেলে ঘুমের মান ৪০% উন্নত হয়।',
  },
  {
    id: 'tip-2', emoji: '🧘', category: 'mental', categoryBn: 'মানসিক',
    title: '৫ মিনিটের শ্বাস-প্রশ্বাস ব্যায়াম',
    brief: 'প্রতিদিন ৫ মিনিট গভীর শ্বাস-প্রশ্বাসের অভ্যাস মানসিক চাপ কমায়।',
  },
  {
    id: 'tip-3', emoji: '💧', category: 'exercise', categoryBn: 'ব্যায়াম',
    title: 'ব্যায়ামের আগে পানি পান করুন',
    brief: 'ব্যায়ামের ৩০ মিনিট আগে ২ গ্লাস পানি পান করলে কর্মক্ষমতা বাড়ে।',
  },
  {
    id: 'tip-4', emoji: '😴', category: 'sleep', categoryBn: 'ঘুম',
    title: 'ঘুমের আগে স্ক্রিন বন্ধ রাখুন',
    brief: 'ঘুমানোর ১ ঘণ্টা আগে ফোন ও ল্যাপটপ বন্ধ রাখলে মেলাটোনিন স্বাভাবিক থাকে।',
  },
  {
    id: 'tip-5', emoji: '🚶', category: 'exercise', categoryBn: 'ব্যায়াম',
    title: 'প্রতিদিন ৩০ মিনিট হাঁটুন',
    brief: 'নিয়মিত হাঁটা হৃদরোগের ঝুঁকি ৩৫% এবং ডায়াবেটিসের ঝুঁকি ৩০% কমায়।',
  },
  {
    id: 'tip-6', emoji: '🍊', category: 'nutrition', categoryBn: 'পুষ্টি',
    title: 'সকালে লেবু পানি পান করুন',
    brief: 'উষ্ণ লেবু পানি হজমশক্তি বাড়ায় এবং শরীরের টক্সিন বের করতে সাহায্য করে।',
  },
];

const categoryStyles: Record<string, { bg: string; color: string }> = {
  nutrition: { bg: 'bg-emerald-50', color: 'text-[#006c49]' },
  exercise: { bg: 'bg-blue-50', color: 'text-emerald-700' },
  mental: { bg: 'bg-amber-50', color: 'text-amber-700' },
  sleep: { bg: 'bg-indigo-50', color: 'text-indigo-700' },
};

const CATEGORIES = [
  { key: 'all', label: 'সব' },
  { key: 'nutrition', label: 'পুষ্টি' },
  { key: 'exercise', label: 'ব্যায়াম' },
  { key: 'mental', label: 'মানসিক' },
  { key: 'sleep', label: 'ঘুম' },
];

export default function HealthTipsFeed() {
  const [tips, setTips] = useState<HealthTip[]>(STATIC_TIPS);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [savedTips, setSavedTips] = useState<Set<string>>(new Set());
  const [personaSummary, setPersonaSummary] = useState<string[] | null>(null);

  const PERSONA_LABELS: Record<string, string> = {
    low_sleep: '😴 ঘুম কম', low_mood: '😔 মুড', low_exercise: '🏃 ব্যায়াম কম',
    low_energy: '⚡ শক্তি কম', high_bp: '❤️ উচ্চ রক্তচাপ', stress: '😰 স্ট্রেস',
  };

  // Try fetching from backend; fallback to static
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/patient-phr/health-tips', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json() as { tips?: HealthTip[]; persona_summary?: string[] };
          if (mounted && data.tips?.length) {
            setTips(data.tips.map((t) => ({
              ...t,
              brief: t.brief || t.summary || '',
            })));
            if (data.persona_summary) {
              setPersonaSummary(data.persona_summary);
            }
          }
        }
      } catch { /* use static fallback */ }
    })();
    return () => { mounted = false; };
  }, []);

  const filteredTips = selectedCategory === 'all'
    ? tips
    : tips.filter((t) => t.category === selectedCategory);

  function toggleSave(tipId: string) {
    setSavedTips((prev) => {
      const next = new Set(prev);
      if (next.has(tipId)) next.delete(tipId);
      else next.add(tipId);
      return next;
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Filter Chips */}
      <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setSelectedCategory(cat.key)}
            className={`px-5 py-2 rounded-full font-semibold text-sm whitespace-nowrap transition-all duration-200 active:scale-95 ${
              selectedCategory === cat.key
                ? 'bg-[#10b981] text-white shadow-sm'
                : 'bg-[#e6e8ea] text-[#3c4a42] hover:bg-[#e0e3e5]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Featured Hero Card */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#006c49] to-[#10b981] p-7 text-white shadow-xl shadow-emerald-500/20 transition-transform duration-300 hover:scale-[1.005]">
        {/* Abstract shapes */}
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -left-12 -bottom-12 w-32 h-32 bg-amber-400/20 rounded-full blur-2xl" />

        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-[#fea619] text-[#684000] text-sm font-bold mb-4">
            আজকের টিপ ✨
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold leading-tight tracking-tight mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>
            সকালের রোদে ১৫ মিনিট — ভিটামিন ডি এর সেরা উৎস
          </h2>
          <p className="text-white/90 leading-relaxed mb-5 text-sm">
            প্রতিদিন সকাল ৮-১০টার মধ্যে ১৫ মিনিট রোদে থাকলে শরীরে পর্যাপ্ত ভিটামিন ডি তৈরি হয়।
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 opacity-90">
              <span className="text-sm">⏱️</span>
              <span className="text-xs font-medium">২ মিনিট পড়ুন</span>
            </div>
            <button className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors">
              ❤️
            </button>
          </div>
        </div>
      </div>

      {/* Personalization Banner */}
      {personaSummary && personaSummary.length > 0 && (
        <div className="rounded-2xl p-4 border border-emerald-100" style={{ background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)' }}>
          <div className="flex items-start gap-3">
            <span className="text-xl mt-0.5">🎯</span>
            <div>
              <p className="text-sm font-bold text-[#006c49]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                আপনার জন্য বিশেষায়িত টিপস
              </p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {personaSummary.map((flag) => (
                  <span key={flag} className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/70 text-[#006c49] border border-emerald-200">
                    {PERSONA_LABELS[flag] || flag}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-emerald-600 mt-2">গত ৭ দিনের ডেটা থেকে নির্বাচিত</p>
            </div>
          </div>
        </div>
      )}

      {/* Tips List */}
      <div className="space-y-5">
        {filteredTips.map((tip) => {
          const style = categoryStyles[tip.category] ?? { bg: 'bg-gray-50', color: 'text-gray-600' };
          return (
            <div
              key={tip.id}
              className={`group bg-white rounded-3xl p-5 shadow-sm transition-all duration-300 hover:shadow-md flex gap-4 items-start ${tip.personalized ? 'ring-2 ring-emerald-200 ring-offset-1' : ''}`}
            >
              <div className={`w-12 h-12 rounded-2xl ${tip.bgColor || style.bg} flex items-center justify-center text-2xl shrink-0 group-hover:scale-110 transition-transform`}>
                {tip.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${tip.categoryColor || style.color} uppercase tracking-wider`}>
                      {tip.categoryBn}
                    </span>
                    {tip.personalized && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-[#006c49]">
                        🎯 আপনার জন্য
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => toggleSave(tip.id)}
                    className="text-slate-300 hover:text-[#006c49] transition-colors text-lg"
                  >
                    {savedTips.has(tip.id) ? '🔖' : '🏷️'}
                  </button>
                </div>
                <h3 className="text-base font-bold text-[#191c1e] mb-1.5" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  {tip.title}
                </h3>
                <p className="text-[#3c4a42] text-sm leading-relaxed">
                  {tip.brief || tip.summary}
                </p>
                {tip.readTime && (
                  <span className="text-xs text-[#6c7a71] mt-2 inline-block">⏱️ {tip.readTime}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Disclaimer */}
      <p className="text-center text-xs text-[#3c4a42]/60 leading-relaxed italic py-4">
        এই তথ্যগুলো সাধারণ স্বাস্থ্য সচেতনতার জন্য। চিকিৎসা পরামর্শের বিকল্প নয়।
      </p>
    </div>
  );
}
