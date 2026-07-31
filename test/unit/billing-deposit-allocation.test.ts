import { describe, expect, it } from 'vitest';
import { allocateBillDepositSources } from '../../src/lib/billing-deposit-allocation';

describe('allocateBillDepositSources', () => {
  it('shows the original deposit receipt and deposit time instead of the discharge adjustment event', () => {
    const result = allocateBillDepositSources([
      {
        id: 83,
        amount: 300,
        transaction_type: 'deposit',
        deposit_receipt_no: 'DEP-000019',
        payment_method: 'cash',
        reference_bill_id: null,
        created_at: '2026-07-09 12:45:54',
      },
      {
        id: 98,
        amount: 300,
        transaction_type: 'adjustment',
        deposit_receipt_no: 'DAD-000020',
        payment_method: null,
        reference_bill_id: 6548,
        created_at: '2026-07-16 09:50:49',
      },
    ], 6548);

    expect(result).toEqual([
      {
        id: '98-83',
        amount: 300,
        deposit_receipt_no: 'DEP-000019',
        payment_method: 'cash',
        deposited_at: '2026-07-09 12:45:54',
        adjustment_receipt_no: 'DAD-000020',
        adjusted_at: '2026-07-16 09:50:49',
      },
    ]);
  });

  it('allocates partially consumed deposits FIFO across earlier and current bills', () => {
    const result = allocateBillDepositSources([
      {
        id: 1,
        amount: 200,
        transaction_type: 'deposit',
        deposit_receipt_no: 'DEP-1',
        payment_method: 'cash',
        reference_bill_id: null,
        created_at: '2026-07-01 08:00:00',
      },
      {
        id: 2,
        amount: 500,
        transaction_type: 'deposit',
        deposit_receipt_no: 'DEP-2',
        payment_method: 'bkash',
        reference_bill_id: null,
        created_at: '2026-07-02 08:00:00',
      },
      {
        id: 3,
        amount: 100,
        transaction_type: 'adjustment',
        deposit_receipt_no: 'DAD-1',
        payment_method: null,
        reference_bill_id: 100,
        created_at: '2026-07-03 08:00:00',
      },
      {
        id: 4,
        amount: 400,
        transaction_type: 'adjustment',
        deposit_receipt_no: 'DAD-2',
        payment_method: null,
        reference_bill_id: 200,
        created_at: '2026-07-04 08:00:00',
      },
    ], 200);

    expect(result.map((entry) => ({ receipt: entry.deposit_receipt_no, amount: entry.amount }))).toEqual([
      { receipt: 'DEP-1', amount: 100 },
      { receipt: 'DEP-2', amount: 300 },
    ]);
  });
});
