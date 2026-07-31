import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../../components/DashboardLayout';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';

interface Bed {
  id: string;
  number: string;
  status: string;
  patientName: string | null;
}

interface Ward {
  name: string;
  beds: Bed[];
}

interface Admission {
  id: string;
  patientName: string;
  bedNumber: string;
  wardName: string;
  doctorName: string;
  admissionDate: string;
  diagnosis: string;
  daysAdmitted: number;
}

interface DischargePending {
  id: string;
  patientName: string;
  bedNumber: string;
  wardName: string;
  doctorName: string;
  dischargeApproved: boolean;
  pendingBill: boolean;
}

interface IPDData {
  stats: {
    totalBeds: number;
    occupied: number;
    available: number;
    cleaning: number;
    maintenance: number;
    reserved: number;
    occupancyPercentage: number;
    dischargesToday: number;
    avgStayDays: number;
  };
  wards: Ward[];
  admissions: Admission[];
  dischargePending?: DischargePending[];
}

const VIEW_TABS = ['overview', 'bedMap', 'patientList', 'dischargePending'] as const;
type ViewTab = (typeof VIEW_TABS)[number];

const BED_STATUS_KEYS: Record<string, string> = {
  available: 'available',
  occupied: 'occupied',
  cleaning: 'cleaning',
  maintenance: 'maintenance',
  reserved: 'reserved',
  blocked: 'blocked',
};

const BED_COLORS: Record<string, { bg: string; text: string }> = {
  available: { bg: 'bg-green-100 border-green-300', text: 'text-green-800' },
  occupied: { bg: 'bg-blue-100 border-blue-300', text: 'text-blue-800' },
  cleaning: { bg: 'bg-yellow-100 border-yellow-300', text: 'text-yellow-800' },
  maintenance: { bg: 'bg-orange-100 border-orange-300', text: 'text-orange-800' },
  reserved: { bg: 'bg-purple-100 border-purple-300', text: 'text-purple-800' },
  blocked: { bg: 'bg-red-100 border-red-300', text: 'text-red-800' },
};

function BedCell({ bed }: { bed: Bed }) {
  const { t } = useTranslation();
  const statusKey = BED_STATUS_KEYS[bed.status] ?? 'available';
  const colors = BED_COLORS[bed.status] || BED_COLORS.available;
  return (
    <div className={`border rounded-lg p-3 ${colors.bg} flex flex-col items-center justify-center min-h-[80px]`}>
      <span className={`text-sm font-semibold ${colors.text}`}>{bed.number}</span>
      {bed.patientName && (
        <span className="text-xs text-gray-600 mt-1 text-center truncate w-full">{bed.patientName}</span>
      )}
      <span className={`text-xs mt-1 ${colors.text}`}>{t(`adminMonitor.ipd.bedStatus.${statusKey}`)}</span>
    </div>
  );
}

