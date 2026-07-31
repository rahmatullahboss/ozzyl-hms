import { useTranslation } from 'react-i18next';

interface WellnessScoreCardProps {
  totalScore?: number;
  breakdown?: {
    sleep: number;
    activity: number;
    nutrition: number;
    mood: number;
    medication: number;
    vitals: number;
  };
  trend?: number;
}

function getScoreStars(score: number): string {
  const stars = Math.round(score / 20);
  return '\u2605'.repeat(stars) + '\u2606'.repeat(5 - stars);
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#10b981'; // green
  if (score >= 60) return '#f59e0b'; // yellow
  return '#ef4444'; // red
}

export default function WellnessScoreCard({
  totalScore = 0,
  breakdown = { sleep: 0, activity: 0, nutrition: 0, mood: 0, medication: 0, vitals: 0 },
  trend = 0,
}: WellnessScoreCardProps) {
  const { t, i18n } = useTranslation('patientPortal');

  const locale = i18n.language === 'bn' ? 'bn-BD' : 'en-US';
  const scoreStr = totalScore.toLocaleString(locale);
  const ringColor = getScoreColor(totalScore);

  // SVG ring calculations
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (totalScore / 100) * circumference;

  const labelKey = totalScore >= 90 ? 'excellent' : totalScore >= 80 ? 'good' : totalScore >= 70 ? 'fair' : totalScore >= 60 ? 'needsWork' : 'attention';

  const metrics = [
    { key: 'sleep', labelKey: 'modules.sleep', emoji: '\uD83D\uDE34', score: breakdown.sleep },
    { key: 'activity', labelKey: 'modules.activity', emoji: '\uD83C\uDFC3', score: breakdown.activity },
    { key: 'mood', labelKey: 'modules.mind', emoji: '\uD83D\uDE0A', score: breakdown.mood },
    { key: 'vitals', labelKey: 'modules.vitals', emoji: '\u2764\uFE0F', score: breakdown.vitals },
  ];

  return (
    <section className="space-y-4">
      {/* Main Score Ring */}
      <div className="bg-[#f2f4f6] rounded-2xl p-8 flex flex-col items-center text-center">
        <div className="relative w-40 h-40 flex items-center justify-center mb-4">
          <svg className="absolute w-full h-full transform -rotate-90">
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="transparent"
              stroke="#e0e3e5"
              strokeWidth="12"
            />
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="transparent"
              stroke={ringColor}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="flex flex-col">
            <span className="text-4xl font-extrabold tracking-tight text-emerald-900">{scoreStr}</span>
            <span className="text-sm font-medium text-emerald-700">{t('score.title')}</span>
          </div>
        </div>

        {/* Score label */}
        <div className="text-sm font-semibold text-slate-600 mb-2">
          {t(`score.${labelKey}`)}
        </div>

        {/* Trend indicator */}
        {trend !== 0 && (
          <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
            trend > 0
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {trend > 0 ? '\uD83D\uDCC8' : '\uD83D\uDCC9'} {t('score.trend7d')} {trend > 0 ? '+' : ''}
            {trend.toLocaleString(locale)} {t('score.points')}
          </div>
        )}
      </div>

      {/* Mini Metrics */}
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {metrics.map((m) => (
          <div
            key={m.key}
            className="min-w-[110px] bg-white p-4 rounded-xl shadow-sm text-center flex-shrink-0"
          >
            <p className="text-xs text-slate-500 mb-1">{m.emoji} {t(m.labelKey)}</p>
            <p className="text-amber-500 font-bold text-sm tracking-wide">{getScoreStars(m.score)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
