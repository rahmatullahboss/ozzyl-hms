import { useState } from 'react';
import { Pill, BarChart3, Archive, AlertTriangle, Star } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, formatToTodayGMT6 } from '../lib/date-utils';

const TODAY = getTodayGMT6();
const MONTH_AGO = formatToTodayGMT6(new Date(Date.now() - 30 * 86400000));

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(5)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function DispensingTab() {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.pharmacyDispensing({ startDate: start, endDate: end }),
    `/api/reports/pharmacy/dispensing-summary?startDate=${start}&endDate=${end}`
  );
  const data = resData?.data ?? [];
  const totalQty = data.reduce((s: number, r: any) => s + (r.total_quantity ?? 0), 0);
  const totalRev  = data.reduce((s: number, r: any) => s + (r.total_revenue ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 flex-wrap items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:dateRange')}:</span>
        <input className="input w-36" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-sm text-[var(--color-text-muted)]">{t('common:to')}</span>
        <input className="input w-36" type="date" value={end} onChange={e => setEnd(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title={t('dashboard:totalItems')} value={data.length}                                  loading={loading} icon={<Pill className="w-5 h-5" />}      iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title={t('pharmacy:totalQty')}  value={totalQty}                                     loading={loading} icon={<Archive className="w-5 h-5" />}    iconBg="bg-violet-50 text-violet-600" index={1} />
        <KPICard title={t('pharmacy:totalRevenue')} value={`৳${totalRev.toLocaleString()}`}              loading={loading} icon={<BarChart3 className="w-5 h-5" />}  iconBg="bg-emerald-50 text-emerald-600" index={2} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('pharmacy:medicine')}</th><th>{t('pharmacy:qtyDispensed')}</th><th>{t('patients:prescriptions')}</th><th>{t('pharmacy:revenue')} (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<BarChart3 className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('common:noData')} description={t('pharmacy:noDispensingRecords')} /></td></tr>
            : data.map((r: any, i: number) => <tr key={i}><td className="font-medium">{r.medicine_name}</td><td className="font-data text-center">{r.total_quantity}</td><td className="font-data text-center">{r.prescription_count ?? '—'}</td><td className="font-data font-medium text-right">৳{(r.total_revenue ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function StockValueTab() {
  const { t } = useTranslation(['pharmacy', 'common']);

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.pharmacyStockValue(),
    '/api/reports/pharmacy/stock-value'
  );
  const data = resData?.data ?? [];
  const totalValue = data.reduce((s: number, r: any) => s + (r.stock_value ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard title={t('pharmacy:totalStockValue')} value={`৳${totalValue.toLocaleString()}`} loading={loading} icon={<Archive className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={0} />
        <KPICard title={t('pharmacy:skusTracked')}      value={data.length}                        loading={loading} icon={<Pill className="w-5 h-5" />}    iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={1} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('pharmacy:medicineCategory')}</th><th>{t('pharmacy:skus')}</th><th>{t('pharmacy:totalQty')}</th><th>{t('pharmacy:stockValue')} (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Archive className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('common:noData')} description={t('pharmacy:noInventoryRecords')} /></td></tr>
            : data.map((r: any, i: number) => <tr key={i}><td className="font-medium">{r.category ?? 'General'}</td><td className="font-data text-center">{r.sku_count}</td><td className="font-data text-center">{r.total_quantity}</td><td className="font-data font-semibold text-right">৳{(r.stock_value ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

function ExpiryTab() {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [days, setDays] = useState('90');

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.pharmacyExpiry(days),
    `/api/reports/pharmacy/expiry-alerts?days=${days}`
  );
  const data = resData?.data ?? [];
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('pharmacy:expiringWithin')}:</span>
        <select className="input w-28" value={days} onChange={e => setDays(e.target.value)}>
          <option value="30">30 {t('pharmacy:daysLeft')}</option>
          <option value="60">60 {t('pharmacy:daysLeft')}</option>
          <option value="90">90 {t('pharmacy:daysLeft')}</option>
          <option value="180">180 {t('pharmacy:daysLeft')}</option>
        </select>
        {data.length > 0 && <span className="ml-auto text-sm font-semibold text-amber-600">{data.length} {t('pharmacy:atRisk')}</span>}
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('pharmacy:medicine')}</th><th>{t('pharmacy:batch')}</th><th>{t('pharmacy:qty')}</th><th>{t('pharmacy:expiryDate')}</th><th>{t('pharmacy:daysLeft')}</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : data.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<AlertTriangle className="w-8 h-8 text-emerald-500" />} title={t('pharmacy:reports.expiryAlerts')} description={t('pharmacy:noExpiryAlerts')} /></td></tr>
            : data.map((r: any, i: number) => {
              const daysLeft = r.days_to_expiry ?? 0;
              const cls = daysLeft <= 30 ? 'text-red-600 font-semibold' : daysLeft <= 60 ? 'text-amber-600' : 'text-[var(--color-text-secondary)]';
              return <tr key={i}><td className="font-medium">{r.medicine_name}</td><td className="font-data text-sm">{r.batch_no ?? '—'}</td><td className="font-data text-center">{r.quantity}</td><td className="font-data text-sm">{r.expiry_date}</td><td className={`font-data font-semibold ${cls}`}>{daysLeft}d</td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function TopDispensedTab() {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const [limit, setLimit] = useState('10');

  const { data: resData, isLoading: loading } = useApiQuery<{ data: any[] }>(
    queryKeys.reports.pharmacyTopDispensed({ startDate: start, endDate: end, limit }),
    `/api/reports/pharmacy/top-dispensed?startDate=${start}&endDate=${end}&limit=${limit}`
  );
  const data = resData?.data ?? [];
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 flex-wrap items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:dateRange')}:</span>
        <input className="input w-36" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-sm text-[var(--color-text-muted)]">{t('common:to')}</span>
        <input className="input w-36" type="date" value={end} onChange={e => setEnd(e.target.value)} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-secondary)]">{t('common:showTop')}:</span>
          <select className="input w-24" value={limit} onChange={e => setLimit(e.target.value)}>
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </div>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>#</th><th>{t('pharmacy:medicine')}</th><th>{t('pharmacy:qtyDispensed')}</th><th>{t('pharmacy:revenue')} (৳)</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Star className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('common:noData')} description={t('pharmacy:noDispensingRecords')} /></td></tr>
            : data.map((r: any, i: number) => <tr key={i}><td className="font-data font-semibold text-[var(--color-primary)]">{i + 1}</td><td className="font-medium">{r.medicine_name}</td><td className="font-data text-center">{r.total_quantity}</td><td className="font-data font-medium text-right">৳{(r.total_revenue ?? 0).toLocaleString()}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  dispensing: DispensingTab, stock: StockValueTab, expiry: ExpiryTab, top: TopDispensedTab,
};

export default function ReportPharmacyPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common', 'dashboard']);
  const [activeTab, setActiveTab] = useState('dispensing');
  const TabComponent = TAB_MAP[activeTab];

  const TABS = [
    { key: 'dispensing', label: t('pharmacy:reports.dispensingSummary'), icon: BarChart3     },
    { key: 'stock',      label: t('pharmacy:stockValue'),         icon: Archive       },
    { key: 'expiry',     label: t('pharmacy:reports.expiryAlerts'),       icon: AlertTriangle },
    { key: 'top',        label: t('pharmacy:reports.topDispensed'),       icon: Star          },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
              <Pill className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('sidebar:pharmacyReports')}</h1>
              <p className="section-subtitle">{t('pharmacy:dispensaryStockView')}</p>
            </div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{tab.label}</button>
          ); })}
        </div>
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}
