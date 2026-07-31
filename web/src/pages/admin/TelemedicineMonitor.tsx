import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Video, Users, Clock, Wifi, WifiOff, RefreshCw, Monitor } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime, formatTime } from '../../lib/format';

interface TeleSession {
  id: string;
  patientName: string;
  doctorName: string;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  duration: number | null;
  department: string;
}

interface TeleStats {
  totalToday: number;
  completed: number;
  inProgress: number;
  scheduled: number;
  cancelled: number;
  noShow: number;
  avgDuration: number;
}

interface TeleData {
  sessions: TeleSession[];
  stats: TeleStats;
}

const STATUS_BG: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-amber-100 text-amber-700',
};

const STATUS_KEY: Record<string, string> = {
  scheduled: 'telemedicineMonitor.summary.scheduled',
  in_progress: 'telemedicineMonitor.summary.inProgress',
  completed: 'telemedicineMonitor.summary.completed',
  cancelled: 'telemedicineMonitor.summary.cancelled',
  no_show: 'telemedicineMonitor.summary.noShow',
};

const TABS = ['all', 'inProgress', 'scheduled', 'completed', 'cancelled'] as const;
type Tab = (typeof TABS)[number];
const TAB_MAP: Record<Tab, string | null> = { all: null, inProgress: 'in_progress', scheduled: 'scheduled', completed: 'completed', cancelled: 'cancelled' };

const TABLE_HEADERS: Array<{ key: string }> = [
  { key: 'patient' },
  { key: 'doctor' },
  { key: 'department' },
  { key: 'scheduled' },
  { key: 'started' },
  { key: 'duration' },
  { key: 'status' },
];

export default function TelemedicineMonitor() {
  const { t } = useTranslation('adminPages');
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const { data, isLoading, refetch } = useApiQuery<TeleData>(
    queryKeys.telemedicine.consultations(),
    '/api/telemedicine/monitor',
    { refetchInterval: 30000 },
  );

  const stats = data?.stats;
  const sessions = data?.sessions ?? [];
  const filtered = TAB_MAP[activeTab] ? sessions.filter(s => s.status === TAB_MAP[activeTab]) : sessions;

  const summaryCards = [
    { label: t('telemedicineMonitor.summary.totalToday'), value: stats?.totalToday ?? 0, icon: <Video className="w-4 h-4 text-blue-500" /> },
    { label: t('telemedicineMonitor.summary.inProgress'), value: stats?.inProgress ?? 0, icon: <Wifi className="w-4 h-4 text-green-500" /> },
    { label: t('telemedicineMonitor.summary.scheduled'), value: stats?.scheduled ?? 0, icon: <Clock className="w-4 h-4 text-purple-500" /> },
    { label: t('telemedicineMonitor.summary.completed'), value: stats?.completed ?? 0, icon: <Users className="w-4 h-4 text-gray-500" /> },
    { label: t('telemedicineMonitor.summary.cancelled'), value: stats?.cancelled ?? 0, icon: <WifiOff className="w-4 h-4 text-red-500" /> },
    { label: t('telemedicineMonitor.summary.noShow'), value: stats?.noShow ?? 0, icon: <WifiOff className="w-4 h-4 text-amber-500" /> },
    { label: t('telemedicineMonitor.summary.avgDuration'), value: `${stats?.avgDuration ?? 0}m`, icon: <Monitor className="w-4 h-4 text-cyan-500" /> },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('telemedicineMonitor.title')}</h1>
            <p className="text-sm text-gray-500">{t('telemedicineMonitor.subtitle')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-ghost p-2"
            title={t('telemedicineMonitor.refresh')}
            aria-label={t('telemedicineMonitor.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {summaryCards.map((card, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-2 mb-1">{card.icon}<span className="text-xs text-gray-500">{card.label}</span></div>
              <p className="text-xl font-bold">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
              {t(`telemedicineMonitor.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-gray-500">{t('telemedicineMonitor.noData')}</div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {TABLE_HEADERS.map(h => (
                      <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t(`telemedicineMonitor.table.${h.key}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filtered.map(session => (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{session.patientName}</td>
                      <td className="px-4 py-3 text-sm">{session.doctorName}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{session.department}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(session.scheduledAt)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{session.startedAt ? formatTime(session.startedAt) : '---'}</td>
                      <td className="px-4 py-3 text-sm">{session.duration ? `${session.duration}m` : '---'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BG[session.status] ?? 'bg-gray-100'}`}>
                          {t(STATUS_KEY[session.status] ?? 'telemedicineMonitor.summary.scheduled')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
