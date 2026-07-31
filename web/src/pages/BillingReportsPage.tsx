import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart2, FileText, Users, CreditCard, HandCoins, Package,
  Calendar, TrendingUp, Download, RefreshCw, Banknote, Receipt,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';

type TabKey = 'daily-sales' | 'daybook' | 'dept-daybook' | 'doctor-income' | 'item-summary' | 'user-cash' | 'payment-mode' | 'handover' | 'discount' | 'denomination';

const TAB_DEFS: { key: TabKey; icon: React.ReactNode }[] = [
  { key: 'daily-sales', icon: <FileText className="w-4 h-4" /> },
  { key: 'daybook', icon: <BarChart2 className="w-4 h-4" /> },
  { key: 'dept-daybook', icon: <Package className="w-4 h-4" /> },
  { key: 'doctor-income', icon: <Users className="w-4 h-4" /> },
  { key: 'item-summary', icon: <Receipt className="w-4 h-4" /> },
  { key: 'user-cash', icon: <Banknote className="w-4 h-4" /> },
  { key: 'payment-mode', icon: <CreditCard className="w-4 h-4" /> },
  { key: 'handover', icon: <HandCoins className="w-4 h-4" /> },
  { key: 'discount', icon: <TrendingUp className="w-4 h-4" /> },
  { key: 'denomination', icon: <Banknote className="w-4 h-4" /> },
];

function fmt(n: number) {
  return `৳${Number(n || 0).toLocaleString('en-BD')}`;
}

function DateRange({ startDate, endDate, onChange }: { startDate: string; endDate: string; onChange: (s: string, e: string) => void }) {
  const { t } = useTranslation(['tenantBilling']);
  return (
    <div className="flex items-center gap-2">
      <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
      <input type="date" className="input w-36" value={startDate} onChange={(e) => onChange(e.target.value, endDate)} />
      <span className="text-[var(--color-text-muted)]">{t('billingReportsPage.dateRangeTo')}</span>
      <input type="date" className="input w-36" value={endDate} onChange={(e) => onChange(startDate, e.target.value)} />
    </div>
  );
}

