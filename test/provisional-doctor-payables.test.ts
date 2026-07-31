import { describe, expect, it, vi } from 'vitest';
import {
  createDoctorPayableAccrualsForProvisionalItems,
  doctorPayableAmountForItem,
  normalizeDoctorPayableSourceType,
  shouldCreateDoctorPayableForItem,
} from '../src/lib/provisional-doctor-payables';

describe('provisional doctor payables', () => {
  it('detects operation/consultation_fee categories and uses explicit payable amount', () => {
    expect(shouldCreateDoctorPayableForItem({
      id: 10,
      patient_id: 20,
      item_category: 'operation',
      total_amount: 15000,
      doctor_id: 7,
      doctor_payable_amount: 10000,
    })).toBe(true);
    expect(doctorPayableAmountForItem({
      id: 10,
      patient_id: 20,
      item_category: 'operation',
      total_amount: 15000,
      doctor_id: 7,
      doctor_payable_amount: 10000,
    })).toBe(10000);
    expect(normalizeDoctorPayableSourceType('operation')).toBe('consultation_fee');
  });

  it('creates consultation_fee accrual insert statements for payable provisional items', async () => {
    const prepared: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...params: unknown[]) => {
          prepared.push({ sql, params });
          return { sql, params };
        },
      })),
      batch: vi.fn(async () => []),
    } as any;

    const count = await createDoctorPayableAccrualsForProvisionalItems({
      db,
      tenantId: 'tenant-1',
      userId: 99,
      billId: 555,
      items: [{
        id: 10,
        patient_id: 20,
        visit_id: null,
        item_category: 'operation',
        item_name: 'Appendectomy operation fee',
        total_amount: 15000,
        doctor_id: 7,
        doctor_payable_amount: 10000,
      }],
    });

    expect(count).toBe(1);
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(prepared[0].sql).toContain('INSERT INTO doctor_commission_accruals');
    expect(prepared[0].params).toContain('consultation_fee');
    expect(prepared[0].params).toContain(555);
    expect(prepared[0].params).toContain(10000);
  });
});
