import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CalendarPlus,
  ClipboardCheck,
  FileText,
  FlaskConical,
  Pill,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/apiClient';
import { formatDisplayDate } from '../../lib/date-utils';

interface ReportReviewPanelProps {
  patientId: number;
  appointmentId: number;
  onComplete?: () => void;
}

interface LabResult {
  id: number;
  test_name: string;
  test_code?: string;
  result_value: string;
  unit?: string;
  reference_range?: string;
  is_abnormal?: boolean;
  status?: string;
  reported_at?: string;
  lab_order_id?: number;
}

interface PrescriptionSummary {
  id: number;
  rx_no?: string;
  status?: string;
  created_at?: string;
}

interface PrescriptionDetail {
  items?: RxItem[];
  advice?: string | null;
  diagnosis?: string | null;
}

interface RxItem {
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

interface FollowUpForm {
  apptDate: string;
  apptTime: string;
  notes: string;
}

const DOSE_SHORTCUTS = ['1+0+0', '0+1+0', '0+0+1', '1+0+1', '1+1+1', 'SOS'];
const DURATION_SHORTCUTS = ['3 days', '5 days', '7 days', '10 days', '14 days', '1 month', 'Continue'];
const INSTRUCTION_SHORTCUTS = ['After meal', 'Before meal', 'Before sleep', 'Empty stomach', 'With water'];

function appendLine(existing: string, next: string): string {
  return [existing, next].filter(Boolean).join(existing ? '\n' : '');
}

export function ReportReviewPanel({
  patientId,
  appointmentId,
  onComplete,
}: ReportReviewPanelProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const [labResults, setLabResults] = useState<LabResult[]>([]);
  const [previousPrescriptions, setPreviousPrescriptions] = useState<PrescriptionSummary[]>([]);
  const [selectedPrescription, setSelectedPrescription] = useState<PrescriptionDetail | null>(null);

  const [doctorComment, setDoctorComment] = useState('');
  const [rxItems, setRxItems] = useState<RxItem[]>([]);
  const [rxAdvice, setRxAdvice] = useState('');
  const [rxId, setRxId] = useState<number | null>(null);
  const [rxNo, setRxNo] = useState('');
  const [rxStatus, setRxStatus] = useState<'draft' | 'final' | null>(null);
  const [followUpForm, setFollowUpForm] = useState<FollowUpForm>({ apptDate: '', apptTime: '', notes: '' });

  const abnormalResults = useMemo(
    () => labResults.filter((r) => r.is_abnormal),
    [labResults],
  );

  const hasPrescriptionContent = useCallback(
    () => rxItems.some((rxItem) => rxItem.medicine_name.trim()) || Boolean(rxAdvice.trim()),
    [rxItems, rxAdvice],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [resultsRes, rxListRes] = await Promise.all([
          api.get<{ results?: LabResult[] }>(`/api/lab/results?patient=${patientId}`).catch(() => ({ results: [] })),
          api.get<{ prescriptions?: PrescriptionSummary[] }>(`/api/prescriptions?patient=${patientId}`).catch(() => ({ prescriptions: [] })),
        ]);
        if (cancelled) return;
        setLabResults(resultsRes.results ?? []);
        setPreviousPrescriptions(rxListRes.prescriptions ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [patientId]);

  async function loadPrescriptionDetail(id: number) {
    try {
      const detail = await api.get<PrescriptionDetail>(`/api/prescriptions/${id}`);
      setSelectedPrescription(detail);
      if (detail.items?.length) {
        setRxItems(
          detail.items
            .filter((rxItem) => rxItem.medicine_name)
            .map((rxItem) => ({
              medicine_name: rxItem.medicine_name,
              dosage: rxItem.dosage ?? '',
              frequency: rxItem.frequency ?? '1+1+1',
              duration: rxItem.duration ?? '',
              instructions: rxItem.instructions ?? '',
            })),
        );
      }
      if (detail.advice) setRxAdvice(detail.advice);
    } catch {
      toast.error('Failed to load prescription');
    }
  }

  const addRxItem = useCallback((item?: Partial<RxItem>) => {
    setRxItems((prev) => [
      ...prev,
      {
        medicine_name: item?.medicine_name ?? '',
        dosage: item?.dosage ?? '',
        frequency: item?.frequency ?? '1+1+1',
        duration: item?.duration ?? '',
        instructions: item?.instructions ?? '',
      },
    ]);
  }, []);

  const updateRxItem = useCallback((index: number, field: keyof RxItem, value: string) => {
    setRxItems((prev) => prev.map((rxItem, rxIndex) => (rxIndex === index ? { ...rxItem, [field]: value } : rxItem)));
  }, []);

  const removeRxItem = useCallback((index: number) => {
    setRxItems((prev) => prev.filter((_, rxIndex) => rxIndex !== index));
  }, []);

  async function runAction(key: string, action: () => Promise<void>, success: string, failure: string) {
    setSaving(key);
    try {
      await action();
      toast.success(success);
    } catch (error: any) {
      toast.error(error?.message || failure);
    } finally {
      setSaving(null);
    }
  }

  function buildPrescriptionPayload(status: 'draft' | 'final') {
    const medicineItems = rxItems
      .filter((rxItem) => rxItem.medicine_name.trim())
      .map((rxItem, index) => ({ ...rxItem, sort_order: index }));

    return {
      patientId,
      appointmentId,
      diagnosis: selectedPrescription?.diagnosis || undefined,
      advice: [doctorComment, rxAdvice].filter(Boolean).join('\n') || undefined,
      followUpDate: followUpForm.apptDate || undefined,
      status,
      items: medicineItems,
    };
  }

  async function savePrescription(status: 'draft' | 'final') {
    await runAction(
      `rx-${status}`,
      async () => {
        const payload = buildPrescriptionPayload(status);
        if (!payload.items.length && !payload.advice) {
          throw new Error('Add medicine or advice before saving');
        }
        if (rxId) {
          await api.put(`/api/prescriptions/${rxId}`, payload);
        } else {
          const created = await api.post<{ id: number; rxNo: string }>('/api/prescriptions', payload);
          setRxId(created.id);
          setRxNo(created.rxNo);
        }
        setRxStatus(status);
      },
      status === 'final' ? 'Prescription finalized' : 'Prescription draft saved',
      status === 'final' ? 'Failed to finalize' : 'Failed to save',
    );
  }

  async function completeVisit() {
    await runAction(
      'complete',
      async () => {
        await api.post(`/api/doctors/dashboard/appointments/${appointmentId}/complete-consultation`, {
          prescription: hasPrescriptionContent() && rxStatus !== 'final'
            ? buildPrescriptionPayload('final')
            : undefined,
          completeVisit: true,
        });
      },
      'Visit completed',
      'Failed to complete visit',
    );
    onComplete?.();
  }

  async function scheduleFollowUp(e: React.FormEvent) {
    e.preventDefault();
    if (!followUpForm.apptDate) return;
    await runAction(
      'follow-up',
      () => api.post(`/api/patients/${patientId}/chart/follow-up`, followUpForm),
      'Follow-up scheduled',
      'Failed to schedule follow-up',
    );
    setFollowUpForm({ apptDate: '', apptTime: '', notes: '' });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-muted)]">
        <FlaskConical className="w-5 h-5 mr-2 animate-pulse" />
        Loading lab results…
      </div>
    );
  }

  return (
    <div className="grid xl:grid-cols-12 gap-5">
      <div className="xl:col-span-5 space-y-4">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
            Lab Results
            {labResults.length > 0 && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                {labResults.length}
              </span>
            )}
          </h3>

          {labResults.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">No lab results found for this patient.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="py-2 text-left font-medium text-[var(--color-text-muted)]">Test</th>
                    <th className="py-2 text-right font-medium text-[var(--color-text-muted)]">Result</th>
                    <th className="py-2 text-right font-medium text-[var(--color-text-muted)]">Unit</th>
                    <th className="py-2 text-right font-medium text-[var(--color-text-muted)]">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {labResults.map((result) => (
                    <tr
                      key={result.id}
                      className={result.is_abnormal ? 'bg-red-50/60' : ''}
                    >
                      <td className="py-2 font-medium text-[var(--color-text)]">
                        <div className="flex items-center gap-1.5">
                          {result.is_abnormal && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                          {result.test_name}
                        </div>
                        {result.test_code && <span className="text-[var(--color-text-muted)]">{result.test_code}</span>}
                      </td>
                      <td className={`py-2 text-right font-semibold ${result.is_abnormal ? 'text-red-700' : 'text-[var(--color-text)]'}`}>
                        {result.result_value}
                      </td>
                      <td className="py-2 text-right text-[var(--color-text-muted)]">{result.unit ?? '—'}</td>
                      <td className="py-2 text-right text-[var(--color-text-muted)]">{result.reference_range ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {abnormalResults.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {abnormalResults.length} abnormal value{abnormalResults.length > 1 ? 's' : ''} detected
              </p>
              <div className="mt-1.5 space-y-1">
                {abnormalResults.map((r) => (
                  <p key={r.id} className="text-[11px] text-red-700">
                    {r.test_name}: <span className="font-semibold">{r.result_value}</span> {r.unit ?? ''} (ref: {r.reference_range ?? '—'})
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--color-primary)]" />
            Previous Prescriptions
          </h3>
          {previousPrescriptions.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)] py-3 text-center">No previous prescriptions.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {previousPrescriptions.map((rx) => (
                <button
                  key={rx.id}
                  type="button"
                  onClick={() => loadPrescriptionDetail(rx.id)}
                  className={`w-full text-left rounded border px-3 py-2 text-xs hover:border-[var(--color-primary)] ${
                    selectedPrescription && rx.id === rxId ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] bg-[var(--color-bg)]'
                  }`}
                >
                  <div className="font-medium text-[var(--color-text)]">{rx.rx_no ?? `Rx #${rx.id}`}</div>
                  <div className="text-[var(--color-text-muted)]">
                    {rx.created_at ? formatDisplayDate(rx.created_at) : ''}
                    {rx.status ? ` · ${rx.status}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
          {selectedPrescription && (
            <div className="mt-3 rounded bg-[var(--color-bg)] p-3 text-xs">
              <p className="font-semibold text-[var(--color-text)]">Loaded: {selectedPrescription.diagnosis || 'No diagnosis'}</p>
              {selectedPrescription.items && selectedPrescription.items.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedPrescription.items.map((rxItem, i) => (
                    <span key={`${rxItem.medicine_name}-${i}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {rxItem.medicine_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-[var(--color-primary)]" />
            Follow-up
          </h3>
          <form className="space-y-2" onSubmit={scheduleFollowUp}>
            <div className="grid grid-cols-2 gap-2">
              <input className="input text-sm" type="date" value={followUpForm.apptDate} onChange={(e) => setFollowUpForm((prev) => ({ ...prev, apptDate: e.target.value }))} />
              <input className="input text-sm" type="time" value={followUpForm.apptTime} onChange={(e) => setFollowUpForm((prev) => ({ ...prev, apptTime: e.target.value }))} />
            </div>
            <input className="input text-sm" value={followUpForm.notes} onChange={(e) => setFollowUpForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" />
            <div className="flex justify-end">
              <button className="btn-primary text-xs" disabled={!followUpForm.apptDate || saving === 'follow-up'}>
                {saving === 'follow-up' ? 'Scheduling…' : 'Schedule Follow-up'}
              </button>
            </div>
          </form>
        </section>
      </div>

      <div className="xl:col-span-7 space-y-4">
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">Doctor Comment</h3>
          <textarea
            className="input min-h-28 text-sm"
            value={doctorComment}
            onChange={(e) => setDoctorComment(e.target.value)}
            placeholder="Interpretation, clinical correlation, advice for patient…"
          />
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Pill className="w-4 h-4 text-[var(--color-primary)]" />
              Medicine Adjustment
            </h3>
            {rxNo && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{rxNo}</span>}
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
            {rxItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
                <Pill className="mx-auto mb-2 h-7 w-7 opacity-30" />
                No medicines added. Add or adjust from previous prescription.
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {rxItems.map((rxItem, index) => (
                  <div key={`${rxItem.medicine_name}-${index}`} className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        className="input flex-1 text-sm"
                        value={rxItem.medicine_name}
                        onChange={(e) => updateRxItem(index, 'medicine_name', e.target.value)}
                        placeholder="Medicine name"
                      />
                      <button type="button" onClick={() => removeRxItem(index)} className="btn-ghost p-2 text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input className="input text-xs" value={rxItem.dosage} onChange={(e) => updateRxItem(index, 'dosage', e.target.value)} placeholder="Dose" />
                      <select className="input text-xs" value={rxItem.frequency} onChange={(e) => updateRxItem(index, 'frequency', e.target.value)}>
                        {DOSE_SHORTCUTS.map((dose) => <option key={dose} value={dose}>{dose}</option>)}
                      </select>
                      <select className="input text-xs" value={rxItem.duration} onChange={(e) => updateRxItem(index, 'duration', e.target.value)}>
                        <option value="">Duration</option>
                        {DURATION_SHORTCUTS.map((dur) => <option key={dur} value={dur}>{dur}</option>)}
                      </select>
                      <select className="input text-xs" value={rxItem.instructions} onChange={(e) => updateRxItem(index, 'instructions', e.target.value)}>
                        <option value="">Instruction</option>
                        {INSTRUCTION_SHORTCUTS.map((inst) => <option key={inst} value={inst}>{inst}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={() => addRxItem()} className="btn-ghost w-full justify-center text-xs mt-2">
            <Plus className="h-3.5 w-3.5" />
            Add blank medicine
          </button>

          <div className="mt-3 space-y-2">
            <textarea
              className="input min-h-20 text-sm"
              value={rxAdvice}
              onChange={(e) => setRxAdvice(e.target.value)}
              placeholder="Advice, diet, warning signs, follow-up notes"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => savePrescription('draft')}
              className="btn-ghost justify-center text-xs"
              disabled={saving === 'rx-draft' || rxStatus === 'final'}
            >
              <Save className="h-3.5 w-3.5" />
              Save Draft
            </button>
            <button
              type="button"
              onClick={() => savePrescription('final')}
              className="btn-primary justify-center text-xs"
              disabled={saving === 'rx-final' || rxStatus === 'final'}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              Finalize Rx
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <button
            type="button"
            onClick={completeVisit}
            className="btn-primary w-full justify-center text-sm"
            disabled={saving === 'complete'}
          >
            <ClipboardCheck className="w-4 h-4" />
            {saving === 'complete' ? 'Completing…' : 'Complete Report Review Visit'}
          </button>
        </section>
      </div>
    </div>
  );
}
