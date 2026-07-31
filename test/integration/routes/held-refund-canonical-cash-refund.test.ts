import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINANCIAL_ROUTE_COVERAGE } from '../../../src/lib/canonical/financial-route-coverage';

function heldRefundFlow(): string {
  const source = readFileSync('src/routes/tenant/approvals.ts', 'utf8');
  const start = source.indexOf('async function executeHeldRefundApproval');
  const end = source.indexOf('async function executeBillCancellationApproval', start);
  if (start < 0 || end < 0) throw new Error('Held refund approval flow could not be located');
  return source.slice(start, end);
}

describe('held refund canonical cash-refund integration', () => {
  it('executes guarded held-refund statements through the combined canonical command', () => {
    const flow = heldRefundFlow();

    expect(flow).toContain("boundary: 'credit-note.cash-refund'");
    expect(flow).toContain('legacyStatements: statements');
    expect(flow).toContain('resolveLiveCreditNoteProjection');
    expect(flow).toContain('resolveLiveCreditNoteCashRefundFunding');
    expect(flow).toContain('issueCreditNoteWithCashRefund');
    expect(flow).toContain('executeStrictFinancialMutation');
    expect(flow).not.toContain('env.DB.batch(statements)');
  });

  it('passes cash-hold custody authority and deterministic funding slices', () => {
    const flow = heldRefundFlow();

    expect(flow).toContain('legacyCounterId: Number(hold.counterId)');
    expect(flow).toContain('legacyCounterSessionId: Number(hold.counterSessionId)');
    expect(flow).toContain('refundSourceEvidenceSha256: funding.sourceEvidenceSha256');
    expect(flow).toContain('receiptSlices: funding.receiptSlices');
    expect(flow).toContain('allocationSlices: funding.allocationSlices');
    expect(flow).toContain('tenderAttributions: funding.tenderAttributions');
  });

  it('keeps clinical cancellation and reserve shadow work after the financial commit', () => {
    const flow = heldRefundFlow();
    const strictMutation = flow.indexOf('executeStrictFinancialMutation');
    const reserveShadow = flow.indexOf('shadowRefundReserveConsumed');
    const clinical = flow.lastIndexOf('completeHeldRefundClinicalSideEffects');

    expect(strictMutation).toBeGreaterThan(-1);
    expect(reserveShadow).toBeGreaterThan(strictMutation);
    expect(clinical).toBeGreaterThan(strictMutation);
    expect(flow).toContain("SELECT id FROM billing_credit_notes WHERE tenant_id = ? AND credit_note_no = ? LIMIT 1");
  });

  it('registers the cash-refund boundary as integrated only after both routes use the command', () => {
    expect(FINANCIAL_ROUTE_COVERAGE['credit-note.cash-refund']).toMatchObject({
      status: 'integrated',
      routeFile: 'src/routes/tenant/approvals.ts',
      canonicalCommand: 'issueCreditNoteWithCashRefund',
    });
    const direct = readFileSync('src/routes/tenant/creditNotes.ts', 'utf8');
    const held = heldRefundFlow();
    expect(direct).toContain('issueCreditNoteWithCashRefund');
    expect(held).toContain('issueCreditNoteWithCashRefund');
  });
});
