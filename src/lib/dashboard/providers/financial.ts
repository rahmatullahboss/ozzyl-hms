import type {
  DashboardOverviewProvider,
  DashboardOverviewProviderInput,
  DashboardOverviewProviderResult,
} from '../admin-overview';

export type FinancialDashboardLoader = (
  input: DashboardOverviewProviderInput,
) => Promise<Omit<DashboardOverviewProviderResult, 'domain'>>;

export function createFinancialDashboardProvider(loader: FinancialDashboardLoader): DashboardOverviewProvider {
  return async (input) => ({ domain: 'financial', ...await loader(input) });
}
