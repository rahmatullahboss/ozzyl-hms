import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';

interface DoctorData {
  id: string;
  name: string;
  department: string;
  opdVisits: number;
  procedures: number;
  revenue: number;
  avgBillValue: number;
  patientSatisfaction: number;
}

interface DoctorAnalyticsData {
  doctors: DoctorData[];
  summary?: { totalDoctors: number; totalRevenue: number; topDoctor: string; avgVisitsPerDoctor: number };
}

export default function DoctorAnalytics() {
  const { t } = useTranslation();

  const { data, isLoading } = useApiQuery<DoctorAnalyticsData>(
    queryKeys.admin.doctorAnalytics(),
    `/api/admin/analytics/doctors`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('Loading...')}</div></DashboardLayout>;
  }

  const doctors = data?.doctors ?? [];
  const summary = data?.summary;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('Doctor Performance')}</h1>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Total Doctors')}</div>
              <div className="text-2xl font-bold text-blue-600">{summary.totalDoctors}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Total Revenue')}</div>
              <div className="text-2xl font-bold text-green-600">৳{summary.totalRevenue.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Top Doctor')}</div>
              <div className="text-lg font-bold text-purple-600">{summary.topDoctor}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('Avg Visits/Doctor')}</div>
              <div className="text-2xl font-bold text-orange-600">{summary.avgVisitsPerDoctor}</div>
            </div>
          </div>
        )}

        {doctors.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('No doctor data found')}</div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Doctor</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Department</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">OPD Visits</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Procedures</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Revenue</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">Avg Bill</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map((doc) => (
                  <tr key={doc.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">{doc.name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{doc.department}</td>
                    <td className="py-3 px-4 text-sm text-right">{doc.opdVisits}</td>
                    <td className="py-3 px-4 text-sm text-right">{doc.procedures}</td>
                    <td className="py-3 px-4 text-sm text-right font-medium">৳{doc.revenue.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-right">৳{doc.avgBillValue.toLocaleString()}</td>
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
