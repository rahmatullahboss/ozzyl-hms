import { pathToFileURL } from 'node:url';

export interface TenantFinancialAggregate {
  invoiceCount: number;
  invoiceGrossMinor: number;
  invoiceDiscountMinor: number;
  invoiceNetMinor: number;
  invoicePaidMinor: number;
  invoiceDueMinor: number;
  receiptCount: number;
  receiptTotalMinor: number;
  allocationTotalMinor: number;
  depositReceivedMinor: number;
  depositAppliedMinor: number;
  depositRefundedMinor: number;
  creditNoteMinor: number;
  refundMinor: number;
  reversalMinor: number;
}

export interface TenantFinancialReconciliationControls {
  secondPassNewRows: number;
  sourceMappingDuplicates: number;
  crossTenantRows: number;
  unresolvedCriticalIssues: number;
  blockedOutbox: number;
  blockedAccounting: number;
}

export interface TenantFinancialReconciliationSnapshot {
  tenantId: string;
  cutoffUtc: string;
  legacy: TenantFinancialAggregate;
  canonical: TenantFinancialAggregate;
  controls: TenantFinancialReconciliationControls;
}

export type TenantFinancialVariance = {
  [Key in keyof TenantFinancialAggregate]: number;
};

export interface TenantFinancialReconciliationReceipt {
  schemaVersion: 1;
  evidenceReady: boolean;
  activationReady: boolean;
  tenantId: string;
  cutoffUtc: string;
  variance: TenantFinancialVariance;
  controls: TenantFinancialReconciliationControls;
  issues: string[];
  aggregateOnly: true;
  productionMutationPerformed: false;
}

const AGGREGATE_KEYS: Array<keyof TenantFinancialAggregate> = [
  'invoiceCount',
  'invoiceGrossMinor',
  'invoiceDiscountMinor',
  'invoiceNetMinor',
  'invoicePaidMinor',
  'invoiceDueMinor',
  'receiptCount',
  'receiptTotalMinor',
  'allocationTotalMinor',
  'depositReceivedMinor',
  'depositAppliedMinor',
  'depositRefundedMinor',
  'creditNoteMinor',
  'refundMinor',
  'reversalMinor',
];

function validTenantId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function validUtc(value: string): boolean {
  return value.endsWith('Z') && Number.isFinite(Date.parse(value));
}

function safeNonNegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validAggregate(value: TenantFinancialAggregate): boolean {
  return AGGREGATE_KEYS.every((key) => safeNonNegative(value[key]));
}

function variance(
  legacy: TenantFinancialAggregate,
  canonical: TenantFinancialAggregate,
): TenantFinancialVariance {
  return Object.fromEntries(
    AGGREGATE_KEYS.map((key) => [key, canonical[key] - legacy[key]]),
  ) as TenantFinancialVariance;
}

export function evaluateTenantFinancialReconciliation(
  snapshot: TenantFinancialReconciliationSnapshot,
): TenantFinancialReconciliationReceipt {
  const issues: string[] = [];
  if (!validTenantId(snapshot.tenantId)) issues.push('CDB101_FINANCIAL_RECONCILIATION_TENANT_INVALID');
  if (!validUtc(snapshot.cutoffUtc)) issues.push('CDB101_FINANCIAL_RECONCILIATION_CUTOFF_INVALID');
  if (!validAggregate(snapshot.legacy) || !validAggregate(snapshot.canonical)) {
    issues.push('CDB101_FINANCIAL_RECONCILIATION_AGGREGATE_INVALID');
  }

  const controls = snapshot.controls;
  if (!Object.values(controls).every(safeNonNegative)) {
    issues.push('CDB101_FINANCIAL_RECONCILIATION_CONTROLS_INVALID');
  }

  const observedVariance = variance(snapshot.legacy, snapshot.canonical);
  for (const [key, value] of Object.entries(observedVariance)) {
    if (value !== 0) issues.push(`CDB101_FINANCIAL_VARIANCE_${key.replace(/[A-Z]/g, (match) => `_${match}`).toUpperCase()}`);
  }
  if (controls.secondPassNewRows !== 0) issues.push('CDB101_FINANCIAL_SECOND_PASS_NOT_ZERO');
  if (controls.sourceMappingDuplicates !== 0) issues.push('CDB101_FINANCIAL_SOURCE_MAPPING_DUPLICATE');
  if (controls.crossTenantRows !== 0) issues.push('CDB101_FINANCIAL_TENANT_ISOLATION_FAILED');
  if (controls.unresolvedCriticalIssues !== 0) issues.push('CDB101_FINANCIAL_CRITICAL_ISSUES_REMAIN');
  if (controls.blockedOutbox !== 0) issues.push('CDB101_FINANCIAL_BLOCKED_OUTBOX_REMAINS');
  if (controls.blockedAccounting !== 0) issues.push('CDB101_FINANCIAL_BLOCKED_ACCOUNTING_REMAINS');

  const evidenceReady = !issues.some((issue) => (
    issue.endsWith('_INVALID')
    || issue === 'CDB101_FINANCIAL_RECONCILIATION_TENANT_INVALID'
    || issue === 'CDB101_FINANCIAL_RECONCILIATION_CUTOFF_INVALID'
  ));

  return {
    schemaVersion: 1,
    evidenceReady,
    activationReady: evidenceReady && issues.length === 0,
    tenantId: snapshot.tenantId,
    cutoffUtc: snapshot.cutoffUtc,
    variance: observedVariance,
    controls: { ...controls },
    issues: [...new Set(issues)],
    aggregateOnly: true,
    productionMutationPerformed: false,
  };
}

function main(): void {
  process.stderr.write('Use the protected tenant-financial snapshot collector; this module evaluates aggregate evidence only.\n');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
