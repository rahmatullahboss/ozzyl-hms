import { useTranslation } from 'react-i18next';

interface PersonalizedGreetingProps {
  name: string;
  streak: number;
}

function getGreeting(): { key: string; emoji: string } {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return { key: 'morning', emoji: '☀️' };
  if (hour >= 12 && hour < 17) return { key: 'afternoon', emoji: '🌤️' };
  if (hour >= 17 && hour < 20) return { key: 'evening', emoji: '🌅' };
  return { key: 'night', emoji: '🌙' };
}

function getSubtitleKey(streak: number): string {
  if (streak >= 7) return 'streakExcellent';
  if (streak >= 3) return 'streakGood';
  return 'streakStart';
}

export default function PersonalizedGreeting({ name, streak }: PersonalizedGreetingProps) {
  const { t } = useTranslation('patientPortal');
  const greeting = getGreeting();

  return (
    <section className="relative overflow-hidden rounded-2xl p-8 text-white bg-gradient-to-br from-emerald-700 to-emerald-500 min-h-[140px] flex flex-col justify-end shadow-lg">
      {/* Decorative organic shapes */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-amber-400/20 rounded-full blur-2xl" />
      <div className="absolute top-4 right-6 text-3xl opacity-20">{greeting.emoji}</div>

      <div className="relative z-10 space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
          {t(`greeting.${greeting.key}`)}, {name}! {greeting.emoji}
        </h2>
        <p className="text-emerald-100 text-base opacity-90">
          {t(`greeting.${getSubtitleKey(streak)}`)}
        </p>
      </div>
    </section>
  );
}
