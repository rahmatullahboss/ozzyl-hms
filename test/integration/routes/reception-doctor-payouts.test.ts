import { describe, expect, it } from 'vitest';
import receptionDoctorPayoutRoutes from '../../../src/routes/tenant/receptionDoctorPayouts';
import { createTestApp, jsonRequest } from '../helpers/test-app';

function createPayoutApp(options: {
  stale?: boolean;
  drawerCash?: number;
  secondPayableAmount?: number;
  recoveryAmount?: number;
} = {}) {
  const accruals = options.stale
    ? [
      {
        id: 101,
        tenant_id: 'tenant-1',
        doctor_id: 7,
        doctor_name: 'Dr. Aminul Islam',
        doctor_specialization: 'Medicine',
        patient_id: 11,
        patient_name: 'Karim Ali',
        patient_code: 'P-11',
        bill_id: 501,
        invoice_no: 'INV-501',
        source_type: 'consultation_fee',
        gross_amount: 1000,
        commission_amount: 150,
        payable_amount: 150,
        status: 'accrued',
        accrued_date: '2026-06-19',
        notes: null,
        bill_is_paid: 1,
      },
    ]
    : [
      {
        id: 101,
        tenant_id: 'tenant-1',
        doctor_id: 7,
        doctor_name: 'Dr. Aminul Islam',
        doctor_specialization: 'Medicine',
        patient_id: 11,
        patient_name: 'Karim Ali',
        patient_code: 'P-11',
        bill_id: 501,
        invoice_no: 'INV-501',
        source_type: 'consultation_fee',
        gross_amount: 1000,
        commission_amount: 150,
        payable_amount: 150,
        status: 'accrued',
        accrued_date: '2026-06-19',
        notes: null,
        bill_is_paid: 1,
      },
      {
        id: 102,
        tenant_id: 'tenant-1',
        doctor_id: 7,
        doctor_name: 'Dr. Aminul Islam',
        doctor_specialization: 'Medicine',
        patient_id: 12,
        patient_name: 'Rahima Begum',
        patient_code: 'P-12',
        bill_id: 502,
        invoice_no: 'INV-502',
        source_type: 'lab_test',
        gross_amount: 1500,
        commission_amount: 150,
        payable_amount: options.secondPayableAmount ?? 150,
        status: 'approved',
        accrued_date: '2026-06-19',
        notes: null,
        bill_is_paid: 1,
      },
    ];

  return createTestApp({
    route: receptionDoctorPayoutRoutes,
    routePath: '/doctor-payouts',
    role: 'receptionist',
    userId: 99,
    queryOverride: (sql) => {
      if (/INSERT INTO sequence_counters/i.test(sql)) {
        return { first: { current_value: 1 } };
      }
      if (/SELECT id\s+FROM doctor_commission_settlements\s+WHERE tenant_id = \? AND idempotency_key = \?/i.test(sql)) {
        return { first: { id: 1 } };
      }
      if (/FROM doctor_commission_adjustments adjustment/i.test(sql)) {
        return options.recoveryAmount
          ? { results: [{ adjustment_id: 901, outstanding_amount: options.recoveryAmount }] }
          : { results: [] };
      }
      if (/FROM billing_counter_sessions s/i.test(sql) && /appointment_cash/i.test(sql)) {
        return {
          first: {
            opening_cash: options.drawerCash ?? 1000,
            cash_in: 0,
            cash_out: 0,
            manual_cash_in: 0,
            manual_cash_out: 0,
            cash_drop_total: 0,
            appointment_cash: 0,
            test_cash: 0,
            total_discount: 0,
            free_appointment_count: 0,
            doctor_payable_total: 0,
            commission_payable_total: 0,
          },
        };
      }
      return null;
    },
    tables: {
      billing_counter_sessions: [{
        id: 1,
        tenant_id: 'tenant-1',
        employee_id: 99,
        counter_id: 3,
        counter_name: 'Main Cash Counter',
        counter_code: 'MAIN',
        counter_type: 'billing',
        opening_cash: options.drawerCash ?? 1000,
        opened_at: '2026-06-19 08:00:00',
        status: 'active',
        workstation_id: null,
        heartbeat_at: null,
        variance_approval_status: null,
      }],
      doctor_commission_accruals: accruals,
      accounting_fiscal_years: [],
      accounting_period_closes: [],
      doctor_commission_settlements: [],
      cash_drawer_movements: [],
      cash_ledger_entries: [],
      sequence_counters: [],
    },
  });
}

