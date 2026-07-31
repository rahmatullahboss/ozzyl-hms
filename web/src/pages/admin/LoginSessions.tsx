import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTimeShort, formatTime } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface Session {
  id: string;
  userName: string;
  device: string;
  ipAddress: string;
  browser: string;
  loginTime: string;
  lastActive: string;
  branch: string;
  status: string;
}

interface LoginSessionsData {
  summary: {
    activeSessions: number;
    todayLogins: number;
    uniqueUsers: number;
    suspiciousLogins: number;
  };
  sessions: Session[];
}

const STATUS_TABS = ['all', 'active', 'suspicious', 'expired'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_BG: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  suspicious: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
};

const TABLE_HEADERS: Array<{ key: string }> = [
  { key: 'user' },
  { key: 'device' },
  { key: 'ip' },
  { key: 'browser' },
  { key: 'loginTime' },
  { key: 'lastActive' },
  { key: 'branch' },
  { key: 'status' },
];

export default function LoginSessions() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as StatusTab | null;
  const isValidTab = (val: string | null): val is StatusTab =>
    val !== null && STATUS_TABS.includes(val as StatusTab);
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
  const { data, isLoading } = useApiQuery<LoginSessionsData>(
    queryKeys.admin.loginSessions(),
    '/api/admin/sessions'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('loginSessions.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const summary = data?.summary || { activeSessions: 0, todayLogins: 0, uniqueUsers: 0, suspiciousLogins: 0 };
  const sessions = data?.sessions || [];

  const filteredSessions = activeTab === 'all'
    ? sessions
    : sessions.filter((s) => s.status === activeTab);

  const summaryCards = [
    { label: t('loginSessions.activeSessions'), value: summary.activeSessions, color: 'text-green-600' },
    { label: t('loginSessions.todayLogins'), value: summary.todayLogins, color: 'text-blue-600' },
    { label: t('loginSessions.uniqueUsers'), value: summary.uniqueUsers, color: 'text-purple-600' },
    { label: t('loginSessions.suspicious'), value: summary.suspiciousLogins, color: 'text-red-600' },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('loginSessions.title')}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

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
            {tab === 'all' ? t('loginSessions.all') : t(`loginSessions.${tab}`)}
          </button>
        ))}
      </div>

      {/* Sessions Table */}
      {filteredSessions.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">{t('loginSessions.noData')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {TABLE_HEADERS.map(h => (
                  <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t(`loginSessions.${h.key}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredSessions.map((session) => (
                <tr key={session.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{session.userName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{session.device}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{session.ipAddress}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{session.browser}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDateTimeShort(session.loginTime)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatTime(session.lastActive)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{session.branch}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BG[session.status] || 'bg-gray-100 text-gray-800'}`}>
                      {t(`loginSessions.statusLabels.${session.status}`, { defaultValue: session.status })}
                    </span>
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
