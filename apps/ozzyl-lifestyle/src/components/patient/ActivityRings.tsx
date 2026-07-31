import { useTranslation } from 'react-i18next';

interface ActivityRingsProps {
  movePercent: number;   // 0-100+ (calories burned vs goal)
  exercisePercent: number; // 0-100+ (minutes vs goal)
  standPercent: number;   // 0-100+ (hours stood vs goal)
  moveValue?: string;
  exerciseValue?: string;
  standValue?: string;
  size?: number;
}

export default function ActivityRings({
  movePercent, exercisePercent, standPercent,
  moveValue, exerciseValue, standValue,
  size = 140,
}: ActivityRingsProps) {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const rings = [
    { percent: movePercent, color: '#EF4444', bg: '#FEE2E2', label: isBn ? 'মুভ' : 'Move', value: moveValue, radius: 58 },
    { percent: exercisePercent, color: '#22C55E', bg: '#DCFCE7', label: isBn ? 'ব্যায়াম' : 'Exercise', value: exerciseValue, radius: 45 },
    { percent: standPercent, color: '#3B82F6', bg: '#DBEAFE', label: isBn ? 'দাঁড়ানো' : 'Stand', value: standValue, radius: 32 },
  ];

  const center = size / 2;
  const strokeWidth = 10;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rings.map((ring, i) => {
          const circumference = 2 * Math.PI * ring.radius;
          const progress = Math.min(ring.percent, 100);
          const dashOffset = circumference - (progress / 100) * circumference;

          return (
            <g key={i}>
              {/* Background ring */}
              <circle
                cx={center} cy={center} r={ring.radius}
                fill="none" stroke={ring.bg} strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
              {/* Progress ring */}
              <circle
                cx={center} cy={center} r={ring.radius}
                fill="none" stroke={ring.color} strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${center} ${center})`}
                className="transition-all duration-1000 ease-out"
              />
              {/* Arrow cap for >100% */}
              {ring.percent > 100 && (
                <circle
                  cx={center} cy={center - ring.radius}
                  r={strokeWidth / 2 - 1}
                  fill={ring.color}
                  className="animate-pulse"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Labels */}
      <div className="space-y-2">
        {rings.map((ring, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ring.color }} />
            <div>
              <p className="text-[10px] text-slate-500">{ring.label}</p>
              {ring.value && <p className="text-xs font-bold text-slate-900">{ring.value}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
