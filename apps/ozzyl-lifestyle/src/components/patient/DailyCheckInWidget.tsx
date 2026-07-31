import { useState } from 'react';
import { X, Minus, Plus, Droplets, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DailyCheckInWidgetProps {
  onClose: () => void;
  onSubmit: (data: CheckInData) => void;
  currentStreak: number;
  initialData?: Partial<CheckInData>;
}

export interface CheckInData {
  mood: 'excellent' | 'good' | 'okay' | 'bad' | 'terrible';
  energy: number;
  sleepHours: number;
  sleepQuality: 'deep' | 'light' | 'insomnia';
  exerciseMinutes: number;
  waterGlasses: number;
  notes: string;
}

const MOODS = [
  { key: 'excellent' as const, emoji: '😊' },
  { key: 'good' as const, emoji: '🙂' },
  { key: 'okay' as const, emoji: '😐' },
  { key: 'bad' as const, emoji: '😔' },
  { key: 'terrible' as const, emoji: '😫' },
];

const SLEEP_QUALITIES = [
  { key: 'deep' as const, icon: '⭐' },
  { key: 'light' as const, icon: '🌊' },
  { key: 'insomnia' as const, icon: '😴' },
];

const EXERCISE_OPTIONS = [0, 15, 30, 45, 60];

export default function DailyCheckInWidget({ onClose, onSubmit, currentStreak, initialData }: DailyCheckInWidgetProps) {
  const { t, i18n } = useTranslation('patientPortal');
  const lang = i18n.language === 'bn' ? 'bn-BD' : 'en-US';
  const [mood, setMood] = useState<CheckInData['mood']>(initialData?.mood ?? 'excellent');
  const [energy, setEnergy] = useState(initialData?.energy ?? 8);
  const [sleepHours, setSleepHours] = useState(initialData?.sleepHours ?? 7.5);
  const [sleepQuality, setSleepQuality] = useState<CheckInData['sleepQuality']>(initialData?.sleepQuality ?? 'deep');
  const [exerciseMinutes, setExerciseMinutes] = useState(initialData?.exerciseMinutes ?? 30);
  const [waterGlasses, setWaterGlasses] = useState(initialData?.waterGlasses ?? 5);
  const [notes, setNotes] = useState(initialData?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit({
        mood,
        energy,
        sleepHours,
        sleepQuality,
        exerciseMinutes,
        waterGlasses,
        notes,
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Convert numbers to localized string
  const energyLoc = energy.toLocaleString(lang);
  const sleepLoc = sleepHours.toLocaleString(lang, { minimumFractionDigits: 1 });

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-md bg-[#f2f4f6] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300 max-h-[92vh] flex flex-col">
        {/* Drag Handle */}
        <div className="w-full flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1.5 bg-slate-300 rounded-full" />
        </div>

        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-xl flex items-center justify-between px-6 py-4">
          <button
            onClick={onClose}
            className="p-2 -ml-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
          <h1 className="font-bold tracking-tight text-emerald-700 text-lg">{t('checkin.widget.title')}</h1>
          <div className="w-9" /> {/* Spacer for centering */}
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8 pb-36">
          {/* Subtitle */}
          <p className="text-center text-slate-500 font-medium -mt-2">{t('checkin.widget.subtitle')}</p>

          {/* Mood Section */}
          <section className="space-y-4">
            <h2 className="text-emerald-700 font-bold text-lg">{t('checkin.widget.moodQuestion')}</h2>
            <div className="flex flex-wrap gap-3 justify-center">
              {MOODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMood(m.key)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-200 ${
                    mood === m.key
                      ? 'bg-emerald-500 text-white ring-2 ring-emerald-400 ring-offset-2 scale-105 shadow-lg shadow-emerald-500/20'
                      : 'bg-white hover:bg-emerald-50'
                  }`}
                >
                  <span className="text-2xl">{m.emoji}</span>
                  <span className={`text-xs font-semibold ${mood === m.key ? 'text-white' : 'text-slate-600'}`}>
                    {t(`checkin.widget.moods.${m.key}`)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Energy Level */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-emerald-700 font-bold text-lg">{t('checkin.widget.energyQuestion')}</h2>
              <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-bold text-sm">
                {energyLoc}/{(10).toLocaleString(lang)}
              </span>
            </div>
            <div className="px-2">
              <input
                type="range"
                min={1}
                max={10}
                value={energy}
                onChange={(e) => setEnergy(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-emerald-500
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                  [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-emerald-500
                  [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #d1d5db 0%, #10b981 ${(energy - 1) * 11.1}%, #e2e8f0 ${(energy - 1) * 11.1}%)`,
                }}
              />
              <div className="flex justify-between mt-2 text-xs font-medium text-slate-400">
                <span>{t('checkin.widget.energyTired')}</span>
                <span>{t('checkin.widget.energyFresh')}</span>
              </div>
            </div>
          </section>
 
          {/* Sleep Hours */}
          <section className="space-y-4">
            <h2 className="text-emerald-700 font-bold text-lg">{t('checkin.widget.sleepQuestion')}</h2>
            <div className="bg-white rounded-[1.5rem] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSleepHours(Math.max(0, sleepHours - 0.5))}
                  className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors active:scale-95"
                >
                  <Minus className="w-5 h-5 text-slate-600" />
                </button>
                <div className="text-center">
                  <span className="text-3xl font-extrabold tracking-tight text-slate-900">{sleepLoc}</span>
                  <span className="text-slate-500 font-medium ml-1">{t('checkin.widget.sleepUnit')}</span>
                </div>
                <button
                  onClick={() => setSleepHours(Math.min(24, sleepHours + 0.5))}
                  className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors active:scale-95"
                >
                  <Plus className="w-5 h-5 text-slate-600" />
                </button>
              </div>
              <div className="flex gap-2 justify-center">
                {SLEEP_QUALITIES.map((q) => (
                  <button
                    key={q.key}
                    onClick={() => setSleepQuality(q.key)}
                    className={`px-4 py-2 rounded-full text-xs font-bold flex items-center gap-1 transition-all ${
                      sleepQuality === q.key
                        ? 'bg-amber-400 text-amber-900 shadow-md'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    <span>{q.icon}</span> {t(`checkin.widget.sleepQualities.${q.key}`)}
                  </button>
                ))}
              </div>
            </div>
          </section>
 
          {/* Exercise */}
          <section className="space-y-4">
            <h2 className="text-emerald-700 font-bold text-lg">{t('checkin.widget.exerciseQuestion')}</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {EXERCISE_OPTIONS.map((mins) => (
                <button
                  key={mins}
                  onClick={() => setExerciseMinutes(mins)}
                  className={`px-5 py-2.5 rounded-xl font-medium shrink-0 transition-all ${
                    exerciseMinutes === mins
                      ? 'bg-emerald-500 text-white font-bold scale-105 shadow-md shadow-emerald-500/20'
                      : 'bg-white text-slate-500 hover:bg-emerald-50'
                  }`}
                >
                  {mins === 60 ? `${(60).toLocaleString(lang)}+` : mins.toLocaleString(lang)}
                </button>
              ))}
            </div>
          </section>
 
          {/* Water Intake */}
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-emerald-700 font-bold text-lg">{t('checkin.widget.waterQuestion')}</h2>
              <span className="text-emerald-700 font-bold">
                {waterGlasses.toLocaleString(lang)}/{(8).toLocaleString(lang)} {t('checkin.widget.waterUnit')}
              </span>
            </div>
            <div className="grid grid-cols-8 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setWaterGlasses(i + 1)}
                  className={`aspect-[2/3] rounded-lg flex items-end justify-center pb-2 transition-all active:scale-95 ${
                    i < waterGlasses
                      ? 'bg-emerald-500/90 text-white'
                      : 'bg-slate-200 text-slate-400'
                  }`}
                >
                  <Droplets className="w-4 h-4" />
                </button>
              ))}
            </div>
          </section>

          {/* Notes */}
          <section className="space-y-4">
            <h2 className="text-emerald-700 font-bold text-lg">{t('checkin.widget.notesQuestion')}</h2>
            <textarea
              className="w-full h-28 p-4 bg-white rounded-2xl border-none focus:ring-4 focus:ring-emerald-500/10 text-slate-800 placeholder:text-slate-400 resize-none font-medium leading-relaxed shadow-sm outline-none"
              placeholder={t('checkin.widget.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>
        </div>

        {/* Sticky Footer */}
        <footer className="absolute bottom-0 left-0 w-full p-6 bg-white/80 backdrop-blur-md flex flex-col items-center gap-2 border-t border-slate-100/50">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-emerald-500/20 hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <CheckCircle2 className="w-5 h-5" />
            {submitting ? t('checkin.widget.submitting') : t('checkin.widget.submitCta')}
          </button>
          {currentStreak > 0 && (
            <p className="text-slate-500 font-bold text-sm flex items-center gap-1">
              {t('checkin.widget.streakMessage', { count: currentStreak })}
            </p>
          )}
        </footer>
      </div>

      {/* Background Decorative Texture */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full -z-10 pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-500/5 blur-[120px] rounded-full -z-10 pointer-events-none" />
    </div>
  );
}
