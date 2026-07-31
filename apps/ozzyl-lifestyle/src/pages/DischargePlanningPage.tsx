import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Plus, X, CheckCircle, Clock, AlertTriangle, ChevronRight, Pill, FileText } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface DischargePlan { id: number; admission_id: number; patient_id: number; patient_name?: string; patient_code?: string; admission_no?: string; status: string; planned_discharge_date?: string; discharge_type: string; checklist_progress?: { done: number; total: number; percent: number }; updated_at: string; }

const STATUS_BADGE: Record<string, string> = { in_progress: 'bg-blue-100 text-blue-700', ready: 'badge-success', approved: 'bg-emerald-100 text-emerald-700', discharged: 'bg-green-100 text-green-700', cancelled: 'badge-neutral' };

const CHECKLIST_LABELS: Record<string, string> = {
  vitals_stable: 'Vitals Stable', medications_reconciled: 'Medications Reconciled',
  prescriptions_printed: 'Prescriptions Printed', lab_results_reviewed: 'Lab Results Reviewed',
  pending_tests_cleared: 'Pending Tests Cleared', diet_instructions_given: 'Diet Instructions Given',
  wound_care_instructions: 'Wound Care Instructions', follow_up_scheduled: 'Follow-up Scheduled',
  referrals_arranged: 'Referrals Arranged', insurance_clearance: 'Insurance Clearance',
  billing_cleared: 'Billing Cleared', belongings_returned: 'Belongings Returned',
  transport_arranged: 'Transport Arranged', patient_education_done: 'Patient Education Done',
  consent_forms_signed: 'Consent Forms Signed',
};
const CHECKLIST_KEYS = Object.keys(CHECKLIST_LABELS);

export default function DischargePlanningPage({ role }: { role?: string }) {
  const { t } = useTranslation('ipd');
  const [plans, setPlans] = useState<DischargePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('in_progress');
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const [pRes, sRes] = await Promise.all([
        axios.get('/api/discharge-planning', { params, headers: authHeader() }),
        axios.get('/api/discharge-planning/stats', { headers: authHeader() }),
      ]);
      setPlans(pRes.data?.data ?? []); setStats(sRes.data ?? null);
    } catch { setPlans([]); } finally { setLoading(false); }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const loadDetail = async (id: number) => {
    try {
      const { data } = await axios.get(`/api/discharge-planning/${id}`, { headers: authHeader() });
      setDetail(data); setShowDetail(true);
    } catch { toast.error(t('ipd.failed')); }
  };

  const toggleCheck = async (id: number, key: string, value: boolean) => {
    try {
      await axios.put(`/api/discharge-planning/${id}/checklist`, { [key]: value }, { headers: authHeader() });
      loadDetail(id);
    } catch { toast.error(t('ipd.failed')); }
  };

  const updateStatus = async (id: number, status: string) => {
    try {
      await axios.put(`/api/discharge-planning/${id}/status`, { status }, { headers: authHeader() });
      toast.success(t('ipd.dischargeStatusUpdated', { status })); setShowDetail(false); load();
    } catch { toast.error(t('ipd.failed')); }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/20"><ClipboardCheck className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">Discharge Planning</h1><p className="section-subtitle">Pre-discharge checklist, medication reconciliation & follow-up</p></div>
        </div></div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { l: 'In Progress', v: stats.in_progress ?? 0, c: 'text-blue-600' },
              { l: 'Ready', v: stats.ready ?? 0, c: 'text-green-600' },
              { l: 'Approved', v: stats.approved ?? 0, c: 'text-emerald-600' },
              { l: 'Discharged', v: stats.discharged ?? 0 },
            ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>)}
          </div>
        )}

        <div className="flex gap-3">
          <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All</option><option value="in_progress">In Progress</option>
            <option value="ready">Ready</option><option value="approved">Approved</option>
          </select>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Patient</th><th>Admission #</th><th>Planned Date</th><th>Type</th><th>Status</th><th>Last Updated</th><th></th></tr></thead><tbody>
          {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : plans.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No discharge plans</td></tr>
          : plans.map(p => (
            <tr key={p.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => loadDetail(p.id)}>
              <td><span className="font-medium">{p.patient_name ?? '—'}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</span></td>
              <td className="font-mono text-sm">{p.admission_no ?? '—'}</td>
              <td className="text-sm">{p.planned_discharge_date ?? '—'}</td>
              <td className="text-xs"><span className="badge-neutral">{p.discharge_type}</span></td>
              <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.status] ?? ''}`}>{p.status.replace('_', ' ')}</span></td>
              <td className="text-xs text-[var(--color-text-muted)]">{p.updated_at?.slice(0, 16).replace('T', ' ')}</td>
              <td><ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" /></td>
            </tr>
          ))}
        </tbody></table></div></div>

        {showDetail && detail && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <div>
                  <h3 className="font-semibold">Discharge Plan — {String(detail.patient_name)}</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">Admission: {String(detail.admission_no ?? '—')}</p>
                </div>
                <button onClick={() => setShowDetail(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-5 space-y-5">
                {/* Progress */}
                {!!(detail.checklist_progress) && (() => {
                  const prog = detail.checklist_progress as { done: number; total: number; percent: number };
                  return (
                    <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-200 rounded-full h-3"><div className="bg-emerald-500 h-3 rounded-full transition-all" style={{ width: `${prog.percent}%` }} /></div>
                    <span className="text-sm font-bold">{prog.done}/{prog.total}</span>
                  </div>
                  );
                })()}

                {/* Checklist */}
                <div>
                  <p className="text-sm font-semibold mb-2">Pre-Discharge Checklist</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {CHECKLIST_KEYS.map(key => {
                      const checked = !!(detail as Record<string, unknown>)[key];
                      return (
                        <label key={key} className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${checked ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleCheck(Number(detail.id), key, !checked)} className="accent-emerald-500" />
                          <span className={`text-sm ${checked ? 'text-emerald-700 line-through' : ''}`}>{CHECKLIST_LABELS[key]}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 border-t pt-4">
                  {detail.status === 'in_progress' && <button onClick={() => updateStatus(Number(detail.id), 'ready')} className="btn-secondary flex-1"><CheckCircle className="w-4 h-4" /> Mark Ready</button>}
                  {detail.status === 'ready' && <button onClick={() => updateStatus(Number(detail.id), 'approved')} className="btn-primary flex-1"><CheckCircle className="w-4 h-4" /> Approve</button>}
                  {detail.status === 'approved' && <button onClick={() => updateStatus(Number(detail.id), 'discharged')} className="btn-primary flex-1">Discharge Patient</button>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
