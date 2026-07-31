import { describe, expect, it } from 'vitest';
import {
  evaluateTenantFinancialReconciliation,
  type TenantFinancialReconciliationSnapshot,
} from '../../scripts/canonical/tenant-financial-reconciliation';

function cleanSnapshot(): TenantFinancialReconciliationSnapshot {
  return {
    tenantId: '100',
    cutoffUtc: '2026-07-18T08:00:00.000Z',
    legacy: {
      invoiceCount: 10,
      invoiceGrossMinor: 100_000,
      invoiceDiscountMinor: 5_000,
      invoiceNetMinor: 95_000,
      invoicePaidMinor: 70_000,
      invoiceDueMinor: 25_000,
      receiptCount: 7,
      receiptTotalMinor: 70_000,
      allocationTotalMinor: 70_000,
      depositReceivedMinor: 20_000,
      depositAppliedMinor: 5_000,
      depositRefundedMinor: 1_000,
      creditNoteMinor: 0,
      refundMinor: 1_000,
      reversalMinor: 0,
    },
    canonical: {
      invoiceCount: 10,
      invoiceGrossMinor: 100_000,
      invoiceDiscountMinor: 5_000,
      invoiceNetMinor: 95_000,
      invoicePaidMinor: 70_000,
      invoiceDueMinor: 25_000,
      receiptCount: 7,
      receiptTotalMinor: 70_000,
      allocationTotalMinor: 70_000,
      depositReceivedMinor: 20_000,
      depositAppliedMinor: 5_000,
      depositRefundedMinor: 1_000,
      creditNoteMinor: 0,
      refundMinor: 1_000,
      reversalMinor: 0,
    },
    controls: {
      secondPassNewRows: 0,
      sourceMappingDuplicates: 0,
      crossTenantRows: 0,
      unresolvedCriticalIssues: 0,
      blockedOutbox: 0,
      blockedAccounting: 0,
    },
  };
}

describe('tenant financial reconciliation', () => {
  it('requires exact aggregate parity and clean control counts', () => {
    const receipt = evaluateTenantFinancialReconciliation(cleanSnapshot());
    expect(receipt).toMatchObject({
      evidenceReady: true,
      activationReady: true,
      tenantId: '100',
      variance: {
        invoiceCount: 0,
        invoiceNetMinor: 0,
        receiptTotalMinor: 0,
        allocationTotalMinor: 0,
      },
    });
  });

  it('preserves any exact positive tenant identity in the receipt', () => {
    const snapshot = cleanSnapshot();
    snapshot.tenantId = '101';
    const receipt = evaluateTenantFinancialReconciliation(snapshot);
    expect(receipt).toMatchObject({
      evidenceReady: true,
      activationReady: true,
      tenantId: '101',
      issues: [],
    });
  });

  it('rejects unsafe tenant identities', () => {
    const snapshot = cleanSnapshot();
    snapshot.tenantId = ' 100';
    const receipt = evaluateTenantFinancialReconciliation(snapshot);
    expect(receipt.evidenceReady).toBe(false);
    expect(receipt.issues).toContain('CDB101_FINANCIAL_RECONCILIATION_TENANT_INVALID');
  });

  it('blocks a one-minor-unit variance without exposing row data', () => {
    const snapshot = cleanSnapshot();
    snapshot.canonical.invoiceNetMinor += 1;
    const receipt = evaluateTenantFinancialReconciliation(snapshot);
    expect(receipt.activationReady).toBe(false);
    expect(receipt.variance.invoiceNetMinor).toBe(1);
    expect(JSON.stringify(receipt)).not.toMatch(/patient_name|mobile|address|diagnosis/i);
  });

  it('blocks second-pass writes and cross-tenant rows', () => {
    const snapshot = cleanSnapshot();
    snapshot.controls.secondPassNewRows = 1;
    snapshot.controls.crossTenantRows = 1;
    const receipt = evaluateTenantFinancialReconciliation(snapshot);
    expect(receipt.activationReady).toBe(false);
    expect(receipt.issues).toEqual(expect.arrayContaining([
      'CDB101_FINANCIAL_SECOND_PASS_NOT_ZERO',
      'CDB101_FINANCIAL_TENANT_ISOLATION_FAILED',
    ]));
  });
});
