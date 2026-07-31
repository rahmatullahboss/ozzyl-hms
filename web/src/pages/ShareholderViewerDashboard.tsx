import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, ShieldCheck, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { api } from '../lib/apiClient';
import { formatDisplayDate, getTodayGMT6 } from '../lib/date-utils';

interface PortalData {
  range: { from: string; to: string };
  summary: {
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
    estimatedRetainedEarnings: number;
    estimatedDistributableProfit: number;
    finalizedDividendTotal: number;
    paidDividendTotal: number;
    unpaidDividendTotal: number;
    latestFinalizedMonth: string | null;
    eligibleShareholderCount: number;
    eligibleShareCount: number;
  };
  policy: {
    profitPercentage: number;
    retainedEarningsPercentage: number;
  };
  trend: Array<{
    month: string;
    income: number;
    expense: number;
    profit: number;
    finalizedDividend: number;
    paidDividend: number;
    unpaidDividend: number;
  }>;
  distributions: Array<{
    id: number;
    month: string;
    totalProfit: number;
    distributableProfit: number;
    retainedAmount: number;
    shareholderCount: number;
    grossDividend: number;
    taxWithheld: number;
    netPayable: number;
    paidAmount: number;
    unpaidAmount: number;
    approvedAt: string | null;
  }>;
}

function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function previousMonthRange(today: string): { from: string; to: string } {
  const [year, month] = today.slice(0, 7).split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, 0));
  const previousMonth = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    from: `${previousMonth}-01`,
    to: end.toISOString().slice(0, 10),
  };
}

function formatMoney(value: number): string {
  return `৳${Number(value || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`;
}

