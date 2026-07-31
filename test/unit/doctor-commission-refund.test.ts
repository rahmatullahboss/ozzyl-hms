import { describe, expect, it } from 'vitest';
import {
  calculateDoctorCommissionReturnAdjustment,
  prepareCreditNoteCommissionAdjustmentStatements,
} from '../../src/lib/billing-refund-commission';

describe('doctor commission refund adjustment', () => {
  it('reverses the unpaid commission for a fully refunded item', () => {
    expect(calculateDoctorCommissionReturnAdjustment({
      payableCommissionAmount: 40,
      balanceAmount: 40,
      paidAmount: 0,
      returnedQuantity: 1,
      originalQuantity: 1,
    })).toEqual({
      returnRatio: 1,
      targetAdjustmentAmount: 40,
      reversalAmount: 40,
      clawbackAmount: 0,
    });
  });

  it('matches a legacy accrual without bill_item_id and queues identity backfill', async () => {
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        let params: unknown[] = [];
        return {
          bind(...values: unknown[]) {
            params = values;
            prepared.push({ sql, params });
            return this;
          },
          async all<T>() {
            return {
              results: [{
                id: 2960,
                doctor_id: 143,
                bill_id: 7110,
                bill_item_id: 3446,
                persisted_bill_item_id: null,
                payable_commission_amount: 40,
                paid_amount: 0,
                balance_amount: 40,
                original_quantity: 1,
              }] as T[],
              success: true,
              meta: {},
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await prepareCreditNoteCommissionAdjustmentStatements(db, {
      tenantId: '102',
      creditNoteId: 2,
      billId: 7110,
      items: [{ id: 2, invoice_item_id: 3446, return_quantity: 1 }],
      reason: 'Refunded Urine RE/ME',
      createdBy: 117,
    });

    expect(prepared[0].sql).toContain('lab_test_catalog');
    expect(prepared.some((query) =>
      query.sql.includes('UPDATE doctor_commission_accruals')
      && query.sql.includes('bill_item_id = ?')
      && query.params.includes(3446))).toBe(true);
    expect(prepared.some((query) => query.sql.includes('doctor_commission_adjustments'))).toBe(true);
    expect(result.reversalAmount).toBe(40);
    expect(result.clawbackAmount).toBe(0);
  });
});
