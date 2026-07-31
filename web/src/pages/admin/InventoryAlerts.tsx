import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';

interface StockAlert {
  id: string;
  item: string;
  category: string;
  currentStock: number;
  reorderLevel: number;
  batch: string;
  expiry: string;
  status: string;
}

interface InventoryAlertsData {
  alerts: StockAlert[];
  summary?: { lowStock: number; outOfStock: number; expiring30: number; expiring90: number; expired: number };
}

const ALERT_TABS = ['All', 'Low Stock', 'Out of Stock', 'Expiring Soon', 'Expired'] as const;
type AlertTab = (typeof ALERT_TABS)[number];

const TAB_KEYS: Record<AlertTab, string> = {
  'All': 'all', 'Low Stock': 'low', 'Out of Stock': 'out', 'Expiring Soon': 'expiring', 'Expired': 'expired',
};

const STATUS_BADGE: Record<string, string> = {
  low: 'bg-yellow-100 text-yellow-700',
  out: 'bg-red-100 text-red-700',
  expiring: 'bg-orange-100 text-orange-700',
  expired: 'bg-red-100 text-red-700',
};

export default function InventoryAlerts() {
  const { t } = useTranslation('adminStock');
  const [activeTab, setActiveTab] = useState<AlertTab>('All');

  const { data, isLoading } = useApiQuery<InventoryAlertsData>(
    queryKeys.admin.inventoryAlerts(),
    `/api/admin/inventory/alerts`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('inventoryAlerts.loading')}</div></DashboardLayout>;
  }

  const alerts = data?.alerts ?? [];
  const summary = data?.summary;
  const filtered = activeTab === 'All' ? alerts : alerts.filter((a) => a.status === TAB_KEYS[activeTab]);

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('inventoryAlerts.title')}</h1>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('inventoryAlerts.summary.lowStock')}</div>
              <div className="text-2xl font-bold text-yellow-600">{summary.lowStock}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('inventoryAlerts.summary.outOfStock')}</div>
              <div className="text-2xl font-bold text-red-600">{summary.outOfStock}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('inventoryAlerts.summary.expiring30')}</div>
              <div className="text-2xl font-bold text-orange-600">{summary.expiring30}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('inventoryAlerts.summary.expiring90')}</div>
              <div className="text-2xl font-bold text-yellow-600">{summary.expiring90}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('inventoryAlerts.summary.expired')}</div>
              <div className="text-2xl font-bold text-red-600">{summary.expired}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {ALERT_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t(`inventoryAlerts.tabs.${TAB_KEYS[tab]}`)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('inventoryAlerts.empty')}</div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.item')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.category')}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.current')}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.reorder')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.batch')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.expiry')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('inventoryAlerts.table.status')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((alert) => (
                  <tr key={alert.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">{alert.item}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{alert.category}</td>
                    <td className="py-3 px-4 text-sm text-right">{alert.currentStock}</td>
                    <td className="py-3 px-4 text-sm text-right text-gray-600">{alert.reorderLevel}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{alert.batch}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{alert.expiry}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_BADGE[alert.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t(`inventoryAlerts.statusLabels.${alert.status}`, { defaultValue: alert.status })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
