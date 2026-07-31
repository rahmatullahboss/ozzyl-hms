import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Search, RefreshCw, AlertTriangle, CheckCircle, GitMerge, Eye, X } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

interface DupPair { id1: number; name1: string; code1?: string; phone1?: string; nid1?: string; dob1?: string; id2: number; name2: string; code2?: string; phone2?: string; nid2?: string; dob2?: string; match_type: string; confidence: number; }
interface PatientCompare { patient1: Record<string, unknown> & { record_counts: Record<string, number>; total_records: number }; patient2: Record<string, unknown> & { record_counts: Record<string, number>; total_records: number }; }
interface MergeLog { id: number; primary_patient_id: number; merged_patient_id: number; primary_name?: string; primary_code?: string; merge_reason: string; merged_at: string; tables_updated: string; }
interface Stats { duplicate_phones: number; duplicate_nids: number; total_merges: number; }

const MATCH_BADGE: Record<string, string> = { phone: 'bg-blue-100 text-blue-700', nid: 'bg-red-100 text-red-700', name_dob: 'bg-amber-100 text-amber-700' };
const TABS = ['scan', 'history'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

export default function PatientDuplicates({ role }: { role?: string }) {
  const { t } = useTranslation(['patients', 'common']);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('scan');
  const [method, setMethod] = useState('auto');
  const [compare, setCompare] = useState<PatientCompare | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeReason, setMergeReason] = useState('');

  // Scan query
  const { data: scanData, isLoading: loadingScan } = useApiQuery<{ data: DupPair[] }>(
    queryKeys.patientDuplicates.scan(method),
    `/api/patient-duplicates/scan?method=${method}`,
    { enabled: tab === 'scan' }
  );
  const pairs = scanData?.data ?? [];

  // Stats query
  const { data: statsData } = useApiQuery<Stats>(
    queryKeys.patientDuplicates.stats(),
    '/api/patient-duplicates/stats'
  );
  const stats = statsData ?? null;

  // History query
  const { data: historyData, isLoading: loadingHistory } = useApiQuery<{ data: MergeLog[] }>(
    queryKeys.patientDuplicates.history(),
    '/api/patient-duplicates/history',
    { enabled: tab === 'history' }
  );
  const history = historyData?.data ?? [];

  const loading = tab === 'scan' ? loadingScan : loadingHistory;

  // Merge mutation
  const mergeMutation = useApiMutation<{ total_records_moved: number }, { primary_id: number; secondary_id: number; merge_reason: string }>(
    'post',
    '/api/patient-duplicates/merge',
    {
      onSuccess: (data) => {
        toast.success(t('patients.recordsMerged', { count: data.total_records_moved }));
        setCompare(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.patientDuplicates.all });
      },
      onError: (err) => {
        toast.error(err.message ?? t('patientDuplicates.mergeFailed'));
      },
    }
  );

  const comparePair = async (id1: number, id2: number) => {
    try {
      const data = await api.get<PatientCompare>(`/api/patient-duplicates/compare?id1=${id1}&id2=${id2}`);
      setCompare(data); setMergeReason('');
    } catch { toast.error(t('patients.failed_to_load_comparison')); }
  };

  const doMerge = (primaryId: number, secondaryId: number) => {
    if (!mergeReason) { toast.error(t('patients.merge_reason_required')); return; }
    if (!window.confirm(t('patients.mergeConfirm', { defaultValue: 'This will permanently merge patient B into patient A. All visit history will be transferred. This cannot be undone. Continue?' }))) return;
    setMerging(true);
    mergeMutation.mutate(
      { primary_id: primaryId, secondary_id: secondaryId, merge_reason: mergeReason },
      { onSettled: () => setMerging(false) }
    );
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20"><GitMerge className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">{t('patientDuplicates.title')}</h1><p className="section-subtitle">{t('patientDuplicates.description')}</p></div>
        </div></div>

        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-3 text-center border-l-4 border-l-blue-400"><p className="text-xs text-[var(--color-text-muted)]">{t('patientDuplicates.duplicatePhones')}</p><p className="text-2xl font-bold text-blue-600">{stats.duplicate_phones}</p></div>
            <div className="card p-3 text-center border-l-4 border-l-red-400"><p className="text-xs text-[var(--color-text-muted)]">{t('patientDuplicates.duplicateNIDs')}</p><p className="text-2xl font-bold text-red-600">{stats.duplicate_nids}</p></div>
            <div className="card p-3 text-center border-l-4 border-l-green-400"><p className="text-xs text-[var(--color-text-muted)]">{t('patientDuplicates.totalMergesDone')}</p><p className="text-2xl font-bold text-green-600">{stats.total_merges}</p></div>
          </div>
        )}

        <div className="card p-1.5 flex gap-1">{TABS.map((tabItem) => (<button key={tabItem} onClick={() => setTab(tabItem)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === tabItem ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{tabItem === 'scan' ? t('patientDuplicates.scanDuplicates') : t('patientDuplicates.mergeHistory')}</button>))}</div>

        {tab === 'scan' && (
          <div className="space-y-4">
            <div className="flex gap-3 items-end">
              <div><label className="label">{t('patients.detection_method')}</label>
                <select className="input w-44" value={method} onChange={e => setMethod(e.target.value)}>
                  <option value="auto">Auto ({t('patients.phone_match')})</option>
                  <option value="phone">{t('patients.same_phone')}</option>
                  <option value="nid">{t('patients.same_nid')}</option>
                  <option value="name_dob">{t('patients.same_name_dob')}</option>
                </select>
              </div>
              <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.patientDuplicates.scan(method) })} className="btn-primary"><Search className="w-4 h-4" /> {t('common:search')}</button>
            </div>

            {loading ? <div className="card p-8 text-center text-[var(--color-text-muted)]">{t('patientDuplicates.scanning')}</div>
            : pairs.length === 0 ? <div className="card p-12 text-center"><CheckCircle className="w-10 h-10 mx-auto text-green-500 mb-2" /><p className="font-medium text-green-700">{t('patientDuplicates.noDuplicatesFound')}</p></div>
            : <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('patientDuplicates.patientA')}</th><th>{t('patientDuplicates.patientB')}</th><th>{t('patientDuplicates.match')}</th><th>{t('patientDuplicates.confidence')}</th><th></th></tr></thead><tbody>
              {pairs.map((p, i) => (
                <tr key={i}>
                  <td><span className="font-medium">{p.name1}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{p.code1} · {p.phone1 ?? p.nid1 ?? p.dob1}</span></td>
                  <td><span className="font-medium">{p.name2}</span><br /><span className="text-xs text-[var(--color-text-muted)]">{p.code2} · {p.phone2 ?? p.nid2 ?? p.dob2}</span></td>
                  <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${MATCH_BADGE[p.match_type] ?? 'badge-neutral'}`}>{p.match_type}</span></td>
                  <td className="font-data text-center">{p.confidence}%</td>
                  <td><button onClick={() => comparePair(p.id1, p.id2)} className="btn-ghost text-xs p-1"><Eye className="w-3.5 h-3.5" /> {t('common:compare')}</button></td>
                </tr>
              ))}
            </tbody></table></div></div>}
          </div>
        )}

        {tab === 'history' && (
          <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('patientDuplicates.date')}</th><th>{t('patientDuplicates.primaryPatient')}</th><th>{t('patientDuplicates.mergedId')}</th><th>{t('patientDuplicates.reason')}</th><th>{t('patientDuplicates.tablesUpdated')}</th></tr></thead><tbody>
            {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
            : history.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('patientDuplicates.noMergesYet')}</td></tr>
            : history.map(m => (
              <tr key={m.id}>
                <td className="text-xs">{m.merged_at?.slice(0, 16).replace('T', ' ')}</td>
                <td><span className="font-medium">{m.primary_name ?? `#${m.primary_patient_id}`}</span></td>
                <td className="font-mono text-sm">#{m.merged_patient_id}</td>
                <td className="text-sm">{m.merge_reason}</td>
                <td className="text-xs text-[var(--color-text-muted)]">{(() => { try { const t = JSON.parse(m.tables_updated); return Object.keys(t).join(', '); } catch { return '—'; } })()}</td>
              </tr>
            ))}
          </tbody></table></div></div>
        )}

        {compare && (
          <Modal title={t('patientDuplicates.compareAndMerge')} onClose={() => setCompare(null)}>
            <div className="grid grid-cols-2 gap-4">
              {[compare.patient1, compare.patient2].map((p, i) => (
                <div key={i} className={`border rounded-lg p-4 ${i === 0 ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/20' : 'border-gray-200'}`}>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2">{i === 0 ? t('patientDuplicates.patientA') : t('patientDuplicates.patientB')}</p>
                  <p className="font-bold text-lg">{String(p.name)}</p>
                  <div className="space-y-1 mt-2 text-sm">
                    <p><span className="text-[var(--color-text-muted)]">Code:</span> {String(p.patient_code ?? '—')}</p>
                    <p><span className="text-[var(--color-text-muted)]">Mobile:</span> {String(p.mobile ?? '—')}</p>
                    <p><span className="text-[var(--color-text-muted)]">NID:</span> {String(p.national_id ?? '—')}</p>
                    <p><span className="text-[var(--color-text-muted)]">DOB:</span> {String(p.date_of_birth ?? '—')}</p>
                    <p><span className="text-[var(--color-text-muted)]">Address:</span> {String(p.address ?? '—')}</p>
                  </div>
                  <div className="mt-3 p-2 bg-white dark:bg-slate-800 rounded border">
                    <p className="text-xs font-semibold mb-1">{p.total_records} records</p>
                    {Object.entries(p.record_counts).map(([table, count]) => (
                      <p key={table} className="text-xs text-[var(--color-text-muted)]">{table}: {count}</p>
                    ))}
                    {Object.keys(p.record_counts).length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No records</p>}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 mt-4">
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> <strong>{t('patientDuplicates.cannotUndoWarning')}</strong> {t('patientDuplicates.cannotUndoDescription')}</p>
              </div>
              <div><label className="label">{t('patientDuplicates.mergeReasonLabel')} *</label><input className="input w-full" placeholder={t("patients.eg_duplicate_nid_same_person_registered_twice")} value={mergeReason} onChange={e => setMergeReason(e.target.value)} /></div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => doMerge(Number(compare.patient1.id), Number(compare.patient2.id))} disabled={merging || !mergeReason} className="btn-primary flex-1">
                  <GitMerge className="w-4 h-4" /> {merging ? t('patientDuplicates.merging') : t('patientDuplicates.mergeBIntoA')}
                </button>
                <button onClick={() => doMerge(Number(compare.patient2.id), Number(compare.patient1.id))} disabled={merging || !mergeReason} className="btn-secondary flex-1">
                  {t('patientDuplicates.mergeAIntoB')}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}
