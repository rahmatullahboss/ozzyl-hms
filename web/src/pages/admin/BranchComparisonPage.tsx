import { Building2, TrendingUp, TrendingDown, Users, Bed, RefreshCw, ArrowRightLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency } from '../../lib/format';

interface BranchData {
  slug: string;
  name: string;
  todayCollection: number;
  todayExpense: number;
  opdPatients: number;
  ipdOccupied: number;
  totalBeds: number;
  occupancyPercent: number;
  outstandingDue: number;
  staffCount: number;
}

interface BranchComparisonResponse {
  branches: BranchData[];
  totals: {
    totalCollection: number;
    totalExpense: number;
    totalPatients: number;
    totalOccupied: number;
    totalBeds: number;
    avgOccupancy: number;
  };
}

function BranchCard({ branch, isCurrentBranch }: { branch: BranchData; isCurrentBranch: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation('adminPages');

  return (
    <div
      className={`card p-5 cursor-pointer hover:shadow-md transition-shadow ${isCurrentBranch ? 'ring-2 ring-[var(--color-primary)]' : ''}`}
      onClick={() => navigate(`/h/${branch.slug}/admin-dashboard`)}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[var(--color-primary)]" />
          <h3 className="font-semibold text-[var(--color-text-primary)]">{branch.name}</h3>
        </div>
        {isCurrentBranch && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-primary)] text-white font-medium">
            {t('branchComparison.current')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('branchComparison.collection')}</p>
          <p className="text-lg font-bold text-emerald-600">{formatCurrency(branch.todayCollection)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('branchComparison.expense')}</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(branch.todayExpense)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('branchComparison.opd')}</p>
          <p className="text-lg font-bold">{branch.opdPatients}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('branchComparison.ipd')}</p>
          <p className="text-lg font-bold">{branch.ipdOccupied}/{branch.totalBeds}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('branchComparison.occupancy')}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${branch.occupancyPercent > 80 ? 'bg-red-500' : branch.occupancyPercent > 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${branch.occupancyPercent}%` }}
              />
            </div>
            <span className="text-sm font-semibold">{branch.occupancyPercent}%</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('branchComparison.due')}</p>
          <p className="text-lg font-bold text-amber-600">{formatCurrency(branch.outstandingDue)}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <Users className="w-3.5 h-3.5" />
          {t('branchComparison.staffCount', { count: branch.staffCount })}
        </div>
        <span className="text-xs text-[var(--color-primary)]">{t('branchComparison.viewDashboard')} →</span>
      </div>
    </div>
  );
}

export default function BranchComparisonPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation('adminPages');
  const { data, isLoading, refetch } = useApiQuery<BranchComparisonResponse>(
    queryKeys.branches.analytics('all'),
    '/api/branches/analytics',
    { refetchInterval: 60000 },
  );

  const branches = data?.branches ?? [];
  const totals = data?.totals;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('branchComparison.title')}</h1>
            <p className="text-sm text-gray-500">{t('branchComparison.subtitle')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-ghost p-2"
            title={t('branchComparison.refresh')}
            aria-label={t('branchComparison.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Totals */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-gray-500">{t('branchComparison.totalCollection')}</span>
              </div>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(totals.totalCollection)}</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-red-500" />
                <span className="text-xs text-gray-500">{t('branchComparison.totalExpense')}</span>
              </div>
              <p className="text-xl font-bold text-red-600">{formatCurrency(totals.totalExpense)}</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-gray-500">{t('branchComparison.totalPatients')}</span>
              </div>
              <p className="text-xl font-bold">{totals.totalPatients}</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Bed className="w-4 h-4 text-cyan-500" />
                <span className="text-xs text-gray-500">{t('branchComparison.ipdOccupied')}</span>
              </div>
              <p className="text-xl font-bold">{totals.totalOccupied}/{totals.totalBeds}</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowRightLeft className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-gray-500">{t('branchComparison.avgOccupancy')}</span>
              </div>
              <p className="text-xl font-bold">{totals.avgOccupancy}%</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-gray-500" />
                <span className="text-xs text-gray-500">{t('branchComparison.branches')}</span>
              </div>
              <p className="text-xl font-bold">{branches.length}</p>
            </div>
          </div>
        )}

        {/* Branch Cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="skeleton h-48 w-full rounded-lg" />)}
          </div>
        ) : branches.length === 0 ? (
          <div className="card p-12 text-center">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">{t('branchComparison.noBranchData')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map(branch => (
              <BranchCard key={branch.slug} branch={branch} isCurrentBranch={branch.slug === slug} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
