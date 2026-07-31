import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cancellation = readFileSync('src/routes/tenant/billingCancellation.ts', 'utf8');
const approvals = readFileSync('src/routes/tenant/approvals.ts', 'utf8');
const creditNotes = readFileSync('src/routes/tenant/creditNotes.ts', 'utf8');
const payouts = readFileSync('src/routes/tenant/receptionDoctorPayouts.ts', 'utf8');

describe('performer reserve lifecycle route guards', () => {
  it('guards direct full/item/batch cancellation before side effects', () => {
    expect(cancellation).toContain('assertNoPaidPerformerReserves');
    expect(cancellation).toContain('cancelUnpaidPerformerReserves');
    expect(cancellation).toContain("SET status = 'cancelled'");
    expect(cancellation).toContain('cancelled_by');
  });

  it('guards approval-driven bill cancellation and credit-note conversion', () => {
    expect(approvals).toContain('assertNoPaidPerformerReserves');
    expect(approvals).toContain('diagnostic_performer_reserves');
    expect(approvals).toContain("status = 'reserved'");
  });

  it('guards credit-note creation and cancels exact returned reserve quantities on approval', () => {
    expect(creditNotes).toContain('assertNoPaidPerformerReserves');
    expect(creditNotes).toContain('diagnostic_performer_reserves');
    expect(creditNotes).toContain('ORDER BY unit_sequence ASC, id ASC');
    expect(creditNotes).toContain('return_quantity');
  });

  it('provides an authorized immutable performer payout reversal', () => {
    expect(payouts).toContain("post('/settlements/:id/reverse'");
    expect(payouts).toContain('PERFORMER_RESERVE_REVERSAL_MUTATION_TYPE');
    expect(payouts).toContain("status = 'reversed'");
    expect(payouts).toContain('reversed_by');
    expect(payouts).toContain("movement_type, amount");
    expect(payouts).toContain("'cash_in'");
    expect(payouts).toContain('executeLiveCancelledCompensationSettlementReversal');
    expect(payouts).toContain('legacyStatements');
    expect(payouts).toContain('settlementSourceId');
    expect(payouts).toContain('grossReserveAmount');
    expect(payouts).toContain('reversalCashAmount');
    expect(payouts).toContain('settlement.net_paid_amount');
  });
});
