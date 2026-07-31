import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTimeShort } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface Alert {
  id: string;
  ruleName: string;
  description: string;
  severity: string;
  userName: string;
  detectedAt: string;
  status: string;
  evidence: Record<string, unknown>;
}

interface SuspiciousData {
  summary: {
    totalAlerts: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    resolved: number;
  };
  alerts: Alert[];
}

const SEVERITY_TABS = ['all', 'critical', 'high', 'medium', 'low'] as const;
type SeverityTab = (typeof SEVERITY_TABS)[number];

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
};

const STATUS_BG: Record<string, string> = {
  open: 'bg-red-100 text-red-800',
  investigating: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-800',
};

const RULE_KEYS = ['highDiscount', 'unusualReference', 'refundSpike', 'repeatedCancellations', 'cashShortage', 'sharedPin', 'nightExports', 'stockManipulation', 'bulkAccess'] as const;

const TABLE_HEADERS: Array<{ key: string }> = [
  { key: 'rule' },
  { key: 'description' },
  { key: 'severity' },
  { key: 'user' },
  { key: 'detected' },
  { key: 'status' },
];

export default function SuspiciousActivities() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as SeverityTab | null;
  const isValidTab = (val: string | null): val is SeverityTab =>
    val !== null && SEVERITY_TABS.includes(val as SeverityTab);
  const [activeSeverity, setActiveSeverityRaw] = useState<SeverityTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'all';
    }
    return isValidTab(tabParam) ? tabParam : 'all';
  });
  const setActiveSeverity = (tab: SeverityTab) => {
    setActiveSeverityRaw(tab);
    setSearchParams({ tab });
  };
  const { data, isLoading } = useApiQuery<SuspiciousData>(
    queryKeys.admin.suspiciousActivities(),
    '/api/admin/alerts/detect'
  );

  if (isLoading) {
    return (
      <DashboardLayout role="hospital_admin">
        <h1 className="text-2xl font-bold mb-6">{t('suspiciousActivities.title')}</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-24 rounded-lg" />
          ))}
        </div>
        <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
      </DashboardLayout>
    );
  }

  const summary = data?.summary || { totalAlerts: 0, critical: 0, high: 0, medium: 0, low: 0, resolved: 0 };
  const alerts = data?.alerts || [];

  const filteredAlerts = activeSeverity === 'all'
    ? alerts
    : alerts.filter((a) => a.severity === activeSeverity);

  const summaryCards = [
    { label: t('suspiciousActivities.summary.totalAlerts'), value: summary.totalAlerts, color: 'text-gray-900' },
    { label: t('suspiciousActivities.summary.critical'), value: summary.critical, color: 'text-red-600' },
    { label: t('suspiciousActivities.summary.high'), value: summary.high, color: 'text-orange-600' },
    { label: t('suspiciousActivities.summary.medium'), value: summary.medium, color: 'text-yellow-600' },
    { label: t('suspiciousActivities.summary.low'), value: summary.low, color: 'text-blue-600' },
    { label: t('suspiciousActivities.summary.resolved'), value: summary.resolved, color: 'text-green-600' },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('suspiciousActivities.title')}</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {summaryCards.map((card, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Detection Rules Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">{t('suspiciousActivities.autoDetectionRules')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-blue-700">
          {RULE_KEYS.map(ruleKey => (
            <span key={ruleKey}>{t(`suspiciousActivities.rules.${ruleKey}`)}</span>
          ))}
        </div>
      </div>

      {/* Severity Tabs */}
      <div className="flex gap-2 mb-4">
        {SEVERITY_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSeverity(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSeverity === tab
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab === 'all' ? t('suspiciousActivities.tabs.all') : t(`suspiciousActivities.summary.${tab}`)}
          </button>
        ))}
      </div>

      {/* Alerts Table */}
      {filteredAlerts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">{t('suspiciousActivities.noData')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {TABLE_HEADERS.map(h => (
                  <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t(`suspiciousActivities.table.${h.key}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredAlerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{alert.ruleName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-[300px] truncate">{alert.description}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${SEVERITY_BG[alert.severity] || 'bg-gray-100 text-gray-800'}`}>
                      {t(`suspiciousActivities.severityLabels.${alert.severity}`, { defaultValue: alert.severity })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{alert.userName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDateTimeShort(alert.detectedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BG[alert.status] || 'bg-gray-100 text-gray-800'}`}>
                      {t(`suspiciousActivities.statusLabels.${alert.status}`, { defaultValue: alert.status })}
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
