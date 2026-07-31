import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { Users as UsersIcon, Search, UserX } from 'lucide-react';
import Pagination from '../components/Pagination';
import EmptyState from '../components/EmptyState';

export default function Users() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, search],
    queryFn: () => api.users.list(page, limit, search || undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Platform Users</h2>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search users..."
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Tenant ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                  </td>
                </tr>
              ) : data?.users?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyState
                      icon={UserX}
                      title={search ? 'No users match your search' : 'No users yet'}
                      description={
                        search
                          ? `No results for "${search}".`
                          : 'Users will appear here as hospitals sign up.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                data?.users?.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-600">
                          {user.name?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <span className="font-medium text-slate-900">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{user.tenant_id || '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                    </td>
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
