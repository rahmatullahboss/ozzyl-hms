import { useTranslation } from 'react-i18next';
import { CheckCircle2, Utensils, Smile, Droplets } from 'lucide-react';

interface LifestyleQuickActionsProps {
  onLogFood?: () => void;
  onLogMood?: () => void;
  onTrackWater?: () => void;
  onCheckIn?: () => void;
  completedToday?: Set<string>;
}

const ACTIONS = [
  { key: 'checkIn', icon: CheckCircle2, bgColor: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { key: 'logFood', icon: Utensils, bgColor: 'bg-amber-50', iconColor: 'text-amber-600' },
  { key: 'logMood', icon: Smile, bgColor: 'bg-violet-50', iconColor: 'text-violet-600' },
  { key: 'trackWater', icon: Droplets, bgColor: 'bg-cyan-50', iconColor: 'text-cyan-600' },
] as const;

type ActionKey = (typeof ACTIONS)[number]['key'];

export default function LifestyleQuickActions({
  onLogFood,
  onLogMood,
  onTrackWater,
  onCheckIn,
  completedToday = new Set(),
}: LifestyleQuickActionsProps) {
  const { t } = useTranslation('patientPortal');

  const actionHandlers: Record<ActionKey, (() => void) | undefined> = {
    checkIn: onCheckIn,
    logFood: onLogFood,
    logMood: onLogMood,
    trackWater: onTrackWater,
  };

  return (
    <section className="grid grid-cols-2 gap-3">
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        const isDone = completedToday.has(action.key);
        const handler = actionHandlers[action.key];

        return (
          <button
            key={action.key}
            onClick={() => handler?.()}
            className={`bg-white p-5 rounded-xl shadow-sm flex flex-col items-center text-center gap-3 active:scale-95 transition-transform hover:shadow-md relative ${
              isDone ? 'opacity-70' : ''
            }`}
          >
            <div className={`w-12 h-12 ${action.bgColor} rounded-full flex items-center justify-center relative`}>
              <Icon className={`w-5 h-5 ${isDone ? 'text-slate-400' : action.iconColor}`} />
              {isDone && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
            <span className={`font-bold text-sm ${isDone ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
              {t(`quickActions.${action.key}`)}
            </span>
          </button>
        );
      })}
    </section>
  );
}
