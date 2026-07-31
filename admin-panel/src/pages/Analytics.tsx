import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { BarChart3, Calendar } from 'lucide-react';
import { useState } from 'react';
import { formatBDT } from '../lib/format';

const DATE_RANGES: Record<string, { label: string; days: number | undefined }> = {
  all: { label: 'All time', days: undefined },
  last7days: { label: 'Last 7 Days', days: 7 },
  last30days: { label: 'Last 30 Days', days: 30 },
  last90days: { label: 'Last 90 Days', days: 90 },
  lastyear: { label: 'Last Year', days: 365 },
};

export default function Analytics() {
  const [dateRange, setDateRange] = useState('last30days');
  const sinceDays = DATE_RANGES[dateRange]?.days;

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', sinceDays ?? 'all'],
    queryFn: () => api.stats.get(sinceDays),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const hospitals = stats?.hospitals;
  const revenue = stats?.revenue;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-xl font-semibold text-slate-800">Platform Analytics</h2>
        <div className="relative">
          <label htmlFor="analytics-date-range" className="sr-only">Date range</label>
          <select
            id="analytics-date-range"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="appearance-none pl-9 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white text-sm"
          >
            {Object.entries(DATE_RANGES).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total Hospitals</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{hospitals?.total || 0}</p>
          <div className="flex gap-2 mt-2">
            <span className="text-xs text-green-600">{hospitals?.active || 0} active</span>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">{hospitals?.inactive || 0} inactive</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total Patients</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{stats?.patients || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total Billed</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatBDT(revenue?.totalBilled)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm text-slate-500">Total Paid</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{formatBDT(revenue?.totalPaid)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Revenue Summary</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">Collection Rate</span>
            <span className="font-semibold text-slate-900">
              {revenue?.totalBilled
                ? `${((revenue.totalPaid / revenue.totalBilled) * 100).toFixed(1)}%`
                : '0%'}
            </span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">Outstanding</span>
            <span className="font-semibold text-red-600">
              {formatBDT((revenue?.totalBilled || 0) - (revenue?.totalPaid || 0))}
            </span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <span className="text-sm text-slate-600">Avg Revenue per Hospital</span>
            <span className="font-semibold text-slate-900">
              {formatBDT(
                hospitals?.total ? Math.round((revenue?.totalPaid || 0) / hospitals.total) : 0,
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Hospital Status Breakdown</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-700">{hospitals?.active || 0}</p>
            <p className="text-sm text-green-600">Active</p>
          </div>
          <div className="text-center p-4 bg-slate-50 rounded-lg">
            <p className="text-2xl font-bold text-slate-700">{hospitals?.inactive || 0}</p>
            <p className="text-sm text-slate-600">Inactive</p>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <p className="text-2xl font-bold text-red-700">{hospitals?.suspended || 0}</p>
            <p className="text-sm text-red-600">Suspended</p>
          </div>
        </div>
      </div>
    </div>
  );
}
