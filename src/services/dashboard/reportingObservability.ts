import type { FinancialReconciliationEnvelope } from '../../../packages/shared/src/dashboard';
import { reconciliationNeedsWarning } from '../../lib/dashboard/reconciliation';

export interface DashboardReportingLogger {
  info(event: string, payload: DashboardReconciliationLogPayload): void;
  warn(event: string, payload: DashboardReconciliationLogPayload): void;
}

export interface DashboardReconciliationLogPayload {
  reportKey: string;
  contractVersion: string;
  periodDays: number;
  dateBasis: string;
  durationMs: number;
  detailRowCount: number;
  reconciliationStatus: FinancialReconciliationEnvelope['status'];
  unexplainedDifference: number | null;
  providerMode: FinancialReconciliationEnvelope['providerMode'];
}

export interface ObserveDashboardReconciliationInput {
  logger: DashboardReportingLogger;
  reportKey: string;
  contractVersion: string;
  period: {
    startDate: string;
    endDate: string;
  };
  dateBasis: string;
  durationMs: number;
  reconciliation: FinancialReconciliationEnvelope;
  sampleReconciled?: boolean;
}

function inclusivePeriodDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function safeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function observeDashboardReconciliation(
  input: ObserveDashboardReconciliationInput,
): void {
  const payload: DashboardReconciliationLogPayload = {
    reportKey: input.reportKey,
    contractVersion: input.contractVersion,
    periodDays: inclusivePeriodDays(input.period.startDate, input.period.endDate),
    dateBasis: input.dateBasis,
    durationMs: safeInteger(input.durationMs),
    detailRowCount: safeInteger(input.reconciliation.detailRowCount),
    reconciliationStatus: input.reconciliation.status,
    unexplainedDifference: input.reconciliation.unexplainedDifference,
    providerMode: input.reconciliation.providerMode,
  };

  if (reconciliationNeedsWarning(input.reconciliation)) {
    input.logger.warn('dashboard.reconciliation.warning', payload);
    return;
  }

  if (input.sampleReconciled) {
    input.logger.info('dashboard.reconciliation.sample', payload);
  }
}
