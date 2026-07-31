import { describe, expect, it } from 'vitest';
import {
  calculateSecondPassNewRows,
  evaluateTenantFinancialBackfillReadiness,
  REQUIRED_FINANCIAL_MIGRATIONS,
} from '../../scripts/canonical/prepare-tenant-financial-backfill';
import { CDB101_FINANCIAL_IMPORT_TABLES } from '../../scripts/canonical/tenant-financial-import-contract';

describe('tenant financial backfill preparation', () => {
  it('applies live compensation and reporting-context schema before replay', () => {
    expect(REQUIRED_FINANCIAL_MIGRATIONS).toContain('0519_live_doctor_compensation_dual_write.sql');
    expect(REQUIRED_FINANCIAL_MIGRATIONS).toContain('0530_canonical_compensation_reporting_context.sql');
    expect(REQUIRED_FINANCIAL_MIGRATIONS).toContain('0531_canonical_compensation_refund_reservations.sql');
  });

  it('reports zero second-pass rows when every business-table count is stable', () => {
    expect(calculateSecondPassNewRows(
      { canonical_invoices: 10, canonical_payment_receipts: 8 },
      { canonical_invoices: 10, canonical_payment_receipts: 8 },
    )).toBe(0);
  });

  it('counts every new second-pass business row', () => {
    expect(calculateSecondPassNewRows(
      { canonical_invoices: 10, canonical_payment_receipts: 8 },
      { canonical_invoices: 11, canonical_payment_receipts: 10 },
    )).toBe(3);
  });

  it('is ready only for tenant 100, unchanged legacy rows and zero-write second pass', () => {
    const result = evaluateTenantFinancialBackfillReadiness({
      tenantId: '100',
      firstPassCompleted: true,
      secondPassCompleted: true,
      secondPassNewRows: 0,
      legacyRowsBefore: 250,
      legacyRowsAfter: 250,
      bundleReady: true,
      allowedTables: [...CDB101_FINANCIAL_IMPORT_TABLES],
    });
    expect(result).toEqual({ ready: true, issues: [] });
  });

  it('fails closed for legacy mutation or incomplete second pass', () => {
    const result = evaluateTenantFinancialBackfillReadiness({
      tenantId: '100',
      firstPassCompleted: true,
      secondPassCompleted: false,
      secondPassNewRows: 1,
      legacyRowsBefore: 250,
      legacyRowsAfter: 249,
      bundleReady: false,
      allowedTables: [...CDB101_FINANCIAL_IMPORT_TABLES],
    });
    expect(result.ready).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'CDB101_FINANCIAL_BACKFILL_SECOND_PASS_INCOMPLETE',
      'CDB101_FINANCIAL_BACKFILL_SECOND_PASS_NOT_ZERO',
      'CDB101_FINANCIAL_BACKFILL_LEGACY_MUTATED',
      'CDB101_FINANCIAL_BACKFILL_BUNDLE_NOT_READY',
    ]));
  });
});
