import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface RevenueData {
  summary: {
    totalRevenue: number;
    avgInvoiceValue: number;
    totalInvoices: number;
    totalDiscount: number;
    totalRefund: number;
  };
  dailyTrend: { date: string; revenue: number }[];
  departmentRevenue: { name: string; revenue: number }[];
  paymentModeTrend: { mode: string; amount: number }[];
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-IN');
}

export default function RevenueAnalytics() {
  const { t } = useTranslation(['tenantBilling']);
  const { data, isLoading } = useApiQuery<RevenueData>(
    queryKeys.admin.revenueAnalytics(),
    '/api/admin/analytics/revenue'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('revenueAnalytics.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const summary = data?.summary || { totalRevenue: 0, avgInvoiceValue: 0, totalInvoices: 0, totalDiscount: 0, totalRefund: 0 };
  const dailyTrend = data?.dailyTrend || [];
  const departmentRevenue = data?.departmentRevenue || [];
  const paymentModeTrend = data?.paymentModeTrend || [];

  const hasData = dailyTrend.length > 0 || departmentRevenue.length > 0;

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('revenueAnalytics.title')}</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h3 className="text-sm font-semibold mb-3">{t('revenueAnalytics.filters')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-gray-500">{t('revenueAnalytics.dateRange')}</label>
            <input type="date" className="w-full border rounded px-2 py-1 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('revenueAnalytics.department')}</label>
            <select className="w-full border rounded px-2 py-1 text-sm mt-1">
              <option>{t('revenueAnalytics.allDepartments')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('revenueAnalytics.paymentMode')}</label>
            <select className="w-full border rounded px-2 py-1 text-sm mt-1">
              <option>{t('revenueAnalytics.allModes')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t('revenueAnalytics.doctor')}</label>
            <select className="w-full border rounded px-2 py-1 text-sm mt-1">
              <option>{t('revenueAnalytics.allDoctors')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('revenueAnalytics.totalRevenue')}</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('revenueAnalytics.avgInvoice')}</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.avgInvoiceValue)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('revenueAnalytics.totalInvoices')}</p>
          <p className="text-2xl font-bold">{summary.totalInvoices.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('revenueAnalytics.discount')}</p>
          <p className="text-2xl font-bold text-orange-600">{formatCurrency(summary.totalDiscount)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('revenueAnalytics.refund')}</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalRefund)}</p>
        </div>
      </div>

      {!hasData ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">{t('revenueAnalytics.emptyState')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily Revenue Trend */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-semibold mb-4">{t('revenueAnalytics.dailyTrend')}</h3>
            {dailyTrend.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('revenueAnalytics.noTrendData')}</p>
            ) : (
              <div className="space-y-2">
                {dailyTrend.map((day, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">{day.date}</span>
                    <span className="text-sm font-bold">{formatCurrency(day.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Department Revenue */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-semibold mb-4">{t('revenueAnalytics.departmentRevenue')}</h3>
            {departmentRevenue.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('revenueAnalytics.noDepartmentData')}</p>
            ) : (
              <div className="space-y-2">
                {departmentRevenue.map((dept, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">{dept.name}</span>
                    <span className="text-sm font-bold text-green-600">{formatCurrency(dept.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment Mode */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-semibold mb-4">{t('revenueAnalytics.paymentModeBreakdown')}</h3>
            {paymentModeTrend.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('revenueAnalytics.noPaymentData')}</p>
            ) : (
              <div className="space-y-2">
                {paymentModeTrend.map((pm, i) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">{pm.mode}</span>
                    <span className="text-sm font-bold">{formatCurrency(pm.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