function DateInput({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
      <input type="date" className="input w-36" value={date} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ExportButton({ onCSV, onPrint }: { onCSV?: () => void; onPrint?: () => void }) {
  const { t } = useTranslation(['tenantBilling']);
  return (
    <div className="flex gap-2">
      {onCSV && (
        <button onClick={onCSV} className="btn-outline text-xs flex items-center gap-1">
          <Download className="w-3 h-3" /> {t('billingReportsPage.exportCsv')}
        </button>
      )}
      {onPrint && (
        <button onClick={onPrint} className="btn-outline text-xs flex items-center gap-1" onClickCapture={() => window.print()}>
          <FileText className="w-3 h-3" /> {t('billingReportsPage.print')}
        </button>
      )}
    </div>
  );
}

function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [headers.join(','), ...data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ─── Daily Sales Tab ───────────────────────────────────────────────────────
function DailySalesTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [date, setDate] = useState(today);

  const { data, isLoading } = useApiQuery<{
    date: string;
    invoices: Array<{ id: number; invoice_no: string; total_amount: number; discount: number; paid_amount: number; due: number; status: string; patient_name: string; patient_code: string; created_by_name: string; created_at: string }>;
    settlements: { total_settlement: number; total_refund: number; total_adjustment: number };
    user_collections: Array<{ employee_id: number; employee_name: string; cash_in: number; cash_out: number; net_cash: number }>;
    summary: { total_cash_sales: number; total_sales_return: number; total_deposit_deduct: number; total_deposit_return: number; total_collection_from_receivable: number; total_cash_discount_given: number; total_cash_discount_received: number };
  }>(
    queryKeys.reports.all,
    `/api/billing-reports/daily-sales?date=${date}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DateInput date={date} onChange={setDate} />
        <ExportButton
          onCSV={() => downloadCSV(data?.invoices ?? [], `daily-sales-${date}.csv`)}
          onPrint={() => window.print()}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t('billingReportsPage.dailySales.cashSales'), value: data?.summary?.total_cash_sales ?? 0, color: 'text-emerald-600' },
          { label: t('billingReportsPage.dailySales.salesReturn'), value: data?.summary?.total_sales_return ?? 0, color: 'text-red-600' },
          { label: t('billingReportsPage.dailySales.collection'), value: data?.summary?.total_collection_from_receivable ?? 0, color: 'text-blue-600' },
          { label: t('billingReportsPage.dailySales.discountGiven'), value: data?.summary?.total_cash_discount_given ?? 0, color: 'text-amber-600' },
        ].map((card) => (
          <div key={card.label} className="card p-3">
            <p className="text-xs text-[var(--color-text-muted)]">{card.label}</p>
            <p className={`text-lg font-bold font-data ${card.color}`}>{fmt(card.value)}</p>
          </div>
        ))}
      </div>

      {/* User Collections */}
      {data?.user_collections && data.user_collections.length > 0 && (
        <div className="card p-4">
          <h3 className="section-title mb-3">{t('billingReportsPage.dailySales.cashierWiseCollection')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.cashier')}</th><th className="text-right py-2">{t('billingReportsPage.columns.cashIn')}</th><th className="text-right py-2">{t('billingReportsPage.columns.cashOut')}</th><th className="text-right py-2">{t('billingReportsPage.columns.netCash')}</th></tr></thead>
              <tbody>
                {data.user_collections.map((u) => (
                  <tr key={u.employee_id} className="border-b"><td className="py-2">{u.employee_name || t('billingReportsPage.unknown')}</td><td className="text-right font-data">{fmt(u.cash_in)}</td><td className="text-right font-data">{fmt(u.cash_out)}</td><td className="text-right font-data font-medium">{fmt(u.net_cash)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice List */}
      <div className="card p-4">
        <h3 className="section-title mb-3">{t('billingReportsPage.dailySales.invoicesCount', { count: (data?.invoices as any)?.results?.length ?? data?.invoices?.length ?? 0 })}</h3>
        {isLoading ? <div className="skeleton h-48 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.invoice')}</th><th className="text-left py-2">{t('billingReportsPage.columns.patient')}</th><th className="text-right py-2">{t('billingReportsPage.columns.total')}</th><th className="text-right py-2">{t('billingReportsPage.columns.discount')}</th><th className="text-right py-2">{t('billingReportsPage.columns.paid')}</th><th className="text-right py-2">{t('billingReportsPage.columns.due')}</th><th className="text-left py-2">{t('billingReportsPage.columns.by')}</th></tr></thead>
              <tbody>
                {((data?.invoices as any)?.results ?? data?.invoices ?? []).map((inv: any) => (
                  <tr key={inv.id} className="border-b hover:bg-[var(--color-bg-secondary)]">
                    <td className="py-2 font-data">{inv.invoice_no}</td>
                    <td className="py-2">{inv.patient_name} <span className="text-xs text-[var(--color-text-muted)]">({inv.patient_code})</span></td>
                    <td className="text-right font-data">{fmt(inv.total_amount)}</td>
                    <td className="text-right font-data">{fmt(inv.discount)}</td>
                    <td className="text-right font-data">{fmt(inv.paid_amount)}</td>
                    <td className="text-right font-data text-red-600">{fmt(inv.due)}</td>
                    <td className="text-xs text-[var(--color-text-muted)]">{inv.created_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sales Daybook Tab ─────────────────────────────────────────────────────
function DaybookTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ daybook: Array<{ bill_date: string; total_bills: number; total_amount: number; total_discount: number; total_paid: number; total_due: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/sales-daybook?start_date=${startDate}&end_date=${endDate}`,
  );

  const daybook = data?.daybook ?? [];
  const totals = daybook.reduce((acc, r) => ({
    bills: acc.bills + Number(r.total_bills),
    amount: acc.amount + Number(r.total_amount),
    discount: acc.discount + Number(r.total_discount),
    paid: acc.paid + Number(r.total_paid),
    due: acc.due + Number(r.total_due),
  }), { bills: 0, amount: 0, discount: 0, paid: 0, due: 0 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        <ExportButton onCSV={() => downloadCSV(daybook, `daybook-${startDate}-to-${endDate}.csv`)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: t('billingReportsPage.daybook.totalBills'), value: totals.bills, fmt: (v: number) => String(v) },
          { label: t('billingReportsPage.daybook.grossAmount'), value: totals.amount, fmt },
          { label: t('billingReportsPage.daybook.discount'), value: totals.discount, fmt },
          { label: t('billingReportsPage.daybook.paid'), value: totals.paid, fmt },
          { label: t('billingReportsPage.daybook.due'), value: totals.due, fmt },
        ].map((c) => (
          <div key={c.label} className="card p-3">
            <p className="text-xs text-[var(--color-text-muted)]">{c.label}</p>
            <p className="text-lg font-bold font-data">{isLoading ? '...' : c.fmt(c.value)}</p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        {isLoading ? <div className="skeleton h-48 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.date')}</th><th className="text-right py-2">{t('billingReportsPage.columns.bills')}</th><th className="text-right py-2">{t('billingReportsPage.columns.gross')}</th><th className="text-right py-2">{t('billingReportsPage.columns.discount')}</th><th className="text-right py-2">{t('billingReportsPage.columns.paid')}</th><th className="text-right py-2">{t('billingReportsPage.columns.due')}</th></tr></thead>
              <tbody>
                {daybook.map((r) => (
                  <tr key={r.bill_date} className="border-b hover:bg-[var(--color-bg-secondary)]">
                    <td className="py-2 font-data">{r.bill_date}</td>
                    <td className="text-right font-data">{r.total_bills}</td>
                    <td className="text-right font-data">{fmt(r.total_amount)}</td>
                    <td className="text-right font-data">{fmt(r.total_discount)}</td>
                    <td className="text-right font-data">{fmt(r.total_paid)}</td>
                    <td className="text-right font-data text-red-600">{fmt(r.total_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Department Sales Daybook Tab ──────────────────────────────────────────
function DeptDaybookTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ departments: Array<{ service_department: string; bill_date: string; item_count: number; total_amount: number; total_quantity: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/department-sales-daybook?start_date=${startDate}&end_date=${endDate}`,
  );

  const depts = data?.departments ?? [];
  const deptTotals = new Map<string, number>();
  depts.forEach(d => deptTotals.set(d.service_department, (deptTotals.get(d.service_department) ?? 0) + Number(d.total_amount)));
  const sortedDepts = [...deptTotals.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />

      {sortedDepts.length > 0 && (
        <div className="card p-4">
          <h3 className="section-title mb-3">{t('billingReportsPage.deptDaybook.departmentWiseRevenue')}</h3>
          <div className="space-y-3">
            {sortedDepts.map(([dept, total]) => {
              const maxVal = sortedDepts[0][1] || 1;
              const pct = (total / maxVal) * 100;
              return (
                <div key={dept} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{dept}</span>
                    <span className="font-data text-[var(--color-text-muted)]">{fmt(total)}</span>
                  </div>
                  <div className="h-5 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%`, minWidth: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-4">
        {isLoading ? <div className="skeleton h-48 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.department')}</th><th className="text-left py-2">{t('billingReportsPage.columns.date')}</th><th className="text-right py-2">{t('billingReportsPage.columns.items')}</th><th className="text-right py-2">{t('billingReportsPage.columns.qty')}</th><th className="text-right py-2">{t('billingReportsPage.columns.amount')}</th></tr></thead>
              <tbody>
                {depts.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-[var(--color-bg-secondary)]">
                    <td className="py-2">{r.service_department}</td>
                    <td className="py-2 font-data">{r.bill_date}</td>
                    <td className="text-right font-data">{r.item_count}</td>
                    <td className="text-right font-data">{r.total_quantity}</td>
                    <td className="text-right font-data font-medium">{fmt(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Doctor Income Tab ─────────────────────────────────────────────────────
function DoctorIncomeTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ doctors: Array<{ doctor_id: number; doctor_name: string; specialization: string; total_bills: number; total_revenue: number; total_collected: number; total_due: number; total_commission: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/doctor-income-summary?start_date=${startDate}&end_date=${endDate}`,
  );

  const doctors = data?.doctors ?? [];

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
      <div className="card p-4">
        {isLoading ? <div className="skeleton h-48 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.doctor')}</th><th className="text-left py-2">{t('billingReportsPage.columns.specialization')}</th><th className="text-right py-2">{t('billingReportsPage.columns.bills')}</th><th className="text-right py-2">{t('billingReportsPage.columns.revenue')}</th><th className="text-right py-2">{t('billingReportsPage.columns.collected')}</th><th className="text-right py-2">{t('billingReportsPage.columns.due')}</th><th className="text-right py-2">{t('billingReportsPage.columns.commission')}</th><th className="text-right py-2">{t('billingReportsPage.columns.netHospital')}</th></tr></thead>
              <tbody>
                {doctors.map((d) => (
                  <tr key={d.doctor_id} className="border-b hover:bg-[var(--color-bg-secondary)]">
                    <td className="py-2 font-medium">{d.doctor_name}</td>
                    <td className="py-2 text-[var(--color-text-muted)]">{d.specialization}</td>
                    <td className="text-right font-data">{d.total_bills}</td>
                    <td className="text-right font-data">{fmt(d.total_revenue)}</td>
                    <td className="text-right font-data">{fmt(d.total_collected)}</td>
                    <td className="text-right font-data text-red-600">{fmt(d.total_due)}</td>
                    <td className="text-right font-data text-amber-600">{fmt(d.total_commission)}</td>
                    <td className="text-right font-data font-medium text-emerald-600">{fmt(Number(d.total_revenue) - Number(d.total_commission))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Item Summary Tab ──────────────────────────────────────────────────────
function ItemSummaryTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ items: Array<{ item_name: string; service_department: string; item_count: number; total_quantity: number; total_amount: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/item-summary?start_date=${startDate}&end_date=${endDate}`,
  );

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
      <div className="card p-4">
        {isLoading ? <div className="skeleton h-48 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.item')}</th><th className="text-left py-2">{t('billingReportsPage.columns.department')}</th><th className="text-right py-2">{t('billingReportsPage.columns.count')}</th><th className="text-right py-2">{t('billingReportsPage.columns.qty')}</th><th className="text-right py-2">{t('billingReportsPage.columns.amount')}</th></tr></thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-[var(--color-bg-secondary)]">
                    <td className="py-2">{r.item_name}</td>
                    <td className="py-2 text-[var(--color-text-muted)]">{r.service_department}</td>
                    <td className="text-right font-data">{r.item_count}</td>
                    <td className="text-right font-data">{r.total_quantity}</td>
                    <td className="text-right font-data font-medium">{fmt(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User Cash Collection Tab ──────────────────────────────────────────────
function UserCashTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ users: Array<{ employee_id: number; employee_name: string; transaction_count: number; cash_in: number; cash_out: number; net_cash: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/user-cash-collection?start_date=${startDate}&end_date=${endDate}`,
  );

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
      <div className="card p-4">
        {isLoading ? <div className="skeleton h-48 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.employee')}</th><th className="text-right py-2">{t('billingReportsPage.columns.transactions')}</th><th className="text-right py-2">{t('billingReportsPage.columns.cashIn')}</th><th className="text-right py-2">{t('billingReportsPage.columns.cashOut')}</th><th className="text-right py-2">{t('billingReportsPage.columns.netCash')}</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.employee_id} className="border-b hover:bg-[var(--color-bg-secondary)]">
                    <td className="py-2">{u.employee_name || t('billingReportsPage.unknown')}</td>
                    <td className="text-right font-data">{u.transaction_count}</td>
                    <td className="text-right font-data text-emerald-600">{fmt(u.cash_in)}</td>
                    <td className="text-right font-data text-red-600">{fmt(u.cash_out)}</td>
                    <td className="text-right font-data font-bold">{fmt(u.net_cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Payment Mode Tab ──────────────────────────────────────────────────────
function PaymentModeTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ payment_modes: Array<{ payment_mode: string; transaction_count: number; total_amount: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/payment-mode?start_date=${startDate}&end_date=${endDate}`,
  );

  const modes = data?.payment_modes ?? [];
  const total = modes.reduce((s, m) => s + Number(m.total_amount), 0);
  const COLORS = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-red-500', 'bg-cyan-500', 'bg-gray-500'];

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />

      {modes.length > 0 && (
        <div className="card p-4">
          <h3 className="section-title mb-3">{t('billingReportsPage.paymentMode.paymentDistribution')}</h3>
          <div className="space-y-3">
            {modes.map((m, i) => {
              const pct = total > 0 ? (Number(m.total_amount) / total) * 100 : 0;
              return (
                <div key={m.payment_mode} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium capitalize">{m.payment_mode}</span>
                    <span className="font-data">{fmt(m.total_amount)} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-5 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${COLORS[i % COLORS.length]}`} style={{ width: `${pct}%`, minWidth: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card p-4">
        {isLoading ? <div className="skeleton h-32 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.paymentMode')}</th><th className="text-right py-2">{t('billingReportsPage.columns.transactions')}</th><th className="text-right py-2">{t('billingReportsPage.columns.amount')}</th><th className="text-right py-2">%</th></tr></thead>
              <tbody>
                {modes.map((m) => (
                  <tr key={m.payment_mode} className="border-b">
                    <td className="py-2 capitalize font-medium">{m.payment_mode}</td>
                    <td className="text-right font-data">{m.transaction_count}</td>
                    <td className="text-right font-data">{fmt(m.total_amount)}</td>
                    <td className="text-right font-data">{total > 0 ? ((Number(m.total_amount) / total) * 100).toFixed(1) : '0'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Handover Tab ──────────────────────────────────────────────────────────
function HandoverTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data: receiveData, isLoading: loadingReceive } = useApiQuery<{
    handovers: Array<{ id: number; handover_type: string; handover_amount: number; due_amount: number; status: string; created_at: string; handover_by_name: string; handover_to_name: string; received_by_name: string }>;
    summary: { total_handovers: number; total_amount: number; total_due: number };
  }>(
    queryKeys.reports.all,
    `/api/billing-reports/handover/receive?start_date=${startDate}&end_date=${endDate}`,
  );

  const { data: summaryData } = useApiQuery<{
    summary: Array<{ employee_id: number; employee_name: string; total_handovers: number; total_amount: number; total_due: number; received_count: number; pending_count: number; verified_count: number }>;
  }>(
    queryKeys.reports.all,
    `/api/billing-reports/handover/summary?start_date=${startDate}&end_date=${endDate}`,
  );

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('billingReportsPage.handover.totalHandovers')}</p>
          <p className="text-lg font-bold font-data">{receiveData?.summary?.total_handovers ?? 0}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('billingReportsPage.handover.totalAmount')}</p>
          <p className="text-lg font-bold font-data">{fmt(receiveData?.summary?.total_amount ?? 0)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('billingReportsPage.handover.totalDue')}</p>
          <p className="text-lg font-bold font-data text-red-600">{fmt(receiveData?.summary?.total_due ?? 0)}</p>
        </div>
      </div>

      {/* Employee Summary */}
      {summaryData?.summary && summaryData.summary.length > 0 && (
        <div className="card p-4">
          <h3 className="section-title mb-3">{t('billingReportsPage.handover.employeeWiseSummary')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.employee')}</th><th className="text-right py-2">{t('billingReportsPage.columns.handovers')}</th><th className="text-right py-2">{t('billingReportsPage.columns.amount')}</th><th className="text-right py-2">{t('billingReportsPage.columns.received')}</th><th className="text-right py-2">{t('billingReportsPage.columns.pending')}</th></tr></thead>
              <tbody>
                {summaryData.summary.map((s) => (
                  <tr key={s.employee_id} className="border-b">
                    <td className="py-2">{s.employee_name}</td>
                    <td className="text-right font-data">{s.total_handovers}</td>
                    <td className="text-right font-data">{fmt(s.total_amount)}</td>
                    <td className="text-right font-data text-emerald-600">{s.received_count}</td>
                    <td className="text-right font-data text-amber-600">{s.pending_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Handover List */}
      <div className="card p-4">
        <h3 className="section-title mb-3">{t('billingReportsPage.handover.receivedHandovers')}</h3>
        {loadingReceive ? <div className="skeleton h-32 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.by')}</th><th className="text-left py-2">{t('billingReportsPage.columns.to')}</th><th className="text-right py-2">{t('billingReportsPage.columns.amount')}</th><th className="text-left py-2">{t('billingReportsPage.columns.type')}</th><th className="text-left py-2">{t('billingReportsPage.columns.receivedBy')}</th></tr></thead>
              <tbody>
                {(receiveData?.handovers ?? []).map((h) => (
                  <tr key={h.id} className="border-b">
                    <td className="py-2">{h.handover_by_name}</td>
                    <td className="py-2">{h.handover_to_name || '-'}</td>
                    <td className="text-right font-data">{fmt(h.handover_amount)}</td>
                    <td className="py-2 capitalize">{h.handover_type}</td>
                    <td className="py-2">{h.received_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Discount Tab ──────────────────────────────────────────────────────────
function DiscountTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data: schemeData, isLoading } = useApiQuery<{
    discounts: Array<{ discount_reason: string; bill_count: number; total_discount: number; total_amount: number; total_paid: number }>;
    summary: { total_bills: number; total_discount: number };
  }>(
    queryKeys.reports.all,
    `/api/billing-reports/discount/scheme-wise?start_date=${startDate}&end_date=${endDate}`,
  );

  const { data: deptData } = useApiQuery<{ departments: Array<{ department: string; item_count: number; total_amount: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/discount/department-wise?start_date=${startDate}&end_date=${endDate}`,
  );

  return (
    <div className="space-y-4">
      <DateRange startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('billingReportsPage.discount.billsWithDiscount')}</p>
          <p className="text-lg font-bold font-data">{schemeData?.summary?.total_bills ?? 0}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-[var(--color-text-muted)]">{t('billingReportsPage.discount.totalDiscount')}</p>
          <p className="text-lg font-bold font-data text-amber-600">{fmt(schemeData?.summary?.total_discount ?? 0)}</p>
        </div>
      </div>

      {/* Discount by Reason */}
      <div className="card p-4">
        <h3 className="section-title mb-3">{t('billingReportsPage.discount.discountByReason')}</h3>
        {isLoading ? <div className="skeleton h-32 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.reason')}</th><th className="text-right py-2">{t('billingReportsPage.columns.bills')}</th><th className="text-right py-2">{t('billingReportsPage.columns.discount')}</th><th className="text-right py-2">{t('billingReportsPage.columns.gross')}</th><th className="text-right py-2">%</th></tr></thead>
              <tbody>
                {(schemeData?.discounts ?? []).map((d, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2">{d.discount_reason || t('billingReportsPage.noReason')}</td>
                    <td className="text-right font-data">{d.bill_count}</td>
                    <td className="text-right font-data">{fmt(d.total_discount)}</td>
                    <td className="text-right font-data">{fmt(d.total_amount)}</td>
                    <td className="text-right font-data">{Number(d.total_amount) > 0 ? ((Number(d.total_discount) / Number(d.total_amount)) * 100).toFixed(1) : '0'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Department Revenue */}
      {deptData?.departments && deptData.departments.length > 0 && (
        <div className="card p-4">
          <h3 className="section-title mb-3">{t('billingReportsPage.discount.departmentRevenue')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.department')}</th><th className="text-right py-2">{t('billingReportsPage.columns.items')}</th><th className="text-right py-2">{t('billingReportsPage.columns.amount')}</th></tr></thead>
              <tbody>
                {deptData.departments.map((d, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2">{d.department}</td>
                    <td className="text-right font-data">{d.item_count}</td>
                    <td className="text-right font-data font-medium">{fmt(d.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Denomination Tab ──────────────────────────────────────────────────────
function DenominationTab() {
  const { t } = useTranslation(['tenantBilling']);
  const today = getTodayGMT6();
  const [date, setDate] = useState(today);

  const { data, isLoading } = useApiQuery<{ date: string; denominations: Array<{ employee_id: number; employee_name: string; net_cash: number }> }>(
    queryKeys.reports.all,
    `/api/billing-reports/denomination?date=${date}`,
  );

  return (
    <div className="space-y-4">
      <DateInput date={date} onChange={setDate} />
      <div className="card p-4">
        <h3 className="section-title mb-3">{t('billingReportsPage.denomination.cashPositionByEmployee')}</h3>
        {isLoading ? <div className="skeleton h-32 w-full rounded-lg" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b"><th className="text-left py-2">{t('billingReportsPage.columns.employee')}</th><th className="text-right py-2">{t('billingReportsPage.columns.netCash')}</th></tr></thead>
              <tbody>
                {(data?.denominations ?? []).map((d) => (
                  <tr key={d.employee_id} className="border-b">
                    <td className="py-2">{d.employee_name || t('billingReportsPage.unknown')}</td>
                    <td className="text-right font-data font-medium">{fmt(d.net_cash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
const TAB_COMPONENTS: Record<TabKey, () => React.ReactNode> = {
  'daily-sales': DailySalesTab,
  'daybook': DaybookTab,
  'dept-daybook': DeptDaybookTab,
  'doctor-income': DoctorIncomeTab,
  'item-summary': ItemSummaryTab,
  'user-cash': UserCashTab,
  'payment-mode': PaymentModeTab,
  'handover': HandoverTab,
  'discount': DiscountTab,
  'denomination': DenominationTab,
};

export default function BillingReportsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantBilling']);
  const [activeTab, setActiveTab] = useState<TabKey>('daily-sales');
  const TabComponent = TAB_COMPONENTS[activeTab];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('billingReportsPage.title')}</h1>
              <p className="section-subtitle">{t('billingReportsPage.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--color-border)] overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TAB_DEFS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {tab.icon}
                {t(`billingReportsPage.tabs.${tab.key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}
