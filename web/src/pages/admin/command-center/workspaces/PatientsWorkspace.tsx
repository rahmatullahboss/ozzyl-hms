import { useMemo } from 'react';
import { ArrowRight, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import PatientAgeDetailDrawer from '../../../../components/dashboard/PatientAgeDetailDrawer';
import PatientAgeSummary from '../../../../components/dashboard/PatientAgeSummary';
import { useCurrentUserAccess } from '../../../../hooks/useCurrentUserAccess';
import { useExecutiveDashboardAnalytics } from '../../../../hooks/useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardMetric } from '../../../../hooks/useExecutiveDashboardKpis';
import type {
  ExecutiveDashboardFilters,
  PatientAgeBucket,
} from '../../../../types/executiveDashboard';

interface Props {
  basePath: string;
  filters: ExecutiveDashboardFilters;
  ageBucket?: PatientAgeBucket;
  onAgeBucketChange: (bucket: PatientAgeBucket | null) => void;
}

export default function PatientsWorkspace({ basePath, filters, ageBucket, onAgeBucketChange }: Props) {
  const enabledPanels = useMemo<Set<ExecutiveDashboardMetric>>(() => new Set(), []);
  const analytics = useExecutiveDashboardAnalytics({
    queryKeyScope: 'admin',
    filters,
    enabledPanels,
    patientAgeEnabled: true,
  });
  const currentUserAccess = useCurrentUserAccess(true);
  const role = currentUserAccess.data?.user?.role;
  const effectivePermissions = currentUserAccess.data?.effective_permissions ?? [];
  const canViewPatients = role === 'hospital_admin'
    || role === 'super_admin'
    || effectivePermissions.includes('*')
    || effectivePermissions.includes('patients:read');

  return (
    <section data-testid="workspace-patients" className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bg-subtle)] text-[var(--color-primary)]">
              <UsersRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">Patients</h2>
              <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
                Understand demand, visits, admissions, services, collections, and repeat activity by completed age on the service date.
              </p>
            </div>
          </div>
          <Link
            to={`${basePath}/patients`}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors duration-200 hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            Open patient register
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <PatientAgeSummary
        data={analytics.patientAge.data}
        loading={analytics.patientAge.isLoading}
        error={analytics.patientAge.isError}
        onRetry={() => { void analytics.patientAge.refetch(); }}
        onBucketSelect={(bucket) => onAgeBucketChange(bucket)}
      />
      <PatientAgeDetailDrawer
        ageBucket={ageBucket ?? null}
        filters={filters}
        canViewPatients={canViewPatients}
        onClose={() => onAgeBucketChange(null)}
      />
    </section>
  );
}
