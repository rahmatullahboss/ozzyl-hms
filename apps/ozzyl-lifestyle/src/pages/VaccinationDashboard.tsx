import { useState, useEffect, useCallback } from 'react';
import {
  Syringe, Search, Plus, X, Activity, RefreshCw,
  ClipboardList, Filter, AlertTriangle, CheckCircle2,
  Clock, Edit2, Trash2, Printer, Calendar, Users,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  total_vaccines: number;
  total_records: number;
  due_today: number;
  overdue: number;
  this_month: number;
}

interface Vaccine {
  id: number;
  code: string;
  name: string;
  name_bn?: string;
  description?: string;
  number_of_doses: number;
  dose_interval_days?: number;
  target_age_group?: string;
  is_active: number;
}

interface VaccinationRecord {
  id: number;
  patient_id: number;
  vaccine_id: number;
  dose_number: number;
  administered_date: string;
  administered_by?: number;
  batch_number?: string;
  manufacturer?: string;
  route?: string;
  administration_site?: string;
  adverse_effects?: string;
  remarks?: string;
  next_dose_date?: string;
  status: 'completed' | 'scheduled' | 'missed' | 'cancelled';
  vaccine_name?: string;
  vaccine_name_bn?: string;
  vaccine_code?: string;
  total_doses?: number;
  patient_name?: string;
  patient_mobile?: string;
  date_of_birth?: string;
}

interface Patient {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
  date_of_birth?: string;
  gender?: string;
}

type TabKey = 'records' | 'catalog' | 'reports';

const ROUTE_OPTIONS = (t: (key: string, opts?: { defaultValue: string }) => string) => [
  { value: 'IM', label: t('routeOptions.IM', { defaultValue: 'IM (Intramuscular)' }) },
  { value: 'SC', label: t('routeOptions.SC', { defaultValue: 'SC (Subcutaneous)' }) },
  { value: 'ID', label: t('routeOptions.ID', { defaultValue: 'ID (Intradermal)' }) },
  { value: 'PO', label: t('routeOptions.PO', { defaultValue: 'PO (Oral)' }) },
  { value: 'IN', label: t('routeOptions.IN', { defaultValue: 'IN (Intranasal)' }) },
];

