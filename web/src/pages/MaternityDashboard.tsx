import { useState, useEffect, useCallback } from 'react';
import {
  Baby, Plus, X, Search, RefreshCw, Trash2, Edit3,
  Calendar, Heart, Activity, Users, ChevronRight,
  CheckCircle, AlertCircle, Clock, Stethoscope,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { apiFetch, ApiClientError } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MaternityPatient {
  id: number;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  gender: string;
  date_of_birth: string;
  mobile: string;
  husband_name?: string;
  height_cm?: number;
  weight_kg?: number;
  last_menstrual_period?: string;
  expected_delivery_date?: string;
  gravida?: number;
  para?: number;
  abortions?: number;
  living_children?: number;
  delivery_date?: string;
  delivery_type?: string;
  delivery_outcome_mother?: string;
  delivery_outcome_baby?: string;
  blood_group?: string;
  rh_factor?: string;
  hiv_status?: string;
  syphilis_status?: string;
  hepatitis_b_status?: string;
  obs_history?: string;
  is_concluded: number;
  created_at: string;
}

interface ANCVisit {
  id: number;
  maternity_patient_id: number;
  visit_number: number;
  visit_date: string;
  pregnancy_weeks?: number;
  weight_kg?: number;
  blood_pressure?: string;
  pulse?: number;
  fetal_heart_rate?: number;
  hemoglobin?: number;
  condition_notes?: string;
  next_visit_date?: string;
}

interface Delivery {
  id: number;
  maternity_patient_id: number;
  delivery_date: string;
  delivery_time?: string;
  delivery_type: string;
  delivery_place?: string;
  conducted_by?: string;
  blood_loss_ml?: number;
  mother_outcome?: string;
  discharge_date?: string;
}

interface PNCVisit {
  id: number;
  maternity_patient_id: number;
  visit_day: number;
  visit_date: string;
  mother_condition?: string;
  baby_condition?: string;
  baby_weight_g?: number;
  complications?: string;
  referred: number;
}

interface Stats {
  total_active: number;
  total_registered: number;
  deliveries_this_month: number;
  anc_visits_this_month: number;
  pnc_visits_this_month: number;
  due_this_week: number;
}

interface PatientOption {
  id: number;
  patient_code: string;
  name: string;
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'patients', label: 'patients', icon: <Users className="w-4 h-4" /> },
  { key: 'anc', label: 'ancTracker', icon: <Calendar className="w-4 h-4" /> },
  { key: 'delivery', label: 'deliveryRegister', icon: <Baby className="w-4 h-4" /> },
  { key: 'pnc', label: 'pncTracker', icon: <Heart className="w-4 h-4" /> },
  { key: 'stats', label: 'statistics', icon: <Activity className="w-4 h-4" /> },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string, language: string = 'en'): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(language === 'bn' ? 'bn-BD' : 'en-GB', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  });
}

