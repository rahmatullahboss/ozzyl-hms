import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('tenant-100 strict financial route integration', () => {
  it('keeps bill creation on atomic legacy plus canonical execution', () => {
    const billing = source('src/routes/tenant/billing.ts');

    expect(billing).toContain("boundary: 'billing.create'");
    expect(billing).toContain('legacyStatements: creationBatch');
    expect(billing).toMatch(/executeStrictFinancialMutation[\s\S]*issueInvoice/);
    expect(billing).not.toContain("execution.mode === 'canonical-only'");
  });

  it('projects gross invoice lines and shared source identities for canonical compensation', () => {
    const billing = source('src/routes/tenant/billing.ts');
    const finalization = source('src/lib/billing-finalization.ts');

    expect(billing).toContain('buildLegacyLiveInvoiceSourceLineId');
    expect(billing).toContain('unitAmount: item.gross');
    expect(billing).toContain('discount,');
    expect(billing).toContain('taxTotal,');
    expect(billing).toContain('canonicalSourceLineId:');
    expect(finalization).toContain('canonicalSourceLineId');
    expect(finalization).toContain('taxAmount');
  });

  it('keeps payment collection on atomic legacy plus canonical execution', () => {
    const billing = source('src/routes/tenant/billing.ts');

    expect(billing).toContain("boundary: 'billing.payment.collect'");
    expect(billing).toContain('legacyStatements: paymentBatch');
    expect(billing).toMatch(/executeStrictFinancialMutation[\s\S]*collectPayment/);
    expect(billing).toContain('projectLegacyBillPaymentHistory');
    expect(billing).toContain('if (!options.authoritativeStatements)');
    expect(billing).not.toContain("paymentExecution.mode === 'canonical-only'");
    expect(billing).not.toContain('CANONICAL_ONLY_PREREQUISITE_MISSING');
  });

  it('projects paid and deposit-settled billing-counter invoices into canonical shadow state', () => {
    const billingCounter = source('src/routes/tenant/billingCounter.legacy.ts');

    expect(billingCounter).toContain(
      "strictPolicy.enabled && strictPolicy.writePolicy === 'strict'",
    );
    expect(billingCounter).not.toContain(
      'strictPolicy.enabled && (payment.paid > 0 || payment.depositDeducted > 0)',
    );
    expect(billingCounter).toContain('projectBillingCounterSettlement');
    expect(billingCounter).toContain('receiptNo: paymentReceiptNo');
    expect(billingCounter).toContain('applicationNo: depositAdjustmentReceiptNo');
    expect(billingCounter).not.toMatch(/canonical:\s*async \(options\) => issueInvoice/);
  });

  it('does not mount the retired canonical-only request guard', () => {
    const index = source('src/index.ts');

    expect(index).not.toContain('canonicalOnlyFinancialGuard');
    expect(index).not.toContain('CANONICAL_ONLY_');
  });

  it('keeps deposit collect, refund, and apply on atomic legacy plus canonical execution', () => {
    const deposits = source('src/routes/tenant/deposits.ts');

    expect(deposits).toContain("boundary: 'deposit.collect'");
    expect(deposits).toContain("boundary: 'deposit.refund'");
    expect(deposits).toContain("boundary: 'deposit.apply'");
    expect(deposits).toMatch(/executeStrictFinancialMutation[\s\S]*recordDeposit/);
    expect(deposits).toMatch(/executeStrictFinancialMutation[\s\S]*refundAvailableDeposits/);
    expect(deposits).toMatch(/executeStrictFinancialMutation[\s\S]*applyAvailableDeposits/);
    expect(deposits).not.toContain("execution.mode === 'canonical-only'");
  });

  it('commits reception admission deposits through one guarded legacy plus canonical batch', () => {
    const reception = source('src/routes/tenant/reception.ts');
    const coverage = source('src/lib/canonical/financial-route-coverage.ts');

    expect(reception).toContain("assertStrictFinancialBoundaryDisabledOrSupported");
    expect(reception).toContain("'reception.admission.deposit.collect'");
    expect(reception).toContain('prepareFinancialBatchAssertion');
    expect(reception).toContain('prepareClearFinancialBatchAssertions');
    expect(reception).toContain('legacyStatements: statements');
    expect(reception).not.toContain('legacyStatements: []');
    expect(reception).toMatch(/executeStrictFinancialMutation[\s\S]*buildLiveDepositProjection/);
    expect(reception).toMatch(/executeStrictFinancialMutation[\s\S]*recordDeposit/);
    expect(coverage).toMatch(/'reception\.admission\.deposit\.collect':[\s\S]*status: 'integrated'/);
  });
});
