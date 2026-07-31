import { describe, expect, it } from 'vitest';
import receptionDoctorPayoutRoutes from '../../../src/routes/tenant/receptionDoctorPayouts';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const reserveRows = [
  {
    reserve_id: 701,
    billing_service_item_id: 501,
    diagnostic_kind: 'radiology',
    test_code: 'RAD-USG-WA',
    test_name: 'USG Whole Abdomen',
    reserved_at: '2026-07-13 09:00:00',
    net_unit_service_amount: 1000,
    payout_maximum_amount: 1000,
    reserved_amount: 200,
    rule_rate_type: 'flat',
    rule_rate_value: 200,
    patient_id: 11,
    patient_name: 'Karim Ali',
    patient_code: 'P-11',
    bill_id: 501,
    invoice_no: 'INV-501',
    bill_is_paid: 1,
  },
  {
    reserve_id: 702,
    billing_service_item_id: 501,
    diagnostic_kind: 'radiology',
    test_code: 'RAD-USG-WA',
    test_name: 'USG Whole Abdomen',
    reserved_at: '2026-07-13 10:00:00',
    net_unit_service_amount: 900,
    payout_maximum_amount: 900,
    reserved_amount: 200,
    rule_rate_type: 'flat',
    rule_rate_value: 200,
    patient_id: 12,
    patient_name: 'Rahima Begum',
    patient_code: 'P-12',
    bill_id: 502,
    invoice_no: 'INV-502',
    bill_is_paid: 0,
  },
  {
    reserve_id: 703,
    billing_service_item_id: 502,
    diagnostic_kind: 'lab',
    test_code: 'LAB-CBC',
    test_name: 'CBC',
    reserved_at: '2026-07-13 11:00:00',
    net_unit_service_amount: 500,
    payout_maximum_amount: 500,
    reserved_amount: 50,
    rule_rate_type: 'percent',
    rule_rate_value: 1000,
    patient_id: 13,
    patient_name: 'Jamal Uddin',
    patient_code: 'P-13',
    bill_id: 503,
    invoice_no: 'INV-503',
    bill_is_paid: 1,
  },
];

function createReserveReadApp() {
  return createTestApp({
    route: receptionDoctorPayoutRoutes,
    routePath: '/doctor-payouts',
    role: 'receptionist',
    userId: 99,
    queryOverride: (sql) => {
      if (/FROM diagnostic_performer_reserves r/i.test(sql)) return { results: reserveRows };
      return null;
    },
  });
}

describe('unassigned performer reserve payables', () => {
  it('groups reserved units by test and separates eligible from waiting-payment quantities', async () => {
    const { app } = createReserveReadApp();

    const response = await app.request('/doctor-payouts/unassigned-performer-reserves?includeWaitingPayment=true');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      groups: Array<{
        billingServiceItemId: number;
        testName: string;
        eligibleQuantity: number;
        waitingPaymentQuantity: number;
        eligibleAmount: number;
        waitingPaymentAmount: number;
        rateSummary: string;
        reserves: Array<{ reserveId: number; billIsPaid: boolean }>;
      }>;
      summary: {
        testCount: number;
        eligibleQuantity: number;
        waitingPaymentQuantity: number;
        eligibleAmount: number;
        waitingPaymentAmount: number;
      };
    };

    expect(body.summary).toEqual({
      testCount: 2,
      eligibleQuantity: 2,
      waitingPaymentQuantity: 1,
      eligibleAmount: 250,
      waitingPaymentAmount: 200,
    });
    expect(body.groups[0]).toMatchObject({
      billingServiceItemId: 501,
      testName: 'USG Whole Abdomen',
      eligibleQuantity: 1,
      waitingPaymentQuantity: 1,
      eligibleAmount: 200,
      waitingPaymentAmount: 200,
      rateSummary: '৳200/unit',
    });
    expect(body.groups[0].reserves.map((row) => row.reserveId)).toEqual([701, 702]);
    expect(body.groups[1]).toMatchObject({
      billingServiceItemId: 502,
      testName: 'CBC',
      eligibleQuantity: 1,
      waitingPaymentQuantity: 0,
      rateSummary: '10%',
    });
  });

  it('passes inclusive date and service item filters to the tenant-scoped query', async () => {
    const { app, mockDB } = createReserveReadApp();

    const response = await app.request('/doctor-payouts/unassigned-performer-reserves?from=2026-07-01&to=2026-07-13&serviceItemId=501');

    expect(response.status).toBe(200);
    const query = mockDB.queries.find((entry) => /FROM diagnostic_performer_reserves r/i.test(entry.sql));
    expect(query?.sql).toContain('r.tenant_id = ?');
    expect(query?.sql).toContain("r.status = 'reserved'");
    expect(query?.sql).toContain('date(r.reserved_at) >= date(?)');
    expect(query?.sql).toContain('date(r.reserved_at) <= date(?)');
    expect(query?.sql).toContain('r.billing_service_item_id = ?');
    expect(query?.params).toEqual(expect.arrayContaining(['tenant-1', '2026-07-01', '2026-07-13', 501]));
  });

  it('rejects malformed or reversed date ranges', async () => {
    const { app } = createReserveReadApp();

    expect((await app.request('/doctor-payouts/unassigned-performer-reserves?from=2026-02-30')).status).toBe(400);
    expect((await app.request('/doctor-payouts/unassigned-performer-reserves?from=2026-07-14&to=2026-07-13')).status).toBe(400);
  });
});

