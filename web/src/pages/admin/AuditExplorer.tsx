import { useState, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDateTime } from '../../lib/format';

interface AuditEvent {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  event: string;
  module: string;
  recordId: string;
  before?: string;
  after?: string;
  ip: string;
  severity: string;
}

interface AuditData {
  events: AuditEvent[];
  summary?: { total: number; high: number; medium: number; low: number };
}

const SEVERITY_TABS = ['All', 'High', 'Medium', 'Low'] as const;
type SeverityTab = (typeof SEVERITY_TABS)[number];

const SEVERITY_MAP: Record<Exclude<SeverityTab, 'All'>, string> = {
  'High': 'high', 'Medium': 'medium', 'Low': 'low',
};

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

export default function AuditExplorer() {
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useApiQuery<AuditData>(
    queryKeys.admin.auditExplorer(),
    `/api/admin/audit`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('auditExplorer.loading')}</div></DashboardLayout>;
  }

  const events = data?.events ?? [];
  const summary = data?.summary;
  const filtered = activeTab === 'All' ? events : events.filter((e) => e.severity === SEVERITY_MAP[activeTab as keyof typeof SEVERITY_MAP]);

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('auditExplorer.title')}</h1>
            <p className="text-sm text-gray-500">{t('auditExplorer.subtitle')}</p>
          </div>
          <button onClick={() => setShowFilters(!showFilters)} className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2">
            <Filter className="w-4 h-4" /> {t('auditExplorer.filters')} {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-white rounded-lg border p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.filterPanel.dateRange')}</label>
                <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.filterPanel.user')}</label>
                <input type="text" placeholder={t('auditExplorer.filterPanel.searchUser')} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.filterPanel.role')}</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"><option value="">{t('auditExplorer.filterPanel.allRoles')}</option></select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.filterPanel.module')}</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"><option value="">{t('auditExplorer.filterPanel.allModules')}</option></select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.filterPanel.eventType')}</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm"><option value="">{t('auditExplorer.filterPanel.allEvents')}</option></select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.filterPanel.invoiceRecord')}</label>
                <input type="text" placeholder={t('auditExplorer.filterPanel.search')} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('auditExplorer.summary.totalEvents')}</div>
              <div className="text-2xl font-bold">{summary.total}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('auditExplorer.summary.highSeverity')}</div>
              <div className="text-2xl font-bold text-red-600">{summary.high}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('auditExplorer.summary.mediumSeverity')}</div>
              <div className="text-2xl font-bold text-yellow-600">{summary.medium}</div>
            </div>
            <div className="bg-white rounded-lg border p-4">
              <div className="text-sm text-gray-500">{t('auditExplorer.summary.lowSeverity')}</div>
              <div className="text-2xl font-bold text-green-600">{summary.low}</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2">
          {SEVERITY_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t(`auditExplorer.tabs.${SEVERITY_TAB_KEYS[tab]}`)}
            </button>
          ))}
        </div>

        {/* Events Table */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('auditExplorer.empty')}</div>
        ) : (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600 w-8"></th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.time')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.user')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.event')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.module')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.record')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.ip')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('auditExplorer.table.severity')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event) => (
                  <Fragment key={event.id}>
                    <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}>
                      <td className="py-3 px-4 text-sm">{expandedId === event.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                      <td className="py-3 px-4 text-sm text-gray-500">{formatDateTime(event.timestamp)}</td>
                      <td className="py-3 px-4 text-sm">
                        <div className="font-medium">{event.user}</div>
                        <div className="text-xs text-gray-400">{event.role}</div>
                      </td>
                      <td className="py-3 px-4 text-sm font-medium">{event.event}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{event.module}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">#{event.recordId}</td>
                      <td className="py-3 px-4 text-sm text-gray-500 font-mono text-xs">{event.ip}</td>
                      <td className="py-3 px-4 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${SEVERITY_BADGE[event.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                          {t(`auditExplorer.severityLabels.${event.severity}`, { defaultValue: event.severity })}
                        </span>
                      </td>
                    </tr>
                    {expandedId === event.id && (event.before || event.after) && (
                      <tr className="bg-gray-50">
                        <td colSpan={8} className="px-8 py-4">
                          <div className="grid grid-cols-2 gap-4">
                            {event.before && (
                              <div>
                                <div className="text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.diff.before')}</div>
                                <pre className="text-xs bg-red-50 p-3 rounded-lg overflow-x-auto">{event.before}</pre>
                              </div>
                            )}
                            {event.after && (
                              <div>
                                <div className="text-xs font-medium text-gray-500 mb-1">{t('auditExplorer.diff.after')}</div>
                                <pre className="text-xs bg-green-50 p-3 rounded-lg overflow-x-auto">{event.after}</pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
