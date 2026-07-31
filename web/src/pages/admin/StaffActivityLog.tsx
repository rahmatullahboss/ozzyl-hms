import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Clock, User, RefreshCw, Filter } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import AdminDataTable from '../../components/admin/AdminDataTable';
import type { DataTableColumn } from '../../components/admin/AdminDataTable';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/format';

interface ActivityLog {
  id: number;
  timestamp: string;
  userId: number;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  description: string;
  ipAddress: string;
  device: string;
}

interface ActivityData {
  logs: ActivityLog[];
  summary: { totalActions: number; activeUsers: number; topAction: string; topModule: string };
}

const ACTION_BADGES: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  view: 'bg-gray-100 text-gray-600',
  login: 'bg-purple-100 text-purple-700',
  logout: 'bg-gray-100 text-gray-600',
  approve: 'bg-emerald-100 text-emerald-700',
  export: 'bg-amber-100 text-amber-700',
};

export default function StaffActivityLog() {
  const { t } = useTranslation('adminPages');
  const { data, isLoading, refetch } = useApiQuery<ActivityData>(
    queryKeys.auditLog.logs(),
    '/api/audit-logs?limit=100',
    { refetchInterval: 60000 },
  );

  const summary = data?.summary;
  const logs = data?.logs ?? [];

  const columns: DataTableColumn<ActivityLog>[] = [
    { key: 'timestamp', label: t('staffActivityLog.table.time'), sortable: true, render: (row) => formatDateTime(row.timestamp) },
    { key: 'userName', label: t('staffActivityLog.table.user'), sortable: true },
    { key: 'userRole', label: t('staffActivityLog.table.role'), sortable: true },
    {
      key: 'action',
      label: t('staffActivityLog.table.action'),
      render: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_BADGES[row.action] ?? 'bg-gray-100 text-gray-600'}`}>
          {row.action}
        </span>
      ),
    },
    { key: 'module', label: t('staffActivityLog.table.module'), sortable: true },
    { key: 'description', label: t('staffActivityLog.table.description') },
    { key: 'ipAddress', label: t('staffActivityLog.table.ip') },
    { key: 'device', label: t('staffActivityLog.table.device') },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('staffActivityLog.title')}</h1>
            <p className="text-sm text-gray-500">{t('staffActivityLog.subtitle')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-ghost p-2"
            title={t('staffActivityLog.refresh')}
            aria-label={t('staffActivityLog.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-gray-500">{t('staffActivityLog.summary.totalActions')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.totalActions ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-green-500" />
              <span className="text-xs text-gray-500">{t('staffActivityLog.summary.activeUsers')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.activeUsers ?? 0}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Filter className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-gray-500">{t('staffActivityLog.summary.topAction')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.topAction ?? '---'}</p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-gray-500">{t('staffActivityLog.summary.topModule')}</span>
            </div>
            <p className="text-xl font-bold">{summary?.topModule ?? '---'}</p>
          </div>
        </div>

        {/* Table */}
        <AdminDataTable
          columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]}
          data={logs as unknown as Record<string, unknown>[]}
          rowKey={r => (r as unknown as ActivityLog).id}
          searchKeys={['userName', 'action', 'module', 'description']}
          searchPlaceholder={t('staffActivityLog.searchPlaceholder')}
          loading={isLoading}
          emptyMessage={t('staffActivityLog.emptyMessage')}
        />
      </div>
    </DashboardLayout>
  );
}
