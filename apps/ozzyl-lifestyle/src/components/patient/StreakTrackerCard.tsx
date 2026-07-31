import { useTranslation } from 'react-i18next';

export interface StreakData {
  streak_type: string;
  current_count: number;
  longest_count: number;
  last_logged_date: string;
}

interface StreakTrackerCardProps {
  streaks: StreakData[];
  /** Array of 7 booleans for this week (Mon-Sun), true = checked in */
  weekDays: boolean[];
  todayIndex: number;
}

const DAY_LABELS_BN = ['সো', 'মং', 'বু', 'বৃ', 'শু', 'শনি', 'রবি'];
const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function StreakTrackerCard({ streaks, weekDays, todayIndex }: StreakTrackerCardProps) {
  const { t, i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';
  const dayLabels = isBn ? DAY_LABELS_BN : DAY_LABELS_EN;

  const dailyCheckin = streaks.find((s) => s.streak_type === 'daily_checkin');
  const currentStreak = dailyCheckin?.current_count ?? 0;
  const streakBn = currentStreak.toLocaleString('bn-BD');

  function getMotivationalKey(streak: number): string {
    if (streak >= 30) return 'day30';
    if (streak >= 14) return 'day14';
    if (streak >= 7) return 'day7';
    if (streak >= 3) return 'day3';
    if (streak >= 1) return 'day1';
    return 'start';
  }

  const motivationKey = getMotivationalKey(currentStreak);

  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔥</span>
          <h3 className="text-lg font-bold text-slate-700">
            {currentStreak > 0
              ? `${streakBn}${t('streak.title')}`
              : t('streak.start')}
          </h3>
        </div>
        {currentStreak >= 7 && (
          <span className="text-amber-500 text-xl">✨</span>
        )}
      </div>

      <div className="flex justify-between mb-4">
        {weekDays.map((completed, i) => {
          const isToday = i === todayIndex;
          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <span className={`text-[10px] font-semibold ${
                isToday ? 'text-emerald-600' : 'text-slate-400'
              }`}>
                {dayLabels[i]}
              </span>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs transition-all ${
                  completed
                    ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                    : isToday
                      ? 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-300 ring-offset-1'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {completed ? '✓' : (i + 1).toLocaleString('bn-BD')}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-slate-500 font-medium text-sm">
        {t(`streak.${motivationKey}`)}
      </p>
    </section>
  );
}
