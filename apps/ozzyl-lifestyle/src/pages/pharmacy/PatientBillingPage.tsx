import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, User, FileText, CreditCard, Wallet,
  ChevronLeft, ChevronRight, AlertCircle, Loader2,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Patient {
  id: number;
  name: string;
  email: string;
  mobile: string;
  patient_code: string;
}

interface BillingSummary {
  total_invoices: number;
  total_billed: number;
  total_paid: number;
  total_credit: number;
  total_provisional: number;
  provisional_amount: number;
  deposit_balance: number;
  outstanding_amount: number;
}

interface Invoice {
  id: number;
  invoice_no: number;
  total_amount: number;
  paid_amount: number;
  credit_amount: number;
  status: string;
  payment_mode: string;
  print_count: number;
  created_at: string;
  remarks?: string;
}

interface ProvisionalInvoice {
  id: number;
  provisional_no: string;
  total_amount: number;
  status: string;
  created_at: string;
  remarks?: string;
}

interface Deposit {
  id: number;
  deposit_no: string;
  deposit_type: string;
  amount: number;
  payment_mode: string;
  created_at: string;
  remarks?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });

function statusBadge(status: string) {
  const map: Record<string, string> = {
    paid: 'badge-success', credit: 'badge-warning', unpaid: 'badge-error',
    return: 'badge-secondary', active: 'badge-info', cancelled: 'badge-secondary',
  };
  return (
    <span className={`badge ${map[status] ?? 'badge-secondary'}`}>
      {status}
    </span>
  );
}