export default function IPDMonitor() {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<ViewTab>('overview');
  const { data, isLoading } = useApiQuery<IPDData>(
    queryKeys.admin.ipdMonitor(),
    '/api/admissions/stats'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.ipd.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const stats = data?.stats || { totalBeds: 0, occupied: 0, available: 0, cleaning: 0, maintenance: 0, reserved: 0, occupancyPercentage: 0, dischargesToday: 0, avgStayDays: 0 };
  const wards = data?.wards || [];
  const admissions = data?.admissions || [];
  const dischargePending = data?.dischargePending || [];

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.ipd.title')}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.totalBeds')}</p>
          <p className="text-2xl font-bold">{stats.totalBeds}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.occupied')}</p>
          <p className="text-2xl font-bold text-blue-600">{stats.occupied}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.available')}</p>
          <p className="text-2xl font-bold text-green-600">{stats.available}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.occupancy')}</p>
          <p className="text-2xl font-bold text-purple-600">{stats.occupancyPercentage}%</p>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.dischargesToday')}</p>
          <p className="text-2xl font-bold text-indigo-600">{stats.dischargesToday}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.avgStay')}</p>
          <p className="text-2xl font-bold">{stats.avgStayDays}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.cleaning')}</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.cleaning}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.ipd.summary.maintenance')}</p>
          <p className="text-2xl font-bold text-orange-600">{stats.maintenance}</p>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 mb-4">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveView(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeView === tab
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t(`adminMonitor.ipd.viewTabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Bed Map View */}
      {activeView === 'bedMap' && (
        <div className="space-y-6">
          {wards.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-500">{t('adminMonitor.ipd.noWards')}</p>
            </div>
          ) : (
            wards.map((ward) => (
              <div key={ward.name} className="bg-white rounded-lg shadow p-4">
                <h3 className="text-lg font-semibold mb-4">{ward.name}</h3>
                <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {ward.beds.map((bed) => (
                    <BedCell key={bed.id} bed={bed} />
                  ))}
                </div>
              </div>
            ))
          )}
          {/* Legend */}
          <div className="bg-white rounded-lg shadow p-4">
            <h4 className="text-sm font-medium mb-3">{t('adminMonitor.ipd.legend')}</h4>
            <div className="flex flex-wrap gap-4">
              {Object.keys(BED_STATUS_KEYS).map((status) => {
                const colors = BED_COLORS[status];
                return (
                  <div key={status} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded border ${colors.bg}`} />
                    <span className="text-sm">{t(`adminMonitor.ipd.bedStatus.${BED_STATUS_KEYS[status]}`)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Patient List View */}
      {activeView === 'patientList' && (
        <div>
          {admissions.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-500">{t('adminMonitor.ipd.noAdmissions')}</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.patientList.patient')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.patientList.bed')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.patientList.ward')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.patientList.doctor')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.patientList.diagnosis')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.patientList.days')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {admissions.map((adm) => (
                    <tr key={adm.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{adm.patientName}</td>
                      <td className="px-4 py-3 text-sm">{adm.bedNumber}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{adm.wardName}</td>
                      <td className="px-4 py-3 text-sm">{adm.doctorName}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{adm.diagnosis}</td>
                      <td className="px-4 py-3 text-sm">{adm.daysAdmitted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Discharge Pending View */}
      {activeView === 'dischargePending' && (
        <div>
          {dischargePending.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-gray-500">{t('adminMonitor.ipd.noDischargePending')}</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.dischargeTable.patient')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.dischargeTable.bed')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.dischargeTable.ward')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.dischargeTable.doctor')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.dischargeTable.approval')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.ipd.dischargeTable.bill')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {dischargePending.map((dp) => (
                    <tr key={dp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{dp.patientName}</td>
                      <td className="px-4 py-3 text-sm">{dp.bedNumber}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{dp.wardName}</td>
                      <td className="px-4 py-3 text-sm">{dp.doctorName}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${dp.dischargeApproved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          {dp.dischargeApproved ? t('adminMonitor.ipd.dischargeTable.approved') : t('adminMonitor.ipd.dischargeTable.pending')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${dp.pendingBill ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                          {dp.pendingBill ? t('adminMonitor.ipd.dischargeTable.pending') : t('adminMonitor.ipd.dischargeTable.cleared')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Overview (default) */}
      {activeView === 'overview' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">{t('adminMonitor.ipd.overview.quickSummary')}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">{t('adminMonitor.ipd.overview.bedUtilization')}</p>
              <div className="w-full bg-gray-200 rounded-full h-4 mt-1">
                <div
                  className="bg-blue-600 h-4 rounded-full transition-all"
                  style={{ width: `${stats.occupancyPercentage}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">{t('adminMonitor.ipd.overview.occupied', { percent: stats.occupancyPercentage })}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">{t('adminMonitor.ipd.overview.todaysActivity')}</p>
              <p className="text-lg font-bold">{t('adminMonitor.ipd.overview.dischargesCount', { count: stats.dischargesToday })}</p>
              <p className="text-xs text-gray-400">{t('adminMonitor.ipd.overview.avgStayValue', { days: stats.avgStayDays })}</p>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
