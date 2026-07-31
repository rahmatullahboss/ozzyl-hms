import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skull, Plus, X, RefreshCw, CheckCircle, Shield, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface MortRecord {
  id: number; record_number: string; deceased_name: string; age?: number; gender?: string;
  date_of_death: string; cause_of_death?: string; place_of_death?: string;
  storage_unit?: string; is_mlc: number; status: string;
  handover_to?: string; handover_date?: string;
  postmortem_required: number; postmortem_done: number;
  police_noc_received: number;
}
interface Stats { total: number; currently_held: number; handed_over: number; mlc_cases: number; pending_postmortem: number; awaiting_noc: number; }

const STATUS_BADGE: Record<string, string> = { received: 'bg-gray-100 text-gray-600', preserved: 'bg-blue-100 text-blue-700', awaiting_noc: 'bg-amber-100 text-amber-700', awaiting_postmortem: 'bg-purple-100 text-purple-700', ready_for_handover: 'badge-success', handed_over: 'bg-green-100 text-green-700', transferred: 'badge-neutral' };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

export default function MortuaryManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['mortuary', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showHandover, setShowHandover] = useState<number | null>(null);
  const [handoverForm, setHandoverForm] = useState({ handover_to: '', handover_relation: '', handover_id_number: '', handover_phone: '', handover_witnessed_by: '' });
  const [form, setForm] = useState({ deceased_name: '', age: '', gender: 'Male', date_of_death: new Date().toISOString().split('T')[0], time_of_death: '', cause_of_death: '', place_of_death: '', storage_unit: '', is_mlc: false, preservation_type: 'refrigeration', postmortem_required: false, remarks: '' });

  const listParams = new URLSearchParams();
  if (search) listParams.set('search', search);
  if (statusFilter) listParams.set('status', statusFilter);
  const listQs = listParams.toString();

  const { data: recordsData, isLoading: loading } = useApiQuery<{ data: MortRecord[] }>(
    queryKeys.mortuary.list({ search, status: statusFilter }),
    `/api/mortuary${listQs ? `?${listQs}` : ''}`
  );
  const { data: statsData } = useApiQuery<Stats>(
    queryKeys.mortuary.stats(),
    '/api/mortuary/stats'
  );

  const items = recordsData?.data ?? [];
  const stats = statsData ?? null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.mortuary.all });
  };

  const createMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/mortuary',
    { onSuccess: () => { toast.success(t('toasts.recordCreated')); setShowForm(false); invalidateAll(); }, onError: () => { toast.error(t('toasts.failed')); } }
  );

  const statusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/mortuary/${vars.id}/status`,
    { onSuccess: (_data, vars) => { toast.success(`→ ${t(`status.${vars.status}`)}`); invalidateAll(); }, onError: () => { toast.error(t('toasts.failed')); } }
  );

  const handoverMutation = useApiMutation<unknown, { id: number; handover_to: string; handover_relation: string; handover_id_number: string; handover_phone: string; handover_witnessed_by: string }>(
    'put',
    (vars) => `/api/mortuary/${vars.id}/handover`,
    { onSuccess: () => { toast.success(t('toasts.bodyHandedOver')); setShowHandover(null); invalidateAll(); }, onError: () => { toast.error(t('toasts.failed')); } }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ ...form, age: form.age ? Number(form.age) as unknown as string : undefined as unknown as string, is_mlc: form.is_mlc, postmortem_required: form.postmortem_required } as typeof form);
  };

  const updateStatus = (id: number, status: string) => {
    statusMutation.mutate({ id, status });
  };

  const handover = () => {
    if (!showHandover || !handoverForm.handover_to) { toast.error(t('toasts.recipientNameRequired')); return; }
    handoverMutation.mutate({ id: showHandover, ...handoverForm });
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center shadow-lg shadow-gray-500/20"><Skull className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">{t('title')}</h1><p className="section-subtitle">{t('subtitle')}</p></div>
        </div><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newRecord')}</button></div>

        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { l: t('stats.total'), v: stats.total }, { l: t('stats.currentlyHeld'), v: stats.currently_held, c: 'text-blue-600' },
              { l: t('stats.handedOver'), v: stats.handed_over, c: 'text-green-600' }, { l: t('stats.mlcCases'), v: stats.mlc_cases, c: 'text-red-500' },
              { l: t('stats.pendingPM'), v: stats.pending_postmortem, c: 'text-purple-600' }, { l: t('stats.awaitingNOC'), v: stats.awaiting_noc, c: 'text-amber-600' },
            ].map(k => <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>)}
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-2 flex-1 min-w-48">
            <Search className="w-4 h-4 text-[var(--color-text-muted)]" />
            <input className="input flex-1" placeholder={t("common:search")} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('common:all_status')}</option>
            {Object.keys(STATUS_BADGE).map(s => (
              <option key={s} value={s}>{t(`status.${s}`)}</option>
            ))}
          </select>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.mortuary.all })} className="btn-ghost" title={t('common:refresh')}><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('table.recordNo')}</th><th>{t('table.deceased')}</th><th>{t('table.ageGender')}</th><th>{t('table.deathDate')}</th><th>{t('table.cause')}</th><th>{t('table.place')}</th><th>{t('table.mlc')}</th><th>{t('table.pm')}</th><th>{t('table.status')}</th><th></th></tr></thead><tbody>
          {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(10)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
          : items.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-[var(--color-text-muted)]">{t('noRecords')}</td></tr>
          : items.map(r => (
            <tr key={r.id}>
              <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{r.record_number}</td>
              <td className="font-medium">{r.deceased_name}</td>
              <td className="text-sm text-[var(--color-text-muted)]">{r.age ? `${r.age}y` : '—'}{r.gender ? `, ${t(`common:${r.gender.toLowerCase()}`)}` : ''}</td>
              <td className="text-sm">{r.date_of_death}</td>
              <td className="text-xs text-[var(--color-text-muted)] max-w-32 truncate">{r.cause_of_death ?? '—'}</td>
              <td className="text-xs">{r.place_of_death ?? '—'}</td>
              <td>{r.is_mlc ? <Shield className="w-4 h-4 text-red-500" /> : '—'}</td>
              <td>{r.postmortem_required ? (r.postmortem_done ? <CheckCircle className="w-4 h-4 text-green-500" /> : <span className="text-xs text-amber-600">{t('pending')}</span>) : '—'}</td>
              <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] ?? 'badge-neutral'}`}>{t(`status.${r.status}`)}</span></td>
              <td><div className="flex gap-1">
                {r.status === 'received' && <button onClick={() => updateStatus(r.id, 'preserved')} className="btn-ghost text-xs p-1" title={t('markPreserved')}><CheckCircle className="w-3.5 h-3.5 text-blue-600" /></button>}
                {r.status === 'ready_for_handover' && <button onClick={() => setShowHandover(r.id)} className="btn-ghost text-xs p-1" title={t('handover')}><Users className="w-3.5 h-3.5 text-green-600" /></button>}
              </div></td>
            </tr>
          ))}
        </tbody></table></div></div>

        {showForm && (
          <Modal title={t('modals.newRecord')} onClose={() => setShowForm(false)}>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div><label className="label">{t('modals.deceasedName')} *</label><input className="input w-full" required value={form.deceased_name} onChange={e => setForm({...form, deceased_name: e.target.value})} placeholder={t('modals.deceasedNamePlaceholder')} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">{t('modals.age')}</label><input className="input w-full" type="number" value={form.age} onChange={e => setForm({...form, age: e.target.value})} /></div>
                <div><label className="label">{t('modals.gender')}</label><select className="input w-full" value={form.gender} onChange={e => setForm({...form, gender: e.target.value})}><option value="Male">{t('common:male')}</option><option value="Female">{t('common:female')}</option><option value="Other">{t('common:other')}</option></select></div>
                <div><label className="label">{t('modals.deathDate')} *</label><input type="date" className="input w-full" required value={form.date_of_death} onChange={e => setForm({...form, date_of_death: e.target.value})} /></div>
              </div>
              <div><label className="label">{t('modals.cause')}</label><input className="input w-full" value={form.cause_of_death} onChange={e => setForm({...form, cause_of_death: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('modals.place')}</label><input className="input w-full" value={form.place_of_death} onChange={e => setForm({...form, place_of_death: e.target.value})} placeholder={t("modals.placePlaceholder")} /></div>
                <div><label className="label">{t('modals.storageUnit')}</label><input className="input w-full" value={form.storage_unit} onChange={e => setForm({...form, storage_unit: e.target.value})} placeholder={t("modals.storageUnitPlaceholder")} /></div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_mlc} onChange={e => setForm({...form, is_mlc: e.target.checked})} /><span className="text-sm">{t('modals.mlc')}</span></label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.postmortem_required} onChange={e => setForm({...form, postmortem_required: e.target.checked})} /><span className="text-sm">{t('modals.pmRequired')}</span></label>
              </div>
              <div><label className="label">{t('modals.remarks')}</label><textarea className="input w-full" rows={2} value={form.remarks} onChange={e => setForm({...form, remarks: e.target.value})} /></div>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common:cancel')}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('common:saving') : t('common:save')}</button></div>
            </form>
          </Modal>
        )}

        {showHandover !== null && (
          <Modal title={t('modals.bodyHandover')} onClose={() => setShowHandover(null)}>
            <div className="space-y-3">
              <div><label className="label">{t('modals.receivingPerson')} *</label><input className="input w-full" value={handoverForm.handover_to} onChange={e => setHandoverForm({...handoverForm, handover_to: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('modals.relation')}</label><input className="input w-full" value={handoverForm.handover_relation} onChange={e => setHandoverForm({...handoverForm, handover_relation: e.target.value})} placeholder={t("modals.relationPlaceholder")} /></div>
                <div><label className="label">{t('modals.idNumber')}</label><input className="input w-full" value={handoverForm.handover_id_number} onChange={e => setHandoverForm({...handoverForm, handover_id_number: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">{t('modals.phone')}</label><input className="input w-full" value={handoverForm.handover_phone} onChange={e => setHandoverForm({...handoverForm, handover_phone: e.target.value})} /></div>
                <div><label className="label">{t('modals.witnessedBy')}</label><input className="input w-full" value={handoverForm.handover_witnessed_by} onChange={e => setHandoverForm({...handoverForm, handover_witnessed_by: e.target.value})} /></div>
              </div>
              <div className="flex justify-end gap-3 pt-2"><button onClick={() => setShowHandover(null)} className="btn-secondary">{t('common:cancel')}</button><button onClick={handover} disabled={handoverMutation.isPending} className="btn-primary">{t('modals.confirmHandover')}</button></div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}

import { Search } from 'lucide-react';
