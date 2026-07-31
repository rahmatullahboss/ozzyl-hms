import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Heart, Thermometer, Wind, Scale, Ruler, Droplets, AlertCircle } from 'lucide-react';

export interface Vital {
  id: number;
  temperature?: number;
  pulse?: number;
  systolic?: number;
  diastolic?: number;
  spo2?: number;
  respiratory_rate?: number;
  weight?: number;
  bmi?: number;
  blood_sugar?: number;
  pain_scale?: number;
  recorded_at: string;
}

export interface TransposedVitalsTableProps {
  vitals: Vital[];
  maxColumns?: number;
}

function getBpColor(sys: number, dia: number): string {
  if (sys >= 180 || dia >= 120) return 'text-red-600';
  if (sys >= 140 || dia >= 90) return 'text-orange-600';
  if (sys >= 130 || dia >= 85) return 'text-amber-600';
  return 'text-emerald-600';
}

function getHrColor(hr: number): string {
  if (hr < 40 || hr > 120) return 'text-red-600';
  if (hr < 60 || hr > 100) return 'text-amber-600';
  return 'text-emerald-600';
}

function getTempColor(temp: number): string {
  if (temp >= 39 || temp < 36) return 'text-red-600';
  if (temp >= 37.3) return 'text-amber-600';
  return 'text-emerald-600';
}

function getSpo2Color(spo2: number): string {
  if (spo2 < 90) return 'text-red-600';
  if (spo2 < 95) return 'text-amber-600';
  return 'text-emerald-600';
}

function getRrColor(rr: number): string {
  if (rr >= 30) return 'text-red-600';
  if (rr >= 21) return 'text-amber-600';
  return 'text-emerald-600';
}

interface MetricRow {
  key: string;
  label: string;
  icon: React.ReactNode;
  getValue: (v: Vital) => { text: string; colorClass: string } | null;
}

function useMetrics(): MetricRow[] {
  return [
    {
      key: 'bp',
      label: 'BP',
      icon: <Activity className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.systolic == null || v.diastolic == null) return null;
        return { text: `${v.systolic}/${v.diastolic}`, colorClass: getBpColor(v.systolic, v.diastolic) };
      },
    },
    {
      key: 'hr',
      label: 'Heart Rate',
      icon: <Heart className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.pulse == null) return null;
        return { text: `${v.pulse} bpm`, colorClass: getHrColor(v.pulse) };
      },
    },
    {
      key: 'temp',
      label: 'Temperature',
      icon: <Thermometer className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.temperature == null) return null;
        return { text: `${v.temperature.toFixed(1)}\u00b0C`, colorClass: getTempColor(v.temperature) };
      },
    },
    {
      key: 'spo2',
      label: 'SpO\u2082',
      icon: <Wind className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.spo2 == null) return null;
        return { text: `${v.spo2}%`, colorClass: getSpo2Color(v.spo2) };
      },
    },
    {
      key: 'rr',
      label: 'Resp. Rate',
      icon: <Wind className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.respiratory_rate == null) return null;
        return { text: `${v.respiratory_rate}/min`, colorClass: getRrColor(v.respiratory_rate) };
      },
    },
    {
      key: 'weight',
      label: 'Weight',
      icon: <Scale className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.weight == null) return null;
        return { text: `${v.weight} kg`, colorClass: 'text-[var(--color-text)]' };
      },
    },
    {
      key: 'bmi',
      label: 'BMI',
      icon: <Ruler className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.bmi == null) return null;
        let color = 'text-emerald-600';
        if (v.bmi < 18.5) color = 'text-blue-600';
        else if (v.bmi < 25) color = 'text-emerald-600';
        else if (v.bmi < 30) color = 'text-amber-600';
        else color = 'text-red-600';
        return { text: `${v.bmi}`, colorClass: color };
      },
    },
    {
      key: 'sugar',
      label: 'Blood Sugar',
      icon: <Droplets className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.blood_sugar == null) return null;
        return { text: `${v.blood_sugar} mg/dL`, colorClass: 'text-[var(--color-text)]' };
      },
    },
    {
      key: 'pain',
      label: 'Pain Scale',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
      getValue: (v) => {
        if (v.pain_scale == null) return null;
        let color = 'text-emerald-600';
        if (v.pain_scale >= 7) color = 'text-red-600';
        else if (v.pain_scale >= 4) color = 'text-amber-600';
        return { text: `${v.pain_scale}/10`, colorClass: color };
      },
    },
  ];
}

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function TransposedVitalsTable({ vitals, maxColumns = 6 }: TransposedVitalsTableProps) {
  const { t } = useTranslation(['clinical', 'common']);
  const metrics = useMetrics();

  const sortedVitals = useMemo(() => {
    return [...vitals]
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
      .slice(0, maxColumns);
  }, [vitals, maxColumns]);

  if (vitals.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[var(--color-text-muted)]">
          {t('vitals.none', { defaultValue: 'No vitals recorded' })}
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--color-bg)] border-b border-[var(--color-border)]">
              <th className="text-left px-4 py-3 font-semibold text-xs text-[var(--color-text-muted)] uppercase tracking-wide sticky left-0 bg-[var(--color-bg)] z-10 min-w-[120px]">
                {t('vitals.metric', { defaultValue: 'Metric' })}
              </th>
              {sortedVitals.map((v) => (
                <th
                  key={v.id}
                  data-testid={`timestamp-${v.id}`}
                  className="text-center px-3 py-3 font-medium text-xs text-[var(--color-text-muted)] whitespace-nowrap min-w-[100px]"
                >
                  {formatTimestamp(v.recorded_at)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {metrics.map((metric) => (
              <tr key={metric.key} className="hover:bg-[var(--color-bg)]/50 transition-colors">
                <td className="px-4 py-2.5 sticky left-0 bg-white dark:bg-gray-900 z-10 border-r border-[var(--color-border)]">
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    {metric.icon}
                    <span className="font-medium text-xs">{metric.label}</span>
                  </div>
                </td>
                {sortedVitals.map((v) => {
                  const result = metric.getValue(v);
                  return (
                    <td key={v.id} className="px-3 py-2.5 text-center">
                      {result ? (
                        <span className={`font-semibold text-sm ${result.colorClass}`}>
                          {result.text}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-muted)] text-xs">\u2014</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
