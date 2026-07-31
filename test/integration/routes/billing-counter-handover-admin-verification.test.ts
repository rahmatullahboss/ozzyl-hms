import { describe, expect, it } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

const WORKSTATION_HEADERS = { 'X-HMS-Workstation-ID': 'hms-ws-main' };

const COUNTER = {
  id: 7,
  tenant_id: TENANT_1.id,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
};

const PENDING_COUNTER_HANDOVER = {
  id: 77,
  tenant_id: TENANT_1.id,
  handover_type: 'counter',
  handover_by: 1,
  handover_to: 2,
  handover_amount: 1500,
  due_amount: 0,
  status: 'pending',
  counter_session_id: 17,
  counter_id: COUNTER.id,
  counter_type: COUNTER.counter_type,
  counter_name: COUNTER.counter_name,
  counter_code: COUNTER.counter_code,
};

const RECEIVER_SESSION = {
  id: 22,
  tenant_id: TENANT_1.id,
  counter_id: COUNTER.id,
  counter_name: COUNTER.counter_name,
  counter_code: COUNTER.counter_code,
  counter_type: COUNTER.counter_type,
  employee_id: 2,
  status: 'active',
  workstation_id: WORKSTATION_HEADERS['X-HMS-Workstation-ID'],
  opening_cash: 0,
  opened_at: '2026-06-23 09:00:00',
};

const FIRST_HANDOVER_APPROVAL = {
  id: 700,
  tenant_id: TENANT_1.id,
  approval_source: 'billing_handovers',
  approval_request_id: 77,
  approval_revision: 1,
  approver_id: 8,
  approver_role: 'director',
  decision: 'approve',
  notes: 'First admin approval',
  superseded_at: null,
  created_at: '2026-06-23 10:00:00',
};