const STATUS_OPTIONS = (t: (key: string, opts?: { defaultValue: string }) => string) => [
  { value: 'completed', label: t('statusOptions.completed', { defaultValue: 'Completed' }) },
  { value: 'scheduled', label: t('statusOptions.scheduled', { defaultValue: 'Scheduled' }) },
  { value: 'missed', label: t('statusOptions.missed', { defaultValue: 'Missed' }) },
  { value: 'cancelled', label: t('statusOptions.cancelled', { defaultValue: 'Cancelled' }) },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function VaccinationDashboard() {
  const { t } = useTranslation('vaccination');
  const [tab, setTab] = useState<TabKey>('records');
  const [stats, setStats] = useState<Stats>({ total_vaccines: 0, total_records: 0, due_today: 0, overdue: 0, this_month: 0 });
  const [loading, setLoading] = useState(true);

  // Records tab
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientVaccinations, setPatientVaccinations] = useState<VaccinationRecord[]>([]);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordForm, setRecordForm] = useState({
    vaccine_id: '',
    dose_number: '1',
    administered_date: new Date().toISOString().split('T')[0],
    batch_number: '',
    manufacturer: '',
    route: 'IM',
    administration_site: '',
    adverse_effects: '',
    remarks: '',
    next_dose_date: '',
    status: 'completed',
  });
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);

  // Catalog tab
  const [vaccines, setVaccines] = useState<Vaccine[]>([]);
  const [vaccineSearch, setVaccineSearch] = useState('');
  const [showVaccineModal, setShowVaccineModal] = useState(false);
  const [vaccineForm, setVaccineForm] = useState({
    code: '', name: '', name_bn: '', description: '',
    number_of_doses: '1', dose_interval_days: '', target_age_group: '',
  });
  const [editingVaccineId, setEditingVaccineId] = useState<number | null>(null);

  // Reports tab
  const [reportType, setReportType] = useState<'due' | 'range'>('due');
  const [reportData, setReportData] = useState<VaccinationRecord[]>([]);
  const [reportStats, setReportStats] = useState<any>(null);
  const [reportFrom, setReportFrom] = useState(new Date().toISOString().split('T')[0]);
  const [reportTo, setReportTo] = useState(new Date().toISOString().split('T')[0]);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/vaccinations/stats', { headers: authHeader() });
      setStats(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStats().finally(() => setLoading(false));
  }, [fetchStats]);

  // ─── Records Tab Logic ──────────────────────────────────────────────────

  async function searchPatients() {
    if (!patientSearch.trim()) return;
    try {
      const { data } = await axios.get(`/api/patients?search=${encodeURIComponent(patientSearch)}&limit=10`, { headers: authHeader() });
      setPatientResults(data.patients ?? []);
    } catch {
      toast.error(t('toast.error.searchPatientsFailed', { defaultValue: 'Failed to search patients' }));
    }
  }

  async function selectPatient(patient: Patient) {
    setSelectedPatient(patient);
    setPatientResults([]);
    try {
      const { data } = await axios.get(`/api/vaccinations/patient/${patient.id}`, { headers: authHeader() });
      setPatientVaccinations(data.vaccinations ?? []);
    } catch {
      toast.error(t('toast.error.loadVaccinationFailed', { defaultValue: 'Failed to load vaccination records' }));
    }
  }

  async function fetchVaccinesForDropdown() {
    try {
      const { data } = await axios.get('/api/vaccinations/vaccines?is_active=1', { headers: authHeader() });
      setVaccines(data.vaccines ?? []);
    } catch { /* ignore */ }
  }

  async function saveRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient) return;
    try {
      const payload = {
        patient_id: selectedPatient.id,
        vaccine_id: Number(recordForm.vaccine_id),
        dose_number: Number(recordForm.dose_number),
        administered_date: recordForm.administered_date,
        batch_number: recordForm.batch_number || undefined,
        manufacturer: recordForm.manufacturer || undefined,
        route: recordForm.route || undefined,
        administration_site: recordForm.administration_site || undefined,
        adverse_effects: recordForm.adverse_effects || undefined,
        remarks: recordForm.remarks || undefined,
        next_dose_date: recordForm.next_dose_date || undefined,
        status: recordForm.status,
      };

      if (editingRecordId) {
        await axios.put(`/api/vaccinations/${editingRecordId}`, payload, { headers: authHeader() });
        toast.success(t('toast.success.recordUpdated', { defaultValue: 'Record updated' }));
      } else {
        await axios.post('/api/vaccinations', payload, { headers: authHeader() });
        toast.success(t('toast.success.vaccinationRecorded', { defaultValue: 'Vaccination recorded' }));
      }
      setShowRecordModal(false);
      setEditingRecordId(null);
      resetRecordForm();
      selectPatient(selectedPatient);
      fetchStats();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t('toast.error.saveRecordFailed', { defaultValue: 'Failed to save record' }));
    }
  }

  function resetRecordForm() {
    setRecordForm({
      vaccine_id: '', dose_number: '1',
      administered_date: new Date().toISOString().split('T')[0],
      batch_number: '', manufacturer: '', route: 'IM',
      administration_site: '', adverse_effects: '', remarks: '',
      next_dose_date: '', status: 'completed',
    });
  }

  function editRecord(rec: VaccinationRecord) {
    setEditingRecordId(rec.id);
    setRecordForm({
      vaccine_id: String(rec.vaccine_id),
      dose_number: String(rec.dose_number),
      administered_date: rec.administered_date,
      batch_number: rec.batch_number ?? '',
      manufacturer: rec.manufacturer ?? '',
      route: rec.route ?? 'IM',
      administration_site: rec.administration_site ?? '',
      adverse_effects: rec.adverse_effects ?? '',
      remarks: rec.remarks ?? '',
      next_dose_date: rec.next_dose_date ?? '',
      status: rec.status,
    });
    setShowRecordModal(true);
    fetchVaccinesForDropdown();
  }

  async function deleteRecord(id: number) {
    if (!confirm(t('confirm.deleteRecord', { defaultValue: 'Delete this vaccination record?' }))) return;
    try {
      await axios.delete(`/api/vaccinations/${id}`, { headers: authHeader() });
      toast.success(t('toast.success.recordDeleted', { defaultValue: 'Record deleted' }));
      if (selectedPatient) selectPatient(selectedPatient);
      fetchStats();
    } catch {
      toast.error(t('toast.error.deleteRecordFailed', { defaultValue: 'Failed to delete record' }));
    }
  }

  // ─── Catalog Tab Logic ──────────────────────────────────────────────────

  const fetchCatalog = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/vaccinations/vaccines${vaccineSearch ? `?search=${encodeURIComponent(vaccineSearch)}` : ''}`, { headers: authHeader() });
      setVaccines(data.vaccines ?? []);
    } catch {
      toast.error(t('toast.error.loadVaccineCatalog', { defaultValue: 'Failed to load vaccine catalog' }));
    }
  }, [vaccineSearch]);

  async function saveVaccine(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        code: vaccineForm.code,
        name: vaccineForm.name,
        name_bn: vaccineForm.name_bn || undefined,
        description: vaccineForm.description || undefined,
        number_of_doses: Number(vaccineForm.number_of_doses) || 1,
        dose_interval_days: vaccineForm.dose_interval_days ? Number(vaccineForm.dose_interval_days) : undefined,
        target_age_group: vaccineForm.target_age_group || undefined,
      };

      if (editingVaccineId) {
        await axios.put(`/api/vaccinations/vaccines/${editingVaccineId}`, payload, { headers: authHeader() });
        toast.success(t('toast.success.vaccineUpdated', { defaultValue: 'Vaccine updated' }));
      } else {
        await axios.post('/api/vaccinations/vaccines', payload, { headers: authHeader() });
        toast.success(t('toast.success.vaccineAdded', { defaultValue: 'Vaccine added' }));
      }
      setShowVaccineModal(false);
      setEditingVaccineId(null);
      setVaccineForm({ code: '', name: '', name_bn: '', description: '', number_of_doses: '1', dose_interval_days: '', target_age_group: '' });
      fetchCatalog();
      fetchStats();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t('toast.error.saveVaccineFailed', { defaultValue: 'Failed to save vaccine' }));
    }
  }

  function editVaccine(v: Vaccine) {
    setEditingVaccineId(v.id);
    setVaccineForm({
      code: v.code, name: v.name, name_bn: v.name_bn ?? '',
      description: v.description ?? '', number_of_doses: String(v.number_of_doses),
      dose_interval_days: v.dose_interval_days ? String(v.dose_interval_days) : '',
      target_age_group: v.target_age_group ?? '',
    });
    setShowVaccineModal(true);
  }

  async function toggleVaccineActive(v: Vaccine) {
    try {
      if (v.is_active) {
        await axios.delete(`/api/vaccinations/vaccines/${v.id}`, { headers: authHeader() });
        toast.success(t('toast.success.vaccineDeactivated', { defaultValue: 'Vaccine deactivated' }));
      } else {
        await axios.put(`/api/vaccinations/vaccines/${v.id}`, { is_active: 1 }, { headers: authHeader() });
        toast.success(t('toast.success.vaccineActivated', { defaultValue: 'Vaccine activated' }));
      }
      fetchCatalog();
    } catch {
      toast.error(t('toast.error.updateVaccineStatus', { defaultValue: 'Failed to update vaccine status' }));
    }
  }

  // ─── Reports Tab Logic ──────────────────────────────────────────────────

  async function fetchDueReport() {
    try {
      const { data } = await axios.get('/api/vaccinations/due', { headers: authHeader() });
      setReportData(data.records ?? []);
      setReportStats(data.stats);
    } catch {
      toast.error(t('toast.error.loadDueVaccinations', { defaultValue: 'Failed to load due vaccinations' }));
    }
  }

  async function fetchRangeReport() {
    try {
      const { data } = await axios.get(`/api/vaccinations/report?from_date=${reportFrom}&to_date=${reportTo}`, { headers: authHeader() });
      setReportData(data.records ?? []);
      setReportStats(data.summary);
    } catch {
      toast.error(t('toast.error.loadReport', { defaultValue: 'Failed to load report' }));
    }
  }

  // Tab change effects
  useEffect(() => {
    if (tab === 'catalog') fetchCatalog();
    if (tab === 'reports' && reportType === 'due') fetchDueReport();
  }, [tab, fetchCatalog, reportType]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <DashboardLayout role="hospital_admin">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('title', { defaultValue: 'Vaccination Module' })}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{t('subtitle', { defaultValue: 'Manage vaccines, records, and track due schedules' })}</p>
          </div>
          <button className="btn-ghost text-sm flex items-center gap-1" onClick={() => { fetchStats(); if (tab === 'catalog') fetchCatalog(); }}>
            <RefreshCw className="w-4 h-4" /> {t('actions.refresh', { defaultValue: 'Refresh' })}
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KPICard title={t('kpi.vaccineTypes', { defaultValue: 'Vaccine Types' })} value={stats.total_vaccines} icon={<Syringe className="w-5 h-5" />} />
          <KPICard title={t('kpi.totalRecords', { defaultValue: 'Total Records' })} value={stats.total_records} icon={<ClipboardList className="w-5 h-5" />} />
          <KPICard title={t('kpi.dueToday', { defaultValue: 'Due Today' })} value={stats.due_today} icon={<Calendar className="w-5 h-5" />} iconBg={stats.due_today > 0 ? 'bg-amber-50 text-amber-600' : undefined} />
          <KPICard title={t('kpi.overdue', { defaultValue: 'Overdue' })} value={stats.overdue} icon={<AlertTriangle className="w-5 h-5" />} iconBg={stats.overdue > 0 ? 'bg-red-50 text-red-600' : undefined} />
          <KPICard title={t('kpi.thisMonth', { defaultValue: 'This Month' })} value={stats.this_month} icon={<CheckCircle2 className="w-5 h-5" />} iconBg="bg-green-50 text-green-600" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--color-bg)] p-1 rounded-lg">
          {([
            { key: 'records' as TabKey, label: t('tabs.records', { defaultValue: 'Records' }), icon: <ClipboardList className="w-4 h-4" /> },
            { key: 'catalog' as TabKey, label: t('tabs.catalog', { defaultValue: 'Catalog' }), icon: <Syringe className="w-4 h-4" /> },
            { key: 'reports' as TabKey, label: t('tabs.reports', { defaultValue: 'Reports' }), icon: <Activity className="w-4 h-4" /> },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition ${tab === key ? 'bg-white dark:bg-gray-800 shadow text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
              onClick={() => setTab(key)}
            >{icon} {label}</button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'records' && (
          <div className="space-y-4">
            {/* Patient Search */}
            <div className="card p-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    className="input pl-9"
                    placeholder={t('records.searchPlaceholder', { defaultValue: 'Search patient by name, phone, or ID...' })}
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchPatients()}
                  />
                </div>
                <button className="btn-primary" onClick={searchPatients}>{t('actions.search', { defaultValue: 'Search' })}</button>
              </div>

              {patientResults.length > 0 && (
                <div className="mt-2 border rounded-lg divide-y max-h-48 overflow-auto">
                  {patientResults.map((p) => (
                    <button key={p.id} className="w-full px-3 py-2 text-left hover:bg-[var(--color-bg)] text-sm flex justify-between" onClick={() => selectPatient(p)}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[var(--color-text-muted)]">{p.patient_code} | {p.mobile ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedPatient && (
              <>
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-[var(--color-text)]">{selectedPatient.name}</h3>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {selectedPatient.patient_code} | {selectedPatient.gender ?? ''} | {selectedPatient.date_of_birth ?? ''} | {selectedPatient.mobile ?? ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary text-sm flex items-center gap-1" onClick={() => { setEditingRecordId(null); resetRecordForm(); setShowRecordModal(true); fetchVaccinesForDropdown(); }}>
                        <Plus className="w-4 h-4" /> {t('records.recordVaccination', { defaultValue: 'Record Vaccination' })}
                      </button>
                      <button className="btn-ghost text-sm flex items-center gap-1" onClick={() => window.open(`/api/pdf/vaccination-certificate/${selectedPatient.id}?autoprint=1`, '_blank')}>
                        <Printer className="w-4 h-4" /> {t('records.certificate', { defaultValue: 'Certificate' })}
                      </button>
                    </div>
                  </div>

                  {patientVaccinations.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-[var(--color-text-muted)]">
                            <th className="pb-2 pr-3">{t('records.tableHeaders.vaccine', { defaultValue: 'Vaccine' })}</th>
                            <th className="pb-2 pr-3">{t('records.tableHeaders.dose', { defaultValue: 'Dose' })}</th>
                            <th className="pb-2 pr-3">{t('records.tableHeaders.date', { defaultValue: 'Date' })}</th>
                            <th className="pb-2 pr-3">{t('records.tableHeaders.route', { defaultValue: 'Route' })}</th>
                            <th className="pb-2 pr-3">{t('records.tableHeaders.batch', { defaultValue: 'Batch' })}</th>
                            <th className="pb-2 pr-3">{t('records.tableHeaders.status', { defaultValue: 'Status' })}</th>
                            <th className="pb-2 pr-3">{t('records.tableHeaders.nextDose', { defaultValue: 'Next Dose' })}</th>
                            <th className="pb-2">{t('records.tableHeaders.actions', { defaultValue: 'Actions' })}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {patientVaccinations.map((rec) => (
                            <tr key={rec.id} className="hover:bg-[var(--color-bg)]">
                              <td className="py-2 pr-3 font-medium">{rec.vaccine_name ?? '-'}</td>
                              <td className="py-2 pr-3">{rec.dose_number}/{rec.total_doses ?? '?'}</td>
                              <td className="py-2 pr-3">{rec.administered_date}</td>
                              <td className="py-2 pr-3">{rec.route ?? '-'}</td>
                              <td className="py-2 pr-3">{rec.batch_number ?? '-'}</td>
                              <td className="py-2 pr-3">
                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${rec.status === 'completed' ? 'bg-green-100 text-green-700' : rec.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : rec.status === 'missed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                                  {rec.status}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-[var(--color-text-muted)]">{rec.next_dose_date ?? '-'}</td>
                              <td className="py-2">
                                <div className="flex gap-1">
                                  <button className="p-1 hover:text-[var(--color-primary)]" title="Edit" onClick={() => editRecord(rec)}><Edit2 className="w-3.5 h-3.5" /></button>
                                  <button className="p-1 hover:text-red-500" title="Delete" onClick={() => deleteRecord(rec.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center text-[var(--color-text-muted)] py-8">{t('records.noRecords', { defaultValue: 'No vaccination records for this patient' })}</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'catalog' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="input pl-9" placeholder={t('catalog.searchPlaceholder', { defaultValue: 'Search vaccines...' })} value={vaccineSearch} onChange={(e) => setVaccineSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchCatalog()} />
              </div>
              <button className="btn-primary flex items-center gap-1" onClick={() => { setEditingVaccineId(null); setVaccineForm({ code: '', name: '', name_bn: '', description: '', number_of_doses: '1', dose_interval_days: '', target_age_group: '' }); setShowVaccineModal(true); }}>
                <Plus className="w-4 h-4" /> {t('catalog.addVaccine', { defaultValue: 'Add Vaccine' })}
              </button>
            </div>

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-[var(--color-bg)] text-left text-[var(--color-text-muted)]">
                    <th className="p-3">{t('catalog.tableHeaders.code', { defaultValue: 'Code' })}</th>
                    <th className="p-3">{t('catalog.tableHeaders.name', { defaultValue: 'Name' })}</th>
                    <th className="p-3">{t('catalog.tableHeaders.doses', { defaultValue: 'Doses' })}</th>
                    <th className="p-3">{t('catalog.tableHeaders.interval', { defaultValue: 'Interval' })}</th>
                    <th className="p-3">{t('catalog.tableHeaders.ageGroup', { defaultValue: 'Age Group' })}</th>
                    <th className="p-3">{t('catalog.tableHeaders.status', { defaultValue: 'Status' })}</th>
                    <th className="p-3">{t('catalog.tableHeaders.actions', { defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {vaccines.map((v) => (
                    <tr key={v.id} className="hover:bg-[var(--color-bg)]">
                      <td className="p-3 font-mono text-xs">{v.code}</td>
                      <td className="p-3">
                        <div className="font-medium">{v.name}</div>
                        {v.name_bn && <div className="text-xs text-[var(--color-text-muted)]">{v.name_bn}</div>}
                      </td>
                      <td className="p-3">{v.number_of_doses}</td>
                      <td className="p-3">{v.dose_interval_days ? `${v.dose_interval_days}d` : '-'}</td>
                      <td className="p-3">{v.target_age_group ?? '-'}</td>
                      <td className="p-3">
                        <button className={`px-2 py-0.5 rounded-full text-xs font-medium ${v.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`} onClick={() => toggleVaccineActive(v)}>
                          {v.is_active ? t('catalog.active', { defaultValue: 'Active' }) : t('catalog.inactive', { defaultValue: 'Inactive' })}
                        </button>
                      </td>
                      <td className="p-3">
                        <button className="p-1 hover:text-[var(--color-primary)]" title="Edit" onClick={() => editVaccine(v)}><Edit2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {vaccines.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-[var(--color-text-muted)]">{t('catalog.noVaccines', { defaultValue: 'No vaccines in catalog. Add your first vaccine above.' })}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'reports' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button className={`px-4 py-2 rounded-lg text-sm font-medium ${reportType === 'due' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text)]'}`} onClick={() => setReportType('due')}>
                {t('reports.dueOverdue', { defaultValue: 'Due / Overdue' })}
              </button>
              <button className={`px-4 py-2 rounded-lg text-sm font-medium ${reportType === 'range' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text)]'}`} onClick={() => setReportType('range')}>
                {t('reports.dateRange', { defaultValue: 'Date Range' })}
              </button>
            </div>

            {reportType === 'range' && (
              <div className="card p-4 flex flex-wrap gap-3 items-end">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('reports.from', { defaultValue: 'From' })}</label>
                  <input type="date" className="input" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('reports.to', { defaultValue: 'To' })}</label>
                  <input type="date" className="input" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
                </div>
                <button className="btn-primary" onClick={fetchRangeReport}>{t('reports.generate', { defaultValue: 'Generate' })}</button>
              </div>
            )}

            {reportStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {reportType === 'due' ? (
                  <>
                    <KPICard title={t('reports.kpi.totalDue', { defaultValue: 'Total Due' })} value={reportStats.total ?? 0} icon={<Clock className="w-5 h-5" />} />
                    <KPICard title={t('reports.kpi.overdue', { defaultValue: 'Overdue' })} value={reportStats.overdue ?? 0} icon={<AlertTriangle className="w-5 h-5" />} iconBg={reportStats.overdue > 0 ? 'bg-red-50 text-red-600' : undefined} />
                    <KPICard title={t('reports.kpi.dueToday', { defaultValue: 'Due Today' })} value={reportStats.due_today ?? 0} icon={<Calendar className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" />
                  </>
                ) : (
                  <>
                    <KPICard title={t('reports.kpi.total', { defaultValue: 'Total' })} value={reportStats.total ?? 0} icon={<ClipboardList className="w-5 h-5" />} />
                    <KPICard title={t('reports.kpi.completed', { defaultValue: 'Completed' })} value={reportStats.completed ?? 0} icon={<CheckCircle2 className="w-5 h-5" />} iconBg="bg-green-50 text-green-600" />
                    <KPICard title={t('reports.kpi.missed', { defaultValue: 'Missed' })} value={reportStats.missed ?? 0} icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" />
                    <KPICard title={t('reports.kpi.uniquePatients', { defaultValue: 'Unique Patients' })} value={reportStats.unique_patients ?? 0} icon={<Users className="w-5 h-5" />} />
                  </>
                )}
              </div>
            )}

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-[var(--color-bg)] text-left text-[var(--color-text-muted)]">
                    <th className="p-3">{t('reports.tableHeaders.patient', { defaultValue: 'Patient' })}</th>
                    <th className="p-3">{t('reports.tableHeaders.vaccine', { defaultValue: 'Vaccine' })}</th>
                    <th className="p-3">{t('reports.tableHeaders.dose', { defaultValue: 'Dose' })}</th>
                    <th className="p-3">{reportType === 'due' ? t('reports.tableHeaders.dueDate', { defaultValue: 'Due Date' }) : t('reports.tableHeaders.date', { defaultValue: 'Date' })}</th>
                    <th className="p-3">{t('reports.tableHeaders.status', { defaultValue: 'Status' })}</th>
                    <th className="p-3">{t('reports.tableHeaders.mobile', { defaultValue: 'Mobile' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reportData.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[var(--color-bg)]">
                      <td className="p-3 font-medium">{rec.patient_name ?? '-'}</td>
                      <td className="p-3">{rec.vaccine_name ?? '-'}</td>
                      <td className="p-3">{rec.dose_number}</td>
                      <td className="p-3">{reportType === 'due' ? (rec.next_dose_date ?? '-') : rec.administered_date}</td>
                      <td className="p-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${rec.status === 'completed' ? 'bg-green-100 text-green-700' : rec.status === 'scheduled' ? 'bg-blue-100 text-blue-700' : rec.status === 'missed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="p-3 text-[var(--color-text-muted)]">{rec.patient_mobile ?? '-'}</td>
                    </tr>
                  ))}
                  {reportData.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-[var(--color-text-muted)]">
                      {reportType === 'due' ? t('reports.noDueVaccinations', { defaultValue: 'No due vaccinations found' }) : t('reports.clickGenerate', { defaultValue: 'Click "Generate" to load report' })}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Record Vaccination Modal */}
      {showRecordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editingRecordId ? t('recordModal.editTitle', { defaultValue: 'Edit Vaccination' }) : t('recordModal.addTitle', { defaultValue: 'Record Vaccination' })}</h3>
              <button onClick={() => { setShowRecordModal(false); setEditingRecordId(null); }}><X className="w-5 h-5" /></button>
            </div>
            <form className="space-y-3" onSubmit={saveRecord}>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.vaccineLabel', { defaultValue: 'Vaccine *' })}</label>
                <select className="input" required value={recordForm.vaccine_id} onChange={(e) => {
                  const vid = e.target.value;
                  const v = vaccines.find((x) => x.id === Number(vid));
                  // Auto-set next dose number based on existing records
                  const existingDoses = patientVaccinations.filter((r) => r.vaccine_id === Number(vid) && r.status !== 'cancelled');
                  const nextDose = existingDoses.length > 0 ? Math.max(...existingDoses.map((r) => r.dose_number)) + 1 : 1;
                  // Auto-calculate next_dose_date
                  let autoNextDate = '';
                  if (v && v.dose_interval_days && nextDose < (v.number_of_doses ?? 1)) {
                    const d = new Date(recordForm.administered_date);
                    d.setDate(d.getDate() + v.dose_interval_days);
                    autoNextDate = d.toISOString().split('T')[0];
                  }
                  setRecordForm((p) => ({ ...p, vaccine_id: vid, dose_number: String(nextDose), next_dose_date: autoNextDate }));
                }}>
                  <option value="">{t('recordModal.selectVaccine', { defaultValue: 'Select vaccine...' })}</option>
                  {vaccines.map((v) => {
                    const givenDoses = patientVaccinations.filter((r) => r.vaccine_id === v.id && r.status === 'completed').length;
                    const allDone = givenDoses >= v.number_of_doses;
                    return (
                      <option key={v.id} value={v.id} disabled={allDone}>
                        {v.name} ({v.code}) — {givenDoses}/{v.number_of_doses} doses{allDone ? ' [Complete]' : ''}
                      </option>
                    );
                  })}
                </select>
                {recordForm.vaccine_id && (() => {
                  const v = vaccines.find((x) => x.id === Number(recordForm.vaccine_id));
                  return v ? (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      {v.number_of_doses} dose(s) total{v.dose_interval_days ? `, ${v.dose_interval_days} days interval` : ''}
                      {v.target_age_group ? ` | Age: ${v.target_age_group}` : ''}
                    </p>
                  ) : null;
                })()}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.doseLabel', { defaultValue: 'Dose #' })}</label>
                  <input type="number" className="input" min="1" required value={recordForm.dose_number} onChange={(e) => setRecordForm((p) => ({ ...p, dose_number: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.dateLabel', { defaultValue: 'Date *' })}</label>
                  <input type="date" className="input" required value={recordForm.administered_date} onChange={(e) => {
                    const newDate = e.target.value;
                    const v = vaccines.find((x) => x.id === Number(recordForm.vaccine_id));
                    let autoNextDate = recordForm.next_dose_date;
                    if (v && v.dose_interval_days && Number(recordForm.dose_number) < (v.number_of_doses ?? 1)) {
                      const d = new Date(newDate);
                      d.setDate(d.getDate() + v.dose_interval_days);
                      autoNextDate = d.toISOString().split('T')[0];
                    }
                    setRecordForm((p) => ({ ...p, administered_date: newDate, next_dose_date: autoNextDate }));
                  }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.routeLabel', { defaultValue: 'Route' })}</label>
                  <select className="input" value={recordForm.route} onChange={(e) => setRecordForm((p) => ({ ...p, route: e.target.value }))}>
                    {ROUTE_OPTIONS(t).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.siteLabel', { defaultValue: 'Site' })}</label>
                  <input className="input" placeholder={t('recordModal.sitePlaceholder', { defaultValue: 'e.g. Left deltoid' })} value={recordForm.administration_site} onChange={(e) => setRecordForm((p) => ({ ...p, administration_site: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.batchLabel', { defaultValue: 'Batch #' })}</label>
                  <input className="input" value={recordForm.batch_number} onChange={(e) => setRecordForm((p) => ({ ...p, batch_number: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.manufacturerLabel', { defaultValue: 'Manufacturer' })}</label>
                  <input className="input" value={recordForm.manufacturer} onChange={(e) => setRecordForm((p) => ({ ...p, manufacturer: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.statusLabel', { defaultValue: 'Status' })}</label>
                <select className="input" value={recordForm.status} onChange={(e) => setRecordForm((p) => ({ ...p, status: e.target.value }))}>
                  {STATUS_OPTIONS(t).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.nextDoseDateLabel', { defaultValue: 'Next Dose Date' })}</label>
                <input type="date" className="input" value={recordForm.next_dose_date} onChange={(e) => setRecordForm((p) => ({ ...p, next_dose_date: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.adverseEffectsLabel', { defaultValue: 'Adverse Effects' })}</label>
                <textarea className="input min-h-[60px]" value={recordForm.adverse_effects} onChange={(e) => setRecordForm((p) => ({ ...p, adverse_effects: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('recordModal.remarksLabel', { defaultValue: 'Remarks' })}</label>
                <textarea className="input min-h-[60px]" value={recordForm.remarks} onChange={(e) => setRecordForm((p) => ({ ...p, remarks: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => { setShowRecordModal(false); setEditingRecordId(null); }}>{t('actions.cancel', { defaultValue: 'Cancel' })}</button>
                <button type="submit" className="btn-primary">{editingRecordId ? t('actions.update', { defaultValue: 'Update' }) : t('actions.save', { defaultValue: 'Save' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vaccine Modal */}
      {showVaccineModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editingVaccineId ? t('vaccineModal.editTitle', { defaultValue: 'Edit Vaccine' }) : t('vaccineModal.addTitle', { defaultValue: 'Add Vaccine' })}</h3>
              <button onClick={() => { setShowVaccineModal(false); setEditingVaccineId(null); }}><X className="w-5 h-5" /></button>
            </div>
            <form className="space-y-3" onSubmit={saveVaccine}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.codeLabel', { defaultValue: 'Code *' })}</label>
                  <input className="input" required placeholder={t('vaccineModal.codePlaceholder', { defaultValue: 'e.g. BCG' })} value={vaccineForm.code} onChange={(e) => setVaccineForm((p) => ({ ...p, code: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.nameLabel', { defaultValue: 'Name *' })}</label>
                  <input className="input" required value={vaccineForm.name} onChange={(e) => setVaccineForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.nameBnLabel', { defaultValue: 'Name (Bangla)' })}</label>
                <input className="input" value={vaccineForm.name_bn} onChange={(e) => setVaccineForm((p) => ({ ...p, name_bn: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.descriptionLabel', { defaultValue: 'Description' })}</label>
                <textarea className="input min-h-[60px]" value={vaccineForm.description} onChange={(e) => setVaccineForm((p) => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.dosesLabel', { defaultValue: 'Doses' })}</label>
                  <input type="number" className="input" min="1" value={vaccineForm.number_of_doses} onChange={(e) => setVaccineForm((p) => ({ ...p, number_of_doses: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.intervalLabel', { defaultValue: 'Interval (days)' })}</label>
                  <input type="number" className="input" min="0" value={vaccineForm.dose_interval_days} onChange={(e) => setVaccineForm((p) => ({ ...p, dose_interval_days: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('vaccineModal.ageGroupLabel', { defaultValue: 'Age Group' })}</label>
                  <input className="input" placeholder={t('vaccineModal.ageGroupPlaceholder', { defaultValue: 'e.g. 0-1y' })} value={vaccineForm.target_age_group} onChange={(e) => setVaccineForm((p) => ({ ...p, target_age_group: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => { setShowVaccineModal(false); setEditingVaccineId(null); }}>{t('actions.cancel', { defaultValue: 'Cancel' })}</button>
                <button type="submit" className="btn-primary">{editingVaccineId ? t('actions.update', { defaultValue: 'Update' }) : t('actions.save', { defaultValue: 'Save' })}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
