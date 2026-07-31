import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery } from '../../hooks/useApiQuery';

const REPORTS = [
  ['current_stock', 'reports.currentStock'],
  ['stock_valuation', 'reports.stockValuation'],
  ['low_stock', 'reports.lowStock'],
  ['out_of_stock', 'reports.outOfStock'],
  ['expiry', 'reports.expiry'],
  ['expired_stock', 'reports.expiredStock'],
  ['item_movement_ledger', 'reports.itemMovementLedger'],
  ['department_consumption', 'reports.departmentConsumption'],
  ['patient_consumption', 'reports.patientConsumption'],
  ['stock_adjustment', 'reports.stockAdjustment'],
  ['stock_count_variance', 'reports.stockCountVariance'],
  ['asset_register', 'reports.assetRegister'],
  ['asset_maintenance', 'reports.assetMaintenance'],
  ['fast_moving_items', 'reports.fastMovingItems'],
  ['dead_stock', 'reports.deadStock'],
] as const;

interface ReportResponse { reportType: string; data: Record<string, unknown>[]; generatedAt: string; }

export function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function InventoryReportsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantPharmacy']);
  const [reportType, setReportType] = useState<(typeof REPORTS)[number][0]>('current_stock');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [storeId, setStoreId] = useState('');

  const params = new URLSearchParams();
  if (fromDate) params.set('FromDate', fromDate);
  if (toDate) params.set('ToDate', toDate);
  if (storeId) params.set('StoreId', storeId);
  const queryString = params.toString();
  const path = `/api/inventory/reports/${reportType}${queryString ? `?${queryString}` : ''}`;
  const { data, isLoading, isFetching, refetch } = useApiQuery<ReportResponse>(['inventory', 'report', reportType, fromDate, toDate, storeId], path);
  const rows = data?.data ?? [];
  const columns = useMemo(() => Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach(key => set.add(key));
    return set;
  }, new Set<string>())), [rows]);
  const csvPath = `/api/inventory/reports/${reportType}?${new URLSearchParams({ ...Object.fromEntries(params), format: 'csv' }).toString()}`;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><FileSpreadsheet className="w-6 h-6 inline mr-2" />{t('inventory.reports.title')}</h1>
            <p className="section-subtitle">{t('inventory.reports.subtitle')}</p>
          </div>
          <a href={csvPath} className="btn-secondary text-sm"><Download className="w-4 h-4" /> {t('inventory.reports.csv')}</a>
        </div>

        <div className="card p-5 grid grid-cols-1 md:grid-cols-5 gap-4">
          <div><label className="label">{t('inventory.reports.reportLabel')}</label><select className="input" value={reportType} onChange={e => setReportType(e.target.value as (typeof REPORTS)[number][0])}>{REPORTS.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select></div>
          <div><label className="label">{t('inventory.reports.fromDate')}</label><input className="input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><label className="label">{t('inventory.reports.toDate')}</label><input className="input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div><label className="label">{t('inventory.reports.storeId')}</label><input className="input" inputMode="numeric" value={storeId} onChange={e => setStoreId(e.target.value)} /></div>
          <div className="flex items-end"><button className="btn-secondary w-full" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="w-4 h-4" /> {t('inventory.reports.refresh')}</button></div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h3 className="font-semibold">{t(REPORTS.find(([value]) => value === reportType)?.[1] || '')}</h3>
            <span className="text-xs text-[var(--color-text-muted)]">{data?.generatedAt ? `${t('inventory.reports.generated')} ${new Date(data.generatedAt).toLocaleString()}` : ''}</span>
          </div>
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-6 space-y-2">{[...Array(6)].map((_, idx) => <div key={idx} className="skeleton h-10 rounded" />)}</div>
            ) : rows.length === 0 ? (
              <div className="p-8"><EmptyState icon={<FileSpreadsheet className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('inventory.reports.noData')} description="" /></div>
            ) : (
              <table className="table-base">
                <thead><tr>{columns.map(column => <th key={column}>{column.replace(/_/g, ' ')}</th>)}</tr></thead>
                <tbody>{rows.map((row, idx) => <tr key={idx}>{columns.map(column => <td key={column} className={typeof row[column] === 'number' ? 'font-data text-right' : ''}>{cellValue(row[column])}</td>)}</tr>)}</tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
