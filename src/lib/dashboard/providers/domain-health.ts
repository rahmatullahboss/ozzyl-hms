import type {
  DashboardOverviewProvider,
  DashboardOverviewProviderInput,
  DashboardOverviewProviderResult,
} from '../admin-overview';

export type DomainHealthDashboardLoader = (
  input: DashboardOverviewProviderInput,
) => Promise<Omit<DashboardOverviewProviderResult, 'domain'>>;

export function createDomainHealthDashboardProvider(loader: DomainHealthDashboardLoader): DashboardOverviewProvider {
  return async (input) => ({ domain: 'domain_health', ...await loader(input) });
}
