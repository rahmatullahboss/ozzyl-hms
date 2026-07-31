import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Handshake, Search, X, CheckCircle, DollarSign, Wallet, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { api, ApiClientError } from '../lib/apiClient';
import HelpButton from '../components/HelpButton';
import WhatsAppButton from '../components/WhatsAppButton';
import HelpPanel from '../components/HelpPanel';
import { useQueryClient } from '@tanstack/react-query';

interface PendingBill {
  id: number;
  invoice_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  total: number;
  paid: number;
  due_amount: number;
  status: string;
  created_at: string;
}

interface PatientSettlementInfo {
  patient: { id: number; name: string; patient_code: string; mobile?: string };
  pending_bills: { id: number; invoice_no: string; total: number; paid: number; due_amount: number; status: string }[];
  deposit_balance: number;
  total_due: number;
  net_payable: number;
}

function fmtTaka(n: number, t: any) {
  const symbol = t('common.currencySymbol') || '৳';
  return `${symbol}${(n || 0).toLocaleString('en-BD')}`;
}

export default function PatientSettlementsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [bills, setBills] = useState<PendingBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Settlement modal
  const [selectedBill, setSelectedBill] = useState<PendingBill | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  const [settleInfo, setSettleInfo] = useState<PatientSettlementInfo | null>(null);
  const [settleForm, setSettleForm] = useState({
    deposit_deducted: '',
    discount_amount: '',
    discount_by_name: '',
    paid_amount: '',
    payment_mode: 'cash',
    remarks: '',
  });
  const [settling, setSettling] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ pending_bills: PendingBill[] }>(`/api/settlements/pending`);
      let list = data.pending_bills ?? [];
      const q = search.toLowerCase();
      if (q) {
        list = list.filter(b =>
          b.patient_name?.toLowerCase().includes(q) ||
          b.patient_code?.toLowerCase().includes(q) ||
          b.invoice_no?.toLowerCase().includes(q)
        );
      }
      setBills(list);
    } catch {
      toast.error(t('billSettlement.loadBillsFailed'));
      setBills([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const openSettle = async (bill: PendingBill) => {
    setSelectedBill(bill);
    try {
      const info = await api.get<PatientSettlementInfo>(`/api/settlements/patient/${bill.patient_id}/info`);
      setSettleInfo(info);
      setSettleForm({
        deposit_deducted: '',
        discount_amount: '',
        discount_by_name: '',
        paid_amount: String(info.net_payable),
        payment_mode: 'cash',
        remarks: '',
      });
      setShowSettle(true);
    } catch {
      toast.error(t('billSettlement.loadSettlementInfoFailed'));
    }
  };

  const handleSettle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBill || !settleInfo) return;
    const settlementDue = settleInfo.total_due || settleInfo.net_payable || 0;
    const requestedDiscount = parseFloat(settleForm.discount_amount) || 0;
    if (settlementDue > 0 && requestedDiscount > 0 && (requestedDiscount / settlementDue) * 100 > 20 && !settleForm.discount_by_name.trim()) {
      toast.error('Discount referred by name is required when discount is above 20%.');
      return;
    }
    setSettling(true);
    try {
      const depositDeducted = parseFloat(settleForm.deposit_deducted) || 0;
      const discountAmount = requestedDiscount;
      const paidAmount = parseFloat(settleForm.paid_amount) || 0;

      await api.post('/api/settlements', {
        patient_id: selectedBill.patient_id,
        bill_ids: settleInfo.pending_bills.map(b => b.id),
        paid_amount: paidAmount,
        deposit_deducted: depositDeducted,
        discount_amount: discountAmount,
        discount_by_name: settleForm.discount_by_name.trim() || undefined,
        payment_mode: settleForm.payment_mode,
        remarks: settleForm.remarks || undefined,
        idempotencyKey: `settlement-${crypto.randomUUID()}`,
      });
      toast.success(t('billSettlement.settlementSuccess'));
      setShowSettle(false);
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      fetchBills();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('billSettlement.createSettlementFailed'));
    } finally {
      setSettling(false);
    }
  };

  const totalDue = bills.reduce((s, b) => s + b.due_amount, 0);
  const totalBills = bills.length;

  const netPayable = settleInfo
    ? Math.max(0, settleInfo.total_due - (parseFloat(settleForm.deposit_deducted) || 0) - (parseFloat(settleForm.discount_amount) || 0))
    : 0;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Handshake className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('billSettlement.title')}</h1>
              <p className="section-subtitle">{t('billSettlement.subtitle')}</p>
            </div>
            <HelpButton onClick={() => setHelpOpen(true)} />
            <WhatsAppButton />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard title={t('billSettlement.pendingBills')} value={totalBills} loading={loading} icon={<Receipt className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={0} />
          <KPICard title={t('billSettlement.totalDue')} value={fmtTaka(totalDue, t)} loading={loading} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" index={1} />
        </div>

        {/* Filters */}
        <div className="card p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('billSettlement.searchPlaceholder')}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput); }}
              className="input pl-9"
            />
          </div>
          <button onClick={() => setSearch(searchInput)} className="btn-secondary">{t('common.search')}</button>
          {search && <button onClick={() => { setSearch(''); setSearchInput(''); }} className="btn-ghost text-sm">{t('common.clear')}</button>}
        </div>

        {/* Bills table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('billSettlement.invoiceNo')}</th>
                  <th>{t('billSettlement.patient')}</th>
                  <th className="text-right">{t('billSettlement.total')}</th>
                  <th className="text-right">{t('billSettlement.paid')}</th>
                  <th className="text-right">{t('billSettlement.due')}</th>
                  <th>{t('billSettlement.status')}</th>
                  <th>{t('billSettlement.actions')}</th>
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
                  : bills.length === 0
                  ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            icon={<Handshake className="w-8 h-8 text-[var(--color-text-muted)]" />}
                            title={t('billSettlement.noPendingBills')}
                            description={t('billSettlement.allBillsSettled')}
                          />
                        </td>
                      </tr>
                    )
                  : bills.map(b => (
                      <tr key={b.id}>
                        <td className="font-data font-medium">{b.invoice_no}</td>
                        <td>
                          <div className="font-medium">{b.patient_name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{b.patient_code}</div>
                        </td>
                        <td className="text-right font-medium">{fmtTaka(b.total, t)}</td>
                        <td className="text-right text-emerald-600">{fmtTaka(b.paid, t)}</td>
                        <td className="text-right font-semibold text-red-600">{fmtTaka(b.due_amount, t)}</td>
                        <td><span className={`badge ${b.status === 'open' ? 'badge-danger' : 'badge-warning'}`}>{t(b.status)}</span></td>
                        <td>
                          <button onClick={() => openSettle(b)} className="btn-primary text-xs px-2 py-1">
                            <CheckCircle className="w-3.5 h-3.5" /> {t('billSettlement.settle')}
                          </button>
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── SETTLEMENT MODAL ─── */}
      {showSettle && selectedBill && settleInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">{t('billSettlement.settleBillFor', { name: selectedBill.patient_name })}</h3>
              <button onClick={() => setShowSettle(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSettle} className="p-5 space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-px bg-[var(--color-border)] rounded-lg overflow-hidden">
                {[
                  { label: t('billSettlement.totalDue'), value: fmtTaka(settleInfo.total_due, t) },
                  { label: t('billSettlement.deposit'), value: fmtTaka(settleInfo.deposit_balance, t) },
                  { label: t('billSettlement.netPayable'), value: fmtTaka(netPayable, t) },
                ].map(item => (
                  <div key={item.label} className="bg-[var(--color-surface)] p-3 text-center">
                    <div className="text-xs text-[var(--color-text-muted)] mb-0.5">{item.label}</div>
                    <div className="font-semibold text-sm">{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Bills being settled */}
              <div className="space-y-1">
                <label className="label">{t('billSettlement.billsToSettle')}</label>
                <div className="max-h-28 overflow-y-auto divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-lg">
                  {settleInfo.pending_bills.map(b => (
                    <div key={b.id} className="flex justify-between px-3 py-2 text-sm">
                      <span>{b.invoice_no}</span>
                      <span className="font-medium">{fmtTaka(b.due_amount, t)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('billSettlement.depositDeducted')}</label>
                  <input className="input" type="number" min="0" step="0.01" max={settleInfo.deposit_balance}
                    value={settleForm.deposit_deducted}
                    onChange={e => setSettleForm(f => ({ ...f, deposit_deducted: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('billSettlement.discount')}</label>
                  <input className="input" type="number" min="0" step="0.01"
                    value={settleForm.discount_amount}
                    onChange={e => setSettleForm(f => ({ ...f, discount_amount: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="label">
                    Discount referred by{settleInfo.total_due > 0 && (Number(settleForm.discount_amount || 0) / settleInfo.total_due) * 100 > 20 ? ' *' : ''}
                  </label>
                  <input className="input" placeholder={settleInfo.total_due > 0 && (Number(settleForm.discount_amount || 0) / settleInfo.total_due) * 100 > 20 ? 'Required above 20%' : 'Optional'}
                    value={settleForm.discount_by_name}
                    onChange={e => setSettleForm(f => ({ ...f, discount_by_name: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('billSettlement.finalPayment')}</label>
                  <input className="input" type="number" min="0" step="0.01"
                    value={settleForm.paid_amount}
                    onChange={e => setSettleForm(f => ({ ...f, paid_amount: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('billSettlement.paymentMode')}</label>
                  <select className="input"
                    value={settleForm.payment_mode}
                    onChange={e => setSettleForm(f => ({ ...f, payment_mode: e.target.value }))}>
                    <option value="cash">{t('billSettlement.cash')}</option>
                    <option value="card">{t('billSettlement.card')}</option>
                    <option value="bkash">{t('billSettlement.bkash')}</option>
                    <option value="nagad">{t('billSettlement.nagad')}</option>
                    <option value="bank_transfer">{t('billSettlement.bankTransfer')}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">{t('billSettlement.remarks')}</label>
                <input className="input" type="text"
                  value={settleForm.remarks}
                  onChange={e => setSettleForm(f => ({ ...f, remarks: e.target.value }))}
                  placeholder={t('billSettlement.optionalRemarks')} />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSettle(false)} className="btn-secondary">{t('billSettlement.cancel')}</button>
                <button type="submit" disabled={settling} className="btn-primary bg-emerald-600 hover:bg-emerald-700">
                  {settling ? t('billSettlement.settling') : t('billSettlement.createSettlement')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <HelpPanel pageKey="billing" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </DashboardLayout>
  );
}
