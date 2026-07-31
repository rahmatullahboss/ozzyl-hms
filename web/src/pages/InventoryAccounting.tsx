import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Calculator, RefreshCw, FileText, TrendingUp, TrendingDown, ArrowRightLeft, Package } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { apiFetch } from '../lib/apiClient';
import { formatDisplayDate } from '../lib/date-utils';

interface InventoryValuation {
  store_name: string;
  item_count: number;
  total_quantity: number;
  total_value: number;
  avg_cost: number;
}

interface InventoryTransaction {
  id: number;
  transaction_type: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  transaction_date: string;
  store_name: string;
  reference_no: string;
  notes?: string;
}

interface InventorySummary {
  totalStockValue: number;
  totalPurchases: number;
  totalIssued: number;
  totalWrittenOff: number;
  netChange: number;
}

export default function InventoryAccounting({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'summary' | 'transactions' | 'valuation'>('summary');
  const [days, setDays] = useState('30');

  const { data: valuation, isLoading: valLoading } = useApiQuery<{ data: InventoryValuation[] }>(
    queryKeys.inventory.valuation(),
    '/api/inventory-accounting/valuation',
    { enabled: activeTab === 'valuation' },
  );

  const { data: summary, isLoading: sumLoading } = useApiQuery<InventorySummary>(
    queryKeys.inventory.accountingSummary(),
    '/api/inventory-accounting/summary',
    { enabled: activeTab === 'summary' },
  );

  const { data: transactions, isLoading: txnLoading } = useApiQuery<{ data: InventoryTransaction[] }>(
    queryKeys.inventory.accountingTransactions(Number(days)),
    `/api/inventory-accounting/transactions?days=${days}`,
    { enabled: activeTab === 'transactions' },
  );

  const TABS = [
    { key: 'summary' as const, label: t('inventoryAccounting.summary', 'Summary'), icon: <Calculator className="w-4 h-4" /> },
    { key: 'transactions' as const, label: t('inventoryAccounting.transactions', 'Transactions'), icon: <ArrowRightLeft className="w-4 h-4" /> },
    { key: 'valuation' as const, label: t('inventoryAccounting.valuation', 'Valuation'), icon: <Package className="w-4 h-4" /> },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Calculator className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('inventoryAccounting.title', 'Inventory Accounting')}</h1>
              <p className="section-subtitle">{t('inventoryAccounting.subtitle', 'Track inventory value, purchases, issues, and write-offs')}</p>
            </div>
          </div>
        </div>

        <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-800 p-2 hide-scrollbar">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
              }`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'summary' && (
          <div className="space-y-4">
            {sumLoading ? (
              <div className="text-center py-8 text-gray-500">{t('common:loading')}</div>
            ) : summary ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KPICard title={t('inventoryAccounting.totalValue', 'Total Stock Value')} value={`${Number(summary.totalStockValue).toFixed(2)}`} icon={<Package className="w-5 h-5 text-indigo-600" />} />
                <KPICard title={t('inventoryAccounting.totalPurchases', 'Total Purchases')} value={`${Number(summary.totalPurchases).toFixed(2)}`} icon={<TrendingUp className="w-5 h-5 text-green-600" />} />
                <KPICard title={t('inventoryAccounting.totalIssued', 'Total Issued')} value={`${Number(summary.totalIssued).toFixed(2)}`} icon={<TrendingDown className="w-5 h-5 text-amber-600" />} />
              </div>
            ) : (
              <EmptyState icon={<Package className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('inventoryAccounting.noData', 'No summary data available')} description="" />
            )}
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="label text-sm">{t('inventoryAccounting.days', 'Days')}:</label>
              <select value={days} onChange={e => setDays(e.target.value)} className="input w-24 text-sm">
                <option value="7">7</option><option value="30">30</option><option value="90">90</option><option value="365">365</option>
              </select>
            </div>
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <table className="table-base">
                <thead><tr><th>{t('inventoryAccounting.date', 'Date')}</th><th>{t('inventoryAccounting.type', 'Type')}</th><th>{t('inventoryAccounting.item', 'Item')}</th><th>{t('inventoryAccounting.qty', 'Qty')}</th><th>{t('inventoryAccounting.price', 'Price')}</th><th>{t('inventoryAccounting.total', 'Total')}</th><th>{t('inventoryAccounting.store', 'Store')}</th></tr></thead>
                <tbody>
                  {txnLoading ? (
                    <tr><td colSpan={7} className="text-center py-4 text-gray-500">{t('common:loading')}</td></tr>
                  ) : !transactions?.data?.length ? (
                    <tr><td colSpan={7} className="text-center py-8"><EmptyState icon={<ArrowRightLeft className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('inventoryAccounting.noTransactions', 'No transactions')} description="" /></td></tr>
                  ) : transactions.data.map((txn, i) => (
                    <tr key={txn.id || i}>
                      <td className="text-xs">{txn.transaction_date ? formatDisplayDate(txn.transaction_date) : '-'}</td>
                      <td><span className={`badge text-xs ${txn.transaction_type === 'purchase' ? 'bg-green-100 text-green-700' : txn.transaction_type === 'issue' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>{txn.transaction_type}</span></td>
                      <td>{txn.item_name}</td>
                      <td>{txn.quantity}</td>
                      <td>{Number(txn.unit_price).toFixed(2)}</td>
                      <td className="font-medium">{Number(txn.total_amount).toFixed(2)}</td>
                      <td>{txn.store_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'valuation' && (
          <div className="space-y-4">
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
              <table className="table-base">
                <thead><tr><th>{t('inventoryAccounting.store', 'Store')}</th><th>{t('inventoryAccounting.items', 'Items')}</th><th>{t('inventoryAccounting.qty', 'Total Qty')}</th><th>{t('inventoryAccounting.value', 'Total Value')}</th><th>{t('inventoryAccounting.avgCost', 'Avg Cost')}</th></tr></thead>
                <tbody>
                  {valLoading ? (
                    <tr><td colSpan={5} className="text-center py-4 text-gray-500">{t('common:loading')}</td></tr>
                  ) : !valuation?.data?.length ? (
                    <tr><td colSpan={5} className="text-center py-8"><EmptyState icon={<Package className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('inventoryAccounting.noValuation', 'No valuation data')} description="" /></td></tr>
                  ) : valuation.data.map(v => (
                    <tr key={v.store_name}>
                      <td className="font-medium">{v.store_name}</td>
                      <td>{v.item_count}</td>
                      <td>{v.total_quantity}</td>
                      <td className="font-medium">{Number(v.total_value).toFixed(2)}</td>
                      <td>{Number(v.avg_cost).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
