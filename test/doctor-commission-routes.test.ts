import { describe, expect, it } from 'vitest';
import commissionRoutes from '../src/routes/tenant/commissions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function makeCommissionApp() {
  // Mutable flag so the mock can return 'approved' after the explicit
  // approval step has executed.
  let accrualStatus: 'accrued' | 'approved' = 'accrued';

  const mockDB = createMockDB({
    queryOverride(sql) {
      const s = sql.toLowerCase();

      if (s.includes('from doctors') && s.includes('where id=?') && s.includes('tenant_id=?')) {
        return {
          first: { id: 7, name: 'Dr Rahman', is_active: 1 },
        };
      }

      if (s.includes('from lab_test_catalog') && s.includes('where id=?') && s.includes('tenant_id=?')) {
        return {
          first: { id: 33, code: 'CBC', name: 'CBC', is_active: 1 },
        };
      }

      if (s.includes('from doctor_commission_rules')) {
        return {
          results: [{
            id: 1,
            doctor_id: 7,
            doctor_name: 'Dr Rahman',
            service_type: 'lab_test',
            lab_test_id: 33,
            lab_test_name: 'CBC',
            category: 'hematology',
            rate_type: 'percent',
            rate_value: 1_000,
            effective_from: '2026-05-01',
            effective_to: null,
            is_active: 1,
          }],
          first: {
            id: 1,
            canonical_source_key: null,
            doctor_id: 7,
            service_type: 'lab_test',
            lab_test_id: 33,
            category: 'hematology',
            rate_type: 'percent',
            rate_value: 2_500,
            waiver_policy: 'protected_floor',
            protected_rate_bps: 500,
            protected_flat_amount: 0,
            incentive_type: 'prescriber',
            effective_from: '2026-05-01',
            effective_to: null,
            is_active: 1,
            rule_version: 4,
            notes: 'Original rule',
          },
        };
      }

      if (s.includes('doctor_payable_ledger')) {
        return {
          results: [{
            doctor_id: 7,
            doctor_name: 'Dr Rahman',
            doctor_specialization: 'Medicine',
            payable_gross_amount: 5000,
            payable_amount: 1500,
            paid_amount: 700,
            cancelled_amount: 200,
            outstanding_count: 2,
            paid_count: 1,
            cancelled_count: 1,
            settlement_count: 1,
            settled_amount: 700,
            last_accrued_date: '2026-05-05',
            last_settlement_date: '2026-05-06',
          }],
        };
      }

      if (s.includes('from doctor_commission_accruals')) {
        const accrual = {
          id: 3,
          doctor_id: 7,
          doctor_name: 'Dr Rahman',
          source_type: 'lab_test',
          gross_amount: 10_000,
          commission_amount: 1_000,
          payable_amount: 1_000,
          canonical_source_key: null,
          doctor_department: 'OPD',
          doctor_registration_number: 'BMDC-7',
          doctor_user_id: null,
          doctor_is_active: 1,
          status: accrualStatus,
          accrued_date: '2026-05-04',
          lab_test_name: 'CBC',
          bill_is_paid: 1,
        };
        return {
          results: [accrual],
          first: accrual,
        };
      }

      if (s.includes('update doctor_commission_accruals')) {
        // Approval (status = 'approved') transition flips the mutable flag so
        // a subsequent pay query sees status='approved' and can succeed.
        if (accrualStatus === 'accrued') {
          accrualStatus = 'approved';
          return {
            success: true,
            meta: { changes: 1, last_row_id: 0 },
          };
        }
        // Pay attempt — succeed only after approval.
        return {
          success: true,
          meta: { changes: 1, last_row_id: 0 },
        };
      }

      if (s.includes('select id')
        && s.includes('from doctor_commission_settlements')
        && s.includes('idempotency_key')) {
        return { first: { id: 501 } };
      }

      return null;
    },
  });

  return {
    app: createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'hospital_admin',
      tenantId: '1',
      mockDB,
    }).app,
    mockDB,
    setAccrualStatus: (status: 'accrued' | 'approved') => { accrualStatus = status; },
  };
}

