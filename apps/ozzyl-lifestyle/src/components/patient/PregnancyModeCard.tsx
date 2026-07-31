import { useEffect, useMemo, useState } from 'react';
import { Baby, CalendarHeart, Sparkles } from 'lucide-react';
import {
  getPregnancyInfo,
  getPregnancyNutritionTips,
  type NutritionTip,
} from '../../lib/pregnancy-utils';

function decodeStoredLmp(): string {
  const raw = localStorage.getItem('ozzyl_pregnancy_lmp');
  if (!raw) return '';
  try {
    return atob(raw);
  } catch {
    return raw;
  }
}

export default function PregnancyModeCard() {
  const [lmpDate, setLmpDate] = useState<string>(() => decodeStoredLmp());
  const [draftDate, setDraftDate] = useState<string>(() => decodeStoredLmp());
  const info = useMemo(() => (lmpDate ? getPregnancyInfo(lmpDate) : null), [lmpDate]);
  const [tips, setTips] = useState<NutritionTip[]>([]);

  useEffect(() => {
    if (!info) {
      setTips([]);
      return;
    }
    setTips(getPregnancyNutritionTips(info.trimester));
  }, [info]);

  if (!info) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
            <Baby className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-600">Pregnancy mode</p>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Track trimester progress privately</h3>
            <p className="mt-2 text-sm text-slate-500">
              Save the first day of the last menstrual period to unlock weekly progress and trimester-specific tips.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
          />
          <button
            onClick={() => {
              if (!draftDate) return;
              localStorage.setItem('ozzyl_pregnancy_lmp', btoa(draftDate));
              setLmpDate(draftDate);
            }}
            className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500"
          >
            Start tracking
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-rose-200 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-rose-500 to-pink-500 p-5 text-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/80">Pregnancy mode</p>
            <h3 className="mt-2 text-2xl font-black">Week {info.currentWeek}, Day {info.currentDay}</h3>
            <p className="mt-2 text-sm text-white/85">Trimester {info.trimester} • {info.progressPercent}% complete</p>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('ozzyl_pregnancy_lmp');
              setLmpDate('');
              setDraftDate('');
            }}
            className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due date</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{info.dueDate}</p>
            <p className="mt-1 text-xs text-slate-500">{info.daysUntilDue} days remaining</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Baby milestone</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{info.babySize}</p>
            <p className="mt-1 text-xs text-slate-500">{info.developmentNote}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
          <div className="flex items-center gap-2 text-rose-700">
            <CalendarHeart className="h-4 w-4" />
            <p className="text-sm font-semibold">Trimester nutrition focus</p>
          </div>
          <div className="mt-3 space-y-3">
            {tips.slice(0, 2).map((tip) => (
              <div key={tip.title} className="rounded-2xl bg-white/80 p-3">
                <div className="flex items-center gap-2 text-slate-900">
                  <Sparkles className="h-4 w-4 text-rose-500" />
                  <p className="text-sm font-semibold">{tip.title}</p>
                </div>
                <p className="mt-1 text-sm text-slate-600">{tip.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