describe('reception doctor payouts', () => {
  it('filters payable accruals by an inclusive service date range', async () => {
    const { app, mockDB } = createPayoutApp();

    const response = await app.request('/doctor-payouts/payables?from=2026-06-18&to=2026-06-19');

    expect(response.status).toBe(200);
    const payablesQuery = mockDB.queries.find((query) => /FROM doctor_commission_accruals a/i.test(query.sql));
    expect(payablesQuery?.sql).toContain('date(a.accrued_date) >= date(?)');
    expect(payablesQuery?.sql).toContain('date(a.accrued_date) <= date(?)');
    expect(payablesQuery?.params).toEqual(expect.arrayContaining(['2026-06-18', '2026-06-19']));
  });

  it('excludes zero-balance accruals from the payable list', async () => {
    const { app, mockDB } = createPayoutApp({ secondPayableAmount: 0 });

    const response = await app.request('/doctor-payouts/payables?from=2026-06-18&to=2026-06-19');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      doctors: Array<{ eligibleItemCount: number; payableAmount: number; items: Array<{ accrualId: number }> }>;
      summary: { outstandingCount: number; payableAmount: number };
    };
    expect(body.doctors).toHaveLength(1);
    expect(body.doctors[0]).toMatchObject({ eligibleItemCount: 1, payableAmount: 150 });
    expect(body.doctors[0]?.items.map((item) => item.accrualId)).toEqual([101]);
    expect(body.summary).toMatchObject({ outstandingCount: 1, payableAmount: 150 });

    const payablesQuery = mockDB.queries.find((query) => /FROM doctor_commission_accruals a/i.test(query.sql));
    expect(payablesQuery?.sql).toContain('a.earned_commission_amount');
    expect(payablesQuery?.sql).toContain('a.doctor_waiver_amount');
    expect(payablesQuery?.sql).not.toContain('NULLIF(a.payable_commission_amount, 0)');
  });

  it('rejects a stale selected accrual whose payable balance is no longer positive', async () => {
    const { app } = createPayoutApp({ secondPayableAmount: 0 });

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay', {
      method: 'POST',
      body: {
        accrualIds: [101, 102],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: 'payout-zero-balance-101-102',
      },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/positive balance|refresh/i),
    });
  });

  it('rejects a reversed payable date range', async () => {
    const { app } = createPayoutApp();

    const response = await app.request('/doctor-payouts/payables?from=2026-06-20&to=2026-06-19');

    expect(response.status).toBe(400);
  });

  it('rejects a malformed payable date', async () => {
    const { app } = createPayoutApp();

    const response = await app.request('/doctor-payouts/payables?from=2026-02-30');

    expect(response.status).toBe(400);
  });

  it('pays selected unpaid accruals once and writes settlement items plus one cash movement', async () => {
    const { app, mockDB } = createPayoutApp();

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay', {
      method: 'POST',
      body: {
        accrualIds: [101, 102],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        note: 'Paid after morning OPD',
        idempotencyKey: 'payout-test-101-102',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as {
      settlement: { settlementNo: string; netPaidAmount: number };
    };
    expect(body.settlement.settlementNo).toMatch(/^DPS-\d{4}-\d{6}$/);
    expect(body.settlement.netPaidAmount).toBe(300);

    expect(mockDB.queries.filter((q) => /INSERT INTO doctor_commission_settlements/i.test(q.sql))).toHaveLength(1);
    const settlementItemWrites = mockDB.queries.filter((q) => /INSERT INTO doctor_commission_settlement_items/i.test(q.sql));
    expect(settlementItemWrites).toHaveLength(3);
    expect(settlementItemWrites[0]?.sql).toContain('calculated_commission_amount');
    expect(settlementItemWrites[0]?.params).toEqual(expect.arrayContaining([101, 150]));
    expect(settlementItemWrites[1]?.params).toEqual(expect.arrayContaining([102, 150]));
    expect(settlementItemWrites.at(-1)?.sql).toMatch(/transition_guard/);
    expect(mockDB.queries.filter((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql))).toHaveLength(1);
    const paidAccrualUpdates = mockDB.queries.filter((q) => /UPDATE doctor_commission_accruals/i.test(q.sql) && /status = 'paid'/i.test(q.sql));
    expect(paidAccrualUpdates).toHaveLength(2);
    expect(paidAccrualUpdates[0]?.sql).toMatch(/paid_amount\s*=\s*\?/i);
    expect(paidAccrualUpdates[0]?.sql).toMatch(/balance_amount\s*=\s*0/i);
    const ledgerAttempt = mockDB.queries.find((q) => /cash_ledger_entries/i.test(q.sql));
    expect(ledgerAttempt).toBeTruthy();
  });

  it('keeps earlier doctor recovery outstanding instead of deducting it from the daily reception payout', async () => {
    const { app, mockDB } = createPayoutApp({ recoveryAmount: 100 });

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay', {
      method: 'POST',
      body: {
        accrualIds: [101, 102],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: 'payout-recovery-101-102',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as {
      settlement: { grossCommissionAmount: number; clawbackDeduction: number; netPaidAmount: number };
      clawbackApplications: Array<{ adjustmentId: number; amount: number }>;
    };
    expect(body.settlement).toMatchObject({
      grossCommissionAmount: 300,
      clawbackDeduction: 0,
      netPaidAmount: 300,
    });
    expect(body.clawbackApplications).toEqual([]);

    expect(mockDB.queries.some((query) => /FROM doctor_commission_adjustments adjustment/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT OR IGNORE INTO doctor_commission_adjustment_applications/i.test(query.sql))).toBe(false);
    const cashMovement = mockDB.queries.find((query) => /INSERT INTO cash_drawer_movements/i.test(query.sql));
    expect(cashMovement?.params).toEqual(expect.arrayContaining([300]));
    const accountingEvent = mockDB.queries.find((query) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(query.sql));
    const accountingPayload = JSON.parse(String(accountingEvent?.params.find((value) => typeof value === 'string' && value.startsWith('{'))));
    expect(accountingPayload).toMatchObject({
      grossCommissionAmount: 300,
      clawbackDeduction: 0,
      netPaidAmount: 300,
    });
  });

  it('uses effective payable commission as the default after doctor waiver', async () => {
    const { app, mockDB } = createPayoutApp({ secondPayableAmount: 100 });

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay', {
      method: 'POST',
      body: {
        accrualIds: [101, 102],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: 'payout-waiver-effective-payable-101-102',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as { settlement: { grossCommissionAmount: number; netPaidAmount: number } };
    expect(body.settlement).toMatchObject({ grossCommissionAmount: 250, netPaidAmount: 250 });

    const selectedRowsQuery = mockDB.queries.find((query) => /a\.canonical_source_key/i.test(query.sql));
    expect(selectedRowsQuery?.sql).toContain('THEN COALESCE(a.payable_commission_amount, 0)');
    expect(selectedRowsQuery?.sql).toContain('ELSE COALESCE(a.commission_amount, 0)');
    expect(selectedRowsQuery?.sql).not.toContain('NULLIF(a.payable_commission_amount, 0)');
    const secondSettlementItem = mockDB.queries.filter((query) => /INSERT INTO doctor_commission_settlement_items/i.test(query.sql))[1];
    expect(secondSettlementItem?.params).toEqual(expect.arrayContaining([100, 102]));
    const secondPaidUpdate = mockDB.queries.find((query) => /UPDATE doctor_commission_accruals/i.test(query.sql) && query.params.includes(102));
    expect(secondPaidUpdate?.params).toEqual(expect.arrayContaining([100, 102]));
  });

  it('pays an assigned performer using an audited line override amount', async () => {
    const { app, mockDB } = createPayoutApp({ drawerCash: 2000 });

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay', {
      method: 'POST',
      body: {
        accrualIds: [101, 102],
        lineOverrides: [
          { lineId: 102, payoutAmount: 800, reason: 'Senior echo performer rate' },
        ],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: 'payout-assigned-override-101-102',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as { settlement: { grossCommissionAmount: number; netPaidAmount: number } };
    expect(body.settlement).toMatchObject({ grossCommissionAmount: 950, netPaidAmount: 950 });
    expect(mockDB.queries.some((query) => /calculated_commission_amount/i.test(query.sql) && /override_reason/i.test(query.sql))).toBe(true);
    const overriddenPaidUpdate = mockDB.queries.find((query) => /UPDATE doctor_commission_accruals/i.test(query.sql) && query.params.includes(102));
    expect(overriddenPaidUpdate?.sql).toContain("TRIM(COALESCE(notes, '') || ' ' || ?)");
    expect(overriddenPaidUpdate?.params).toEqual(expect.arrayContaining([
      800,
      expect.stringContaining('Senior echo performer rate'),
      102,
    ]));
  });

  it('does not create a partial settlement when one selected accrual is stale', async () => {
    const { app, mockDB } = createPayoutApp({ stale: true });

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay', {
      method: 'POST',
      body: {
        accrualIds: [101, 999],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: 'payout-stale-test',
      },
    });

    expect(response.status).toBe(409);
    expect(mockDB.queries.some((q) => /INSERT INTO doctor_commission_settlements/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT INTO doctor_commission_settlement_items/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql))).toBe(false);
  });
});
