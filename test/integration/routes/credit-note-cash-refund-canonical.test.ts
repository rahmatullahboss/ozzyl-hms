import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function approvalFlow(): string {
  const source = readFileSync('src/routes/tenant/creditNotes.ts', 'utf8');
  const start = source.indexOf("creditNotes.post('/:id/approve'");
  const end = source.indexOf('// ─── POST /:id/reject', start);
  if (start < 0 || end < 0) throw new Error('Credit-note approval route could not be located');
  return source.slice(start, end);
}

describe('credit-note cash-refund canonical integration', () => {
  it('keeps receivable-only credits on issueCreditNote and routes cash payouts to the combined command', () => {
    const flow = approvalFlow();

    expect(flow).toContain("boundary: cashRefund > 0 ? 'credit-note.cash-refund' : 'credit-note.approve'");
    expect(flow).toContain('resolveLiveCreditNoteCashRefundFunding');
    expect(flow).toContain('issueCreditNoteWithCashRefund');
    expect(flow).toContain('resolveLiveCreditNoteProjection');
    expect(flow).toContain('issueCreditNote');
    expect(flow).toMatch(/cashRefund > 0[\s\S]*issueCreditNoteWithCashRefund/);
    expect(flow).toMatch(/cashRefund === 0[\s\S]*issueCreditNote/);
  });

  it('supplies guarded legacy statements to the selected canonical command', () => {
    const flow = approvalFlow();

    expect(flow).toContain('prepareFinancialBatchAssertion');
    expect(flow).toContain('prepareClearFinancialBatchAssertions');
    expect(flow).toContain('legacyStatements: stmts');
    expect(flow).not.toContain('legacyStatements: []');
    for (const stepKey of [
      'credit_note_status',
      'audit_log',
      'bill_update',
      'income_reversal',
      'cash_return',
      'accounting_event',
    ]) {
      expect(flow).toContain(`stepKey: '${stepKey}'`);
    }
    expect(flow.indexOf('prepareClearFinancialBatchAssertions')).toBeGreaterThan(
      flow.indexOf("stepKey: 'accounting_event'"),
    );
  });

  it('passes active counter authority and deterministic cash-refund evidence', () => {
    const flow = approvalFlow();

    expect(flow).toContain('legacyCounterId: Number(activeCounterSession.counter_id)');
    expect(flow).toContain('legacyCounterSessionId: Number(activeCounterSession.id)');
    expect(flow).toContain('refundSourceEvidenceSha256: funding.sourceEvidenceSha256');
    expect(flow).toContain('receiptSlices: funding.receiptSlices');
    expect(flow).toContain('allocationSlices: funding.allocationSlices');
    expect(flow).toContain('tenderAttributions: funding.tenderAttributions');
  });

  it('maps missing, insufficient, or stale canonical funding to a safe conflict', () => {
    const source = readFileSync('src/routes/tenant/creditNotes.ts', 'utf8');
    const flow = approvalFlow();

    expect(source).toContain('function isCreditNoteCashRefundConflict');
    expect(flow).toContain('cashRefund > 0 && isCreditNoteCashRefundConflict(error)');
    expect(flow).toContain('Cash refund payment authority is no longer available. Refresh and try again.');
    expect(flow).not.toContain('Canonical invoice mapping not found');
    expect(flow).not.toContain('Insufficient canonical payment funding');
  });
});
