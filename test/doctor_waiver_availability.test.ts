import { describe, expect, it } from 'vitest';
import { calculateAccrualAvailableWaiverAmount } from '../src/lib/doctor-waiver-availability';

describe('doctor waiver availability utility', () => {
  it('uses explicit positive balance as the source of truth', () => {
    expect(calculateAccrualAvailableWaiverAmount({ balanceAmount: 450, payableCommissionAmount: 900 })).toBe(450);
  });

  it('uses payable minus paid when balance is not populated', () => {
    expect(calculateAccrualAvailableWaiverAmount({ payableCommissionAmount: 900, paidAmount: 250 })).toBe(650);
  });

  it('falls back to earned minus waived and paid commission', () => {
    expect(calculateAccrualAvailableWaiverAmount({ earnedCommissionAmount: 1000, doctorWaiverAmount: 200, paidAmount: 300 })).toBe(500);
  });

  it('never returns a negative available waiver amount', () => {
    expect(calculateAccrualAvailableWaiverAmount({ commissionAmount: 100, doctorWaiverAmount: 200, paidAmount: 10 })).toBe(0);
  });
});
