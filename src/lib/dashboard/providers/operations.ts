import type {
  DashboardOverviewProvider,
  DashboardOverviewProviderInput,
  DashboardOverviewProviderResult,
} from '../admin-overview';

export type OperationsDashboardLoader = (
  input: DashboardOverviewProviderInput,
) => Promise<Omit<DashboardOverviewProviderResult, 'domain'>>;

export function createOperationsDashboardProvider(loader: OperationsDashboardLoader): DashboardOverviewProvider {
  return async (input) => ({ domain: 'operations', ...await loader(input) });
}
