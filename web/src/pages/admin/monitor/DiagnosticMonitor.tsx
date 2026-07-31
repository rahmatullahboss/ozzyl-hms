import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../../components/DashboardLayout';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatTime } from '../../../lib/format';
import { useSearchParams } from 'react-router';

interface LabItem {
  id: string;
  orderId: string;
  patientName: string;
  testName: string;
  departmentName: string;
  sampleStatus: string;
  reportStatus: string;
  expectedTime: string;
  delayMinutes: number;
}

interface CriticalAlert {
  id: string;
  patientName: string;
  testName: string;
  result: string;
  severity: string;
}

interface DiagnosticData {
  stats: {
    totalToday: number;
    samplePending: number;
    processing: number;
    reportReady: number;
    delayed: number;
    critical: number;
  };
  items: LabItem[];
  criticalAlerts?: CriticalAlert[];
}

const STATUS_TABS = ['all', 'samplePending', 'processing', 'reportReady', 'delayed'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const statusMap: Record<StatusTab, string | null> = {
  all: null,
  samplePending: 'sample_pending',
  processing: 'processing',
  reportReady: 'report_ready',
  delayed: 'delayed',
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  pending: 'samplePending',
  collected: 'processing',
  processing: 'processing',
  report_ready: 'reportReady',
  completed: 'reportReady',
  delayed: 'delayed',
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const colors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-800',
    collected: 'bg-blue-100 text-blue-800',
    processing: 'bg-yellow-100 text-yellow-800',
    report_ready: 'bg-green-100 text-green-800',
    completed: 'bg-green-100 text-green-800',
    delayed: 'bg-red-100 text-red-800',
  };
  const labelKey = STATUS_LABEL_KEYS[status];
  const label = labelKey ? t(`adminMonitor.diagnostic.statusTabs.${labelKey}`) : status.replace(/_/g, ' ');
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
      {label}
    </span>
  );
}

export default function DiagnosticMonitor() {
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
  const { data, isLoading } = useApiQuery<DiagnosticData>(
    queryKeys.admin.diagnosticMonitor(),
    '/api/lab/orders/queue/today'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.diagnostic.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const stats = data?.stats || { totalToday: 0, samplePending: 0, processing: 0, reportReady: 0, delayed: 0, critical: 0 };
  const items = data?.items || [];
  const criticalAlerts = data?.criticalAlerts || [];

  const filteredItems = activeTab === 'all'
    ? items
    : items.filter((item) => {
        if (activeTab === 'delayed') return item.delayMinutes > 0;
        return item.reportStatus === statusMap[activeTab];
      });

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('adminMonitor.diagnostic.title')}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.diagnostic.summary.totalToday')}</p>
          <p className="text-2xl font-bold">{stats.totalToday}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.diagnostic.summary.samplePending')}</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.samplePending}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.diagnostic.summary.processing')}</p>
          <p className="text-2xl font-bold text-blue-600">{stats.processing}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.diagnostic.summary.reportReady')}</p>
          <p className="text-2xl font-bold text-green-600">{stats.reportReady}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.diagnostic.summary.delayed')}</p>
          <p className="text-2xl font-bold text-red-600">{stats.delayed}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">{t('adminMonitor.diagnostic.summary.critical')}</p>
          <p className="text-2xl font-bold text-red-700">{stats.critical}</p>
        </div>
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-semibold text-red-800 mb-3">{t('adminMonitor.diagnostic.criticalResults')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {criticalAlerts.map((alert) => (
              <div key={alert.id} className="bg-white rounded p-3 border border-red-100">
                <p className="font-medium">{alert.patientName}</p>
                <p className="text-sm text-gray-500">{alert.testName}</p>
                <p className="text-sm text-red-600 mt-1">{alert.result}</p>
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
            {t(`adminMonitor.diagnostic.statusTabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Lab Items Table */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">{t('adminMonitor.diagnostic.noLabOrders')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.orderId')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.patient')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.test')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.department')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.sample')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.report')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.expected')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('adminMonitor.diagnostic.table.delay')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{item.orderId}</td>
                  <td className="px-4 py-3 text-sm">{item.patientName}</td>
                  <td className="px-4 py-3 text-sm">{item.testName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{item.departmentName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.sampleStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.reportStatus} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatTime(item.expectedTime)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.delayMinutes > 0 ? (
                      <span className="text-red-600 font-medium">{t('adminMonitor.opd.delayMinutes', { count: item.delayMinutes })}</span>
                    ) : (
                      <span className="text-green-600">{t('adminMonitor.diagnostic.table.onTime')}</span>
                    )}
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
