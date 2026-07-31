import { describe, expect, it } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import paymentMethodsRoutes from '../../../src/routes/tenant/payment-methods';
import { ACCOUNTING_EVENT_TYPES } from '../../../src/lib/accounting-posting';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createMockDB } from '../helpers/mock-db';
import { PATIENT_1, TENANT_1 } from '../helpers/fixtures';

const SERVICE_ITEM = {
  id: 501,
  tenant_id: TENANT_1.id,
  item_name: 'CBC',
  item_code: 'LAB-CBC',
  service_department_id: 11,
  price: 500,
  tax_applicable: 0,
  tax_percent: 0,
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
};

const DOCTOR = {
  id: 91,
  tenant_id: TENANT_1.id,
  name: 'Dr. Aminul Islam',
  specialty: 'General Medicine',
  consultation_fee: 500,
  is_active: 1,
};

const COUNTER = {
  id: 7,
  tenant_id: TENANT_1.id,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
};

const HANDOVER_RECIPIENT = {
  id: 2,
  tenant_id: TENANT_1.id,
  name: 'Accountant One',
  email: 'accountant@example.test',
  role: 'accountant',
  is_active: 1,
};

const ACTIVE_SESSION = {
  id: 17,
  tenant_id: TENANT_1.id,
  counter_id: COUNTER.id,
  counter_name: COUNTER.counter_name,
  counter_code: COUNTER.counter_code,
  counter_type: COUNTER.counter_type,
  employee_id: 1,
  status: 'active',
  opening_cash: 100,
  opened_at: '2025-01-01 09:00:00',
};

const WORKSTATION_HEADERS = { 'X-HMS-Workstation-ID': 'hms-ws-main' };

const HIGH_VARIANCE_PENDING_APPROVAL = {
  id: 7001,
  tenant_id: TENANT_1.id,
  counter_session_id: ACTIVE_SESSION.id,
  variance: -130,
  threshold: 100,
  requested_by: ACTIVE_SESSION.employee_id,
  handover_to: HANDOVER_RECIPIENT.id,
  handover_amount: 20,
  handover_due_amount: 0,
  handover_total: 20,
  handover_status: 'pending',
  status: 'pending',
  reason: 'Short cash after recount',
};

