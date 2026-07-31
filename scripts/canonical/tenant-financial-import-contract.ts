import type { ProductionCanonicalImportManifest } from './import-production-canonical-bundle';
import { CDB101_PRODUCTION_DATABASE_ID } from './production-cutover-contract';

export const CDB101_FINANCIAL_TENANT_ID = '100' as const;
export const CDB101_FINANCIAL_CURRENCY_CODE = 'BDT' as const;

export const CDB101_FINANCIAL_IMPORT_TABLES = [
  'canonical_migration_runs',
  'canonical_backfill_checkpoints',
  'canonical_practitioners',
  'canonical_encounters',
  'canonical_encounter_admission_links',
  'canonical_bed_stays',
  'canonical_service_catalog_items',
  'canonical_service_prices',
  'canonical_service_requests',
  'canonical_service_events',
  'canonical_service_participants',
  'canonical_invoices',
  'canonical_invoice_lines',
  'canonical_invoice_encounter_links',
  'canonical_payment_receipts',
  'canonical_payment_tenders',
  'canonical_payment_allocations',
  'canonical_deposits',
  'canonical_deposit_applications',
  'canonical_credit_notes',
  'canonical_credit_note_lines',
  'canonical_refunds',
  'canonical_payment_reversals',
  'canonical_compensation_rules',
  'canonical_compensation_accruals',
  'canonical_compensation_reporting_context',
  'canonical_compensation_settlements',
  'canonical_compensation_settlement_allocations',
  'canonical_compensation_adjustments',
  'canonical_compensation_refund_reservations',
  'canonical_compensation_adjustment_reversals',
  'canonical_source_mappings',
  'canonical_processing_issues',
  'canonical_outbox_events',
  'canonical_accounting_posting_jobs',
] as const;

export type Cdb101FinancialImportTable = typeof CDB101_FINANCIAL_IMPORT_TABLES[number];

export interface TenantFinancialImportContractResult {
  valid: boolean;
  issues: string[];
}

function exactOrderedList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeHash(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function validateTenantFinancialImportManifest(
  manifest: ProductionCanonicalImportManifest | unknown,
): TenantFinancialImportContractResult {
  const issues: string[] = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, issues: ['CDB101_FINANCIAL_IMPORT_MANIFEST_INVALID'] };
  }

  const candidate = manifest as Partial<ProductionCanonicalImportManifest>;
  if (candidate.schemaVersion !== 1) issues.push('CDB101_FINANCIAL_IMPORT_SCHEMA_VERSION_INVALID');
  if (
    typeof candidate.authorizationId !== 'string'
    || !/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(candidate.authorizationId)
  ) {
    issues.push('CDB101_FINANCIAL_IMPORT_AUTHORIZATION_ID_INVALID');
  }
  if (candidate.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_FINANCIAL_IMPORT_DATABASE_INVALID');
  }
  if (!Array.isArray(candidate.tenantIds) || !exactOrderedList(candidate.tenantIds, [CDB101_FINANCIAL_TENANT_ID])) {
    issues.push('CDB101_FINANCIAL_IMPORT_TENANT_SCOPE_INVALID');
  }
  if (
    !Array.isArray(candidate.allowedTables)
    || !exactOrderedList(candidate.allowedTables, CDB101_FINANCIAL_IMPORT_TABLES)
  ) {
    issues.push('CDB101_FINANCIAL_IMPORT_TABLE_SCOPE_INVALID');
  }
  if (!safeHash(candidate.bundleSha256)) issues.push('CDB101_FINANCIAL_IMPORT_BUNDLE_HASH_INVALID');
  if (!safeHash(candidate.sourceExportSha256)) issues.push('CDB101_FINANCIAL_IMPORT_SOURCE_HASH_INVALID');
  if (
    typeof candidate.deterministicRunId !== 'string'
    || !/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(candidate.deterministicRunId)
  ) {
    issues.push('CDB101_FINANCIAL_IMPORT_RUN_ID_INVALID');
  }
  if (candidate.secondPassRequired !== true) issues.push('CDB101_FINANCIAL_IMPORT_SECOND_PASS_REQUIRED');

  if (!candidate.rowCountSummary || typeof candidate.rowCountSummary !== 'object' || Array.isArray(candidate.rowCountSummary)) {
    issues.push('CDB101_FINANCIAL_IMPORT_ROW_COUNTS_INVALID');
  } else {
    const entries = Object.entries(candidate.rowCountSummary);
    const keys = entries.map(([key]) => key);
    if (!exactOrderedList(keys, CDB101_FINANCIAL_IMPORT_TABLES)) {
      issues.push('CDB101_FINANCIAL_IMPORT_ROW_COUNT_SCOPE_INVALID');
    }
    if (entries.some(([, value]) => !Number.isSafeInteger(value) || Number(value) < 0)) {
      issues.push('CDB101_FINANCIAL_IMPORT_ROW_COUNT_VALUE_INVALID');
    }
  }

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
