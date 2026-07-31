import { useQuery } from '@tanstack/react-query';
import { Award, Star, Droplets, Zap, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

interface AchievementEarned {
  id: number;
  achievement_key: string;
  earned_at: string;
}

interface AchievementApiRes {
  success: boolean;
  earned: AchievementEarned[];
  catalog: string[];
}

// Map the real system keys to visual metadata
const BADGE_META: Record<string, { name: string; description: string; icon: any; colorClass: string; bgClass: string; total: number }> = {
  '7_day_streak': {
    name: '7 Days Active',
    description: 'Logged activity for 7 consecutive days',
    icon: Zap,
    colorClass: 'text-amber-600',
    bgClass: 'bg-amber-100',
    total: 7,
  },
  '30_day_streak': {
    name: 'Monthly Master',
    description: 'Logged activity for 30 consecutive days',
    icon: Star,
    colorClass: 'text-purple-600',
    bgClass: 'bg-purple-100',
    total: 30,
  },
  'first_checkin': {
    name: 'First Step',
    description: 'Completed your first wellness check-in',
    icon: Award,
    colorClass: 'text-blue-500',
    bgClass: 'bg-blue-100',
    total: 1,
  },
  'perfect_day': {
    name: 'Wellness Champion',
    description: 'Hit all targeted health metrics in one day',
    icon: ShieldCheck,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-100',
    total: 100,
  },
};

// Fallback visual meta if backend adds new keys before frontend catches up
const FALLBACK_META = {
  name: 'Secret Achievement',
  description: 'You unlocked a hidden achievement!',
  icon: Award,
  colorClass: 'text-slate-600',
  bgClass: 'bg-slate-100',
  total: 1,
};

export default function AchievementGallery() {
  const { t } = useTranslation('patientPortal');

  const { data, isLoading } = useQuery<AchievementApiRes>({
    queryKey: ['wellness', 'achievements'],
    queryFn: async () => {
      const res = await fetch('/api/wellness/achievements');
      if (!res.ok) throw new Error('Failed to load achievements');
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-48 bg-slate-200 rounded-lg"></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-32 bg-slate-100 rounded-3xl"></div>
          <div className="h-32 bg-slate-100 rounded-3xl"></div>
        </div>
      </div>
    );
  }

  const earnedMap = new Map<string, string>();
  if (data?.earned) {
    data.earned.forEach((e) => {
      // simple date format formatting
      const dateStr = formatPatientDateMonthYear(e.earned_at);
      earnedMap.set(e.achievement_key, dateStr);
    });
  }

  // To display all badges we expect to exist. If backend has catalog, we merge it.
  const displayKeys = Array.from(new Set([...Object.keys(BADGE_META), ...(data?.catalog || [])]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xl font-bold text-slate-800 font-manrope">Achievement Gallery</h2>
        <div className="flex items-center gap-2 px-3 py-1 text-sm font-semibold rounded-full bg-amber-50 text-amber-700">
          <Award className="w-4 h-4" />
          <span>Level 4</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {displayKeys.map((key) => {
          const meta = BADGE_META[key] || FALLBACK_META;
          const Icon = meta.icon;
          const isComplete = earnedMap.has(key);
          const dateEarned = earnedMap.get(key);
          
          // Normally we'd fetch actual progress from stats API, for mock visual UI we just show 100% or 0%
          const percentage = isComplete ? 100 : 0;
          const progress = isComplete ? meta.total : 0;

          return (
            <div
              key={key}
              className={`relative p-5 overflow-hidden transition-all duration-300 rounded-3xl ${
                isComplete
                  ? 'bg-surface-container-lowest shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100'
                  : 'bg-surface-container-low opacity-80 backdrop-blur-md'
              }`}
            >
              {/* Subtle mesh background for earned badges */}
              {isComplete && (
                <div
                  className={`absolute inset-0 opacity-10 ${meta.bgClass} blur-2xl rounded-full scale-150 -z-10`}
                  style={{
                    background: `radial-gradient(circle at 50% 0%, var(--tw-gradient-stops))`,
                  }}
                />
              )}

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-4">
                  {/* Circular Progress Ring */}
                  {meta.total > 1 && (
                    <svg className="absolute inset-0 w-full h-full -rotate-90 scale-[1.2]">
                      <circle
                        cx="50%"
                        cy="50%"
                        r="45%"
                        stroke="currentColor"
                        strokeWidth="8%"
                        fill="transparent"
                        className="text-slate-100"
                      />
                      <circle
                        cx="50%"
                        cy="50%"
                        r="45%"
                        stroke="currentColor"
                        strokeWidth="8%"
                        fill="transparent"
                        strokeDasharray="283"
                        strokeDashoffset={283 - (283 * percentage) / 100}
                        className={isComplete ? meta.colorClass : 'text-slate-300'}
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                  
                  <div
                    className={`w-14 h-14 flex items-center justify-center rounded-full ${
                      isComplete ? meta.bgClass : 'bg-white shadow-sm'
                    }`}
                  >
                    <Icon
                      className={`w-7 h-7 ${
                        isComplete ? meta.colorClass : 'text-slate-400'
                      }`}
                    />
                  </div>
                </div>

                <h3
                  className={`text-sm font-bold font-manrope mb-1 ${
                    isComplete ? 'text-slate-800' : 'text-slate-600'
                  }`}
                >
                  {meta.name}
                </h3>
                <p className="max-w-[120px] text-[10px] leading-tight text-slate-500 mb-3">
                  {meta.description}
                </p>

                {isComplete ? (
                  <span className="text-[10px] font-semibold text-emerald-600 font-manrope">
                    Earned {dateEarned}
                  </span>
                ) : (
                  <div className="text-[11px] font-bold text-slate-400">
                    {progress} / {meta.total}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
