import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, X } from 'lucide-react';

interface AchievementToastProps {
  achievements: string[];
  onClose: () => void;
}

const ACHIEVEMENT_ICONS: Record<string, string> = {
  first_checkin: '🎉',
  '3_day_streak': '🔥',
  '7_day_streak': '⚡',
  '14_day_streak': '💪',
  '30_day_streak': '🏆',
  first_food_log: '🥗',
  first_sleep_log: '🌙',
  first_goal_set: '🎯',
  perfect_day: '⭐',
  hydration_hero: '💧',
};

export default function AchievementToast({ achievements, onClose }: AchievementToastProps) {
  const { t } = useTranslation('patientPortal');
  const [visible, setVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (achievements.length === 0) return;
    setVisible(true);
  }, [achievements]);

  useEffect(() => {
    if (!visible || achievements.length <= 1) return;
    const timer = setTimeout(() => {
      if (currentIndex < achievements.length - 1) {
        setCurrentIndex((prev) => prev + 1);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [visible, currentIndex, achievements.length]);

  if (achievements.length === 0 || !visible) return null;

  const key = achievements[currentIndex] ?? achievements[0];
  const emoji = ACHIEVEMENT_ICONS[key] ?? '🏅';
  const label = t(`achievements.${key}`, key.replace(/_/g, ' '));

  const handleClose = () => {
    setVisible(false);
    onClose();
  };

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-3 max-w-sm">
        <div className="text-3xl flex-shrink-0 animate-bounce">{emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Award className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide opacity-90">
              {t('achievements.unlocked', 'Achievement Unlocked!')}
            </span>
          </div>
          <p className="text-sm font-bold mt-0.5 truncate">{label}</p>
          {achievements.length > 1 && (
            <p className="text-xs opacity-80 mt-0.5">
              {currentIndex + 1}/{achievements.length}
            </p>
          )}
        </div>
        <button
          onClick={handleClose}
          className="flex-shrink-0 p-1 rounded-full hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
