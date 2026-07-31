import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface ExecutiveData {
  financial: {
    revenue: number;
    expense: number;
    netCollection: number;
    discount: number;
    refund: number;
  };
  patients: {
    total: number;
    newThisMonth: number;
    growthPercent: number;
  };
  departments: { name: string; revenue: number }[];
  doctors: { name: string; revenue: number; patients: number }[];
  bedOccupancy: { total: number; occupied: number; percentage: number };
  pharmacy: { todaySales: number; monthlySales: number };
  dueAging: { current: number; thirtyDays: number; sixtyDays: number; ninetyPlus: number };
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-IN');
}

export default function ExecutiveOverview() {
  const { t } = useTranslation(['tenantDashboard']);
  const { data, isLoading } = useApiQuery<ExecutiveData>(
    queryKeys.admin.executiveOverview(),
    '/api/admin/analytics/executive'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('executiveOverview.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
          <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
        </div>
      </DashboardLayout>
    );
  }

  const fin = data?.financial || { revenue: 0, expense: 0, netCollection: 0, discount: 0, refund: 0 };
  const patients = data?.patients || { total: 0, newThisMonth: 0, growthPercent: 0 };
  const departments = data?.departments || [];
  const doctors = data?.doctors || [];
  const bed = data?.bedOccupancy || { total: 0, occupied: 0, percentage: 0 };
  const pharmacy = data?.pharmacy || { todaySales: 0, monthlySales: 0 };
  const due = data?.dueAging || { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyPlus: 0 };

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('executiveOverview.title')}</h1>

      {/* Financial Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.revenue')}</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(fin.revenue)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.expense')}</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(fin.expense)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.netCollection')}</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(fin.netCollection)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.discount')}</p>
          <p className="text-2xl font-bold text-orange-600">{formatCurrency(fin.discount)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.refund')}</p>
          <p className="text-2xl font-bold text-gray-600">{formatCurrency(fin.refund)}</p>
        </div>
      </div>

      {/* Patient + Bed + Pharmacy */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.totalPatients')}</p>
          <p className="text-2xl font-bold">{patients.total.toLocaleString()}</p>
          <p className="text-xs text-green-600">
            {t('executiveOverview.growthPercent', { percent: patients.growthPercent })}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.newThisMonth')}</p>
          <p className="text-2xl font-bold text-purple-600">{patients.newThisMonth}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.bedOccupancy')}</p>
          <p className="text-2xl font-bold text-blue-600">{bed.percentage}%</p>
          <p className="text-xs text-gray-400">
            {t('executiveOverview.bedsCount', { occupied: bed.occupied, total: bed.total })}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('executiveOverview.pharmacyMonthly')}</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(pharmacy.monthlySales)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Department Revenue */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h3 className="text-sm font-semibold">{t('executiveOverview.departmentRevenue')}</h3>
          </div>
          {departments.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">{t('executiveOverview.noDepartmentData')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {departments.map((dept, i) => (
                <div key={i} className="px-4 py-3 flex justify-between items-center">
                  <span className="text-sm font-medium">{dept.name}</span>
                  <span className="text-sm font-bold text-green-600">{formatCurrency(dept.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Doctors */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b">
            <h3 className="text-sm font-semibold">{t('executiveOverview.topDoctors')}</h3>
          </div>
          {doctors.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-gray-500">{t('executiveOverview.noDoctorData')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {doctors.map((doc, i) => (
                <div key={i} className="px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium">{doc.name}</p>
                    <p className="text-xs text-gray-400">
                      {t('executiveOverview.patientsCount', { count: doc.patients })}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-green-600">{formatCurrency(doc.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Due Aging */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-semibold mb-4">{t('executiveOverview.dueAging')}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-400">{t('executiveOverview.dueCurrent')}</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(due.current)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{t('executiveOverview.due30')}</p>
            <p className="text-lg font-bold text-yellow-600">{formatCurrency(due.thirtyDays)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{t('executiveOverview.due60')}</p>
            <p className="text-lg font-bold text-orange-600">{formatCurrency(due.sixtyDays)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">{t('executiveOverview.due90')}</p>
            <p className="text-lg font-bold text-red-600">{formatCurrency(due.ninetyPlus)}</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
