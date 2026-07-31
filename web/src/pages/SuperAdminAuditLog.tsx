import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Shield, ChevronLeft, RefreshCw, Search,
  Eye, UserPlus, Building2, LogIn,
  Filter, Clock,
} from 'lucide-react';
import adminApi from '../lib/adminApi';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface AuditEntry {
  id: number;
  tenant_id: number | null;
  user_id: string | null;
  action: string;
  table_name: string | null;
  record_id: number | null;
  created_at: string;
  tenant_name?: string;
  user_email?: string;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  impersonate_start: <Eye className="w-4 h-4" />,
  create: <UserPlus className="w-4 h-4" />,
  update: <Building2 className="w-4 h-4" />,
  delete: <Building2 className="w-4 h-4" />,
  login: <LogIn className="w-4 h-4" />,
};

const ACTION_COLORS: Record<string, string> = {
  impersonate_start: 'bg-indigo-50 text-indigo-600',
  create: 'bg-emerald-50 text-emerald-600',
  update: 'bg-blue-50 text-blue-600',
  delete: 'bg-red-50 text-red-600',
  login: 'bg-slate-50 text-slate-600',
};

export default function SuperAdminAuditLog() {
  const { t } = useTranslation(['super-admin', 'common']);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const navigate = useNavigate();

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/audit-logs');
      setEntries(data.logs || []);
    } catch {
      toast.error(t('failedToLoad', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  const uniqueActions = [...new Set(entries.map(e => e.action))];

  const filtered = entries.filter((e) => {
    const matchesSearch = !search ||
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      (e.table_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.tenant_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (e.user_email || '').toLowerCase().includes(search.toLowerCase());
    const matchesAction = actionFilter === 'all' || e.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin/dashboard')} className="btn-ghost p-2">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Shield className="w-6 h-6 text-[var(--color-primary)]" />
              {t('auditLogTitle')}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('auditLogSubtitle')}
            </p>
          </div>
        </div>
        <button onClick={fetchLogs} className="btn-ghost" title={t('refresh', { ns: 'common' })}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('searchAuditLogs')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9 w-full"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="input-field"
            >
              <option value="all">{t('allActions')}</option>
              {uniqueActions.map(action => (
                <option key={action} value={action}>{action.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          {filtered.length} {t('entries')}
        </p>
      </div>

      {/* Audit Log Entries */}
      <div className="space-y-2">
        {loading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="card p-4">
              <div className="skeleton h-5 w-full" />
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="card p-10 text-center">
            <Shield className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-3" />
            <p className="text-[var(--color-text-muted)]">{t('noAuditEntries')}</p>
          </div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} className="card p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  ACTION_COLORS[entry.action] || 'bg-slate-50 text-slate-600'
                }`}>
                  {ACTION_ICONS[entry.action] || <Shield className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-[var(--color-text-primary)]">
                      {entry.action.replace(/_/g, ' ')}
                    </span>
                    {entry.table_name && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                        {entry.table_name}
                      </span>
                    )}
                    {entry.tenant_name && (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        • {entry.tenant_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-text-muted)]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(entry.created_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    {entry.user_email && (
                      <span>by {entry.user_email}</span>
                    )}
                    {entry.record_id && (
                      <span>#{entry.record_id}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
