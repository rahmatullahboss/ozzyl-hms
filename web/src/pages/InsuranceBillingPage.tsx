import { useState, useEffect } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, FileText, Clock, CheckCircle, AlertTriangle, DollarSign,
  Plus, Search, Filter, Users, Building2, Activity, BarChart3,
  Settings, X, Loader2, ChevronDown, RefreshCw, Eye
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InsurancePatient {
  patient_id: number;
  patient_name: string;
  patient_code: string;
  mobile?: string;
  scheme_name?: string;
  total_provisional: number;
  item_count: number;
}

interface InsuranceClaim {
  id: number;
  claim_no: string;
  patient_name: string;
  patient_code: string;
  provider_name?: string;
  bill_amount: number;
  claimed_amount: number;
  approved_amount?: number;
  status: string;
  submitted_at: string;
  reviewed_at?: string;
  settled_at?: string;
  diagnosis?: string;
}

interface ClaimItem {
  id: number;
  service_code?: string;
  description?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  covered_amount: number;
  patient_payable: number;
}

interface ClaimDetail extends InsuranceClaim {
  items: ClaimItem[];
}

interface SsfPatient {
  id: number;
  patient_name: string;
  patient_code: string;
  gender?: string;
  ssf_policy_no?: string;
  ssf_scheme_code?: string;
  member_no?: string;
  claim_code?: string;
  claim_status: string;
}

interface SsfInvoice {
  id: number;
  patient_name?: string;
  patient_code?: string;
  invoice_date: string;
  total_amount: number;
  claimed_amount: number;
  invoice_status: string;
  remarks?: string;
}

interface SsfSettings {
  id: number;
  ssf_api_url?: string;
  ssf_api_code?: string;
  hosp_code?: string;
  username?: string;
  password?: string;
  is_active: number;
}

interface InsuranceCompany {
  id: number;
  company_name: string;
  insurance_type?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  payer_id?: string;
  is_active: number;
}

interface ClaimSummaryRow {
  provider_name: string;
  status: string;
  claim_count: number;
  total_claimed: number;
  total_approved: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTaka(n: number): string {
  return `৳${(n || 0).toLocaleString('en-BD')}`;
}
function fmtDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  submitted: { label: 'Submitted', color: 'var(--color-blue-100)' },
  under_review: { label: 'Under Review', color: 'var(--color-amber-100)' },
  approved: { label: 'Approved', color: 'var(--color-emerald-100)' },
  rejected: { label: 'Rejected', color: 'var(--color-red-100)' },
  settled: { label: 'Settled', color: 'var(--color-gray-100)' },
  pending: { label: 'Pending', color: 'var(--color-amber-100)' },
};

// ─── TABS ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'provisionals', label: 'Provisionals', icon: Clock },
  { key: 'pending', label: 'Pending Claims', icon: FileText },
  { key: 'submitted', label: 'Submitted Claims', icon: CheckCircle },
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'ssf', label: 'SSF', icon: Shield },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
] as const;

type TabKey = typeof TABS[number]['key'];

