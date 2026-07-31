import { describe, expect, it } from 'vitest';
import {
  buildTenantFinancialReconciliationSql,
  buildTenantFinancialSnapshotFromAggregateRow,
  normalizeTenantFinancialReconciliationTenantId,
  TENANT_FINANCIAL_RECONCILIATION_SQL,
  type TenantFinancialAggregateRow,
} from '../../scripts/canonical/collect-tenant-financial-reconciliation';

function aggregateRow(): TenantFinancialAggregateRow {
  return {
    legacy_invoice_count: 2,
    legacy_invoice_gross_minor: 12000,
    legacy_invoice_discount_minor: 1000,
    legacy_invoice_net_minor: 11000,
    legacy_invoice_paid_minor: 7000,
    legacy_invoice_due_minor: 4000,
    legacy_receipt_count: 1,
    legacy_receipt_total_minor: 7000,
    legacy_allocation_total_minor: 7000,
    legacy_deposit_received_minor: 2000,
    legacy_deposit_applied_minor: 500,
    legacy_deposit_refunded_minor: 100,
    legacy_credit_note_minor: 300,
    legacy_refund_minor: 100,
    legacy_reversal_minor: 0,
    canonical_invoice_count: 2,
    canonical_invoice_gross_minor: 12000,
    canonical_invoice_discount_minor: 1000,
    canonical_invoice_net_minor: 11000,
    canonical_invoice_paid_minor: 7000,
    canonical_invoice_due_minor: 4000,
    canonical_receipt_count: 1,
    canonical_receipt_total_minor: 7000,
    canonical_allocation_total_minor: 7000,
    canonical_deposit_received_minor: 2000,
    canonical_deposit_applied_minor: 500,
    canonical_deposit_refunded_minor: 100,
    canonical_credit_note_minor: 300,
    canonical_refund_minor: 100,
    canonical_reversal_minor: 0,
    source_mapping_duplicates: 0,
    cross_tenant_rows: 0,
    unresolved_critical_issues: 0,
    blocked_outbox: 0,
    blocked_accounting: 0,
  };
}

describe('tenant financial reconciliation collector', () => {
  it('uses bill balance authority plus verified payment and deposit facts for legacy paid totals', () => {
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain('legacy_bill_authority AS');
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain('MAX(header_paid_minor, verified_paid_minor)');
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain('residual_receipt_count');
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain('deposit_receipt_count');
  });

  it('treats other-tenant canonical rows as violations only without an exact active shadow flag', () => {
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain("FROM canonical_feature_flags f");
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain("f.tenant_id = scoped.tenant_id");
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain("f.mode = 'shadow'");
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain("f.is_enabled = 1");
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).toContain('"writePolicy":"shadow"');
    expect(TENANT_FINANCIAL_RECONCILIATION_SQL).not.toContain("SELECT COUNT(*) FROM canonical_invoices WHERE tenant_id <> '100'");
  });

  it('builds an aggregate-only snapshot for an exact tenant', () => {
    const snapshot = buildTenantFinancialSnapshotFromAggregateRow(
      aggregateRow(),
      '2026-07-18T08:00:00.000Z',
      0,
      '101',
    );
    expect(snapshot).toMatchObject({
      tenantId: '101',
      legacy: { invoiceCount: 2, invoiceNetMinor: 11000 },
      canonical: { invoiceCount: 2, invoiceNetMinor: 11000 },
      controls: { secondPassNewRows: 0, sourceMappingDuplicates: 0 },
    });
  });

  it('generates tenant-scoped SQL without retaining tenant-100 authority', () => {
    const sql = buildTenantFinancialReconciliationSql('101');
    expect(sql).toContain("CAST(tenant_id AS TEXT)='101'");
    expect(sql).toContain("tenant_id='101'");
    expect(sql).toContain("tenant_id <> '101'");
    expect(sql).not.toContain("CAST(tenant_id AS TEXT)='100'");
    expect(sql).not.toContain("tenant_id='100'");
  });

  it('keeps tenant 100 as the backwards-compatible default SQL', () => {
    expect(buildTenantFinancialReconciliationSql('100')).toBe(TENANT_FINANCIAL_RECONCILIATION_SQL);
  });

  it('rejects unsafe tenant identifiers', () => {
    for (const value of ['', ' 100', '0', '-1', '1.5', '1 OR 1=1', 'tenant-a']) {
      expect(() => normalizeTenantFinancialReconciliationTenantId(value)).toThrow(/tenant/i);
    }
    expect(normalizeTenantFinancialReconciliationTenantId('101')).toBe('101');
  });

  it('rejects negative or fractional aggregate values', () => {
    const row = aggregateRow();
    row.canonical_invoice_net_minor = -1;
    expect(() => buildTenantFinancialSnapshotFromAggregateRow(
      row,
      '2026-07-18T08:00:00.000Z',
      0,
    )).toThrow(/canonical_invoice_net_minor/);
  });

  it('rejects non-zero read-only metadata before producing evidence', () => {
    const row = aggregateRow();
    expect(() => buildTenantFinancialSnapshotFromAggregateRow(
      row,
      '2026-07-18T08:00:00.000Z',
      1,
    )).toThrow(/second-pass/);
  });
});
