import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { AdminDashboardOverviewResponse } from '../../../../packages/shared/src/dashboard';
import KPISummaryCards from './widgets/KPISummaryCards';
import IPDBillingOverview from '../../components/dashboard/IPDBillingOverview';
import ExecutiveDuePanel from '../../components/dashboard/ExecutiveDuePanel';
import ActionRequiredPanel from './widgets/ActionRequiredPanel';
import LiveCashDrawerWidget from './widgets/LiveCashDrawerWidget';
import OperationsSnapshot from './widgets/OperationsSnapshot';
import RevenueTrendChart from './widgets/RevenueTrendChart';
import PaymentMethodBreakdown from './widgets/PaymentMethodBreakdown';
import AuditFeedWidget from './widgets/AuditFeedWidget';
import DashboardLayout from '../../components/DashboardLayout';
import PendingRequestsSection from '../../components/dashboard/PendingRequestsSection';
import { resolveExecutiveDashboardFilters } from '../../components/dashboard/ExecutiveDashboardRangeFilter';
import type { DashboardPeriod } from '../../components/dashboard/dashboardPeriod';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { getTodayGMT6 } from '../../lib/date-utils';
import AdminCommandCenter from './command-center/AdminCommandCenter';
import { parseCommandCenterUrlState } from './command-center/commandCenterUrlState';

function LegacyAdminDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug ?? ''}`;
  const [filters, setFilters] = useState(() => resolveExecutiveDashboardFilters('today'));
  const period = useMemo<DashboardPeriod>(() => ({
    startDate: filters.startDate,
    endDate: filters.endDate,
    label: filters.startDate === filters.endDate
      ? filters.endDate
      : `${filters.startDate} – ${filters.endDate}`,
  }), [filters.endDate, filters.startDate]);
  const pendingRequestWindow = { from: filters.startDate, to: filters.endDate };

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <KPISummaryCards filters={filters} onFiltersChange={setFilters} />
        <PendingRequestsSection role="hospital_admin" window={pendingRequestWindow} />

        <ExecutiveDuePanel
          role="hospital_admin"
          basePath={base}
          queryKeyScope="admin"
        />

        <IPDBillingOverview period={period} queryKeyScope="admin" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RevenueTrendChart />
          </div>
          <div>
            <PaymentMethodBreakdown />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <ActionRequiredPanel />
            <OperationsSnapshot />
          </div>

          <div className="space-y-6">
            <LiveCashDrawerWidget />
            <AuditFeedWidget />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

const COMMAND_CENTER_PREVIEW_MODE = 'dashboard-v2';

function overviewPath(searchParams: URLSearchParams): string {
  const state = parseCommandCenterUrlState(searchParams, getTodayGMT6());
  const params = new URLSearchParams({
    preset: state.filters.preset,
    startDate: state.filters.startDate,
    endDate: state.filters.endDate,
  });
  if (state.dateBasis) params.set('dateBasis', state.dateBasis);
  if (state.doctorId) params.set('doctorId', String(state.doctorId));
  params.set('preview', COMMAND_CENTER_PREVIEW_MODE);
  return `/api/dashboard/admin-overview-v2?${params.toString()}`;
}

function AdminCommandCenterDashboard() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const path = useMemo(
    () => overviewPath(searchParams),
    [searchParams],
  );
  const overviewQuery = useApiQuery<AdminDashboardOverviewResponse>(
    ['admin', 'command-center', 'overview', path],
    path,
    {
      retry: false,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );

  const refreshCommandCenter = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  if (overviewQuery.isError) {
    return (
      <DashboardLayout role="hospital_admin">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
          <h1 className="text-xl font-semibold">Command Center unavailable</h1>
          <p className="mt-2 text-sm">The v2 dashboard could not be loaded. The current dashboard remains available at the standard dashboard URL.</p>
          <button
            type="button"
            className="mt-4 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium"
            onClick={() => { void overviewQuery.refetch(); }}
          >
            Retry
          </button>
        </div>
      </DashboardLayout>
    );
  }

  if (!overviewQuery.data) {
    return (
      <DashboardLayout role="hospital_admin">
        <div data-testid="command-center-loading" role="status" className="p-6 text-sm text-slate-600">
          Loading Command Center…
        </div>
      </DashboardLayout>
    );
  }

  if (overviewQuery.data?.reportKey === 'admin_control_center') {
    return (
      <AdminCommandCenter
        overview={overviewQuery.data}
        onRefresh={() => { void refreshCommandCenter(); }}
        refreshing={refreshing || overviewQuery.isFetching}
      />
    );
  }

  return (
    <DashboardLayout role="hospital_admin">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h1 className="text-xl font-semibold">Command Center unavailable</h1>
        <p className="mt-2 text-sm">The v2 dashboard returned an unsupported response. The current dashboard remains available at the standard dashboard URL.</p>
      </div>
    </DashboardLayout>
  );
}

export default function AdminDashboard({ forceCommandCenter = false }: { forceCommandCenter?: boolean }) {
  return forceCommandCenter ? <AdminCommandCenterDashboard /> : <LegacyAdminDashboard />;
}