// ═══════════════════════════════════════════════════════════════════════════════
// PROVISIONALS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ProvisionalsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['billing-insurance', 'provisionals'],
    queryFn: () => api.get<{ data: InsurancePatient[] }>('/api/billing/insurance/patients/provisional'),
  });

  if (isLoading) return <LoadingSkeleton rows={5} />;

  const patients = data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <KpiCard label={t('totalPatients')} value={String(patients.length)} icon={<Users className="w-5 h-5" />} color="#3b82f6" />
        <KpiCard label={t('totalItems')} value={String(patients.reduce((s, p) => s + p.item_count, 0))} icon={<FileText className="w-5 h-5" />} color="#f59e0b" />
        <KpiCard label={t('totalAmount')} value={fmtTaka(patients.reduce((s, p) => s + p.total_provisional, 0))} icon={<DollarSign className="w-5 h-5" />} color="#10b981" />
      </div>

      {patients.length === 0 ? (
        <EmptyState icon={<Clock className="w-12 h-12" />} title={t('noProvisionalItems')} subtitle={t('noProvisionalItemsDesc')} />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('patient')}</th>
                <th>{t('code')}</th>
                <th>{t('scheme')}</th>
                <th>{t('items')}</th>
                <th style={{ textAlign: 'right' }}>{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.patient_id}>
                  <td style={{ fontWeight: 500 }}>{p.patient_name}</td>
                  <td><code style={{ fontSize: '0.8rem' }}>{p.patient_code}</code></td>
                  <td>{p.scheme_name || '—'}</td>
                  <td>{p.item_count}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtTaka(p.total_provisional)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAIMS TAB (shared for pending + submitted)
// ═══════════════════════════════════════════════════════════════════════════════

function ClaimsTab({ type }: { type: 'pending' | 'submitted' }) {
  const queryClient = useQueryClient();
  const [selectedClaim, setSelectedClaim] = useState<ClaimDetail | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['billing-insurance', 'claims', type],
    queryFn: () => api.get<{ data: InsuranceClaim[] }>(`/api/billing/insurance/claims/${type}`),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, remarks }: { id: number; status: string; remarks?: string }) =>
      api.put(`/api/billing/insurance/claim-records/${id}/status`, { status, remarks }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-insurance'] });
      toast.success(t('billing.claim_status_updated'));
    },
    onError: () => toast.error(t('billing.failed_to_update_claim')),
  });

  const viewDetail = async (id: number) => {
    try {
      const res = await api.get<{ data: ClaimDetail }>(`/api/billing/insurance/claim-records/${id}`);
      setSelectedClaim(res.data);
    } catch {
      toast.error(t('billing.failed_to_load_claim_detail'));
    }
  };

  if (isLoading) return <LoadingSkeleton rows={6} />;

  const claims = data?.data ?? [];
  const totalClaimed = claims.reduce((s, c) => s + (c.claimed_amount || 0), 0);
  const totalApproved = claims.reduce((s, c) => s + (c.approved_amount || 0), 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <KpiCard label="Total Claims" value={String(claims.length)} icon={<FileText className="w-5 h-5" />} color="#3b82f6" />
        <KpiCard label="Total Claimed" value={fmtTaka(totalClaimed)} icon={<DollarSign className="w-5 h-5" />} color="#f59e0b" />
        <KpiCard label="Total Approved" value={fmtTaka(totalApproved)} icon={<CheckCircle className="w-5 h-5" />} color="#10b981" />
      </div>

      {claims.length === 0 ? (
        <EmptyState icon={<FileText className="w-12 h-12" />} title={`No ${type === 'pending' ? 'Pending' : 'Submitted'} Claims`} subtitle="No claims found for this status." />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Claim #</th>
                <th>Patient</th>
                <th>Provider</th>
                <th style={{ textAlign: 'right' }}>Claimed</th>
                <th style={{ textAlign: 'right' }}>Approved</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map(c => (
                <tr key={c.id}>
                  <td><code style={{ fontSize: '0.8rem' }}>{c.claim_no}</code></td>
                  <td style={{ fontWeight: 500 }}>{c.patient_name}</td>
                  <td>{c.provider_name || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtTaka(c.claimed_amount)}</td>
                  <td style={{ textAlign: 'right' }}>{c.approved_amount != null ? fmtTaka(c.approved_amount) : '—'}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td style={{ fontSize: '0.85rem' }}>{fmtDate(c.submitted_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn-icon" title="View" onClick={() => viewDetail(c.id)}>
                        <Eye className="w-4 h-4" />
                      </button>
                      {type === 'pending' && (
                        <>
                          <button className="btn-icon" title="Approve"
                            onClick={() => statusMutation.mutate({ id: c.id, status: 'approved' })}
                            style={{ color: 'var(--color-emerald-600)' }}>
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button className="btn-icon" title="Reject"
                            onClick={() => { if (!confirm('Are you sure you want to reject this claim?')) return; statusMutation.mutate({ id: c.id, status: 'rejected', remarks: 'Rejected by reviewer' }); }}
                            style={{ color: 'var(--color-red-600)' }}>
                            <AlertTriangle className="w-4 h-4" />
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
      )}

      {/* Claim Detail Modal */}
      {selectedClaim && (
        <div className="modal-overlay" onClick={() => setSelectedClaim(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <div className="modal-header">
              <h3>Claim {selectedClaim.claim_no}</h3>
              <button className="btn-icon" onClick={() => setSelectedClaim(null)}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div><span className="text-muted">Patient:</span> <strong>{selectedClaim.patient_name}</strong></div>
                <div><span className="text-muted">Provider:</span> {selectedClaim.provider_name || '—'}</div>
                <div><span className="text-muted">Claimed:</span> <strong>{fmtTaka(selectedClaim.claimed_amount)}</strong></div>
                <div><span className="text-muted">Approved:</span> <strong>{selectedClaim.approved_amount != null ? fmtTaka(selectedClaim.approved_amount) : '—'}</strong></div>
                <div><span className="text-muted">Status:</span> <StatusBadge status={selectedClaim.status} /></div>
                <div><span className="text-muted">Date:</span> {fmtDate(selectedClaim.submitted_at)}</div>
              </div>
              {selectedClaim.items.length > 0 && (
                <>
                  <h4 style={{ marginBottom: '0.75rem', fontSize: '0.95rem' }}>Claim Items</h4>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>Description</th>
                          <th>Qty</th>
                          <th style={{ textAlign: 'right' }}>Price</th>
                          <th style={{ textAlign: 'right' }}>Covered</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedClaim.items.map(item => (
                          <tr key={item.id}>
                            <td><code>{item.service_code || '—'}</code></td>
                            <td>{item.description || '—'}</td>
                            <td>{item.quantity}</td>
                            <td style={{ textAlign: 'right' }}>{fmtTaka(item.unit_price)}</td>
                            <td style={{ textAlign: 'right' }}>{fmtTaka(item.covered_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANIES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function CompaniesTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ company_name: '', insurance_type: '', phone: '', email: '', city: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['billing-insurance', 'companies'],
    queryFn: () => api.get<{ data: InsuranceCompany[] }>('/api/billing/insurance/companies'),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, string>) => api.post('/api/billing/insurance/companies', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-insurance', 'companies'] });
      toast.success(t('billing.company_created'));
      setShowForm(false);
      setForm({ company_name: '', insurance_type: '', phone: '', email: '', city: '' });
    },
    onError: () => toast.error(t('billing.failed_to_create_company')),
  });

  if (isLoading) return <LoadingSkeleton rows={4} />;
  const companies = data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p className="text-muted">{companies.length} insurance companies</p>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4" /> Add Company
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <input className="input" placeholder={t("billing.company_name_")} value={form.company_name}
              onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
            <select className="input" value={form.insurance_type}
              onChange={e => setForm(f => ({ ...f, insurance_type: e.target.value }))}>
              <option value="">Select Type</option>
              <option value="health">Health</option>
              <option value="life">Life</option>
              <option value="government">Government</option>
              <option value="corporate">Corporate</option>
            </select>
            <input className="input" placeholder={t("billing.phone")} value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <input className="input" placeholder={t("billing.email")} value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input className="input" placeholder={t("billing.city")} value={form.city}
              onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
              <button className="btn-primary" disabled={!form.company_name || createMutation.isPending}
                onClick={() => createMutation.mutate(form)}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {companies.length === 0 ? (
        <EmptyState icon={<Building2 className="w-12 h-12" />} title="No Companies" subtitle="Add insurance companies to get started." />
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company Name</th>
                <th>Type</th>
                <th>City</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Payer ID</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 500 }}>{c.company_name}</td>
                  <td><span className="badge">{c.insurance_type || '—'}</span></td>
                  <td>{c.city || '—'}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td><code style={{ fontSize: '0.8rem' }}>{c.payer_id || '—'}</code></td>
                  <td>{c.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-muted">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSF TAB
// ═══════════════════════════════════════════════════════════════════════════════

const SSF_SUB_TABS = [
  { key: 'patients', label: 'Patients' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'settings', label: 'Settings' },
] as const;

type SsfSubTab = typeof SSF_SUB_TABS[number]['key'];

function SsfTab() {
  const [subTab, setSubTab] = useState<SsfSubTab>('patients');
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [editingPatient, setEditingPatient] = useState<SsfPatient | null>(null);
  const queryClient = useQueryClient();

  // ── Queries ──
  const { data: patientsData, isLoading: loadingPatients } = useQuery({
    queryKey: ['billing-insurance', 'ssf'],
    queryFn: () => api.get<{ data: SsfPatient[] }>('/api/billing/insurance/ssf/patients'),
  });
  const patients = patientsData?.data ?? [];

  const { data: invoicesData, isLoading: loadingInvoices } = useQuery({
    queryKey: ['billing-insurance', 'ssf-invoices'],
    queryFn: () => api.get<{ data: SsfInvoice[] }>('/api/billing/insurance/ssf/invoices'),
    enabled: subTab === 'invoices',
  });
  const invoices = invoicesData?.data ?? [];

  const { data: settingsData, isLoading: loadingSettings } = useQuery({
    queryKey: ['billing-insurance', 'ssf-settings'],
    queryFn: () => api.get<{ data: SsfSettings[] }>('/api/billing/insurance/ssf/settings'),
    enabled: subTab === 'settings',
  });
  const settings = settingsData?.data ?? [];

  // ── Mutations ──
  const addPatientMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/api/billing/insurance/ssf/patients', payload),
    onSuccess: () => { toast.success('SSF patient added'); setShowPatientModal(false); queryClient.invalidateQueries({ queryKey: ['billing-insurance', 'ssf'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const updatePatientMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.put(`/api/billing/insurance/ssf/patients/${id}`, body),
    onSuccess: () => { toast.success('SSF patient updated'); setShowPatientModal(false); setEditingPatient(null); queryClient.invalidateQueries({ queryKey: ['billing-insurance', 'ssf'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const addInvoiceMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/api/billing/insurance/ssf/invoices', payload),
    onSuccess: () => { toast.success('Invoice created'); setShowInvoiceModal(false); queryClient.invalidateQueries({ queryKey: ['billing-insurance', 'ssf-invoices'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post('/api/billing/insurance/ssf/settings', payload),
    onSuccess: () => { toast.success('Settings saved'); queryClient.invalidateQueries({ queryKey: ['billing-insurance', 'ssf-settings'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex gap-2 mb-4 border-b border-[var(--color-border)]">
        {SSF_SUB_TABS.map(st => (
          <button key={st.key} onClick={() => setSubTab(st.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${subTab === st.key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
            {st.label}
          </button>
        ))}
      </div>

      {/* ── PATIENTS SUB-TAB ── */}
      {subTab === 'patients' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', flex: 1, marginRight: '1rem' }}>
              <KpiCard label="SSF Patients" value={String(patients.length)} icon={<Users className="w-5 h-5" />} color="#6366f1" />
              <KpiCard label="Pending Claims" value={String(patients.filter(p => p.claim_status === 'pending').length)} icon={<Clock className="w-5 h-5" />} color="#f59e0b" />
              <KpiCard label="Processed" value={String(patients.filter(p => p.claim_status !== 'pending').length)} icon={<CheckCircle className="w-5 h-5" />} color="#10b981" />
            </div>
            <button onClick={() => { setEditingPatient(null); setShowPatientModal(true); }} className="btn-primary text-sm flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add Patient
            </button>
          </div>

          {loadingPatients ? <LoadingSkeleton rows={4} /> : patients.length === 0 ? (
            <EmptyState icon={<Shield className="w-12 h-12" />} title="No SSF Patients" description="No SSF-enrolled patients found." action={<button onClick={() => setShowPatientModal(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> Add First Patient</button>} />
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Patient</th><th>Code</th><th>SSF Policy #</th><th>Scheme</th><th>Member #</th><th>Claim Code</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {patients.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.patient_name}</td>
                      <td><code style={{ fontSize: '0.8rem' }}>{p.patient_code}</code></td>
                      <td>{p.ssf_policy_no || '—'}</td>
                      <td>{p.ssf_scheme_code || '—'}</td>
                      <td>{p.member_no || '—'}</td>
                      <td><code>{p.claim_code || '—'}</code></td>
                      <td><StatusBadge status={p.claim_status} /></td>
                      <td><button onClick={() => { setEditingPatient(p); setShowPatientModal(true); }} className="btn-ghost text-xs">Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── INVOICES SUB-TAB ── */}
      {subTab === 'invoices' && (
        <div>
          <div className="flex justify-between items-center mb-3">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', flex: 1, marginRight: '1rem' }}>
              <KpiCard label="Total Invoices" value={String(invoices.length)} icon={<FileText className="w-5 h-5" />} color="#3b82f6" />
              <KpiCard label="Total Claimed" value={fmtTaka(invoices.reduce((s, i) => s + i.claimed_amount, 0))} icon={<DollarSign className="w-5 h-5" />} color="#10b981" />
              <KpiCard label="Pending" value={String(invoices.filter(i => i.invoice_status === 'pending').length)} icon={<Clock className="w-5 h-5" />} color="#f59e0b" />
            </div>
            <button onClick={() => setShowInvoiceModal(true)} className="btn-primary text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> New Invoice</button>
          </div>
          {loadingInvoices ? <LoadingSkeleton rows={4} /> : invoices.length === 0 ? (
            <EmptyState icon={<FileText className="w-12 h-12" />} title="No Invoices" description="No SSF invoices found." action={<button onClick={() => setShowInvoiceModal(true)} className="btn-primary mt-2"><Plus className="w-4 h-4" /> Create Invoice</button>} />
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Patient</th><th>Date</th><th>Total</th><th>Claimed</th><th>Status</th><th>Remarks</th></tr></thead>
                <tbody>
                  {invoices.map(i => (
                    <tr key={i.id}>
                      <td style={{ fontWeight: 500 }}>{i.patient_name ?? '—'}</td>
                      <td>{fmtDate(i.invoice_date)}</td>
                      <td>{fmtTaka(i.total_amount)}</td>
                      <td>{fmtTaka(i.claimed_amount)}</td>
                      <td><StatusBadge status={i.invoice_status} /></td>
                      <td>{i.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS SUB-TAB ── */}
      {subTab === 'settings' && (
        <SsfSettingsPanel settings={settings[0] ?? null} loading={loadingSettings} onSave={(body) => saveSettingsMutation.mutate(body)} isSaving={saveSettingsMutation.isPending} />
      )}

      {/* Patient Modal */}
      {showPatientModal && (
        <SsfPatientModal
          initial={editingPatient}
          onClose={() => { setShowPatientModal(false); setEditingPatient(null); }}
          onSubmit={(body) => editingPatient ? updatePatientMutation.mutate({ id: editingPatient.id, body }) : addPatientMutation.mutate(body)}
          isSubmitting={addPatientMutation.isPending || updatePatientMutation.isPending}
        />
      )}

      {/* Invoice Modal */}
      {showInvoiceModal && (
        <SsfInvoiceModal
          patients={patients}
          onClose={() => setShowInvoiceModal(false)}
          onSubmit={(body) => addInvoiceMutation.mutate(body)}
          isSubmitting={addInvoiceMutation.isPending}
        />
      )}
    </div>
  );
}

function SsfSettingsPanel({ settings, loading, onSave, isSaving }: { settings: SsfSettings | null; loading: boolean; onSave: (b: Record<string, string>) => void; isSaving: boolean }) {
  const [form, setForm] = useState({
    ssf_api_url: settings?.ssf_api_url ?? '',
    ssf_api_code: settings?.ssf_api_code ?? '',
    hosp_code: settings?.hosp_code ?? '',
    username: settings?.username ?? '',
    password: settings?.password ?? '',
  });
  useEffect(() => {
    if (settings) setForm({ ssf_api_url: settings.ssf_api_url ?? '', ssf_api_code: settings.ssf_api_code ?? '', hosp_code: settings.hosp_code ?? '', username: settings.username ?? '', password: settings.password ?? '' });
  }, [settings]);
  if (loading) return <LoadingSkeleton rows={3} />;
  return (
    <div className="card p-5 max-w-lg space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Settings className="w-4 h-4" /> SSF API Configuration</h3>
      <div className="grid grid-cols-1 gap-3">
        <div><label className="label">SSF API URL</label><input className="input w-full" value={form.ssf_api_url} onChange={e => setForm(f => ({ ...f, ssf_api_url: e.target.value }))} placeholder="https://ssf.gov.bd/api" /></div>
        <div><label className="label">API Code</label><input className="input w-full" value={form.ssf_api_code} onChange={e => setForm(f => ({ ...f, ssf_api_code: e.target.value }))} placeholder="API authorization code" /></div>
        <div><label className="label">Hospital Code</label><input className="input w-full" value={form.hosp_code} onChange={e => setForm(f => ({ ...f, hosp_code: e.target.value }))} placeholder="Registered hospital code" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Username</label><input className="input w-full" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="SSF username" /></div>
          <div><label className="label">Password</label><input type="password" className="input w-full" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="SSF password" /></div>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={() => onSave(form)} disabled={isSaving} className="btn-primary text-sm">{isSaving ? 'Saving...' : 'Save Settings'}</button>
      </div>
    </div>
  );
}

function SsfPatientModal({ initial, onClose, onSubmit, isSubmitting }: { initial: SsfPatient | null; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void; isSubmitting: boolean }) {
  const [form, setForm] = useState({ patient_id: '', ssf_policy_no: '', ssf_scheme_code: '', member_no: '', claim_code: '', claim_status: 'pending' });
  useEffect(() => {
    if (initial) setForm({ patient_id: String(initial.id), ssf_policy_no: initial.ssf_policy_no ?? '', ssf_scheme_code: initial.ssf_scheme_code ?? '', member_no: initial.member_no ?? '', claim_code: initial.claim_code ?? '', claim_status: initial.claim_status });
  }, [initial]);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-semibold">{initial ? 'Edit SSF Patient' : 'Add SSF Patient'}</h3>
        {!initial && <div><label className="label">Patient ID *</label><input className="input w-full" value={form.patient_id} onChange={e => setForm(f => ({ ...f, patient_id: e.target.value }))} placeholder="Enter patient ID" /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Policy #</label><input className="input w-full" value={form.ssf_policy_no} onChange={e => setForm(f => ({ ...f, ssf_policy_no: e.target.value }))} placeholder="SSF Policy No" /></div>
          <div><label className="label">Scheme Code</label><input className="input w-full" value={form.ssf_scheme_code} onChange={e => setForm(f => ({ ...f, ssf_scheme_code: e.target.value }))} placeholder="Scheme code" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Member #</label><input className="input w-full" value={form.member_no} onChange={e => setForm(f => ({ ...f, member_no: e.target.value }))} placeholder="Member number" /></div>
          <div><label className="label">Claim Code</label><input className="input w-full" value={form.claim_code} onChange={e => setForm(f => ({ ...f, claim_code: e.target.value }))} placeholder="Claim code" /></div>
        </div>
        <div><label className="label">Claim Status</label><select className="input w-full" value={form.claim_status} onChange={e => setForm(f => ({ ...f, claim_status: e.target.value }))}>
          <option value="pending">Pending</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="settled">Settled</option>
        </select></div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button onClick={() => onSubmit({ ...form, patient_id: Number(form.patient_id) })} disabled={isSubmitting} className="btn btn-primary text-sm">{isSubmitting ? 'Saving...' : initial ? 'Update' : 'Add'}</button>
        </div>
      </div>
    </div>
  );
}

function SsfInvoiceModal({ patients, onClose, onSubmit, isSubmitting }: { patients: SsfPatient[]; onClose: () => void; onSubmit: (b: Record<string, unknown>) => void; isSubmitting: boolean }) {
  const [form, setForm] = useState({ patient_id: '', ssf_patient_id: '', total_amount: '', claimed_amount: '', invoice_status: 'pending', remarks: '' });
  const selectedPatient = patients.find(p => String(p.id) === form.ssf_patient_id);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-semibold">New SSF Invoice</h3>
        <div><label className="label">SSF Patient *</label>
          <select className="input w-full" value={form.ssf_patient_id} onChange={e => { const spid = e.target.value; const sp = patients.find(p => String(p.id) === spid); setForm(f => ({ ...f, ssf_patient_id: spid, patient_id: sp ? String(sp.id) : '' })); }}>
            <option value="">Select patient</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.patient_name} ({p.patient_code})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Total Amount *</label><input type="number" className="input w-full" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} placeholder="0.00" /></div>
          <div><label className="label">Claimed Amount *</label><input type="number" className="input w-full" value={form.claimed_amount} onChange={e => setForm(f => ({ ...f, claimed_amount: e.target.value }))} placeholder="0.00" /></div>
        </div>
        <div><label className="label">Status</label><select className="input w-full" value={form.invoice_status} onChange={e => setForm(f => ({ ...f, invoice_status: e.target.value }))}>
          <option value="pending">Pending</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="paid">Paid</option>
        </select></div>
        <div><label className="label">Remarks</label><textarea className="input w-full" rows={2} value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" /></div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button onClick={() => onSubmit({ patient_id: Number(form.patient_id), ssf_patient_id: form.ssf_patient_id ? Number(form.ssf_patient_id) : undefined, total_amount: Number(form.total_amount), claimed_amount: Number(form.claimed_amount), invoice_status: form.invoice_status, remarks: form.remarks || undefined })} disabled={isSubmitting || !form.ssf_patient_id || !form.total_amount} className="btn btn-primary text-sm">{isSubmitting ? 'Saving...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function ReportsTab() {
  const [reportType, setReportType] = useState<'claim-summary' | 'patient-credit'>('claim-summary');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['billing-insurance', 'reports', reportType],
    queryFn: () => api.get<{ data: ClaimSummaryRow[] }>(`/api/billing/insurance/reports/${reportType}`),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center' }}>
        <select className="input" value={reportType} onChange={e => setReportType(e.target.value as 'claim-summary' | 'patient-credit')}
          style={{ maxWidth: '300px' }}>
          <option value="claim-summary">Claim Summary by Provider</option>
          <option value="patient-credit">Patient Credit Report</option>
        </select>
        <button className="btn-secondary" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {isLoading ? <LoadingSkeleton rows={5} /> : rows.length === 0 ? (
        <EmptyState icon={<BarChart3 className="w-12 h-12" />} title="No Report Data" subtitle="No data available for this report." />
      ) : reportType === 'claim-summary' ? (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Count</th>
                <th style={{ textAlign: 'right' }}>Total Claimed</th>
                <th style={{ textAlign: 'right' }}>Total Approved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{r.provider_name || '—'}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.claim_count}</td>
                  <td style={{ textAlign: 'right' }}>{fmtTaka(r.total_claimed)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtTaka(r.total_approved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Code</th>
                <th>Provider</th>
                <th>Claims</th>
                <th style={{ textAlign: 'right' }}>Billed</th>
                <th style={{ textAlign: 'right' }}>Approved</th>
                <th style={{ textAlign: 'right' }}>Credit Balance</th>
              </tr>
            </thead>
            <tbody>
              {(rows as unknown as Array<{ patient_name: string; patient_code: string; provider_name: string; claim_count: number; total_billed: number; total_approved: number; credit_balance: number }>).map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>{r.patient_name}</td>
                  <td><code style={{ fontSize: '0.8rem' }}>{r.patient_code}</code></td>
                  <td>{r.provider_name || '—'}</td>
                  <td>{r.claim_count}</td>
                  <td style={{ textAlign: 'right' }}>{fmtTaka(r.total_billed)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtTaka(r.total_approved)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: r.credit_balance > 0 ? 'var(--color-red-600)' : 'var(--color-emerald-600)' }}>{fmtTaka(r.credit_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, color: 'var(--color-gray-100)' };
  return <span className="badge" style={{ textTransform: 'capitalize' }}>{cfg.label}</span>;
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '2px' }}>{label}</div>
        <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, subtitle, description, action }: { icon: React.ReactNode; title: string; subtitle?: string; description?: string; action?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
      <div style={{ opacity: 0.3, marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <h4 style={{ marginBottom: '0.25rem' }}>{title}</h4>
      <p style={{ fontSize: '0.9rem' }}>{description ?? subtitle}</p>
      {action && <div style={{ marginTop: '1rem' }}>{action}</div>}
    </div>
  );
}

function LoadingSkeleton({ rows }: { rows: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: '48px', borderRadius: '8px' }} />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const TAB_MAP: Record<TabKey, React.FC> = {
  provisionals: ProvisionalsTab,
  pending: () => <ClaimsTab type="pending" />,
  submitted: () => <ClaimsTab type="submitted" />,
  companies: CompaniesTab,
  ssf: SsfTab,
  reports: ReportsTab,
};

export default function InsuranceBillingPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['billing', 'common']);
  const [activeTab, setActiveTab] = useState<TabKey>('provisionals');

  const ActiveComponent = TAB_MAP[activeTab];

  return (
    <DashboardLayout role={role}>
      <div style={{ padding: '1.5rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Shield className="w-6 h-6" style={{ color: 'var(--color-primary)' }} />
              {t('insuranceBilling')}
            </h1>
            <p className="text-muted" style={{ marginTop: '0.25rem' }}>
              {t('insuranceBillingSubtitle')}
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', overflowX: 'auto' }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '0.75rem 1.25rem',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  border: 'none', background: 'none', cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                  borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  fontSize: '0.9rem',
                }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <ActiveComponent />
      </div>
    </DashboardLayout>
  );
}
