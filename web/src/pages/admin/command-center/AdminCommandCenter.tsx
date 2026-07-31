import { useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { AdminDashboardOverviewResponse } from '../../../../../packages/shared/src/dashboard';
import DashboardLayout from '../../../components/DashboardLayout';
import { getTodayGMT6 } from '../../../lib/date-utils';
import type { ExecutiveDashboardFilters } from '../../../types/executiveDashboard';
import CommandCenterHeader from './CommandCenterHeader';
import CommandCenterTabs, { type CommandCenterTabChangeOptions } from './CommandCenterTabs';
import AuditWorkspace from './workspaces/AuditWorkspace';
import DiagnosticsWorkspace from './workspaces/DiagnosticsWorkspace';
import DoctorsWorkspace from './workspaces/DoctorsWorkspace';
import InventoryWorkspace from './workspaces/InventoryWorkspace';
import IPDWorkspace from './workspaces/IPDWorkspace';
import MoneyWorkspace from './workspaces/MoneyWorkspace';
import OverviewWorkspace from './workspaces/OverviewWorkspace';
import PatientsWorkspace from './workspaces/PatientsWorkspace';
import {
  parseCommandCenterUrlState,
  updateCommandCenterUrl,
  type CommandCenterTab,
} from './commandCenterUrlState';

interface Props {
  overview: AdminDashboardOverviewResponse;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export default function AdminCommandCenter({
  overview,
  onRefresh = () => undefined,
  refreshing = false,
}: Props) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusWorkspaceAfterChange = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(
    () => parseCommandCenterUrlState(searchParams, getTodayGMT6()),
    [searchParams],
  );

  const selectTab = (tab: CommandCenterTab, options?: CommandCenterTabChangeOptions) => {
    focusWorkspaceAfterChange.current = Boolean(options?.focusWorkspace);
    setSearchParams(updateCommandCenterUrl(searchParams, { tab }), { replace: false });
  };

  const changeFilters = (filters: ExecutiveDashboardFilters) => {
    setSearchParams(updateCommandCenterUrl(searchParams, {
      range: filters.preset,
      from: filters.preset === 'custom' ? filters.startDate : null,
      to: filters.preset === 'custom' ? filters.endDate : null,
      doctorId: null,
      testId: null,
      invoiceId: null,
      ageBucket: null,
    }), { replace: false });
  };

  useEffect(() => {
    if (!focusWorkspaceAfterChange.current) return;
    const heading = rootRef.current?.querySelector<HTMLElement>('[data-command-center-workspace-heading]');
    heading?.focus();
    focusWorkspaceAfterChange.current = false;
  }, [state.tab]);

  const workspace = (() => {
    switch (state.tab) {
      case 'overview': return <OverviewWorkspace overview={overview} basePath={basePath} filters={state.filters} />;
      case 'money': return <MoneyWorkspace filters={state.filters} />;
      case 'doctors': return (
        <DoctorsWorkspace
          filters={state.filters}
          doctorId={state.doctorId}
          onDoctorIdChange={(doctorId) => {
            setSearchParams(updateCommandCenterUrl(searchParams, { doctorId }), { replace: false });
          }}
        />
      );
      case 'patients': return (
        <PatientsWorkspace
          basePath={basePath}
          filters={state.filters}
          ageBucket={state.ageBucket}
          onAgeBucketChange={(ageBucket) => {
            setSearchParams(updateCommandCenterUrl(searchParams, { ageBucket }), { replace: false });
          }}
        />
      );
      case 'ipd': return <IPDWorkspace filters={state.filters} basePath={basePath} />;
      case 'diagnostics': return <DiagnosticsWorkspace filters={state.filters} />;
      case 'inventory': return <InventoryWorkspace filters={state.filters} />;
      case 'audit': return <AuditWorkspace />;
    }
  })();

  return (
    <DashboardLayout role="hospital_admin">
      <div ref={rootRef} className="min-w-0 space-y-4 overflow-x-hidden" data-testid="admin-command-center">
        <CommandCenterHeader
          filters={state.filters}
          generatedAt={overview.generatedAt}
          onFiltersChange={changeFilters}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        <CommandCenterTabs activeTab={state.tab} onChange={selectTab} />
        <div
          id={`command-center-panel-${state.tab}`}
          role="tabpanel"
          aria-labelledby={`command-center-tab-${state.tab}`}
          className="min-w-0"
        >
          {workspace}
        </div>
      </div>
    </DashboardLayout>
  );
}
