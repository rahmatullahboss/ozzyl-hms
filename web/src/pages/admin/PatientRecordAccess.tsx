import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { formatDateTime } from '../../lib/format';
import { useSearchParams } from 'react-router';


interface RecordAccess {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  patientName: string;
  patientId: string;
  action: string;
  module: string;
  ip: string;
}

interface AccessData {
  accesses: RecordAccess[];
  summary?: { totalViews: number; uniquePatients: number; uniqueUsers: number };
}

const ACTION_TABS = ['All', 'Viewed', 'Edited', 'Printed', 'Exported'] as const;
type ActionTab = (typeof ACTION_TABS)[number];

const ACTION_MAP: Record<Exclude<ActionTab, 'All'>, string> = {
  'Viewed': 'view', 'Edited': 'edit', 'Printed': 'print', 'Exported': 'export',
};

const ACTION_BADGE: Record<string, string> = {
  view: 'bg-blue-100 text-blue-700',
  edit: 'bg-yellow-100 text-yellow-700',
  print: 'bg-purple-100 text-purple-700',
  export: 'bg-red-100 text-red-700',
};

export default function PatientRecordAccess() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as ActionTab | null;
  const isValidTab = (val: string | null): val is ActionTab =>
    val !== null && ACTION_TABS.includes(val as ActionTab);
  const [activeTab, setActiveTabRaw] = useState<ActionTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'All';
    }
    return isValidTab(tabParam) ? tabParam : 'All';
  });
  const setActiveTab = (tab: ActionTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<AccessData>(
    queryKeys.admin.patientRecordAccess(),
    `/api/admin/patient-record-access`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('patientRecordAccess.loading')}</div></DashboardLayout>;
  }

  const accesses = data?.accesses ?? [];
  const summary = data?.summary;
  const filtered = activeTab === 'All' ? accesses : accesses.filter((a) => a.action === ACTION_MAP[activeTab as keyof typeof ACTION_MAP]);

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('patientRecordAccess.title')}</h1>
        <p className="text-sm text-gray-500">{t('patientRecordAccess.subtitle')}</p>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('patientRecordAccess.summary.totalViews')}</div>
              <div className="text-2xl font-bold">{summary.totalViews}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('patientRecordAccess.summary.uniquePatients')}</div>
              <div className="text-2xl font-bold text-blue-600">{summary.uniquePatients}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('patientRecordAccess.summary.uniqueUsers')}</div>
              <div className="text-2xl font-bold text-green-600">{summary.uniqueUsers}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {ACTION_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t(tab)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('patientRecordAccess.empty')}</div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Time</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">User</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Patient</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Action</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">Module</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((access) => (
                  <tr key={access.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm text-gray-500">{formatDateTime(access.timestamp)}</td>
                    <td className="py-3 px-4 text-sm">
                      <div className="font-medium">{access.user}</div>
                      <div className="text-xs text-gray-400">{access.role}</div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <div className="font-medium">{access.patientName}</div>
                      <div className="text-xs text-gray-400">#{access.patientId}</div>
                    </td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${ACTION_BADGE[access.action] ?? 'bg-gray-100 text-gray-600'}`}>
                        {access.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{access.module}</td>
                    <td className="py-3 px-4 text-sm text-gray-500 font-mono text-xs">{access.ip}</td>
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
