import { useState } from 'react';
import { Sparkles, Plus, X, CheckCircle, Clock, BedDouble, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface Area {
  id: number;
  area_name: string;
  area_type: string;
  floor?: string;
  building?: string;
  tenant_id?: string;
}
interface Task { id: number; task_number: string; area_name?: string; task_type: string; priority: string; description?: string; scheduled_date: string; assigned_to?: string; status: string; quality_rating?: number; }
interface Complaint { id: number; complaint_number: string; area_name?: string; reported_by: string; complaint_type: string; description: string; priority: string; status: string; resolution_notes?: string; }

const PRIORITY_BADGE: Record<string, string> = { low: 'badge-neutral', normal: 'bg-blue-100 text-blue-700', high: 'badge-warning', urgent: 'bg-red-100 text-red-700' };
const TASK_STATUS_BADGE: Record<string, string> = { pending: 'bg-gray-100 text-gray-600', in_progress: 'bg-blue-100 text-blue-700', completed: 'badge-success', verified: 'bg-emerald-100 text-emerald-700', cancelled: 'badge-neutral' };
const COMP_STATUS_BADGE: Record<string, string> = { open: 'bg-red-100 text-red-700', assigned: 'bg-blue-100 text-blue-700', in_progress: 'bg-amber-100 text-amber-700', resolved: 'badge-success', closed: 'badge-neutral' };
const TASK_TYPES = ['routine','deep_clean','sanitization','spill','post_discharge','pest_control','waste_disposal','other'];
const TABS = ['tasks', 'complaints', 'areas', 'beds'] as const;
type Tab = typeof TABS[number];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"><div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto"><div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button></div><div className="p-5 space-y-4">{children}</div></div></div>);
}

