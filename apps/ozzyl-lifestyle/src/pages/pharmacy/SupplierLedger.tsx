import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  ChevronLeft, ChevronRight, Calendar, Loader2, ExternalLink
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';

interface Supplier {
  id: number; name: string; contact_no: string; city: string; credit_period: number;
}
interface LedgerEntry {
  id: number; entry_type: string; ref_no: string; entry_date: string;
  total_amount: number; status: string;
}
interface Balance { total_payable: number; total_grn: number; }

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-BD', { day: '2-digit', month: 'short', year: 'numeric' });

function statusBadge(s: string) {
  const m: Record<string, string> = { paid: 'badge-success', partial: 'badge-warning', unpaid: 'badge-error', pending: 'badge-secondary' };
  return <span className={`badge ${m[s] ?? 'badge-secondary'}`}>{s}</span>;
}

export default function SupplierLedger({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState('');
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 30;

  const today = new Date().toISOString().slice(0, 10);
  const yr = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(yr);
  const [to, setTo] = useState(today);

  const token = () => localStorage.getItem('hms_token');

  const load = useCallback(async (pg = 1) => {
    if (!supplierId) { toast.error(t('pharmacy.enter_a_supplier_id')); return; }
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/pharmacy/suppliers/${supplierId}/ledger`, {
        params: { page: pg, limit: LIMIT, from_date: from, to_date: to },
        headers: { Authorization: `Bearer ${token()}` },
      });
      setSupplier(data.supplier);
      setEntries(data.data ?? []);
      setBalance(data.balance);
      setTotal(data.pagination?.total ?? 0);
      setPage(pg);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) toast.error(t('pharmacy.supplier_not_found'));
      else toast.error(t('pharmacy.failed_to_load_ledger'));
    } finally { setLoading(false); }
  }, [supplierId, from, to]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        <div className="page-header">
          <div>
            <h1 className="page-title">Supplier Ledger</h1>
            <p className="page-subtitle">Track payables and GRN history per supplier</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </button>
        </div>

        {/* Filter Bar */}
        <div className="card p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-36">
              <label className="form-label">{t("pharmacy.supplierId")}</label>
              <input type="number" className="form-control" placeholder={t("pharmacy.pageNumberExample")}
                value={supplierId} onChange={e => setSupplierId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load(1)} />
            </div>
            <div>
              <label className="form-label">{t("pharmacy.fromDate")}</label>
              <input type="date" className="form-control" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="form-label">{t("pharmacy.toDate")}</label>
              <input type="date" className="form-control" value={to} onChange={e => setTo(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={() => load(1)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
              <span className="ml-1">Load Ledger</span>
            </button>
          </div>
        </div>

        {/* Supplier Info + Balance */}
        {supplier && balance && (
          <>
            <div className="card p-4">
              <div className="flex flex-wrap gap-6 items-start">
                <div>
                  <p className="text-xs text-gray-400 uppercase font-medium">Supplier</p>
                  <p className="font-semibold text-lg">{supplier.name}</p>
                  <p className="text-sm text-gray-500">{supplier.city} · {supplier.contact_no}</p>
                  <p className="text-xs text-gray-400 mt-1">Credit Period: {supplier.credit_period} days</p>
                </div>
                <div className="flex-1" />
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-xl font-bold text-gray-800">{fmt(balance.total_payable)}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Payable</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-blue-600">{balance.total_grn}</p>
                    <p className="text-xs text-gray-500 mt-1">Total GRNs</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Ledger Table */}
            <div className="card">
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Ref #</th>
                      <th>Date</th>
                      <th className="text-right">Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.length === 0 && (
                      <tr><td colSpan={5} className="text-center py-8 text-gray-400">No GRN records in this period</td></tr>
                    )}
                    {entries.map(e => (
                      <tr key={e.id}>
                        <td>
                          <span className="badge badge-secondary text-xs">{e.entry_type}</span>
                        </td>
                        <td className="font-mono text-sm">
                          {e.ref_no}
                          <span className="ml-1 text-gray-400">
                            <ExternalLink className="h-3 w-3 inline" />
                          </span>
                        </td>
                        <td className="text-sm">{fmtDate(e.entry_date)}</td>
                        <td className="text-right font-semibold">{fmt(e.total_amount)}</td>
                        <td>{statusBadge(e.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {entries.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-50 font-semibold">
                        <td colSpan={3} className="text-right">Totals (this page)</td>
                        <td className="text-right">{fmt(entries.reduce((s, e) => s + e.total_amount, 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {/* Pagination */}
              {Math.ceil(total / LIMIT) > 1 && (
                <div className="flex items-center justify-between p-4 text-sm text-gray-500">
                  <span>Page {page} of {Math.ceil(total / LIMIT)} ({total} records)</span>
                  <div className="flex gap-1">
                    <button className="btn btn-sm btn-ghost" disabled={page === 1} onClick={() => load(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button className="btn btn-sm btn-ghost" disabled={page * LIMIT >= total} onClick={() => load(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty */}
        {!supplier && !loading && (
          <div className="card p-12 text-center text-gray-400">
            <p>Enter a Supplier ID and click <strong>Load Ledger</strong> to view payables</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
