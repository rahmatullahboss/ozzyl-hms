import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bell, Plus, X, Search, RefreshCw, AlertCircle, CheckCircle2, Clock, SkipForward,
  Shield, Heart, Pill, Stethoscope, Calendar, Power, ChevronDown, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import { formatDisplayDate } from '../lib/date-utils';

/* ── Types ── */
interface ReminderRule {
  id: number;
  title: string;
  description?: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  interval_days: number;
  action_type: string;
  is_active: boolean;
  created_at: string;
}

interface PatientReminder {
  id: number;
  rule_id: number;
  rule_title: string;
  category: string;
  priority: string;
  status: 'overdue' | 'due' | 'completed' | 'skipped';
  last_completed_at?: string;
  next_due_date: string;
  skip_reason?: string;
}

interface Patient {
  id: number;
  name: string;
  patient_id_display?: string;
}

interface ReminderSummary {
  overdue: number;
  due: number;
  completed: number;
  skipped: number;
}

const CATEGORIES = ['preventive', 'chronic', 'medication', 'screening', 'follow_up', 'vaccination', 'lab_test', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const ACTION_TYPES = ['alert', 'order', 'message', 'task', 'appointment'];

/* ── Helpers ── */
function categoryIcon(cat: string) {
  const map: Record<string, React.ReactNode> = {
    preventive: <Shield className="w-3.5 h-3.5" />,
    chronic: <Heart className="w-3.5 h-3.5" />,
    medication: <Pill className="w-3.5 h-3.5" />,
    screening: <Stethoscope className="w-3.5 h-3.5" />,
    follow_up: <Calendar className="w-3.5 h-3.5" />,
    vaccination: <Shield className="w-3.5 h-3.5" />,
    lab_test: <Stethoscope className="w-3.5 h-3.5" />,
  };
  return map[cat] ?? <Bell className="w-3.5 h-3.5" />;
}

function categoryLabel(cat: string, t: any): string {
  return t(`category_${cat}`, { ns: 'reminders', defaultValue: cat.replace('_', ' ') });
}

function priorityLabel(p: string, t: any): string {
  return t(`priority_${p}`, { ns: 'reminders', defaultValue: p });
}

function statusLabel(s: string, t: any): string {
  return t(s, { ns: 'reminders', defaultValue: s });
}


function categoryBadge(cat: string): string {
  const map: Record<string, string> = {
    preventive: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    chronic: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    medication: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    screening: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    follow_up: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    vaccination: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    lab_test: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  };
  return map[cat] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
}

function priorityBadge(p: string): string {
  const map: Record<string, string> = { low: 'badge-secondary', medium: 'badge-warning', high: 'badge-danger', critical: 'bg-red-600 text-white' };
  return map[p] ?? 'badge-secondary';
}

function reminderStatusBadge(s: string): string {
  const map: Record<string, string> = { overdue: 'badge-danger', due: 'badge-warning', completed: 'badge-success', skipped: 'badge-secondary' };
  return map[s] ?? 'badge-secondary';
}

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function ModalComponent({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Create Rule Modal ── */
function CreateRuleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common']);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', category: 'preventive', priority: 'medium',
    interval_days: '30', action_type: 'alert',
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/clinical-reminders', {
        ...form,
        interval_days: parseInt(form.interval_days),
      });
      toast.success(t('reminderRuleCreated', { ns: 'reminders', defaultValue: 'Reminder rule created' }));
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalComponent title={t('createReminderRule', { ns: 'reminders', defaultValue: 'Create Reminder Rule' })} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="label">{t('ruleTitle', { ns: 'reminders', defaultValue: 'Rule Title' })}</label>
          <input className="input" required value={form.title} onChange={e => set('title', e.target.value)} placeholder={t('ruleTitleExample', { ns: 'reminders', defaultValue: 'e.g. Annual HbA1c Screening' })} />
        </div>
        <div>
          <label className="label">{t('description', { ns: 'reminders', defaultValue: 'Description' })}</label>
          <textarea className="input min-h-[60px]" value={form.description} onChange={e => set('description', e.target.value)} placeholder={t('description', { ns: 'reminders', defaultValue: 'Description' }) + '...'} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">{t('category', { ns: 'reminders', defaultValue: 'Category' })}</label>
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c, t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('priority', { ns: 'reminders', defaultValue: 'Priority' })}</label>
            <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{priorityLabel(p, t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t('actionType', { ns: 'reminders', defaultValue: 'Action Type' })}</label>
            <select className="input" value={form.action_type} onChange={e => set('action_type', e.target.value)}>
              {ACTION_TYPES.map(a => <option key={a} value={a}>{t(`action_${a}`, { ns: 'reminders', defaultValue: a })}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">{t('intervalDays', { ns: 'reminders', defaultValue: 'Interval (days)' })}</label>
          <input className="input" type="number" min="1" required value={form.interval_days} onChange={e => set('interval_days', e.target.value)} placeholder={t('intervalPlaceholder', { ns: 'reminders', defaultValue: '30' })} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('cancel', { ns: 'reminders', defaultValue: 'Cancel' })}</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? t('saving', { ns: 'reminders', defaultValue: 'Saving...' }) : t('createRule', { ns: 'reminders', defaultValue: 'Create Rule' })}</button>
        </div>
      </form>
    </ModalComponent>
  );
}


