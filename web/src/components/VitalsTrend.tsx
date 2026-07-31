/**
 * VitalsTrend — SVG line chart component for patient vitals time-series.
 *
 * Renders a responsive, interactive multi-line chart showing vital signs
 * over time with threshold bands (warning/critical) overlayed.
 *
 * Usage:
 *   <VitalsTrend patientId={123} />
 *   <VitalsTrend patientId={123} days={14} vitalsToShow={['systolic', 'heart_rate']} />
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Activity, ThermometerSun, Heart, Wind, Loader2 } from 'lucide-react';
import { api } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VitalPoint {
  systolic?: number;
  diastolic?: number;
  temperature?: number;
  heart_rate?: number;
  spo2?: number;
  respiratory_rate?: number;
  recorded_at: string;
}

interface Threshold {
  vital_type: string;
  min_value: number | null;
  max_value: number | null;
  severity: string;
}

interface TrendsResponse {
  vitals: VitalPoint[];
  thresholds: Threshold[];
}

type VitalKey = 'systolic' | 'diastolic' | 'heart_rate' | 'spo2' | 'temperature' | 'respiratory_rate';

const VITAL_CONFIG: Record<VitalKey, {
  label: string;
  color: string;
  unit: string;
  icon: React.ReactNode;
  yMin: number;
  yMax: number;
}> = {
  systolic:         { label: 'Systolic',       color: '#ef4444', unit: 'mmHg', icon: <Activity className="w-3.5 h-3.5" />,         yMin: 60,  yMax: 200 },
  diastolic:        { label: 'Diastolic',      color: '#f97316', unit: 'mmHg', icon: <Activity className="w-3.5 h-3.5" />,         yMin: 40,  yMax: 130 },
  heart_rate:       { label: 'Heart Rate',     color: '#ec4899', unit: 'bpm',  icon: <Heart className="w-3.5 h-3.5" />,            yMin: 30,  yMax: 150 },
  spo2:             { label: 'SpO₂',           color: '#3b82f6', unit: '%',    icon: <Wind className="w-3.5 h-3.5" />,             yMin: 80,  yMax: 100 },
  temperature:      { label: 'Temperature',    color: '#f59e0b', unit: '°C',   icon: <ThermometerSun className="w-3.5 h-3.5" />,   yMin: 34,  yMax: 42 },
  respiratory_rate: { label: 'Resp. Rate',     color: '#8b5cf6', unit: '/min', icon: <Wind className="w-3.5 h-3.5" />,             yMin: 5,   yMax: 40 },
};

const DEFAULT_VITALS: VitalKey[] = ['systolic', 'diastolic', 'heart_rate', 'spo2'];

// ─── Component ────────────────────────────────────────────────────────────────

interface VitalsTrendProps {
  patientId: number;
  days?: number;
  vitalsToShow?: VitalKey[];
  compact?: boolean;
}

export default function VitalsTrend({
  patientId,
  days = 7,
  vitalsToShow = DEFAULT_VITALS,
  compact = false,
}: VitalsTrendProps) {
  const [activeVital, setActiveVital] = useState<VitalKey>(vitalsToShow[0]);

  const { data, isLoading, isError } = useQuery<TrendsResponse>({
    queryKey: ['vitals-trends', patientId, days],
    queryFn: () =>
      api.get<TrendsResponse>(`/api/nurse-station/vitals-trends/${patientId}?days=${days}`),
    enabled: patientId > 0,
    refetchInterval: 60_000, // auto-refresh every minute
  });

  const config = VITAL_CONFIG[activeVital];
  const points = data?.vitals ?? [];

  // Filter thresholds for the active vital
  const thresholds = useMemo(() => {
    if (!data?.thresholds) return [];
    return data.thresholds.filter(t => t.vital_type === activeVital);
  }, [data?.thresholds, activeVital]);

  // Extract data points for the active vital
  const chartData = useMemo(() => {
    return points
      .map(p => ({
        value: p[activeVital] as number | undefined,
        time: new Date(p.recorded_at),
      }))
      .filter((d): d is { value: number; time: Date } => d.value !== undefined && d.value !== null);
  }, [points, activeVital]);

  // Chart dimensions
  const width = compact ? 360 : 600;
  const height = compact ? 160 : 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  // Scales
  const yMin = config.yMin;
  const yMax = config.yMax;
  const toY = (v: number) => padding.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const xDomain = chartData.length > 1
    ? [chartData[0].time.getTime(), chartData[chartData.length - 1].time.getTime()]
    : [Date.now() - 86400000, Date.now()];
  const toX = (t: Date) =>
    padding.left + ((t.getTime() - xDomain[0]) / (xDomain[1] - xDomain[0])) * innerW;

  // Line path
  const linePath = chartData
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(d.time).toFixed(1)} ${toY(d.value).toFixed(1)}`)
    .join(' ');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-6 text-red-500 text-sm">
        <AlertTriangle className="w-5 h-5 mx-auto mb-1" />
        Failed to load vitals
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Vital type selector */}
      <div className="flex flex-wrap gap-1.5">
        {vitalsToShow.map(key => {
          const cfg = VITAL_CONFIG[key];
          const latestValue = points.length > 0 ? (points[points.length - 1][key] as number | undefined) : undefined;
          return (
            <button
              key={key}
              onClick={() => setActiveVital(key)}
              className={`
                flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all
                ${activeVital === key
                  ? 'ring-2 ring-offset-1 shadow-sm'
                  : 'opacity-60 hover:opacity-100'
                }
              `}
              style={{
                backgroundColor: activeVital === key ? `${cfg.color}18` : 'transparent',
                color: cfg.color,
                borderColor: cfg.color,
                ...(activeVital === key ? { ringColor: cfg.color } : {}),
              }}
            >
              {cfg.icon}
              {cfg.label}
              {latestValue !== undefined && (
                <span className="font-bold ml-0.5">{latestValue}{cfg.unit}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* SVG Chart */}
      <div className="card p-3 overflow-hidden">
        {chartData.length < 2 ? (
          <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
            Not enough data points to show trends. At least 2 readings required.
          </div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
            {/* Threshold bands */}
            {thresholds.map((t, i) => {
              if (t.severity === 'warning') {
                return (
                  <g key={`th-${i}`}>
                    {t.max_value !== null && (
                      <rect
                        x={padding.left} y={toY(Math.min(t.max_value, yMax))}
                        width={innerW}
                        height={Math.abs(toY(yMax) - toY(Math.min(t.max_value, yMax)))}
                        fill="#fef3c7" opacity={0.4}
                      />
                    )}
                    {t.min_value !== null && (
                      <rect
                        x={padding.left} y={toY(t.min_value)}
                        width={innerW}
                        height={Math.abs(toY(Math.max(yMin, t.min_value < yMin ? yMin : t.min_value)) - toY(t.min_value))}
                        fill="#fef3c7" opacity={0.4}
                      />
                    )}
                  </g>
                );
              }
              return null;
            })}

            {/* Y-axis gridlines */}
            {Array.from({ length: 5 }, (_, i) => {
              const val = yMin + ((yMax - yMin) / 4) * i;
              return (
                <g key={`y-${i}`}>
                  <line
                    x1={padding.left} y1={toY(val)} x2={width - padding.right} y2={toY(val)}
                    stroke="var(--color-border)" strokeWidth={0.5} strokeDasharray="3,3"
                  />
                  <text
                    x={padding.left - 4} y={toY(val) + 3}
                    textAnchor="end" fontSize={9} fill="var(--color-text-muted)"
                  >
                    {Math.round(val)}
                  </text>
                </g>
              );
            })}

            {/* Data line */}
            <path d={linePath} fill="none" stroke={config.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

            {/* Data points */}
            {chartData.map((d, i) => (
              <circle
                key={i}
                cx={toX(d.time)} cy={toY(d.value)}
                r={3} fill={config.color} stroke="white" strokeWidth={1.5}
              >
                <title>{`${config.label}: ${d.value}${config.unit}\n${d.time.toLocaleString()}`}</title>
              </circle>
            ))}

            {/* X-axis labels (first and last) */}
            <text
              x={padding.left} y={height - 4}
              fontSize={9} fill="var(--color-text-muted)"
            >
              {chartData[0].time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </text>
            <text
              x={width - padding.right} y={height - 4}
              textAnchor="end" fontSize={9} fill="var(--color-text-muted)"
            >
              {chartData[chartData.length - 1].time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}
