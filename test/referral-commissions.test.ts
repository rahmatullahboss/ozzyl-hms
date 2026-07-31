import { describe, it, expect, beforeAll } from 'vitest';
import {
  accrueBillCommissions,
  accrueLabVerificationCommissions,
  cancelBillCommissions,
  AccrueBillCommissionsInput,
} from '../src/lib/lab-finance';

// Mock D1 Database for local testing
const mockDB = {
  prepare: (sql: string) => ({
    bind: (...args: any[]) => ({
      first: async <T>() => {
        // Mock specific queries
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.includes('FROM doctor_commission_rules')) {
          // Mock rule for Referring Doctor
          return {
            id: 101,
            service_type: 'referral',
            lab_test_id: null,
            category: null,
            rate_type: 'percent',
            rate_value: 1000,
            incentive_type: 'referrer',
            effective_from: '2026-01-01',
            effective_to: null,
            is_active: 1,
          } as any as T; // 10%
        }
        if (normalizedSql.includes('SELECT doctor_id FROM visits')) {
          return { doctor_id: 202 } as any as T;
        }
        return null as any as T;
      },
      run: async () => ({ success: true, meta: { changes: 1, last_row_id: 88 } }),
      all: async () => ({ results: [] }),
    }),
  }),
} as any;

describe('Referral Commission Accrual', () => {
  it('should accrue referral commissions for a bill', async () => {
    const input: AccrueBillCommissionsInput = {
      tenantId: 'tenant-1',
      userId: 1,
      patientId: 10,
      visitId: 20,
      billId: 30,
      referringDoctorId: 50,
      billDate: '2026-05-07',
      items: [
        {
          itemCategory: 'test',
          description: 'CBC Test',
          lineTotal: 100000, // 1000 BDT
          referenceId: 5,
        }
      ],
    };

    const inserted = await accrueBillCommissions(mockDB, input);
    expect(inserted).toBe(1);
  });

  it('should accrue flat rate commissions correctly', async () => {
    const flatRateDB = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async <T>() => {
            if (sql.includes('doctor_commission_rules')) {
              return {
                id: 102,
                service_type: 'referral',
                lab_test_id: null,
                category: null,
                rate_type: 'flat',
                rate_value: 50000,
                incentive_type: 'referrer',
                effective_from: '2026-01-01',
                effective_to: null,
                is_active: 1,
              } as any as T; // 500 BDT
            }
            return null as any as T;
          },
          run: async () => ({ success: true, meta: { changes: 1, last_row_id: 88 } }),
        }),
      }),
    } as any;

    const input: AccrueBillCommissionsInput = {
      tenantId: 'tenant-1',
      userId: 1,
      patientId: 10,
      visitId: 20,
      billId: 30,
      referringDoctorId: 50,
      billDate: '2026-05-07',
      items: [
        {
          itemCategory: 'test',
          description: 'CBC Test',
          lineTotal: 100000,
          referenceId: 5,
        }
      ],
    };

    // Note: The logic in accrueBillCommissions uses rate_value directly as amount if flat
    const inserted = await accrueBillCommissions(flatRateDB, input);
    expect(inserted).toBe(1);
  });

  it('should handle multiple items with different rules', async () => {
    const multiDB = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async <T>() => {
            if (sql.includes('doctor_commission_rules')) {
              const incentiveType = args[3];
              const category = args[5]; // 0:tenantId, 1:doctorId, 2:serviceType, 3:incentiveType, 4:labTestId, 5:category
              if (incentiveType === 'referrer' && category === 'lab') {
                return { id: 101, rate_type: 'percent', rate_value: 1000, incentive_type: 'referrer' } as any as T;
              }
              if (category === 'pharmacy') return null as any as T;
            }
            return null as any as T;
          },
          run: async () => ({ success: true, meta: { changes: 1, last_row_id: 88 } }),
        }),
      }),
    } as any;

    const input: AccrueBillCommissionsInput = {
      tenantId: 'tenant-1',
      userId: 1,
      patientId: 10,
      visitId: 20,
      billId: 30,
      referringDoctorId: 50,
      billDate: '2026-05-07',
      items: [
        { itemCategory: 'lab', description: 'Lab Test', lineTotal: 100000, referenceId: 1 },
        { itemCategory: 'pharmacy', description: 'Medicine', lineTotal: 50000, referenceId: 2 },
      ],
    };

    const inserted = await accrueBillCommissions(multiDB, input);
    expect(inserted).toBe(1); // Only lab should accrue
  });

  it('should ignore items with no commission rule', async () => {
    const dbWithNoRule = {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 1, last_row_id: 88 } }),
        }),
      }),
    } as any;

    const input: AccrueBillCommissionsInput = {
      tenantId: 'tenant-1',
      userId: 1,
      patientId: 10,
      visitId: 20,
      billId: 30,
      referringDoctorId: 50,
      billDate: '2026-05-07',
      items: [
        {
          itemCategory: 'test',
          description: 'CBC Test',
          lineTotal: 100000,
          referenceId: 5,
        }
      ],
    };

    const inserted = await accrueBillCommissions(dbWithNoRule, input);
    expect(inserted).toBe(0);
  });

  it('should accrue both referral and consultation commissions for the same bill', async () => {
    const coDB = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async <T>() => {
            if (sql.includes('SELECT doctor_id FROM visits')) {
              return { doctor_id: 202 } as any as T;
            }
            if (sql.includes('doctor_commission_rules')) {
              const serviceType = args[2];
              const incentiveType = args[3];
              if (serviceType === 'referral') {
                expect(incentiveType).toBe('referrer');
                return { id: 101, rate_type: 'percent', rate_value: 500, incentive_type: 'referrer' } as any as T; // 5% referral
              }
              if (serviceType === 'consultation_fee') {
                expect(incentiveType).toBe('performer');
                return { id: 102, rate_type: 'flat', rate_value: 30000, incentive_type: 'performer' } as any as T; // 300 BDT consultant fee
              }
            }
            return null as any as T;
          },
          run: async () => ({ success: true, meta: { changes: 1, last_row_id: 88 } }),
        }),
      }),
    } as any;

    const input: AccrueBillCommissionsInput = {
      tenantId: 'tenant-1',
      userId: 1,
      patientId: 10,
      visitId: 20,
      billId: 30,
      referringDoctorId: 50,
      billDate: '2026-05-07',
      items: [
        {
          itemCategory: 'doctor_visit',
          description: 'OPD Consultation',
          lineTotal: 50000, // 500 BDT
          referenceId: 1,
        }
      ],
    };

    const inserted = await accrueBillCommissions(coDB, input);
    // Should insert 2 records: one for referral, one for consultation fee
    expect(inserted).toBe(2);
  });

  it('should accrue appointment consultation commission from invoice doctor reference when no visit exists', async () => {
    const queries: Array<{ sql: string; args: unknown[] }> = [];
    const appointmentDB = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>() => {
            queries.push({ sql, args });
            if (sql.includes('SELECT doctor_id FROM visits')) {
              throw new Error('Appointment commission should not require a visit row');
            }
            if (sql.includes('doctor_commission_rules')) {
              expect(args[1]).toBe(202);
              expect(args[2]).toBe('consultation_fee');
              expect(args[3]).toBe('performer');
              return { id: 102, rate_type: 'percent', rate_value: 3000, incentive_type: 'performer' } as T;
            }
            return null as T;
          },
          run: async () => {
            queries.push({ sql, args });
            return { success: true, meta: { last_row_id: 88, changes: 1 } };
          },
        }),
      }),
    } as any;

    const inserted = await accrueBillCommissions(appointmentDB, {
      tenantId: 'tenant-1',
      userId: 1,
      patientId: 10,
      visitId: null,
      billId: 30,
      referringDoctorId: null,
      billDate: '2026-05-07',
      items: [
        {
          itemCategory: 'doctor_visit',
          description: 'Appointment consultation',
          lineTotal: 1000,
          referenceId: 202,
        },
      ],
    });

    expect(inserted).toBe(1);
    expect(queries.some((q) =>
      q.sql.includes('doctor_commission_accruals')
      && q.args.includes(300)
    )).toBe(true);
    expect(queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.args.includes('commission_accrued')
    )).toBe(true);
  });

  it('should accrue lab verification performer commission and record accounting event', async () => {
    const queries: Array<{ sql: string; args: unknown[] }> = [];
    const verificationDB = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async <T>() => {
            queries.push({ sql, args });
            if (sql.includes('SELECT id FROM doctors')) {
              return { id: 202 } as T;
            }
            if (sql.includes('doctor_commission_rules')) {
              expect(args[3]).toBe('performer');
              return { id: 102, rate_type: 'percent', rate_value: 1000, incentive_type: 'performer' } as T;
            }
            return null as T;
          },
          all: async <T>() => {
            queries.push({ sql, args });
            if (sql.includes('FROM lab_test_catalog')) {
              return { results: [{ id: 60, is_commissionable: 1 }] } as T;
            }
            return { results: [] } as T;
          },
          run: async () => {
            queries.push({ sql, args });
            return { success: true, meta: { last_row_id: 77, changes: 1 } };
          },
        }),
      }),
    } as any;

    const inserted = await accrueLabVerificationCommissions(verificationDB, {
      tenantId: 'tenant-1',
      userId: 7,
      patientId: 10,
      visitId: 20,
      billId: 30,
      labOrderId: 40,
      labOrderItemId: 50,
      labTestId: 60,
      category: 'hematology',
      lineTotal: 100000,
      verificationDate: '2026-05-07',
    });

    expect(inserted).toBe(1);
    expect(queries.some((q) => q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events'))).toBe(true);
  });

  it('should record reversal accounting events when accrued bill commissions are cancelled', async () => {
    const queries: Array<{ sql: string; args: unknown[] }> = [];
    const cancellationDB = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async <T>() => {
            queries.push({ sql, args });
            return {
              results: [
                {
                  id: 77,
                  doctor_id: 202,
                  patient_id: 10,
                  visit_id: 20,
                  bill_id: 30,
                  source_type: 'consultation_fee',
                  gross_amount: 100000,
                  commission_amount: 25000,
                  accrued_date: '2026-05-07',
                },
              ],
            } as T;
          },
          run: async () => {
            queries.push({ sql, args });
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as any;

    const cancelled = await cancelBillCommissions(cancellationDB, 'tenant-1', 30, 'Duplicate invoice', 7);

    expect(cancelled).toBe(1);
    expect(queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.args.includes('commission_cancelled')
    )).toBe(true);
  });
});

import { getBillCommissionSummary } from '../src/lib/lab-finance';

describe('Bill Commission Summary', () => {
  it('should summarize commissions correctly', async () => {
    const summaryDB = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              { source_type: 'referral', total: 5000 },
              { source_type: 'consultation_fee', total: 30000 },
            ]
          }),
        }),
      }),
    } as any;

    const summary = await getBillCommissionSummary(summaryDB, 'tenant-1', 30);
    expect(summary.totalCommissions).toBe(35000);
    expect(summary.byCategory['referral']).toBe(5000);
    expect(summary.byCategory['consultation_fee']).toBe(30000);
  });
});
