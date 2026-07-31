import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../../components/DashboardLayout';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatTime } from '../../../lib/format';
import { useSearchParams } from 'react-router';

interface Token {
  id: string;
  tokenNumber: string;
  patientName: string;
  doctorName: string;
  departmentName: string;
  appointmentTime: string;
  checkinTime?: string;
  waitingMinutes: number;
  status: string;
}

interface DelayedDoctor {
  doctorName: string;
  departmentName: string;
  delayMinutes: number;
  waitingPatients: number;
}

interface OPDData {
  stats: {
    total: number;
    waiting: number;
    serving: number;
    completed: number;
    noShow: number;
    cancelled: number;
  };
  tokens: Token[];
  delayedDoctors?: DelayedDoctor[];
}

const STATUS_TABS = ['all', 'waiting', 'serving', 'completed', 'noShow', 'cancelled'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const statusMap: Record<StatusTab, string | null> = {
  all: null,
  waiting: 'waiting',
  serving: 'serving',
  completed: 'completed',
  noShow: 'no_show',
  cancelled: 'cancelled',
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const colors: Record<string, string> = {
    waiting: 'bg-yellow-100 text-yellow-800',
    serving: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    no_show: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-800',
  };
  // Translate known statuses; fall back to the raw status (snake_case → humanized)
  const labelKey = status === 'no_show' ? 'noShow'
    : status === 'waiting' ? 'waiting'
    : status === 'serving' ? 'serving'
    : status === 'completed' ? 'completed'
    : status === 'cancelled' ? 'cancelled'
    : null;
  const label = labelKey ? t(`adminMonitor.opd.statusTabs.${labelKey}`) : status.replace(/_/g, ' ');
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {label}
    </span>
  );
}

export default function OPDMonitor() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const isValidTab = (val: string | null): val is StatusTab =>
    val !== null && (STATUS_TABS as readonly string[]).includes(val);
  const [activeTab, setActiveTabRaw] = useState<StatusTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'all';
    }
    return isValidTab(tabParam) ? tabParam : 'all';
  });
  const setActiveTab = (tab: StatusTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };
  const { data, isLoading } = useApiQuery<OPDData>(
    queryKeys.admin.opdMonitor(),
    '/api/queue/tokens/overview'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.opd.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const stats = data?.stats || { total: 0, waiting: 0, serving: 0, completed: 0, noShow: 0, cancelled: 0 };
  const tokens = data?.tokens || [];
  const delayedDoctors = data?.delayedDoctors || [];

  const filteredTokens = activeTab === 'all'
    ? tokens
    : tokens.filter((t) => t.status === statusMap[activeTab]);

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.opd.title')}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.opd.summary.totalTokens')}</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.opd.summary.waiting')}</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.waiting}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.opd.summary.serving')}</p>
          <p className="text-2xl font-bold text-blue-600">{stats.serving}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.opd.summary.completed')}</p>
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.opd.summary.noShow')}</p>
          <p className="text-2xl font-bold text-red-600">{stats.noShow}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.opd.summary.cancelled')}</p>
          <p className="text-2xl font-bold text-gray-600">{stats.cancelled}</p>
        </div>
      </div>

      {/* Delayed Doctors */}
      {delayedDoctors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-semibold text-red-800 mb-3">{t('adminMonitor.opd.delayedDoctors')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {delayedDoctors.map((doc) => (
              <div key={`${doc.doctorName}-${doc.departmentName}`} className="bg-white rounded p-3 border border-red-100">
                <p className="font-medium">{doc.doctorName}</p>
                <p className="text-sm text-gray-500">{doc.departmentName}</p>
                <p className="text-sm text-red-600 mt-1">{t('adminMonitor.opd.delayMinutes', { count: doc.delayMinutes })}</p>
                <p className="text-xs text-gray-400">{t('adminMonitor.opd.patientsWaiting', { count: doc.waitingPatients })}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex gap-2 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t(`adminMonitor.opd.statusTabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Token Table */}
      {filteredTokens.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">{t('adminMonitor.opd.noTokens')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.token')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.patient')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.doctor')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.department')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.apptTime')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.wait')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.opd.table.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredTokens.map((token) => (
                <tr key={token.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{token.tokenNumber}</td>
                  <td className="px-4 py-3 text-sm">{token.patientName}</td>
                  <td className="px-4 py-3 text-sm">{token.doctorName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{token.departmentName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatTime(token.appointmentTime)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {token.waitingMinutes > 0 ? t('adminMonitor.opd.delayMinutes', { count: token.waitingMinutes }) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={token.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}
