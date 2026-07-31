import { useState, useEffect, useCallback } from 'react';
import {
  BedDouble, Search, FileText, DollarSign, Clock, CheckCircle,
  X, AlertTriangle, Plus, Printer, Eye
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { api, ApiClientError } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IPPatient {
  admission_id: number;
  admission_number: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  admitted_date: string;
  expected_discharge?: string;
  billing_status: 'pending' | 'partial' | 'settled';
  total_charges: number;
  total_paid: number;
  balance: number;
}

interface IPStats {
  total_inpatients: number;
  pending_billing: number;
  total_charges_today: number;
  settled_today: number;
}

interface IPCharge {
  id: number;
  charge_date: string;
  service_name: string;
  quantity: number;
  rate: number;
  total: number;
  charge_type: string;
  added_by?: string;
}

interface AddChargeForm {
  service_name: string;
  quantity: string;
  rate: string;
  charge_type: string;
  charge_date: string;
}

const STATUS_TABS = [
  { key: 'all', label: 'All Patients' },
  { key: 'pending', label: 'Pending' },
  { key: 'partial', label: 'Partial' },
  { key: 'settled', label: 'Settled' },
];

const CHARGE_TYPES = [
  { value: 'bed', label: 'Bed Charge' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'nursing', label: 'Nursing' },
  { value: 'medicine', label: 'Medicine' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'other', label: 'Other' },
];

function fmtTaka(n: number) {
  return `৳${(n || 0).toLocaleString('en-BD')}`;
}
function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function IPBillingPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common', 'sidebar']);

  const [patients, setPatients] = useState<IPPatient[]>([]);
  const [stats, setStats] = useState<IPStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Detail panel
  const [selectedPatient, setSelectedPatient] = useState<IPPatient | null>(null);
  const [charges, setCharges] = useState<IPCharge[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  // Add charge modal
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [addForm, setAddForm] = useState<AddChargeForm>({
    service_name: '', quantity: '1', rate: '', charge_type: 'procedure',
    charge_date: new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('billing_status', statusFilter);
      if (search) params.set('search', search);
      const q = params.toString();
      const data = await api.get<{ data: IPPatient[] }>(`/api/ip-billing/patients${q ? `?${q}` : ''}`);
      setPatients(data.data ?? []);
    } catch {
      toast.error(t('billing.failed_to_load_ip_patients'));
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<IPStats>('/api/ip-billing/stats');
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  const fetchCharges = useCallback(async (admissionId: number) => {
    setChargesLoading(true);
    try {
      const data = await api.get<{ data: IPCharge[] }>(`/api/ip-billing/admissions/${admissionId}/charges`);
      setCharges(data.data ?? []);
    } catch {
      toast.error(t('billing.failed_to_load_charges'));
      setCharges([]);
    } finally {
      setChargesLoading(false);
    }
  }, []);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const openDetail = (p: IPPatient) => {
    setSelectedPatient(p);
    fetchCharges(p.admission_id);
  };

  const handleAddCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setSaving(true);
    try {
      await api.post(`/api/ip-billing/admissions/${selectedPatient.admission_id}/charges`, {
        ...addForm,
        quantity: parseFloat(addForm.quantity),
        rate: parseFloat(addForm.rate),
      });
      toast.success(t('billing.charge_added'));
      setShowAddCharge(false);
      setAddForm({ service_name: '', quantity: '1', rate: '', charge_type: 'procedure', charge_date: new Date().toISOString().split('T')[0] });
      fetchCharges(selectedPatient.admission_id);
      fetchPatients();
      fetchStats();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('billing.operationFailed'));
    } finally {
      setSaving(false);
    }
  };

  const billingStatusClass = (s: string) => {
    if (s === 'settled') return 'badge-success';
    if (s === 'partial') return 'badge-warning';
    return 'badge-info';
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <BedDouble className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('sidebar:ipBilling')}</h1>
              <p className="section-subtitle">Inpatient billing, charges & settlements</p>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard title="Total Inpatients"     value={stats?.total_inpatients ?? '—'}       loading={!stats} icon={<BedDouble className="w-5 h-5" />}    iconBg="bg-indigo-50 text-indigo-600"   index={0} />
          <KPICard title="Pending Billing"      value={stats?.pending_billing ?? '—'}        loading={!stats} icon={<Clock className="w-5 h-5" />}         iconBg="bg-amber-50 text-amber-600"     index={1} />
          <KPICard title="Today's Charges"      value={fmtTaka(stats?.total_charges_today ?? 0)} loading={!stats} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600"    index={2} />
          <KPICard title="Settled Today"        value={fmtTaka(stats?.settled_today ?? 0)}   loading={!stats} icon={<CheckCircle className="w-5 h-5" />}   iconBg="bg-emerald-50 text-emerald-600" index={3} />
        </div>

        {/* Filters */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 flex-wrap">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t("billing.search_patient_name_or_code")}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput); }}
              className="input pl-9"
            />
          </div>
          <button onClick={() => setSearch(searchInput)} className="btn-secondary">Search</button>
          {search && <button onClick={() => { setSearch(''); setSearchInput(''); }} className="btn-ghost text-sm">Clear</button>}
        </div>

        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Patients table */}
          <div className={`card overflow-hidden ${selectedPatient ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Admission #</th>
                    <th>Patient</th>
                    <th>Ward / Bed</th>
                    <th>Doctor</th>
                    <th>Admitted</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? [...Array(5)].map((_, i) => (
                        <tr key={i}>
                          {[...Array(9)].map((_, j) => (
                            <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                          ))}
                        </tr>
                      ))
                    : patients.length === 0
                    ? (
                        <tr>
                          <td colSpan={9}>
                            <EmptyState
                              icon={<BedDouble className="w-8 h-8 text-[var(--color-text-muted)]" />}
                              title="No inpatients"
                              description="No inpatients found for the current filters."
                            />
                          </td>
                        </tr>
                      )
                    : patients.map(p => (
                        <tr key={p.admission_id} className={selectedPatient?.admission_id === p.admission_id ? 'bg-[var(--color-primary-light)]' : ''}>
                          <td className="font-data font-medium">{p.admission_number}</td>
                          <td>
                            <div className="font-medium">{p.patient_name}</div>
                            <div className="text-xs text-[var(--color-text-muted)]">{p.patient_code}</div>
                          </td>
                          <td className="text-sm">{p.ward_name ?? '—'} {p.bed_number ? `/ ${p.bed_number}` : ''}</td>
                          <td className="text-sm">{p.doctor_name ?? '—'}</td>
                          <td className="font-data text-sm">{fmtDate(p.admitted_date)}</td>
                          <td className="text-right font-medium">{fmtTaka(p.total_charges)}</td>
                          <td className={`text-right font-semibold ${p.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {fmtTaka(p.balance)}
                          </td>
                          <td><span className={`badge ${billingStatusClass(p.billing_status)}`}>{p.billing_status}</span></td>
                          <td>
                            <button
                              onClick={() => openDetail(p)}
                              className="btn-ghost p-1.5 text-[var(--color-primary)]"
                              title="View charges"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </div>

          {/* Detail panel */}
          {selectedPatient && (
            <div className="card flex flex-col gap-0 overflow-hidden">
              {/* Panel header */}
              <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                <div>
                  <div className="font-semibold">{selectedPatient.patient_name}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{selectedPatient.admission_number} • {selectedPatient.ward_name ?? 'No ward'}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowAddCharge(true)} className="btn-primary text-xs px-2 py-1.5">
                    <Plus className="w-3.5 h-3.5" /> Add Charge
                  </button>
                  <button onClick={() => setSelectedPatient(null)} className="btn-ghost p-1.5">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Balance summary */}
              <div className="grid grid-cols-3 gap-px bg-[var(--color-border)]">
                {[
                  { label: 'Total', value: fmtTaka(selectedPatient.total_charges), cls: '' },
                  { label: 'Paid', value: fmtTaka(selectedPatient.total_paid), cls: 'text-emerald-600' },
                  { label: 'Balance', value: fmtTaka(selectedPatient.balance), cls: selectedPatient.balance > 0 ? 'text-red-600' : 'text-emerald-600' },
                ].map(item => (
                  <div key={item.label} className="bg-[var(--color-surface)] p-3 text-center">
                    <div className="text-xs text-[var(--color-text-muted)] mb-0.5">{item.label}</div>
                    <div className={`font-semibold text-sm ${item.cls}`}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Charges list */}
              <div className="flex-1 overflow-y-auto">
                {chargesLoading
                  ? <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
                  : charges.length === 0
                  ? (
                      <div className="flex flex-col items-center justify-center p-8 text-center">
                        <FileText className="w-8 h-8 text-[var(--color-text-muted)] opacity-40 mb-2" />
                        <p className="text-sm text-[var(--color-text-secondary)]">No charges yet</p>
                        <button onClick={() => setShowAddCharge(true)} className="btn-primary mt-3 text-sm">
                          <Plus className="w-4 h-4" /> Add First Charge
                        </button>
                      </div>
                    )
                  : (
                      <div className="divide-y divide-[var(--color-border)]">
                        {charges.map(ch => (
                          <div key={ch.id} className="p-3 flex items-start gap-3 hover:bg-[var(--color-border-light)] transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{ch.service_name}</div>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {ch.charge_type} • {fmtDate(ch.charge_date)} • Qty: {ch.quantity}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-semibold text-sm">{fmtTaka(ch.total)}</div>
                              <div className="text-xs text-[var(--color-text-muted)]">@ {fmtTaka(ch.rate)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                }
              </div>

              {/* Print button */}
              <div className="p-3 border-t border-[var(--color-border)]">
                <button className="btn-secondary w-full text-sm">
                  <Printer className="w-4 h-4" /> Print Bill
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── ADD CHARGE MODAL ─── */}
      {showAddCharge && selectedPatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">Add Charge — {selectedPatient.patient_name}</h3>
              <button onClick={() => setShowAddCharge(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddCharge} className="p-5 space-y-4">
              <div>
                <label className="label">{t('billing.service_item_')}</label>
                <input className="input" required placeholder={t("billing.eg_xray_chest_bed_charge")}
                  value={addForm.service_name} onChange={e => setAddForm(f => ({ ...f, service_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('billing.charge_type')}</label>
                <select className="input" value={addForm.charge_type}
                  onChange={e => setAddForm(f => ({ ...f, charge_type: e.target.value }))}>
                  {CHARGE_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('billing.quantity_')}</label>
                  <input className="input" type="number" min="0.01" step="0.01" required
                    value={addForm.quantity} onChange={e => setAddForm(f => ({ ...f, quantity: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('billing.rate_')}</label>
                  <input className="input" type="number" min="0" step="0.01" required
                    value={addForm.rate} onChange={e => setAddForm(f => ({ ...f, rate: e.target.value }))} />
                </div>
              </div>
              {addForm.quantity && addForm.rate && (
                <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-border-light)] rounded-lg p-2">
                  Total: <strong>{fmtTaka(parseFloat(addForm.quantity) * parseFloat(addForm.rate))}</strong>
                </p>
              )}
              <div>
                <label className="label">{t('billing.date')}</label>
                <input className="input" type="date"
                  value={addForm.charge_date} onChange={e => setAddForm(f => ({ ...f, charge_date: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAddCharge(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? 'Adding…' : 'Add Charge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