describe('Billing counter handover admin verification', () => {
  it('completes an exact-count handover without admin approval', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'reception',
      userId: 2,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [PENDING_COUNTER_HANDOVER],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 1500, remarks: 'Receiver counted cash' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { finalVerificationStatus?: string; status?: string; message?: string };
    expect(body.finalVerificationStatus).toBe('not_required');
    expect(body.status).toBe('received');
    expect(body.message).not.toMatch(/admin final verification/i);

    const handoverUpdate = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('update billing_handovers')
      && query.sql.toLowerCase().includes('admin_verification_status')
    );
    expect(handoverUpdate).toBeDefined();
    expect(handoverUpdate?.params).toContain('received');
    expect(handoverUpdate?.params).toContain(null);
    expect(handoverUpdate?.params).not.toContain('pending_admin');

    const verificationEvent = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into cash_handover_verification_events')
    );
    expect(verificationEvent).toBeDefined();
    expect(verificationEvent?.params).toContain('receiver_verified');
    expect(verificationEvent?.params).toContain('verify');
    expect(verificationEvent?.params).toContain(1500);
  });

  it('keeps a receiver-disputed variance pending for admin decision', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'reception',
      userId: 2,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [PENDING_COUNTER_HANDOVER],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/accept', {
      method: 'POST',
      headers: WORKSTATION_HEADERS,
      body: { receivedAmount: 1450, remarks: 'Receiver counted cash', disputeReason: 'Cash is short' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { finalVerificationStatus?: string; status?: string; message?: string };
    expect(body.finalVerificationStatus).toBe('pending_admin');
    expect(body.status).toBe('disputed');
    expect(body.message).toMatch(/admin final verification/i);

    const handoverUpdate = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('update billing_handovers')
      && query.sql.toLowerCase().includes('admin_verification_status')
    );
    expect(handoverUpdate).toBeDefined();
    expect(handoverUpdate?.params).toContain('disputed');
    expect(handoverUpdate?.params).toContain(-50);
    expect(handoverUpdate?.params).toContain('pending_admin');

    const verificationEvent = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into cash_handover_verification_events')
    );
    expect(verificationEvent).toBeDefined();
    expect(verificationEvent?.params).toContain('receiver_disputed');
    expect(verificationEvent?.params).toContain('dispute');
    expect(verificationEvent?.params).toContain(-50);
  });

  it('lets hospital admin perform the final verification after receiver count', async () => {
    const { app, mockDB } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      userId: 9,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          ...PENDING_COUNTER_HANDOVER,
          status: 'disputed',
          received_by: 2,
          receiver_counted_amount: 1450,
          receiver_variance: -50,
          admin_verification_status: 'pending_admin',
        }],
        approval_decisions: [FIRST_HANDOVER_APPROVAL],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/admin-verify', {
      method: 'POST',
      body: { decision: 'approve', remarks: 'Admin counted and verified cash' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status?: string; finalVerificationStatus?: string };
    expect(body.status).toBe('received');
    expect(body.finalVerificationStatus).toBe('verified');

    const handoverUpdate = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('update billing_handovers')
      && query.sql.toLowerCase().includes('admin_verified_by')
    );
    expect(handoverUpdate).toBeDefined();
    expect(handoverUpdate?.params).toContain('verified');
    expect(handoverUpdate?.params).toContain(9);

    const verificationEvent = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into cash_handover_verification_events')
      && query.params.includes('admin_final_verification')
    );
    expect(verificationEvent).toBeDefined();
    expect(verificationEvent?.params).toContain('approve');
    expect(verificationEvent?.params).toContain(-50);
  });

  it('blocks the sender or receiver from performing admin final verification', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      userId: 2,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          ...PENDING_COUNTER_HANDOVER,
          status: 'disputed',
          received_by: 2,
          receiver_counted_amount: 1450,
          receiver_variance: -50,
          admin_verification_status: 'pending_admin',
        }],
        approval_decisions: [FIRST_HANDOVER_APPROVAL],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/admin-verify', {
      method: 'POST',
      body: { decision: 'approve', remarks: 'Self verification attempt' },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error?: string; message?: string };
    expect(String(body.error || body.message)).toMatch(/sender|receiver|own handover|separation/i);
  });

  it('rejects direct admin verification for a clean zero-variance legacy handover', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      userId: 9,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          ...PENDING_COUNTER_HANDOVER,
          status: 'receiver_verified',
          received_by: 2,
          receiver_counted_amount: 1500,
          receiver_variance: 0,
          admin_verification_status: 'pending_admin',
        }],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/admin-verify', {
      method: 'POST',
      body: { decision: 'approve', remarks: 'Clean handover' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error?: string; message?: string };
    expect(String(body.error || body.message)).toMatch(/no variance|approval.*not required/i);
  });

  it('rejects stale admin final verification updates without reporting success', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      userId: 9,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          ...PENDING_COUNTER_HANDOVER,
          status: 'disputed',
          received_by: 2,
          receiver_counted_amount: 1450,
          receiver_variance: -50,
          admin_verification_status: 'pending_admin',
        }],
        approval_decisions: [FIRST_HANDOVER_APPROVAL],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
      queryOverride: (sql) => {
        if (sql.includes('UPDATE billing_handovers') && sql.includes('admin_verified_by')) {
          return { success: true, meta: { changes: 0 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/admin-verify', {
      method: 'POST',
      body: { decision: 'approve', remarks: 'Admin counted and verified cash' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error?: string; message?: string };
    expect(String(body.error || body.message)).toMatch(/already updated|refresh/i);
  });

  it('keeps the admin verification route backward-compatible for older PUT clients', async () => {
    const { app } = createTestApp({
      route: billingCounterRoutes,
      routePath: '/billing-counter',
      role: 'hospital_admin',
      userId: 9,
      tenantId: TENANT_1.id,
      tables: {
        billing_handovers: [{
          ...PENDING_COUNTER_HANDOVER,
          status: 'disputed',
          received_by: 2,
          receiver_counted_amount: 1450,
          receiver_variance: -50,
          admin_verification_status: 'pending_admin',
        }],
        approval_decisions: [FIRST_HANDOVER_APPROVAL],
        billing_counter_sessions: [RECEIVER_SESSION],
        billing_counters: [COUNTER],
      },
    });

    const res = await jsonRequest(app, '/billing-counter/handovers/77/admin-verify', {
      method: 'PUT',
      body: { decision: 'approve', remarks: 'Legacy admin client' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status?: string; finalVerificationStatus?: string };
    expect(body.status).toBe('received');
    expect(body.finalVerificationStatus).toBe('verified');
  });
});
