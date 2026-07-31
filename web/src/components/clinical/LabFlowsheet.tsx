import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface LabResult {
  test_name: string;
  result_value: number | string;
  unit?: string;
  normal_range?: string;
  abnormal_flag?: 'normal' | 'high' | 'low' | 'critical_high' | 'critical_low' | null;
  collected_at: string;
}

export interface LabFlowsheetProps {
  results: LabResult[];
  maxColumns?: number;
}

function getAbnormalColor(flag: LabResult['abnormal_flag']): string {
  if (flag === 'critical_high' || flag === 'critical_low') return 'text-red-600 font-bold';
  if (flag === 'high' || flag === 'low') return 'text-orange-600 font-semibold';
  return 'text-[var(--color-text)]';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

type Trend = 'up' | 'down' | 'stable';

function computeTrend(values: (number | string)[]): Trend {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length < 2) return 'stable';
  const first = nums[nums.length - 1];
  const last = nums[0];
  const diff = last - first;
  const threshold = Math.abs(first) * 0.05;
  if (diff > threshold) return 'up';
  if (diff < -threshold) return 'down';
  return 'stable';
}

function TrendIndicator({ trend }: { trend: Trend }) {
  if (trend === 'up') return <span>{'\u2191'}</span>;
  if (trend === 'down') return <span>{'\u2193'}</span>;
  return <span>{'\u2192'}</span>;
}

interface TestRow {
  testName: string;
  normalRange?: string;
  unit?: string;
  valuesByDate: Map<string, { value: number | string; flag: LabResult['abnormal_flag'] }>;
  trend: Trend;
}

export default function LabFlowsheet({ results, maxColumns = 8 }: LabFlowsheetProps) {
  const { t } = useTranslation(['clinical', 'common']);

  const { dates, rows } = useMemo(() => {
    if (results.length === 0) return { dates: [], rows: [] };

    const dateSet = new Set<string>();
    for (const r of results) {
      dateSet.add(r.collected_at);
    }
    const dates = [...dateSet]
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
      .slice(0, maxColumns);

    const rowMap = new Map<string, TestRow>();
    for (const r of results) {
      if (!dates.includes(r.collected_at)) continue;
      let row = rowMap.get(r.test_name);
      if (!row) {
        row = { testName: r.test_name, normalRange: r.normal_range, unit: r.unit, valuesByDate: new Map(), trend: 'stable' };
        rowMap.set(r.test_name, row);
      }
      row.valuesByDate.set(r.collected_at, { value: r.result_value, flag: r.abnormal_flag });
    }

    const rows = [...rowMap.values()].map((row) => {
      const orderedValues = dates.map((d) => row.valuesByDate.get(d)?.value).filter((v): v is number | string => v !== undefined);
      return { ...row, trend: computeTrend(orderedValues) };
    });

    return { dates, rows };
  }, [results, maxColumns]);

  if (results.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[var(--color-text-muted)]">
          {t('labFlowsheet.empty', { defaultValue: 'No lab results available' })}
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
              <th className="text-left px-4 py-3 font-semibold text-xs text-[var(--color-text-muted)] uppercase tracking-wide sticky left-0 bg-[var(--color-bg)] z-10 min-w-[140px]">
                {t('labFlowsheet.test', { defaultValue: 'Test' })}
              </th>
              <th className="text-center px-2 py-3 font-semibold text-xs text-[var(--color-text-muted)] uppercase tracking-wide min-w-[60px]">
                {t('labFlowsheet.trend', { defaultValue: 'Trend' })}
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  data-testid={`date-col-${d}`}
                  className="text-center px-3 py-3 font-medium text-xs text-[var(--color-text-muted)] whitespace-nowrap min-w-[90px]"
                >
                  {formatDate(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row) => (
              <tr key={row.testName} data-testid={`row-${row.testName}`} className="hover:bg-[var(--color-bg)]/50 transition-colors">
                <td className="px-4 py-2.5 sticky left-0 bg-white dark:bg-gray-900 z-10 border-r border-[var(--color-border)]">
                  <div>
                    <p className="font-medium text-xs text-[var(--color-text)]">{row.testName}</p>
                    {row.normalRange && (
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{row.normalRange}</p>
                    )}
                  </div>
                </td>
                <td data-testid={`trend-${row.testName}`} className="px-2 py-2.5 text-center text-sm">
                  <TrendIndicator trend={row.trend} />
                </td>
                {dates.map((d) => {
                  const cell = row.valuesByDate.get(d);
                  const colorClass = cell ? getAbnormalColor(cell.flag) : 'text-[var(--color-text-muted)]';
                  return (
                    <td
                      key={d}
                      data-testid={`cell-${row.testName}-${d}`}
                      className={`px-3 py-2.5 text-center text-sm ${colorClass}`}
                    >
                      {cell ? (
                        <span>
                          {cell.value}{row.unit ? ` ${row.unit}` : ''}
                        </span>
                      ) : (
                        <span className="text-xs">{'\u2014'}</span>
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
