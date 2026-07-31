import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINANCIAL_ROUTE_COVERAGE } from '../../../src/lib/canonical/financial-route-coverage';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function unpaidCancellationFunction(): string {
  const approvals = source('src/routes/tenant/approvals.ts');
  const start = approvals.indexOf('async function executeBillCancellationApproval');
  const end = approvals.indexOf('async function executePaymentVoidApproval', start);
  if (start < 0 || end < 0) throw new Error('Unpaid bill cancellation function could not be located');
  return approvals.slice(start, end);
}

describe('approved unpaid bill canonical cancellation integration', () => {
  it('marks the strict boundary integrated with the dedicated canonical command', () => {
    expect(FINANCIAL_ROUTE_COVERAGE['bill.cancel.unpaid']).toMatchObject({
      status: 'integrated',
      routeFile: 'src/routes/tenant/approvals.ts',
      canonicalCommand: 'cancelUnpaidInvoice',
    });
  });

  it('commits legacy and canonical financial facts through one strict mutation boundary', () => {
    const cancellation = unpaidCancellationFunction();

    expect(cancellation).toContain("boundary: 'bill.cancel.unpaid'");
    expect(cancellation).toContain('executeStrictFinancialMutation');
    expect(cancellation).toContain('resolveLiveUnpaidInvoiceCancellationProjection');
    expect(cancellation).toContain('cancelUnpaidInvoice');
    expect(cancellation).toContain('legacyStatements');
    expect(cancellation).toContain('commissionAssertionKey');
    expect(cancellation).toContain('CASE WHEN changes() = ? THEN ? ELSE NULL END');
    expect(cancellation).not.toContain('await cancelBillCommissions(');
  });

  it('runs clinical cancellation only after the financial mutation returns', () => {
    const cancellation = unpaidCancellationFunction();
    const financialMutation = cancellation.indexOf('executeStrictFinancialMutation');
    const clinicalCancellation = cancellation.indexOf('cancelLabOrderItemsForBill');

    expect(financialMutation).toBeGreaterThan(-1);
    expect(clinicalCancellation).toBeGreaterThan(financialMutation);
  });

  it('keeps paid bill cancellation on the credit-note workflow', () => {
    const cancellation = unpaidCancellationFunction();
    const paidBranch = cancellation.slice(
      cancellation.indexOf('if (hasPayments)'),
      cancellation.indexOf("return { kind: 'converted_to_credit_note'", cancellation.indexOf('if (hasPayments)')) + 80,
    );

    expect(paidBranch).toContain('createCreditNoteFromBillCancel');
    expect(paidBranch).not.toContain('cancelUnpaidInvoice');
  });
});
