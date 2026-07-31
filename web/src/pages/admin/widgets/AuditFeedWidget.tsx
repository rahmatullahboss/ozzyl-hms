import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Shield, ChevronRight, AlertTriangle, Eye, Edit3, Trash2, LogIn, DollarSign, FileText, AlertCircle } from 'lucide-react';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';

interface AuditLogEntry {
  id: number;
  created_at: string;
  user_id: number;
  user_name: string;
  action: string;
  table_name: string;
  record_id: string;
  ip_address?: string;
}

interface AuditLogsResponse {
  auditLogs: AuditLogEntry[];
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create: <FileText className="w-3.5 h-3.5 text-emerald-500" />,
  update: <Edit3 className="w-3.5 h-3.5 text-blue-500" />,
  delete: <Trash2 className="w-3.5 h-3.5 text-red-500" />,
  view: <Eye className="w-3.5 h-3.5 text-gray-400" />,
  login: <LogIn className="w-3.5 h-3.5 text-purple-500" />,
  approve: <DollarSign className="w-3.5 h-3.5 text-emerald-500" />,
  reject: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-amber-50 text-amber-600',
  high: 'bg-red-50 text-red-600',
  critical: 'bg-red-100 text-red-700',
};

export default function AuditFeedWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useApiQuery<AuditLogsResponse>(
    queryKeys.auditLog.logs(),
    '/api/audit?limit=8',
    { refetchInterval: 30000 },
  );

  function auditTime(ts: string): string {
    const raw = String(ts || '').trim();
    if (!raw) return '—';

    const normalized = raw.replace(' ', 'T');
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
    const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
    if (Number.isNaN(parsed.getTime())) return '—';

    return new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Dhaka',
    }).format(parsed);
  }

  if (isError) {
    return (
      <div className="card p-5" role="alert" aria-live="assertive">
        <div className="flex items-center gap-2 mb-3 text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4" />
          <p className="text-sm font-medium">{t('adminDashboard.errors.loadFailed')}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-red-700 dark:text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
        >
          {t('adminDashboard.errors.retry')}
        </button>
      </div>
    );
  }

  const logs = (data?.auditLogs ?? []).map((entry) => {
    const action = String(entry.action || '').toLowerCase();
    const severity = action === 'delete' ? 'critical'
      : action === 'approve' || action === 'reject' ? 'high'
        : action === 'update' ? 'medium' : 'low';
    return {
      ...entry,
      action,
      severity,
      severityLabel: t(`adminDashboard.auditFeed.severity.${severity}`),
      description: `${String(entry.action || '').toUpperCase()} ${entry.table_name} #${entry.record_id}`,
    };
  });
  const auditPath = `/h/${slug}/system-audit`;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--color-primary)]" />
          <h3 className="font-semibold text-[var(--color-text-primary)]">{t('adminDashboard.auditFeed.title')}</h3>
        </div>
        <button
          onClick={() => navigate(auditPath)}
          className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1"
        >
          {t('adminDashboard.auditFeed.viewAll')} <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">
          {t('adminDashboard.auditFeed.noEntries')}
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors hover:bg-[var(--color-border-light)]"
              onMouseEnter={() => setHoveredId(log.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => navigate(auditPath)}
            >
              <div className="mt-0.5 shrink-0">
                {ACTION_ICONS[log.action] ?? <FileText className="w-3.5 h-3.5 text-gray-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                    {log.user_name ?? `User #${log.user_id}`}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[log.severity] ?? 'bg-gray-100 text-gray-600'}`}>
                    {log.severityLabel}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                  {log.description}
                </p>
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap mt-0.5">
                {auditTime(log.created_at)}
              </span>
              {hoveredId === log.id && (
                <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)] mt-0.5 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}

      {!isLoading && logs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {t('adminDashboard.auditFeed.showingEntries', { count: logs.length })}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {t('adminDashboard.auditFeed.autoRefresh')}
          </span>
        </div>
      )}
    </div>
  );
}
