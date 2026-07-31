import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Download, Filter, Search, RefreshCw, Info } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import AuditGroupCard from '../components/AuditGroupCard';
import AuditEntryCard from '../components/AuditEntryCard';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import {
  AUDIT_GROUPS,
  toAuditEntry,
  type AuditGroupKey,
  type RawAuditEntry,
} from '../lib/auditGroups';
import { getAuditDateKeyGMT6, getTodayGMT6 } from '../lib/date-utils';

const ENTITY_OPTIONS = ['All', 'patients', 'bills', 'cash_drawer_movements', 'expenses', 'billing_counter_sessions', 'billing_counter_cash_transfers', 'billing_handovers', 'prescriptions', 'admissions', 'lab_orders', 'pharmacy', 'staff', 'users', 'discharge_summaries', 'doctor_schedules', 'settings'];
const ACTION_OPTIONS = ['All', 'create', 'update', 'delete', 'upsert', 'cancel', 'approve', 'reject', 'login', 'logout', 'payment'];

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SystemAuditLog({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common', 'dashboard', 'tenantAdmin']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState<AuditGroupKey | 'all'>('all');

  const { data: logsData, isLoading: loading } = useApiQuery<{ auditLogs: RawAuditEntry[] }>(
    queryKeys.auditLog.logs(),
    '/api/audit/logs',
  );

  const logs = useMemo(() => (logsData?.auditLogs ?? []).map(toAuditEntry), [logsData?.auditLogs]);

  const filtered = useMemo(() => {
    let data = logs;
    if (groupFilter !== 'all') data = data.filter((l) => l.groupKey === groupFilter);
    if (actionFilter !== 'All') data = data.filter((l) => l.action === actionFilter);
    if (entityFilter !== 'All') data = data.filter((l) => l.entity === entityFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter((l) =>
        (l.user_name ?? '').toLowerCase().includes(q) ||
        (l.details ?? '').toLowerCase().includes(q) ||
        (l.entity_id?.toString() ?? '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [logs, groupFilter, actionFilter, entityFilter, searchQuery]);

  const todayKey = getTodayGMT6();
  const totalToday = logs.filter((l) => getAuditDateKeyGMT6(l.created_at) === todayKey).length;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('auditLogs.breadcrumbDashboard', { ns: 'tenantAdmin' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('auditLogs.breadcrumbAudit', { ns: 'tenantAdmin' })}</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('auditLog', { defaultValue: 'System Audit Log' })}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{t('auditLogs.subtitle', { ns: 'tenantAdmin' })}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowFilters((f) => !f)} className="btn-secondary flex items-center gap-2">
              <Filter className="w-4 h-4" /> {t('auditLogs.filters', { ns: 'tenantAdmin' })}
            </button>
            <a href="/api/audit/export" className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> {t('auditLogs.exportCsv', { ns: 'tenantAdmin' })}
            </a>
          </div>
        </div>

        {/* Group filter cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AUDIT_GROUPS.map((group) => (
            <AuditGroupCard
              key={group.key}
              group={group}
              entries={logs.filter((l) => l.groupKey === group.key)}
              selected={groupFilter === group.key}
              onToggle={() => setGroupFilter(groupFilter === group.key ? 'all' : group.key)}
              maxItems={5}
            />
          ))}
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">{t('auditLogs.actionLabel', { ns: 'tenantAdmin' })}</label>
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{o === 'All' ? t('auditLogs.allActions', { ns: 'tenantAdmin' }) : o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">{t('auditLogs.entityLabel', { ns: 'tenantAdmin' })}</label>
              <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                {ENTITY_OPTIONS.map((o) => <option key={o} value={o}>{o === 'All' ? t('auditLogs.allEntities', { ns: 'tenantAdmin' }) : humanize(o)}</option>)}
              </select>
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('auditLogs.searchPlaceholder', { ns: 'tenantAdmin' })}
                className="w-full pl-9 pr-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
            </div>
            <button onClick={() => { setActionFilter('All'); setEntityFilter('All'); setSearchQuery(''); setGroupFilter('all'); }}
              className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> {t('auditLogs.reset', { ns: 'tenantAdmin' })}
            </button>
          </div>
        )}

        {/* Entry list (card-based, replaces the table) */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="animate-pulse h-64 bg-gray-50" />
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{t('auditLogs.noRecords', { ns: 'tenantAdmin' })}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {filtered.map((entry) => (
                <li key={entry.id} className="p-3">
                  <AuditEntryCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 py-3 bg-[var(--color-bg)] border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
            {t('auditLogs.showing', { ns: 'tenantAdmin', shown: filtered.length, total: logs.length })} · {t('auditLogs.todayCount', { ns: 'tenantAdmin', count: totalToday })}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