function TasksTab() {
  const { t } = useTranslation(['housekeeping', 'common']);
  const queryClient = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ area_name: '', task_type: 'routine', priority: 'normal', description: '', scheduled_date: new Date().toISOString().split('T')[0], assigned_to: '' });

  const taskParams = new URLSearchParams({ date });
  if (statusFilter) taskParams.set('status', statusFilter);

  const { data: tasksData, isLoading: loadingTasks } = useApiQuery<{ data: Task[] }>(
    queryKeys.housekeeping.tasks({ date, status: statusFilter }),
    `/api/housekeeping/tasks?${taskParams.toString()}`
  );
  const { data: statsData } = useApiQuery<{ tasks: Record<string, number> }>(
    queryKeys.housekeeping.stats(),
    '/api/housekeeping/stats'
  );
  const { data: areasData } = useApiQuery<{ data: Area[] }>(
    queryKeys.housekeeping.areas(),
    '/api/housekeeping/areas'
  );

  const items = tasksData?.data ?? [];
  const stats = statsData?.tasks ?? null;
  const areas = areasData?.data ?? [];
  const loading = loadingTasks;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.housekeeping.all });
  };

  const statusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/housekeeping/tasks/${vars.id}/status`,
    { onSuccess: (_data, vars) => { toast.success(t('taskUpdated', { status: vars.status })); invalidateAll(); }, onError: () => { toast.error(t('failed', { ns: 'common' })); } }
  );

  const createMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/housekeeping/tasks',
    { onSuccess: () => { toast.success(t('taskCreated')); setShowForm(false); invalidateAll(); }, onError: () => { toast.error(t('failed', { ns: 'common' })); } }
  );

  const updateStatus = (id: number, status: string) => {
    statusMutation.mutate({ id, status });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form);
  };

  const nextAction = (s: string) => {
    const map: Record<string, string> = { pending: 'in_progress', in_progress: 'completed', completed: 'verified' };
    return map[s];
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[{ l: t('total'), v: stats.total ?? 0 }, { l: t('pending'), v: stats.pending ?? 0, c: 'text-gray-600' }, { l: t('inProgress'), v: stats.in_progress ?? 0, c: 'text-blue-600' }, { l: t('completed'), v: stats.completed ?? 0, c: 'text-green-600' }, { l: t('verified'), v: stats.verified ?? 0, c: 'text-emerald-600' }].map(k =>
            <div key={k.l} className="card p-3 text-center"><p className="text-xs text-[var(--color-text-muted)]">{k.l}</p><p className={`text-2xl font-bold mt-1 ${k.c ?? ''}`}>{k.v}</p></div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className="label">{t('date', { ns: 'common' })}</label><input type="date" className="input w-40" value={date} onChange={e => setDate(e.target.value)} /></div>
        <select className="input w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">{t('allStatus')}</option><option value="pending">{t('pending')}</option><option value="in_progress">{t('inProgress')}</option><option value="completed">{t('completed')}</option><option value="verified">{t('verified')}</option></select>
        <div className="flex-1" /><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newTask')}</button>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Task #</th><th>{t('area')}</th><th>{t('type')}</th><th>{t('priority')}</th><th>{t('assignedTo')}</th><th>{t('status')}</th><th>{t('rating')}</th><th></th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">{t('noTasks')}</td></tr>
        : items.map(t => { const next = nextAction(t.status); return (
          <tr key={t.id}>
            <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{t.task_number}</td>
            <td className="text-sm">{t.area_name ?? '—'}</td>
            <td className="text-xs"><span className="badge-neutral">{t.task_type.replace('_', ' ')}</span></td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[t.priority] ?? ''}`}>{t.priority}</span></td>
            <td className="text-sm text-[var(--color-text-muted)]">{t.assigned_to ?? '—'}</td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TASK_STATUS_BADGE[t.status] ?? ''}`}>{t.status.replace('_', ' ')}</span></td>
            <td className="text-center">{t.quality_rating ? `${'★'.repeat(t.quality_rating)}` : '—'}</td>
            <td>{next && <button onClick={() => updateStatus(t.id, next)} className="btn-ghost text-xs p-1"><CheckCircle className="w-3.5 h-3.5 text-blue-600" /></button>}</td>
          </tr>); })}
      </tbody></table></div></div>
      {showForm && (
        <Modal title={t('newHousekeepingTask')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('area')}</label><select className="input w-full" value={form.area_name} onChange={e => setForm({...form, area_name: e.target.value})}><option value="">{t('selectArea')}</option>{areas.map(a => <option key={a.id} value={a.area_name}>{a.area_name} ({a.area_type})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('type')} *</label><select className="input w-full" value={form.task_type} onChange={e => setForm({...form, task_type: e.target.value})}>{TASK_TYPES.map(tt => <option key={tt} value={tt}>{t(tt, { defaultValue: tt.replace('_', ' ') })}</option>)}</select></div>
              <div><label className="label">{t('priority')}</label><select className="input w-full" value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}><option value="low">{t('low')}</option><option value="normal">{t('normal')}</option><option value="high">{t('high')}</option><option value="urgent">{t('urgent')}</option></select></div>
            </div>
            <div><label className="label">{t('description')}</label><textarea className="input w-full" rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('date', { ns: 'common' })} *</label><input type="date" className="input w-full" required value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></div>
              <div><label className="label">{t('assignedTo')}</label><input className="input w-full" value={form.assigned_to} onChange={e => setForm({...form, assigned_to: e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving') : t('create')}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ComplaintsTab() {
  const { t } = useTranslation(['housekeeping', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ area_name: '', reported_by: '', reported_by_role: '', complaint_type: 'cleanliness', description: '', priority: 'normal' });

  const { data: complaintsData, isLoading: loading } = useApiQuery<{ data: Complaint[] }>(
    queryKeys.housekeeping.complaints(),
    '/api/housekeeping/complaints'
  );
  const items = complaintsData?.data ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.housekeeping.all });
  };

  const statusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/housekeeping/complaints/${vars.id}/status`,
    { onSuccess: (_data, vars) => { toast.success(t('complaintUpdated', { status: vars.status })); invalidateAll(); }, onError: () => { toast.error(t('failed', { ns: 'common' })); } }
  );

  const createMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/housekeeping/complaints',
    { onSuccess: () => { toast.success(t('complaintRegistered')); setShowForm(false); invalidateAll(); }, onError: () => { toast.error(t('failed', { ns: 'common' })); } }
  );

  const updateStatus = (id: number, status: string) => {
    statusMutation.mutate({ id, status });
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); createMutation.mutate(form); };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('newComplaint')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Complaint #</th><th>{t('area')}</th><th>{t('type')}</th><th>{t('reportedBy')}</th><th>{t('priority')}</th><th>{t('status')}</th><th></th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('noComplaints')}</td></tr>
        : items.map(c => (
          <tr key={c.id}>
            <td className="font-mono text-sm font-bold text-[var(--color-primary)]">{c.complaint_number}</td>
            <td className="text-sm">{c.area_name ?? '—'}</td>
            <td className="text-xs"><span className="badge-neutral">{c.complaint_type}</span></td>
            <td className="text-sm">{c.reported_by}</td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[c.priority] ?? ''}`}>{c.priority}</span></td>
            <td><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COMP_STATUS_BADGE[c.status] ?? ''}`}>{c.status}</span></td>
            <td><div className="flex gap-1">
              {c.status === 'open' && <button onClick={() => updateStatus(c.id, 'assigned')} className="btn-ghost text-xs p-1" title="Assign"><CheckCircle className="w-3.5 h-3.5" /></button>}
              {c.status === 'assigned' && <button onClick={() => updateStatus(c.id, 'in_progress')} className="btn-ghost text-xs p-1 text-blue-600"><Clock className="w-3.5 h-3.5" /></button>}
              {c.status === 'in_progress' && <button onClick={() => updateStatus(c.id, 'resolved')} className="btn-ghost text-xs p-1 text-green-600"><CheckCircle className="w-3.5 h-3.5" /></button>}
            </div></td>
          </tr>
        ))}
      </tbody></table></div></div>
      {showForm && (
        <Modal title={t('registerComplaint')} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="label">{t('area')}</label><input className="input w-full" value={form.area_name} onChange={e => setForm({...form, area_name: e.target.value})} placeholder={t('placeholderArea')} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('reportedBy')} *</label><input className="input w-full" required value={form.reported_by} onChange={e => setForm({...form, reported_by: e.target.value})} /></div>
              <div><label className="label">{t('role')}</label><input className="input w-full" value={form.reported_by_role} onChange={e => setForm({...form, reported_by_role: e.target.value})} placeholder={t('placeholderRole')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">{t('type')}</label><select className="input w-full" value={form.complaint_type} onChange={e => setForm({...form, complaint_type: e.target.value})}><option value="cleanliness">{t('cleanliness')}</option><option value="pest">{t('pest')}</option><option value="odor">{t('odor')}</option><option value="waste">{t('waste')}</option><option value="damaged">{t('damaged')}</option><option value="other">{t('other')}</option></select></div>
              <div><label className="label">{t('priority')}</label><select className="input w-full" value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}><option value="low">{t('low')}</option><option value="normal">{t('normal')}</option><option value="high">{t('high')}</option><option value="urgent">{t('urgent')}</option></select></div>
            </div>
            <div><label className="label">{t('description')} *</label><textarea className="input w-full" required rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving') : t('register')}</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function AreasTab() {
  const { t } = useTranslation(['housekeeping', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ area_name: '', area_type: 'ward', floor: '', building: '' });

  const { data: areasData, isLoading: loading } = useApiQuery<{ data: Area[] }>(
    queryKeys.housekeeping.areas(),
    '/api/housekeeping/areas'
  );
  const items = areasData?.data ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.housekeeping.all });
  };

  const createMutation = useApiMutation<unknown, typeof form>(
    'post',
    '/api/housekeeping/areas',
    { onSuccess: () => { toast.success(t('areaAdded')); setShowForm(false); invalidateAll(); }, onError: () => { toast.error(t('failed', { ns: 'common' })); } }
  );

  const deleteMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/housekeeping/areas/${vars.id}`,
    { onSuccess: () => { invalidateAll(); } }
  );

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); createMutation.mutate(form); };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setShowForm(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('addArea')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('area')}</th><th>{t('type')}</th><th>{t('floor')}</th><th>{t('building')}</th><th></th></tr></thead><tbody>
        {loading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">{t('noAreas')}</td></tr>
        : items.map(a => (<tr key={a.id}><td className="font-medium">{a.area_name}</td><td className="text-xs"><span className="badge-neutral">{a.area_type}</span></td><td className="text-sm">{a.floor ?? '—'}</td><td className="text-sm">{a.building ?? '—'}</td><td><button onClick={() => deleteMutation.mutate({ id: a.id })} className="btn-ghost text-xs text-red-400 p-1"><X className="w-3.5 h-3.5" /></button></td></tr>))}
      </tbody></table></div></div>
      {showForm && (<Modal title={t('addAreaTitle')} onClose={() => setShowForm(false)}><form onSubmit={handleSubmit}>
        <div><label className="label">{t('areaName')} *</label><input className="input w-full" required value={form.area_name} onChange={e => setForm({...form, area_name: e.target.value})} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">{t('type')}</label><select className="input w-full" value={form.area_type} onChange={e => setForm({...form, area_type: e.target.value})}>{['ward','ot','icu','lobby','corridor','toilet','office','canteen','other'].map((areaType) => <option key={areaType} value={areaType}>{t(areaType, { defaultValue: areaType })}</option>)}</select></div>
          <div><label className="label">{t('floor')}</label><input className="input w-full" value={form.floor} onChange={e => setForm({...form, floor: e.target.value})} /></div>
          <div><label className="label">{t('building')}</label><input className="input w-full" value={form.building} onChange={e => setForm({...form, building: e.target.value})} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button><button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? t('saving') : t('addArea')}</button></div>
      </form></Modal>)}
    </div>
  );
}

function BedCleaningTab() {
  const { t } = useTranslation(['housekeeping', 'common']);
  const queryClient = useQueryClient();

  const { data: bedsData, isLoading } = useApiQuery<{ beds: Array<{ id: number; bed_number: string; ward_name?: string; room_number?: string; status: string; patient_name?: string }> }>(
    queryKeys.housekeeping.beds(),
    '/api/admissions/beds?status=cleaning'
  );
  const items = bedsData?.beds ?? [];

  const clearMutation = useApiMutation<unknown, { id: number }>(
    'put',
    (vars) => `/api/admissions/beds/${vars.id}/clear-cleaning`,
    { onSuccess: () => { toast.success(t('bedCleaned')); queryClient.invalidateQueries({ queryKey: queryKeys.housekeeping.all }); queryClient.invalidateQueries({ queryKey: ['admissions'] }); }, onError: () => { toast.error(t('failed', { ns: 'common' })); } }
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-[var(--color-text-muted)]">{t('pendingCleaning')}</p>
          <p className="text-2xl font-bold text-sky-600 mt-1">{items.length}</p>
        </div>
      </div>

      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('bed')}</th><th>{t('ward')}</th><th>{t('room')}</th><th>{t('previousPatient')}</th><th>{t('status')}</th><th></th></tr></thead><tbody>
        {isLoading ? [...Array(3)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
        : items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]"><BedDouble className="w-8 h-8 mx-auto mb-2 opacity-50" />{t('noBedsCleaning')}</td></tr>
        : items.map(bed => (
          <tr key={bed.id}>
            <td className="font-medium">{bed.bed_number}</td>
            <td className="text-sm">{bed.ward_name ?? '—'}</td>
            <td className="text-sm">{bed.room_number ?? '—'}</td>
            <td className="text-sm">{bed.patient_name ?? '—'}</td>
            <td><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700 flex items-center gap-1 w-fit"><RefreshCw className="w-3 h-3" /> {t('cleaning')}</span></td>
            <td><button onClick={() => clearMutation.mutate({ id: bed.id })} className="btn-primary text-xs px-3 py-1.5"><CheckCircle className="w-3.5 h-3.5" /> {t('markCleaned')}</button></td>
          </tr>
        ))}
      </tbody></table></div></div>
    </div>
  );
}

export default function HousekeepingManagement({ role }: { role?: string }) {
  const { t } = useTranslation(['housekeeping', 'common']);
  const [tab, setTab] = useState<Tab>('tasks');
  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20"><Sparkles className="w-5 h-5 text-white" /></div>
          <div><h1 className="page-title">{t('title')}</h1><p className="section-subtitle">{t('subtitle')}</p></div>
        </div></div>
        <div className="card p-1.5 flex gap-1">{TABS.map(tb => (<button key={tb} onClick={() => setTab(tb)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === tb ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>{t(tb)}</button>))}</div>
        {tab === 'tasks' && <TasksTab />}{tab === 'complaints' && <ComplaintsTab />}{tab === 'areas' && <AreasTab />}{tab === 'beds' && <BedCleaningTab />}
      </div>
    </DashboardLayout>
  );
}
