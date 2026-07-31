import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dailyCollection = readFileSync('src/routes/tenant/dailyCollection.ts', 'utf8');
const payouts = readFileSync('src/routes/tenant/receptionDoctorPayouts.ts', 'utf8');
const cashLedger = readFileSync('src/lib/cash-ledger-service.ts', 'utf8');

describe('performer reserve reconciliation contracts', () => {
  it('nets payout reversals from cash-basis doctor payout expense', () => {
    expect(dailyCollection).toContain("reference_type = 'doctor_commission_settlement_reversal'");
    expect(dailyCollection).toContain("WHEN movement_type = 'cash_in'");
    expect(dailyCollection).toContain('THEN -amount');
  });

  it('provides status-wise performer reserve reconciliation totals', () => {
    expect(payouts).toContain("get('/performer-reserve-reconciliation'");
    expect(payouts).toContain("status IN ('reserved', 'paid', 'cancelled', 'reversed')");
    expect(payouts).toContain('reservedAmount');
    expect(payouts).toContain('paidAmount');
    expect(payouts).toContain('cancelledAmount');
    expect(payouts).toContain('reversedAmount');
  });

  it('excludes explicitly reversed settlements from shadow-source payout totals', () => {
    expect(cashLedger).toContain('doctor_commission_settlements s');
    expect(cashLedger).toContain('s.reversed_at IS NULL');
  });
});
