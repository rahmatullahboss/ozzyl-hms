import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface QuickCheckInCardProps {
  hasCheckedInToday: boolean;
  onStartCheckIn: () => void;
  todayMood?: string;
}

const MOOD_EMOJIS: Record<string, string> = {
  excellent: '😊',
  good: '🙂',
  okay: '😐',
  bad: '😔',
  terrible: '😫',
};

export default function QuickCheckInCard({ hasCheckedInToday, onStartCheckIn, todayMood }: QuickCheckInCardProps) {
  const { t } = useTranslation('patientPortal');

  if (hasCheckedInToday && todayMood) {
    return (
      <section className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-3xl">
            {MOOD_EMOJIS[todayMood] || '😊'}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              {t('checkin.done')}
              <span className="text-emerald-500">✓</span>
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">{t('checkin.seeYouTomorrow')}</p>
          </div>
          <button
            onClick={onStartCheckIn}
            className="text-emerald-600 text-xs font-semibold hover:underline"
          >
            {t('checkin.edit')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-emerald-800">{t('checkin.howAreYou')}</h3>
        <Sparkles className="w-5 h-5 text-amber-400" />
      </div>

      {/* Quick mood selector */}
      <div className="flex justify-between items-center px-2">
        {Object.entries(MOOD_EMOJIS).map(([key, emoji]) => (
          <button
            key={key}
            onClick={onStartCheckIn}
            className="text-3xl hover:scale-125 active:scale-110 transition-transform"
          >
            {emoji}
          </button>
        ))}
      </div>

      <button
        onClick={onStartCheckIn}
        className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-bold rounded-xl active:scale-[0.98] transition-transform shadow-md shadow-emerald-500/20"
      >
        ✅ {t('checkin.completeCta')}
      </button>
    </section>
  );
}
