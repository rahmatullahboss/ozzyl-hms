import { describe, expect, it, vi } from 'vitest';
import {
  FINANCIAL_READ_CONSUMER_IDS,
  FinancialReadShadowBatchError,
  readDepositForConsumer,
  readInvoiceForConsumer,
  readPaymentForConsumer,
  runFinancialReadShadowBatch,
  type FinancialReadConsumerDependencies,
} from '../../src/lib/canonical/financial-read-consumer-adapters';
import type { FinancialReadDatabase, FinancialReadShadowEvidence } from '../../src/lib/canonical/financial-read-provider';

const db = {} as FinancialReadDatabase;

function evidence(overrides: Partial<FinancialReadShadowEvidence> = {}): FinancialReadShadowEvidence {
  return {
    version: 1,
    checkpoint: 'CDB-V1-040',
    runPublicId: 'recon-1',
    providerKey: 'canonical_invoice_provider_v1',
    consumerId: FINANCIAL_READ_CONSUMER_IDS.billing_detail,
    sourceRowKey: 'bill:10',
    canonicalRowKey: 'inv-public-10',
    parity: true,
    varianceClasses: [],
    varianceIds: [],
    elapsedMs: 12,
    latencyBudgetMs: 100,
    observedAtUtc: '2026-07-30T00:00:00.000Z',
    rollbackMode: 'legacy',
    criticalUnexplainedVarianceCount: 0,
    ...overrides,
  };
}

function dependencies(): FinancialReadConsumerDependencies {
  return {
    invoice: vi.fn(async (_db, input) => ({
      mode: 'shadow' as const,
      selectedProvider: 'legacy' as const,
      projection: {
        rowKey: 'bill:10', invoiceNumber: input.invoiceNumber,
        documentStatus: 'posted' as const, settlementStatus: 'partial' as const,
        currencyCode: 'BDT', totalMinor: 120000, paidMinor: 70000, dueMinor: 50000, lineCount: 2,
      },
      legacy: {
        rowKey: 'bill:10', invoiceNumber: input.invoiceNumber,
        documentStatus: 'posted' as const, settlementStatus: 'partial' as const,
        currencyCode: 'BDT', totalMinor: 120000, paidMinor: 70000, dueMinor: 50000, lineCount: 2,
      },
      canonical: {
        rowKey: 'inv-public-10', invoiceNumber: input.invoiceNumber,
        documentStatus: 'posted' as const, settlementStatus: 'partial' as const,
        currencyCode: 'BDT', totalMinor: 120000, paidMinor: 70000, dueMinor: 50000, lineCount: 2,
      },
      shadowEvidence: evidence({
        providerKey: 'canonical_invoice_provider_v1',
        consumerId: input.consumerId,
      }),
    })),
    payment: vi.fn(async (_db, input) => ({
      mode: 'shadow' as const,
      selectedProvider: 'legacy' as const,
      projection: {
        rowKey: 'payment:20', receiptNumber: input.receiptNumber, status: 'posted' as const,
        currencyCode: 'BDT', totalMinor: 70000, allocatedMinor: 70000, unallocatedMinor: 0,
        tenderCount: 1, allocationCount: 1,
      },
      legacy: {
        rowKey: 'payment:20', receiptNumber: input.receiptNumber, status: 'posted' as const,
        currencyCode: 'BDT', totalMinor: 70000, allocatedMinor: 70000, unallocatedMinor: 0,
        tenderCount: 1, allocationCount: 1,
      },
      canonical: {
        rowKey: 'receipt-public-20', receiptNumber: input.receiptNumber, status: 'posted' as const,
        currencyCode: 'BDT', totalMinor: 70000, allocatedMinor: 70000, unallocatedMinor: 0,
        tenderCount: 1, allocationCount: 1,
      },
      shadowEvidence: evidence({
        providerKey: 'canonical_payment_provider_v1',
        consumerId: input.consumerId,
        sourceRowKey: 'payment:20',
        canonicalRowKey: 'receipt-public-20',
      }),
    })),
    deposit: vi.fn(async (_db, input) => ({
      mode: 'shadow' as const,
      selectedProvider: 'legacy' as const,
      projection: {
        rowKey: 'deposit:30', depositNumber: input.depositNumber, status: 'posted' as const,
        currencyCode: 'BDT', amountMinor: 100000, appliedMinor: 20000, refundedMinor: 10000,
        availableMinor: 70000, applicationCount: 1,
      },
      legacy: {
        rowKey: 'deposit:30', depositNumber: input.depositNumber, status: 'posted' as const,
        currencyCode: 'BDT', amountMinor: 100000, appliedMinor: 20000, refundedMinor: 10000,
        availableMinor: 70000, applicationCount: 1,
      },
      canonical: {
        rowKey: 'deposit-public-30', depositNumber: input.depositNumber, status: 'posted' as const,
        currencyCode: 'BDT', amountMinor: 100000, appliedMinor: 20000, refundedMinor: 10000,
        availableMinor: 70000, applicationCount: 1,
      },
      shadowEvidence: evidence({
        providerKey: 'canonical_deposit_provider_v1',
        consumerId: input.consumerId,
        sourceRowKey: 'deposit:30',
        canonicalRowKey: 'deposit-public-30',
      }),
    })),
  };
}

