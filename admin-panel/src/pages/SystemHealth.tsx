import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { Activity, Database, Server, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export default function SystemHealth() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api.systemHealth.get(),
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="w-6 h-6 text-green-500" />;
      case 'degraded': return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
      case 'down': return <XCircle className="w-6 h-6 text-red-500" />;
      default: return <Activity className="w-6 h-6 text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-50 border-green-200';
      case 'degraded': return 'bg-yellow-50 border-yellow-200';
      case 'down': return 'bg-red-50 border-red-200';
      default: return 'bg-slate-50 border-slate-200';
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-600 font-medium">Failed to load system health</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-slate-800">System Health</h2>

      <div className={`p-6 rounded-xl border ${getStatusColor(data?.status || 'healthy')}`}>
        <div className="flex items-center gap-4">
          {getStatusIcon(data?.status || 'healthy')}
          <div>
            <h3 className="text-lg font-semibold capitalize">{data?.status || 'Unknown'}</h3>
            <p className="text-sm text-slate-600">
              {data?.status === 'healthy' ? 'System is operating normally' :
               data?.status === 'degraded' ? 'System experiencing issues' :
               data?.status === 'down' ? 'System is down' : 'Checking...'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-800">Database Statistics</h3>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Table Name</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Row Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.database?.tableStats?.length ? (
                  data.database.tableStats.map((table) => (
                    <tr key={table.table} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900 capitalize">
                        {table.table.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">
                        {table.count.toLocaleString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-slate-500">No data available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 p-4 bg-slate-50 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Total Tables</span>
            <span className="font-semibold text-slate-900">{data?.database?.totalTables || 0}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-5 h-5 text-slate-600" />
          <h3 className="text-lg font-semibold text-slate-800">Server Information</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Platform</p>
            <p className="text-lg font-semibold text-slate-900">Cloudflare Workers</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Uptime</p>
            <p className="text-lg font-semibold text-slate-900">{data?.uptime || 'N/A (Serverless)'}</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Region</p>
            <p className="text-lg font-semibold text-slate-900">Global Edge Network</p>
          </div>
          <div className="p-4 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-500">Last Checked</p>
            <p className="text-lg font-semibold text-slate-900">{new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
