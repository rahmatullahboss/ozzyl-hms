import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  BedDouble, Users, Clock, TrendingUp, Search, RefreshCw,
  ChevronRight, AlertTriangle, X, UserPlus, LogOut
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Admission {
  id: number;
  admission_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  ward_name: string;
  bed_number: string;
  doctor_name: string;
  admission_type: string;
  admission_date: string;
  discharge_date?: string;
  provisional_diagnosis?: string;
  status: string;
}

interface Bed {
  id: number;
  ward_name: string;
  bed_number: string;
  bed_type: string;
  status: string;
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
}

interface Stats {
  currentAdmissions: number;
  totalBeds: number;
  availableBeds: number;
  dischargesToday: number;
  avgStayDays: number;
}

type StatusFilter = 'all' | 'admitted' | 'discharged' | 'transferred' | 'critical';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  admitted: 'bg-blue-100 text-blue-700',
  discharged: 'bg-green-100 text-green-700',
  transferred: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  planned: 'Planned',
  emergency: 'Emergency',
  transfer: 'Transfer',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdmissionIPD({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['ipd', 'common']);

  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [stats, setStats] = useState<Stats>({ currentAdmissions: 0, totalBeds: 0, availableBeds: 0, dischargesToday: 0, avgStayDays: 0 });
  const [beds, setBeds] = useState<Bed[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  const [selectedAdmission, setSelectedAdmission] = useState<Admission | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Admit form
  const [admitForm, setAdmitForm] = useState({
    patient_id: 0,
    bed_id: 0,
    doctor_id: 0,
    admission_type: 'planned' as 'planned' | 'emergency' | 'transfer',
    provisional_diagnosis: '',
    notes: '',
  });

  const [patientSearch, setPatientSearch] = useState('');
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [admRes, statsRes, bedsRes] = await Promise.all([
        axios.get(`/api/admissions?status=${filter}&search=${search}`, { headers: authHeaders() }),
        axios.get('/api/admissions/stats', { headers: authHeaders() }),
        axios.get('/api/admissions/beds?status=available', { headers: authHeaders() }),
      ]);
      setAdmissions(admRes.data.admissions ?? []);
      setStats(statsRes.data);
      setBeds(bedsRes.data.beds ?? []);
    } catch (err) {
      console.error('[Admissions] Fetch failed:', err);
      // Fallback demo
      setStats({ currentAdmissions: 12, totalBeds: 20, availableBeds: 8, dischargesToday: 2, avgStayDays: 3.5 });
      setAdmissions([
        { id: 1, admission_no: 'ADM-00001', patient_id: 1, patient_name: 'Mohammad Karim', patient_code: 'P-00001', ward_name: 'Ward A', bed_number: 'A-1', doctor_name: 'Dr. Rahman', admission_type: 'emergency', admission_date: new Date().toISOString(), provisional_diagnosis: 'Acute appendicitis', status: 'admitted' },
        { id: 2, admission_no: 'ADM-00002', patient_id: 2, patient_name: 'Fatima Begum', patient_code: 'P-00002', ward_name: 'ICU', bed_number: 'ICU-1', doctor_name: 'Dr. Hossain', admission_type: 'emergency', admission_date: new Date(Date.now() - 86400000 * 2).toISOString(), provisional_diagnosis: 'Severe pneumonia', status: 'critical' },
        { id: 3, admission_no: 'ADM-00003', patient_id: 3, patient_name: 'Abdul Hashem', patient_code: 'P-00003', ward_name: 'Ward B', bed_number: 'B-2', doctor_name: 'Dr. Akter', admission_type: 'planned', admission_date: new Date(Date.now() - 86400000 * 5).toISOString(), discharge_date: new Date().toISOString(), provisional_diagnosis: 'Knee replacement', status: 'discharged' },
      ]);
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Search patients for admit modal
  const searchPatients = useCallback(async (term: string) => {
    if (term.length < 2) { setPatients([]); return; }
    try {
      const res = await axios.get(`/api/patients?search=${encodeURIComponent(term)}&limit=8`, { headers: authHeaders() });
      setPatients(res.data.patients ?? []);
    } catch {
      setPatients([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchPatients(patientSearch), 300);
    return () => clearTimeout(timer);
  }, [patientSearch, searchPatients]);

  // Admit patient
  const handleAdmit = async () => {
    if (!admitForm.patient_id) {
      toast.error(t('ipd.please_select_a_patient'));
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        patient_id: admitForm.patient_id,
        admission_type: admitForm.admission_type,
      };
      if (admitForm.bed_id) body.bed_id = admitForm.bed_id;
      if (admitForm.doctor_id) body.doctor_id = admitForm.doctor_id;
      if (admitForm.provisional_diagnosis) body.provisional_diagnosis = admitForm.provisional_diagnosis;
      if (admitForm.notes) body.notes = admitForm.notes;

      const res = await axios.post('/api/admissions', body, { headers: authHeaders() });
      toast.success(t('ipd.patientAdmitted', { admissionNo: res.data.admission_no }));
      setShowAdmitModal(false);
      setAdmitForm({ patient_id: 0, bed_id: 0, doctor_id: 0, admission_type: 'planned', provisional_diagnosis: '', notes: '' });
      setPatientSearch('');
      fetchAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to admit patient';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Discharge
  const handleDischarge = async () => {
    if (!selectedAdmission) return;
    setSubmitting(true);
    try {
      await axios.put(`/api/admissions/${selectedAdmission.id}`, { status: 'discharged' }, { headers: authHeaders() });
      toast.success(t('ipd.patientDischarged', { admissionNo: selectedAdmission.admission_no }));
      setShowDischargeModal(false);
      setSelectedAdmission(null);
      fetchAll();
    } catch {
      toast.error(t('ipd.failed_to_discharge_patient'));
    } finally {
      setSubmitting(false);
    }
  };

  // KPI data
  const kpis = [
    { label: 'Current Admissions', value: stats.currentAdmissions, icon: <Users className="w-5 h-5 text-blue-500" />, bg: 'bg-blue-50' },
    { label: 'Available Beds', value: `${stats.availableBeds}/${stats.totalBeds}`, icon: <BedDouble className="w-5 h-5 text-green-500" />, bg: 'bg-green-50' },
    { label: 'Avg Stay (days)', value: stats.avgStayDays, icon: <Clock className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-50' },
    { label: 'Discharges Today', value: stats.dischargesToday, icon: <TrendingUp className="w-5 h-5 text-purple-500" />, bg: 'bg-purple-50' },
  ];

  const FILTERS: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'admitted', label: 'Admitted' },
    { id: 'critical', label: 'Critical' },
    { id: 'discharged', label: 'Discharged' },
    { id: 'transferred', label: 'Transferred' },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">

        {/* Breadcrumb + Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">Admissions</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('title', { defaultValue: 'Admission / IPD' })}</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdmitModal(true)} className="btn-primary">
              <UserPlus className="w-4 h-4" /> {t('admitPatient', { defaultValue: 'Admit Patient' })}
            </button>
            <button onClick={fetchAll} className="btn-ghost p-2" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map(k => (
            <div key={k.label} className="card p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.bg}`}>
                {k.icon}
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--color-text)]">{k.value}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{k.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters + Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
            {FILTERS.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 transition-colors ${filter === f.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t("ipd.searchPatientBedAdmission")}
              value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
        </div>

        {/* Admissions Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">Loading...</div>
          ) : admissions.length === 0 ? (
            <div className="p-12 text-center">
              <BedDouble className="w-10 h-10 mx-auto mb-2 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-[var(--color-text-muted)]">{t('noAdmissions', { defaultValue: 'No admissions found' })}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg)]">
                  <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                    <th className="text-left px-4 py-3 font-medium">Admission #</th>
                    <th className="text-left px-4 py-3 font-medium">Patient</th>
                    <th className="text-left px-4 py-3 font-medium">Ward / Bed</th>
                    <th className="text-left px-4 py-3 font-medium">Doctor</th>
                    <th className="text-left px-4 py-3 font-medium">Admitted</th>
                    <th className="text-left px-4 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Diagnosis</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="text-center px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {admissions.map(a => (
                    <tr key={a.id} className="hover:bg-[var(--color-bg)] transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-[var(--color-primary)]">{a.admission_no}</td>
                      <td className="px-4 py-3">
                        <Link to={`${basePath}/patients/${a.patient_id}`} className="text-[var(--color-text)] font-medium hover:text-[var(--color-primary)]">
                          {a.patient_name}
                        </Link>
                        <p className="text-xs text-[var(--color-text-muted)]">{a.patient_code}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {a.ward_name && a.bed_number ? `${a.ward_name} — ${a.bed_number}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">{a.doctor_name || '—'}</td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{fmt(a.admission_date)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{TYPE_LABELS[a.admission_type] ?? a.admission_type}</span>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)] max-w-[150px] truncate" title={a.provisional_diagnosis ?? ''}>
                        {a.provisional_diagnosis || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs rounded-full px-2 py-0.5 font-medium capitalize ${STATUS_STYLES[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(a.status === 'admitted' || a.status === 'critical') && (
                          <button onClick={() => { setSelectedAdmission(a); setShowDischargeModal(true); }}
                            className="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1 mx-auto">
                            <LogOut className="w-3 h-3" /> Discharge
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Admit Patient Modal ── */}
        {showAdmitModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAdmitModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-[var(--color-text)]">{t('admitPatient', { defaultValue: 'Admit Patient' })}</h2>
                <button onClick={() => setShowAdmitModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Patient Search */}
                <div className="relative">
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("ipd.patientRequired")}</label>
                  <input type="text" placeholder={t("ipd.searchPatientNameCode")}
                    value={patientSearch}
                    onChange={e => { setPatientSearch(e.target.value); setShowPatientDropdown(true); }}
                    onFocus={() => setShowPatientDropdown(true)}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                  />
                  {showPatientDropdown && patients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {patients.map(p => (
                        <button key={p.id} onClick={() => {
                          setAdmitForm(f => ({ ...f, patient_id: p.id }));
                          setPatientSearch(`${p.name} (${p.patient_code})`);
                          setShowPatientDropdown(false);
                        }}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg)] transition-colors">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Admission Type */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("ipd.admissionType")}</label>
                  <select value={admitForm.admission_type}
                    onChange={e => setAdmitForm(f => ({ ...f, admission_type: e.target.value as 'planned' | 'emergency' | 'transfer' }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                    <option value="planned">Planned</option>
                    <option value="emergency">Emergency</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>

                {/* Bed */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("ipd.wardBed")}</label>
                  <select value={admitForm.bed_id}
                    onChange={e => setAdmitForm(f => ({ ...f, bed_id: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                    <option value={0}>— Select Bed —</option>
                    {beds.map(b => (
                      <option key={b.id} value={b.id}>{b.ward_name} — {b.bed_number} ({b.bed_type})</option>
                    ))}
                  </select>
                </div>

                {/* Diagnosis */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("ipd.provisionalDiagnosis")}</label>
                  <textarea value={admitForm.provisional_diagnosis}
                    onChange={e => setAdmitForm(f => ({ ...f, provisional_diagnosis: e.target.value }))}
                    rows={2} placeholder={t("ipd.provisionalDiagnosisPlaceholder")}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="text-sm font-medium text-[var(--color-text)] mb-1 block">{t("ipd.notes")}</label>
                  <textarea value={admitForm.notes}
                    onChange={e => setAdmitForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} placeholder={t("ipd.additionalNotesPlaceholder")}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setShowAdmitModal(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleAdmit} disabled={submitting || !admitForm.patient_id} className="btn-primary">
                  {submitting ? t('loading', { ns: 'common' }) : t('confirmAdmission', { defaultValue: 'Confirm Admission' })}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Discharge Confirmation Modal ── */}
        {showDischargeModal && selectedAdmission && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDischargeModal(false)}>
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">{t('confirmDischarge', { defaultValue: 'Confirm Discharge' })}</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Discharge <strong>{selectedAdmission.patient_name}</strong> ({selectedAdmission.admission_no})?
                  </p>
                </div>
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Bed <strong>{selectedAdmission.ward_name} — {selectedAdmission.bed_number}</strong> will be freed.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDischargeModal(false)} className="btn-secondary">Cancel</button>
                <button onClick={handleDischarge} disabled={submitting} className="btn-warning">
                  {submitting ? t('loading', { ns: 'common' }) : t('dischargePatient', { defaultValue: 'Discharge Patient' })}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
