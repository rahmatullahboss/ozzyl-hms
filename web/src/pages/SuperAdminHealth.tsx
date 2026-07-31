import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Heart, ChevronLeft, RefreshCw, Database,
  Server, HardDrive, Activity, CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import adminApi from '../lib/adminApi';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface SystemHealth {
  database: {
    totalTables: number;
    tableStats: Array<{ table: string; count: number }>;
  };
  uptime: string;
  status: 'healthy' | 'degraded' | 'down';
}

export default function SuperAdminHealth() {
  const { t } = useTranslation(['super-admin', 'common']);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { fetchHealth(); }, []);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/system-health');
      setHealth(data);
    } catch {
      toast.error(t('failedToLoad', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  const statusConfig = {
    healthy:  { color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <CheckCircle2 className="w-6 h-6" /> },
    degraded: { color: 'text-amber-600', bg: 'bg-amber-50', icon: <AlertTriangle className="w-6 h-6" /> },
    down:     { color: 'text-red-600', bg: 'bg-red-50', icon: <AlertTriangle className="w-6 h-6" /> },
  };

  const status = health?.status || 'healthy';
  const sc = statusConfig[status];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/super-admin/dashboard')} className="btn-ghost p-2">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Heart className="w-6 h-6 text-[var(--color-primary)]" />
              {t('healthTitle')}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('healthSubtitle')}
            </p>
          </div>
        </div>
        <button onClick={fetchHealth} className="btn-ghost" title={t('refresh', { ns: 'common' })}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Overall Status */}
      <div className={`card p-6 mb-6 border-l-4 ${
        status === 'healthy' ? 'border-emerald-500' :
        status === 'degraded' ? 'border-amber-500' : 'border-red-500'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl ${sc.bg} flex items-center justify-center ${sc.color}`}>
            {sc.icon}
          </div>
          <div>
            <h2 className={`text-xl font-bold ${sc.color}`}>
              {t(`status_${status}`)}
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('lastChecked')}: {new Date().toLocaleTimeString('en-GB')}
            </p>
          </div>
        </div>
      </div>

      {/* Infrastructure */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
            <Server className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">{t('runtime')}</p>
            <p className="text-sm font-bold text-[var(--color-text-primary)]">Cloudflare Workers</p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Database className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">{t('databaseEngine')}</p>
            <p className="text-sm font-bold text-[var(--color-text-primary)]">D1 (SQLite)</p>
          </div>
        </div>
        <div className="card p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">{t('storage')}</p>
            <p className="text-sm font-bold text-[var(--color-text-primary)]">Cloudflare R2</p>
          </div>
        </div>
      </div>

      {/* Table Stats */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <Activity className="w-4 h-4" /> {t('dataOverview')}
          </h3>
          <span className="text-xs text-[var(--color-text-muted)]">
            {health?.database.totalTables || 0} {t('tables')}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('tableName')}</th>
                <th className="text-right">{t('rowCount')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i}>
                    <td><div className="skeleton h-4 w-32" /></td>
                    <td><div className="skeleton h-4 w-16 ml-auto" /></td>
                  </tr>
                ))
              ) : !health?.database.tableStats?.length ? (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-[var(--color-text-muted)]">
                    {t('noData', { ns: 'common' })}
                  </td>
                </tr>
              ) : (
                health.database.tableStats.map((stat) => (
                  <tr key={stat.table}>
                    <td className="font-medium font-data text-sm">{stat.table}</td>
                    <td className="text-right font-data text-sm">{stat.count.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
