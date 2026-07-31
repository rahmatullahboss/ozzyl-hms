import { useState, useEffect, useCallback } from 'react';
import {
  Siren, Plus, X, Search, AlertTriangle, CheckCircle,
  Activity, Clock, UserPlus, Tag
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ERPatient {
  id: number;
  er_patient_number: string;
  first_name: string;
  last_name: string;
  patient_name?: string;
  gender?: string;
  age?: string;
  contact_no?: string;
  triage_code?: 'red' | 'yellow' | 'green' | null;
  er_status: 'new' | 'triaged' | 'finalized';
  finalized_status?: string;
  mode_of_arrival_name?: string;
  visit_datetime?: string;
  created_at: string;
}

interface ERStats {
  new_patients: number;
  triaged_patients: number;
  admitted_today: number;
  discharged_today: number;
  lama_count: number;
  total_today: number;
}

interface PatientSearchResult {
  id: number;
  name: string;
  patient_code: string;
  mobile?: string;
}

const STATUS_TAB_KEYS = [
  { key: 'all',       tKey: 'filterAll' },
  { key: 'new',       tKey: 'filterNew' },
  { key: 'triaged',   tKey: 'filterTriaged' },
  { key: 'admitted',  tKey: 'filterAdmitted' },
  { key: 'discharged',tKey: 'filterDischarged' },
];

const TRIAGE_CONFIG = {
  red:    { labelKey: 'redCritical',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  yellow: { labelKey: 'yellowUrgent',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  green:  { labelKey: 'greenStandard',  cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
};

const FINALIZE_OPTION_KEYS = [
  { value: 'admitted',    tKey: 'admitToWard' },
  { value: 'discharged',  tKey: 'discharge' },
  { value: 'transferred', tKey: 'transfer' },
  { value: 'lama',        tKey: 'lamaFull' },
  { value: 'dor',         tKey: 'dor' },
  { value: 'death',       tKey: 'death' },
];

import { authHeader } from '../utils/auth';

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmergencyDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['emergency', 'common']);
  // Data state
  const [patients, setPatients] = useState<ERPatient[]>([]);
  const [stats, setStats]       = useState<ERStats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Register patient modal
  const [showRegister, setShowRegister]       = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [patientQuery, setPatientQuery]       = useState('');
  const [patientResults, setPatientResults]   = useState<PatientSearchResult[]>([]);
  const [searchingPt, setSearchingPt]         = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [isExisting, setIsExisting]           = useState(false);
  const [registerForm, setRegisterForm] = useState({
    first_name: '', last_name: '', gender: '', age: '',
    contact_no: '', address: '', condition_on_arrival: '',
    case_type: 'medical',
  });

  // Triage modal
  const [triageTarget, setTriageTarget] = useState<ERPatient | null>(null);

  // Finalize modal
  const [finalizeTarget, setFinalizeTarget] = useState<ERPatient | null>(null);
  const [finalizeForm, setFinalizeForm] = useState({ finalized_status: 'discharged', finalized_remarks: '' });
  const [finalizing, setFinalizing] = useState(false);

  const resetRegisterForm = () => {
    setShowRegister(false);
    setSelectedPatient(null);
    setPatientQuery('');
    setRegisterForm({ first_name: '', last_name: '', gender: '', age: '', contact_no: '', address: '', condition_on_arrival: '', case_type: 'medical' });
    setIsExisting(false);
  };

  const resetFinalizeForm = () => {
    setFinalizeTarget(null);
    setFinalizeForm({ finalized_status: 'discharged', finalized_remarks: '' });
  };

  // ESC to close modals (with form reset)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetRegisterForm();
        setTriageTarget(null);
        resetFinalizeForm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Fetch ER patients ──
  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (search) params.search = search;
      const { data } = await axios.get('/api/emergency', { params, headers: authHeader() });
      setPatients(data.er_patients ?? []);
    } catch {
      toast.error(t('emergency.failed_to_load_er_patients'));
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  // ── Fetch stats ──
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { data } = await axios.get('/api/emergency/stats', { headers: authHeader() });
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── Patient search (existing patient lookup) ──
  useEffect(() => {
    if (patientQuery.length < 2) { setPatientResults([]); return; }
    setSearchingPt(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get('/api/emergency/search-patients', {
          params: { q: patientQuery }, headers: authHeader(),
        });
        setPatientResults(data.patients ?? []);
      } catch { setPatientResults([]); }
      finally { setSearchingPt(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [patientQuery]);

  // ── Register ER patient ──
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = isExisting && selectedPatient
        ? { ...registerForm, is_existing_patient: true, patient_id: selectedPatient.id }
        : { ...registerForm, is_existing_patient: false };
      await axios.post('/api/emergency', payload, { headers: authHeader() });
      toast.success(t('emergency.er_patient_registered'));
      setShowRegister(false);
      setSelectedPatient(null);
      setPatientQuery('');
      setRegisterForm({ first_name: '', last_name: '', gender: '', age: '', contact_no: '', address: '', condition_on_arrival: '', case_type: 'medical' });
      fetchPatients();
      fetchStats();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Triage ──
  const handleTriage = async (patient: ERPatient, code: 'red' | 'yellow' | 'green') => {
    try {
      await axios.put(`/api/emergency/${patient.id}/triage`, { triage_code: code }, { headers: authHeader() });
      toast.success(t('emergency.triageSet', { level: TRIAGE_CONFIG[code].labelKey }));
      setTriageTarget(null);
      fetchPatients();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Triage failed' : 'Triage failed');
    }
  };

  // ── Finalize ──
  const handleFinalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finalizeTarget) return;
    setFinalizing(true);
    try {
      await axios.put(`/api/emergency/${finalizeTarget.id}/finalize`, finalizeForm, { headers: authHeader() });
      toast.success(t('emergency.patientStatusUpdated', { status: finalizeForm.finalized_status }));
      setFinalizeTarget(null);
      fetchPatients();
      fetchStats();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally {
      setFinalizing(false);
    }
  };

  const patientFullName = (p: ERPatient) =>
    p.patient_name ?? `${p.first_name} ${p.last_name}`.trim();

  // ── Render ──
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Siren className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title', { ns: 'emergency' })}</h1>
              <p className="section-subtitle">{t('subtitle', { ns: 'emergency' })}</p>
            </div>
          </div>
          <button onClick={() => setShowRegister(true)} className="btn-primary">
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('registerPatient', { ns: 'emergency' })}</span>
          </button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard title={t('totalToday', { ns: 'emergency' })}  value={stats?.total_today ?? '—'}       loading={statsLoading} icon={<Activity className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('new', { ns: 'emergency' })}          value={stats?.new_patients ?? '—'}       loading={statsLoading} icon={<Clock className="w-5 h-5" />}    iconBg="bg-blue-50 text-blue-600"   index={1} />
          <KPICard title={t('triaged', { ns: 'emergency' })}      value={stats?.triaged_patients ?? '—'}   loading={statsLoading} icon={<Tag className="w-5 h-5" />}      iconBg="bg-amber-50 text-amber-600" index={2} />
          <KPICard title={t('admitted', { ns: 'emergency' })}     value={stats?.admitted_today ?? '—'}     loading={statsLoading} icon={<Plus className="w-5 h-5" />}     iconBg="bg-purple-50 text-purple-600" index={3} />
          <KPICard title={t('discharged', { ns: 'emergency' })}   value={stats?.discharged_today ?? '—'}   loading={statsLoading} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={4} />
          <KPICard title={t('lama', { ns: 'emergency' })}         value={stats?.lama_count ?? '—'}         loading={statsLoading} icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-rose-50 text-rose-600" index={5} />
        </div>

        {/* Filter & Search */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          {/* Status tabs */}
          <div className="flex gap-1 flex-wrap">
            {STATUS_TAB_KEYS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                {t(tab.tKey, { ns: 'emergency' })}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchByName', { ns: 'emergency' })}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput); }}
              className="input pl-9"
            />
          </div>
          <button onClick={() => setSearch(searchInput)} className="btn-secondary">{t('search', { ns: 'common' })}</button>
          {search && (
            <button onClick={() => { setSearch(''); setSearchInput(''); }} className="btn-ghost text-sm">
              {t('close', { ns: 'common' })}
            </button>
          )}
        </div>

        {/* ER Patient List */}
        <div className="card overflow-hidden">

          {/* Mobile card list */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(4)].map((_, i) => (
                  <div key={i} className="flex gap-3 p-4">
                    <div className="flex-1 space-y-2"><div className="skeleton h-4 w-32" /><div className="skeleton h-3 w-20" /></div>
                    <div className="skeleton h-5 w-14 rounded-full" />
                  </div>
                ))
              : patients.length === 0
                ? <div className="py-10 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
                    <Siren className="w-8 h-8 opacity-30" />
                    <p className="text-sm">{t('noERPatients', { ns: 'emergency', defaultValue: 'No ER patients found' })}</p>
                    <button onClick={() => setShowRegister(true)} className="btn-primary text-sm"><UserPlus className="w-4 h-4" /></button>
                  </div>
                : patients.map(p => (
                    <div key={p.id} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{patientFullName(p)}</p>
                          <p className="text-xs text-[var(--color-text-muted)] font-data">{p.er_patient_number}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {p.triage_code
                            ? <span className={`badge ${TRIAGE_CONFIG[p.triage_code].cls}`}>{p.triage_code}</span>
                            : <span className="badge badge-neutral">—</span>
                          }
                          <span className={`badge ${
                            p.er_status === 'new' ? 'badge-info' :
                            p.er_status === 'triaged' ? 'badge-warning' :
                            p.finalized_status === 'admitted' ? 'badge-primary' :
                            p.finalized_status === 'discharged' ? 'badge-success' :
                            'badge-error'
                          }`}>
                            {p.er_status === 'finalized' ? (p.finalized_status ?? 'Finalized') : p.er_status}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.er_status !== 'finalized' && (
                          <button onClick={() => setTriageTarget(p)} className="btn-ghost p-1.5 text-amber-600" title="Triage">
                            <Tag className="w-4 h-4" />
                          </button>
                        )}
                        {(p.er_status === 'triaged' || p.er_status === 'new') && (
                          <button onClick={() => { setFinalizeTarget(p); setFinalizeForm({ finalized_status: 'discharged', finalized_remarks: '' }); }} className="btn-ghost p-1.5 text-emerald-600" title="Finalize">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
            }
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>ER #</th>
                  <th>Patient</th>
                  <th>Age / Gender</th>
                  <th>Arrival</th>
                  <th>Triage</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(7)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  : patients.length === 0
                  ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            icon={<Siren className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title="No ER patients"
                            description="No emergency patients found for the current filters."
                            action={
                              <button onClick={() => setShowRegister(true)} className="btn-primary mt-2">
                                <UserPlus className="w-4 h-4" /> Register First Patient
                              </button>
                            }
                          />
                        </td>
                      </tr>
                    )
                  : patients.map(p => (
                      <tr key={p.id}>
                        <td className="font-data font-medium">{p.er_patient_number}</td>
                        <td className="font-medium">{patientFullName(p)}</td>
                        <td className="text-[var(--color-text-secondary)]">
                          {p.age ? `${p.age}y` : '—'} {p.gender ? `/ ${p.gender}` : ''}
                        </td>
                        <td className="font-data text-sm text-[var(--color-text-secondary)]">
                          {p.visit_datetime ? new Date(p.visit_datetime).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                        </td>
                        <td>
                          {p.triage_code
                            ? <span className={`badge ${TRIAGE_CONFIG[p.triage_code].cls}`}>{t(TRIAGE_CONFIG[p.triage_code].labelKey, { ns: 'emergency' })}</span>
                            : <span className="text-[var(--color-text-muted)] text-sm">{t('notTriaged', { ns: 'emergency' })}</span>}
                        </td>
                        <td>
                          <span className={`badge ${
                            p.er_status === 'new'      ? 'badge-info' :
                            p.er_status === 'triaged'  ? 'badge-warning' :
                            p.finalized_status === 'admitted'   ? 'badge-primary' :
                            p.finalized_status === 'discharged' ? 'badge-success' :
                            'badge-error'
                          }`}>
                            {p.er_status === 'finalized' ? (p.finalized_status ?? 'Finalized') : p.er_status}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {p.er_status !== 'finalized' && (
                              <button
                                onClick={() => setTriageTarget(p)}
                                className="btn-ghost p-1.5 text-amber-600 text-xs"
                                title="Assign Triage"
                              >
                                <Tag className="w-4 h-4" />
                              </button>
                            )}
                            {(p.er_status === 'triaged' || p.er_status === 'new') && (
                              <button
                                onClick={() => { setFinalizeTarget(p); setFinalizeForm({ finalized_status: 'discharged', finalized_remarks: '' }); }}
                                className="btn-ghost p-1.5 text-emerald-600 text-xs"
                                title="Finalize (Admit/Discharge/Transfer…)"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─────────────── REGISTER PATIENT MODAL ─────────────── */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
              <h3 className="font-semibold">{t('registerPatient', { ns: 'emergency' })}</h3>
              <button onClick={() => setShowRegister(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Existing / New toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setIsExisting(false); setSelectedPatient(null); setPatientQuery(''); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!isExisting ? 'bg-[var(--color-primary)] text-white' : 'btn-secondary'}`}
                >
                  {t('newPatient', { ns: 'emergency' })}
                </button>
                <button
                  type="button"
                  onClick={() => setIsExisting(true)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${isExisting ? 'bg-[var(--color-primary)] text-white' : 'btn-secondary'}`}
                >
                  {t('existingPatient', { ns: 'emergency' })}
                </button>
              </div>

              {/* Existing patient search */}
              {isExisting && (
                <div className="relative">
                  <label className="label">{t('searchPatient', { ns: 'emergency' })}</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9"
                      placeholder={t('searchPlaceholder', { ns: 'emergency' })}
                      value={patientQuery}
                      onChange={e => { setPatientQuery(e.target.value); setSelectedPatient(null); }}
                    />
                  </div>
                  {(searchingPt || patientResults.length > 0) && !selectedPatient && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-slate-700 border border-[var(--color-border)] rounded-xl shadow-lg overflow-hidden">
                      {searchingPt && <p className="p-3 text-sm text-[var(--color-text-muted)]">Searching…</p>}
                      {patientResults.map(pt => (
                        <button
                          key={pt.id}
                          type="button"
                          onClick={() => { setSelectedPatient(pt); setPatientQuery(pt.name); setRegisterForm(f => ({ ...f, first_name: pt.name.split(' ')[0], last_name: pt.name.split(' ').slice(1).join(' ') })); }}
                          className="w-full text-left px-4 py-2 hover:bg-[var(--color-border-light)] text-sm"
                        >
                          <span className="font-medium">{pt.name}</span>
                          <span className="ml-2 text-[var(--color-text-muted)]">{pt.patient_code}</span>
                          {pt.mobile && <span className="ml-2 text-[var(--color-text-muted)]">{pt.mobile}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedPatient && (
                    <p className="mt-1 text-sm text-emerald-600 font-medium">✓ Selected: {selectedPatient.name} ({selectedPatient.patient_code})</p>
                  )}
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('emergency.first_name_')}</label>
                    <input className="input" required value={registerForm.first_name} onChange={e => setRegisterForm(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">{t('emergency.last_name_')}</label>
                    <input className="input" required value={registerForm.last_name} onChange={e => setRegisterForm(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('emergency.age')}</label>
                    <input className="input" type="number" min="0" max="150" value={registerForm.age} onChange={e => setRegisterForm(f => ({ ...f, age: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">{t('emergency.gender')}</label>
                    <select className="input" value={registerForm.gender} onChange={e => setRegisterForm(f => ({ ...f, gender: e.target.value }))}>
                      <option value="">Select…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('emergency.contact_no')}</label>
                    <input className="input" value={registerForm.contact_no} onChange={e => setRegisterForm(f => ({ ...f, contact_no: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">{t('emergency.case_type')}</label>
                    <select className="input" value={registerForm.case_type} onChange={e => setRegisterForm(f => ({ ...f, case_type: e.target.value }))}>
                      <option value="medical">Medical</option>
                      <option value="surgical">Surgical</option>
                      <option value="obstetric">Obstetric</option>
                      <option value="trauma">Trauma</option>
                      <option value="poisoning">Poisoning</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">{t('emergency.condition_on_arrival')}</label>
                  <input className="input" placeholder={t("emergency.eg_unconscious_chest_pain")} value={registerForm.condition_on_arrival} onChange={e => setRegisterForm(f => ({ ...f, condition_on_arrival: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('emergency.address')}</label>
                  <input className="input" value={registerForm.address} onChange={e => setRegisterForm(f => ({ ...f, address: e.target.value }))} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowRegister(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={saving || (isExisting && !selectedPatient)} className="btn-primary">
                    {saving ? 'Registering…' : 'Register Patient'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── TRIAGE MODAL ─────────────── */}
      {triageTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('assignTriage', { ns: 'emergency' })}</h3>
              <button onClick={() => setTriageTarget(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Patient: <span className="font-semibold text-[var(--color-text-primary)]">{patientFullName(triageTarget)}</span>
              </p>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">{t('selectTriage', { ns: 'emergency' })}</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleTriage(triageTarget, 'red')}
                  className="w-full py-3 rounded-xl font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                >
                  🔴 Red — Critical (Immediate)
                </button>
                <button
                  onClick={() => handleTriage(triageTarget, 'yellow')}
                  className="w-full py-3 rounded-xl font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                >
                  🟡 Yellow — Urgent (Delayed)
                </button>
                <button
                  onClick={() => handleTriage(triageTarget, 'green')}
                  className="w-full py-3 rounded-xl font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                >
                  🟢 Green — Standard (Minor)
                </button>
              </div>
              <button onClick={() => setTriageTarget(null)} className="btn-ghost w-full mt-2 text-sm">{t('cancel', { ns: 'common' })}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── FINALIZE MODAL ─────────────── */}
      {finalizeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('finalizePatient', { ns: 'emergency' })}</h3>
              <button onClick={() => setFinalizeTarget(null)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleFinalize} className="p-5 space-y-4">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Patient: <span className="font-semibold text-[var(--color-text-primary)]">{patientFullName(finalizeTarget)}</span>
              </p>
              <div>
                <label className="label">{t('outcome', { ns: 'emergency' })} *</label>
                <select
                  className="input"
                  value={finalizeForm.finalized_status}
                  onChange={e => setFinalizeForm(f => ({ ...f, finalized_status: e.target.value }))}
                  required
                >
                  {FINALIZE_OPTION_KEYS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.tKey, { ns: 'emergency' })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('remarks', { ns: 'emergency' })}</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder={t("emergency.optional_notes")}
                  value={finalizeForm.finalized_remarks}
                  onChange={e => setFinalizeForm(f => ({ ...f, finalized_remarks: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setFinalizeTarget(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={finalizing} className="btn-primary">
                  {finalizing ? 'Saving…' : 'Finalize Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
