import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';

interface InventoryStats {
  totalItems: number;
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  pendingPOCount: number;
  topCategories: { name: string; value: number; count: number }[];
  recentAdjustments: number;
}

export default function InventoryAnalytics() {
  const { t } = useTranslation();

  const { data, isLoading } = useApiQuery<InventoryStats>(
    queryKeys.admin.inventoryAnalytics(),
    `/api/admin/analytics/inventory`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('Loading...')}</div></DashboardLayout>;
  }

  const stats = data ?? { totalItems: 0, totalValue: 0, lowStockCount: 0, outOfStockCount: 0, expiringSoonCount: 0, expiredCount: 0, pendingPOCount: 0, topCategories: [], recentAdjustments: 0 };

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('Inventory Analytics')}</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Total Items')}</div>
            <div className="text-2xl font-bold text-blue-600">{stats.totalItems.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Stock Value')}</div>
            <div className="text-2xl font-bold text-green-600">৳{stats.totalValue.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Low Stock')}</div>
            <div className="text-2xl font-bold text-yellow-600">{stats.lowStockCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Out of Stock')}</div>
            <div className="text-2xl font-bold text-red-600">{stats.outOfStockCount}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Expiring Soon')}</div>
            <div className="text-2xl font-bold text-orange-600">{stats.expiringSoonCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Expired')}</div>
            <div className="text-2xl font-bold text-red-600">{stats.expiredCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Pending PO')}</div>
            <div className="text-2xl font-bold text-purple-600">{stats.pendingPOCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">{t('Recent Adjustments')}</div>
            <div className="text-2xl font-bold text-gray-600">{stats.recentAdjustments}</div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-4">{t('Top Categories by Value')}</h3>
          {stats.topCategories.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">{t('No category data available')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Category</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Items</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topCategories.map((cat, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium">{cat.name}</td>
                      <td className="py-3 px-4 text-sm text-right">{cat.count}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium">৳{cat.value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