// ─── Patient Search ───────────────────────────────────────────────────────────
function PatientSearchBar({ onSelect }: { onSelect: (p: Patient) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/patients', {
        params: { search: query, limit: 8 },
        headers: { Authorization: `Bearer ${token}` },
      });
      setResults(data.patients ?? data.data ?? []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  const handleChange = (v: string) => {
    setQ(v);
    const timer = setTimeout(() => search(v), 300);
    return () => clearTimeout(timer);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="input-group">
        <span className="input-group-text">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </span>
        <input
          type="text"
          className="form-control"
          placeholder={t("pharmacy.searchPatientByNameCodeMobile")}
          value={q}
          onChange={e => handleChange(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {results.map(p => (
            <li
              key={p.id}
              className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer"
              onClick={() => { onSelect(p); setResults([]); setQ(''); }}
            >
              <User className="h-4 w-4 text-gray-400 shrink-0" />
              <div>
                <p className="font-medium text-sm">{p.name}</p>
                <p className="text-xs text-gray-500">{p.patient_code} · {p.mobile}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────
function SummaryCards({ s }: { s: BillingSummary }) {
  const cards = [
    { label: 'Total Billed', value: fmt(s.total_billed), icon: FileText, color: 'text-blue-600 bg-blue-50' },
    { label: 'Total Paid', value: fmt(s.total_paid), icon: CreditCard, color: 'text-green-600 bg-green-50' },
    { label: 'Outstanding', value: fmt(s.outstanding_amount), icon: AlertCircle, color: 'text-red-600 bg-red-50' },
    { label: 'Deposit Balance', value: fmt(s.deposit_balance), icon: Wallet, color: 'text-purple-600 bg-purple-50' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="card p-4 flex items-center gap-3">
          <div className={`rounded-lg p-2 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500">{label}</p>
            <p className="font-semibold text-base">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────
function Pagination({
  page, total, limit, onChange,
}: { page: number; total: number; limit: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
      <span>Page {page} of {totalPages} ({total} records)</span>
      <div className="flex gap-1">
        <button className="btn btn-sm btn-ghost" disabled={page === 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="btn btn-sm btn-ghost" disabled={page === totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const TABS = ['invoices', 'provisional', 'deposits'] as const;
type Tab = typeof TABS[number];

export default function PatientBillingPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [provisionals, setProvisionals] = useState<ProvisionalInvoice[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositBalance, setDepositBalance] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('invoices');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const LIMIT = 20;

  const token = () => localStorage.getItem('hms_token');

  const loadPatientData = useCallback(async (p: Patient, pg = 1) => {
    setLoading(true);
    try {
      const [summaryRes, invoiceRes, provisionalRes, depositRes] = await Promise.all([
        axios.get(`/api/pharmacy/patient/${p.id}/billing-summary`,    { headers: { Authorization: `Bearer ${token()}` } }),
        axios.get(`/api/pharmacy/patient/${p.id}/bill-history`,        { params: { page: pg, limit: LIMIT }, headers: { Authorization: `Bearer ${token()}` } }),
        axios.get(`/api/pharmacy/patient/${p.id}/provisional`,         { headers: { Authorization: `Bearer ${token()}` } }),
        axios.get(`/api/pharmacy/patient/${p.id}/deposits`,            { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      setSummary(summaryRes.data.billing_summary);
      setInvoices(invoiceRes.data.data ?? []);
      setTotalInvoices(invoiceRes.data.pagination?.total ?? 0);
      setProvisionals(provisionalRes.data.data ?? []);
      setDeposits(depositRes.data.data ?? []);
      setDepositBalance(depositRes.data.deposit_balance ?? 0);
      setPage(pg);
    } catch {
      toast.error(t('pharmacy.failed_to_load_patient_billing_data'));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectPatient = (p: Patient) => {
    setPatient(p);
    setActiveTab('invoices');
    loadPatientData(p, 1);
  };

  const handlePageChange = (pg: number) => {
    if (patient) loadPatientData(patient, pg);
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Patient Billing</h1>
            <p className="page-subtitle">View full billing history, deposits, and outstanding amounts per patient</p>
          </div>
        </div>

        {/* Search */}
        <div className="card p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <PatientSearchBar onSelect={handleSelectPatient} />
            {patient && (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <User className="h-4 w-4 text-blue-600" />
                <div>
                  <span className="font-medium text-sm text-blue-800">{patient.name}</span>
                  <span className="text-xs text-blue-500 ml-2">{patient.patient_code}</span>
                </div>
                <button
                  className="ml-2 text-blue-400 hover:text-blue-600"
                  onClick={() => { setPatient(null); setSummary(null); }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Content */}
        {!loading && patient && summary && (
          <>
            {/* Summary Cards */}
            <SummaryCards s={summary} />

            {/* Extra stats row */}
            <div className="card p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-gray-800">{summary.total_invoices}</p>
                  <p className="text-xs text-gray-500 mt-1">Total Invoices</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-600">{fmt(summary.total_credit)}</p>
                  <p className="text-xs text-gray-500 mt-1">Credit Amount</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-indigo-600">{summary.total_provisional}</p>
                  <p className="text-xs text-gray-500 mt-1">Provisional Bills</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-indigo-500">{fmt(summary.provisional_amount)}</p>
                  <p className="text-xs text-gray-500 mt-1">Provisional Value</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="card">
              <div className="border-b border-gray-200">
                <nav className="flex gap-0">
                  {TABS.map(tab => (
                    <button
                      key={tab}
                      className={`px-5 py-3 text-sm font-medium border-b-2 capitalize transition-colors ${
                        activeTab === tab
                          ? 'border-primary text-primary'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab === 'invoices'    && `Invoices (${summary.total_invoices})`}
                      {tab === 'provisional' && `Provisional (${summary.total_provisional})`}
                      {tab === 'deposits'    && `Deposits · Balance: ${fmt(depositBalance)}`}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="p-4">

                {/* ── Invoices Tab ── */}
                {activeTab === 'invoices' && (
                  <>
                    <div className="table-responsive">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Invoice #</th>
                            <th>Date</th>
                            <th>Total</th>
                            <th>Paid</th>
                            <th>Credit</th>
                            <th>Mode</th>
                            <th>Status</th>
                            <th>Prints</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoices.length === 0 && (
                            <tr><td colSpan={8} className="text-center text-gray-400 py-8">No invoices found</td></tr>
                          )}
                          {invoices.map(inv => (
                            <tr key={inv.id}>
                              <td className="font-mono text-sm">#{inv.invoice_no}</td>
                              <td>{fmtDate(inv.created_at)}</td>
                              <td>{fmt(inv.total_amount)}</td>
                              <td className="text-green-600">{fmt(inv.paid_amount)}</td>
                              <td className="text-orange-500">{fmt(inv.credit_amount)}</td>
                              <td className="capitalize">{inv.payment_mode}</td>
                              <td>{statusBadge(inv.status)}</td>
                              <td className="text-center">{inv.print_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination page={page} total={totalInvoices} limit={LIMIT} onChange={handlePageChange} />
                  </>
                )}

                {/* ── Provisional Tab ── */}
                {activeTab === 'provisional' && (
                  <div className="table-responsive">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Provisional #</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {provisionals.length === 0 && (
                          <tr><td colSpan={5} className="text-center text-gray-400 py-8">No provisional invoices</td></tr>
                        )}
                        {provisionals.map(pi => (
                          <tr key={pi.id}>
                            <td className="font-mono text-sm">#{pi.provisional_no || pi.id}</td>
                            <td>{fmtDate(pi.created_at)}</td>
                            <td>{fmt(pi.total_amount)}</td>
                            <td>{statusBadge(pi.status)}</td>
                            <td className="text-gray-500 text-sm">{pi.remarks || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── Deposits Tab ── */}
                {activeTab === 'deposits' && (
                  <div className="table-responsive">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Deposit #</th>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Mode</th>
                          <th>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deposits.length === 0 && (
                          <tr><td colSpan={6} className="text-center text-gray-400 py-8">No deposits recorded</td></tr>
                        )}
                        {deposits.map(d => (
                          <tr key={d.id}>
                            <td className="font-mono text-sm">#{d.deposit_no || d.id}</td>
                            <td>{fmtDate(d.created_at)}</td>
                            <td>
                              <span className={`badge ${
                                d.deposit_type === 'deposit' ? 'badge-success' :
                                d.deposit_type === 'return'  ? 'badge-warning' : 'badge-error'
                              }`}>{d.deposit_type}</span>
                            </td>
                            <td className={d.deposit_type === 'deposit' ? 'text-green-600' : 'text-red-500'}>
                              {d.deposit_type === 'deposit' ? '+' : '-'}{fmt(d.amount)}
                            </td>
                            <td className="capitalize">{d.payment_mode}</td>
                            <td className="text-gray-500 text-sm">{d.remarks || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {deposits.length > 0 && (
                      <div className="flex justify-end mt-3 font-semibold text-sm">
                        <span className="text-gray-600 mr-2">Balance:</span>
                        <span className={depositBalance >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {fmt(depositBalance)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && !patient && (
          <div className="card p-12 flex flex-col items-center text-center text-gray-400">
            <User className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-lg font-medium">Search for a patient</p>
            <p className="text-sm mt-1">Enter a patient name, code, or mobile number above to view their billing history</p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