describe('performer reserve reconciliation', () => {
  it('returns status-wise and test-wise reserve totals with waiting-payment split', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionDoctorPayoutRoutes,
      routePath: '/doctor-payouts',
      role: 'accountant',
      userId: 88,
      queryOverride: (sql) => {
        if (/GROUP BY r\.billing_service_item_id/i.test(sql) && /reserve_amount/i.test(sql)) {
          return {
            results: [
              {
                billing_service_item_id: 501,
                test_code: 'RAD-USG-WA',
                test_name: 'USG Whole Abdomen',
                diagnostic_kind: 'radiology',
                status: 'reserved',
                quantity: 3,
                reserve_amount: 600,
                eligible_quantity: 2,
                eligible_amount: 400,
                waiting_quantity: 1,
                waiting_amount: 200,
              },
              {
                billing_service_item_id: 501,
                test_code: 'RAD-USG-WA',
                test_name: 'USG Whole Abdomen',
                diagnostic_kind: 'radiology',
                status: 'paid',
                quantity: 3,
                reserve_amount: 600,
                eligible_quantity: 0,
                eligible_amount: 0,
                waiting_quantity: 0,
                waiting_amount: 0,
              },
              {
                billing_service_item_id: 502,
                test_code: 'LAB-CBC',
                test_name: 'CBC',
                diagnostic_kind: 'lab',
                status: 'cancelled',
                quantity: 1,
                reserve_amount: 50,
                eligible_quantity: 0,
                eligible_amount: 0,
                waiting_quantity: 0,
                waiting_amount: 0,
              },
              {
                billing_service_item_id: 501,
                test_code: 'RAD-USG-WA',
                test_name: 'USG Whole Abdomen',
                diagnostic_kind: 'radiology',
                status: 'reversed',
                quantity: 2,
                reserve_amount: 250,
                eligible_quantity: 0,
                eligible_amount: 0,
                waiting_quantity: 0,
                waiting_amount: 0,
              },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request('/doctor-payouts/performer-reserve-reconciliation?from=2026-07-01&to=2026-07-13&serviceItemId=501');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      summary: Record<string, number>;
      byTest: Array<Record<string, number | string | null>>;
    };
    expect(body.summary).toEqual({
      reservedQuantity: 3,
      reservedAmount: 600,
      eligibleReservedQuantity: 2,
      eligibleReservedAmount: 400,
      waitingPaymentQuantity: 1,
      waitingPaymentAmount: 200,
      paidQuantity: 3,
      paidAmount: 600,
      cancelledQuantity: 1,
      cancelledAmount: 50,
      reversedQuantity: 2,
      reversedAmount: 250,
    });
    expect(body.byTest).toEqual(expect.arrayContaining([
      expect.objectContaining({
        billingServiceItemId: 501,
        reservedAmount: 600,
        paidAmount: 600,
        reversedAmount: 250,
      }),
      expect.objectContaining({
        billingServiceItemId: 502,
        cancelledAmount: 50,
      }),
    ]));
    const query = mockDB.queries.find((entry) => /GROUP BY r\.billing_service_item_id/i.test(entry.sql));
    expect(query?.sql).toContain('r.tenant_id = ?');
    expect(query?.sql).toContain("r.status IN ('reserved', 'paid', 'cancelled', 'reversed')");
    expect(query?.params).toEqual(expect.arrayContaining(['tenant-1', '2026-07-01', '2026-07-13', 501]));
  });
});

const payoutReserveRows = [
  {
    reserve_id: 701,
    bill_id: 501,
    invoice_item_id: 301,
    patient_id: 11,
    visit_id: 21,
    billing_service_item_id: 501,
    diagnostic_kind: 'radiology',
    lab_test_id: null,
    radiology_imaging_item_id: 71,
    test_name: 'USG Whole Abdomen',
    net_unit_service_amount: 1000,
    payout_maximum_amount: 1000,
    reserved_amount: 200,
    status: 'reserved',
    bill_is_paid: 1,
    item_status: 'active',
  },
  {
    reserve_id: 703,
    bill_id: 503,
    invoice_item_id: 303,
    patient_id: 13,
    visit_id: 23,
    billing_service_item_id: 502,
    diagnostic_kind: 'lab',
    lab_test_id: 61,
    radiology_imaging_item_id: null,
    test_name: 'CBC',
    net_unit_service_amount: 500,
    payout_maximum_amount: 500,
    reserved_amount: 50,
    status: 'reserved',
    bill_is_paid: 1,
    item_status: 'active',
  },
];

function createReservePayoutApp(options: { stale?: boolean; single?: boolean; unpaid?: boolean; drawerCash?: number; fullDiscount?: boolean } = {}) {
  const payoutRows = payoutReserveRows.map((row) => (
    options.fullDiscount && row.reserve_id === 701
      ? { ...row, net_unit_service_amount: 0, payout_maximum_amount: 1000 }
      : row
  ));
  const selectedRows = options.stale || options.single
    ? payoutRows.slice(0, 1)
    : payoutRows.map((row, index) => ({
      ...row,
      bill_is_paid: options.unpaid && index === 1 ? 0 : row.bill_is_paid,
    }));

  return createTestApp({
    route: receptionDoctorPayoutRoutes,
    routePath: '/doctor-payouts',
    role: 'receptionist',
    userId: 99,
    queryOverride: (sql) => {
      if (/FROM diagnostic_performer_reserves r/i.test(sql) && /r\.id IN/i.test(sql)) return { results: selectedRows };
      if (/FROM doctors/i.test(sql) && /COALESCE\(is_active, 1\) = 1/i.test(sql)) {
        return { first: { id: 7, name: 'Dr. Aminul Islam', specialty: 'Radiology' } };
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
      if (/SELECT id\s+FROM doctor_commission_settlements\s+WHERE tenant_id = \? AND idempotency_key = \?/i.test(sql)) {
        return { first: { id: 91 } };
      }
      if (/SELECT id FROM doctor_commission_accruals/i.test(sql) && /performer_reserve_id IN/i.test(sql)) {
        return { results: [{ id: 801 }, { id: 802 }] };
      }
      if (/SELECT settlement_no/i.test(sql)) return { first: null };
      if (/SELECT id\s+FROM doctor_commission_settlements/i.test(sql) && /idempotency_key/i.test(sql)) {
        return { first: { id: 901 } };
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
        opened_at: '2026-07-13 08:00:00',
        status: 'active',
        workstation_id: null,
        heartbeat_at: null,
        variance_approval_status: null,
      }],
      accounting_fiscal_years: [],
      accounting_period_closes: [],
      doctor_commission_settlements: [],
      doctor_commission_accruals: [],
      doctor_commission_settlement_items: [],
      cash_drawer_movements: [],
      cash_ledger_entries: [],
      sequence_counters: [],
    },
  });
}

describe('performer reserve payout reversal', () => {
  it('reverses paid reserves, restores cash, and queues a reversed accounting journal', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionDoctorPayoutRoutes,
      routePath: '/doctor-payouts',
      role: 'accountant',
      userId: 88,
      queryOverride: (sql) => {
        if (/FROM doctor_commission_settlements s/i.test(sql) && /COUNT\(r\.id\) AS reserve_count/i.test(sql)) {
          return {
            first: {
              id: 91,
              settlement_no: 'DPS-2026-000091',
              doctor_id: 7,
              doctor_name: 'Dr. Aminul Islam',
              counter_session_id: 1,
              counter_id: 3,
              original_voucher_id: 501,
              idempotency_key: 'performer-payout-91',
              total_amount: 200,
              net_paid_amount: 200,
              reserve_count: 2,
              reserve_amount: 250,
            },
          };
        }
        if (/FROM accounting_journal_lines/i.test(sql) && /voucher_id = \?/i.test(sql)) {
          return {
            results: [
              { account_id: 10, debit_amount: 250, credit_amount: 0, memo: 'Clear doctor payable' },
              { account_id: 20, debit_amount: 0, credit_amount: 200, memo: 'Cash payout' },
              { account_id: 30, debit_amount: 0, credit_amount: 50, memo: 'Advance deduction' },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_counter_sessions: [{
          id: 44,
          tenant_id: 'tenant-1',
          employee_id: 88,
          counter_id: 9,
          counter_name: 'Recovery Counter',
          counter_code: 'RECOVERY',
          counter_type: 'billing',
          opening_cash: 0,
          opened_at: '2026-07-13 12:00:00',
          status: 'active',
          workstation_id: null,
          heartbeat_at: null,
          variance_approval_status: null,
        }],
        accounting_fiscal_years: [],
        accounting_period_closes: [],
        accounting_posting_events: [],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        accounting_voucher_types: [],
        accounting_subledger_transactions: [],
        doctor_commission_settlements: [],
        doctor_commission_accruals: [],
        doctor_commission_settlement_items: [],
        diagnostic_performer_reserves: [],
        cash_drawer_movements: [],
        cash_ledger_entries: [],
        mutation_idempotency_keys: [],
        sequence_counters: [],
      },
    });

    const response = await jsonRequest(app, '/doctor-payouts/settlements/91/reverse', {
      method: 'POST',
      body: {
        reason: 'Wrong performer doctor selected',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174099',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    const body = await response.json() as { amount: number; reserveCount: number; settlementId: number };
    expect(body).toMatchObject({ amount: 200, reserveCount: 2, settlementId: 91 });
    const cashIn = mockDB.queries.find((query) => /INSERT INTO cash_drawer_movements/i.test(query.sql) && /'cash_in'/i.test(query.sql));
    expect(cashIn?.params.slice(0, 5)).toEqual(['tenant-1', 44, 9, '88', 200]);
    expect(mockDB.queries.some((query) => /UPDATE diagnostic_performer_reserves/i.test(query.sql) && /status = 'reversed'/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) => /UPDATE doctor_commission_settlements/i.test(query.sql) && /reversed_at/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) => /UPDATE doctor_commission_accruals/i.test(query.sql) && /status = 'cancelled'/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(query.sql) && /manual_journal/i.test(String(query.params)))).toBe(true);
  });

  it('falls back to legacy total amount when net paid was not populated', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionDoctorPayoutRoutes,
      routePath: '/doctor-payouts',
      role: 'accountant',
      userId: 88,
      queryOverride: (sql) => {
        if (/FROM doctor_commission_settlements s/i.test(sql) && /COUNT\(r\.id\) AS reserve_count/i.test(sql)) {
          return {
            first: {
              id: 92,
              settlement_no: 'DPS-2026-000092',
              doctor_id: 7,
              doctor_name: 'Dr. Aminul Islam',
              counter_session_id: 1,
              counter_id: 3,
              original_voucher_id: 502,
              idempotency_key: 'performer-payout-92',
              total_amount: 250,
              net_paid_amount: 0,
              reserve_count: 2,
              reserve_amount: 250,
            },
          };
        }
        if (/FROM accounting_journal_lines/i.test(sql) && /voucher_id = \?/i.test(sql)) {
          return {
            results: [
              { account_id: 10, debit_amount: 250, credit_amount: 0, memo: 'Clear doctor payable' },
              { account_id: 20, debit_amount: 0, credit_amount: 250, memo: 'Cash payout' },
            ],
          };
        }
        return null;
      },
      tables: {
        billing_counter_sessions: [{
          id: 44,
          tenant_id: 'tenant-1',
          employee_id: 88,
          counter_id: 9,
          counter_name: 'Recovery Counter',
          counter_code: 'RECOVERY',
          counter_type: 'billing',
          opening_cash: 0,
          opened_at: '2026-07-13 12:00:00',
          status: 'active',
          workstation_id: null,
          heartbeat_at: null,
          variance_approval_status: null,
        }],
        accounting_fiscal_years: [],
        accounting_period_closes: [],
        accounting_posting_events: [],
        accounting_vouchers: [],
        accounting_journal_lines: [],
        accounting_voucher_types: [],
        accounting_subledger_transactions: [],
        doctor_commission_settlements: [],
        doctor_commission_accruals: [],
        doctor_commission_settlement_items: [],
        diagnostic_performer_reserves: [],
        cash_drawer_movements: [],
        cash_ledger_entries: [],
        mutation_idempotency_keys: [],
        sequence_counters: [],
      },
    });

    const response = await jsonRequest(app, '/doctor-payouts/settlements/92/reverse', {
      method: 'POST',
      body: {
        reason: 'Legacy payout reversal',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174097',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    const body = await response.json() as { amount: number; reserveCount: number; settlementId: number };
    expect(body).toMatchObject({ amount: 250, reserveCount: 2, settlementId: 92 });
    const cashIn = mockDB.queries.find((query) => /INSERT INTO cash_drawer_movements/i.test(query.sql) && /'cash_in'/i.test(query.sql));
    expect(cashIn?.params.slice(0, 5)).toEqual(['tenant-1', 44, 9, '88', 250]);
  });

  it('requires the reversing user to collect returned cash into an active current drawer', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionDoctorPayoutRoutes,
      routePath: '/doctor-payouts',
      role: 'accountant',
      userId: 88,
      tables: {
        billing_counter_sessions: [],
        mutation_idempotency_keys: [],
      },
    });

    const response = await jsonRequest(app, '/doctor-payouts/settlements/91/reverse', {
      method: 'POST',
      body: {
        reason: 'Wrong performer doctor selected',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174098',
      },
    });

    expect(response.status).toBe(400);
    expect(mockDB.queries.some((query) => /INSERT INTO cash_drawer_movements/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /UPDATE diagnostic_performer_reserves/i.test(query.sql))).toBe(false);
  });
});