/* ── Skip Reason Modal ── */
function SkipModal({ reminderId, onClose, onSaved }: { reminderId: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation(['common', 'reminders']);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/clinical-reminders/${reminderId}/skip`, { reason });
      toast.success(t('reminderSkipped', { ns: 'reminders', defaultValue: 'Reminder skipped' }));
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalComponent title={t('enterSkipReason', { ns: 'reminders', defaultValue: 'Enter Skip Reason' })} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="label">{t('description', { ns: 'reminders', defaultValue: 'Description' })}</label>
          <textarea
            className="input min-h-[80px]"
            required
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t('skipReasonPlaceholder', { ns: 'reminders', defaultValue: 'Why is this being skipped?' })}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('cancel', { ns: 'reminders', defaultValue: 'Cancel' })}</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? t('saving', { ns: 'reminders', defaultValue: 'Saving...' }) : t('confirmSkip', { ns: 'reminders', defaultValue: 'Confirm Skip' })}
          </button>
        </div>
      </form>
    </ModalComponent>
  );
}

/* ── Rules Tab ── */
function RulesTab() {
  const { t } = useTranslation(['common', 'reminders']);
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ data?: ReminderRule[] }>('/api/clinical-reminders');
      setRules((data as any).data ?? (data as unknown as ReminderRule[]) ?? []);
    } catch {
      setError('Failed to load reminder rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const handleToggleActive = async (rule: ReminderRule) => {
    try {
      await api.patch(`/api/clinical-reminders/${rule.id}`, { is_active: !rule.is_active });
      toast.success(rule.is_active ? 'Rule deactivated' : 'Rule activated');
      queryClient.invalidateQueries({ queryKey: queryKeys.clinicalReminders.rules() });
      loadRules();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  if (error) return (
    <div className="text-center py-8">
      <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
      <p className="text-[var(--color-text-secondary)] mb-3">{error}</p>
      <button onClick={loadRules} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('retry')}</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" />Create Rule</button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th className="hidden sm:table-cell">Priority</th>
                <th className="hidden md:table-cell">Interval</th>
                <th className="hidden md:table-cell">Action</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <SkeletonRows cols={7} />
                : rules.length === 0 ? (
                  <tr><td colSpan={7}>
                    <EmptyState
                      icon={<Bell className="w-8 h-8 text-[var(--color-text-muted)]" />}
                      title="No reminder rules"
                      description="Create your first clinical reminder rule."
                      action={<button onClick={() => setShowCreate(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" />Create Rule</button>}
                    />
                  </td></tr>
                ) : rules.map(r => (
                  <tr key={r.id} className={`hover:bg-[var(--color-border-light)] ${!r.is_active ? 'opacity-50' : ''}`}>
                    <td>
                      <div className="font-medium">{r.title}</div>
                      {r.description && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-1">{r.description}</p>}
                    </td>
                    <td>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${categoryBadge(r.category)}`}>
                        {categoryIcon(r.category)}
                        {r.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell"><span className={`badge ${priorityBadge(r.priority)}`}>{r.priority}</span></td>
                    <td className="hidden md:table-cell font-data text-sm">{r.interval_days}d</td>
                    <td className="hidden md:table-cell capitalize text-sm">{r.action_type}</td>
                    <td>
                      <span className={`badge ${r.is_active ? 'badge-success' : 'badge-secondary'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      <button onClick={() => handleToggleActive(r)} className="btn-ghost p-1.5" title={r.is_active ? 'Deactivate' : 'Activate'}>
                        <Power className={`w-4 h-4 ${r.is_active ? 'text-red-500' : 'text-emerald-500'}`} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {showCreate && <CreateRuleModal onClose={() => setShowCreate(false)} onSaved={() => { queryClient.invalidateQueries({ queryKey: queryKeys.clinicalReminders.rules() }); loadRules(); }} />}
    </div>
  );
}

/* ── Patient Reminders Tab ── */
function PatientRemindersTab() {
  const { t } = useTranslation(['reminders', 'common', 'notifications']);
  const queryClient = useQueryClient();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [reminders, setReminders] = useState<PatientReminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipReminder, setSkipReminder] = useState<number | null>(null);
  const [patientSearch, setPatientSearch] = useState('');

  useEffect(() => {
    api.get<{ data?: Patient[] }>('/api/patients?limit=200')
      .then(res => setPatients((res as any).data ?? (res as unknown as Patient[]) ?? []))
      .catch(() => toast.error('Failed to load patients'));
  }, []);

  const loadReminders = useCallback(async () => {
    if (!selectedPatient) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ data?: PatientReminder[] }>(`/api/clinical-reminders/patient/${selectedPatient}`);
      setReminders((data as any).data ?? (data as unknown as PatientReminder[]) ?? []);
    } catch {
      setError('Failed to load reminders');
    } finally {
      setLoading(false);
    }
  }, [selectedPatient]);

  useEffect(() => { loadReminders(); }, [loadReminders]);

  const summary: ReminderSummary = reminders.reduce((acc, r) => {
    acc[r.status as keyof ReminderSummary] = (acc[r.status as keyof ReminderSummary] || 0) + 1;
    return acc;
  }, { overdue: 0, due: 0, completed: 0, skipped: 0 } as ReminderSummary);

  const markCompleted = async (id: number) => {
    try {
      await api.post(`/api/clinical-reminders/${id}/complete`, {});
      toast.success(t('reminderCompleted', { ns: 'reminders', defaultValue: 'Reminder marked as completed' }));
      queryClient.invalidateQueries({ queryKey: queryKeys.clinicalReminders.patientReminders(selectedPatient) });
      loadReminders();
    } catch (err: unknown) {
      toast.error(t('failedToUpdate', { ns: 'reminders', defaultValue: 'Failed to update reminder' }));
    }
  };

  const filteredPatients = patientSearch
    ? patients.filter(p => p.name.toLowerCase().includes(patientSearch.toLowerCase()))
    : patients;

  return (
    <div className="space-y-4">
      {/* Patient Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            className="input pl-9"
            placeholder="Search patient..."
            value={patientSearch}
            onChange={e => setPatientSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto min-w-[250px]"
          value={selectedPatient}
          onChange={e => setSelectedPatient(e.target.value)}
        >
          <option value="">Select patient...</option>
          {filteredPatients.map(p => (
            <option key={p.id} value={p.id}>{p.name} {p.patient_id_display ? `(${p.patient_id_display})` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedPatient ? (
        <EmptyState
          icon={<Search className="w-8 h-8 text-[var(--color-text-muted)]" />}
          title="Select a patient"
          description="Search and select a patient to view their clinical reminders."
        />
      ) : (
        <>
          {/* Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card p-3 text-center border-l-4 border-red-500">
              <p className="text-xs text-[var(--color-text-muted)]">Overdue</p>
              <p className="font-data text-2xl font-bold text-red-500">{summary.overdue}</p>
            </div>
            <div className="card p-3 text-center border-l-4 border-amber-500">
              <p className="text-xs text-[var(--color-text-muted)]">Due</p>
              <p className="font-data text-2xl font-bold text-amber-500">{summary.due}</p>
            </div>
            <div className="card p-3 text-center border-l-4 border-emerald-500">
              <p className="text-xs text-[var(--color-text-muted)]">Completed</p>
              <p className="font-data text-2xl font-bold text-emerald-500">{summary.completed}</p>
            </div>
            <div className="card p-3 text-center border-l-4 border-gray-400">
              <p className="text-xs text-[var(--color-text-muted)]">Skipped</p>
              <p className="font-data text-2xl font-bold text-gray-400">{summary.skipped}</p>
            </div>
          </div>

          {/* Reminder List */}
          {error ? (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-[var(--color-text-secondary)] mb-3">{error}</p>
              <button onClick={loadReminders} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('retry')}</button>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Reminder</th>
                      <th>Category</th>
                      <th className="hidden sm:table-cell">Last Done</th>
                      <th>Next Due</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? <SkeletonRows cols={6} />
                      : reminders.length === 0 ? (
                        <tr><td colSpan={6}>
                          <EmptyState
                            icon={<Bell className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title="No reminders"
                            description="No clinical reminders found for this patient."
                          />
                        </td></tr>
                      ) : reminders.map(r => (
                        <tr key={r.id} className={`hover:bg-[var(--color-border-light)] ${r.status === 'overdue' ? 'bg-red-50/50 dark:bg-red-900/10' : ''}`}>
                          <td>
                            <div className="font-medium">{r.rule_title}</div>
                          </td>
                          <td>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${categoryBadge(r.category)}`}>
                              {categoryIcon(r.category)}
                              {r.category.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="hidden sm:table-cell text-sm text-[var(--color-text-secondary)] whitespace-nowrap">
                            {r.last_completed_at ? formatDisplayDate(r.last_completed_at) : 'Never'}
                          </td>
                          <td className="text-sm whitespace-nowrap">
                            <span className={r.status === 'overdue' ? 'text-red-500 font-semibold' : ''}>
                              {formatDisplayDate(r.next_due_date)}
                            </span>
                          </td>
                          <td><span className={`badge ${reminderStatusBadge(r.status)}`}>{r.status}</span></td>
                          <td>
                            <div className="flex items-center gap-1">
                              {(r.status === 'overdue' || r.status === 'due') && (
                                <>
                                  <button onClick={() => markCompleted(r.id)} className="btn-ghost p-1.5 text-emerald-600" title="Complete">
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => setSkipReminder(r.id)} className="btn-ghost p-1.5 text-gray-500" title="Skip">
                                    <SkipForward className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {skipReminder && <SkipModal reminderId={skipReminder} onClose={() => setSkipReminder(null)} onSaved={() => { queryClient.invalidateQueries({ queryKey: queryKeys.clinicalReminders.patientReminders(selectedPatient) }); loadReminders(); }} />}
    </div>
  );
}

/* ── Main Page ── */
export default function ClinicalRemindersPage({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState<'rules' | 'patient'>('rules');

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Clinical Reminders</h1>
              <p className="section-subtitle">Manage reminder rules and track patient compliance</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="card p-1.5 flex gap-1">
          <button
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'rules' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
          ><Shield className="w-4 h-4" />Rules</button>
          <button
            onClick={() => setActiveTab('patient')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'patient' ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
          ><Clock className="w-4 h-4" />Patient Reminders</button>
        </div>

        {/* Tab Content */}
        {activeTab === 'rules' ? <RulesTab /> : <PatientRemindersTab />}
      </div>
    </DashboardLayout>
  );
}