describe('doctor commission management routes', () => {
  it('creates doctor commission rules with basis-point percentage rates', async () => {
    const { app, mockDB } = makeCommissionApp();
    const res = await app.request('/commissions/doctor-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctorId: 7,
        serviceType: 'lab_test',
        labTestId: 33,
        category: 'hematology',
        rateType: 'percent',
        rateValue: 1_000,
        effectiveFrom: '2026-05-01',
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Doctor commission rule saved',
    });
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/INSERT INTO doctor_commission_rules/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_compensation_rules/i);
    expect(batch).toMatch(/INSERT INTO canonical_outbox_events/i);
  });

  it('persists a doctor-specific protected commission floor', async () => {
    const { app, mockDB } = makeCommissionApp();
    const res = await app.request('/commissions/doctor-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctorId: 7,
        serviceType: 'lab_test',
        rateType: 'percent',
        rateValue: 2_500,
        waiverPolicy: 'protected_floor',
        protectedRate: 5,
        incentiveType: 'prescriber',
        effectiveFrom: '2026-07-26',
      }),
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((query) => /INSERT INTO doctor_commission_rules/i.test(query.sql));
    expect(insert?.sql).toContain('waiver_policy');
    expect(insert?.params).toEqual(expect.arrayContaining(['protected_floor', 500, 0]));
  });

  it('rejects a protected percentage floor above the commission rate', async () => {
    const { app } = makeCommissionApp();
    const res = await app.request('/commissions/doctor-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctorId: 7,
        serviceType: 'lab_test',
        rateType: 'percent',
        rateValue: 2_500,
        waiverPolicy: 'protected_floor',
        protectedRate: 30,
        incentiveType: 'prescriber',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Protected commission rate cannot exceed the commission rate',
    });
  });

  it('clears nullable rule scope fields while preserving omitted waiver settings', async () => {
    const { app, mockDB } = makeCommissionApp();
    const res = await app.request('/commissions/doctor-rules/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctorId: 7,
        serviceType: 'consultation_fee',
        labTestId: null,
        category: null,
        rateType: 'percent',
        rateValue: 2_500,
        incentiveType: 'performer',
        notes: null,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Doctor commission rule updated',
    });

    const existingRuleRead = mockDB.queries.find((query) =>
      /FROM doctor_commission_rules/i.test(query.sql) && /WHERE id = \? AND tenant_id = \?/i.test(query.sql),
    );
    expect(existingRuleRead?.sql).toContain('doctor_id');
    expect(existingRuleRead?.sql).toContain('rule_version');
    expect(existingRuleRead?.sql).toContain('notes');

    const update = mockDB.queries.find((query) => /UPDATE doctor_commission_rules/i.test(query.sql));
    expect(update?.sql).toContain('rule_version = rule_version + 1');
    expect(update?.sql).toContain('lab_test_id = ?');
    expect(update?.sql).not.toContain('lab_test_id = COALESCE');
    expect(update?.params).toEqual(expect.arrayContaining(['protected_floor', 500, 0, null]));
  });

  it('retires the Canonical doctor rule in the same batch as the legacy delete', async () => {
    const { app, mockDB } = makeCommissionApp();
    const res = await app.request('/commissions/doctor-rules/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Doctor commission rule deleted successfully',
    });
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/DELETE FROM doctor_commission_rules/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_compensation_rules/i);
    expect(batch).toMatch(/'retired'/i);
    const outbox = mockDB.queries.find((query) => /INSERT INTO canonical_outbox_events/i.test(query.sql));
    expect(outbox?.params).toContain('canonical.compensation-rule.retired');
  });

  it('lists doctor accruals, approves them, and then marks them as paid', async () => {
    const { app, mockDB } = makeCommissionApp();
    const list = await app.request('/commissions/doctor-accruals?status=accrued');

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      accruals: [{
        id: 3,
        doctor_id: 7,
        commission_amount: 1_000,
      }],
    });

    // 1) Direct payment of an 'accrued' accrual must be rejected.
    const prematurePay = await app.request('/commissions/doctor-accruals/3/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidDate: '2026-05-04', notes: 'Cash paid' }),
    });
    expect(prematurePay.status).toBe(409);
    await expect(prematurePay.json()).resolves.toMatchObject({
      error: 'Doctor commission accrual must be approved before payment',
    });

    // 2) Approve the accrual first.
    const approve = await app.request('/commissions/doctor-accruals/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accrualIds: [3] }),
    });
    expect(approve.status).toBe(200);
    await expect(approve.json()).resolves.toMatchObject({
      message: 'Doctor commission accruals approved',
      count: 1,
    });

    // 3) Now the accrual can be paid.
    const paid = await app.request('/commissions/doctor-accruals/3/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidDate: '2026-05-04', notes: 'Cash paid' }),
    });

    const paidBody = await paid.clone().json();
    expect(paid.status, JSON.stringify(paidBody)).toBe(200);
    await expect(paid.json()).resolves.toMatchObject({
      message: 'Doctor commission accrual marked as paid',
    });
    const paidAccrualUpdate = mockDB.queries.find((query) => /UPDATE doctor_commission_accruals/i.test(query.sql) && /status = 'paid'/i.test(query.sql));
    expect(paidAccrualUpdate?.sql).toMatch(/paid_amount\s*=\s*\?/i);
    expect(paidAccrualUpdate?.params).toEqual(expect.arrayContaining([1_000, 3]));
    expect(paidAccrualUpdate?.sql).toMatch(/balance_amount\s*=\s*0/i);
    expect(paidAccrualUpdate?.sql).toMatch(/idempotency_key\s*=\s*\?/i);
  });

  it('rejects doctor accrual approval when linked bill is not fully paid', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_commission_accruals')) {
          return {
            results: [{
              id: 3,
              doctor_id: 7,
              status: 'accrued',
              bill_is_paid: 0,
            }],
            first: { id: 3, doctor_id: 7, status: 'accrued', bill_is_paid: 0 },
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'hospital_admin',
      tenantId: '1',
      mockDB,
    });

    const res = await app.request('/commissions/doctor-accruals/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accrualIds: [3] }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('due amount') as unknown as string,
    });
  });

  it('rejects payment of a doctor accrual that is still in accrued status', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_commission_accruals a') && s.includes('where a.id = ?')) {
          return {
            first: {
              id: 3,
              doctor_id: 7,
              doctor_name: 'Dr Rahman',
              doctor_specialization: 'Medicine',
              doctor_department: 'OPD',
              doctor_registration_number: 'BMDC-7',
              doctor_user_id: null,
              doctor_is_active: 1,
              gross_amount: 1000,
              commission_amount: 1000,
              payable_amount: 1000,
              canonical_source_key: null,
              status: 'accrued',
              bill_is_paid: 1,
            },
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: '1',
      userId: 9,
      mockDB,
    });

    const res = await app.request('/commissions/doctor-accruals/3/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidDate: '2026-05-07', paymentMode: 'cash' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Doctor commission accrual must be approved before payment',
    });
  });

  it('uses the doctors.specialty column in doctor finance joins', async () => {
    const { app, mockDB } = makeCommissionApp();

    await app.request('/commissions/doctor-rules');
    await app.request('/commissions/doctor-accruals');

    const doctorJoinSql = mockDB.queries
      .map((query) => query.sql.replace(/\s+/g, ' ').toLowerCase())
      .filter((sql) => sql.includes('join doctors d'));

    expect(doctorJoinSql.length).toBeGreaterThanOrEqual(2);
    expect(doctorJoinSql.some((sql) => sql.includes('d.specialty as doctor_specialization'))).toBe(true);
    expect(doctorJoinSql.some((sql) => sql.includes('d.specialization as doctor_specialization'))).toBe(false);
  });

  it('lists doctor payable ledger totals separately from paid and cancelled commissions', async () => {
    const { app, mockDB } = makeCommissionApp();

    const res = await app.request('/commissions/doctor-payables');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      payables: [{
        doctor_id: 7,
        payable_amount: 1500,
        paid_amount: 700,
        cancelled_amount: 200,
        outstanding_count: 2,
      }],
      summary: {
        payableAmount: 1500,
        paidAmount: 700,
        cancelledAmount: 200,
        doctorCount: 1,
      },
    });

    const sql = mockDB.queries.map((query) => query.sql.replace(/\s+/g, ' ').toLowerCase()).join('\n');
    expect(sql).toContain('doctor_payable_ledger');
    expect(sql).toContain("status in ('accrued', 'approved')");
  });

  it('blocks receptionist access to doctor finance ledgers', async () => {
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'receptionist',
      tenantId: '1',
      mockDB: createMockDB(),
    });

    const payables = await app.request('/commissions/doctor-payables');
    const accruals = await app.request('/commissions/doctor-accruals');

    expect(payables.status).toBe(403);
    expect(accruals.status).toBe(403);
  });

  it('does not post a doctor payment voucher when the accrual was already claimed', async () => {
    // Status is forced to 'approved' so we are past the approval gate;
    // the test then exercises the race where someone else has already
    // claimed the accrual (UPDATE changes = 0).
    let claimed = false;
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_commission_accruals a') && s.includes('where a.id = ?')) {
          return {
            first: {
              id: 3,
              doctor_id: 7,
              doctor_name: 'Dr Rahman',
              doctor_specialization: 'Medicine',
              doctor_department: 'OPD',
              doctor_registration_number: 'BMDC-7',
              doctor_user_id: null,
              doctor_is_active: 1,
              gross_amount: 1000,
              commission_amount: 1000,
              payable_amount: 1000,
              canonical_source_key: null,
              status: 'approved',
              bill_is_paid: 1,
            },
          };
        }
        if (s.includes('update doctor_commission_accruals')) {
          claimed = true;
          return {
            success: true,
            meta: { changes: 0, last_row_id: 0 },
          };
        }
        if (claimed && s.includes("'transition_guard'")) {
          throw new Error('NOT NULL constraint failed: doctor_commission_settlement_items.tenant_id');
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: commissionRoutes,
      routePath: '/commissions',
      role: 'accountant',
      tenantId: '1',
      userId: 9,
      mockDB,
    });

    const res = await app.request('/commissions/doctor-accruals/3/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidDate: '2026-05-07', paymentMode: 'cash' }),
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) =>
      query.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && query.params.includes('commission_settled')
    )).toBe(false);
  });

  it('accrues diagnostic commissions only for eligible line-level prescriber and performer doctors', async () => {
    const { accrueBillCommissions } = await import('../src/lib/lab-finance');
    const ruleLookups: unknown[][] = [];
    const inserts: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              first: async () => {
                if (!sql.includes('FROM doctor_commission_rules')) return null;
                ruleLookups.push(params);
                const doctorId = params[1];
                const serviceType = params[2];
                const incentiveType = params[3];
                const labTestId = params[4];
                if (doctorId === 7 && serviceType === 'lab_test' && incentiveType === 'prescriber' && labTestId === 33) {
                  return { id: 101, rate_type: 'percent', rate_value: 2500, incentive_type: 'prescriber' };
                }
                if (doctorId === 8 && serviceType === 'lab_test' && incentiveType === 'performer' && labTestId === 33) {
                  return { id: 102, rate_type: 'flat', rate_value: 100, incentive_type: 'performer' };
                }
                return null;
              },
              all: async () => {
                if (sql.includes('FROM lab_test_catalog')) {
                  return { results: params.slice(1).map((id) => ({ id, is_commissionable: 1 })) };
                }
                return { results: [] };
              },
              run: async () => {
                if (sql.includes('INSERT OR IGNORE INTO doctor_commission_accruals')) inserts.push(params);
                return { meta: { changes: 1, last_row_id: inserts.length } };
              },
            };
          },
        };
      },
    };

    await accrueBillCommissions(db as any, {
      tenantId: '1',
      userId: 1,
      patientId: 10,
      visitId: null,
      billId: 99,
      referringDoctorId: 5,
      billDate: '2026-07-01',
      items: [
        { itemCategory: 'lab', description: 'CBC', lineTotal: 1000, referenceId: null, prescriberDoctorId: 7, performerDoctorId: 8, labTestId: 33 },
        { itemCategory: 'lab', description: 'RBS', lineTotal: 500, referenceId: null, labTestId: 44 },
      ],
    });

    expect(inserts).toHaveLength(2);
    expect(inserts.map((params) => params[1])).toEqual([7, 8]);
    expect(inserts.map((params) => params[5])).toEqual([33, 33]);
    expect(ruleLookups.some((params) => params[1] === 5 && params[4] === 44)).toBe(true);
  });
});