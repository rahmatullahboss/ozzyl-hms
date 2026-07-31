import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useApiMutation } from '../../hooks/useApiQuery';
import ResultInput from './ResultInput';

interface ComponentRow {
  lab_test_id: number;
  component_id: number;
  test_name: string;
  unit?: string | null;
  reference_range?: string | null;
  value_type?: string | null;
  display_sequence?: number;
  normal_range?: string | null;
  critical_low?: number | null;
  critical_high?: number | null;
}

interface PanelResultEntryProps {
  orderId: number;
  labTestId: number;
  patientId: number;
  testName: string;
  components: ComponentRow[];
  onComplete: () => void;
}

interface BulkResultPayload {
  results: Array<{
    lab_test_id: number;
    component_id?: number;
    result_value: string;
    units?: string;
    comments?: string;
    result_status: 'preliminary' | 'final' | 'corrected';
  }>;
  specimen_num?: string;
  report_notes?: string;
}

type FlagStatus = 'normal' | 'low' | 'high' | '';

function detectFlag(value: string, comp: ComponentRow): FlagStatus {
  if (!value.trim()) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  if (comp.value_type !== 'numeric' && comp.value_type !== 'ratio') return '';
  if (comp.critical_low != null && comp.critical_high != null) {
    if (num < comp.critical_low) return 'low';
    if (num > comp.critical_high) return 'high';
    return 'normal';
  }
  return '';
}

export default function PanelResultEntry({
  orderId,
  testName,
  components,
  onComplete,
}: PanelResultEntryProps) {
  const [results, setResults] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const comp of components) {
      initial[comp.component_id] = '';
    }
    return initial;
  });

  const [reportNotes, setReportNotes] = useState('');

  const bulkMutation = useApiMutation<unknown, BulkResultPayload>(
    'post',
    `/api/lab/orders/${orderId}/results/bulk`,
    {
      onSuccess: () => {
        toast.success('All results saved');
        onComplete();
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : 'Failed to save results';
        toast.error(msg);
      },
    },
  );

  const handleChange = useCallback((componentId: number, value: string) => {
    setResults((prev) => ({ ...prev, [componentId]: value }));
  }, []);

  const flags = useMemo(() => {
    const map: Record<number, FlagStatus> = {};
    for (const comp of components) {
      map[comp.component_id] = detectFlag(results[comp.component_id] ?? '', comp);
    }
    return map;
  }, [results, components]);

  const filledCount = useMemo(
    () => Object.values(results).filter((v) => v.trim() !== '').length,
    [results],
  );

  const handleSubmit = (isDraft: boolean) => {
    const entries = components
      .filter((comp) => (results[comp.component_id] ?? '').trim() !== '')
      .map((comp) => ({
        lab_test_id: comp.lab_test_id,
        component_id: comp.component_id,
        result_value: results[comp.component_id].trim(),
        units: comp.unit ?? undefined,
        result_status: (isDraft ? 'preliminary' : 'final') as 'preliminary' | 'final',
      }));

    if (entries.length === 0) {
      toast.error('Enter at least one result before saving');
      return;
    }

    bulkMutation.mutate({
      results: entries,
      report_notes: reportNotes.trim() || undefined,
    });
  };

  if (components.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        No components found for this test.
      </div>
    );
  }

  const inputClassName = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-cyan-500';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Panel Test
        </div>
        <div className="mt-1 text-lg font-semibold text-slate-900">{testName}</div>
        <div className="mt-1 text-xs text-slate-500">
          {filledCount} of {components.length} parameters entered
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-2 pr-4 font-semibold text-slate-700">Parameter</th>
              <th className="pb-2 pr-4 font-semibold text-slate-700">Result</th>
              <th className="pb-2 pr-4 font-semibold text-slate-700">Unit</th>
              <th className="pb-2 pr-4 font-semibold text-slate-700">Reference Range</th>
              <th className="pb-2 font-semibold text-slate-700">Flag</th>
            </tr>
          </thead>
          <tbody>
            {components.map((comp) => {
              const flag = flags[comp.component_id];
              return (
                <tr key={comp.component_id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    {comp.test_name}
                  </td>
                  <td className="py-2 pr-4">
                    <ResultInput
                      valueType={comp.value_type as 'numeric' | 'string' | 'memo' | 'coded' | 'ratio'}
                      value={results[comp.component_id] ?? ''}
                      onChange={(val) => handleChange(comp.component_id, val)}
                      placeholder="Enter result"
                      testName={comp.test_name}
                      className={inputClassName}
                    />
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{comp.unit ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-600">{comp.reference_range ?? comp.normal_range ?? '—'}</td>
                  <td className="py-2">
                    {flag === 'low' && (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Low
                      </span>
                    )}
                    {flag === 'high' && (
                      <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                        High
                      </span>
                    )}
                    {flag === 'normal' && (
                      <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                        Normal
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Report Notes</span>
        <textarea
          value={reportNotes}
          onChange={(e) => setReportNotes(e.target.value)}
          rows={2}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-500"
          placeholder="Optional notes for the report"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => handleSubmit(true)}
          disabled={bulkMutation.isPending}
          className="inline-flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
        >
          Save Draft
        </button>
        <button
          type="button"
          onClick={() => handleSubmit(false)}
          disabled={bulkMutation.isPending}
          className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-50"
        >
          Save All
        </button>
      </div>
    </div>
  );
}
