import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { Building2, Users, HeartPulse, DollarSign, TrendingUp, TrendingDown, Clock, Inbox } from 'lucide-react';
import { formatBDTLakh, formatDate } from '../lib/format';
import EmptyState from '../components/EmptyState';

export default function Dashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.stats.get(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-red-600 font-medium">Failed to load dashboard</p>
          <p className="text-sm text-slate-500 mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: 'Total Hospitals',
      value: stats?.hospitals.total || 0,
      icon: Building2,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Active Hospitals',
      value: stats?.hospitals.active || 0,
      icon: TrendingUp,
      color: 'bg-green-50 text-green-600',
    },
    {
      title: 'Total Patients',
      value: stats?.patients || 0,
      icon: HeartPulse,
      color: 'bg-red-50 text-red-600',
    },
    {
      title: 'Total Revenue',
      value: formatBDTLakh(stats?.revenue.totalPaid || 0),
      icon: DollarSign,
      color: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Total Users',
      value: stats?.users || 0,
      icon: Users,
      color: 'bg-purple-50 text-purple-600',
    },
    {
      title: 'Pending Onboarding',
      value: stats?.pendingOnboarding || 0,
      icon: Clock,
      color: 'bg-orange-50 text-orange-600',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.title}
              className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">{kpi.title}</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">{kpi.value}</h3>
                </div>
                <div className={`p-2.5 rounded-lg ${kpi.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800">Recently Added Hospitals</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {stats?.recentHospitals?.length ? (
            stats.recentHospitals.map((hospital) => (
              <div key={hospital.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">{hospital.name}</p>
                    <p className="text-sm text-slate-500">{hospital.subdomain}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    hospital.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : hospital.status === 'inactive'
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {hospital.status}
                  </span>
                  <span className="text-sm text-slate-500">
                    {formatDate(hospital.created_at)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              icon={Inbox}
              title="No recent hospitals"
              description="New hospitals will appear here within 7 days of signup."
            />
          )}
        </div>
      </div>
    </div>
  );
}
