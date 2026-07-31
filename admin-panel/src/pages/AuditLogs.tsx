import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { FileText, Search, ScrollText } from 'lucide-react';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, search],
    queryFn: () => api.auditLogs.list(page, limit, search || undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Audit Logs</h2>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Table</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Record ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                  </td>
                </tr>
              ) : data?.logs?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={ScrollText}
                      title={search ? 'No logs match your search' : 'No audit logs yet'}
                      description={
                        search
                          ? `No results for "${search}".`
                          : 'Platform actions will be recorded here as they happen.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                data?.logs?.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{log.table_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{log.tenant_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{log.user_email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 font-mono">{log.record_id || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data?.pagination && (
          <Pagination
            page={page}
            totalPages={data.pagination.totalPages}
            total={data.pagination.total}
            limit={limit}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
