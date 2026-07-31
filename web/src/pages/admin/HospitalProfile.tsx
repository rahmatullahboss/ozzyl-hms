import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { safeT } from '../../lib/kpiLabels';

interface HospitalInfo {
  name: string;
  address: string;
  hotline: string;
  email: string;
  website: string;
  registrationNumber: string;
  logo: string;
  branchCount: number;
  departmentCount: number;
  bedCount: number;
  establishedYear: number;
}

export default function HospitalProfile() {
  const { t } = useTranslation('adminSettings');
  const tr = (key: string, fallback: string) => safeT(t, key, fallback);

  const { data, isLoading } = useApiQuery<HospitalInfo>(
    queryKeys.admin.hospitalProfile(),
    `/api/admin/hospital-profile`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{tr('hospitalProfile.loading', 'Loading...')}</div></DashboardLayout>;
  }

  const info = data ?? { name: '', address: '', hotline: '', email: '', website: '', registrationNumber: '', logo: '', branchCount: 0, departmentCount: 0, bedCount: 0, establishedYear: 0 };

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{tr('hospitalProfile.title', 'Hospital Profile')}</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h2 className="text-lg font-semibold">{tr('hospitalProfile.basicInformation', 'Basic Information')}</h2>
            <div className="space-y-3">
              <div><span className="text-sm text-gray-500">{tr('hospitalProfile.hospitalName', 'Hospital Name')}</span><div className="font-medium">{info.name || '-'}</div></div>
              <div><span className="text-sm text-gray-500">{tr('hospitalProfile.address', 'Address')}</span><div className="font-medium">{info.address || '-'}</div></div>
              <div><span className="text-sm text-gray-500">{tr('hospitalProfile.hotline', 'Hotline')}</span><div className="font-medium">{info.hotline || '-'}</div></div>
              <div><span className="text-sm text-gray-500">{tr('hospitalProfile.email', 'Email')}</span><div className="font-medium">{info.email || '-'}</div></div>
              <div><span className="text-sm text-gray-500">{tr('hospitalProfile.website', 'Website')}</span><div className="font-medium">{info.website || '-'}</div></div>
              <div><span className="text-sm text-gray-500">{tr('hospitalProfile.registrationNumber', 'Registration Number')}</span><div className="font-medium">{info.registrationNumber || '-'}</div></div>
            </div>
          </div>

          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h2 className="text-lg font-semibold">{tr('hospitalProfile.quickStats', 'Quick Stats')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{info.branchCount}</div>
                <div className="text-sm text-gray-500">{tr('hospitalProfile.branches', 'Branches')}</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{info.departmentCount}</div>
                <div className="text-sm text-gray-500">{tr('hospitalProfile.departments', 'Departments')}</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-purple-600">{info.bedCount}</div>
                <div className="text-sm text-gray-500">{tr('hospitalProfile.beds', 'Beds')}</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-orange-600">{info.establishedYear || '-'}</div>
                <div className="text-sm text-gray-500">{tr('hospitalProfile.established', 'Established')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
