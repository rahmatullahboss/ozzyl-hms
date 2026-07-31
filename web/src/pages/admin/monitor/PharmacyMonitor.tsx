import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../../components/DashboardLayout';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatDisplayDate } from '../../../lib/date-utils';

interface LowStockItem {
  id: string;
  name: string;
  currentStock: number;
  reorderLevel: number;
  category: string;
}

interface ExpiringItem {
  id: string;
  name: string;
  expiryDate: string;
  daysUntilExpiry: number;
  batchNumber: string;
  quantity: number;
}

interface PharmacyData {
  summary: {
    todaySales: number;
    todaySalesCount: number;
    grossMargin: number;
    totalInvestment: number;
    totalIncome: number;
    grossProfit: number;
    totalMedicines: number;
    lowStockCount: number;
    expiringCount: number;
  };
  lowStockItems: LowStockItem[];
  expiringItems: ExpiringItem[];
  pendingPurchaseRequests: number;
  todayReturns: number;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-IN');
}

export default function PharmacyMonitor() {
  const { t } = useTranslation();
  const { data, isLoading } = useApiQuery<PharmacyData>(
    queryKeys.admin.pharmacyMonitor(),
    '/api/pharmacy/summary'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.pharmacy.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="animate-pulse bg-gray-200 h-48 rounded-lg" />
          <div className="animate-pulse bg-gray-200 h-48 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  const summary = data?.summary || {
    todaySales: 0, todaySalesCount: 0, grossMargin: 0,
    totalInvestment: 0, totalIncome: 0, grossProfit: 0,
    totalMedicines: 0, lowStockCount: 0, expiringCount: 0,
  };
  const lowStockItems = data?.lowStockItems || [];
  const expiringItems = data?.expiringItems || [];
  const pendingPurchaseRequests = data?.pendingPurchaseRequests || 0;
  const todayReturns = data?.todayReturns || 0;

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.pharmacy.title')}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.pharmacy.summary.todaySales')}</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.todaySales)}</p>
          <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.summary.todayInvoices', { count: summary.todaySalesCount })}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.pharmacy.summary.grossMargin')}</p>
          <p className="text-2xl font-bold text-blue-600">{summary.grossMargin}%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.pharmacy.summary.lowStock')}</p>
          <p className="text-2xl font-bold text-red-600">{summary.lowStockCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.pharmacy.summary.nearExpiry')}</p>
          <p className="text-2xl font-bold text-orange-600">{summary.expiringCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.pharmacy.summary.pendingPRs')}</p>
          <p className="text-2xl font-bold text-yellow-600">{pendingPurchaseRequests}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.pharmacy.summary.todayReturns')}</p>
          <p className="text-2xl font-bold text-gray-600">{formatCurrency(todayReturns)}</p>
        </div>
      </div>

      {/* Investment Overview */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-500 mb-3">{t('adminMonitor.pharmacy.inventoryOverview')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.investment.total')}</p>
            <p className="text-lg font-bold">{formatCurrency(summary.totalInvestment)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.investment.income')}</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(summary.totalIncome)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.investment.profit')}</p>
            <p className="text-lg font-bold text-blue-600">{formatCurrency(summary.grossProfit)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.investment.medicines')}</p>
            <p className="text-lg font-bold">{summary.totalMedicines}</p>
          </div>
        </div>
      </div>

      {/* Low Stock + Expiring Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-100">
            <h3 className="text-sm font-semibold text-red-800">{t('adminMonitor.pharmacy.lowStockAlert')}</h3>
          </div>
          {lowStockItems.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">{t('adminMonitor.pharmacy.noLowStock')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {lowStockItems.map((item) => (
                <div key={item.id} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-gray-400">{item.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-600">{item.currentStock} / {item.reorderLevel}</p>
                    <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.currentReorder')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expiring */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-orange-50 border-b border-orange-100">
            <h3 className="text-sm font-semibold text-orange-800">{t('adminMonitor.pharmacy.nearExpiryAlert')}</h3>
          </div>
          {expiringItems.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">{t('adminMonitor.pharmacy.noExpiring')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {expiringItems.map((item) => (
                <div key={item.id} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-gray-400">{t('adminMonitor.pharmacy.batchQty', { batch: item.batchNumber, qty: item.quantity })}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${item.daysUntilExpiry <= 30 ? 'text-red-600' : 'text-orange-600'}`}>
                      {t('adminMonitor.pharmacy.days', { count: item.daysUntilExpiry })}
                    </p>
                    <p className="text-xs text-gray-400">{formatDisplayDate(item.expiryDate)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
