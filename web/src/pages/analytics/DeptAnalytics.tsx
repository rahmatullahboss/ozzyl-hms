import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';

interface DepartmentData {
  id: string;
  name: string;
  revenue: number;
  patientCount: number;
  avgBillValue: number;
  discount: number;
  refund: number;
  netRevenue: number;
}

interface DeptAnalyticsData {
  departments: DepartmentData[];
  summary?: { totalRevenue: number; totalPatients: number; topDepartment: string; avgBillValue: number };
}

export default function DeptAnalytics() {
  const { t } = useTranslation();

  const { data, isLoading } = useApiQuery<DeptAnalyticsData>(
    queryKeys.admin.deptAnalytics(),
    `/api/admin/analytics/departments`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('Loading...')}</div></DashboardLayout>;
  }

  const departments = data?.departments ?? [];
  const summary = data?.summary;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('Department Performance')}</h1>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Total Revenue')}</div>
              <div className="text-2xl font-bold text-blue-600">৳{summary.totalRevenue.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Total Patients')}</div>
              <div className="text-2xl font-bold text-green-600">{summary.totalPatients}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Top Department')}</div>
              <div className="text-lg font-bold text-purple-600">{summary.topDepartment}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Avg Bill Value')}</div>
              <div className="text-2xl font-bold text-orange-600">৳{summary.avgBillValue.toLocaleString()}</div>
            </div>
          </div>
        )}

        {departments.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('No department data found')}</div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Department</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Revenue</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Patients</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Avg Bill</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Discount</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Refund</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Net Revenue</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((dept) => (
                  <tr key={dept.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">{dept.name}</td>
                    <td className="py-3 px-4 text-sm text-right">৳{dept.revenue.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-right">{dept.patientCount}</td>
                    <td className="py-3 px-4 text-sm text-right">৳{dept.avgBillValue.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-right text-yellow-600">৳{dept.discount.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-right text-red-600">৳{dept.refund.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-right font-medium text-green-600">৳{dept.netRevenue.toLocaleString()}</td>
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