const context = {
  tenantId: 'tenant-a',
  observedAtUtc: '2026-07-30T00:00:00.000Z',
  elapsedMs: 12,
  latencyBudgetMs: 100,
  buildSha: 'cc5b5f41d',
} as const;

describe('financial read consumer adapters', () => {
  it('assigns stable bounded consumer IDs and preserves provider-selected projections', async () => {
    const deps = dependencies();

    const invoice = await readInvoiceForConsumer(db, {
      ...context, consumerKind: 'billing_detail', invoiceNumber: 'INV-10',
    }, deps);
    const payment = await readPaymentForConsumer(db, {
      ...context, consumerKind: 'dashboard', receiptNumber: 'RCPT-20',
    }, deps);
    const deposit = await readDepositForConsumer(db, {
      ...context, consumerKind: 'admin', depositNumber: 'DEP-30',
    }, deps);

    expect(FINANCIAL_READ_CONSUMER_IDS).toEqual({
      billing_detail: 'cdb040b.billing-detail',
      report: 'cdb040b.report',
      dashboard: 'cdb040b.dashboard',
      export: 'cdb040b.export',
      scheduled_job: 'cdb040b.scheduled-job',
      admin: 'cdb040b.admin',
    });
    expect(deps.invoice).toHaveBeenCalledWith(db, expect.objectContaining({ consumerId: 'cdb040b.billing-detail' }));
    expect(deps.payment).toHaveBeenCalledWith(db, expect.objectContaining({ consumerId: 'cdb040b.dashboard' }));
    expect(deps.deposit).toHaveBeenCalledWith(db, expect.objectContaining({ consumerId: 'cdb040b.admin' }));
    expect(invoice).toMatchObject({ provider: 'invoice', rollbackMode: 'legacy', selectedProvider: 'legacy' });
    expect(payment).toMatchObject({ provider: 'payment', rollbackMode: 'legacy', projection: { totalMinor: 70000 } });
    expect(deposit).toMatchObject({ provider: 'deposit', rollbackMode: 'legacy', projection: { availableMinor: 70000 } });
  });

  it('runs a bounded shadow batch and returns exact non-PHI evidence with immediate legacy rollback', async () => {
    const result = await runFinancialReadShadowBatch(db, {
      tenantId: 'tenant-a',
      observedAtUtc: context.observedAtUtc,
      latencyBudgetMs: 100,
      buildSha: context.buildSha,
      records: [
        { provider: 'invoice', consumerKind: 'report', sourcePublicId: 'INV-10', elapsedMs: 10 },
        { provider: 'payment', consumerKind: 'export', sourcePublicId: 'RCPT-20', elapsedMs: 11 },
        { provider: 'deposit', consumerKind: 'scheduled_job', sourcePublicId: 'DEP-30', elapsedMs: 12 },
      ],
    }, dependencies());

    expect(result).toMatchObject({
      checkpoint: 'CDB-V1-040B',
      tenantId: 'tenant-a',
      buildSha: 'cc5b5f41d',
      recordCount: 3,
      parity: true,
      varianceIds: [],
      rollbackMode: 'legacy',
    });
    expect(result.rows).toEqual([
      expect.objectContaining({ provider: 'invoice', consumerId: 'cdb040b.report', sourceRowKey: 'bill:10', canonicalRowKey: 'inv-public-10' }),
      expect.objectContaining({ provider: 'payment', consumerId: 'cdb040b.export', sourceRowKey: 'payment:20', canonicalRowKey: 'receipt-public-20' }),
      expect.objectContaining({ provider: 'deposit', consumerId: 'cdb040b.scheduled-job', sourceRowKey: 'deposit:30', canonicalRowKey: 'deposit-public-30' }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/patient|mobile|address|diagnosis/i);
  });

  it('fails closed on unexplained variance, non-shadow selection, missing evidence, or duplicate scope', async () => {
    const varianceDeps = dependencies();
    vi.mocked(varianceDeps.invoice).mockImplementationOnce(async (_db, input) => {
      const base = await dependencies().invoice(_db, input);
      return {
        ...base,
        shadowEvidence: evidence({
          providerKey: 'canonical_invoice_provider_v1', consumerId: input.consumerId,
          parity: false, varianceClasses: ['DUE_MINOR_MISMATCH'], varianceIds: ['variance-1'],
          criticalUnexplainedVarianceCount: 1,
        }),
      };
    });

    await expect(runFinancialReadShadowBatch(db, {
      tenantId: 'tenant-a', observedAtUtc: context.observedAtUtc,
      latencyBudgetMs: 100, buildSha: context.buildSha,
      records: [{ provider: 'invoice', consumerKind: 'report', sourcePublicId: 'INV-10', elapsedMs: 10 }],
    }, varianceDeps)).rejects.toMatchObject({
      name: 'FinancialReadShadowBatchError',
      code: 'UNEXPLAINED_VARIANCE',
      rollbackMode: 'legacy',
      varianceIds: ['variance-1'],
    });

    const legacyDeps = dependencies();
    vi.mocked(legacyDeps.payment).mockImplementationOnce(async (_db, input) => ({
      ...(await dependencies().payment(_db, input)), mode: 'legacy', shadowEvidence: undefined,
    }));
    await expect(runFinancialReadShadowBatch(db, {
      tenantId: 'tenant-a', observedAtUtc: context.observedAtUtc,
      latencyBudgetMs: 100, buildSha: context.buildSha,
      records: [{ provider: 'payment', consumerKind: 'dashboard', sourcePublicId: 'RCPT-20', elapsedMs: 10 }],
    }, legacyDeps)).rejects.toBeInstanceOf(FinancialReadShadowBatchError);

    await expect(runFinancialReadShadowBatch(db, {
      tenantId: 'tenant-a', observedAtUtc: context.observedAtUtc,
      latencyBudgetMs: 100, buildSha: context.buildSha,
      records: [
        { provider: 'deposit', consumerKind: 'admin', sourcePublicId: 'DEP-30', elapsedMs: 10 },
        { provider: 'deposit', consumerKind: 'admin', sourcePublicId: 'DEP-30', elapsedMs: 10 },
      ],
    }, dependencies())).rejects.toMatchObject({ code: 'DUPLICATE_SCOPE', rollbackMode: 'legacy' });
  });
});
