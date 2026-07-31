import type { ExecutiveDashboardPeriod } from './executive-dashboard-period';

export interface ExecutiveAnalyticsPage {
  page: number;
  pageSize: number;
  offset: number;
}

export interface ExecutiveAnalyticsSource {
  label: string;
  amount: number;
  count: number;
  direction?: 'in' | 'out';
}

export interface ExecutiveKpiDetailRow {
  id: string;
  occurredAt: string;
  sourceType: string;
  sourceLabel: string;
  referenceNo?: string | null;
  amount: number;
  status?: string | null;
  [key: string]: unknown;
}

export interface PaginatedAnalyticsResponse<TRow, TTotals = Record<string, number>> {
  period: ExecutiveDashboardPeriod;
  totals: TTotals;
  rows: TRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}
