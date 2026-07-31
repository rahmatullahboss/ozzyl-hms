import { describe, expect, it } from 'vitest';
import cashOperationsRoutes from '../../../src/routes/tenant/cashOperations';
import { createTestApp } from '../helpers/test-app';

const tenantId = 'tenant-1';

function createCashOpsApp(options: { role?: string; userId?: number; sessions?: Record<string, unknown>[]; empCashTransactions?: Record<string, unknown>[]; movements?: Record<string, unknown>[]; refundHolds?: Record<string, unknown>[]; settings?: Record<string, unknown>[]; activityRows?: Record<string, unknown>[] } = {}) {
  return createTestApp({
    route: cashOperationsRoutes,
    routePath: '/cash-operations',
    role: options.role ?? 'receptionist',
    userId: options.userId ?? 21,
    tenantId,
    tables: {
      billing_counter_sessions: options.sessions ?? [{
        id: 1,
        tenant_id: tenantId,
        employee_id: 21,
        counter_id: 3,
        opening_cash: 1000,
        opened_at: '2026-06-19 08:00:00',
        status: 'active',
        workstation_id: null,
        heartbeat_at: null,
        variance_approval_status: null,
      }],
      billing_counters: [{
        id: 3,
        tenant_id: tenantId,
        counter_name: 'Main Cash Counter',
        counter_code: 'MAIN',
        counter_type: 'billing',
      }],
      emp_cash_transactions: options.empCashTransactions ?? [
        { tenant_id: tenantId, counter_session_id: 1, payment_method: 'cash', transaction_type: 'CashSales', amount: 5000, transaction_date: '2026-06-19 09:00:00' },
        { tenant_id: tenantId, counter_session_id: 1, payment_method: 'cash', transaction_type: 'SalesReturn', amount: 200, transaction_date: '2026-06-19 10:00:00' },
      ],
      billing_refund_cash_holds: options.refundHolds ?? [],
      cash_drawer_movements: options.movements ?? [
        { id: 1, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_out', reference_type: 'doctor_commission_settlement', reference_id: '11', amount: 300, description: 'Doctor payout', created_at: '2026-06-19 11:00:00' },
        { id: 2, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_out', reference_type: 'expense', reference_id: '12', amount: 150, description: 'Fuel', created_at: '2026-06-19 12:00:00' },
        { id: 3, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_drop', reference_type: 'cash_transfer', reference_id: '13', amount: 250, description: 'Transfer out', created_at: '2026-06-19 13:00:00' },
        { id: 4, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_in', reference_type: 'accepted_cash_transfer', reference_id: '14', amount: 100, description: 'Accepted transfer', created_at: '2026-06-19 14:00:00' },
        { id: 5, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_drop', reference_type: 'bank_deposit', reference_id: '15', amount: 400, description: 'Bank custody', created_at: '2026-06-19 15:00:00' },
      ],
      cash_operation_settings: options.settings ?? [],
    },
    queryOverride: (sql) => {
      if (sql.includes('SELECT * FROM (') && sql.includes(') activity')) {
        return {
          results: options.activityRows ?? [{
            source: 'movement',
            id: 3,
            created_at: '2026-06-19 13:00:00',
            employee_id: 21,
            actor_name: 'Cashier',
            movement_type: 'cash_drop',
            reference_type: 'cash_custody_transfer',
            reference_id: 13,
            amount: 250,
            description: 'Transfer out',
            transfer_no: 'CCT-1',
            transfer_status: 'pending',
            transfer_by_name: 'Cashier',
            transfer_to_name: 'Admin',
            destination_type: 'admin_custody',
            custody_label: 'Admin custody',
            received_amount: 0,
            due_amount: 250,
            received_at: null,
            invoice_no: null,
          }],
        };
      }
      return null;
    },
  });
}

describe('cash operations API', () => {
  it('returns active-session overview totals for a cashier', async () => {
    const { app } = createCashOpsApp({
      refundHolds: [{ tenant_id: tenantId, counter_session_id: 1, amount: 350, status: 'held' }],
    });

    const response = await app.request('/cash-operations/overview');

    expect(response.status).toBe(200);
    const body = await response.json() as { overview: Record<string, number> };
    expect(body.overview).toMatchObject({
      openingCash: 1000,
      patientCashCollection: 5000,
      refundCashOut: 200,
      doctorPayout: 300,
      expenseCashOut: 150,
      transferOut: 250,
      acceptedTransferIn: 100,
      bankDepositCustody: 400,
      currentDrawerBalance: 4800,
      heldRefundCash: 350,
      availableCash: 4450,
      sessionStatus: 'active',
    });
  });

  it('includes drawer cash received in the current drawer balance without double-counting categorized cash out', async () => {
    const { app } = createCashOpsApp({
      sessions: [{
        id: 1,
        tenant_id: tenantId,
        employee_id: 21,
        counter_id: 3,
        opening_cash: 0,
        opened_at: '2026-06-25 08:00:00',
        status: 'active',
        workstation_id: null,
        heartbeat_at: null,
        variance_approval_status: null,
      }],
      empCashTransactions: [
        { tenant_id: tenantId, counter_session_id: 1, payment_method: 'cash', transaction_type: 'CashSales', amount: 1000, transaction_date: '2026-06-25 09:00:00' },
      ],
      movements: [
        { id: 1, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_in', reference_type: 'counter_handover', reference_id: '31', amount: 13250, description: 'Drawer cash received', created_at: '2026-06-25 08:05:00' },
        { id: 2, tenant_id: tenantId, counter_session_id: 1, counter_id: 3, employee_id: 21, movement_type: 'cash_out', reference_type: 'expense', reference_id: '32', amount: 450, description: 'OT Medicine', created_at: '2026-06-25 21:37:00' },
      ],
    });

    const response = await app.request('/cash-operations/overview');

    expect(response.status).toBe(200);
    const body = await response.json() as { overview: Record<string, number> };
    expect(body.overview).toMatchObject({
      openingCash: 0,
      patientCashCollection: 1000,
      manualCashIn: 13250,
      manualCashOut: 450,
      otherDrawerCashOut: 0,
      expenseCashOut: 450,
      currentDrawerBalance: 13800,
    });
  });

  it('uses local emp-cash dates in filtered overview totals', async () => {
    const { app, mockDB } = createCashOpsApp();

    const response = await app.request('/cash-operations/overview?from=2026-06-19&to=2026-06-19');

    expect(response.status).toBe(200);
    const empCashQuery = mockDB.queries.find((query) => query.sql.includes('SELECT COALESCE(SUM(ect.amount), 0) AS total') && query.sql.includes('FROM emp_cash_transactions ect'));
    expect(empCashQuery?.sql).toContain('FROM payments p');
    expect(empCashQuery?.sql).toContain('SELECT p.date');
    expect(empCashQuery?.sql).toContain('date(CASE');
    expect(empCashQuery?.sql).not.toContain("date(COALESCE(datetime(COALESCE(transaction_date, created_at), '+6 hours')))");
    expect(empCashQuery?.sql).toContain('>= ?');
    expect(empCashQuery?.sql).toContain('<= ?');
  });

  it('returns normalized activity rows', async () => {
    const { app, mockDB } = createCashOpsApp();

    const response = await app.request('/cash-operations/activity');

    expect(response.status).toBe(200);
    const body = await response.json() as { activity: Array<Record<string, unknown>> };
    expect(body.activity[0]).toHaveProperty('referenceType');
    expect(body.activity[0]).toHaveProperty('movementType');
    expect(body.activity[0]).toHaveProperty('amount');
    const activityQuery = mockDB.queries.find((query) => query.sql.includes('SELECT * FROM (') && query.sql.includes(') activity'));
    expect(activityQuery?.sql).toContain("datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours')");
  });



  it('uses the payment date as the source of truth for bill cash activity timestamps', async () => {
    const { app, mockDB } = createCashOpsApp();

    const response = await app.request('/cash-operations/activity?from=2026-06-23&to=2026-06-23');

    expect(response.status).toBe(200);
    const activityQuery = mockDB.queries.find((query) => query.sql.includes('SELECT * FROM (') && query.sql.includes(') activity'));
    expect(activityQuery?.sql).toContain('FROM payments p');
    expect(activityQuery?.sql).toContain('p.bill_id = CAST(ect.reference_id AS INTEGER)');
    expect(activityQuery?.sql).toContain('SELECT p.date');
    expect(activityQuery?.sql).toContain("date(CASE");
    expect(activityQuery?.sql).not.toContain("date(datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours'))");
  });

  it('normalizes legacy emp-cash timestamps and exposes invoice numbers for patient payments', async () => {
    const { app, mockDB } = createCashOpsApp({
      activityRows: [{
        source: 'transaction',
        id: 171,
        created_at: '2026-06-22 09:31:00',
        employee_id: 21,
        actor_name: 'Cashier',
        movement_type: 'cash_in',
        reference_type: 'bill',
        reference_id: 171,
        amount: 1200,
        description: 'Billing counter payment RCP-000171',
        transfer_no: null,
        transfer_status: null,
        transfer_by_name: null,
        transfer_to_name: null,
        destination_type: null,
        custody_label: null,
        received_amount: null,
        due_amount: null,
        received_at: null,
        invoice_no: 'INV-000171',
      }],
    });

    const response = await app.request('/cash-operations/activity?from=2026-06-22&to=2026-06-22');

    expect(response.status).toBe(200);
    const body = await response.json() as { activity: Array<Record<string, unknown>> };
    expect(body.activity[0]).toMatchObject({
      createdAt: '2026-06-22 09:31:00',
      invoiceNo: 'INV-000171',
      referenceNo: 'INV-000171',
      description: 'Billing counter payment INV-000171',
    });
    const activityQuery = mockDB.queries.find((query) => query.sql.includes('SELECT * FROM (') && query.sql.includes(') activity'));
    expect(activityQuery?.sql).toContain("datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours')");
    expect(activityQuery?.sql).toContain('SELECT p.date');
    expect(activityQuery?.sql).toContain('date(CASE');
    expect(activityQuery?.sql).not.toContain("date(COALESCE(datetime(COALESCE(ect.transaction_date, ect.created_at), '+6 hours')))");
    expect(activityQuery?.sql).toContain('LEFT JOIN bills b');
    expect(activityQuery?.sql).toContain('b.invoice_no');
  });

  it('lets monitoring roles read a counter by counterId with date filters without owning an active session', async () => {
    const { app, mockDB } = createCashOpsApp({ role: 'accountant', userId: 77 });

    const response = await app.request('/cash-operations/activity?counterId=3&from=2026-06-19&to=2026-06-19');

    expect(response.status).toBe(200);
    const body = await response.json() as { session: Record<string, unknown>; activity: Array<Record<string, unknown>> };
    expect(body.session).toMatchObject({ counterId: 3, dateFrom: '2026-06-19', dateTo: '2026-06-19' });
    expect(body.activity.length).toBeGreaterThan(0);
    const counterLookup = mockDB.queries.find((q) => /FROM billing_counter_sessions s/i.test(q.sql) && /s.counter_id = \?/i.test(q.sql));
    expect(counterLookup?.sql).toContain('bc.counter_name AS counter_name');
    expect(counterLookup?.sql).not.toContain('bc.name AS counter_name');
    expect(mockDB.queries.some((q) => /counter_id = \?/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /date\(m\.created_at/i.test(q.sql) && />= \?/i.test(q.sql) && /<= \?/i.test(q.sql))).toBe(true);
  });



  it('lets a cashier read their own closed counter session for print reports', async () => {
    const { app, mockDB } = createCashOpsApp({
      sessions: [
        {
          id: 2,
          tenant_id: tenantId,
          employee_id: 21,
          counter_id: 3,
          opening_cash: 700,
          opened_at: '2026-06-18 08:00:00',
          closed_at: '2026-06-18 17:00:00',
          status: 'closed',
          workstation_id: null,
          heartbeat_at: null,
          variance_approval_status: null,
        },
      ],
    });

    const response = await app.request('/cash-operations/activity?counterSessionId=2&from=2026-06-18&to=2026-06-18');

    expect(response.status).toBe(200);
    const body = await response.json() as { session: Record<string, unknown> };
    expect(body.session).toMatchObject({ sessionId: 2, counterId: 3, dateFrom: '2026-06-18', dateTo: '2026-06-18' });
    const ownSessionLookup = mockDB.queries.find((q) => /FROM billing_counter_sessions s/i.test(q.sql) && /s.id = \?/i.test(q.sql));
    expect(ownSessionLookup?.sql).toContain('s.employee_id = ?');
    expect(ownSessionLookup?.params).toEqual([tenantId, 2, '21']);
  });

  it('lists a cashier own recent counter sessions for closed-shift printing', async () => {
    const { app } = createCashOpsApp({
      sessions: [
        { id: 2, tenant_id: tenantId, employee_id: 21, counter_id: 3, opening_cash: 700, opened_at: '2026-06-18 08:00:00', closed_at: '2026-06-18 17:00:00', status: 'closed' },
        { id: 3, tenant_id: tenantId, employee_id: 99, counter_id: 3, opening_cash: 900, opened_at: '2026-06-18 09:00:00', closed_at: '2026-06-18 18:00:00', status: 'closed' },
      ],
    });

    const response = await app.request('/cash-operations/sessions?limit=20');

    expect(response.status).toBe(200);
    const body = await response.json() as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions.map((session) => session.sessionId)).toEqual([2]);
    expect(body.sessions[0]).toMatchObject({ status: 'closed', counterId: 3, openingCash: 700 });
  });

  it('filters cashier session options by selected report date range', async () => {
    const { app, mockDB } = createCashOpsApp({
      sessions: [
        { id: 2, tenant_id: tenantId, employee_id: 21, counter_id: 3, opening_cash: 700, opened_at: '2026-06-18 08:00:00', closed_at: '2026-06-18 17:00:00', status: 'closed' },
        { id: 4, tenant_id: tenantId, employee_id: 21, counter_id: 3, opening_cash: 800, opened_at: '2026-06-22 08:00:00', closed_at: '2026-06-22 17:00:00', status: 'closed' },
      ],
    });

    const response = await app.request('/cash-operations/sessions?from=2026-06-22&to=2026-06-22&limit=20');

    expect(response.status).toBe(200);
    await response.json() as { sessions: Array<Record<string, unknown>> };
    const sessionsQuery = mockDB.queries.find((q) => /FROM billing_counter_sessions s/i.test(q.sql) && /ORDER BY datetime/i.test(q.sql));
    expect(sessionsQuery?.sql).toContain('s.employee_id = ?');
    expect(sessionsQuery?.sql).toContain('>= ?');
    expect(sessionsQuery?.sql).toContain('<= ?');
    expect(sessionsQuery?.params).toEqual([tenantId, '21', '2026-06-22', '2026-06-22', 20]);
  });



  it('clamps selected closed-session activity queries to the session open and close window', async () => {
    const { app, mockDB } = createCashOpsApp({
      sessions: [
        {
          id: 2,
          tenant_id: tenantId,
          employee_id: 21,
          counter_id: 3,
          opening_cash: 700,
          opened_at: '2026-06-22 08:00:00',
          closed_at: '2026-06-22 17:00:00',
          status: 'closed',
        },
      ],
    });

    const response = await app.request('/cash-operations/activity?counterSessionId=2&limit=50');

    expect(response.status).toBe(200);
    const activityQuery = mockDB.queries.find((query) => query.sql.includes('SELECT * FROM (') && query.sql.includes(') activity'));
    expect(activityQuery?.sql).toContain('datetime(m.created_at) >= datetime(?)');
    expect(activityQuery?.sql).toContain('datetime(m.created_at) <= datetime(?)');
    expect(activityQuery?.sql).toContain('datetime(CASE');
    expect(activityQuery?.sql).toContain('<= datetime(?)');
    expect(activityQuery?.params).toContain('2026-06-22 08:00:00');
    expect(activityQuery?.params).toContain('2026-06-22 17:00:00');
  });

  it('allows admins to patch cash operation settings and blocks cashiers', async () => {
    const { app: cashierApp } = createCashOpsApp({ role: 'receptionist' });
    const denied = await cashierApp.request('/cash-operations/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pettyCashAutoApproveLimit: 750 }),
    });
    expect(denied.status).toBe(403);

    const { app: adminApp, mockDB } = createCashOpsApp({ role: 'hospital_admin' });
    const updated = await adminApp.request('/cash-operations/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pettyCashAutoApproveLimit: 750, receiptRequiredLimit: 500 }),
    });

    expect(updated.status).toBe(200);
    expect(mockDB.queries.some((q) => /INSERT INTO cash_operation_settings/i.test(q.sql))).toBe(true);
  });
});