describe('performer reserve payout mutation', () => {
  it('assigns exact reserve units to one doctor with one settlement and one cash movement', async () => {
    const { app, mockDB } = createReservePayoutApp();

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay-reserves', {
      method: 'POST',
      body: {
        doctorId: 7,
        reserveIds: [701, 703],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        note: 'USG and CBC performer envelope',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as { settlement: { netPaidAmount: number; paidCount: number; doctorId: number } };
    expect(body.settlement).toMatchObject({ netPaidAmount: 250, paidCount: 2, doctorId: 7 });
    expect(mockDB.queries.filter((query) => /INSERT INTO doctor_commission_settlements/i.test(query.sql))).toHaveLength(1);
    expect(mockDB.queries.filter((query) => /INSERT INTO doctor_commission_accruals/i.test(query.sql))).toHaveLength(2);
    expect(mockDB.queries.some((query) => /UPDATE diagnostic_performer_reserves/i.test(query.sql) && /status = 'paid'/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.filter((query) => /INSERT INTO cash_drawer_movements/i.test(query.sql))).toHaveLength(1);
    expect(mockDB.queries.some((query) => /performer_reserve_transition_guard/i.test(query.sql))).toBe(true);
  });

  it('uses audited line override amounts for the settlement and settlement items', async () => {
    const { app, mockDB } = createReservePayoutApp();

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay-reserves', {
      method: 'POST',
      body: {
        doctorId: 7,
        reserveIds: [701, 703],
        lineOverrides: [
          { lineId: 701, payoutAmount: 800, reason: 'Senior performer fee' },
        ],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174003',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as { settlement: { grossCommissionAmount: number; netPaidAmount: number } };
    expect(body.settlement).toMatchObject({ grossCommissionAmount: 850, netPaidAmount: 850 });

    const settlementInsert = mockDB.queries.find((query) => /INSERT INTO doctor_commission_settlements/i.test(query.sql));
    expect(settlementInsert?.params).toContain(850);
    const overriddenAccrual = mockDB.queries.find((query) => /INSERT INTO doctor_commission_accruals/i.test(query.sql) && query.params.includes(701));
    expect(overriddenAccrual?.params).toEqual(expect.arrayContaining([
      800,
      expect.stringContaining('Senior performer fee'),
    ]));
    expect(mockDB.queries.some((query) => /calculated_commission_amount/i.test(query.sql) && /override_reason/i.test(query.sql))).toBe(true);
  });

  it('allows a full-discount reserve override up to the original service cap', async () => {
    const { app, mockDB } = createReservePayoutApp({ fullDiscount: true, single: true, drawerCash: 2000 });

    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay-reserves', {
      method: 'POST',
      body: {
        doctorId: 7,
        reserveIds: [701],
        lineOverrides: [
          { lineId: 701, payoutAmount: 800, reason: 'Full-discount senior performer fee' },
        ],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174004',
      },
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    const body = await response.json() as { settlement: { grossCommissionAmount: number; netPaidAmount: number } };
    expect(body.settlement).toMatchObject({ grossCommissionAmount: 800, netPaidAmount: 800 });

    const selectedRowsQuery = mockDB.queries.find((query) => /FROM diagnostic_performer_reserves r/i.test(query.sql) && /r\.id IN/i.test(query.sql));
    expect(selectedRowsQuery?.sql).toContain('COALESCE(ii.unit_price, 0)');
    expect(selectedRowsQuery?.sql).toContain('AS payout_maximum_amount');
  });

  it('rejects stale reserve selection before creating a settlement', async () => {
    const { app, mockDB } = createReservePayoutApp({ stale: true });
    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay-reserves', {
      method: 'POST',
      body: {
        doctorId: 7,
        reserveIds: [701, 703],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174001',
      },
    });

    expect(response.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO doctor_commission_settlements/i.test(query.sql))).toBe(false);
  });

  it('blocks reserves whose linked bill is not fully paid', async () => {
    const { app, mockDB } = createReservePayoutApp({ unpaid: true });
    const response = await jsonRequest(app, '/doctor-payouts/sessions/1/pay-reserves', {
      method: 'POST',
      body: {
        doctorId: 7,
        reserveIds: [701, 703],
        receiverType: 'doctor',
        receiverName: 'Dr. Aminul Islam',
        paymentMethod: 'cash',
        adjustments: { advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 },
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174002',
      },
    });

    expect(response.status).toBe(409);
    expect(mockDB.queries.some((query) => /INSERT INTO doctor_commission_settlements/i.test(query.sql))).toBe(false);
  });
});