function isHandoverDrawerMovementInsert(query: { sql: string }): boolean {
  const normalized = query.sql.toLowerCase();
  return /insert(?:\s+or\s+ignore)?\s+into\s+cash_drawer_movements/.test(normalized) && normalized.includes("'handover'");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

async function requestHash(input: Record<string, unknown>): Promise<string> {
  const data = new TextEncoder().encode(stableStringify({ ...input, idempotencyKey: undefined }));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('Billing Counter routes', () => {
  it('rejects counter activation from non billing-counter roles', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'doctor',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
      },
    });

    const activate = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 100 },
    });

    expect(activate.status).toBe(403);
  });

  it('activates a billing counter session', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        emp_cash_transactions: [],
      },
    });

    const activate = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 100 },
    });

    expect(activate.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(true);
  });

  it('credits pending released refund reserves when the custody user opens the next counter', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        emp_cash_transactions: [],
        cash_drawer_movements: [],
        billing_refund_cash_holds: [{
          id: 91,
          tenant_id: TENANT_1.id,
          custody_user_id: 1,
          amount: 80,
          status: 'released',
          release_status: 'pending',
        }],
      },
    });

    const activate = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 100 },
    });

    expect(activate.status).toBe(201);
    const releaseInsert = mockDB.queries.find((query) =>
      /INSERT OR IGNORE INTO cash_drawer_movements/i.test(query.sql)
      && /refund_reserve_release/i.test(query.sql),
    );
    expect(releaseInsert).toBeTruthy();
    expect(releaseInsert?.params).toEqual(expect.arrayContaining([COUNTER.id, 1, TENANT_1.id, 1]));
    const releaseUpdate = mockDB.queries.find((query) =>
      /UPDATE billing_refund_cash_holds/i.test(query.sql)
      && /release_status = 'credited'/i.test(query.sql),
    );
    expect(releaseUpdate).toBeTruthy();
  });

  it('opens the counter session and opening drawer movement in one database batch', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        emp_cash_transactions: [],
      },
    });

    const activate = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 100 },
    });

    expect(activate.status).toBe(201);
    const sessionInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'));
    const movementInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'));
    expect(sessionInsert?.method).toBe('all');
    expect(movementInsert?.method).toBe('all');
  });

  it('rejects activation when the selected counter already has an active drawer', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions') && normalized.includes('counter_id = ?')) {
          return { first: { id: 99, employee_id: 2 } };
        }
        return null;
      },
    });

    const activate = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 100 },
    });

    expect(activate.status).toBe(409);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(false);
  });

  it('returns a server-paginated combined pending due worklist', async () => {
    const pageRows = [
      {
        source_type: 'bill', source_id: 501, bill_id: 501, appointment_id: null, visit_id: 71,
        patient_id: 10, patient_name: 'Patient A', patient_code: 'P-10', doctor_id: 91,
        doctor_name: 'Dr A', token_no: null, appt_time: null, invoice_no: 'INV-501',
        service_summary: 'CBC', amount: 800, occurred_at: '2026-07-18 10:00:00',
        created_by_name: 'Reception', billing_status: 'partial',
      },
      {
        source_type: 'appointment', source_id: 601, bill_id: null, appointment_id: 601, visit_id: null,
        patient_id: 11, patient_name: 'Patient B', patient_code: 'P-11', doctor_id: 92,
        doctor_name: 'Dr B', token_no: 12, appt_time: '11:00', invoice_no: null,
        service_summary: 'Doctor consultation', amount: 500, occurred_at: '2026-07-18 11:00',
        created_by_name: null, billing_status: 'pending',
      },
    ];
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        if (sql.includes('SELECT COUNT(*) AS count FROM pending_rows')) return { results: [{ count: 17 }] };
        if (sql.includes('SELECT *') && sql.includes('FROM pending_rows')) return { results: pageRows };
        return null;
      },
    });

    const response = await jsonRequest(app, '/billing-counter/pending-due-worklist?page=2&limit=8');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: pageRows,
      pagination: { page: 2, limit: 8, total: 17, pages: 3 },
    });
    const pageQuery = mockDB.queries.find((query) => query.sql.includes('FROM pending_rows') && query.sql.includes('LIMIT ? OFFSET ?'));
    expect(pageQuery?.params.slice(-2)).toEqual([8, 8]);
  });

  it('closes an active billing counter session with cash reconciliation', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        emp_cash_transactions: [],
        users: [HANDOVER_RECIPIENT],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 100,
              cash_in: 0,
              cash_out: 0,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: {
        closingCash: 100,
        handoverTo: HANDOVER_RECIPIENT.id,
        nonCashSettlements: { card: 250 },
        nonCashRemarks: 'Card terminal batch checked',
      },
    });

    expect(close.status).toBe(200);
    expect(await close.json()).toMatchObject({
      nonCashSettlementSaved: true,
      settlementNoteSaved: true,
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update billing_counter_sessions'))).toBe(true);
    const handover = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_handovers'));
    expect(handover?.sql.toLowerCase()).toContain('counter_session_id');
    expect(handover?.params).toContain(ACTIVE_SESSION.id);
    expect(handover?.params).toContain(HANDOVER_RECIPIENT.id);
    expect(mockDB.queries.some(isHandoverDrawerMovementInsert)).toBe(true);
  });

  it('closes with a pending refund reserve and hands over only available cash', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_refund_cash_holds: [{ id: 90, tenant_id: TENANT_1.id, counter_session_id: ACTIVE_SESSION.id, amount: 80, status: 'held' }],
        users: [HANDOVER_RECIPIENT],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_refund_cash_holds') && normalized.includes("status = 'held'")) {
          return { first: { count: 1, amount: 80 } };
        }
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 100,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: { closingCash: 20, handoverAmount: 20, handoverTo: HANDOVER_RECIPIENT.id },
    });

    expect(close.status).toBe(200);
    expect(await close.json()).toMatchObject({
      heldRefundCash: 80,
      availableCash: 20,
      totalPhysicalCashUnderCustody: 100,
      handoverAmount: 20,
    });
    const custodyUpdate = mockDB.queries.find((query) =>
      /UPDATE billing_refund_cash_holds/i.test(query.sql) && /custody_user_id/i.test(query.sql),
    );
    expect(custodyUpdate?.params).toContain(HANDOVER_RECIPIENT.id);
    const handover = mockDB.queries.find((query) => /INSERT INTO billing_handovers/i.test(query.sql));
    expect(handover?.params).toContain(20);
    const sessionUpdate = mockDB.queries.find((query) => query.sql.toLowerCase().includes('update billing_counter_sessions'));
    expect(sessionUpdate?.sql).toContain('refund_reserve_at_close');
    expect(sessionUpdate?.sql).toContain('available_cash_at_close');
    expect(sessionUpdate?.sql).toContain('total_physical_cash_at_close');
    expect(sessionUpdate?.params).toEqual(expect.arrayContaining([80, 20, 100]));
  });

  it('closes without a handover recipient when all physical cash is held for a pending refund', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_refund_cash_holds: [{
          id: 90,
          tenant_id: TENANT_1.id,
          counter_session_id: ACTIVE_SESSION.id,
          employee_id: ACTIVE_SESSION.employee_id,
          amount: 80,
          status: 'held',
        }],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_refund_cash_holds') && normalized.includes("status = 'held'")) {
          return { first: { count: 1, amount: 80 } };
        }
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 80,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: { closingCash: 0, handoverAmount: 0, remarks: 'All remaining cash is reserved for refund' },
    });

    expect(close.status).toBe(200);
    await expect(close.json()).resolves.toMatchObject({
      heldRefundCash: 80,
      availableCash: 0,
      totalPhysicalCashUnderCustody: 80,
      handoverAmount: 0,
    });
    const custodyUpdate = mockDB.queries.find((query) =>
      /UPDATE billing_refund_cash_holds/i.test(query.sql) && /custody_user_id/i.test(query.sql),
    );
    expect(custodyUpdate?.sql).toMatch(/custody_user_id\s*=\s*COALESCE\(\?,\s*employee_id\)/i);
    expect(custodyUpdate?.params[0]).toBeNull();
  });

  it('parks high-variance close without handover or drawer movement until approval', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        users: [HANDOVER_RECIPIENT],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 150,
              cash_in: 0,
              cash_out: 0,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: { closingCash: 20, handoverTo: HANDOVER_RECIPIENT.id, remarks: 'Short cash after recount' },
    });

    expect(close.status).toBe(202);
    const body = await close.json() as {
      handoverCreated: boolean;
      varianceApprovalStatus: string;
      varianceApprovalRequired: boolean;
    };
    expect(body).toMatchObject({
      handoverCreated: false,
      varianceApprovalRequired: true,
      varianceApprovalStatus: 'pending',
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_handovers'))).toBe(false);
    expect(mockDB.queries.some(isHandoverDrawerMovementInsert)).toBe(false);
  });

  it('supervisor approval finalizes high-variance close and creates custody records', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'accountant',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [{
          ...ACTIVE_SESSION,
          variance_approval_required: 1,
          variance_approval_status: 'pending',
          closing_cash_declared: 20,
          expected_cash: 150,
          variance: -130,
        }],
        cash_variance_approvals: [HIGH_VARIANCE_PENDING_APPROVAL],
      },
    });

    const approve = await jsonRequest(app, '/billing-counter/sessions/17/variance-approvals', {
      method: 'POST',
      body: { decision: 'approve', reason: 'Approved after CCTV review' },
    });

    expect(approve.status).toBe(200);
    const body = await approve.json() as { status: string; decision: string; handoverCreated: boolean };
    expect(body).toMatchObject({ status: 'closed', decision: 'approve', handoverCreated: true });
    const handover = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_handovers'));
    expect(handover?.params).toContain(HANDOVER_RECIPIENT.id);
    expect(handover?.params).toContain(20);
    expect(mockDB.queries.some(isHandoverDrawerMovementInsert)).toBe(true);
    const reserveCustodyUpdate = mockDB.queries.find((q) =>
      /UPDATE billing_refund_cash_holds/i.test(q.sql) && /custody_user_id/i.test(q.sql),
    );
    expect(reserveCustodyUpdate?.params).toContain(HANDOVER_RECIPIENT.id);
  });

  it('supervisor rejection unlocks high-variance session for recount without custody records', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'accountant',
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_sessions: [{
          ...ACTIVE_SESSION,
          variance_approval_required: 1,
          variance_approval_status: 'pending',
          closing_cash_declared: 20,
          expected_cash: 150,
          variance: -130,
        }],
        cash_variance_approvals: [HIGH_VARIANCE_PENDING_APPROVAL],
      },
    });

    const reject = await jsonRequest(app, '/billing-counter/sessions/17/variance-approvals', {
      method: 'POST',
      body: { decision: 'reject', reason: 'Recount required' },
    });

    expect(reject.status).toBe(200);
    const body = await reject.json() as { status: string; decision: string; handoverCreated: boolean };
    expect(body).toMatchObject({ status: 'active', decision: 'reject', handoverCreated: false });
    const sessionUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update billing_counter_sessions'));
    expect(sessionUpdate?.sql.toLowerCase()).toContain('variance_approval_required = 0');
    expect(sessionUpdate?.sql.toLowerCase()).toContain('non_cash_settlement_json = null');
    expect(sessionUpdate?.sql.toLowerCase()).toContain('non_cash_remarks = null');
    expect(sessionUpdate?.sql.toLowerCase()).toContain('refund_reserve_at_close = null');
    expect(sessionUpdate?.sql.toLowerCase()).toContain('available_cash_at_close = null');
    expect(sessionUpdate?.sql.toLowerCase()).toContain('total_physical_cash_at_close = null');
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_handovers'))).toBe(false);
    expect(mockDB.queries.some(isHandoverDrawerMovementInsert)).toBe(false);
  });

  it('requires a finance/admin handover recipient before closing with cash', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        emp_cash_transactions: [],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 100,
              cash_in: 0,
              cash_out: 0,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: { closingCash: 100 },
    });

    expect(close.status).toBe(400);
    const body = await close.json() as { error: string };
    expect(body.error).toMatch(/handover recipient/i);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update billing_counter_sessions'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_handovers'))).toBe(false);
  });

  it('requires remarks when closing cash has a shortage or excess variance', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        emp_cash_transactions: [],
        users: [HANDOVER_RECIPIENT],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 100,
              cash_in: 0,
              cash_out: 0,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: { closingCash: 80, handoverTo: HANDOVER_RECIPIENT.id },
    });

    expect(close.status).toBe(400);
    const body = await close.json() as { error: string };
    expect(body.error).toMatch(/variance.*remarks/i);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_handovers'))).toBe(false);
  });

  it('records remaining due amount when closing with a partial handover', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
        emp_cash_transactions: [],
        users: [HANDOVER_RECIPIENT],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 100,
              cash_in: 0,
              cash_out: 0,
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

    const close = await jsonRequest(app, '/billing-counter/sessions/17/close', {
      method: 'POST',
      body: { closingCash: 100, handoverTo: HANDOVER_RECIPIENT.id, handoverAmount: 60, remarks: 'Partial handover before bank deposit' },
    });

    expect(close.status).toBe(200);
    const body = await close.json() as { handoverAmount: number; handoverDueAmount: number; handoverTotal: number; handoverStatus: string };
    expect(body).toMatchObject({ handoverAmount: 60, handoverDueAmount: 40, handoverTotal: 100, handoverStatus: 'partial' });
    const handover = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_handovers'));
    expect(handover?.params).toContain(100);
    expect(handover?.params).toContain(40);
    expect(handover?.params).toContain('partial');
    expect(handover?.params).toContain(HANDOVER_RECIPIENT.id);
  });

  it('allows the active cashier to select themselves as a close-only handover recipient', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: ACTIVE_SESSION.employee_id,
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from users') && normalized.includes('role in')) {
          return {
            results: [{
              id: ACTIVE_SESSION.employee_id,
              name: 'Current Cashier',
              email: 'cashier@example.com',
              role: 'receptionist',
            }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handover-recipients');

    expect(res.status).toBe(200);
    const body = await res.json() as { recipients: Array<{ id: number; role: string }> };
    expect(body.recipients).toContainEqual({
      id: ACTIVE_SESSION.employee_id,
      name: 'Current Cashier',
      email: 'cashier@example.com',
      role: 'receptionist',
    });
    const sql = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from users'))?.sql ?? '';
    expect(sql).not.toMatch(/id\s*<>\s*\?/i);
  });

  it('lists finance and admin users as counter handover recipients', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: ACTIVE_SESSION.employee_id,
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from users') && normalized.includes('role in')) {
          return {
            results: [{
              id: HANDOVER_RECIPIENT.id,
              name: HANDOVER_RECIPIENT.name,
              email: HANDOVER_RECIPIENT.email,
              role: HANDOVER_RECIPIENT.role,
            }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handover-recipients');

    expect(res.status).toBe(200);
    const body = await res.json() as { recipients: Array<{ id: number; role: string }> };
    expect(body.recipients).toEqual([{ id: HANDOVER_RECIPIENT.id, name: HANDOVER_RECIPIENT.name, email: HANDOVER_RECIPIENT.email, role: HANDOVER_RECIPIENT.role }]);
    const sql = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from users'))?.sql ?? '';
    expect(sql).toMatch(/role IN \('hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist', 'manager'\)/i);
  });

  it('accepts a counter handover into the receiver current active drawer', async () => {
    const receiverCounter = {
      ...COUNTER,
      id: 8,
      counter_name: 'Second Billing Counter',
      counter_code: 'BILL-2',
    };
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
      session_no: 'BCS-45',
    };
    const receiverSession = {
      ...ACTIVE_SESSION,
      id: 66,
      counter_id: receiverCounter.id,
      employee_id: 1,
      session_no: 'BCS-66',
      workstation_id: WORKSTATION_HEADERS['X-HMS-Workstation-ID'],
    };
    const handover = {
      id: 55,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 1200,
      due_amount: 0,
      status: 'pending',
      counter_session_id: sourceSession.id,
      counter_id: sourceSession.counter_id,
      counter_type: 'billing',
      counter_name: COUNTER.counter_name,
      counter_code: COUNTER.counter_code,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER, receiverCounter],
        billing_counter_sessions: [receiverSession],
        billing_handovers: [handover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/55/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 1200, remarks: 'Counted into current drawer' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string; counterSessionId: number; expectedReceived: number; receivedAmount: number };
    expect(body).toMatchObject({
      mode: 'added_to_existing_session',
      counterSessionId: receiverSession.id,
      expectedReceived: 1200,
      receivedAmount: 1200,
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(false);
    const cashMovement = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'));
    expect(cashMovement?.params).toEqual([
      TENANT_1.id,
      receiverSession.id,
      receiverCounter.id,
      '1',
      1200,
      String(handover.id),
      `Cash handover received from session ${sourceSession.id}`,
      '1',
    ]);
    expect(cashMovement?.sql).toContain("'cash_in'");
    expect(cashMovement?.sql).toContain("'counter_handover'");
  });

  it('records accepted handover cash for the receiver to use as the next opening balance', async () => {
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
      session_no: 'BCS-45',
    };
    const handover = {
      id: 55,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 1200,
      due_amount: 0,
      status: 'pending',
      counter_session_id: sourceSession.id,
      counter_id: sourceSession.counter_id,
      counter_type: 'billing',
      counter_name: COUNTER.counter_name,
      counter_code: COUNTER.counter_code,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [handover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/55/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 1200, remarks: 'Next shift opening cash' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string; receivedAmount: number; variance: number };
    expect(body).toMatchObject({
      mode: 'started_new_session',
      receivedAmount: 1200,
      variance: 0,
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(true);
    const handoverUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update billing_handovers') && q.sql.toLowerCase().includes('receiver_counted_amount'));
    expect(handoverUpdate).toBeDefined();
    expect(handoverUpdate?.params).toContain(1200);
    expect(handoverUpdate?.params).toContain(0);
  });

  it('accepts a counter handover into admin custody without opening a new reception shift', async () => {
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
      session_no: 'BCS-45',
    };
    const handover = {
      id: 55,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 1200,
      due_amount: 0,
      status: 'pending',
      counter_session_id: sourceSession.id,
      counter_id: sourceSession.counter_id,
      counter_type: 'billing',
      counter_name: COUNTER.counter_name,
      counter_code: COUNTER.counter_code,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [handover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/55/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 1200, remarks: 'Admin counted cash' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string; counterSessionId?: number; receivedAmount: number };
    expect(body).toMatchObject({ mode: 'received_without_session', receivedAmount: 1200 });
    expect(body.counterSessionId).toBeUndefined();
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(false);
  });

  it('keeps source counter active conflict while accepting handover into current drawer', async () => {
    const receiverCounter = { ...COUNTER, id: 8, counter_code: 'BILL-2' };
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
    };
    const receiverSession = {
      ...ACTIVE_SESSION,
      id: 66,
      counter_id: receiverCounter.id,
      employee_id: 1,
      workstation_id: WORKSTATION_HEADERS['X-HMS-Workstation-ID'],
    };
    const otherActiveSourceCounterSession = {
      ...ACTIVE_SESSION,
      id: 77,
      counter_id: COUNTER.id,
      employee_id: 99,
      status: 'active',
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER, receiverCounter],
        billing_counter_sessions: [receiverSession, otherActiveSourceCounterSession],
        billing_handovers: [{
          id: 55,
          tenant_id: TENANT_1.id,
          handover_type: 'counter',
          handover_by: HANDOVER_RECIPIENT.id,
          handover_to: 1,
          handover_amount: 1200,
          due_amount: 0,
          status: 'pending',
          counter_session_id: sourceSession.id,
          counter_id: sourceSession.counter_id,
          counter_type: 'billing',
          counter_name: COUNTER.counter_name,
          counter_code: COUNTER.counter_code,
        }],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/55/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 1200 },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/already active for another user/i);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(false);
  });

  // ─── Cash variance approval: handover accept (no session) ────────────
  // The "safe cash accept" flow on main marks the handover as 'receiver_verified'
  // (or 'disputed') and records receiver_counted_amount / receiver_variance on the
  // handover row. The session is created later via /sessions/activate. The admin
  // verification endpoint is the supervisor approval gate for the variance.
  it('accepts a counter handover with no variance and records receiver_counted_amount on the handover row (no approval row)', async () => {
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
      session_no: 'BCS-45',
    };
    const handover = {
      id: 76,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 6900,
      due_amount: 0,
      status: 'pending',
      counter_session_id: sourceSession.id,
      counter_id: sourceSession.counter_id,
      counter_type: 'billing',
      counter_name: COUNTER.counter_name,
      counter_code: COUNTER.counter_code,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [handover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/76/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 6900, remarks: 'Counted full amount' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string; variance: number; status: string };
    expect(body).toMatchObject({ mode: 'started_new_session', variance: 0 });
    // The handover is updated with receiver_counted_amount=6900, receiver_variance=0
    const handoverUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update billing_handovers') && q.sql.toLowerCase().includes('receiver_counted_amount'));
    expect(handoverUpdate).toBeDefined();
    expect(handoverUpdate?.params).toContain(6900); // counted amount
    expect(handoverUpdate?.params).toContain(0); // variance
    // Reception handover accept now opens the receiver's new counter session immediately.
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(true);
    // No cash_variance_approvals row is inserted on accept (variance is 0)
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_variance_approvals'))).toBe(false);
  });

  it('accepts a disputed handover, sets status=disputed, and records the negative variance for admin final verification', async () => {
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
      session_no: 'BCS-45',
    };
    const handover = {
      id: 76,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 6900,
      due_amount: 0,
      status: 'pending',
      counter_session_id: sourceSession.id,
      counter_id: sourceSession.counter_id,
      counter_type: 'billing',
      counter_name: COUNTER.counter_name,
      counter_code: COUNTER.counter_code,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [handover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/76/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 6000, disputeReason: 'Short 900 from handover' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { variance: number; status: string; mode: string; finalVerificationStatus?: string };
    expect(body).toMatchObject({ variance: -900, mode: 'started_new_session' });
    // The handover is updated with receiver_counted_amount=6000, receiver_variance=-900
    const handoverUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update billing_handovers') && q.sql.toLowerCase().includes('receiver_counted_amount'));
    expect(handoverUpdate).toBeDefined();
    expect(handoverUpdate?.params).toContain(6000); // counted amount
    expect(handoverUpdate?.params).toContain(-900); // variance
    // Handover is NOT final-received — admin verification is the next gate
    expect(body.finalVerificationStatus).not.toBe('verified');
    // Reception handover accept opens the receiver session with counted cash.
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'))).toBe(true);
  });

  it('queues async supervisor approval when handover variance exceeds threshold (existing drawer)', async () => {
    const sourceSession = {
      ...ACTIVE_SESSION,
      id: 45,
      counter_id: COUNTER.id,
      employee_id: HANDOVER_RECIPIENT.id,
      status: 'closed',
    };
    const receiverCounter = { ...COUNTER, id: 8, counter_code: 'BILL-2' };
    const receiverSession = {
      ...ACTIVE_SESSION,
      id: 66,
      counter_id: receiverCounter.id,
      session_no: 'BCS-66',
      workstation_id: WORKSTATION_HEADERS['X-HMS-Workstation-ID'],
    };
    const handover = {
      id: 76,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 6900,
      due_amount: 0,
      status: 'pending',
      counter_session_id: sourceSession.id,
      counter_id: sourceSession.counter_id,
      counter_type: 'billing',
      counter_name: COUNTER.counter_name,
      counter_code: COUNTER.counter_code,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER, receiverCounter],
        billing_counter_sessions: [receiverSession],
        billing_handovers: [handover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/76/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 6000, disputeReason: 'Short 900 from handover' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string; variance: number };
    expect(body).toMatchObject({ mode: 'added_to_existing_session', variance: -900 });
    // Cash-in movement recorded at the physical counted amount
    const cashIn = mockDB.queries.find((q) =>
      q.sql.toLowerCase().includes('insert into cash_drawer_movements')
      && q.sql.toLowerCase().includes("'cash_in'"),
    );
    expect(cashIn?.params).toContain(6000);
    // Variance approval row queued
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_variance_approvals'))).toBe(true);
  });

  // ─── Cash variance approval: /sessions/activate pre-fill ─────────────
  it('pre-fills activate opening cash from the user\'s most recent accepted handover', async () => {
    const recentHandover = {
      id: 99,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 6900,
      due_amount: 0,
      status: 'received',
      received_by: 1,
      received_at: '2026-06-23 14:42:19',
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [recentHandover],
      },
    });

    // Frontend bug simulated: cashier hits activate with openingCash=0
    const res = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 0 },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { session: { openingCash: number } };
    // Backend pre-fills the opening cash from the recent accepted handover
    expect(body.session.openingCash).toBe(6900);
    const sessionInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'));
    expect(sessionInsert?.params).toContain(6900);
  });

  it('pre-fills activate opening cash from a receiver-verified handover waiting for admin review', async () => {
    const recentHandover = {
      id: 100,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 6900,
      due_amount: 0,
      status: 'receiver_verified',
      received_by: 1,
      received_at: '2026-06-23 14:42:19',
      receiver_counted_amount: 6900,
      receiver_variance: 0,
      admin_verification_status: 'pending_admin',
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [recentHandover],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 0 },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { session: { openingCash: number } };
    expect(body.session.openingCash).toBe(6900);
    const sessionInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into billing_counter_sessions'));
    expect(sessionInsert?.params).toContain(6900);
    const prefillLookup = mockDB.queries.find((q) =>
      q.sql.toLowerCase().includes('from billing_handovers')
      && q.sql.toLowerCase().includes('received_at is not null')
      && q.sql.toLowerCase().includes('order by received_at desc'),
    );
    expect(prefillLookup?.sql).toContain('receiver_counted_amount');
    expect(prefillLookup?.sql).toContain('receiver_verified');
    expect(prefillLookup?.sql).toContain('disputed');
  });

  it('records a variance approval row when activate opening cash differs from a recent accepted handover', async () => {
    const recentHandover = {
      id: 99,
      tenant_id: TENANT_1.id,
      handover_type: 'counter',
      handover_by: HANDOVER_RECIPIENT.id,
      handover_to: 1,
      handover_amount: 6900,
      due_amount: 0,
      status: 'received',
      received_by: 1,
      received_at: '2026-06-23 14:42:19',
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      userId: 1,
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [],
        billing_handovers: [recentHandover],
      },
    });

    // Cashier activates with a different opening cash (e.g. included extra cash)
    const res = await jsonRequest(app, '/billing-counter/sessions/activate', {
      method: 'POST',
      body: { counterId: COUNTER.id, openingCash: 7400, remarks: 'Carried over extra 500' },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { session: { openingCash: number }; openingVarianceWarning?: { expected: number; received: number; variance: number } };
    // Cashier explicitly set 7400 — backend must respect that, not silently override
    expect(body.session.openingCash).toBe(7400);
    // Variance warning is included so the cashier/auditor sees it
    expect(body.openingVarianceWarning).toBeDefined();
    expect(body.openingVarianceWarning?.expected).toBe(6900);
    expect(body.openingVarianceWarning?.variance).toBe(500);
    // Variance row queued for async supervisor review
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_variance_approvals'))).toBe(true);
  });

  it('returns active counter summary split by appointment cash, test cash, discounts, free visits, and payables', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('join billing_counters c')) {
          return { first: ACTIVE_SESSION };
        }
        if (normalized.includes('from billing_counter_sessions s') && normalized.includes('appointment_cash')) {
          return {
            first: {
              opening_cash: 100,
              cash_in: 1800,
              cash_out: 0,
              appointment_cash: 800,
              test_cash: 1000,
              total_discount: 100,
              free_appointment_count: 1,
              doctor_payable_total: 800,
              commission_payable_total: 200,
            },
          };
        }
        if (normalized.includes('from billing_refund_cash_holds') && normalized.includes("status = 'held'")) {
          return { first: { amount: 1200 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/active');

    expect(res.status).toBe(200);
    const body = await res.json() as { session: Record<string, number> };
    expect(body.session).toMatchObject({
      openingCash: 100,
      appointmentCash: 800,
      testCash: 1000,
      discountTotal: 100,
      freeAppointmentCount: 1,
      doctorPayableTotal: 800,
      commissionPayableTotal: 200,
      expectedCash: 1900,
      heldRefundCash: 1200,
      availableCash: 700,
    });
  });

  it('keeps active counter lookup working when blind-close column is not migrated yet', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select cash_visibility_mode from billing_counters')) {
          throw new Error('D1_ERROR: no such column: cash_visibility_mode');
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/active');

    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean; session: { cashVisibilityMode?: string } };
    expect(body.active).toBe(true);
    expect(body.session.cashVisibilityMode).toBe('show_all');
  });

  it('lists synced lab tests from billing service items only once', async () => {
    const labServiceItem = {
      ...SERVICE_ITEM,
      id: 901,
      item_name: 'APTT',
      item_code: 'APTT',
      service_department_id: 22,
      price: 60000,
    };
    const labDepartment = {
      id: 22,
      tenant_id: TENANT_1.id,
      department_name: 'Laboratory',
      department_code: 'LAB',
      is_active: 1,
    };
    const labCatalogRow = {
      id: 77,
      tenant_id: TENANT_1.id,
      name: 'APTT',
      code: 'APTT',
      category: 'Hematology',
      price: 60000,
      is_active: 1,
    };

    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [labServiceItem],
        billing_service_departments: [labDepartment],
        lab_test_catalog: [labCatalogRow],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_service_items si') && normalized.includes('union all') && normalized.includes('lab_test_catalog')) {
          return {
            results: [
              { id: 901, item_name: 'APTT', item_code: 'APTT', department_name: 'Laboratory', price: 60000, is_lab_catalog: 0 },
              { id: 77, item_name: 'APTT', item_code: 'APTT', department_name: 'Laboratory', price: 60000, is_lab_catalog: 1 },
            ],
          };
        }
        if (normalized.includes('from billing_service_items si') && !normalized.includes('lab_test_catalog')) {
          return {
            results: [
              { id: 901, item_name: 'APTT', item_code: 'APTT', department_name: 'Laboratory', price: 60000, is_lab_catalog: 0 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/service-items?search=APTT&limit=12');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: number; item_name: string; is_lab_catalog: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 901, item_name: 'APTT', is_lab_catalog: 0 });
    const serviceSearchSql = mockDB.queries.find((q) => q.sql.toLowerCase().includes('from billing_service_items si'))?.sql.toLowerCase();
    expect(serviceSearchSql).toBeDefined();
    expect(serviceSearchSql).not.toContain('lab_test_catalog');
  });

  it('refreshes selected billing counter service items by ids with price-category pricing', async () => {
    const labDepartment = { id: 22, tenant_id: TENANT_1.id, department_name: 'Laboratory', department_code: 'LAB', is_active: 1 };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_service_items: [{ ...SERVICE_ITEM, id: 901, item_name: 'APTT', item_code: 'APTT', price: 60000 }],
        billing_service_departments: [labDepartment],
        billing_item_price_category_maps: [{ id: 1, tenant_id: TENANT_1.id, service_item_id: 901, price_category_id: 3, price: 45000, is_active: 1, is_discount_applicable: 1 }],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/service-items?ids=901&price_category_id=3&limit=12');

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).toContain('si.id in');
    expect(sql).toContain('billing_item_price_category_maps');
  });

  it('rejects invoice creation when no billing counter is active', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [],
        billing_service_items: [SERVICE_ITEM],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(409);
  });

  it('lists generated unpaid bills for billing counter collection', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (sql.includes('FROM bills b') && sql.includes('pending_amount')) {
          return {
            results: [{
              bill_id: 77,
              invoice_no: 'INV-77',
              patient_id: PATIENT_1.id,
              patient_name: PATIENT_1.name,
              total_amount: 1000,
              paid_amount: 250,
              pending_amount: 750,
              status: 'partially_paid',
              item_count: 2,
            }],
          };
        }
        return null;
      },
      tables: {
        patients: [PATIENT_1],
        bills: [
          {
            id: 77,
            tenant_id: TENANT_1.id,
            invoice_no: 'INV-77',
            patient_id: PATIENT_1.id,
            total: 1000,
            paid: 250,
            status: 'partially_paid',
            created_at: '2026-05-12 10:00:00',
          },
          {
            id: 78,
            tenant_id: TENANT_1.id,
            invoice_no: 'INV-78',
            patient_id: PATIENT_1.id,
            total: 500,
            paid: 500,
            status: 'paid',
            created_at: '2026-05-12 11:00:00',
          },
        ],
        invoice_items: [
          { id: 1, tenant_id: TENANT_1.id, bill_id: 77 },
          { id: 2, tenant_id: TENANT_1.id, bill_id: 77 },
        ],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills?limit=12');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ bill_id: number; pending_amount: number; item_count: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ bill_id: 77, pending_amount: 750, item_count: 2 });
  });

  it('keeps non-consultation bills from appointment-origin visits in pending collection', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        if (!sql.includes('FROM bills b') || !sql.includes('pending_amount')) return null;
        if (sql.includes('v2.appointment_id IS NOT NULL')) {
          return { results: [], first: { cnt: 0 } };
        }
        return {
          results: [{
            bill_id: 88,
            invoice_no: 'INV-88',
            patient_id: PATIENT_1.id,
            patient_name: PATIENT_1.name,
            patient_code: PATIENT_1.patient_code,
            total_amount: 1200,
            paid_amount: 0,
            pending_amount: 1200,
            status: 'open',
            item_count: 1,
            visit_service_count: 1,
            service_summary: 'CBC',
            visit_no: 'V-APT-1',
          }],
          first: { cnt: 1 },
        };
      },
      tables: {
        patients: [PATIENT_1],
        visits: [{
          id: 812,
          tenant_id: TENANT_1.id,
          patient_id: PATIENT_1.id,
          doctor_id: DOCTOR.id,
          appointment_id: 5001,
          visit_no: 'V-APT-1',
          status: 'checked-in',
        }],
        bills: [{
          id: 88,
          tenant_id: TENANT_1.id,
          invoice_no: 'INV-88',
          patient_id: PATIENT_1.id,
          visit_id: 812,
          test_bill: 1200,
          doctor_visit_bill: 0,
          total: 1200,
          paid: 0,
          due: 1200,
          status: 'open',
          created_at: '2026-05-12 11:00:00',
        }],
        invoice_items: [
          { id: 11, tenant_id: TENANT_1.id, bill_id: 88, item_category: 'test', description: 'CBC' },
        ],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/pending-bills?limit=12');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ bill_id: number; pending_amount: number }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ bill_id: 88, pending_amount: 1200 });
    const pendingBillSql = mockDB.queries
      .filter((query) => query.sql.includes('FROM bills b') && query.sql.includes('pending_amount'))
      .map((query) => query.sql)
      .join('\n');
    expect(pendingBillSql).not.toContain('v2.appointment_id IS NOT NULL');
  });

  it('lets admin collect pending handover by route handoverId and records the full drawer movement amount', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          id: 55,
          tenant_id: TENANT_1.id,
          handover_type: 'counter',
          handover_amount: 1800,
          due_amount: 0,
          status: 'pending',
          counter_session_id: ACTIVE_SESSION.id,
          counter_id: COUNTER.id,
          handover_by: ACTIVE_SESSION.employee_id,
          handover_to: 2,
        }],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/admin/collect/55', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { handoverId: number; status: string };
    expect(body).toMatchObject({ handoverId: 55, status: 'collected' });
    const update = mockDB.queries.find((query) => query.sql.includes('UPDATE billing_handovers'));
    expect(update?.params).toContain(55);
    expect(update?.sql).toMatch(/due_amount\s*=\s*0/i);
    const drawerMovement = mockDB.queries.find(isHandoverDrawerMovementInsert);
    expect(drawerMovement?.params).toContain(1800);
    const postingEvent = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert or ignore into accounting_posting_events'));
    expect(postingEvent?.params).toContain('cash_handover');
  });

  it('builds admin collection summary from actual handover drawer movements', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'accountant',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from cash_drawer_movements')) {
          return { first: { total: 1200 } };
        }
        if (normalized.includes('from billing_handovers') && normalized.includes('count(*)')) {
          return { first: { count: 1, total: 600 } };
        }
        if (normalized.includes('from billing_counter_sessions')) {
          return { results: [{ counter_name: 'Main Billing Counter', counter_code: 'BILL-1', session_count: 1, total_collected: 1800 }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/admin/collection-summary?date=2026-05-12');

    expect(res.status).toBe(200);
    const body = await res.json() as { todayCollection: number; pendingAmount: number };
    expect(body.todayCollection).toBe(1200);
    expect(body.pendingAmount).toBe(600);
    const collectionSql = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from cash_drawer_movements'))?.sql ?? '';
    expect(collectionSql).toContain("movement_type = 'handover'");
    expect(collectionSql).not.toContain('FROM billing_handovers');
  });

  it('records drawer movement and accounting event when admin collects remaining partial handover', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          id: 57,
          tenant_id: TENANT_1.id,
          handover_type: 'counter',
          handover_amount: 1800,
          due_amount: 600,
          status: 'partial',
          counter_session_id: ACTIVE_SESSION.id,
          counter_id: COUNTER.id,
          handover_by: ACTIVE_SESSION.employee_id,
          handover_to: 2,
        }],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/admin/collect/57', { method: 'POST' });

    expect(res.status).toBe(200);
    const drawerMovement = mockDB.queries.find(isHandoverDrawerMovementInsert);
    expect(drawerMovement?.params).toContain(600);
    const postingEvent = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert or ignore into accounting_posting_events'));
    expect(postingEvent?.params).toContain('cash_handover');
    expect(postingEvent?.params).toContain('cash_handover');
  });

  it('stores remaining balance for partial admin cash collection', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          id: 56,
          tenant_id: TENANT_1.id,
          handover_type: 'counter',
          handover_amount: 1800,
          due_amount: 1800,
          status: 'pending',
          counter_session_id: ACTIVE_SESSION.id,
          counter_id: COUNTER.id,
          handover_by: ACTIVE_SESSION.employee_id,
          handover_to: 2,
        }],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/admin/partial-collect/56', {
      method: 'POST',
      body: { collectedAmount: 1000, remarks: 'Owner collected partial cash' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; remainingAmount: number };
    expect(body).toMatchObject({ status: 'partial', remainingAmount: 800 });
    const update = mockDB.queries.find((query) => query.sql.includes('UPDATE billing_handovers'));
    expect(update?.params).toContain(800);
    const audit = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into audit_logs')
      && query.params.includes('billing_handovers')
      && query.params.includes(56)
    );
    expect(audit).toBeDefined();
    const drawerMovement = mockDB.queries.find(isHandoverDrawerMovementInsert);
    expect(drawerMovement?.params).toContain(1000);
    const postingEvent = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert or ignore into accounting_posting_events'));
    expect(postingEvent?.params).toContain('cash_handover');
  });

  it('creates a paid invoice from server-priced service items and records payment ledger', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [{ tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, transaction_type: 'deposit', amount: 500, is_active: 1 }],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: 501, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { total: number; status: string; billId: number };
    expect(body.total).toBe(500);
    expect(body.status).toBe('paid');
    expect(body.billId).toBeDefined();

    const catalogLookup = mockDB.queries.find((q) => q.sql.toLowerCase().includes('from billing_service_items si'));
    expect(catalogLookup?.sql.toLowerCase()).not.toContain('ltc.tenant_id = si.tenant_id');
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into "bills"') || q.sql.toLowerCase().includes('insert into bills'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into "invoice_items"') || q.sql.toLowerCase().includes('insert into invoice_items'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into payments'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into emp_cash_transactions'))).toBe(true);
    const ledgerAttempt = mockDB.queries.find((q) => q.sql.includes('cash_ledger_entries'));
    expect(ledgerAttempt).toBeTruthy();
  });

  it('stores uncategorized service items as the database-safe other category', async () => {
    const generalServiceItem = {
      ...SERVICE_ITEM,
      id: 502,
      item_name: 'Dressing Charge',
      item_code: 'GEN-DRESS',
      service_department_id: 12,
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [generalServiceItem],
        billing_deposits: [],
        billing_service_departments: [{ id: 12, tenant_id: TENANT_1.id, department_name: 'General Services', is_active: 1 }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: generalServiceItem.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const invoiceItemInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into invoice_items'));
    expect(invoiceItemInsert?.params).toContain('other');
    expect(invoiceItemInsert?.params).not.toContain('service');
  });

  it('rejects billing-counter scheme discounts that exceed the eligible cap', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from billing_schemes') && normalized.includes('where tenant_id = ? and id = ?')) {
          return { first: {
            id: 42,
            scheme_name: 'Staff Benefit',
            scheme_code: 'STAFF10',
            scheme_type: 'staff',
            default_discount_percent: 10,
            default_price_category_id: null,
            default_discount_source: 'staff_benefit_discount',
            valid_from: '2020-01-01',
            valid_to: '2099-12-31',
            max_discount_amount_per_bill: 0,
            max_discount_amount_per_month: 0,
            max_discount_amount_per_year: 0,
            approval_required_over_percent: 0,
            requires_reference: 0,
            is_auto_apply: 0,
            is_active: 1,
          } };
        }
        if (normalized.includes('count(1) as count') && normalized.includes('from billing_scheme_members')) {
          return { first: { count: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        schemeApplication: { schemeId: 42 },
        discountByName: 'Manager',
        items: [{ serviceItemId: 501, quantity: 1, discountAmount: 100 }],
        payment: { paymentMethod: 'cash', paidAmount: 400 },
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string; message?: string };
    expect(body.error ?? body.message).toMatch(/scheme discount exceeds/i);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into bills'))).toBe(false);
  });

  it('records billing scheme usage when an eligible billing-counter benefit is applied', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('from billing_schemes') && normalized.includes('where tenant_id = ? and id = ?')) {
          return { first: {
            id: 42,
            scheme_name: 'Staff Benefit',
            scheme_code: 'STAFF10',
            scheme_type: 'staff',
            default_discount_percent: 10,
            default_price_category_id: null,
            default_discount_source: 'staff_benefit_discount',
            valid_from: '2020-01-01',
            valid_to: '2099-12-31',
            max_discount_amount_per_bill: 0,
            max_discount_amount_per_month: 0,
            max_discount_amount_per_year: 0,
            approval_required_over_percent: 0,
            requires_reference: 0,
            is_auto_apply: 0,
            is_active: 1,
          } };
        }
        if (normalized.includes('count(1) as count') && normalized.includes('from billing_scheme_members')) {
          return { first: { count: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        schemeApplication: { schemeId: 42 },
        discountByName: 'Manager',
        items: [{ serviceItemId: 501, quantity: 1, discountAmount: 50 }],
        payment: { paymentMethod: 'cash', paidAmount: 450 },
      },
    });

    expect(res.status).toBe(201);
    const usageInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('billing_scheme_usage'));
    expect(usageInsert).toBeDefined();
    expect(usageInsert?.params).toContain(42);
    expect(usageInsert?.params).toContain(PATIENT_1.id);
    expect(usageInsert?.params).toContain(50);
    const allocationInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into bill_discount_allocations'));
    expect(allocationInsert?.params).toContain('staff_benefit_discount');
  });
  it('does not write a bill header before the invoice payment batch succeeds', async () => {
    const mockDB = createMockDB({
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [{ tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, transaction_type: 'deposit', amount: 500, is_active: 1 }],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
    });
    let invoiceBatchAttempts = 0;
    (mockDB.db as unknown as { batch: D1Database['batch'] }).batch = async () => {
      invoiceBatchAttempts += 1;
      throw new Error('simulated invoice batch failure');
    };

    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(500);
    expect(invoiceBatchAttempts).toBe(1);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into "bills"') || q.sql.toLowerCase().includes('insert into bills'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into payments'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into emp_cash_transactions'))).toBe(false);
  });

  it('records diagnostic prescriber commission without treating service item id as a lab catalog id', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        doctors: [DOCTOR],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', department_code: 'LAB', is_active: 1 }],
        accounting_period_closes: [],
        doctor_commission_rules: [{
          id: 77,
          tenant_id: TENANT_1.id,
          doctor_id: DOCTOR.id,
          service_type: 'lab_test',
          incentive_type: 'prescriber',
          lab_test_id: null,
          category: 'test',
          rate_type: 'percent',
          rate_value: 2000,
          is_active: 1,
          effective_from: '2025-01-01',
        }],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_service_items si') && normalized.includes('as lab_test_id')) {
          return {
            results: [{
              ...SERVICE_ITEM,
              department_name: 'Laboratory',
              category_price: null,
              lab_test_id: null,
            }],
          };
        }
        if (normalized.includes('with source_items as') && normalized.includes('diagnostic_kind')) {
          return {
            results: [{
              patient_id: PATIENT_1.id,
              visit_id: 1001,
              bill_discount: 0,
              invoice_item_id: 1,
              item_category: 'test',
              description: SERVICE_ITEM.item_name,
              quantity: 1,
              line_total: SERVICE_ITEM.price,
              gross_service_amount: SERVICE_ITEM.price,
              tax_amount: 0,
              reference_id: SERVICE_ITEM.id,
              billing_service_item_id: SERVICE_ITEM.id,
              lab_test_id: null,
              radiology_imaging_item_id: null,
              test_code: SERVICE_ITEM.item_code,
              test_name: SERVICE_ITEM.item_name,
              diagnostic_kind: 'lab',
            }],
          };
        }
        if (normalized.includes('select name,specialty,department,bmdc_reg_no,is_active,user_id') && normalized.includes('from doctors')) {
          return {
            first: {
              name: DOCTOR.name,
              specialty: DOCTOR.specialty,
              department: null,
              bmdc_reg_no: null,
              is_active: DOCTOR.is_active,
              user_id: null,
            },
          };
        }
        if (normalized.includes('from doctor_commission_rules')) {
          return {
            first: {
              id: 77,
              doctor_id: DOCTOR.id,
              service_type: 'lab_test',
              incentive_type: 'prescriber',
              lab_test_id: null,
              category: 'test',
              rate_type: 'percent',
              rate_value: 2000,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        referringDoctorId: DOCTOR.id,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const findDiagnosticAccrual = () => mockDB.queries.find((q) =>
      q.sql.toLowerCase().includes('doctor_commission_accruals')
      && q.params.includes('lab_test')
      && q.params.includes('prescriber')
    );
    await expect.poll(findDiagnosticAccrual).toBeDefined();
    const diagnosticAccrual = findDiagnosticAccrual();
    expect(diagnosticAccrual?.params[1]).toBe(DOCTOR.id);
    expect(diagnosticAccrual?.params[5]).toBeNull();
    expect(diagnosticAccrual?.params).toContain(100);
  });

  it('lists unbilled prescription lab order items for reception selection', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from lab_orders lo') && normalized.includes('pending_item_count')) {
          return {
            results: [{
              order_id: 44,
              order_no: 'LO-000044',
              prescription_id: 9,
              rx_no: 'RX-000009',
              patient_id: PATIENT_1.id,
              patient_name: PATIENT_1.name,
              patient_code: PATIENT_1.patient_code,
              patient_mobile: PATIENT_1.mobile,
              doctor_id: DOCTOR.id,
              doctor_name: DOCTOR.name,
              order_date: '2026-06-08',
              pending_item_count: 2,
              pending_amount: 800,
              pending_items: '10::CBC::500||11::Urine R/E::300',
            }],
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/pending-lab-orders?limit=10');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ orderId: number; items: Array<{ id: number; testName: string; lineTotal: number }> }> };
    expect(body.data[0].orderId).toBe(44);
    expect(body.data[0].items).toEqual([
      { id: 10, testName: 'CBC', lineTotal: 500 },
      { id: 11, testName: 'Urine R/E', lineTotal: 300 },
    ]);
  });

  it('creates a bill only for selected pending prescription lab order items', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        doctors: [DOCTOR],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_deposits: [],
        accounting_period_closes: [],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from lab_orders lo') && normalized.includes('where lo.id =')) {
          return {
            first: {
              id: 44,
              order_no: 'LO-000044',
              patient_id: PATIENT_1.id,
              visit_id: 700,
              prescription_id: 9,
              doctor_id: DOCTOR.id,
            },
          };
        }
        if (normalized.includes('from lab_order_items loi') && normalized.includes('loi.id in')) {
          return {
            results: [
              { id: 10, lab_order_id: 44, lab_test_id: 1, test_name: 'CBC', unit_price: 500, discount: 0, line_total: 500, billing_service_item_id: 501 },
              { id: 11, lab_order_id: 44, lab_test_id: 2, test_name: 'Urine R/E', unit_price: 300, discount: 0, line_total: 300, billing_service_item_id: 502 },
            ],
          };
        }
        if (normalized.includes('from doctor_commission_rules')) {
          return {
            first: {
              id: 77,
              doctor_id: DOCTOR.id,
              service_type: 'lab_test',
              incentive_type: 'prescriber',
              lab_test_id: null,
              category: 'test',
              rate_type: 'percent',
              rate_value: 2000,
            },
          };
        }
        if (normalized.includes('select id') && normalized.includes('from bills') && normalized.includes('invoice_no')) {
          return { first: { id: 1200 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/lab-orders/44/bill', {
      method: 'POST',
      body: {
        itemIds: [10, 11],
        billMode: 'paid',
        payment: { paymentMethod: 'cash', paidAmount: 800 },
      },
    });

    expect(res.status).toBe(201);
    const invoiceInserts = mockDB.queries.filter((q) => q.sql.toLowerCase().includes('insert into invoice_items'));
    expect(invoiceInserts).toHaveLength(2);
    expect(invoiceInserts.flatMap((q) => q.params)).toContain(10);
    expect(invoiceInserts.flatMap((q) => q.params)).toContain(11);
    expect(invoiceInserts.flatMap((q) => q.params)).not.toContain(12);

    const visitServiceInserts = mockDB.queries.filter((q) => q.sql.toLowerCase().includes('insert into visit_services'));
    expect(visitServiceInserts).toHaveLength(2);
    expect(visitServiceInserts.every((q) => q.sql.includes("'lab_order_item'"))).toBe(true);

    const diagnosticAccrual = mockDB.queries.find((q) =>
      q.sql.toLowerCase().includes('doctor_commission_accruals')
      && q.params.includes('lab_test')
      && q.params.includes('prescriber')
    );
    expect(diagnosticAccrual).toBeDefined();
    expect(diagnosticAccrual?.params[1]).toBe(DOCTOR.id);
  });

  it('normalizes zero-settlement pending lab-order billing to credit', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        doctors: [DOCTOR],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_deposits: [],
        accounting_period_closes: [],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from lab_orders lo') && normalized.includes('where lo.id =')) {
          return {
            first: {
              id: 45,
              order_no: 'LO-000045',
              patient_id: PATIENT_1.id,
              visit_id: 701,
              prescription_id: 10,
              doctor_id: DOCTOR.id,
            },
          };
        }
        if (normalized.includes('from lab_order_items loi') && normalized.includes('loi.id in')) {
          return {
            results: [
              { id: 13, lab_order_id: 45, lab_test_id: 1, test_name: 'CBC', unit_price: 500, discount: 0, line_total: 500, billing_service_item_id: 501 },
            ],
          };
        }
        if (normalized.includes('select id') && normalized.includes('from bills') && normalized.includes('invoice_no')) {
          return { first: { id: 1201 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/lab-orders/45/bill', {
      method: 'POST',
      body: {
        itemIds: [13],
        billMode: 'paid',
        payment: { paymentMethod: 'cash', paidAmount: 0 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      requestedMode?: string;
      mode?: string;
      modeAdjusted?: boolean;
      modeAdjustmentReason?: string | null;
      paidAmount?: number;
      dueAmount?: number;
      status?: string;
    };
    expect(body).toMatchObject({
      requestedMode: 'paid',
      mode: 'credit',
      modeAdjusted: true,
      modeAdjustmentReason: 'zero_settlement_normalized_to_credit',
      paidAmount: 0,
      dueAmount: 500,
      status: 'open',
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into payments'))).toBe(false);
    const labStatusUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update lab_orders') && q.sql.toLowerCase().includes('billing_status'));
    expect(labStatusUpdate?.params).toContain(500);
  });

  it('creates a lab order from a billing-counter lab test invoice and surfaces reagent exception warnings', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        visits: [{ id: 700, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, doctor_id: DOCTOR.id }],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_deposits: [],
        accounting_period_closes: [],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_service_items si') && normalized.includes('lab_test_id')) {
          return {
            results: [{
              ...SERVICE_ITEM,
              department_name: 'Laboratory',
              lab_test_id: 1,
            }],
          };
        }
        if (normalized.includes('from bills') && normalized.includes('invoice_no')) {
          return { first: { id: 1200 } };
        }
        if (normalized.includes('from lab_inventory_policy')) {
          return {
            first: {
              lab_inventory_mode: 'strict',
              reagent_consumption_timing: 'billing',
              allow_result_without_stock: 1,
              require_test_mapping_for_completion: 1,
            },
          };
        }
        if (normalized.includes('from lab_consumable_movements')) {
          return { first: null, results: [] };
        }
        if (normalized.includes('from lab_test_consumable_map')) {
          return { results: [] };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        visitId: 700,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1, discountAmount: 0, discountPercent: 0 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { labOrderId?: number; labOrderItemCount?: number; reagentUsageWarnings?: Array<{ itemId: number; message: string }> };
    expect(Number(body.labOrderId)).toBeGreaterThan(0);
    expect(body.labOrderItemCount).toBe(1);
    expect(body.reagentUsageWarnings?.[0]?.message).toMatch(/No lab reagent mapping configured/);

    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into lab_orders'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into lab_order_items'))).toBe(true);
    expect(mockDB.queries.some((q) => {
      const sql = q.sql.toLowerCase();
      return sql.includes('insert') && sql.includes('lab_inventory_exceptions');
    })).toBe(true);
  });

  it('normalizes zero-settlement paid diagnostic invoices to credit and still creates an unpaid lab order', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        visits: [{ id: 702, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, doctor_id: DOCTOR.id }],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_deposits: [],
        accounting_period_closes: [],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_service_items si') && normalized.includes('lab_test_id')) {
          return {
            results: [{
              ...SERVICE_ITEM,
              department_name: 'Laboratory',
              lab_test_id: 1,
            }],
          };
        }
        if (normalized.includes('from bills') && normalized.includes('invoice_no')) {
          return { first: { id: 1202 } };
        }
        if (normalized.includes('from lab_inventory_policy')) {
          return {
            first: {
              lab_inventory_mode: 'manual',
              reagent_consumption_timing: 'result',
              allow_result_without_stock: 1,
              require_test_mapping_for_completion: 0,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        visitId: 702,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 0, depositDeducted: 0 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      requestedMode?: string;
      mode: string;
      modeAdjusted?: boolean;
      modeAdjustmentReason?: string | null;
      paidAmount: number;
      depositDeducted: number;
      dueAmount: number;
      status: string;
      labOrderId?: number | null;
    };
    expect(body).toMatchObject({
      requestedMode: 'paid',
      mode: 'credit',
      modeAdjusted: true,
      modeAdjustmentReason: 'zero_settlement_normalized_to_credit',
      paidAmount: 0,
      depositDeducted: 0,
      dueAmount: 500,
      status: 'open',
    });
    expect(Number(body.labOrderId)).toBeGreaterThan(0);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into payments'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into emp_cash_transactions'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_deposits'))).toBe(false);
    const labStatusUpdate = mockDB.queries.find((q) => q.sql.toLowerCase().includes('update lab_orders') && q.sql.toLowerCase().includes('billing_status'));
    expect(labStatusUpdate?.params).toContain('unpaid');
  });

  it('ignores stale cash and deposit settlement fields on explicit credit invoices', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [{ tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, transaction_type: 'deposit', amount: 500, is_active: 1 }],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'credit',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 200, depositDeducted: 300 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      requestedMode?: string;
      mode: string;
      modeAdjusted?: boolean;
      modeAdjustmentReason?: string | null;
      paidAmount: number;
      depositDeducted: number;
      dueAmount: number;
      status: string;
    };
    expect(body).toMatchObject({
      requestedMode: 'credit',
      mode: 'credit',
      modeAdjusted: true,
      modeAdjustmentReason: 'credit_settlement_ignored',
      paidAmount: 0,
      depositDeducted: 0,
      dueAmount: 500,
      status: 'open',
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into payments'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into emp_cash_transactions'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into billing_deposits'))).toBe(false);
  });

  it('keeps a fully discounted zero-net invoice settled without creating a payment row', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        discountByName: 'Management approval',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1, discountAmount: 500 }],
        payment: { paymentMethod: 'cash', paidAmount: 0, depositDeducted: 0 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      requestedMode?: string;
      mode: string;
      modeAdjusted?: boolean;
      paidAmount: number;
      depositDeducted: number;
      dueAmount: number;
      status: string;
      total: number;
    };
    expect(body).toMatchObject({
      requestedMode: 'paid',
      mode: 'paid',
      modeAdjusted: false,
      paidAmount: 0,
      depositDeducted: 0,
      dueAmount: 0,
      status: 'paid',
      total: 0,
    });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into payments'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into emp_cash_transactions'))).toBe(false);
  });

  it('rounds a fully paid multi-line invoice to zero due and paid status', async () => {
    const pricedItems = [
      { ...SERVICE_ITEM, id: 601, item_name: 'CBC & Platelet Count', item_code: 'LAB-CBC-400', price: 400 },
      { ...SERVICE_ITEM, id: 602, item_name: 'Ultrasonography Of Whole Abdomen', item_code: 'RAD-USG-800', price: 800 },
      { ...SERVICE_ITEM, id: 603, item_name: 'Urine RE/ME', item_code: 'LAB-URINE-200', price: 200 },
    ];
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: pricedItems,
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_service_items si') && normalized.includes('lab_test_id')) {
          return {
            results: pricedItems.map((item, index) => ({
              ...item,
              department_name: 'Laboratory',
              lab_test_id: index + 1,
            })),
          };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        discountByName: 'Management approval',
        items: [
          { serviceItemId: 601, quantity: 1, discountAmount: 57.14 },
          { serviceItemId: 602, quantity: 1, discountAmount: 114.29 },
          { serviceItemId: 603, quantity: 1, discountAmount: 28.57 },
        ],
        payment: { paymentMethod: 'cash', paidAmount: 1200 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      subtotal: number;
      discount: number;
      total: number;
      paidAmount: number;
      dueAmount: number;
      status: string;
    };
    expect(body).toMatchObject({
      subtotal: 1400,
      discount: 200,
      total: 1200,
      paidAmount: 1200,
      dueAmount: 0,
      status: 'paid',
    });

    const billInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into bills'));
    expect(billInsert?.params).toEqual(expect.arrayContaining([1200, 1200, 0, 'paid']));
    const labStatusUpdate = mockDB.queries.find((query) => query.sql.toLowerCase().includes('update lab_orders') && query.sql.toLowerCase().includes('billing_status'));
    expect(labStatusUpdate?.params).toContain('paid');
  });

  it('does not create reagent exceptions for radiology billing items without a lab-test mapping', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        visits: [{ id: 701, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, doctor_id: DOCTOR.id }],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_deposits: [],
        accounting_period_closes: [],
      },
      queryOverride: (sql) => {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_service_items si') && normalized.includes('lab_test_id')) {
          return {
            results: [{
              ...SERVICE_ITEM,
              id: 777,
              item_name: 'USG Whole Abdomen',
              department_name: 'Radiology',
              lab_test_id: null,
            }],
          };
        }
        if (normalized.includes('from bills') && normalized.includes('invoice_no')) {
          return { first: { id: 1201 } };
        }
        return null;
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        visitId: 701,
        billMode: 'paid',
        items: [{ serviceItemId: 777, quantity: 1, discountAmount: 0, discountPercent: 0 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { labOrderId?: number | null; labOrderItemCount?: number; reagentUsageWarnings?: Array<{ itemId: number; message: string }> };
    expect(body.labOrderId).toBeNull();
    expect(body.labOrderItemCount).toBe(0);
    expect(body.reagentUsageWarnings).toEqual([]);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into lab_orders'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into lab_inventory_exceptions'))).toBe(false);
  });

  it('creates a doctor consultation bill from doctor fee and records accounting events', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        doctors: [DOCTOR],
        visits: [],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ doctorId: DOCTOR.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { total: number; status: string };
    expect(body.total).toBe(500);
    expect(body.status).toBe('paid');

    const queries = mockDB.queries.map((q) => q.sql.toLowerCase());
    expect(queries.some((sql) => sql.includes('from doctors'))).toBe(true);
    expect(queries.some((sql) => sql.includes('insert into visits') && sql.includes('doctor_id'))).toBe(true);
    expect(queries.some((sql) => sql.includes('insert into invoice_items'))).toBe(true);
    expect(queries.some((sql) => sql.includes('doctor_visit'))).toBe(true);
    expect(queries.some((sql) => sql.includes('insert or ignore into accounting_posting_events'))).toBe(true);
  });

  it('records deposit deductions with the adjustment source type', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [{ tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, transaction_type: 'deposit', amount: 500, is_active: 1 }],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 0, depositDeducted: 500 },
      },
    });

    expect(res.status).toBe(201);
    const depositAdjustment = mockDB.queries.find((q) =>
      q.sql.includes('INSERT INTO billing_deposits')
      && q.sql.includes('counter_id')
      && q.sql.includes('counter_session_id')
      && q.params.includes(COUNTER.id)
      && q.params.includes(ACTIVE_SESSION.id)
    );
    expect(depositAdjustment).toBeDefined();
    expect(mockDB.queries.some((q) =>
      q.sql.includes('INSERT OR IGNORE INTO accounting_posting_events')
      && q.params[2] === 'patient_deposit_adjustment'
      && q.params.includes('patient_deposit_adjusted')
    )).toBe(true);
  });

  it('rejects deposit deductions above the patient advance balance', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 0, depositDeducted: 500 },
      },
    });

    expect(res.status).toBe(400);
  });

  it('rejects client attempts to send arbitrary item prices', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: { patients: [PATIENT_1], billing_service_items: [SERVICE_ITEM] },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        billMode: 'paid',
        items: [{ serviceItemId: 501, quantity: 1, unitPrice: 5 }],
        payment: { paymentMethod: 'cash', paidAmount: 5 },
      },
    });

    expect(res.status).toBe(400);
  });

  it('allows billing-counter line discounts from reception for fast counter billing', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        visits: [],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        discountByName: 'Manager',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1, discountAmount: 50 }],
        payment: { paymentMethod: 'cash', paidAmount: 450 },
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into "bills"') || q.sql.toLowerCase().includes('insert into bills'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('billing_scheme_usage'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('from billing_schemes'))).toBe(false);
  });

  it('hydrates performer reserve, preserves the protected floor, and funds excess doctor waiver as hospital discount', async () => {
    const diagnosticItem = { ...SERVICE_ITEM, price: 800 };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [diagnosticItem],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
        visits: [],
      },
      universalFallback: true,
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from diagnostic_performer_payout_rules')) {
          return {
            results: [{
              id: 701,
              billing_service_item_id: diagnosticItem.id,
              diagnostic_kind: 'lab',
              rate_type: 'flat',
              rate_value: 200,
              effective_from: '2026-01-01',
              effective_to: null,
              is_active: 1,
              created_at: '2026-01-01 00:00:00',
              updated_at: '2026-01-01 00:00:00',
            }],
          };
        }
        if (lower.includes('from doctor_commission_rules')) {
          return {
            results: [{
              id: 801,
              doctor_id: DOCTOR.id,
              service_type: 'lab_test',
              incentive_type: 'prescriber',
              category: null,
              lab_test_id: null,
              rate_type: 'percent',
              rate_value: 2500,
              waiver_policy: 'protected_floor',
              protected_rate_bps: 500,
              protected_flat_amount: 0,
              is_active: 1,
            }],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        referringDoctorId: DOCTOR.id,
        discountByName: 'Doctor waiver',
        discountSourceIntent: 'doctor_commission_waiver',
        items: [{ serviceItemId: diagnosticItem.id, quantity: 1, discountAmount: 300 }],
        discountAllocations: [{ reason: 'doctor_commission_waiver', amount: 300 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(201);
    const allocationInserts = mockDB.queries.filter((query) => query.sql.toLowerCase().includes('insert into bill_discount_allocations'));
    expect(allocationInserts).toHaveLength(2);
    expect(allocationInserts[0].params).toEqual(expect.arrayContaining([
      'doctor_commission_waiver',
      'doctor_commission_waiver',
      DOCTOR.id,
      60,
    ]));
    expect(allocationInserts[1].params).toEqual(expect.arrayContaining([
      'hospital_discount',
      'normal_hospital_discount',
      240,
    ]));
  });

  it('rejects doctor-waiver intent and leaves its idempotency key retryable', async () => {
    const diagnosticItem = { ...SERVICE_ITEM, price: 800 };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [diagnosticItem],
        visits: [],
      },
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM billing_invoice_idempotency_keys')) return { first: null };
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        idempotencyKey: 'doctor-waiver-rule-retry-001',
        billMode: 'paid',
        referringDoctorId: DOCTOR.id,
        discountByName: 'Doctor waiver',
        discountSourceIntent: 'doctor_commission_waiver',
        items: [{ serviceItemId: diagnosticItem.id, quantity: 1, discountAmount: 50 }],
        discountAllocations: [{ reason: 'management_approved', amount: 50 }],
        payment: { paymentMethod: 'cash', paidAmount: 750 },
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string; message?: string };
    expect(String(body.message ?? body.error ?? '')).toMatch(/doctor waiver.*allocation/i);
    expect(mockDB.queries.some((query) => (
      query.sql.toLowerCase().includes('insert into billing_invoice_idempotency_keys')
      && query.params.includes('doctor-waiver-rule-retry-001')
    ))).toBe(true);
    expect(mockDB.queries.some((query) => (
      query.sql.toLowerCase().includes('update billing_invoice_idempotency_keys')
      && query.sql.toLowerCase().includes("status = 'failed'")
      && query.params.includes('doctor-waiver-rule-retry-001')
    ))).toBe(true);
  });

  it('requires a referral name when the effective invoice discount is above 20 percent', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        visits: [],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1, discountPercent: 25 }],
        payment: { paymentMethod: 'cash', paidAmount: 375 },
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string; message?: string };
    expect(String(body.message ?? body.error ?? '')).toMatch(/discount referred by/i);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bills'))).toBe(false);
  });

  it('stores the referral name when an above-threshold discount is approved by name', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        visits: [],
      },
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        billMode: 'paid',
        discountByName: 'Director Approval',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1, discountPercent: 25 }],
        payment: { paymentMethod: 'cash', paidAmount: 375 },
      },
    });

    expect(res.status).toBe(201);
    const billInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into bills'));
    expect(billInsert?.params).toContain('Director Approval');
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('billing_scheme_usage'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('from billing_schemes'))).toBe(false);
  });

  it('returns the original invoice response when an idempotency key is retried', async () => {
    const responseJson = {
      message: 'Billing counter invoice created',
      billId: 77,
      invoiceNo: 'INV-77',
      mode: 'paid',
      subtotal: 500,
      discount: 0,
      taxTotal: 0,
      total: 500,
      paidAmount: 500,
      depositDeducted: 0,
      dueAmount: 0,
      status: 'paid',
    };
    const body = {
      patientId: PATIENT_1.id,
      createWalkInVisit: true,
      idempotencyKey: 'retry-key-001',
      billMode: 'paid',
      items: [{ serviceItemId: 501, quantity: 1, discountAmount: 0 }],
      payment: { paymentMethod: 'cash', paidAmount: 500, depositDeducted: 0, creditAmount: 0 },
    };

    const hash = await requestHash(body);
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM billing_invoice_idempotency_keys')) {
          return {
            first: {
              request_hash: hash,
              status: 'completed',
              response_json: JSON.stringify(responseJson),
            },
          };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', { method: 'POST', body });

    expect(res.status).toBe(201);
    const json = await res.json() as { invoiceNo: string; idempotent: boolean };
    expect(json.invoiceNo).toBe('INV-77');
    expect(json.idempotent).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into "bills"') || q.sql.toLowerCase().includes('insert into bills'))).toBe(false);
  });

  it('allows retrying a failed invoice idempotency key with the same payload', async () => {
    const body = {
      patientId: PATIENT_1.id,
      createWalkInVisit: true,
      idempotencyKey: 'retry-failed-key-001',
      billMode: 'paid',
      items: [{ serviceItemId: 501, quantity: 1, discountAmount: 0 }],
      payment: { paymentMethod: 'cash', paidAmount: 500, depositDeducted: 0, creditAmount: 0 },
    };
    const hash = await requestHash(body);
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM billing_invoice_idempotency_keys')) {
          return {
            first: {
              request_hash: hash,
              status: 'failed',
              response_json: null,
              bill_id: null,
              invoice_no: null,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', { method: 'POST', body });

    expect(res.status).toBe(201);
    const retryReset = mockDB.queries.find((q) => (
      q.sql.toLowerCase().includes('delete from billing_invoice_idempotency_keys')
      && q.params.includes('retry-failed-key-001')
    ));
    expect(retryReset).toBeDefined();
  });

  it('allows retrying a failed invoice idempotency key after correcting the payload', async () => {
    const body = {
      patientId: PATIENT_1.id,
      createWalkInVisit: true,
      idempotencyKey: 'retry-failed-corrected-key-001',
      billMode: 'paid',
      discountByName: 'Management Approval',
      items: [{ serviceItemId: 501, quantity: 1, discountAmount: 100 }],
      payment: { paymentMethod: 'cash', paidAmount: 400, depositDeducted: 0, creditAmount: 0 },
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM billing_invoice_idempotency_keys')) {
          return {
            first: {
              request_hash: 'hash-from-invalid-first-submission',
              status: 'failed',
              response_json: null,
              bill_id: null,
              invoice_no: null,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', { method: 'POST', body });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => (
      q.sql.toLowerCase().includes('delete from billing_invoice_idempotency_keys')
      && q.params.includes('retry-failed-corrected-key-001')
    ))).toBe(true);
  });

  it('marks a reserved invoice idempotency key failed when invoice creation errors', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        patients: [PATIENT_1],
        billing_counter_sessions: [ACTIVE_SESSION],
        billing_counters: [COUNTER],
        billing_service_items: [SERVICE_ITEM],
        billing_deposits: [],
        billing_service_departments: [{ id: 11, tenant_id: TENANT_1.id, department_name: 'Laboratory', is_active: 1 }],
      },
      batchError: new Error('simulated invoice write failure'),
      queryOverride: (sql) => {
        if (sql.includes('FROM billing_invoice_idempotency_keys')) {
          return { first: null };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      mockDB,
    });

    const res = await jsonRequest(app, '/billing-counter/invoices', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        createWalkInVisit: true,
        idempotencyKey: 'retry-key-fails-001',
        billMode: 'paid',
        items: [{ serviceItemId: SERVICE_ITEM.id, quantity: 1 }],
        payment: { paymentMethod: 'cash', paidAmount: 500 },
      },
    });

    expect(res.status).toBe(500);
    const failedUpdate = mockDB.queries.find((q) => (
      q.sql.toLowerCase().includes('update billing_invoice_idempotency_keys')
      && q.sql.toLowerCase().includes("status = 'failed'")
    ));
    expect(failedUpdate?.params).toEqual(expect.arrayContaining([TENANT_1.id, 'retry-key-fails-001']));
  });

  // ─── Cash withdrawal ─────────────────────────────────────────────────────────

  it('records a cash withdrawal from the active counter session', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('heartbeat_at is null')) {
          return { first: null };
        }
        if (normalized.includes('ect.counter_session_id = s.id')) {
          return {
            first: {
              opening_cash: 100, cash_in: 500, cash_out: 0,
              manual_cash_in: 0, manual_cash_out: 0,
              appointment_cash: 300, test_cash: 200, total_discount: 0,
              free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/cash-movement', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { amount: 200, movementType: 'cash_out', reason: 'Cash collected by MD' },
    });

    expect(res.status).toBe(200);
    const movementInsert = mockDB.queries.find((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'));
    expect(movementInsert).toBeDefined();
    expect(movementInsert?.params).toContain(ACTIVE_SESSION.id);
    expect(movementInsert?.params).toContain('cash_out');
    expect(movementInsert?.params).toContain(200);
    expect(movementInsert?.params).toContain('Cash collected by MD');
  });

  it('allows cash movement after the same user session is rebound to a restarted workstation', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [{
          ...ACTIVE_SESSION,
          workstation_id: 'hms-ws-main',
          heartbeat_at: '2026-05-12 10:00:00',
        }],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('heartbeat_at is null')) {
          return { first: null };
        }
        if (normalized.includes('ect.counter_session_id = s.id')) {
          return {
            first: {
              opening_cash: 100, cash_in: 500, cash_out: 0,
              manual_cash_in: 0, manual_cash_out: 0,
              appointment_cash: 300, test_cash: 200, total_discount: 0,
              free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/cash-movement', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'hms-ws-other' },
      body: { amount: 200, movementType: 'cash_out', reason: 'Cash collected by MD' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update billing_counter_sessions')
      && q.params.includes('hms-ws-other'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(true);
  });

  it('rejects cash withdrawal when session is not active', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_counter_sessions') && sql.toLowerCase().includes('status = ')) {
          return { first: null };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/cash-movement', {
      method: 'POST',
      body: { amount: 200, movementType: 'cash_out', reason: 'Cash collected by MD' },
    });

    expect(res.status).toBe(404);
  });

  it('rejects cash withdrawal exceeding available cash', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_counter_sessions') && normalized.includes('status = ')) {
          return { first: { id: ACTIVE_SESSION.id, counter_id: COUNTER.id, status: 'active' } };
        }
        if (normalized.includes('from billing_counter_sessions s')) {
          return {
            first: {
              opening_cash: 100, cash_in: 0, cash_out: 0,
              appointment_cash: 0, test_cash: 0, total_discount: 0,
              free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/cash-movement', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { amount: 500, movementType: 'cash_out', reason: 'Cash collected by MD' },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(String(body.message ?? body.error ?? '')).toMatch(/cannot withdraw/i);
  });

  it('rejects cash withdrawal without a valid reason', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: { billing_counter_sessions: [ACTIVE_SESSION] },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/cash-movement', {
      method: 'POST',
      body: { amount: 100, movementType: 'cash_out', reason: 'ab' },
    });

    expect(res.status).toBe(400);
  });

  it('allows cash drop after the same user session is rebound to a restarted workstation', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [{
          ...ACTIVE_SESSION,
          workstation_id: 'hms-ws-main',
          heartbeat_at: '2026-05-12 10:00:00',
        }],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('heartbeat_at is null')) {
          return { first: null };
        }
        if (normalized.includes('ect.counter_session_id = s.id')) {
          return {
            first: {
              opening_cash: 100, cash_in: 500, cash_out: 0,
              manual_cash_in: 0, manual_cash_out: 0,
              appointment_cash: 300, test_cash: 200, total_discount: 0,
              free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/cash-drop', {
      method: 'POST',
      headers: { 'X-HMS-Workstation-ID': 'hms-ws-other' },
      body: { amount: 200, reason: 'Cash deposited to safe' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update billing_counter_sessions')
      && q.params.includes('hms-ws-other'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(true);
  });

  it('creates a pending bank deposit request and moves drawer cash into finance custody', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from bank_deposit_requests') && normalized.includes('idempotency_key')) {
          return { first: null };
        }
        if (normalized.includes('ect.counter_session_id = s.id')) {
          return {
            first: {
              opening_cash: 100,
              cash_in: 500,
              cash_out: 0,
              manual_cash_in: 0,
              manual_cash_out: 0,
              cash_drop_total: 0,
              appointment_cash: 300,
              test_cash: 200,
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

    const res = await jsonRequest(app, '/billing-counter/sessions/17/bank-deposit-requests', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: {
        amount: 250,
        proposedBankName: 'DBBL',
        note: 'Morning collection',
        idempotencyKey: 'deposit-request-0001',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bank_deposit_requests'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements')
      && q.sql.toLowerCase().includes("'cash_drop'"))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('update billing_counter_sessions')
      && q.sql.toLowerCase().includes('cash_drop_total'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('accounting_posting_events')
      && q.params.includes(ACCOUNTING_EVENT_TYPES.bankDepositCustody))).toBe(true);
  });

  it('rejects a bank deposit request that exceeds expected drawer cash', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from bank_deposit_requests') && normalized.includes('idempotency_key')) {
          return { first: null };
        }
        if (normalized.includes('ect.counter_session_id = s.id')) {
          return {
            first: {
              opening_cash: 100,
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

    const res = await jsonRequest(app, '/billing-counter/sessions/17/bank-deposit-requests', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: {
        amount: 500,
        proposedBankName: 'DBBL',
        idempotencyKey: 'deposit-request-0002',
      },
    });

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into bank_deposit_requests'))).toBe(false);
  });

  it('returns the existing bank deposit request for an idempotent retry without another cash drop', async () => {
    const existingRequest = {
      id: 55,
      request_no: 'BDR-000055',
      requested_amount: 250,
      status: 'pending',
      proposed_bank_name: 'DBBL',
      request_note: 'Morning collection',
      created_at: '2026-06-11 10:00:00',
    };
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        billing_counters: [COUNTER],
        billing_counter_sessions: [ACTIVE_SESSION],
      },
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from bank_deposit_requests') && normalized.includes('idempotency_key')) {
          return { first: existingRequest };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/sessions/17/bank-deposit-requests', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: {
        amount: 250,
        proposedBankName: 'DBBL',
        note: 'Morning collection',
        idempotencyKey: 'deposit-request-0001',
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ request: { id: 55, requestNo: 'BDR-000055', status: 'pending' } });
    expect(mockDB.queries.some((q) => q.sql.toLowerCase().includes('insert into cash_drawer_movements'))).toBe(false);
  });

  it('adds received counter transfer cash into the receiver active drawer', async () => {
    const receiverSession = {
      ...ACTIVE_SESSION,
      id: 44,
      employee_id: HANDOVER_RECIPIENT.id,
      counter_id: 8,
      counter_name: 'Second Billing Counter',
      counter_code: 'BILL-2',
    };
    const { app, mockDB } = createTestApp({
      route: paymentMethodsRoutes,
      routePath: '/payment-methods',
      role: 'accountant',
      userId: HANDOVER_RECIPIENT.id,
      tenantId: TENANT_1.id,
      tables: {
        billing_counter_cash_transfers: [{
          id: 99,
          tenant_id: TENANT_1.id,
          counter_session_id: ACTIVE_SESSION.id,
          counter_id: ACTIVE_SESSION.counter_id,
          transfer_no: 'CCT-17-demo',
          transfer_by: ACTIVE_SESSION.employee_id,
          transfer_to: HANDOVER_RECIPIENT.id,
          amount: 700,
          due_amount: 700,
          status: 'pending',
        }],
        billing_counter_sessions: [receiverSession],
        accounting_fiscal_years: [],
        accounting_period_closes: [],
        cash_drawer_movements: [],
      },
    });

    const res = await jsonRequest(app, '/payment-methods/drawer-custody/transfers/99/receive', {
      method: 'POST',
      body: { receivedAmount: 700, note: 'Received at second counter' },
    });

    expect(res.status).toBe(200);
    const receiverCashIn = mockDB.queries.find((q) =>
      /INSERT INTO cash_drawer_movements/i.test(q.sql)
      && q.sql.includes("'cash_in'")
      && q.sql.includes("'accepted_cash_transfer'")
    );
    expect(receiverCashIn).toBeTruthy();
    expect(receiverCashIn?.params).toContain(receiverSession.id);
    expect(receiverCashIn?.params).toContain(receiverSession.counter_id);
    expect(receiverCashIn?.params).toContain(700);
    const acceptedMovementBackfill = mockDB.queries.find((q) =>
      /UPDATE billing_counter_cash_transfers/i.test(q.sql)
      && /accepted_cash_movement_id/i.test(q.sql)
      && /IS NULL/i.test(q.sql)
    );
    expect(acceptedMovementBackfill).toBeTruthy();
  });

});
