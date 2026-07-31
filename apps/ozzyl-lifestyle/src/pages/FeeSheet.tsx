import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText, Search, Plus, X, ChevronDown, Save,
  Receipt, CalendarDays, User, Stethoscope, Trash2, RefreshCw,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Patient {
  id: number;
  patient_name: string;
  patient_code: string;
  mobile?: string;
}

interface LineItem {
  id: string; // local uuid
  ServiceCode: string;
  ServiceName: string;
  Units: number;
  UnitPrice: number;
}

interface Transaction {
  TransactionId: number;
  VisitDate: string;
  TotalCharges: number;
  BillingStatus: 'pending' | 'billed' | 'paid' | 'adjusted' | 'cancelled';
  PrimaryDiagnosis: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('hms_token')}`,
});

const today = () => new Date().toISOString().slice(0, 10);

const uid = () => Math.random().toString(36).slice(2);

const BILLING_STATUS_BADGE: Record<
  Transaction['BillingStatus'],
  { label: string; cls: string }
> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  billed:    { label: 'Billed',    cls: 'bg-blue-100  text-blue-700  dark:bg-blue-500/15  dark:text-blue-400'  },
  paid:      { label: 'Paid',      cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400' },
  adjusted:  { label: 'Adjusted',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-100   text-red-700   dark:bg-red-500/15   dark:text-red-400'   },
};

const EMPTY_LINE = (): LineItem => ({
  id: uid(),
  ServiceCode: '',
  ServiceName: '',
  Units: 1,
  UnitPrice: 0,
});

// ─── Component ──────────────────────────────────────────────────────────────

export default function FeeSheet({ role }: { role?: string }) {
  const { t } = useTranslation('billing');
  // Patient search
  const [patientQuery, setPatientQuery]       = useState('');
  const [patients, setPatients]               = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Transactions list
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading]       = useState(false);

  // New fee sheet form
  const [showForm, setShowForm]             = useState(false);
  const [visitDate, setVisitDate]           = useState(today());
  const [providerId, setProviderId]         = useState('');
  const [primaryDiagnosis, setPrimaryDiagnosis] = useState('');
  const [lineItems, setLineItems]           = useState<LineItem[]>([EMPTY_LINE()]);
  const [saving, setSaving]                 = useState(false);

  // Status update dropdown state
  const [statusMenuId, setStatusMenuId] = useState<number | null>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  // ── Patient search (debounced) ──────────────────────────────────────────
  useEffect(() => {
    if (patientQuery.length < 2) { setPatients([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      axios
        .get(`/api/patients?search=${encodeURIComponent(patientQuery)}&limit=10`, {
          headers: authHeaders(),
        })
        .then(r => setPatients(r.data.patients ?? []))
        .catch(() => setPatients([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [patientQuery]);

  // ── Load transactions when patient selected ─────────────────────────────
  const loadTransactions = useCallback(async (patientId: number) => {
    setTxLoading(true);
    try {
      const r = await axios.get(`/api/fee-sheet?patientId=${patientId}`, {
        headers: authHeaders(),
      });
      setTransactions(r.data.transactions ?? r.data ?? []);
    } catch {
      toast.error(t('billing.failed_to_load_fee_sheets'));
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPatient) loadTransactions(selectedPatient.id);
    else setTransactions([]);
  }, [selectedPatient, loadTransactions]);

  // ── Close status menu on outside click ─────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Line item helpers ───────────────────────────────────────────────────
  const updateLine = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems(prev =>
      prev.map(li => (li.id === id ? { ...li, [field]: value } : li)),
    );
  };

  const removeLine = (id: string) => {
    setLineItems(prev => prev.filter(li => li.id !== id));
  };

  const totalCharges = lineItems.reduce(
    (sum, li) => sum + li.Units * li.UnitPrice,
    0,
  );

  // ── Submit new fee sheet ────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedPatient) { toast.error(t('billing.select_a_patient_first')); return; }
    if (!visitDate)        { toast.error(t('billing.visit_date_is_required')); return; }
    if (lineItems.some(li => !li.ServiceName)) {
      toast.error(t('billing.all_line_items_must_have_a_service_name'));
      return;
    }

    setSaving(true);
    try {
      await axios.post(
        '/api/fee-sheet',
        {
          PatientId:        selectedPatient.id,
          VisitDate:        visitDate,
          ProviderId:       providerId ? Number(providerId) : undefined,
          PrimaryDiagnosis: primaryDiagnosis,
          LineItems:        lineItems.map(({ id: _id, ...rest }) => rest),
        },
        { headers: authHeaders() },
      );
      toast.success(t('billing.fee_sheet_created'));
      setShowForm(false);
      resetForm();
      loadTransactions(selectedPatient.id);
    } catch {
      toast.error(t('billing.failed_to_create_fee_sheet'));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setVisitDate(today());
    setProviderId('');
    setPrimaryDiagnosis('');
    setLineItems([EMPTY_LINE()]);
  };

  // ── Status update ───────────────────────────────────────────────────────
  const handleStatusUpdate = async (txId: number, status: Transaction['BillingStatus']) => {
    setStatusMenuId(null);
    try {
      await axios.put(
        `/api/fee-sheet/${txId}/status`,
        { Status: status },
        { headers: authHeaders() },
      );
      toast.success(t('billing.statusUpdated', { status }));
      if (selectedPatient) loadTransactions(selectedPatient.id);
    } catch {
      toast.error(t('billing.failed_to_update_status'));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <DashboardLayout role={role ?? 'staff'}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        {/* Page Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Receipt className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Fee Sheet</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Create and manage clinical fee sheets per visit</p>
            </div>
          </div>
        </div>

        {/* Patient Search */}
        <div className="card p-4">
          <p className="label mb-2">Patient</p>
          {selectedPatient ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[var(--color-text)]">{selectedPatient.patient_name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {selectedPatient.patient_code}
                  {selectedPatient.mobile ? ` · ${selectedPatient.mobile}` : ''}
                </p>
              </div>
              <button
                onClick={() => { setSelectedPatient(null); setPatientQuery(''); setTransactions([]); setShowForm(false); }}
                className="btn-ghost text-xs"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                value={patientQuery}
                onChange={e => setPatientQuery(e.target.value)}
                placeholder={t("billing.search_patient_by_name_or_code")}
                className="input pl-9 w-full max-w-sm"
              />
              {patients.length > 0 && (
                <div className="absolute z-20 left-0 top-full mt-1 w-full max-w-sm card py-1 shadow-xl border border-[var(--color-border)]">
                  {patients.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPatient(p); setPatients([]); setPatientQuery(''); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-bg-secondary)] transition-colors"
                    >
                      <p className="font-medium text-sm text-[var(--color-text)]">{p.patient_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{p.patient_code}{p.mobile ? ` · ${p.mobile}` : ''}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Transactions List */}
        {selectedPatient && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-text-muted)]" />
                <h2 className="section-title">Fee Sheet History</h2>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => loadTransactions(selectedPatient.id)}
                  className="btn-ghost p-2"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setShowForm(v => !v); resetForm(); }}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  New Fee Sheet
                </button>
              </div>
            </div>

            {/* New Fee Sheet Form */}
            {showForm && (
              <div className="p-5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <h3 className="font-semibold text-[var(--color-text)] mb-4">New Fee Sheet</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label">{t('billing.visit_date')}</label>
                    <input
                      type="date"
                      value={visitDate}
                      onChange={e => setVisitDate(e.target.value)}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="label">{t('billing.provider_id')}</label>
                    <input
                      type="number"
                      placeholder={t("billing.eg_12")}
                      value={providerId}
                      onChange={e => setProviderId(e.target.value)}
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="label">{t('billing.primary_diagnosis')}</label>
                    <input
                      type="text"
                      placeholder={t("billing.eg_j069_uri")}
                      value={primaryDiagnosis}
                      onChange={e => setPrimaryDiagnosis(e.target.value)}
                      className="input w-full"
                    />
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="label">Line Items</p>
                    <button
                      onClick={() => setLineItems(prev => [...prev, EMPTY_LINE()])}
                      className="btn-ghost text-xs flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Row
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                    <table className="table-base w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left px-3 py-2">Service Code</th>
                          <th className="text-left px-3 py-2">Service Name</th>
                          <th className="text-right px-3 py-2 w-20">Units</th>
                          <th className="text-right px-3 py-2 w-28">Unit Price</th>
                          <th className="text-right px-3 py-2 w-28">Total</th>
                          <th className="w-10 px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map(li => (
                          <tr key={li.id}>
                            <td className="px-3 py-1.5">
                              <input
                                value={li.ServiceCode}
                                onChange={e => updateLine(li.id, 'ServiceCode', e.target.value)}
                                placeholder={t("billing.svc001")}
                                className="input text-sm w-full"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                value={li.ServiceName}
                                onChange={e => updateLine(li.id, 'ServiceName', e.target.value)}
                                placeholder={t("billing.eg_cbc_test")}
                                className="input text-sm w-full"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="number"
                                min={1}
                                value={li.Units}
                                onChange={e => updateLine(li.id, 'Units', Math.max(1, Number(e.target.value)))}
                                className="input text-sm w-20 text-right"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={li.UnitPrice}
                                onChange={e => updateLine(li.id, 'UnitPrice', Number(e.target.value))}
                                className="input text-sm w-28 text-right"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium text-[var(--color-text)]">
                              {(li.Units * li.UnitPrice).toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                onClick={() => removeLine(li.id)}
                                disabled={lineItems.length === 1}
                                className="text-[var(--color-text-muted)] hover:text-red-500 disabled:opacity-30 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Total + Actions */}
                <div className="flex items-center justify-between pt-2">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Total Charges:
                    <span className="ml-2 text-lg font-bold text-[var(--color-text)]">
                      ৳{totalCharges.toFixed(2)}
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowForm(false); resetForm(); }}
                      className="btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmit}
                      disabled={saving}
                      className="btn-primary text-sm flex items-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? 'Saving…' : 'Save Fee Sheet'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Transactions Table */}
            {txLoading ? (
              <div className="flex items-center justify-center py-16 text-[var(--color-text-muted)]">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading…
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)] gap-2">
                <FileText className="w-8 h-8 opacity-30" />
                <p className="text-sm">No fee sheets found for this patient</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left px-4 py-3">ID</th>
                      <th className="text-left px-4 py-3">Visit Date</th>
                      <th className="text-left px-4 py-3">Primary Diagnosis</th>
                      <th className="text-right px-4 py-3">Total Charges</th>
                      <th className="text-center px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(tx => {
                      const badge = BILLING_STATUS_BADGE[tx.BillingStatus];
                      return (
                        <tr key={tx.TransactionId} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                            #{tx.TransactionId}
                          </td>
                          <td className="px-4 py-3 flex items-center gap-1.5 text-[var(--color-text)]">
                            <CalendarDays className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            {new Date(tx.VisitDate).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text)]">
                            {tx.PrimaryDiagnosis || <span className="text-[var(--color-text-muted)]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-[var(--color-text)]">
                            ৳{Number(tx.TotalCharges).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="relative inline-block" ref={statusMenuId === tx.TransactionId ? statusMenuRef : undefined}>
                              <button
                                onClick={() => setStatusMenuId(statusMenuId === tx.TransactionId ? null : tx.TransactionId)}
                                className="btn-ghost text-xs flex items-center gap-1"
                              >
                                Update Status <ChevronDown className="w-3 h-3" />
                              </button>
                              {statusMenuId === tx.TransactionId && (
                                <div className="absolute right-0 top-full mt-1 z-30 card min-w-[150px] py-1 shadow-xl border border-[var(--color-border)]">
                                  {(Object.keys(BILLING_STATUS_BADGE) as Transaction['BillingStatus'][]).map(s => (
                                    <button
                                      key={s}
                                      onClick={() => handleStatusUpdate(tx.TransactionId, s)}
                                      className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors flex items-center gap-2"
                                    >
                                      <span className={`inline-block w-2 h-2 rounded-full ${BILLING_STATUS_BADGE[s].cls.split(' ')[0]}`} />
                                      {BILLING_STATUS_BADGE[s].label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Empty state when no patient selected */}
        {!selectedPatient && (
          <div className="card flex flex-col items-center justify-center py-20 text-[var(--color-text-muted)] gap-3">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-secondary)] flex items-center justify-center">
              <Stethoscope className="w-7 h-7 opacity-40" />
            </div>
            <p className="text-sm">Search and select a patient to view or create fee sheets</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
