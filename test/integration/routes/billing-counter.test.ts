import { describe, expect, it } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';
const COUNTER = {
  id: 7,
  tenant_id: TENANT_ID,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
};
const ACTIVE_SESSION = {
  id: 17,
  tenant_id: TENANT_ID,
  counter_id: COUNTER.id,
  counter_name: COUNTER.counter_name,
  counter_code: COUNTER.counter_code,
  counter_type: COUNTER.counter_type,
  employee_id: 1,
  status: 'active',
  opening_cash: 100,
  opened_at: '2026-07-22 09:00:00',
};
const RECIPIENT = {
  id: 2,
  tenant_id: TENANT_ID,
  name: 'Next Receptionist',
  role: 'reception',
  is_active: 1,
};

function summaryOverride(sql: string) {
  const normalized = sql.toLowerCase();
  if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
    return {
      first: {
        opening_cash: 150,
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
}

describe('Nonblocking billing-counter variance lifecycle', () => {
  it('closes the outgoing session and creates handover while variance review remains pending', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        users: [RECIPIENT],
        cash_variance_approvals: [],
        billing_handovers: [],
        cash_drawer_movements: [],
      },
      queryOverride: summaryOverride,
    });

    const response = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: {
        closingCash: 20,
        handoverAmount: 20,
        handoverTo: RECIPIENT.id,
        remarks: 'Short cash after physical recount',
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: ACTIVE_SESSION.id,
      varianceApprovalRequired: true,
      varianceApprovalStatus: 'pending',
      handoverCreated: true,
      operationalCloseCompleted: true,
    });

    expect(mockDB.queries.some((query) =>
      /UPDATE billing_counter_sessions/i.test(query.sql)
      && /SET status = 'closed'/i.test(query.sql)
      && /variance_approval_status = 'pending'/i.test(query.sql)
    )).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT INTO cash_variance_approvals/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) => /INSERT INTO billing_handovers/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT INTO cash_drawer_movements/i.test(query.sql)
      && /'handover'/i.test(query.sql)
    )).toBe(true);
  });

  it('treats sub-cent floating-point noise as zero variance', async () => {
    const expectedCash = 2077.49;
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [{ ...ACTIVE_SESSION, opening_cash: expectedCash }],
        users: [RECIPIENT],
        cash_variance_approvals: [],
        billing_handovers: [],
        cash_drawer_movements: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: expectedCash,
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
    });

    const response = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: {
        closingCash: 2077.4900000000002,
        handoverAmount: expectedCash,
        handoverTo: RECIPIENT.id,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: ACTIVE_SESSION.id,
      closingCash: expectedCash,
      availableCash: expectedCash,
      variance: 0,
      varianceApprovalRequired: false,
    });
  });

  it('does not block a high-variance operational close when refund cash remains held and no cash is handed over', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_refund_cash_holds: [{
          id: 90,
          tenant_id: TENANT_ID,
          counter_session_id: ACTIVE_SESSION.id,
          employee_id: ACTIVE_SESSION.employee_id,
          amount: 20,
          status: 'held',
        }],
        cash_variance_approvals: [],
        billing_handovers: [],
        cash_drawer_movements: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return summaryOverride(sql);
        }
        if (normalized.includes('from billing_refund_cash_holds') && normalized.includes("status = 'held'")) {
          return { first: { count: 1, amount: 20 } };
        }
        return null;
      },
    });

    const response = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: {
        closingCash: 0,
        handoverAmount: 0,
        remarks: 'Refund reserve remains held after close',
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: ACTIVE_SESSION.id,
      heldRefundCash: 20,
      availableCash: 130,
      varianceApprovalRequired: true,
      varianceApprovalStatus: 'pending',
      handoverCreated: true,
      operationalCloseCompleted: true,
    });
    const custodyUpdate = mockDB.queries.find((query) =>
      /UPDATE billing_refund_cash_holds/i.test(query.sql) && /custody_user_id/i.test(query.sql),
    );
    expect(custodyUpdate?.sql).toMatch(/custody_user_id\s*=\s*COALESCE\(\?,\s*employee_id\)/i);
    expect(custodyUpdate?.params[0]).toBeNull();
  });

  it('rejecting a variance keeps the already-closed operational session unchanged', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'accountant',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [{
          ...ACTIVE_SESSION,
          status: 'closed',
          variance: -130,
          variance_approval_required: 1,
          variance_approval_status: 'pending',
          closing_cash_declared: 20,
          expected_cash: 150,
        }],
        cash_variance_approvals: [{
          id: 7001,
          tenant_id: TENANT_ID,
          counter_session_id: ACTIVE_SESSION.id,
          variance: -130,
          threshold: 100,
          requested_by: ACTIVE_SESSION.employee_id,
          status: 'pending',
          reason: 'Short cash after physical recount',
        }],
      },
    });

    const response = await jsonRequest(app, '/billing-counter/sessions/17/variance-approvals', {
      method: 'POST',
      body: { decision: 'reject', reason: 'Investigation required' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: ACTIVE_SESSION.id,
      status: 'closed',
      decision: 'reject',
      handoverCreated: false,
      operationalStateChanged: false,
    });

    const sessionUpdate = mockDB.queries.find((query) =>
      /UPDATE billing_counter_sessions/i.test(query.sql)
      && /variance_approval_status = \?/i.test(query.sql)
    );
    expect(sessionUpdate?.params).toContain('rejected');
    expect(sessionUpdate?.sql).not.toMatch(/SET\s+status\s*=\s*'active'/i);
    expect(mockDB.queries.some((query) => /INSERT INTO billing_handovers/i.test(query.sql))).toBe(false);
  });

  it('approving a variance only resolves the audit record', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'accountant',
      tenantId: TENANT_ID,
      tables: {
        billing_counter_sessions: [{
          ...ACTIVE_SESSION,
          status: 'closed',
          variance: -130,
          variance_approval_required: 1,
          variance_approval_status: 'pending',
        }],
        cash_variance_approvals: [{
          id: 7001,
          tenant_id: TENANT_ID,
          counter_session_id: ACTIVE_SESSION.id,
          variance: -130,
          threshold: 100,
          requested_by: ACTIVE_SESSION.employee_id,
          status: 'pending',
        }],
      },
    });

    const response = await jsonRequest(app, '/billing-counter/sessions/17/variance-approvals', {
      method: 'POST',
      body: { decision: 'approve', reason: 'Count verified by supervisor' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'closed',
      decision: 'approve',
      operationalStateChanged: false,
    });
    expect(mockDB.queries.some((query) => /INSERT INTO billing_handovers/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) =>
      /UPDATE cash_variance_approvals/i.test(query.sql)
      && query.params.includes('approved')
    )).toBe(true);
  });
});
