import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/apiClient';

interface LabTrendResult {
  test_name?: string | null;
  result_value?: string | number | null;
  result?: string | number | null;
  unit?: string | null;
  reported_at?: string | null;
  order_date?: string | null;
  flag?: string | null;
  abnormal_flag?: string | null;
}

interface PatientLabTrendsPanelProps {
  patientId: number;
}

function displayValue(result: LabTrendResult): string {
  const value = result.result_value ?? result.result ?? '-';
  return `${value}${result.unit ? ` ${result.unit}` : ''}`;
}

function statusOf(result: LabTrendResult): string | null {
  const flag = String(result.flag ?? result.abnormal_flag ?? '').toLowerCase();
  if (!flag || flag === 'normal') return null;
  return flag.charAt(0).toUpperCase() + flag.slice(1);
}

export function PatientLabTrendsPanel({ patientId }: PatientLabTrendsPanelProps) {
  const [results, setResults] = useState<LabTrendResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get<{ results?: LabTrendResult[] }>(`/api/lab/cumulative/${patientId}?limit=24`)
      .then((payload) => {
        if (active) setResults(payload.results ?? []);
      })
      .catch(() => {
        if (active) setResults([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  const grouped = useMemo(() => {
    const byTest = new Map<string, LabTrendResult[]>();
    for (const result of results) {
      const name = result.test_name || 'Lab result';
      const entries = byTest.get(name) ?? [];
      entries.push(result);
      byTest.set(name, entries);
    }
    return [...byTest.entries()].slice(0, 4);
  }, [results]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-[var(--color-primary)]" />
        Lab Trends
      </h3>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading recent reports...
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No reported lab trend available.</p>
      ) : (
        <div className="space-y-2">
          {grouped.map(([name, values]) => {
            const latest = values[0];
            const abnormal = statusOf(latest);
            return (
              <div key={name} aria-label={`${name} trend`} className="rounded bg-[var(--color-bg)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--color-text)]">{name}</span>
                  {abnormal && (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                      <AlertTriangle className="w-3 h-3" /> {abnormal}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[var(--color-text-muted)]">
                  {values.slice(0, 3).map((result, index) => (
                    <span key={`${name}-${index}`} className={index === 0 ? 'font-semibold text-[var(--color-text)]' : ''}>
                      {displayValue(result)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
