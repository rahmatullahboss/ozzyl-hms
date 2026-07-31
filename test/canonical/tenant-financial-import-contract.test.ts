import { describe, expect, it } from 'vitest';
import {
  CDB101_FINANCIAL_IMPORT_TABLES,
  validateTenantFinancialImportManifest,
} from '../../scripts/canonical/tenant-financial-import-contract';

describe('tenant financial import contract', () => {
  it('uses the exact ordered tenant-100 financial table scope', () => {
    expect(CDB101_FINANCIAL_IMPORT_TABLES).toEqual([
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
    ]);
  });

  it('accepts only the exact tenant, database, table scope and hashes', () => {
    const result = validateTenantFinancialImportManifest({
      schemaVersion: 1,
      authorizationId: 'cdb101-financial-20260718',
      productionDatabaseId: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      tenantIds: ['100'],
      allowedTables: [...CDB101_FINANCIAL_IMPORT_TABLES],
      bundleSha256: 'a'.repeat(64),
      sourceExportSha256: 'b'.repeat(64),
      deterministicRunId: 'tenant-100-finance-20260718',
      secondPassRequired: true,
      rowCountSummary: Object.fromEntries(CDB101_FINANCIAL_IMPORT_TABLES.map((table) => [table, 0])),
    });
    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('fails closed for cross-tenant or unexpected table scope', () => {
    const result = validateTenantFinancialImportManifest({
      schemaVersion: 1,
      authorizationId: 'cdb101-financial-20260718',
      productionDatabaseId: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      tenantIds: ['100', '101'],
      allowedTables: [...CDB101_FINANCIAL_IMPORT_TABLES, 'canonical_feature_flags'],
      bundleSha256: 'a'.repeat(64),
      sourceExportSha256: 'b'.repeat(64),
      deterministicRunId: 'tenant-100-finance-20260718',
      secondPassRequired: true,
      rowCountSummary: {},
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('CDB101_FINANCIAL_IMPORT_TENANT_SCOPE_INVALID');
    expect(result.issues).toContain('CDB101_FINANCIAL_IMPORT_TABLE_SCOPE_INVALID');
  });
});