function weeksFromLMP(lmp?: string): number | null {
  if (!lmp) return null;
  const diff = Date.now() - new Date(lmp).getTime();
  const weeks = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
  return weeks > 0 ? weeks : 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MaternityDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['maternity', 'common']);
  const [activeTab, setActiveTab] = useState<TabKey>('patients');
  const [patients, setPatients] = useState<MaternityPatient[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<MaternityPatient | null>(null);
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);

  // Form state for registering/editing maternity patient
  const [form, setForm] = useState({
    patient_id: '',
    husband_name: '',
    height_cm: '',
    weight_kg: '',
    last_menstrual_period: '',
    expected_delivery_date: '',
    gravida: '0',
    para: '0',
    abortions: '0',
    living_children: '0',
    blood_group: '',
    rh_factor: '',
    hiv_status: '',
    syphilis_status: '',
    hepatitis_b_status: '',
    obs_history: '',
  });

  // ── Fetch patients ──
  const fetchPatients = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(p), limit: '20' });
      if (search) qs.set('search', search);
      if (statusFilter) qs.set('status', statusFilter);
      const data = await apiFetch<{ Results?: MaternityPatient[]; pagination?: { total?: number } }>(`/api/maternity/patients?${qs}`);
      setPatients(data.Results ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPage(p);
    } catch {
      toast.error(t('failedToLoad'));
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, t]);

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<{ Results?: Stats }>('/api/maternity/stats');
      setStats(data.Results ?? null);
    } catch {
      setStats(null);
    }
  }, []);

  // ── Fetch patient options for dropdown ──
  const fetchPatientOptions = useCallback(async () => {
    try {
      const data = await apiFetch<{ Results?: PatientOption[] }>('/api/patients?limit=200');
      setPatientOptions(data.Results ?? []);
    } catch {
      setPatientOptions([]);
    }
  }, []);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── CRUD handlers ──
  const handleCreate = () => {
    setEditingId(null);
    setForm({
      patient_id: '', husband_name: '', height_cm: '', weight_kg: '',
      last_menstrual_period: '', expected_delivery_date: '',
      gravida: '0', para: '0', abortions: '0', living_children: '0',
      blood_group: '', rh_factor: '', hiv_status: '', syphilis_status: '',
      hepatitis_b_status: '', obs_history: '',
    });
    fetchPatientOptions();
    setShowModal(true);
  };

  const handleEdit = (patient: MaternityPatient) => {
    setEditingId(patient.id);
    setForm({
      patient_id: String(patient.patient_id),
      husband_name: patient.husband_name ?? '',
      height_cm: patient.height_cm ? String(patient.height_cm) : '',
      weight_kg: patient.weight_kg ? String(patient.weight_kg) : '',
      last_menstrual_period: patient.last_menstrual_period ?? '',
      expected_delivery_date: patient.expected_delivery_date ?? '',
      gravida: String(patient.gravida ?? 0),
      para: String(patient.para ?? 0),
      abortions: String(patient.abortions ?? 0),
      living_children: String(patient.living_children ?? 0),
      blood_group: patient.blood_group ?? '',
      rh_factor: patient.rh_factor ?? '',
      hiv_status: patient.hiv_status ?? '',
      syphilis_status: patient.syphilis_status ?? '',
      hepatitis_b_status: patient.hepatitis_b_status ?? '',
      obs_history: patient.obs_history ?? '',
    });
    fetchPatientOptions();
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.patient_id) { toast.error(t('patientRequired')); return; }

    const payload: Record<string, unknown> = {
      patient_id: parseInt(form.patient_id),
      husband_name: form.husband_name || undefined,
      height_cm: form.height_cm ? parseFloat(form.height_cm) : undefined,
      weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : undefined,
      last_menstrual_period: form.last_menstrual_period || undefined,
      expected_delivery_date: form.expected_delivery_date || undefined,
      gravida: parseInt(form.gravida) || 0,
      para: parseInt(form.para) || 0,
      abortions: parseInt(form.abortions) || 0,
      living_children: parseInt(form.living_children) || 0,
      blood_group: form.blood_group || undefined,
      rh_factor: form.rh_factor || undefined,
      hiv_status: form.hiv_status || undefined,
      syphilis_status: form.syphilis_status || undefined,
      hepatitis_b_status: form.hepatitis_b_status || undefined,
      obs_history: form.obs_history || undefined,
    };

    try {
      if (editingId) {
        await apiFetch(`/api/maternity/patients/${editingId}`, { method: 'PUT', body: payload });
        toast.success(t('updated'));
      } else {
        await apiFetch('/api/maternity/patients', { method: 'POST', body: payload });
        toast.success(t('created'));
      }
      setShowModal(false);
      fetchPatients(page);
      fetchStats();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('failed'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await apiFetch(`/api/maternity/patients/${id}`, { method: 'DELETE' });
      toast.success(t('deleted'));
      fetchPatients(page);
      fetchStats();
    } catch {
      toast.error(t('deleteFailed'));
    }
  };

  const handleConclude = async (id: number) => {
    if (!confirm(t('confirmConclude'))) return;
    try {
      await apiFetch(`/api/maternity/patients/${id}`, {
        method: 'PUT',
        body: { is_concluded: 1, concluded_on: new Date().toISOString() },
      });
      toast.success(t('caseConcluded'));
      fetchPatients(page);
      fetchStats();
    } catch {
      toast.error(t('failed'));
    }
  };

  // ── KPIs ──
  const kpis = stats ? [
    { title: t('activeCases'), value: stats.total_active, icon: <Users className="w-5 h-5" />, color: 'bg-blue-50 text-blue-600' },
    { title: t('deliveriesThisMonth'), value: stats.deliveries_this_month, icon: <Baby className="w-5 h-5" />, color: 'bg-emerald-50 text-emerald-600' },
    { title: t('ancThisMonth'), value: stats.anc_visits_this_month, icon: <Calendar className="w-5 h-5" />, color: 'bg-purple-50 text-purple-600' },
    { title: t('dueThisWeek'), value: stats.due_this_week, icon: <AlertCircle className="w-5 h-5" />, color: 'bg-amber-50 text-amber-600' },
  ] : [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Baby className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'patients' && (
              <button onClick={handleCreate} className="btn-primary">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t('registerPatient')}</span>
              </button>
            )}
            <button onClick={() => { fetchPatients(page); fetchStats(); }} className="btn-ghost p-2" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((k, i) => (
              <div key={i} className={`card p-4 flex items-center gap-3 ${k.color.replace('text-', 'border-l-4 border-l-').split(' ')[1]}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.color.split(' ')[0]}`}>{k.icon}</div>
                <div>
                  <p className="text-2xl font-bold text-[var(--color-text)]">{k.value}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{k.title}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab Bar */}
        <div className="card p-1.5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                {tab.icon} {t(tab.label)}
              </button>
            ))}
          </div>
        </div>

        {/* ─── PATIENTS TAB ─── */}
        {activeTab === 'patients' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="card p-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  placeholder={t('searchPatient')}
                  className="input flex-1"
                />
              </div>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input max-w-40">
                <option value="">{t('allStatus')}</option>
                <option value="active">{t('statusActive')}</option>
                <option value="concluded">{t('statusConcluded')}</option>
              </select>
            </div>

            {/* Patients Table */}
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{t('common.patient')}</th>
                      <th>{t('husband')}</th>
                      <th>{t('gravidaPara')}</th>
                      <th>{t('lmp')}</th>
                      <th>{t('edd')}</th>
                      <th>{t('gestationalAge')}</th>
                      <th>{t('status')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [...Array(5)].map((_, i) => (
                        <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                      ))
                    ) : patients.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <EmptyState
                            icon={<Baby className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title={t('noPatients')}
                            description={t('noPatientsDesc')}
                            action={<button onClick={handleCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" /> {t('register')}</button>}
                          />
                        </td>
                      </tr>
                    ) : (
                      patients.map(p => {
                        const weeks = weeksFromLMP(p.last_menstrual_period);
                        return (
                          <tr key={p.id} className="hover:bg-[var(--color-surface-hover)]">
                            <td>
                              <div className="font-medium text-sm">{p.patient_name}</div>
                              <div className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</div>
                            </td>
                            <td className="text-sm">{p.husband_name || '—'}</td>
                            <td className="font-data text-sm">{p.gravida ?? 0}/{p.para ?? 0}/{p.abortions ?? 0}/{p.living_children ?? 0}</td>
                            <td className="font-data text-sm">{formatDate(p.last_menstrual_period, i18n.language)}</td>
                            <td className="font-data text-sm">{formatDate(p.expected_delivery_date, i18n.language)}</td>
                            <td className="text-sm">
                              {weeks != null ? (
                                <span className={`font-medium ${weeks >= 37 ? 'text-emerald-600' : weeks >= 28 ? 'text-blue-600' : 'text-amber-600'}`}>
                                  {weeks}{t('weeksSuffix')}
                                </span>
                              ) : '—'}
                            </td>
                            <td>
                              <span className={`badge ${p.is_concluded ? 'badge-neutral' : 'badge-success'}`}>
                                {p.is_concluded ? t('statusConcluded') : t('statusActive')}
                              </span>
                            </td>
                            <td>
                             <div className="flex items-center gap-1">
                                <button onClick={() => { setSelectedPatient(p); setActiveTab('anc'); }} className="btn-ghost p-1.5 text-blue-600" title={t('anc')}>
                                  <Calendar className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleEdit(p)} className="btn-ghost p-1.5 text-blue-600" title={t('edit')}>
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                {!p.is_concluded && (
                                  <button onClick={() => handleConclude(p.id)} className="btn-ghost p-1.5 text-emerald-600" title={t('conclude')}>
                                    <CheckCircle className="w-4 h-4" />
                                  </button>
                                )}
                                <button onClick={() => handleDelete(p.id)} className="btn-ghost p-1.5 text-red-600" title={t('delete')}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {total > 20 && (
                <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between text-sm">
                  <span className="text-[var(--color-text-muted)]">{t('pagination.pageOf', { page, total: Math.ceil(total / 20) })}</span>
                  <div className="flex gap-2">
                    <button onClick={() => fetchPatients(page - 1)} disabled={page <= 1} className="btn-secondary text-xs">{t('common:previous')}</button>
                    <button onClick={() => fetchPatients(page + 1)} disabled={page >= Math.ceil(total / 20)} className="btn-secondary text-xs">{t('common:next')}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── ANC / DELIVERY / PNC TABS ─── */}
        {activeTab === 'anc' && <ANCTab patient={selectedPatient} patients={patients} onSelectPatient={setSelectedPatient} />}
        {activeTab === 'delivery' && <DeliveryTab patient={selectedPatient} patients={patients} onSelectPatient={setSelectedPatient} />}
        {activeTab === 'pnc' && <PNCTab patient={selectedPatient} patients={patients} onSelectPatient={setSelectedPatient} />}

        {/* ─── STATS TAB ─── */}
        {activeTab === 'stats' && (
          <div className="card p-8 text-center text-[var(--color-text-muted)]">
            <Activity className="w-8 h-8 mx-auto mb-2" />
            <p>{t('statsComingSoon')}</p>
          </div>
        )}

        {/* ─── REGISTER/EDIT MODAL ─── */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
                <h3 className="font-semibold">
                  {editingId ? t('editPatient') : t('registerPatient')}
                </h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-5 space-y-4">
                {/* Patient selector */}
                <div>
                  <label className="label">{t('common:patient')} *</label>
                  <select value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} className="input" required disabled={!!editingId}>
                    <option value="">{t('selectPatient')}</option>
                    {patientOptions.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.patient_code})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('husbandName')}</label>
                    <input type="text" value={form.husband_name} onChange={e => setForm(f => ({ ...f, husband_name: e.target.value }))} className="input" placeholder={t('husbandPlaceholder')} />
                  </div>
                  <div>
                    <label className="label">{t('bloodGroup')}</label>
                    <select value={form.blood_group} onChange={e => setForm(f => ({ ...f, blood_group: e.target.value }))} className="input">
                      <option value="">{t('common:select')}</option>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('heightCm')}</label>
                    <input type="number" value={form.height_cm} onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))} className="input" placeholder={t('heightPlaceholder')} />
                  </div>
                  <div>
                    <label className="label">{t('weightKg')}</label>
                    <input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} className="input" placeholder={t('weightPlaceholder')} />
                  </div>
                  <div>
                    <label className="label">{t('lmp')}</label>
                    <input type="date" value={form.last_menstrual_period} onChange={e => setForm(f => ({ ...f, last_menstrual_period: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="label">{t('edd')}</label>
                    <input type="date" value={form.expected_delivery_date} onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="label">{t('gravida')}</label>
                    <input type="number" min="0" value={form.gravida} onChange={e => setForm(f => ({ ...f, gravida: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="label">{t('para')}</label>
                    <input type="number" min="0" value={form.para} onChange={e => setForm(f => ({ ...f, para: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="label">{t('abortions')}</label>
                    <input type="number" min="0" value={form.abortions} onChange={e => setForm(f => ({ ...f, abortions: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="label">{t('livingChildren')}</label>
                    <input type="number" min="0" value={form.living_children} onChange={e => setForm(f => ({ ...f, living_children: e.target.value }))} className="input" />
                  </div>
                  <div>
                    <label className="label">{t('hivStatus')}</label>
                    <select value={form.hiv_status} onChange={e => setForm(f => ({ ...f, hiv_status: e.target.value }))} className="input">
                      <option value="">{t('common:select')}</option>
                      <option value="negative">{t('negative')}</option>
                      <option value="positive">{t('positive')}</option>
                      <option value="unknown">{t('unknown')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('syphilisStatus')}</label>
                    <select value={form.syphilis_status} onChange={e => setForm(f => ({ ...f, syphilis_status: e.target.value }))} className="input">
                      <option value="">{t('common:select')}</option>
                      <option value="negative">{t('negative')}</option>
                      <option value="positive">{t('positive')}</option>
                      <option value="unknown">{t('unknown')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">{t('obsHistory')}</label>
                  <textarea value={form.obs_history} onChange={e => setForm(f => ({ ...f, obs_history: e.target.value }))} rows={2} className="input resize-none" placeholder={t('obsHistoryPlaceholder')} />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                  <button onClick={handleSave} disabled={!form.patient_id} className="btn-primary">
                    {editingId ? t('common:update') : t('common:create')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANC TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ANCTab({ patient, patients, onSelectPatient }: { patient: MaternityPatient | null; patients: MaternityPatient[]; onSelectPatient: (p: MaternityPatient | null) => void }) {
  const { t, i18n } = useTranslation(['maternity', 'common']);
  const [visits, setVisits] = useState<ANCVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    visit_number: '', visit_date: new Date().toISOString().split('T')[0],
    pregnancy_weeks: '', weight_kg: '', blood_pressure: '', pulse: '',
    fetal_heart_rate: '', hemoglobin: '', condition_notes: '', next_visit_date: '',
  });

  const fetchVisits = useCallback(async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ Results?: ANCVisit[] }>(`/api/maternity/patients/${patient.id}/anc`);
      setVisits(data.Results ?? []);
    } catch {
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  const handleSave = async () => {
    if (!patient) return;
    const payload = {
      maternity_patient_id: patient.id, patient_id: patient.patient_id,
      visit_number: parseInt(form.visit_number) || 1,
      visit_date: form.visit_date,
      pregnancy_weeks: form.pregnancy_weeks ? parseInt(form.pregnancy_weeks) : undefined,
      weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : undefined,
      blood_pressure: form.blood_pressure || undefined,
      pulse: form.pulse ? parseInt(form.pulse) : undefined,
      fetal_heart_rate: form.fetal_heart_rate ? parseInt(form.fetal_heart_rate) : undefined,
      hemoglobin: form.hemoglobin ? parseFloat(form.hemoglobin) : undefined,
      condition_notes: form.condition_notes || undefined,
      next_visit_date: form.next_visit_date || undefined,
    };

    try {
      if (editingId) {
        await apiFetch(`/api/maternity/anc/${editingId}`, { method: 'PUT', body: payload });
      } else {
        await apiFetch('/api/maternity/anc', { method: 'POST', body: payload });
      }
      toast.success(t('ancSaved'));
      setShowModal(false);
      fetchVisits();
    } catch {
      toast.error(t('failed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('patient')}:</label>
        <select value={patient?.id ?? ''} onChange={e => { const p = patients.find(x => x.id === parseInt(e.target.value)); onSelectPatient(p || null); }} className="input max-w-xs">
          <option value="">{t('selectPatient')}</option>
          {patients.map(p => <option key={p.id} value={p.id}>{p.patient_name}</option>)}
        </select>
        {patient && (
          <button onClick={() => {
            setEditingId(null);
            setForm({ visit_number: String(visits.length + 1), visit_date: new Date().toISOString().split('T')[0], pregnancy_weeks: '', weight_kg: '', blood_pressure: '', pulse: '', fetal_heart_rate: '', hemoglobin: '', condition_notes: '', next_visit_date: '' });
            setShowModal(true);
          }} className="btn-primary ml-auto">
            <Plus className="w-4 h-4" /> {t('addANC')}
          </button>
        )}
      </div>

      {patient ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('common:sn')}</th><th>{t('visitDate')}</th><th>{t('weeks')}</th><th>{t('weight')}</th><th>{t('bp')}</th><th>{t('fhr')}</th><th>{t('hemoglobin')}</th><th>{t('notes')}</th><th>{t('common:actions')}</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(3)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : visits.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-[var(--color-text-muted)]">{t('noANCVisits')}</td></tr>
                ) : (
                   visits.map((v, idx) => (
                    <tr key={v.id}>
                      <td className="font-data text-sm">{idx + 1}</td>
                      <td className="font-data text-sm">{formatDate(v.visit_date, i18n.language)}</td>
                      <td className="text-sm">{v.pregnancy_weeks ?? '—'}{t('weeksSuffix')}</td>
                      <td className="text-sm">{v.weight_kg ?? '—'} kg</td>
                      <td className="text-sm">{v.blood_pressure || '—'}</td>
                      <td className="text-sm">{v.fetal_heart_rate ?? '—'}</td>
                      <td className="text-sm">{v.hemoglobin ?? '—'}</td>
                      <td className="text-sm max-w-xs truncate">{v.condition_notes || '—'}</td>
                      <td>
                        <button onClick={() => { setEditingId(v.id); setForm({ visit_number: String(v.visit_number), visit_date: v.visit_date, pregnancy_weeks: v.pregnancy_weeks ? String(v.pregnancy_weeks) : '', weight_kg: v.weight_kg ? String(v.weight_kg) : '', blood_pressure: v.blood_pressure || '', pulse: v.pulse ? String(v.pulse) : '', fetal_heart_rate: v.fetal_heart_rate ? String(v.fetal_heart_rate) : '', hemoglobin: v.hemoglobin ? String(v.hemoglobin) : '', condition_notes: v.condition_notes || '', next_visit_date: v.next_visit_date || '' }); setShowModal(true); }} className="btn-ghost p-1.5 text-blue-600" title={t('edit')}><Edit3 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-[var(--color-text-muted)]">
          <Calendar className="w-8 h-8 mx-auto mb-2" />
          <p>{t('selectPatientForANC')}</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{editingId ? t('editANC') : t('addANC')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('visitNumber')}</label><input type="number" value={form.visit_number} onChange={e => setForm(f => ({ ...f, visit_number: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('visitDate')}</label><input type="date" value={form.visit_date} onChange={e => setForm(f => ({ ...f, visit_date: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('pregnancyWeeks')}</label><input type="number" value={form.pregnancy_weeks} onChange={e => setForm(f => ({ ...f, pregnancy_weeks: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('weightKg')}</label><input type="number" step="0.1" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('bp')}</label><input type="text" value={form.blood_pressure} onChange={e => setForm(f => ({ ...f, blood_pressure: e.target.value }))} className="input" placeholder={t('bpPlaceholder')} /></div>
                <div><label className="label">{t('fhr')}</label><input type="number" value={form.fetal_heart_rate} onChange={e => setForm(f => ({ ...f, fetal_heart_rate: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('hemoglobin')}</label><input type="number" step="0.1" value={form.hemoglobin} onChange={e => setForm(f => ({ ...f, hemoglobin: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('nextVisit')}</label><input type="date" value={form.next_visit_date} onChange={e => setForm(f => ({ ...f, next_visit_date: e.target.value }))} className="input" /></div>
              </div>
              <div><label className="label">{t('notes')}</label><textarea value={form.condition_notes} onChange={e => setForm(f => ({ ...f, condition_notes: e.target.value }))} rows={2} className="input resize-none" /></div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleSave} className="btn-primary">{editingId ? t('common:update') : t('common:create')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY TAB
// ═══════════════════════════════════════════════════════════════════════════════

function DeliveryTab({ patient, patients, onSelectPatient }: { patient: MaternityPatient | null; patients: MaternityPatient[]; onSelectPatient: (p: MaternityPatient | null) => void }) {
  const { t, i18n } = useTranslation(['maternity', 'common']);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    delivery_date: new Date().toISOString().split('T')[0], delivery_time: '',
    delivery_type: 'normal', delivery_place: '', conducted_by: '',
    delivery_complications: '', blood_loss_ml: '', mother_outcome: 'alive_well',
    discharge_date: '',
  });

  const fetchDeliveries = useCallback(async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ Results?: Delivery[] }>(`/api/maternity/patients/${patient.id}/delivery`);
      setDeliveries(data.Results ?? []);
    } catch {
      setDeliveries([]);
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => { fetchDeliveries(); }, [fetchDeliveries]);

  const handleSave = async () => {
    if (!patient) return;
    try {
      await apiFetch('/api/maternity/delivery', {
        method: 'POST',
        body: {
          maternity_patient_id: patient.id, patient_id: patient.patient_id,
          delivery_date: form.delivery_date, delivery_time: form.delivery_time || undefined,
          delivery_type: form.delivery_type, delivery_place: form.delivery_place || undefined,
          conducted_by: form.conducted_by || undefined,
          delivery_complications: form.delivery_complications || undefined,
          blood_loss_ml: form.blood_loss_ml ? parseInt(form.blood_loss_ml) : undefined,
          mother_outcome: form.mother_outcome, discharge_date: form.discharge_date || undefined,
        },
      });
      toast.success(t('deliverySaved'));
      setShowModal(false);
      fetchDeliveries();
    } catch {
      toast.error(t('failed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('patient')}:</label>
        <select value={patient?.id ?? ''} onChange={e => { const p = patients.find(x => x.id === parseInt(e.target.value)); onSelectPatient(p || null); }} className="input max-w-xs">
          <option value="">{t('selectPatient')}</option>
          {patients.map(p => <option key={p.id} value={p.id}>{p.patient_name}</option>)}
        </select>
        {patient && (
          <button onClick={() => setShowModal(true)} className="btn-primary ml-auto"><Plus className="w-4 h-4" /> {t('recordDelivery')}</button>
        )}
      </div>

      {patient ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('deliveryDate')}</th><th>{t('type')}</th><th>{t('place')}</th><th>{t('conductedBy')}</th><th>{t('bloodLoss')}</th><th>{t('motherOutcome')}</th><th>{t('dischargeDate')}</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : deliveries.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('noDeliveries')}</td></tr>
                ) : (
                   deliveries.map(d => (
                    <tr key={d.id}>
                      <td className="font-data text-sm">{formatDate(d.delivery_date, i18n.language)} {d.delivery_time}</td>
                      <td><span className="badge badge-primary">{t(d.delivery_type || 'other')}</span></td>
                      <td className="text-sm">{d.delivery_place || '—'}</td>
                      <td className="text-sm">{d.conducted_by || '—'}</td>
                      <td className="text-sm">{d.blood_loss_ml ? `${d.blood_loss_ml} ml` : '—'}</td>
                      <td><span className={`badge ${d.mother_outcome === 'alive_well' ? 'badge-success' : 'badge-error'}`}>{t(d.mother_outcome || 'alive_well')}</span></td>
                      <td className="font-data text-sm">{formatDate(d.discharge_date, i18n.language)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-[var(--color-text-muted)]">
          <Baby className="w-8 h-8 mx-auto mb-2" />
          <p>{t('selectPatientForDelivery')}</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('recordDelivery')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">{t('deliveryDate')}</label><input type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('deliveryTime')}</label><input type="time" value={form.delivery_time} onChange={e => setForm(f => ({ ...f, delivery_time: e.target.value }))} className="input" /></div>
                <div>
                  <label className="label">{t('deliveryType')}</label>
                   <select value={form.delivery_type} onChange={e => setForm(f => ({ ...f, delivery_type: e.target.value }))} className="input">
                    {['normal', 'cesarean', 'assisted_vacuum', 'assisted_forceps', 'other'].map(v => <option key={v} value={v}>{t(v)}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('bloodLossMl')}</label><input type="number" value={form.blood_loss_ml} onChange={e => setForm(f => ({ ...f, blood_loss_ml: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('place')}</label><input type="text" value={form.delivery_place} onChange={e => setForm(f => ({ ...f, delivery_place: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('conductedBy')}</label><input type="text" value={form.conducted_by} onChange={e => setForm(f => ({ ...f, conducted_by: e.target.value }))} className="input" /></div>
              </div>
              <div><label className="label">{t('complications')}</label><textarea value={form.delivery_complications} onChange={e => setForm(f => ({ ...f, delivery_complications: e.target.value }))} rows={2} className="input resize-none" /></div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleSave} className="btn-primary">{t('common:create')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PNC TAB
// ═══════════════════════════════════════════════════════════════════════════════

function PNCTab({ patient, patients, onSelectPatient }: { patient: MaternityPatient | null; patients: MaternityPatient[]; onSelectPatient: (p: MaternityPatient | null) => void }) {
  const { t, i18n } = useTranslation(['maternity', 'common']);
  const [visits, setVisits] = useState<PNCVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    visit_day: '1', visit_date: new Date().toISOString().split('T')[0],
    mother_condition: '', baby_condition: '', baby_weight_g: '', complications: '',
    referred: '0', referred_to: '',
  });

  const fetchVisits = useCallback(async () => {
    if (!patient) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ Results?: PNCVisit[] }>(`/api/maternity/patients/${patient.id}/pnc`);
      setVisits(data.Results ?? []);
    } catch {
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, [patient]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  const handleSave = async () => {
    if (!patient) return;
    try {
      await apiFetch('/api/maternity/pnc', {
        method: 'POST',
        body: {
          maternity_patient_id: patient.id, patient_id: patient.patient_id,
          visit_day: parseInt(form.visit_day), visit_date: form.visit_date,
          mother_condition: form.mother_condition || undefined,
          baby_condition: form.baby_condition || undefined,
          baby_weight_g: form.baby_weight_g ? parseInt(form.baby_weight_g) : undefined,
          complications: form.complications || undefined,
          referred: parseInt(form.referred), referred_to: form.referred_to || undefined,
        },
      });
      toast.success(t('pncSaved'));
      setShowModal(false);
      fetchVisits();
    } catch {
      toast.error(t('failed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('patient')}:</label>
        <select value={patient?.id ?? ''} onChange={e => { const p = patients.find(x => x.id === parseInt(e.target.value)); onSelectPatient(p || null); }} className="input max-w-xs">
          <option value="">{t('selectPatient')}</option>
          {patients.map(p => <option key={p.id} value={p.id}>{p.patient_name}</option>)}
        </select>
        {patient && (
          <button onClick={() => setShowModal(true)} className="btn-primary ml-auto"><Plus className="w-4 h-4" /> {t('addPNC')}</button>
        )}
      </div>

      {patient ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('visitDay')}</th><th>{t('visitDate')}</th><th>{t('motherCondition')}</th><th>{t('babyCondition')}</th><th>{t('babyWeight')}</th><th>{t('complications')}</th><th>{t('referred')}</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(3)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : visits.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('noPNCVisits')}</td></tr>
                ) : (
                  visits.map(v => (
                     <tr key={v.id}>
                      <td className="font-medium text-sm">{t('dayLabel', { day: v.visit_day })}</td>
                      <td className="font-data text-sm">{formatDate(v.visit_date, i18n.language)}</td>
                      <td className="text-sm">{v.mother_condition || '—'}</td>
                      <td className="text-sm">{v.baby_condition || '—'}</td>
                      <td className="text-sm">{v.baby_weight_g ? `${v.baby_weight_g} g` : '—'}</td>
                      <td className="text-sm">{v.complications || '—'}</td>
                      <td>{v.referred ? <span className="badge badge-error">{t('yes')}</span> : <span className="badge badge-success">{t('no')}</span>}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center text-[var(--color-text-muted)]">
          <Heart className="w-8 h-8 mx-auto mb-2" />
          <p>{t('selectPatientForPNC')}</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('addPNC')}</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('visitDay')}</label>
                   <select value={form.visit_day} onChange={e => setForm(f => ({ ...f, visit_day: e.target.value }))} className="input">
                    {[1, 3, 7, 28, 42].map(d => <option key={d} value={d}>{t('dayLabel', { day: d })}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('visitDate')}</label><input type="date" value={form.visit_date} onChange={e => setForm(f => ({ ...f, visit_date: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('motherCondition')}</label><input type="text" value={form.mother_condition} onChange={e => setForm(f => ({ ...f, mother_condition: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('babyCondition')}</label><input type="text" value={form.baby_condition} onChange={e => setForm(f => ({ ...f, baby_condition: e.target.value }))} className="input" /></div>
                <div><label className="label">{t('babyWeightG')}</label><input type="number" value={form.baby_weight_g} onChange={e => setForm(f => ({ ...f, baby_weight_g: e.target.value }))} className="input" /></div>
                <div>
                  <label className="label">{t('referred')}</label>
                  <select value={form.referred} onChange={e => setForm(f => ({ ...f, referred: e.target.value }))} className="input">
                    <option value="0">{t('no')}</option>
                    <option value="1">{t('yes')}</option>
                  </select>
                </div>
              </div>
              {form.referred === '1' && (
                <div><label className="label">{t('referredTo')}</label><input type="text" value={form.referred_to} onChange={e => setForm(f => ({ ...f, referred_to: e.target.value }))} className="input" /></div>
              )}
              <div><label className="label">{t('complications')}</label><textarea value={form.complications} onChange={e => setForm(f => ({ ...f, complications: e.target.value }))} rows={2} className="input resize-none" /></div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
                <button onClick={handleSave} className="btn-primary">{t('common:create')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
