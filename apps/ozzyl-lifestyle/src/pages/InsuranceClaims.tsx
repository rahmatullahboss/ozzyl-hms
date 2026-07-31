import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Search, FileText, AlertTriangle, CheckCircle, Clock, Plus, Filter, DollarSign, X, Loader2 } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'settled';

interface Claim {
  id: number;
  claim_no: string;
  patient_name: string;
  patient_code: string;
  provider_name: string;
  policy_no?: string;
  policy_type?: string;
  bill_amount: number;
  claimed_amount: number;
  approved_amount: number | null;
  rejection_reason?: string;
  status: ClaimStatus;
  submitted_at: string;
  settled_at?: string;
  diagnosis?: string;
  icd10_code?: string;
}

interface ClaimsResponse {
  claims: Claim[];
  pagination: { total: number; page: number; per_page: number };
}

interface Patient {
  id: number;
  name: string;
  patient_code: string;
}

const STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string; icon: React.ReactNode }> = {
  submitted:    { label: 'Submitted',    color: 'bg-blue-100 text-blue-700',       icon: <FileText className="w-3.5 h-3.5" /> },
  under_review: { label: 'Under Review', color: 'bg-amber-100 text-amber-700',    icon: <Clock className="w-3.5 h-3.5" /> },
  approved:     { label: 'Approved',     color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  rejected:     { label: 'Rejected',     color: 'bg-red-100 text-red-700',        icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  settled:      { label: 'Settled',      color: 'bg-gray-100 text-gray-700',      icon: <DollarSign className="w-3.5 h-3.5" /> },
};

function fmtTaka(n: number): string {
  return `৳${n.toLocaleString('en-BD')}`;
}
function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── New Claim Form ───────────────────────────────────────────────────────────
interface NewClaimForm {
  patient_id:     string;
  policy_id:      string;
  bill_id:        string;
  diagnosis:      string;
  icd10_code:     string;
  bill_amount:    string;
  claimed_amount: string;
}

const INITIAL_FORM: NewClaimForm = {
  patient_id: '', policy_id: '', bill_id: '',
  diagnosis: '', icd10_code: '',
  bill_amount: '', claimed_amount: '',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function InsuranceClaims({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['billing', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewClaimForm>(INITIAL_FORM);
  const [formError, setFormError] = useState('');

  // ─── Fetch claims ─────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<ClaimsResponse>({
    queryKey: ['insurance-claims', statusFilter],
    queryFn: () => api.get<ClaimsResponse>(`/api/insurance/claims?status=${statusFilter}&per_page=50`),
  });

  // ─── Fetch patients for new claim form ───────────────────────────────
  const { data: patientsData } = useQuery<{ patients: Patient[] }>({
    queryKey: ['patients-lite'],
    queryFn: () => api.get<{ patients: Patient[] }>('/api/patients?per_page=200'),
    enabled: showForm,
  });

  // ─── Submit new claim mutation ────────────────────────────────────────
  const submitClaim = useMutation({
    mutationFn: (payload: object) => api.post('/api/insurance/claims', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-claims'] });
      setShowForm(false);
      setForm(INITIAL_FORM);
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const handleSubmit = () => {
    setFormError('');
    const billAmt    = Number(form.bill_amount)    * 100; // convert to paisa
    const claimedAmt = Number(form.claimed_amount) * 100;
    if (!form.patient_id || !form.bill_amount || !form.claimed_amount) {
      setFormError('Patient, Bill Amount, and Claimed Amount are required.');
      return;
    }
    if (claimedAmt > billAmt) {
      setFormError('Claimed amount cannot exceed bill amount.');
      return;
    }
    submitClaim.mutate({
      patient_id:     Number(form.patient_id),
      policy_id:      form.policy_id ? Number(form.policy_id) : undefined,
      bill_id:        form.bill_id   ? Number(form.bill_id)   : undefined,
      diagnosis:      form.diagnosis || undefined,
      icd10_code:     form.icd10_code || undefined,
      bill_amount:    billAmt,
      claimed_amount: claimedAmt,
    });
  };

  // ─── Filtered display ─────────────────────────────────────────────────
  const claims = data?.claims ?? [];
  const filtered = claims.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.claim_no.toLowerCase().includes(q) ||
      c.patient_name?.toLowerCase().includes(q) ||
      c.provider_name?.toLowerCase().includes(q)
    );
  });

  const totalClaimed  = claims.reduce((s, c) => s + c.claimed_amount, 0);
  const totalApproved = claims.reduce((s, c) => s + (c.approved_amount ?? 0), 0);
  const pendingCount  = claims.filter((c) => ['submitted', 'under_review'].includes(c.status)).length;
  const settledCount  = claims.filter((c) => c.status === 'settled').length;

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">
                {t('insuranceClaims', { ns: 'billing', defaultValue: 'Insurance Claims' })}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Insurance Claims Management</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Submit and track insurance claims</p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Claim
          </button>
        </div>

        {/* New Claim Form */}
        {showForm && (
          <div className="card p-5 border border-[var(--color-primary)] relative">
            <button
              onClick={() => { setShowForm(false); setForm(INITIAL_FORM); setFormError(''); }}
              className="absolute top-3 right-3 text-[var(--color-text-muted)] hover:text-red-500"
            >
              <X className="w-4 h-4" />
            </button>
            <h2 className="font-semibold mb-4">Submit New Insurance Claim</h2>

            {formError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Patient */}
              <div>
                <label className="block text-xs font-medium mb-1">Patient *</label>
                <select
                  value={form.patient_id}
                  onChange={(e) => setForm((f) => ({ ...f, patient_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                >
                  <option value="">Select patient…</option>
                  {patientsData?.patients?.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} ({p.patient_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Diagnosis */}
              <div>
                <label className="block text-xs font-medium mb-1">Diagnosis</label>
                <input
                  type="text"
                  value={form.diagnosis}
                  onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  placeholder={t("common.eg_dengue_fever_appendectomy")}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>

              {/* ICD-10 Code */}
              <div>
                <label className="block text-xs font-medium mb-1">ICD-10 Code</label>
                <input
                  type="text"
                  value={form.icd10_code}
                  onChange={(e) => setForm((f) => ({ ...f, icd10_code: e.target.value }))}
                  placeholder={t("common.eg_a90_k37")}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>

              {/* Bill ID */}
              <div>
                <label className="block text-xs font-medium mb-1">Bill ID (optional)</label>
                <input
                  type="number"
                  value={form.bill_id}
                  onChange={(e) => setForm((f) => ({ ...f, bill_id: e.target.value }))}
                  placeholder={t("common.link_to_existing_bill")}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>

              {/* Bill Amount */}
              <div>
                <label className="block text-xs font-medium mb-1">Total Bill Amount (৳) *</label>
                <input
                  type="number"
                  min="0"
                  value={form.bill_amount}
                  onChange={(e) => setForm((f) => ({ ...f, bill_amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>

              {/* Claimed Amount */}
              <div>
                <label className="block text-xs font-medium mb-1">Claimed Amount (৳) *</label>
                <input
                  type="number"
                  min="0"
                  value={form.claimed_amount}
                  onChange={(e) => setForm((f) => ({ ...f, claimed_amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowForm(false); setForm(INITIAL_FORM); }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitClaim.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {submitClaim.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Submit Claim
              </button>
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Claimed',  value: fmtTaka(totalClaimed / 100),  color: 'text-blue-600' },
            { label: 'Total Approved', value: fmtTaka(totalApproved / 100), color: 'text-emerald-600' },
            { label: 'Pending',        value: pendingCount,            color: 'text-amber-600' },
            { label: 'Settled',        value: settledCount,            color: 'text-gray-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4 text-center">
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.search_by_claim_patient_or_provider")}
              className="w-full pl-9 pr-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
            >
              <option value="all">All Status</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Claims Table */}
        <div className="card overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
            </div>
          ) : isError ? (
            <div className="text-center py-12 text-red-500">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
              <p>Failed to load claims. Please try again.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                    <th className="text-left px-4 py-3">Claim No</th>
                    <th className="text-left px-4 py-3">Patient</th>
                    <th className="text-left px-4 py-3">Provider</th>
                    <th className="text-left px-4 py-3">Diagnosis</th>
                    <th className="text-right px-4 py-3">Claimed</th>
                    <th className="text-right px-4 py-3">Approved</th>
                    <th className="text-center px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-[var(--color-text-muted)]">
                        No claims found. Submit your first claim using the &ldquo;New Claim&rdquo; button.
                      </td>
                    </tr>
                  ) : filtered.map((c, i) => {
                    const sc = STATUS_CONFIG[c.status];
                    return (
                      <tr key={c.id} className={`border-b border-[var(--color-border)] hover:bg-[var(--color-bg)] transition ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                        <td className="px-4 py-3 font-mono text-xs font-medium">{c.claim_no}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{c.patient_name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{c.patient_code}</p>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.provider_name ?? '—'}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)] text-xs max-w-[200px] truncate">
                          {c.diagnosis || '—'}
                          {c.icd10_code && <span className="ml-1 font-mono opacity-60">({c.icd10_code})</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">{fmtTaka(c.claimed_amount / 100)}</td>
                        <td className="px-4 py-3 text-right">
                          {c.approved_amount !== null ? fmtTaka(c.approved_amount / 100) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>
                            {sc.icon} {sc.label}
                          </span>
                          {c.status === 'rejected' && c.rejection_reason && (
                            <p className="text-xs text-red-500 mt-0.5 max-w-[120px] truncate" title={c.rejection_reason}>
                              {c.rejection_reason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">{fmtDate(c.submitted_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-3 bg-[var(--color-bg)] border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                Showing {filtered.length} of {claims.length} claims
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