export default function ShareholderViewerDashboard() {
  const today = getTodayGMT6();
  const [from, setFrom] = useState(yearStart(today));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!from || !to || from > to) {
      toast.error('সঠিক তারিখের সীমা নির্বাচন করুন');
      return;
    }
    setLoading(true);
    try {
      const result = await api.get<PortalData>(
        `/api/shareholder-portal/summary?${new URLSearchParams({ from, to })}`,
      );
      setData(result);
      setLastRefreshed(new Date());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'আর্থিক সারাংশ লোড করা যায়নি');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await api.text(
        `/api/shareholder-portal/export.csv?${new URLSearchParams({ from, to })}`,
      );
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `shareholder-financial-report-${from}-to-${to}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV export সম্পন্ন হয়েছে');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export করা যায়নি');
    } finally {
      setExporting(false);
    }
  };

  const applyPreset = (preset: 'month' | 'previous' | 'year') => {
    if (preset === 'month') {
      setFrom(monthStart(today));
      setTo(today);
      return;
    }
    if (preset === 'previous') {
      const range = previousMonthRange(today);
      setFrom(range.from);
      setTo(range.to);
      return;
    }
    setFrom(yearStart(today));
    setTo(today);
  };

  return (
    <DashboardLayout role="shareholder_viewer" fullWidth showBreadcrumbs={false}>
      <div className="mx-auto max-w-screen-2xl space-y-5">
        <section className="rounded-2xl border border-cyan-100 bg-gradient-to-r from-cyan-50 to-white p-5 shadow-sm dark:border-cyan-900/50 dark:from-cyan-950/30 dark:to-slate-900">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                <ShieldCheck className="h-4 w-4" /> Read-only shareholder portal
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">শেয়ারহোল্ডার আর্থিক সারাংশ</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
                এখানে শুধু সমষ্টিগত আয়, ব্যয়, লাভ/ক্ষতি ও চূড়ান্ত dividend তথ্য দেখা যায়। কোনো হিসাব পরিবর্তন, অনুমোদন বা payment করা যায় না।
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button type="button" className="btn-primary" onClick={exportCsv} disabled={exporting || loading || !data}>
                <Download className="h-4 w-4" />
                {exporting ? 'Exporting…' : 'CSV (Excel/Sheets)'}
              </button>
            </div>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={() => applyPreset('month')}>চলতি মাস</button>
              <button type="button" className="btn-secondary text-sm" onClick={() => applyPreset('previous')}>গত মাস</button>
              <button type="button" className="btn-secondary text-sm" onClick={() => applyPreset('year')}>চলতি বছর</button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                শুরু
                <input type="date" className="input mt-1" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                শেষ
                <input type="date" className="input mt-1" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
              </label>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            সর্বোচ্চ ৩৬ মাস দেখা যাবে{lastRefreshed ? ` · সর্বশেষ refresh: ${lastRefreshed.toLocaleTimeString('en-BD', { timeZone: 'Asia/Dhaka' })}` : ''}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KPICard title="মোট আয়" value={formatMoney(data?.summary.totalIncome ?? 0)} loading={loading} icon={<TrendingUp className="h-5 w-5" />} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title="মোট ব্যয়" value={formatMoney(data?.summary.totalExpense ?? 0)} loading={loading} icon={<TrendingDown className="h-5 w-5" />} iconBg="bg-red-50 text-red-600" />
          <KPICard title="নিট লাভ / ক্ষতি" value={formatMoney(data?.summary.netProfit ?? 0)} loading={loading} icon={<WalletCards className="h-5 w-5" />} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title="আনুমানিক বিতরণযোগ্য লাভ" value={formatMoney(data?.summary.estimatedDistributableProfit ?? 0)} loading={loading} icon={<TrendingUp className="h-5 w-5" />} iconBg="bg-cyan-50 text-cyan-600" />
          <KPICard title="পরিশোধিত dividend" value={formatMoney(data?.summary.paidDividendTotal ?? 0)} loading={loading} icon={<ShieldCheck className="h-5 w-5" />} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title="অপরিশোধিত dividend" value={formatMoney(data?.summary.unpaidDividendTotal ?? 0)} loading={loading} icon={<WalletCards className="h-5 w-5" />} iconBg="bg-amber-50 text-amber-600" />
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-1">
            <h2 className="font-semibold text-slate-900 dark:text-white">নীতি ও পরিধি</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">লাভ বিতরণ হার</dt><dd className="font-semibold">{data?.policy.profitPercentage ?? 0}%</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Retained earnings হার</dt><dd className="font-semibold">{data?.policy.retainedEarningsPercentage ?? 0}%</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">যোগ্য shareholder</dt><dd className="font-semibold">{data?.summary.eligibleShareholderCount ?? 0}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">যোগ্য মোট share</dt><dd className="font-semibold">{data?.summary.eligibleShareCount ?? 0}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">সর্বশেষ final month</dt><dd className="font-semibold">{data?.summary.latestFinalizedMonth ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">আনুমানিক retained amount</dt><dd className="font-semibold">{formatMoney(data?.summary.estimatedRetainedEarnings ?? 0)}</dd></div>
            </dl>
          </div>

          <div className="card overflow-hidden lg:col-span-2">
            <div className="border-b border-[var(--color-border)] p-5">
              <h2 className="font-semibold text-slate-900 dark:text-white">মাসভিত্তিক আর্থিক trend</h2>
              <p className="mt-1 text-xs text-slate-500">Verified general ledger এবং finalized dividend থেকে প্রস্তুত</p>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>মাস</th><th className="text-right">আয়</th><th className="text-right">ব্যয়</th><th className="text-right">লাভ/ক্ষতি</th><th className="text-right">Dividend</th></tr></thead>
                <tbody>
                  {loading ? <tr><td colSpan={5} className="py-12 text-center text-slate-500">লোড হচ্ছে…</td></tr> : data?.trend.length ? data.trend.map((row) => (
                    <tr key={row.month}>
                      <td className="font-medium">{row.month}</td>
                      <td className="text-right font-data text-emerald-600">{formatMoney(row.income)}</td>
                      <td className="text-right font-data text-red-600">{formatMoney(row.expense)}</td>
                      <td className={`text-right font-data font-semibold ${row.profit < 0 ? 'text-red-600' : 'text-slate-900 dark:text-white'}`}>{formatMoney(row.profit)}</td>
                      <td className="text-right font-data">{formatMoney(row.finalizedDividend)}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="py-12 text-center text-slate-500">এই সময়ে কোনো তথ্য নেই</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--color-border)] p-5">
            <h2 className="font-semibold text-slate-900 dark:text-white">Finalized dividend history</h2>
            <p className="mt-1 text-xs text-slate-500">কোনো shareholder-এর ব্যক্তিগত তথ্য বা ব্যাংক তথ্য এখানে দেখানো হয় না</p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>মাস</th><th className="text-right">মোট লাভ</th><th className="text-right">বিতরণযোগ্য</th><th className="text-right">নিট payable</th><th className="text-right">Paid</th><th className="text-right">Unpaid</th><th>Approved</th></tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={7} className="py-12 text-center text-slate-500">লোড হচ্ছে…</td></tr> : data?.distributions.length ? data.distributions.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.month}</td>
                    <td className="text-right font-data">{formatMoney(row.totalProfit)}</td>
                    <td className="text-right font-data">{formatMoney(row.distributableProfit)}</td>
                    <td className="text-right font-data font-semibold">{formatMoney(row.netPayable)}</td>
                    <td className="text-right font-data text-emerald-600">{formatMoney(row.paidAmount)}</td>
                    <td className="text-right font-data text-amber-600">{formatMoney(row.unpaidAmount)}</td>
                    <td>{formatDisplayDate(row.approvedAt)}</td>
                  </tr>
                )) : <tr><td colSpan={7} className="py-12 text-center text-slate-500">Finalized distribution পাওয়া যায়নি</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
