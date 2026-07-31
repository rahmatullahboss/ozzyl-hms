import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { formatDateTime } from '../../lib/format';
import { useSearchParams } from 'react-router';

interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  event: string;
  module: string;
  recordId: string;
  before: string;
  after: string;
  ip: string;
  severity: string;
}

interface FinancialAuditData {
  entries: AuditEntry[];
  summary?: { totalEvents: number; highSeverity: number; usersActive: number; modulesAffected: number };
}

const SEVERITY_TABS = ['All', 'High', 'Medium', 'Low'] as const;
type SeverityTab = (typeof SEVERITY_TABS)[number];

const SEVERITY_TAB_KEYS: Record<SeverityTab, string> = {
  All: 'all',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};

const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};

export default function FinancialAudit() {
  const { t } = useTranslation('adminPages');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as SeverityTab | null;
  const isValidTab = (val: string | null): val is SeverityTab =>
    val !== null && SEVERITY_TABS.includes(val as SeverityTab);
  const [activeTab, setActiveTabRaw] = useState<SeverityTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'All';
    }
    return isValidTab(tabParam) ? tabParam : 'All';
  });
  const setActiveTab = (tab: SeverityTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<FinancialAuditData>(
    queryKeys.admin.financialAudit(),
    `/api/admin/audit/financial`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('financialAudit.loading')}</div></DashboardLayout>;
  }

  const entries = data?.entries ?? [];
  const summary = data?.summary;
  const filtered = activeTab === 'All' ? entries : entries.filter((e) => e.severity === activeTab.toLowerCase());

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">{t('financialAudit.title')}</h1>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('financialAudit.summary.totalEvents')}</div>
              <div className="text-2xl font-bold">{summary.totalEvents}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('financialAudit.summary.highSeverity')}</div>
              <div className="text-2xl font-bold text-red-600">{summary.highSeverity}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('financialAudit.summary.activeUsers')}</div>
              <div className="text-2xl font-bold text-blue-600">{summary.usersActive}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('financialAudit.summary.modulesAffected')}</div>
              <div className="text-2xl font-bold text-purple-600">{summary.modulesAffected}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {SEVERITY_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t(`financialAudit.tabs.${SEVERITY_TAB_KEYS[tab]}`)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('financialAudit.empty')}</div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.time')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.user')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.event')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.module')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.record')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.ip')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('financialAudit.table.severity')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm text-gray-600">{formatDateTime(entry.timestamp)}</td>
                    <td className="py-3 px-4 text-sm font-medium">{entry.user}</td>
                    <td className="py-3 px-4 text-sm">{entry.event}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{entry.module}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{entry.recordId}</td>
                    <td className="py-3 px-4 text-sm text-gray-500">{entry.ip}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${SEVERITY_BADGE[entry.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                        {t(`financialAudit.severityLabels.${entry.severity}`, { defaultValue: entry.severity })}
                      </span>
                    </td>
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
