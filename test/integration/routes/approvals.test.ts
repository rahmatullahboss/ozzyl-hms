import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect, beforeEach } from 'vitest';
import approvalsRoute from '../../../src/routes/tenant/approvals';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { loadApprovalOperationalSummary } from '../../../src/services/actionCenter/approvalSummary';
import { createReceivableWriteOffRequest } from '../../../src/services/actionCenter/collections/writeOff';
import {
  createReceivableAdjustmentHarness,
  seedLegacyBill,
  setReceivableMode,
} from '../../billing/receivable-adjustment-harness';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_1 = { id: 'tenant-1' };
const ADMIN_USER = { id: 1, role: 'hospital_admin' };
const OTHER_USER = { id: 2, role: 'hospital_admin' };
const RECEPTIONIST = { id: 3, role: 'reception' };

const WRITE_OFF_WORKFLOW_MIGRATIONS = [
  '0279_approval_billing_shift_tables.sql',
  '0380_expand_approval_request_types.sql',
  '0381_create_approval_events.sql',
  '0382_approval_execution_lock.sql',
  '0516_two_person_approval_policy.sql',
  '0526_receivable_write_off_approval.sql',
  '0549_approval_revision_policy.sql',
  '0501_collection_cases.sql',
] as const;

function createWriteOffRouteHarness() {
  const harness = createReceivableAdjustmentHarness();
  for (const migration of WRITE_OFF_WORKFLOW_MIGRATIONS) {
    harness.sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  harness.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS role_permission_overrides (
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT NOT NULL,
      PRIMARY KEY (tenant_id, role)
    );
    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      action TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, permission)
    );
  `);
  return harness;
}

function routeMockDB(harness: ReturnType<typeof createWriteOffRouteHarness>) {
  return {
    db: harness.db,
    queries: [],
    batchCalls: [],
    reset() {},
  } as any;
}

async function seedWriteOffApproval(
  harness: ReturnType<typeof createWriteOffRouteHarness>,
  amountMinor = 3000,
) {
  seedLegacyBill(harness.sqlite, { tenantId: TENANT_1.id });
  setReceivableMode(harness.sqlite, 'legacy', TENANT_1.id);
  return createReceivableWriteOffRequest({
    db: harness.db,
    tenantId: TENANT_1.id,
    source: { sourceType: 'invoice', legacyBillId: 77 },
    requesterId: RECEPTIONIST.id,
    amountMinor,
    currencyCode: 'BDT',
    reasonCode: 'uncollectible',
    note: 'Multiple documented collection attempts did not produce payment.',
    evidenceUrls: ['https://evidence.example/write-off/route'],
  });
}

function approvalEventQueries(mockDB: { queries: Array<{ sql: string; params: unknown[] }> }) {
  return mockDB.queries.filter((query) => /INSERT\s+INTO\s+approval_events/i.test(query.sql));
}

const existingBill = {
  id: 100,
  invoice_no: 'INV-001',
  patient_id: 50,
  total: 5000,
  discount: 0,
  paid: 0,
  status: 'open',
  tenant_id: TENANT_1.id,
};

const existingApproval = {
  id: 1,
  tenant_id: TENANT_1.id,
  type: 'bill_edit',
  entity_id: 100,
  entity_no: 'INV-001',
  requested_by: ADMIN_USER.id,
  request_data: JSON.stringify({ oldValue: { total: 5000 }, newValue: { total: 6000 }, reason: 'Price correction' }),
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  review_notes: null,
  created_at: '2026-05-27 10:00:00',
};

describe('Approval Center API', () => {
  describe('POST /approvals — create approval request', () => {
    it('creates a bill_edit approval request', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [], bills: [existingBill] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_edit',
          entityId: 100,
          entityNo: 'INV-001',
          requestData: {
            oldValue: { total: 5000 },
            newValue: { total: 6000 },
            reason: 'Price correction',
          },
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { type: string; status: string } };
      expect(body.data.type).toBe('bill_edit');
      expect(body.data.status).toBe('pending');
    });

    it('records a created event for new approval requests', async () => {
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(testApp.app, '/approvals', {
        method: 'POST',
        body: {
          type: 'discount',
          entityId: 101,
          entityNo: 'INV-101',
          requestData: { oldValue: { total: 1000 }, newValue: { total: 900 }, reason: 'Approved campaign' },
        },
      });

      expect(res.status).toBe(201);
      const events = approvalEventQueries(testApp.mockDB);
      expect(events).toHaveLength(1);
      expect(events[0].params[2]).toBe('created');
      expect(events[0].params[5]).toBe('pending');
    });

    it('creates a bill_cancel approval request', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [], bills: [existingBill] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_cancel',
          entityId: 100,
          entityNo: 'INV-001',
          requestData: {
            reason: 'Patient requested cancellation',
          },
        },
      });

      expect(res.status).toBe(201);
    });

    it('executes a cash payment void while creating the pending approval', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        tables: {
          approval_requests: [],
          payments: [{
            id: 83,
            bill_id: 12,
            amount: 700,
            payment_type: 'current',
            receipt_no: 'RCP-000083',
            payment_method: 'cash',
            received_by: 77,
            counter_id: 3,
            counter_session_id: 9,
            tenant_id: TENANT_1.id,
            patient_id: 50,
            paid: 700,
            total: 700,
            status: 'paid',
          }],
          bills: [{ id: 12, tenant_id: TENANT_1.id, patient_id: 50, paid: 700, due: 0, total: 700, status: 'paid' }],
          billing_deposits: [],
          diagnostic_performer_reserves: [],
          doctor_commission_accruals: [],
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'payment_void',
          entityId: 83,
          entityNo: 'RCP-000083',
          idempotencyKey: 'payment-void-83-12345678',
          requestData: {
            correctionType: 'payment_void',
            amount: 700,
            reason: 'Wrongly marked as paid',
          },
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as {
        executed?: boolean;
        data: { status: string; execution_status?: string; request_data?: Record<string, unknown> };
        reversal?: { amount: number; billDueAfter: number; billStatusAfter: string };
      };
      expect(body.executed).toBe(true);
      expect(body.data).toMatchObject({ status: 'pending', execution_status: 'succeeded' });
      expect(body.data.request_data).toMatchObject({
        executionMode: 'executed_pending',
        financialState: 'reversed_pending_review',
        paymentVoidIdempotencyKey: 'payment-void-83-12345678',
      });
      expect(body.reversal).toMatchObject({ amount: 700, billDueAfter: 700, billStatusAfter: 'open' });
      const reversalInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO payments') && query.params.includes(-700));
      expect(reversalInsert).toBeDefined();
      expect(reversalInsert?.params).toContain('current');
      expect(reversalInsert?.sql).not.toContain("'reversal'");

      const productionSchema = new DatabaseSync(':memory:');
      productionSchema.exec(`
        CREATE TABLE payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          payment_type TEXT CHECK(payment_type IN ('current', 'due')),
          receipt_no TEXT,
          received_by INTEGER,
          payment_method TEXT,
          external_transaction_id TEXT,
          tenant_id TEXT NOT NULL,
          counter_id INTEGER,
          counter_session_id INTEGER,
          date DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      expect(() => productionSchema.prepare(reversalInsert!.sql).run(...reversalInsert!.params)).not.toThrow();
      expect(productionSchema.prepare(`
        SELECT amount, payment_type, external_transaction_id
        FROM payments
      `).get()).toMatchObject({
        amount: -700,
        payment_type: 'current',
        external_transaction_id: 'reverse-payment-83',
      });
      productionSchema.close();

      expect(mockDB.queries.some((query) => query.sql.includes('UPDATE bills SET paid = ?') && query.params.includes(0) && query.params.includes(700) && query.params.includes('open'))).toBe(true);
      const approvalInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO approval_requests'));
      expect(approvalInsert?.params).toContain('succeeded');
      expect(String(approvalInsert?.params.find((value) => typeof value === 'string' && value.includes('executed_pending')) ?? '')).toContain('reversed_pending_review');
    });

    it('stores direct credit discharge requests using the production-compatible manual adjustment alias', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'credit_discharge',
          entityId: 22,
          entityNo: 'ADM-000022',
          requestData: {
            reason: 'Guardian will pay after salary',
            totalDueMinor: 670000,
          },
        },
      });

      expect(res.status).toBe(201);
      const insert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO approval_requests'));
      expect(insert?.params).toContain('manual_adjustment');
      expect(insert?.params).not.toContain('credit_discharge');
      const storedRequestData = insert?.params.find((value) => (
        typeof value === 'string' && value.includes('Guardian will pay after salary')
      ));
      expect(JSON.parse(String(storedRequestData))).toMatchObject({
        approvalKind: 'credit_discharge',
        totalDueMinor: 670000,
      });
      const body = await res.json() as { data: { type: string; request_data: Record<string, unknown> } };
      expect(body.data.type).toBe('credit_discharge');
      expect(body.data.request_data).toMatchObject({ approvalKind: 'credit_discharge' });
    });

    it('rejects generic receivable write-off creation and directs callers to the collection workflow', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'receivable_write_off',
          entityId: 77,
          entityNo: 'INV-77',
          requestData: {
            reason: 'Attempt to bypass the controlled collection workflow',
          },
        },
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringMatching(/Action Center collection workflow/i),
      });
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO approval_requests'))).toBe(false);
    });

    it('returns 409 if duplicate pending request exists', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_edit',
          entityId: 100,
          requestData: { reason: 'Another edit' },
        },
      });

      expect(res.status).toBe(409);
    });

    it('returns 400 for missing reason', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_edit',
          entityId: 100,
          requestData: {},
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 403 for roles that cannot request approvals', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_edit',
          entityId: 100,
          requestData: { reason: 'test' },
        },
      });

      expect(res.status).toBe(403);
    });

    it('creates discount approval request', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'discount',
          entityId: 50,
          requestData: { reason: 'VIP patient' },
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { type: string } };
      expect(body.data.type).toBe('discount');
    });

    it('creates refund approval request', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'refund',
          entityId: 75,
          requestData: { reason: 'Overpayment' },
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { execution_status?: string } };
      expect(body.data.execution_status).toBe('pending');
    });

    it('creates an item refund request and cash hold in one batch', async () => {
      let holdLookupCount = 0;
      const persistedRequestData = JSON.stringify({
        refundKind: 'item_partial_refund',
        reason: 'CBC was not performed',
        executionMode: 'executed_pending',
        financialState: 'refunded_pending_review',
        cashHoldStatus: 'consumed',
        approvalRevision: 1,
        requestedRefundAmount: 800,
        cashRefundAmount: 800,
        receivableReduction: 0,
        refundRequestIdempotencyKey: 'refund-request-75-12345678',
        refundRequestHash: 'persisted-hash',
        counterId: 7,
        counterSessionId: 17,
        creditNoteNo: 'CN-000001',
      });
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) {
            holdLookupCount += 1;
            if (holdLookupCount === 1) return { first: null };
            return { first: {
              id: 2,
              approval_request_id: 1,
              bill_id: 75,
              patient_id: 50,
              amount: 800,
              payment_method: 'cash',
              employee_id: 3,
              counter_id: 7,
              counter_session_id: 17,
              status: 'consumed',
              credit_note_id: 3,
              idempotency_key: 'refund-request-75-12345678',
              held_at: '2026-07-12 10:00:00',
              consumed_at: '2026-07-12 10:01:00',
              released_at: null,
            } };
          }
          if (/SELECT id, request_data, execution_status, approval_revision[\s\S]*json_extract/i.test(sql)) {
            return { first: {
              id: 1,
              request_data: persistedRequestData,
              execution_status: 'succeeded',
              approval_revision: 1,
            } };
          }
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: {
              id: 75,
              patient_id: 50,
              invoice_no: 'INV-75',
              status: 'paid',
              paid: 2000,
              due: 0,
              total: 2000,
              test_bill: 2000,
              doctor_visit_bill: 0,
              admission_bill: 0,
              operation_bill: 0,
              medicine_bill: 0,
            } };
          }
          if (/SELECT id, patient_id, invoice_no, status, total, paid, due[\s\S]*FROM bills/i.test(sql)) {
            return { first: {
              id: 75,
              patient_id: 50,
              invoice_no: 'INV-75',
              status: 'paid',
              paid: 2000,
              due: 0,
              total: 2000,
              test_bill: 2000,
              doctor_visit_bill: 0,
              admission_bill: 0,
              operation_bill: 0,
              medicine_bill: 0,
            } };
          }
          if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) {
            return { first: {
              id: 2,
              approval_request_id: 1,
              bill_id: 75,
              patient_id: 50,
              amount: 800,
              payment_method: 'cash',
              employee_id: 3,
              counter_id: 7,
              counter_session_id: 17,
              status: 'held',
              credit_note_id: null,
              idempotency_key: 'refund-request-75-12345678',
              held_at: '2026-07-12 10:00:00',
              consumed_at: null,
              released_at: null,
            } };
          }
          if (/JOIN radiology_requisitions rr/i.test(sql)) return { results: [] };
          if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) return { results: [] };
          if (/SELECT item_category[\s\S]*FROM invoice_items/i.test(sql)) return { results: [{ item_category: 'test' }] };
          if (/FROM invoice_items ii/i.test(sql)) {
            return { results: [
              { id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 },
              { id: 102, description: 'LFT', item_category: 'test', quantity: 1, unit_price: 1200, line_total: 1200, reference_id: 502, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 },
            ] };
          }
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
          if (/FROM lab_order_items/i.test(sql)) return { results: [{ id: 501, status: 'pending' }, { id: 502, status: 'pending' }] };
          if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
          if (/FROM billing_counter_sessions s[\s\S]*JOIN billing_counters/i.test(sql)) {
            return { first: { id: 17, counter_id: 7, counter_name: 'Reception', counter_code: 'R-1', counter_type: 'billing', opening_cash: 5000, opened_at: '2026-07-12', workstation_id: 'workstation-123', variance_approval_status: null } };
          }
          if (/SELECT[\s\S]*FROM billing_counter_sessions s[\s\S]*LEFT JOIN/i.test(sql)) {
            return { first: { opening_cash: 5000, cash_in: 0, cash_out: 0, manual_cash_in: 0, manual_cash_out: 0, cash_drop_total: 0, appointment_cash: 0, test_cash: 0, total_discount: 0, free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0 } };
          }
          if (/SUM\(amount\)[\s\S]*billing_refund_cash_holds/i.test(sql)) return { first: { amount: 0 } };
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-12345678',
          requestData: {
            refundKind: 'item_partial_refund',
            paymentMethod: 'cash',
            reason: 'CBC was not performed',
            items: [{ invoiceItemId: 101, returnQuantity: 1 }],
          },
        },
      });

      const responseText = await res.clone().text();
      expect(res.status, responseText).toBe(201);
      const body = await res.json() as {
        executed: boolean;
        cashHold: { amount: number; status: string };
        data: { execution_status: string; request_data: Record<string, unknown> };
        refund: { totalRefund: number; cashRefund: number; creditNoteNo: string };
      };
      expect(body.executed).toBe(true);
      expect(body.cashHold).toMatchObject({ amount: 800, status: 'consumed' });
      expect(body.data.execution_status).toBe('succeeded');
      expect(body.data.request_data).toMatchObject({
        executionMode: 'executed_pending',
        financialState: 'refunded_pending_review',
        cashHoldStatus: 'consumed',
        approvalRevision: 1,
        requestedRefundAmount: 800,
        cashRefundAmount: 800,
        receivableReduction: 0,
      });
      expect(body.refund).toMatchObject({ totalRefund: 800, cashRefund: 800 });
      expect(mockDB.batchCalls.some((batch) =>
        batch.some((sql) => /INSERT INTO approval_requests/i.test(sql))
        && batch.some((sql) => /INSERT INTO billing_refund_cash_holds/i.test(sql))
        && batch.some((sql) => /INSERT INTO billing_credit_notes/i.test(sql))
        && batch.some((sql) => /INSERT INTO emp_cash_transactions/i.test(sql) && /SalesReturn/i.test(sql))
      )).toBe(true);
    });

    it('creates an amount-based refund request with automatic adjustable item allocation', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'paid', paid: 2000, total: 2000 } };
          }
          if (/FROM invoice_items ii/i.test(sql)) {
            return { results: [
              { id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 400, line_total: 400, reference_id: 501, approved_credit_amount: 0 },
              { id: 102, description: 'TSH', item_category: 'test', quantity: 1, unit_price: 500, line_total: 500, reference_id: 502, approved_credit_amount: 0 },
              { id: 103, description: 'Lipid Profile', item_category: 'test', quantity: 1, unit_price: 1100, line_total: 1100, reference_id: 503, approved_credit_amount: 0 },
            ] };
          }
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
          if (/FROM billing_counter_sessions s[\s\S]*JOIN billing_counters/i.test(sql)) {
            return { first: { id: 17, counter_id: 7, counter_name: 'Reception', counter_code: 'R-1', counter_type: 'billing', opening_cash: 5000, opened_at: '2026-07-12', workstation_id: 'workstation-123', variance_approval_status: null } };
          }
          if (/SELECT[\s\S]*FROM billing_counter_sessions s[\s\S]*LEFT JOIN/i.test(sql)) {
            return { first: { opening_cash: 5000, cash_in: 0, cash_out: 0, manual_cash_in: 0, manual_cash_out: 0, cash_drop_total: 0, appointment_cash: 0, test_cash: 0, total_discount: 0, free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0 } };
          }
          if (/SUM\(amount\)[\s\S]*billing_refund_cash_holds/i.test(sql)) return { first: { amount: 0 } };
          if (/FROM doctor_commission_accruals dca/i.test(sql)) {
            return { results: [{
              id: 300,
              doctor_id: 12,
              doctor_name: 'Dr. Referrer',
              patient_id: 50,
              visit_id: null,
              bill_id: 75,
              lab_order_item_id: null,
              canonical_source_key: 'bill:75:line:1:test:501:doctor:12:rule:1:prescribing',
              source_type: 'lab_test',
              gross_amount: 400,
              commission_base_amount: 400,
              commission_rate_bps: 2500,
              commission_flat_amount: 0,
              commission_amount: 100,
              earned_commission_amount: 100,
              doctor_waiver_amount: 0,
              payable_commission_amount: 100,
              paid_amount: 0,
              balance_amount: 100,
              status: 'accrued',
              accrued_date: '2026-07-12',
            }] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-amount-1234',
          requestData: {
            refundKind: 'amount_partial_refund',
            paymentMethod: 'cash',
            requestedRefundAmount: 350.75,
            reason: 'Manual partial refund approved by management',
          },
        },
      });

      const responseText = await res.clone().text();
      expect(res.status, responseText).toBe(201);
      const body = await res.json() as {
        cashHold: { amount: number; status: string };
        data: { request_data: Record<string, unknown> };
      };
      expect(body.cashHold).toMatchObject({ amount: 350.75, status: 'consumed' });
      expect(body.data.request_data).toMatchObject({
        refundKind: 'amount_partial_refund',
        requestedRefundAmount: 350.75,
        cashRefundAmount: 350.75,
        receivableReduction: 0,
        allocationMode: 'auto_proportional_adjustable',
        allocationVersion: 1,
        commissionReservationStatus: 'consumed',
        commissionReservedAmount: 17.54,
      });
      expect(body.data.request_data.items).toEqual([
        expect.objectContaining({ invoiceItemId: 101, allocatedRefundAmount: 70.15, allocationSource: 'auto' }),
        expect.objectContaining({ invoiceItemId: 102, allocatedRefundAmount: 87.69, allocationSource: 'auto' }),
        expect.objectContaining({ invoiceItemId: 103, allocatedRefundAmount: 192.91, allocationSource: 'auto' }),
      ]);
      expect(mockDB.queries.some((query) => /FROM invoice_items ii/i.test(query.sql))).toBe(true);
      const creationBatch = mockDB.batchCalls.find((batch) => batch.some((sql) => /INSERT INTO billing_refund_cash_holds/i.test(sql)));
      expect(creationBatch?.some((sql) => /INSERT OR IGNORE INTO billing_refund_commission_reservations/i.test(sql))).toBe(false);
      expect(creationBatch?.some((sql) => /UPDATE doctor_commission_accruals/i.test(sql))).toBe(true);
      expect(creationBatch?.some((sql) => /doctor_commission_refund_adjustment/i.test(sql))).toBe(true);
    });

    it('holds only the cash portion of a partially-paid amount credit', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'partially_paid', paid: 600, total: 1000 } };
          }
          if (/FROM invoice_items ii/i.test(sql)) {
            return { results: [
              { id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 400, line_total: 400, reference_id: 501, approved_credit_amount: 0 },
              { id: 102, description: 'TSH', item_category: 'test', quantity: 1, unit_price: 600, line_total: 600, reference_id: 502, approved_credit_amount: 0 },
            ] };
          }
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
          if (/FROM billing_counter_sessions s[\s\S]*JOIN billing_counters/i.test(sql)) {
            return { first: { id: 17, counter_id: 7, counter_name: 'Reception', counter_code: 'R-1', counter_type: 'billing', opening_cash: 5000, opened_at: '2026-07-12', workstation_id: 'workstation-123', variance_approval_status: null } };
          }
          if (/SELECT[\s\S]*FROM billing_counter_sessions s[\s\S]*LEFT JOIN/i.test(sql)) {
            return { first: { opening_cash: 5000, cash_in: 0, cash_out: 0, manual_cash_in: 0, manual_cash_out: 0, cash_drop_total: 0, appointment_cash: 0, test_cash: 0, total_discount: 0, free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0 } };
          }
          if (/SUM\(amount\)[\s\S]*billing_refund_cash_holds/i.test(sql)) return { first: { amount: 0 } };
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-amount-partial-paid',
          requestData: {
            refundKind: 'amount_partial_refund',
            paymentMethod: 'cash',
            requestedRefundAmount: 500,
            reason: 'Management approved a partial amount credit',
          },
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as {
        cashHold: { amount: number; status: string };
        data: { request_data: Record<string, unknown> };
      };
      expect(body.cashHold).toMatchObject({ amount: 100, status: 'consumed' });
      expect(body.data.request_data).toMatchObject({
        requestedRefundAmount: 500,
        cashRefundAmount: 100,
        receivableReduction: 400,
        allocationMode: 'auto_proportional_adjustable',
      });
      expect(body.data.request_data.items).toEqual([
        expect.objectContaining({ invoiceItemId: 101, allocatedRefundAmount: 200 }),
        expect.objectContaining({ invoiceItemId: 102, allocatedRefundAmount: 300 }),
      ]);
      expect(mockDB.queries.some((query) => /FROM invoice_items ii/i.test(query.sql))).toBe(true);
    });

    it('rejects an amount credit that only reduces unpaid receivable', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'partially_paid', paid: 200, total: 1000 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-amount-due-only',
          requestData: {
            refundKind: 'amount_partial_refund',
            paymentMethod: 'cash',
            requestedRefundAmount: 300,
            reason: 'Management approved a partial amount credit',
          },
        },
      });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringMatching(/does not produce a cash refund/i),
      });
      expect(mockDB.batchCalls).toHaveLength(0);
      expect(mockDB.queries.some((query) => /FROM invoice_items ii/i.test(query.sql))).toBe(false);
    });

    it('requires the full-refund flow when an amount credit reaches the full bill total', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'paid', paid: 500, total: 500 } };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-amount-full-total',
          requestData: {
            refundKind: 'amount_partial_refund',
            paymentMethod: 'cash',
            requestedRefundAmount: 500,
            reason: 'Attempted manual full bill credit',
          },
        },
      });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringMatching(/use the full refund flow/i),
      });
      expect(mockDB.batchCalls).toHaveLength(0);
    });

    it('holds only the cash portion of a partially-paid item credit', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'partially_paid', paid: 600, total: 1000 } };
          }
          if (/JOIN radiology_requisitions rr/i.test(sql)) return { results: [] };
          if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) return { results: [] };
          if (/SELECT item_category[\s\S]*FROM invoice_items/i.test(sql)) return { results: [{ item_category: 'service' }] };
          if (/FROM invoice_items ii/i.test(sql)) {
            return { results: [{ id: 101, description: 'Unused service', item_category: 'service', quantity: 1, unit_price: 500, line_total: 500, reference_id: null, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 }] };
          }
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
          if (/FROM billing_counter_sessions s[\s\S]*JOIN billing_counters/i.test(sql)) {
            return { first: { id: 17, counter_id: 7, counter_name: 'Reception', counter_code: 'R-1', counter_type: 'billing', opening_cash: 5000, opened_at: '2026-07-12', workstation_id: 'workstation-123', variance_approval_status: null } };
          }
          if (/SELECT[\s\S]*FROM billing_counter_sessions s[\s\S]*LEFT JOIN/i.test(sql)) {
            return { first: { opening_cash: 5000, cash_in: 0, cash_out: 0, manual_cash_in: 0, manual_cash_out: 0, cash_drop_total: 0, appointment_cash: 0, test_cash: 0, total_discount: 0, free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0 } };
          }
          if (/SUM\(amount\)[\s\S]*billing_refund_cash_holds/i.test(sql)) return { first: { amount: 0 } };
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-partial-paid',
          requestData: {
            refundKind: 'item_partial_refund',
            paymentMethod: 'cash',
            reason: 'Unused service was not provided',
            items: [{ invoiceItemId: 101, returnQuantity: 1 }],
          },
        },
      });

      const responseText = await res.clone().text();
      expect(res.status, responseText).toBe(201);
      const body = await res.json() as {
        cashHold: { amount: number; status: string };
        data: { request_data: Record<string, unknown> };
      };
      expect(body.cashHold).toMatchObject({ amount: 100, status: 'consumed' });
      expect(body.data.request_data).toMatchObject({
        requestedRefundAmount: 500,
        cashRefundAmount: 100,
        receivableReduction: 400,
      });
      const holdInsert = mockDB.queries.find((query) => /INSERT INTO billing_refund_cash_holds/i.test(query.sql));
      expect(holdInsert?.params).toContain(100);
    });

    it('rejects a cash-refund request when the selected credit only reduces unpaid receivable', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'partially_paid', paid: 200, total: 1000 } };
          }
          if (/FROM invoice_items ii/i.test(sql)) {
            return { results: [{ id: 101, description: 'Unused service', item_category: 'service', quantity: 1, unit_price: 300, line_total: 300, reference_id: null, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 }] };
          }
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-due-only',
          requestData: {
            refundKind: 'item_partial_refund',
            paymentMethod: 'cash',
            reason: 'Unused service was not provided',
            items: [{ invoiceItemId: 101, returnQuantity: 1 }],
          },
        },
      });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringMatching(/does not produce a cash refund/i),
      });
      expect(mockDB.batchCalls).toHaveLength(0);
    });

    it('returns a conflict when the database cash-reservation guard wins a concurrent race', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        queryOverride: (sql) => {
          if (/FROM billing_refund_cash_holds[\s\S]*idempotency_key/i.test(sql)) return { first: null };
          if (/SELECT id FROM approval_requests[\s\S]*status = 'pending'/i.test(sql)) return { first: null };
          if (/SELECT id, patient_id, invoice_no, status, paid, due, total[\s\S]*FROM bills/i.test(sql)) {
            return { first: { id: 75, patient_id: 50, invoice_no: 'INV-75', status: 'paid', paid: 2000, total: 2000 } };
          }
          if (/FROM invoice_items ii/i.test(sql)) {
            return { results: [{ id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 }] };
          }
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
          if (/FROM lab_order_items/i.test(sql)) return { results: [{ id: 501, status: 'pending' }] };
          if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
          if (/FROM billing_counter_sessions s[\s\S]*JOIN billing_counters/i.test(sql)) {
            return { first: { id: 17, counter_id: 7, counter_name: 'Reception', counter_code: 'R-1', counter_type: 'billing', opening_cash: 5000, opened_at: '2026-07-12', workstation_id: 'workstation-123', variance_approval_status: null } };
          }
          if (/SELECT[\s\S]*FROM billing_counter_sessions s[\s\S]*LEFT JOIN/i.test(sql)) {
            return { first: { opening_cash: 5000, cash_in: 0, cash_out: 0, manual_cash_in: 0, manual_cash_out: 0, cash_drop_total: 0, appointment_cash: 0, test_cash: 0, total_discount: 0, free_appointment_count: 0, doctor_payable_total: 0, commission_payable_total: 0 } };
          }
          if (/SUM\(amount\)[\s\S]*billing_refund_cash_holds/i.test(sql)) return { first: { amount: 0 } };
          return null;
        },
      });
      (mockDB.db as D1Database & { batch: D1Database['batch'] }).batch = async () => {
        throw new Error('D1_ERROR: insufficient counter cash for refund hold');
      };

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        headers: { 'X-HMS-Workstation-ID': 'workstation-123' },
        body: {
          type: 'refund',
          entityId: 75,
          entityNo: 'INV-75',
          idempotencyKey: 'refund-request-75-race1234',
          requestData: {
            refundKind: 'item_partial_refund',
            paymentMethod: 'cash',
            reason: 'CBC was not performed',
            items: [{ invoiceItemId: 101, returnQuantity: 1 }],
          },
        },
      });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringMatching(/available counter cash changed/i),
      });
    });

    it('returns 400 for invalid type', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'invalid_type',
          entityId: 100,
          requestData: { reason: 'test' },
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing entityId', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_edit',
          requestData: { reason: 'test' },
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for negative entityId', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals', {
        method: 'POST',
        body: {
          type: 'bill_edit',
          entityId: -1,
          requestData: { reason: 'test' },
        },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /approvals — list approval requests', () => {
    it.each(['hospital_admin', 'md', 'director'] as const)(
      'allows %s to read a date-filtered pending worklist',
      async (role) => {
        const { app } = createTestApp({
          route: approvalsRoute,
          routePath: '/approvals',
          role,
          tenantId: TENANT_1.id,
          tables: {
            approval_requests: [
              { ...existingApproval, id: 71, created_at: '2026-07-18 09:00:00', status: 'pending' },
            ],
          },
        });

        const res = await app.request('/approvals?status=pending&createdFrom=2026-07-18&createdTo=2026-07-18');
        expect(res.status).toBe(200);
      },
    );

    it('blocks roles that are not allowed to review approvals', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await app.request('/approvals?status=pending&createdFrom=2026-07-18&createdTo=2026-07-18');
      expect(res.status).toBe(403);
    });

    it('returns only currently pending canonical requests created inside the selected window', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [
            { ...existingApproval, id: 72, created_at: '2026-07-18 08:00:00', status: 'pending' },
            { ...existingApproval, id: 73, created_at: '2026-07-17 23:59:59', status: 'pending' },
            { ...existingApproval, id: 74, created_at: '2026-07-18 10:00:00', status: 'approved' },
            { ...existingApproval, id: 75, created_at: '2026-07-19 00:00:00', status: 'pending' },
          ],
        },
      });

      const res = await app.request('/approvals?status=pending&createdFrom=2026-07-18&createdTo=2026-07-18&limit=100');
      const body = await res.json() as { data: Array<{ id: number }>; pagination: { total: number } };

      expect(res.status).toBe(200);
      expect(body.data.map((item) => item.id)).toEqual([72]);
      expect(body.pagination.total).toBe(1);
    });

    it('returns only older currently pending canonical requests in Past Pending mode', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [
            { ...existingApproval, id: 76, created_at: '2026-07-16 12:00:00', status: 'pending' },
            { ...existingApproval, id: 77, created_at: '2026-07-17 23:59:59', status: 'pending' },
            { ...existingApproval, id: 78, created_at: '2026-07-18 00:00:00', status: 'pending' },
            { ...existingApproval, id: 79, created_at: '2026-07-15 10:00:00', status: 'rejected' },
          ],
        },
      });

      const res = await app.request('/approvals?status=pending&createdBefore=2026-07-18&limit=100');
      const body = await res.json() as { data: Array<{ id: number }> };

      expect(res.status).toBe(200);
      expect(body.data.map((item) => item.id).sort()).toEqual([76, 77]);
    });

    it('applies selected and Past Pending creation filters to every approval source', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [
            { ...existingApproval, id: 81, created_at: '2026-07-18 09:00:00', status: 'pending' },
            { ...existingApproval, id: 82, created_at: '2026-07-17 09:00:00', status: 'pending' },
          ],
          expenses: [
            {
              id: 91,
              tenant_id: TENANT_1.id,
              expense_no: 'EXP-91',
              amount: 5000,
              category: 'Supplies',
              description: 'Selected-date expense',
              date: '2026-07-18',
              created_at: '2026-07-18 10:00:00',
              created_by: 2,
              approval_status: 'pending',
              status: 'pending',
            },
            {
              id: 92,
              tenant_id: TENANT_1.id,
              expense_no: 'EXP-92',
              amount: 2000,
              category: 'Supplies',
              description: 'Older expense',
              date: '2026-07-17',
              created_at: '2026-07-17 10:00:00',
              created_by: 2,
              approval_status: 'pending',
              status: 'pending',
            },
          ],
          billing_handovers: [
            {
              id: 101,
              tenant_id: TENANT_1.id,
              handover_type: 'counter',
              status: 'disputed',
              admin_verification_status: 'pending_admin',
              handover_amount: 3000,
              due_amount: 0,
              receiver_counted_amount: 2900,
              receiver_variance: -100,
              handover_by: 2,
              received_by: 3,
              created_at: '2026-07-18 11:00:00',
            },
            {
              id: 102,
              tenant_id: TENANT_1.id,
              handover_type: 'counter',
              status: 'disputed',
              admin_verification_status: 'pending_admin',
              handover_amount: 3000,
              due_amount: 0,
              receiver_counted_amount: 2900,
              receiver_variance: -100,
              handover_by: 2,
              received_by: 3,
              created_at: '2026-07-17 11:00:00',
            },
          ],
          users: [],
        },
      });

      const selectedRes = await app.request('/approvals?status=pending&createdFrom=2026-07-18&createdTo=2026-07-18&limit=100');
      const selectedBody = await selectedRes.json() as { data: Array<{ approval_key: string }>; pagination: { total: number } };
      expect(selectedRes.status).toBe(200);
      expect(selectedBody.pagination.total).toBe(3);
      expect(selectedBody.data.map((item) => item.approval_key).sort()).toEqual([
        'approval_requests:81',
        'billing_handovers:101',
        'expenses:91',
      ]);

      const pastRes = await app.request('/approvals?status=pending&createdBefore=2026-07-18&limit=100');
      const pastBody = await pastRes.json() as { data: Array<{ approval_key: string }>; pagination: { total: number } };
      expect(pastRes.status).toBe(200);
      expect(pastBody.pagination.total).toBe(3);
      expect(pastBody.data.map((item) => item.approval_key).sort()).toEqual([
        'approval_requests:82',
        'billing_handovers:102',
        'expenses:92',
      ]);
    });

    it.each([
      '/approvals?createdFrom=18-07-2026',
      '/approvals?createdFrom=2026-02-30',
      '/approvals?createdFrom=2026-07-18&createdTo=2026-07-17',
      '/approvals?createdBefore=2026-07-18&createdFrom=2026-07-18',
    ])('rejects invalid creation-window query %s', async (path) => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await app.request(path);
      expect(res.status).toBe(400);
    });

    it('returns pending approvals filtered by type', async () => {
      const billEditApproval = { ...existingApproval, type: 'bill_edit', status: 'pending' };
      const billCancelApproval = { ...existingApproval, id: 2, type: 'bill_cancel', status: 'pending' };
      const approvedApproval = { ...existingApproval, id: 3, type: 'bill_edit', status: 'approved' };

      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [billEditApproval, billCancelApproval, approvedApproval] },
      });

      const res = await app.request('/approvals?type=bill_edit&status=pending');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body.data.length).toBe(1);
      expect(body.pagination.total).toBe(1);
    });

    it('hydrates refund approvals with their cash hold state', async () => {
      const refundApproval = {
        ...existingApproval,
        id: 55,
        type: 'refund',
        entity_id: 75,
        request_data: JSON.stringify({
          refundKind: 'item_partial_refund',
          requestedRefundAmount: 800,
          items: [{ invoiceItemId: 101, returnQuantity: 1 }],
          reason: 'Test not performed',
        }),
        status: 'pending',
      };
      const hold = {
        id: 9,
        tenant_id: TENANT_1.id,
        approval_request_id: 55,
        amount: 800,
        status: 'held',
        counter_session_id: 17,
        held_at: '2026-07-12 10:00:00',
        consumed_at: null,
        released_at: null,
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [refundApproval],
          billing_refund_cash_holds: [hold],
        },
      });

      const res = await app.request('/approvals?type=refund&status=pending');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ approval_amount?: number; cash_hold?: Record<string, unknown> }> };
      expect(body.data[0].approval_amount).toBe(800);
      expect(body.data[0].cash_hold).toMatchObject({
        id: 9,
        amount: 800,
        status: 'held',
        counter_session_id: 17,
      });
    });

    it('marks executed refund cash as return-eligible only when the original counter session still matches', async () => {
      const eligibleRefundApproval = {
        ...existingApproval,
        id: 56,
        type: 'refund',
        entity_id: 75,
        execution_status: 'succeeded',
        request_data: JSON.stringify({
          executionMode: 'executed_pending',
          financialState: 'refunded_pending_review',
          counterId: 3,
          counterSessionId: 17,
        }),
        status: 'pending',
      };
      const mismatchedRefundApproval = {
        ...eligibleRefundApproval,
        id: 57,
        entity_id: 76,
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [eligibleRefundApproval, mismatchedRefundApproval],
          billing_refund_cash_holds: [{
            id: 10,
            tenant_id: TENANT_1.id,
            approval_request_id: 56,
            amount: 800,
            status: 'consumed',
            counter_id: 3,
            counter_session_id: 17,
            employee_id: 77,
            held_at: '2026-07-12 10:00:00',
            consumed_at: '2026-07-12 10:05:00',
            released_at: null,
            credit_note_id: 20,
          }, {
            id: 11,
            tenant_id: TENANT_1.id,
            approval_request_id: 57,
            amount: 500,
            status: 'consumed',
            counter_id: 3,
            counter_session_id: 17,
            employee_id: 88,
            held_at: '2026-07-12 10:00:00',
            consumed_at: '2026-07-12 10:05:00',
            released_at: null,
            credit_note_id: 21,
          }],
          billing_counter_sessions: [{
            id: 17,
            tenant_id: TENANT_1.id,
            counter_id: 3,
            employee_id: 77,
            status: 'active',
            variance_approval_status: 'approved',
          }],
        },
      });

      const res = await app.request('/approvals?type=refund&status=pending');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; cash_hold?: Record<string, unknown> }> };
      expect(body.data.find((item) => item.id === 56)?.cash_hold).toMatchObject({
        id: 10,
        status: 'consumed',
        counter_session_id: 17,
        cash_return_eligible: true,
      });
      expect(body.data.find((item) => item.id === 57)?.cash_hold).toMatchObject({
        id: 11,
        cash_return_eligible: false,
      });
    });

    it('returns all approval history when status is all', async () => {
      const items = [
        { ...existingApproval, id: 1, status: 'pending' },
        { ...existingApproval, id: 2, status: 'approved' },
        { ...existingApproval, id: 3, status: 'rejected' },
      ];

      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const res = await app.request('/approvals?status=all&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ status: string }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(3);
      expect(body.data.map((item) => item.status).sort()).toEqual(['approved', 'pending', 'rejected']);
    });

    it('paginates results', async () => {
      const items = Array.from({ length: 25 }, (_, i) => ({
        ...existingApproval,
        id: i + 1,
        entity_id: 100 + i,
      }));

      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const res = await app.request('/approvals?page=2&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { pagination: { page: number; totalPages: number } };
      expect(body.pagination.page).toBe(2);
      expect(body.pagination.totalPages).toBe(3);
    });

    it('searches approvals server-side and returns computed risk metadata', async () => {
      const items = [
        { ...existingApproval, id: 31, entity_no: 'AP-SEARCH-31', request_data: JSON.stringify({ amount: 12000, reason: 'Special charity discount', patientName: 'Hasan Ali' }) },
        { ...existingApproval, id: 32, entity_no: 'AP-OTHER-32', request_data: JSON.stringify({ amount: 700, reason: 'Normal edit', patientName: 'Rina Begum' }) },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const res = await app.request('/approvals?search=hasan&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; approval_amount: number; approval_risk: string; bulk_approve_allowed: boolean; approval_note_required: boolean }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(31);
      expect(body.data[0].approval_amount).toBe(12000);
      expect(body.data[0].approval_risk).toBe('high');
      expect(body.data[0].bulk_approve_allowed).toBe(false);
      expect(body.data[0].approval_note_required).toBe(true);
    });

    it('normalizes credit discharge minor-unit totals and requires individual noted review', async () => {
      const creditApproval = {
        ...existingApproval,
        id: 501,
        type: 'manual_adjustment',
        entity_id: 22,
        entity_no: 'ADM-000022',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          approvalKind: 'credit_discharge',
          patientName: 'Marufa Begum',
          totalDueMinor: 670000,
          creditReason: 'Guardian will pay after salary',
          actionState: 'executed_pending_review',
        }),
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [creditApproval] },
      });

      const res = await app.request('/approvals?status=pending&type=credit_discharge&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        data: Array<{
          type: string;
          approval_amount: number;
          approval_risk: string;
          bulk_approve_allowed: boolean;
          approval_note_required: boolean;
        }>;
      };

      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        type: 'credit_discharge',
        approval_amount: 6700,
        approval_risk: 'medium',
        bulk_approve_allowed: false,
        approval_note_required: true,
      });
    });

    it('applies high-risk queue filtering before pagination', async () => {
      const items = [
        { ...existingApproval, id: 33, type: 'discount', request_data: JSON.stringify({ amount: 12000, reason: 'Large discount' }) },
        { ...existingApproval, id: 34, type: 'bill_edit', request_data: JSON.stringify({ amount: 500, reason: 'Small edit' }) },
        { ...existingApproval, id: 35, type: 'refund', request_data: JSON.stringify({ amount: 15000, reason: 'Large refund' }) },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const res = await app.request('/approvals?status=pending&queueFilter=high&limit=1&page=1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ approval_risk: string }>; pagination: { total: number; totalPages: number } };
      expect(body.pagination.total).toBe(2);
      expect(body.pagination.totalPages).toBe(2);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].approval_risk).toBe('high');
    });

    it('filters missing-evidence and blocked queues on the server', async () => {
      const items = [
        { ...existingApproval, id: 36, type: 'refund', request_data: JSON.stringify({ amount: 1200, reason: 'Refund without proof' }) },
        { ...existingApproval, id: 37, type: 'bill_edit', request_data: JSON.stringify({ amount: 500, reason: 'Normal edit' }) },
        { ...existingApproval, id: 38, type: 'bill_edit', execution_status: 'failed', request_data: JSON.stringify({ amount: 500, reason: 'Execution needs retry' }) },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const missingRes = await app.request('/approvals?status=pending&queueFilter=missing_evidence&limit=10');
      expect(missingRes.status).toBe(200);
      const missingBody = await missingRes.json() as { data: Array<{ id: number; evidence_status: string }>; pagination: { total: number } };
      expect(missingBody.pagination.total).toBe(1);
      expect(missingBody.data[0]).toMatchObject({ id: 36, evidence_status: 'missing' });

      const blockedRes = await app.request('/approvals?status=pending&queueFilter=blocked&limit=10');
      expect(blockedRes.status).toBe(200);
      const blockedBody = await blockedRes.json() as { data: Array<{ id: number }>; pagination: { total: number } };
      expect(blockedBody.pagination.total).toBe(1);
      expect(blockedBody.data[0].id).toBe(38);
    });

    it('filters reviewed-today history across core approvals, handovers, and expenses', async () => {
      const today = getTodayGMT6();
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [
            { ...existingApproval, id: 38, status: 'approved', reviewed_at: `${today} 09:00:00` },
            { ...existingApproval, id: 39, status: 'approved', reviewed_at: '2026-01-01 09:00:00' },
          ],
          billing_handovers: [
            {
              id: 380,
              tenant_id: TENANT_1.id,
              handover_type: 'counter',
              handover_amount: 1500,
              due_amount: 0,
              status: 'received',
              received_by: RECEPTIONIST.id,
              receiver_counted_amount: 1450,
              receiver_variance: -50,
              admin_verification_status: 'verified',
              admin_verified_by: ADMIN_USER.id,
              admin_verified_at: `${today} 10:00:00`,
              created_at: `${today} 08:00:00`,
            },
            {
              id: 382,
              tenant_id: TENANT_1.id,
              handover_type: 'counter',
              handover_amount: 1000,
              due_amount: 0,
              status: 'received',
              received_by: RECEPTIONIST.id,
              received_at: `${today} 10:30:00`,
              receiver_counted_amount: 1000,
              receiver_variance: 0,
              admin_verification_status: null,
              created_at: `${today} 08:30:00`,
            },
          ],
          expenses: [{
            id: 381,
            tenant_id: TENANT_1.id,
            date: today,
            category: 'Fuel',
            amount: 900,
            status: 'approved',
            approval_status: 'approved',
            approved_by: ADMIN_USER.id,
            approved_at: `${today} 11:00:00`,
            created_by: RECEPTIONIST.id,
          }],
        },
      });

      const res = await app.request('/approvals?status=approved&reviewedDate=today&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; approval_source: string }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(3);
      expect(body.data.map((row) => row.approval_source).sort()).toEqual(['approval_requests', 'billing_handovers', 'expenses']);
      expect(body.data.some((row) => row.approval_source === 'billing_handovers' && row.id === 382)).toBe(false);
    });

    it('returns empty list when no approvals exist', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await app.request('/approvals');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body.data).toHaveLength(0);
      expect(body.pagination.total).toBe(0);
    });

    it('returns policy evidence SLA and execution metadata for approval center rows', async () => {
      const expenseApproval = {
        ...existingApproval,
        id: 39,
        type: 'expense',
        entity_id: 139,
        entity_no: 'EXP-139',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({ amount: 1800, reason: 'Emergency purchase', department: 'Admin' }),
        status: 'partially_approved',
        approval_count: 1,
        required_approvals: 2,
        execution_status: 'failed',
        execution_attempts: 1,
        created_at: '2026-06-11T09:00:00Z',
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [expenseApproval] },
      });

      const res = await app.request('/approvals?status=pending&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<Record<string, unknown>> };
      expect(body.data[0]).toMatchObject({
        id: 39,
        type: 'expense',
        evidence_required: true,
        evidence_status: 'missing',
        policy_reason: 'Expense requires receipt and accounts approval',
        assigned_role: 'accountant',
        execution_status: 'failed',
        execution_attempts: 1,
        approval_count: 1,
        required_approvals: 2,
        remaining_approvals: 1,
        approval_stage: 'Partially Approved (1/2)',
      });
      expect(typeof body.data[0].sla_due_at).toBe('string');
    });

    it('does not merge standalone expenses into the failed-execution queue', async () => {
      const failedApproval = {
        ...existingApproval,
        id: 41,
        type: 'refund',
        request_data: JSON.stringify({ amount: 1500, reason: 'Failed reversal' }),
        status: 'pending',
        execution_status: 'failed',
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [failedApproval],
          expenses: [{
            id: 501,
            tenant_id: TENANT_1.id,
            date: '2026-07-14',
            category: 'Fuel',
            amount: 900,
            status: 'pending',
            approval_status: 'pending',
            created_by: RECEPTIONIST.id,
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&executionStatus=failed&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; approval_source: string; execution_status: string }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data).toEqual([expect.objectContaining({ id: 41, approval_source: 'approval_requests', execution_status: 'failed' })]);
    });

    it('returns credit note policy evidence SLA metadata and keeps it unsafe for bulk approval', async () => {
      const creditNoteApproval = {
        ...existingApproval,
        id: 40,
        type: 'credit_note',
        entity_id: 140,
        entity_no: 'CN-140',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({ amount: 4200, reason: 'Advance payment adjustment', department: 'Accounts' }),
        status: 'pending',
        created_at: '2026-06-11T09:00:00Z',
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [creditNoteApproval] },
      });

      const res = await app.request('/approvals?type=credit_note&status=pending&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<Record<string, unknown>>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({
        id: 40,
        type: 'credit_note',
        approval_amount: 4200,
        approval_risk: 'medium',
        approval_note_required: true,
        bulk_approve_allowed: false,
        evidence_required: true,
        evidence_status: 'missing',
        assigned_role: 'accountant',
      });
      expect(typeof body.data[0].policy_reason).toBe('string');
      expect(typeof body.data[0].sla_due_at).toBe('string');
    });

    it('derives request-info state for list rows', async () => {
      const approvals = [
        { ...existingApproval, id: 61, requested_by: RECEPTIONIST.id, entity_no: 'AP-061' },
        { ...existingApproval, id: 62, requested_by: RECEPTIONIST.id, entity_no: 'AP-062' },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: approvals,
          approval_events: [
            { id: 1, tenant_id: TENANT_1.id, approval_request_id: 61, action: 'request_info', actor_id: ADMIN_USER.id, notes: 'Upload receipt', metadata: JSON.stringify({ missingItems: ['receipt'] }), created_at: '2026-06-11T09:00:00Z' },
            { id: 2, tenant_id: TENANT_1.id, approval_request_id: 62, action: 'request_info', actor_id: ADMIN_USER.id, notes: 'Upload voucher', metadata: JSON.stringify({ missingItems: ['voucher'] }), created_at: '2026-06-11T09:00:00Z' },
            { id: 3, tenant_id: TENANT_1.id, approval_request_id: 62, action: 'info_submitted', actor_id: RECEPTIONIST.id, notes: 'Voucher attached', metadata: JSON.stringify({}), created_at: '2026-06-11T10:00:00Z' },
          ],
        },
      });

      const res = await app.request('/approvals?status=pending&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<Record<string, unknown>> };
      const first = body.data.find((item) => item.id === 61);
      const second = body.data.find((item) => item.id === 62);
      expect(first).toMatchObject({ info_request_status: 'requested', info_request_note: 'Upload receipt' });
      expect(second).toMatchObject({ info_request_status: 'submitted', info_response_note: 'Voucher attached' });
    });

    it('excludes legacy zero-variance handovers from pending approval', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 77,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            due_amount: 0,
            status: 'receiver_verified',
            handover_by: 1,
            handover_to: 2,
            received_by: 2,
            received_at: '2026-06-23 10:15:00',
            receiver_counted_amount: 1500,
            receiver_variance: 0,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-23 10:00:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(0);
      expect(body.data).toEqual([]);
    });

    it('keeps incomplete legacy receiver verification pending instead of auto-completing without evidence', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 80,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            due_amount: 0,
            status: 'receiver_verified',
            handover_by: 1,
            handover_to: 2,
            received_by: null,
            received_at: null,
            receiver_counted_amount: null,
            receiver_variance: 0,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-23 10:00:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; evidence_status: string }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 80, evidence_status: 'missing' });
    });

    it('keeps legacy mismatched receiver counts pending even when stored variance defaulted to zero', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 79,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            due_amount: 0,
            status: 'receiver_verified',
            handover_by: 1,
            handover_to: 2,
            received_by: 2,
            received_at: '2026-06-23 10:15:00',
            receiver_counted_amount: 1450,
            receiver_variance: 0,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-23 10:00:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; request_data: Record<string, unknown> }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0].id).toBe(79);
      expect(body.data[0].request_data.variance).toBe(-50);
    });

    it('includes disputed handovers with receiver count as provided system evidence', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 78,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            due_amount: 0,
            status: 'disputed',
            handover_by: 1,
            handover_to: 2,
            received_by: 2,
            received_at: '2026-06-23 10:15:00',
            receiver_counted_amount: 1450,
            receiver_variance: -50,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-23 10:00:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; approval_key?: string; type: string; entity_id: number; approval_source?: string; evidence_required: boolean; evidence_status: string; request_data: Record<string, unknown> }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 78, approval_key: 'billing_handovers:78', type: 'cash_handover', entity_id: 78, approval_source: 'billing_handovers', evidence_required: true, evidence_status: 'provided' });
      expect(body.data[0].request_data.amount).toBe(1450);
      expect(body.data[0].request_data.variance).toBe(-50);
      expect(body.data[0].request_data.reason).toMatch(/variance|dispute/i);
    });

    it('shows one-of-two progress and blocks the same reviewer for synthetic cash handovers', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        userId: 9,
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 178,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            due_amount: 0,
            status: 'disputed',
            handover_by: 1,
            handover_to: 2,
            received_by: 2,
            received_at: '2026-06-23 10:15:00',
            receiver_counted_amount: 1450,
            receiver_variance: -50,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-23 10:00:00',
          }],
          approval_decisions: [{
            id: 701,
            tenant_id: TENANT_1.id,
            approval_source: 'billing_handovers',
            approval_request_id: 178,
            approver_id: 9,
            approver_role: 'hospital_admin',
            decision: 'approve',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        data: Array<{
          id: number;
          status: string;
          approval_count: number;
          required_approvals: number;
          remaining_approvals: number;
          approval_stage: string;
          current_user_approved: boolean;
          can_current_user_approve: boolean;
          approval_blocked_reason: string | null;
        }>;
      };
      expect(body.data[0]).toMatchObject({
        id: 178,
        status: 'partially_approved',
        approval_count: 1,
        required_approvals: 2,
        remaining_approvals: 1,
        approval_stage: 'Partially Approved (1/2)',
        current_user_approved: true,
        can_current_user_approve: false,
        approval_blocked_reason: 'You already approved this request',
      });
    });

    it('exposes failed receivable write-off execution as retryable only to a different reviewer', async () => {
      const failedWriteOff = {
        id: 191,
        tenant_id: TENANT_1.id,
        type: 'receivable_write_off',
        entity_id: 44,
        entity_no: 'INV-101',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({ amountMinor: 3000, currencyCode: 'BDT' }),
        status: 'approved',
        execution_status: 'failed',
        execution_error: 'Live due changed before execution',
        approval_count: 2,
        required_approvals: 2,
        created_at: '2026-07-23 10:00:00',
      };
      const reviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        userId: ADMIN_USER.id,
        tenantId: TENANT_1.id,
        tables: { approval_requests: [failedWriteOff] },
      });

      const reviewerRes = await reviewer.app.request('/approvals?status=approved&type=receivable_write_off&limit=100');
      expect(reviewerRes.status).toBe(200);
      const reviewerBody = await reviewerRes.json() as { data: Array<Record<string, unknown>> };
      expect(reviewerBody.data[0]).toMatchObject({
        id: 191,
        status: 'approved',
        execution_status: 'failed',
        can_current_user_approve: true,
        approval_blocked_reason: null,
      });

      const requester = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        userId: RECEPTIONIST.id,
        tenantId: TENANT_1.id,
        tables: { approval_requests: [failedWriteOff] },
      });
      const requesterRes = await requester.app.request('/approvals?status=approved&type=receivable_write_off&limit=100');
      const requesterBody = await requesterRes.json() as { data: Array<Record<string, unknown>> };
      expect(requesterBody.data[0]).toMatchObject({
        can_current_user_approve: false,
        approval_blocked_reason: 'You cannot approve your own request',
      });
    });

    it('uses staff names for synthetic cash handover approval rows', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 117,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 3250,
            due_amount: 0,
            status: 'disputed',
            handover_by: 117,
            handover_by_name: 'Safaoat Ullah',
            handover_to: 2,
            handover_to_name: 'Admin Receiver',
            received_by: 2,
            received_by_name: 'Admin Receiver',
            received_at: '2026-06-29 14:35:00',
            receiver_counted_amount: 3200,
            receiver_variance: -50,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-29 14:35:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ requested_by_name?: string; request_data: Record<string, unknown> }> };
      expect(body.data[0].requested_by_name).toBe('Safaoat Ullah');
      expect(body.data[0].request_data.requestedBy).toBe('Safaoat Ullah');
      expect(body.data[0].request_data.receiverName).toBe('Admin Receiver');
    });

    it('keeps clean completed handovers visible in approved history without admin approval', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 116,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 2500,
            due_amount: 0,
            status: 'received',
            handover_by: 117,
            handover_to: 2,
            received_by: 2,
            received_at: '2026-06-29 14:35:00',
            receiver_counted_amount: 2500,
            receiver_variance: 0,
            admin_verification_status: null,
            created_at: '2026-06-29 14:35:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=approved&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; status: string; request_data: Record<string, unknown> }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 116, status: 'approved' });
      expect(body.data[0].request_data.reason).toMatch(/no variance|not required/i);
    });

    it('keeps admin-verified cash handovers visible in approved history', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 118,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 4200,
            due_amount: 0,
            status: 'received',
            handover_by: 117,
            handover_by_name: 'Safaoat Ullah',
            handover_to: 2,
            received_by: 2,
            receiver_counted_amount: 4200,
            receiver_variance: 0,
            admin_verification_status: 'verified',
            admin_verified_by: 1,
            admin_verified_by_name: 'Admin User',
            admin_verified_at: '2026-06-29 15:00:00',
            created_at: '2026-06-29 14:50:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=approved&type=cash_handover&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; status: string; reviewed_by_name?: string | null; request_data: Record<string, unknown> }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 118, status: 'approved', reviewed_by_name: 'Admin User' });
      expect(body.data[0].request_data.reason).toMatch(/completed/i);
    });


    it('includes pending expenses as centralized expense approvals', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          expenses: [{
            id: 501,
            tenant_id: TENANT_1.id,
            date: '2026-06-25',
            category: 'Fuel',
            amount: 3200,
            description: 'Ambulance fuel',
            status: 'pending',
            approval_status: 'pending',
            payment_status: 'unpaid',
            receipt_status: 'uploaded',
            created_by: ADMIN_USER.id,
            created_at: '2026-06-25 09:00:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=pending&type=expense&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; type: string; entity_id: number; approval_source: string; approval_amount: number; approval_risk: string; bulk_approve_allowed: boolean; request_data: Record<string, unknown> }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 501, type: 'expense', entity_id: 501, approval_source: 'expenses', approval_amount: 3200, approval_risk: 'medium', bulk_approve_allowed: false });
      expect(body.data[0].request_data.reason).toBe('Ambulance fuel');
      expect(body.data[0].request_data.category).toBe('Fuel');
    });

    it('returns approved expenses in approval history filters', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          expenses: [{
            id: 502,
            tenant_id: TENANT_1.id,
            date: '2026-06-25',
            category: 'Medicine',
            amount: 900,
            description: 'Emergency medicine purchase',
            status: 'approved',
            approval_status: 'approved',
            payment_status: 'unpaid',
            receipt_status: 'uploaded',
            created_by: ADMIN_USER.id,
            approved_by: OTHER_USER.id,
            approved_at: '2026-06-25 11:00:00',
            created_at: '2026-06-25 09:00:00',
          }],
        },
      });

      const res = await app.request('/approvals?status=approved&type=expense&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; status: string; type: string; approval_source: string; reviewed_by: number }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 502, type: 'expense', status: 'approved', approval_source: 'expenses', reviewed_by: OTHER_USER.id });
    });

    it('searches centralized expense approvals by payee and category', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          expenses: [
            { id: 503, tenant_id: TENANT_1.id, date: '2026-06-25', category: 'Fuel', payee_name: 'Rahim Pump', amount: 1200, description: 'Ambulance fuel', status: 'pending', approval_status: 'pending', created_by: ADMIN_USER.id },
            { id: 504, tenant_id: TENANT_1.id, date: '2026-06-25', category: 'Stationery', payee_name: 'Office Store', amount: 500, description: 'Paper', status: 'pending', approval_status: 'pending', created_by: ADMIN_USER.id },
          ],
        },
      });

      const res = await app.request('/approvals?status=pending&type=expense&search=pump&limit=100');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; request_data: Record<string, unknown> }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0].id).toBe(503);
      expect(body.data[0].request_data.payeeName).toBe('Rahim Pump');
    });

    it('includes legacy cash closing approval rows in the cash handover tab', async () => {
      const cashClosingApproval = {
        ...existingApproval,
        id: 91,
        type: 'cash_closing',
        entity_id: 91,
        entity_no: 'CASH-91',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({ amount: 2500, reason: 'Counter close variance review' }),
        status: 'pending',
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [cashClosingApproval] },
      });

      const res = await app.request('/approvals?type=cash_handover&status=pending&limit=10');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ id: number; approval_key?: string; type: string; approval_source?: string }>; pagination: { total: number } };
      expect(body.pagination.total).toBe(1);
      expect(body.data[0]).toMatchObject({ id: 91, approval_key: 'approval_requests:91', type: 'cash_handover', approval_source: 'approval_requests' });
    });

    it('returns 400 for invalid type filter', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await app.request('/approvals?type=invalid');
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid status filter', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await app.request('/approvals?status=invalid');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /approvals/summary — approval center KPI summary', () => {
    it('exposes the reusable operational summary service contract', async () => {
      const { mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [],
          expenses: [],
          approval_events: [],
        },
      });

      const summary = await loadApprovalOperationalSummary(mockDB.db, TENANT_1.id);

      expect(summary).toEqual(expect.objectContaining({
        totalPending: 0,
        highPriority: 0,
        cashHandoverPending: 0,
        expensePending: 0,
        totalPendingAmount: 0,
        pendingByType: {},
      }));
    });

    it('counts legacy cash closing approval rows as cash handover pending in summary', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [{
            ...existingApproval,
            id: 81,
            type: 'cash_closing',
            status: 'pending',
            request_data: JSON.stringify({ amount: 700, reason: 'Counter close review' }),
          }],
          billing_handovers: [{
            id: 82,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            status: 'disputed',
            receiver_counted_amount: 1480,
            receiver_variance: -20,
            admin_verification_status: 'pending_admin',
            created_at: '2026-06-23 10:00:00',
          }],
        },
      });

      const res = await app.request('/approvals/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.cashHandoverPending).toBe(2);
      expect(body.data.totalPending).toBe(2);
    });

    it('reports storage-aliased credit discharge separately from manual adjustments', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [
            {
              ...existingApproval,
              id: 83,
              type: 'manual_adjustment',
              status: 'pending',
              request_data: JSON.stringify({
                approvalKind: 'credit_discharge',
                totalDueMinor: 670000,
                creditReason: 'Guardian will pay later',
              }),
            },
            {
              ...existingApproval,
              id: 84,
              type: 'manual_adjustment',
              status: 'pending',
              request_data: JSON.stringify({ amount: 300, reason: 'Ledger correction' }),
            },
          ],
        },
      });

      const res = await app.request('/approvals/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        data: { pendingByType: Record<string, number>; totalPendingAmount: number };
      };
      expect(body.data.pendingByType).toMatchObject({
        credit_discharge: 1,
        manual_adjustment: 1,
      });
      expect(body.data.totalPendingAmount).toBe(7000);
    });

    it('returns server-side pending high-risk stale and reviewed-today counts', async () => {
      const today = getTodayGMT6();
      const staleCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const items = [
        {
          ...existingApproval,
          id: 1,
          type: 'discount',
          status: 'pending',
          request_data: JSON.stringify({ amount: 12000, reason: 'Large discount' }),
          created_at: staleCreatedAt,
        },
        {
          ...existingApproval,
          id: 2,
          type: 'bill_edit',
          status: 'pending',
          request_data: JSON.stringify({ amount: 500, reason: 'Small edit' }),
          created_at: new Date().toISOString(),
        },
        {
          ...existingApproval,
          id: 3,
          type: 'bill_edit',
          status: 'approved',
          reviewed_at: `${today} 11:00:00`,
        },
        {
          ...existingApproval,
          id: 4,
          type: 'refund',
          status: 'rejected',
          reviewed_at: `${today} 12:00:00`,
        },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: items,
          billing_handovers: [{
            id: 77,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            status: 'receiver_verified',
            admin_verification_status: 'pending_admin',
            receiver_variance: 20,
            created_at: staleCreatedAt,
          }],
        },
      });

      const res = await app.request('/approvals/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.totalPending).toBe(3);
      expect(body.data.highPriority).toBe(2);
      expect(body.data.olderThan24h).toBeGreaterThanOrEqual(2);
      expect(body.data.todayApproved).toBe(1);
      expect(body.data.rejectedToday).toBe(1);
      expect(body.data.cashHandoverPending).toBe(1);
      expect(body.data.missingEvidence).toBeGreaterThanOrEqual(2);
      expect(body.data.executionFailed).toBe(0);
    });

    it('includes reviewed handovers and expenses in today resolution metrics', async () => {
      const today = getTodayGMT6();
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [
            {
              id: 390,
              tenant_id: TENANT_1.id,
              handover_type: 'counter',
              handover_amount: 1500,
              due_amount: 0,
              status: 'received',
              received_by: RECEPTIONIST.id,
              receiver_counted_amount: 1450,
              receiver_variance: -50,
              admin_verification_status: 'verified',
              admin_verified_by: ADMIN_USER.id,
              admin_verified_at: `${today} 10:00:00`,
              created_at: `${today} 08:00:00`,
            },
            {
              id: 393,
              tenant_id: TENANT_1.id,
              handover_type: 'counter',
              handover_amount: 1000,
              due_amount: 0,
              status: 'received',
              received_by: RECEPTIONIST.id,
              received_at: `${today} 10:30:00`,
              receiver_counted_amount: 1000,
              receiver_variance: 0,
              admin_verification_status: null,
              created_at: `${today} 08:30:00`,
            },
          ],
          expenses: [
            {
              id: 391,
              tenant_id: TENANT_1.id,
              date: today,
              category: 'Fuel',
              amount: 900,
              status: 'approved',
              approval_status: 'approved',
              approved_by: ADMIN_USER.id,
              approved_at: `${today} 11:00:00`,
              created_by: RECEPTIONIST.id,
            },
            {
              id: 392,
              tenant_id: TENANT_1.id,
              date: today,
              category: 'Stationery',
              amount: 500,
              status: 'rejected',
              approval_status: 'rejected',
              approved_by: ADMIN_USER.id,
              approved_at: `${today} 12:00:00`,
              created_by: RECEPTIONIST.id,
            },
          ],
        },
      });

      const res = await app.request('/approvals/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.todayApproved).toBe(2);
      expect(body.data.rejectedToday).toBe(1);
    });

    it('counts missing evidence and failed execution in summary', async () => {
      const items = [
        {
          ...existingApproval,
          id: 21,
          type: 'expense',
          status: 'pending',
          execution_status: 'failed',
          request_data: JSON.stringify({ amount: 1800, reason: 'Receipt missing' }),
        },
        {
          ...existingApproval,
          id: 22,
          type: 'discount',
          status: 'pending',
          request_data: JSON.stringify({ amount: 500, reason: 'Small discount' }),
        },
        {
          ...existingApproval,
          id: 23,
          type: 'receivable_write_off',
          status: 'approved',
          execution_status: 'failed',
          reviewed_at: '2026-06-11 11:00:00',
          request_data: JSON.stringify({ amountMinor: 3000, currencyCode: 'BDT', note: 'Execution recovery required.' }),
        },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: items,
          approval_events: [
            { id: 1, tenant_id: TENANT_1.id, approval_request_id: 21, action: 'request_info', actor_id: ADMIN_USER.id, notes: 'Need receipt', metadata: JSON.stringify({ missingItems: ['receipt'] }), created_at: '2026-06-11T09:00:00Z' },
            { id: 2, tenant_id: TENANT_1.id, approval_request_id: 22, action: 'request_info', actor_id: ADMIN_USER.id, notes: 'Need note', metadata: JSON.stringify({}), created_at: '2026-06-11T09:00:00Z' },
            { id: 3, tenant_id: TENANT_1.id, approval_request_id: 22, action: 'info_submitted', actor_id: RECEPTIONIST.id, notes: 'Note added', metadata: JSON.stringify({}), created_at: '2026-06-11T10:00:00Z' },
          ],
        },
      });

      const res = await app.request('/approvals/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.missingEvidence).toBe(1);
      expect(body.data.executionFailed).toBe(2);
      expect(body.data.infoRequested).toBe(1);
      expect(body.data.infoSubmitted).toBe(1);
    });
  });

    it('includes pending expenses in KPI summary totals', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          expenses: [{ id: 701, tenant_id: TENANT_1.id, date: '2026-06-25', category: 'Fuel', amount: 12000, status: 'pending', approval_status: 'pending', created_by: ADMIN_USER.id, created_at: '2026-06-25 09:00:00' }],
        },
      });

      const res = await app.request('/approvals/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.totalPending).toBe(1);
      expect(body.data.highPriority).toBe(1);
      expect(body.data.expensePending).toBe(1);
    });

  describe('GET /approvals/counts — pending counts per type', () => {
    it('returns counts grouped by type', async () => {
      const items = [
        { ...existingApproval, id: 1, type: 'bill_edit', status: 'pending' },
        { ...existingApproval, id: 2, type: 'bill_edit', status: 'pending' },
        { ...existingApproval, id: 3, type: 'bill_cancel', status: 'pending' },
        { ...existingApproval, id: 4, type: 'bill_edit', status: 'approved' },
      ];

      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const res = await app.request('/approvals/counts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.bill_edit).toBe(2);
      expect(body.data.bill_cancel).toBe(1);
    });

    it('canonicalizes legacy aliases in pending type counts', async () => {
      const items = [
        { ...existingApproval, id: 11, type: 'cash_closing', status: 'pending' },
        { ...existingApproval, id: 12, type: 'shift_handover', status: 'pending' },
        { ...existingApproval, id: 13, type: 'bill_cancellation', status: 'pending' },
        { ...existingApproval, id: 14, type: 'discount_approval', status: 'pending' },
      ];

      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: items },
      });

      const res = await app.request('/approvals/counts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.cash_handover).toBe(2);
      expect(body.data.bill_cancel).toBe(1);
      expect(body.data.discount).toBe(1);
      expect(body.data.cash_closing).toBeUndefined();
      expect(body.data.bill_cancellation).toBeUndefined();
    });

    it('includes pending cash handover final verifications in counts', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          billing_handovers: [{
            id: 77,
            tenant_id: TENANT_1.id,
            handover_type: 'counter',
            handover_amount: 1500,
            status: 'disputed',
            receiver_counted_amount: 1450,
            receiver_variance: -50,
            admin_verification_status: 'pending_admin',
          }],
        },
      });

      const res = await app.request('/approvals/counts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.cash_handover).toBe(1);
    });

    it('includes pending expenses in counts', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [],
          expenses: [{ id: 801, tenant_id: TENANT_1.id, date: '2026-06-25', category: 'Fuel', amount: 3200, status: 'pending', approval_status: 'pending', created_by: ADMIN_USER.id }],
        },
      });

      const res = await app.request('/approvals/counts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(body.data.expense).toBe(1);
    });

    it('returns empty counts when no pending approvals', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await app.request('/approvals/counts');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Record<string, number> };
      expect(Object.keys(body.data)).toHaveLength(0);
    });
  });

describe('GET /approvals — loadUserDisplayNames tenant isolation', () => {
    it('queries users strictly by tenant_id and does not widen to tenant_id IS NULL', async () => {
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [
            {
              ...existingApproval,
              id: 41,
              requested_by: 999,
              reviewed_by: 1000,
            },
          ],
          users: [
            { id: 999, name: 'Tenant 1 Requester', email: 'req@t1.test', role: 'reception', tenant_id: TENANT_1.id },
            { id: 1000, name: 'Tenant 2 Reviewer', email: 'rev@t2.test', role: 'hospital_admin', tenant_id: 'tenant-2' },
            { id: 1001, name: 'Global Director', email: 'g@test.test', role: 'director', tenant_id: null },
          ],
        },
      });

      const res = await app.request('/approvals?limit=10');
      expect(res.status).toBe(200);
      expect(await res.json()).toBeTruthy();

      // Find the user lookup query emitted by loadUserDisplayNames.
      // It must filter strictly to the current tenant — not include
      // "tenant_id IS NULL" (which previously made every NULL-tenant
      // user visible to every tenant).
      const userQuery = mockDB.queries.find((q) => /FROM\s+users\b/i.test(q.sql));
      expect(userQuery, 'expected a SELECT from users').toBeDefined();
      expect(userQuery!.sql).not.toMatch(/tenant_id\s+IS\s+NULL/i);
    });
  });

  describe('GET /approvals/handovers/:id/events — cash handover event trail', () => {
    it('returns receiver and admin verification events with actor names and cash metadata', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          billing_handovers: [{ id: 78, tenant_id: TENANT_1.id, handover_type: 'counter', status: 'received' }],
          cash_handover_verification_events: [
            {
              id: 1,
              tenant_id: TENANT_1.id,
              handover_id: 78,
              event_type: 'receiver_disputed',
              actor_user_id: RECEPTIONIST.id,
              actor_role: 'reception',
              counted_amount: 1450,
              expected_amount: 1500,
              variance: -50,
              decision: 'dispute',
              remarks: 'Cash is short',
              workstation_id: 'hms-ws-main',
              created_at: '2026-07-14 02:30:00',
            },
            {
              id: 2,
              tenant_id: TENANT_1.id,
              handover_id: 78,
              event_type: 'admin_final_verification',
              actor_user_id: ADMIN_USER.id,
              actor_role: 'hospital_admin',
              counted_amount: 1450,
              expected_amount: 1500,
              variance: -50,
              decision: 'approve',
              remarks: 'Variance verified',
              workstation_id: null,
              created_at: '2026-07-14 02:35:00',
            },
          ],
          users: [
            { ...RECEPTIONIST, tenant_id: TENANT_1.id },
            { ...ADMIN_USER, tenant_id: TENANT_1.id },
          ],
        },
      });

      const res = await app.request('/approvals/handovers/78/events');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<Record<string, any>> };
      expect(body.data).toHaveLength(2);
      expect(body.data[0]).toMatchObject({
        action: 'receiver_disputed',
        actor_id: RECEPTIONIST.id,
        actor_name: expect.any(String),
        new_status: 'pending',
        notes: 'Cash is short',
        metadata: {
          countedAmount: 1450,
          expectedAmount: 1500,
          variance: -50,
          decision: 'dispute',
          workstationId: 'hms-ws-main',
        },
      });
      expect(body.data[1]).toMatchObject({ action: 'admin_final_verification', new_status: 'approved' });
    });

    it('does not expose another tenant handover timeline', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          billing_handovers: [{ id: 79, tenant_id: 'tenant-2', handover_type: 'counter', status: 'disputed' }],
        },
      });

      const res = await app.request('/approvals/handovers/79/events');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /approvals/:id — dashboard review detail', () => {
    it('returns refund reason, patient, automatic allocation, cash hold, collection impact, and commission impact', async () => {
      const requestData = {
        refundKind: 'amount_partial_refund',
        paymentMethod: 'cash',
        requestedRefundAmount: 400,
        cashRefundAmount: 400,
        receivableReduction: 0,
        reason: 'Discount was entered after the bill was paid',
        counterId: 7,
        counterSessionId: 17,
      };
      const refundApproval = {
        id: 55,
        tenant_id: TENANT_1.id,
        type: 'refund',
        entity_id: 75,
        entity_no: 'INV-D-2026-000703',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify(requestData),
        status: 'pending',
        execution_status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        created_at: '2026-07-22 17:24:01',
      };
      const hold = {
        id: 9,
        tenant_id: TENANT_1.id,
        approval_request_id: 55,
        bill_id: 75,
        patient_id: 50,
        amount: 400,
        payment_method: 'cash',
        employee_id: RECEPTIONIST.id,
        counter_id: 7,
        counter_session_id: 17,
        status: 'held',
        credit_note_id: null,
        idempotency_key: 'refund-detail-55',
        held_at: '2026-07-22 17:24:01',
        consumed_at: null,
        released_at: null,
        custody_user_id: null,
        release_status: 'not_applicable',
        release_counter_session_id: null,
        release_cash_movement_id: null,
        release_credited_at: null,
      };
      const itemRows = [
        { id: 101, description: 'ECG', item_category: 'test', quantity: 1, unit_price: 400, line_total: 400, reference_id: 353, approved_credit_amount: 0 },
        { id: 102, description: 'S. Creatinine', item_category: 'test', quantity: 1, unit_price: 500, line_total: 500, reference_id: 244, approved_credit_amount: 0 },
        { id: 103, description: 'Lipid Profile', item_category: 'test', quantity: 1, unit_price: 1200, line_total: 1200, reference_id: 246, approved_credit_amount: 0 },
        { id: 104, description: 'TSH', item_category: 'test', quantity: 1, unit_price: 1200, line_total: 1200, reference_id: 293, approved_credit_amount: 0 },
      ];
      const commissionRows = itemRows.map((item, index) => ({
        id: 300 + index,
        doctor_id: 130,
        doctor_name: 'Dr. Example Three',
        patient_id: 50,
        visit_id: null,
        bill_id: 75,
        lab_order_item_id: null,
        canonical_source_key: `bill:75:line:${index + 1}:test:${item.reference_id}:doctor:130:rule:21:prescribing`,
        source_type: 'lab_test',
        gross_amount: item.line_total,
        commission_base_amount: item.line_total,
        commission_rate_bps: 2500,
        commission_flat_amount: 0,
        commission_amount: item.line_total * 0.25,
        earned_commission_amount: item.line_total * 0.25,
        doctor_waiver_amount: 0,
        payable_commission_amount: item.line_total * 0.25,
        paid_amount: 0,
        balance_amount: item.line_total * 0.25,
        status: 'accrued',
        accrued_date: '2026-07-22',
      }));
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [refundApproval],
          approval_decisions: [],
          billing_refund_cash_holds: [hold],
          users: [
            { id: ADMIN_USER.id, tenant_id: TENANT_1.id, name: 'Admin Reviewer' },
            { id: RECEPTIONIST.id, tenant_id: TENANT_1.id, name: 'Nusrat Jahan Sony' },
          ],
          approval_events: [],
        },
        queryOverride: (sql) => {
          if (/SELECT \* FROM approval_requests/i.test(sql)) return { first: refundApproval };
          if (/FROM approval_decisions/i.test(sql)) return { first: null };
          if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: hold };
          if (/FROM billing_refund_cash_disputes/i.test(sql)) return { first: null };
          if (/FROM bills b[\s\S]*LEFT JOIN patients/i.test(sql)) {
            return { first: {
              id: 75,
              invoice_no: 'INV-D-2026-000703',
              patient_id: 50,
              patient_name: 'Tania',
              patient_code: 'P-0050',
              status: 'paid',
              total: 3300,
              paid: 3300,
              due: 0,
              discount: 0,
              test_bill: 3300,
              doctor_visit_bill: 0,
              admission_bill: 0,
              operation_bill: 0,
              medicine_bill: 0,
            } };
          }
          if (/FROM payments/i.test(sql)) return { first: { id: 900, amount: 3300, payment_method: 'cash', receipt_no: 'RCP-001654', counter_id: 7, counter_session_id: 17 } };
          if (/FROM invoice_items ii/i.test(sql)) return { results: itemRows };
          if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [refundApproval] };
          if (/FROM doctor_commission_accruals dca/i.test(sql)) return { results: commissionRows };
          if (/FROM approval_events/i.test(sql)) return { results: [] };
          return null;
        },
      });

      const res = await app.request('/approvals/55');

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toMatchObject({
        id: 55,
        requested_by_name: 'Nusrat Jahan Sony',
        cash_hold: { id: 9, amount: 400, status: 'held' },
        refund_review: {
          reason: 'Discount was entered after the bill was paid',
          bill: { invoice_no: 'INV-D-2026-000703', patient_name: 'Tania', total: 3300 },
          collectionImpact: {
            before: { total: 3300, testBill: 3300 },
            after: { total: 2900, testBill: 2900 },
          },
          commissionImpact: { blocked: false },
        },
      });
      expect(body.data.refund_review.allocations).toEqual([
        expect.objectContaining({ invoiceItemId: 101, allocatedRefundAmount: 48.48 }),
        expect.objectContaining({ invoiceItemId: 102, allocatedRefundAmount: 60.61 }),
        expect.objectContaining({ invoiceItemId: 103, allocatedRefundAmount: 145.46 }),
        expect.objectContaining({ invoiceItemId: 104, allocatedRefundAmount: 145.45 }),
      ]);
      expect(body.data.refund_review.commissionImpact.rows).toHaveLength(4);
    });
  });

  describe('GET /approvals/:id/events — approval event trail', () => {
    it('returns structured approval events with parsed metadata', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          approval_requests: [existingApproval],
          approval_events: [{
            id: 501,
            tenant_id: TENANT_1.id,
            approval_request_id: 1,
            action: 'created',
            actor_id: ADMIN_USER.id,
            old_status: null,
            new_status: 'pending',
            notes: null,
            metadata: JSON.stringify({ type: 'bill_edit', entityId: 100 }),
            created_at: '2026-06-11T09:00:00Z',
          }],
        },
      });

      const res = await app.request('/approvals/1/events');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<{ action: string; metadata: Record<string, unknown> }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].action).toBe('created');
      expect(body.data[0].metadata.entityId).toBe(100);
    });

    it('returns 404 for another tenant approval events', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: 'tenant-2',
        tables: { approval_requests: [existingApproval], approval_events: [] },
      });

      const res = await app.request('/approvals/1/events');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /approvals/:id/request-info — ask for missing proof', () => {
    it('records a request-info event while keeping the approval pending', async () => {
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(testApp.app, '/approvals/1/request-info', {
        method: 'POST',
        body: { notes: 'Please upload receipt evidence', missingItems: ['receipt'] },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; requestInfoRequested: boolean } };
      expect(body.data.status).toBe('pending');
      expect(body.data.requestInfoRequested).toBe(true);
      const events = approvalEventQueries(testApp.mockDB);
      expect(events).toHaveLength(1);
      expect(events[0].params[2]).toBe('request_info');
      expect(events[0].params[4]).toBe('pending');
      expect(events[0].params[5]).toBe('pending');
    });

    it('starts a new approval revision and supersedes the existing one-of-two decision', async () => {
      const harness = createWriteOffRouteHarness();
      const approvalId = Number(harness.sqlite.prepare(`
        INSERT INTO approval_requests (
          tenant_id, type, entity_id, entity_no, requested_by, request_data,
          status, required_approvals, approval_count, approval_revision,
          first_approved_at, execution_status
        ) VALUES (
          ?, 'refund', 77, 'INV-77', ?, ?,
          'pending', 2, 1, 1,
          '2026-07-26 10:00:00', 'succeeded'
        )
      `).run(
        TENANT_1.id,
        RECEPTIONIST.id,
        JSON.stringify({
          executionMode: 'executed_pending',
          financialState: 'refunded_pending_review',
          requestedRefundAmount: 400,
        }),
      ).lastInsertRowid);
      harness.sqlite.prepare(`
        INSERT INTO approval_decisions (
          tenant_id, approval_source, approval_request_id, approval_revision,
          approver_id, approver_role, decision, notes
        ) VALUES (?, 'approval_requests', ?, 1, ?, 'md', 'approve', 'First review')
      `).run(TENANT_1.id, approvalId, ADMIN_USER.id);

      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        mockDB: routeMockDB(harness),
      });

      const res = await jsonRequest(testApp.app, `/approvals/${approvalId}/request-info`, {
        method: 'POST',
        body: {
          notes: 'Attach cashier acknowledgement',
          missingItems: ['Cashier acknowledgement'],
        },
      });

      const responseText = await res.clone().text();
      expect(res.status, responseText).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        data: {
          id: approvalId,
          status: 'pending',
          requestInfoRequested: true,
          approvalRevision: 2,
          approvalCount: 0,
          requiredApprovals: 2,
        },
      });
      expect(harness.sqlite.prepare(`
        SELECT approval_revision, approval_count, first_approved_at,
               fully_approved_at, execution_status,
               json_extract(request_data, '$.financialState') AS financial_state
        FROM approval_requests WHERE id = ?
      `).get(approvalId)).toEqual({
        approval_revision: 2,
        approval_count: 0,
        first_approved_at: null,
        fully_approved_at: null,
        execution_status: 'succeeded',
        financial_state: 'refunded_correction_required',
      });
      expect(harness.sqlite.prepare(`
        SELECT approval_revision, superseded_by_revision, superseded_reason,
               superseded_at IS NOT NULL AS is_superseded
        FROM approval_decisions WHERE approval_request_id = ?
      `).get(approvalId)).toEqual({
        approval_revision: 1,
        superseded_by_revision: 2,
        superseded_reason: 'Attach cashier acknowledgement',
        is_superseded: 1,
      });
      const event = harness.sqlite.prepare(`
        SELECT action, metadata FROM approval_events
        WHERE tenant_id = ? AND approval_request_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(TENANT_1.id, approvalId) as { action: string; metadata: string };
      expect(event.action).toBe('request_info');
      expect(JSON.parse(event.metadata)).toMatchObject({
        previousRevision: 1,
        approvalRevision: 2,
        missingItems: ['Cashier acknowledgement'],
      });
    });

    it('requires a note when asking for more information', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/request-info', {
        method: 'POST',
        body: { notes: '' },
      });

      expect(res.status).toBe(400);
    });

    it('enforces separation of duties when asking for more information', async () => {
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(testApp.app, '/approvals/1/request-info', {
        method: 'POST',
        body: { notes: 'Please attach proof' },
      });

      expect(res.status).toBe(403);
      expect(approvalEventQueries(testApp.mockDB)).toHaveLength(0);
    });

    it('returns 409 when requesting info on an already reviewed approval', async () => {
      const reviewedApproval = { ...existingApproval, status: 'approved', reviewed_by: OTHER_USER.id };
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [reviewedApproval] },
      });

      const res = await jsonRequest(testApp.app, '/approvals/1/request-info', {
        method: 'POST',
        body: { notes: 'Need extra proof' },
      });

      expect(res.status).toBe(409);
      expect(approvalEventQueries(testApp.mockDB)).toHaveLength(0);
    });

    it('returns 404 when requesting info for a missing approval', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/999/request-info', {
        method: 'POST',
        body: { notes: 'Need receipt' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid request-info id parameter', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/abc/request-info', {
        method: 'POST',
        body: { notes: 'Need receipt' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 403 for non-review roles on request-info', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: RECEPTIONIST.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/request-info', {
        method: 'POST',
        body: { notes: 'Need receipt' },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /approvals/:id/submit-info — requester submits missing proof', () => {
    it('records an info-submitted event and keeps approval pending', async () => {
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(testApp.app, '/approvals/1/submit-info', {
        method: 'POST',
        body: { notes: 'Receipt attached', receiptUrl: 'https://example.test/receipt.jpg' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; infoSubmitted: boolean } };
      expect(body.data.status).toBe('pending');
      expect(body.data.infoSubmitted).toBe(true);
      const events = approvalEventQueries(testApp.mockDB);
      expect(events).toHaveLength(1);
      expect(events[0].params[2]).toBe('info_submitted');
    });

    it('requires notes or evidence when submitting info', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/submit-info', {
        method: 'POST',
        body: { notes: '' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /approvals/:id/review — approve or reject', () => {
    it('executes a controlled receivable write-off only after two distinct route approvals', async () => {
      const harness = createWriteOffRouteHarness();
      const request = await seedWriteOffApproval(harness, 3000);
      const sharedDB = routeMockDB(harness);
      const firstReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'md',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        mockDB: sharedDB,
      });

      const firstRes = await jsonRequest(firstReviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'First independent approval after reviewing collection evidence.' },
      });
      expect(firstRes.status).toBe(200);
      await expect(firstRes.json()).resolves.toMatchObject({
        data: { status: 'partially_approved', approvalCount: 1, requiredApprovals: 2 },
      });
      expect(harness.sqlite.prepare(`SELECT due FROM bills WHERE tenant_id=? AND id=77`).get(TENANT_1.id))
        .toEqual({ due: 80 });

      const secondReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        mockDB: sharedDB,
      });
      const secondRes = await jsonRequest(secondReviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'Final independent approval after confirming the live receivable.' },
      });

      expect(secondRes.status).toBe(200);
      await expect(secondRes.json()).resolves.toMatchObject({
        data: {
          status: 'approved',
          sideEffect: {
            kind: 'receivable_write_off_executed',
            newDueMinor: 5000,
            currencyCode: 'BDT',
            collectionStatus: 'contact_due',
          },
        },
      });
      expect(harness.sqlite.prepare(`
        SELECT total, paid, due FROM bills WHERE tenant_id=? AND id=77
      `).get(TENANT_1.id)).toEqual({ total: 70, paid: 20, due: 50 });
      expect(harness.sqlite.prepare(`
        SELECT status FROM collection_cases WHERE id=?
      `).get(request.collectionCaseId)).toEqual({ status: 'contact_due' });

      const replay = await jsonRequest(secondReviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'Replay the completed execution response without another mutation.' },
      });
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        data: {
          sideEffect: {
            kind: 'receivable_write_off_executed',
            newDueMinor: 5000,
            collectionStatus: 'contact_due',
          },
        },
      });
      expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM billing_credit_notes`).get())
        .toEqual({ count: 1 });
    });

    it('retries a failed fully-approved write-off through the review route without duplicating money', async () => {
      const harness = createWriteOffRouteHarness();
      const request = await seedWriteOffApproval(harness, 8000);
      const sharedDB = routeMockDB(harness);
      const firstReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'md',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        mockDB: sharedDB,
      });
      await jsonRequest(firstReviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'First independent approval for the full write-off request.' },
      });
      harness.sqlite.prepare(`
        UPDATE bills SET total=70, due=50 WHERE tenant_id=? AND id=77
      `).run(TENANT_1.id);

      const finalReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        mockDB: sharedDB,
      });
      const failed = await jsonRequest(finalReviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'Execute the exact approved amount after live balance validation.' },
      });
      expect(failed.status).toBe(409);
      expect(harness.sqlite.prepare(`
        SELECT status, execution_status FROM approval_requests WHERE id=?
      `).get(request.approvalId)).toEqual({ status: 'approved', execution_status: 'failed' });
      expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM billing_credit_notes`).get())
        .toEqual({ count: 0 });

      harness.sqlite.prepare(`
        UPDATE bills SET total=100, due=80 WHERE tenant_id=? AND id=77
      `).run(TENANT_1.id);
      const recoveryReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: 44,
        mockDB: sharedDB,
      });
      const retried = await jsonRequest(recoveryReviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'A different authorised reviewer retries after the blocker was corrected.' },
      });
      expect(retried.status).toBe(200);
      await expect(retried.json()).resolves.toMatchObject({
        data: {
          status: 'approved',
          sideEffect: { kind: 'receivable_write_off_executed', newDueMinor: 0, collectionStatus: 'closed' },
        },
      });
      expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM billing_credit_notes`).get())
        .toEqual({ count: 1 });
    });

    it('requires the dedicated write-off approval permission even for generic approval reviewers', async () => {
      const harness = createWriteOffRouteHarness();
      const request = await seedWriteOffApproval(harness, 3000);
      const manager = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'manager',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        mockDB: routeMockDB(harness),
      });

      const res = await jsonRequest(manager.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'approve', notes: 'Attempt approval without the dedicated write-off permission.' },
      });

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        error: 'Missing permission: receivables.write_off.approve',
      });
      expect(harness.sqlite.prepare(`SELECT due FROM bills WHERE tenant_id=? AND id=77`).get(TENANT_1.id))
        .toEqual({ due: 80 });
      expect(harness.sqlite.prepare(`
        SELECT status, approval_count FROM approval_requests WHERE id=?
      `).get(request.approvalId)).toEqual({ status: 'pending', approval_count: 0 });
    });

    it('rejects a controlled write-off through the route with no financial mutation', async () => {
      const harness = createWriteOffRouteHarness();
      const request = await seedWriteOffApproval(harness, 3000);
      const reviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'md',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        mockDB: routeMockDB(harness),
      });

      const res = await jsonRequest(reviewer.app, `/approvals/${request.approvalId}/review`, {
        method: 'PUT',
        body: { action: 'reject', notes: 'Recovery follow-up remains more appropriate than a write-off.' },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        data: { status: 'rejected', collectionStatus: 'new' },
      });
      expect(harness.sqlite.prepare(`
        SELECT status, execution_status FROM approval_requests WHERE id=?
      `).get(request.approvalId)).toEqual({ status: 'rejected', execution_status: 'not_required' });
      expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM billing_credit_notes`).get())
        .toEqual({ count: 0 });
      expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM billing_mutation_idempotency_keys`).get())
        .toEqual({ count: 0 });
    });

    it('approves a credit discharge without reversing the clinical discharge', async () => {
      const creditApproval = {
        ...existingApproval,
        id: 501,
        type: 'manual_adjustment',
        entity_id: 22,
        entity_no: 'ADM-000022',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          approvalKind: 'credit_discharge',
          admissionId: 22,
          patientId: 101,
          totalDueMinor: 620000,
          actionState: 'executed_pending_review',
        }),
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [creditApproval],
          admissions: [{
            id: 22,
            tenant_id: TENANT_1.id,
            status: 'discharged',
            bill_status_on_discharge: 'credit_pending',
            bed_id: 9,
          }],
          beds: [{ id: 9, tenant_id: TENANT_1.id, status: 'cleaning' }],
          users: [{ id: RECEPTIONIST.id, tenant_id: TENANT_1.id, is_active: 1 }],
        },
      });

      const res = await jsonRequest(app, '/approvals/501/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'Credit release reviewed and approved' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; financialStatus?: string } };
      expect(body.data).toMatchObject({
        status: 'approved',
        financialStatus: 'credit_approved',
      });
      const atomicSql = mockDB.batchCalls.find((batch) => (
        batch.some((sql) => sql.includes('UPDATE approval_requests'))
        && batch.some((sql) => sql.includes('UPDATE admissions'))
      ))?.join('\n') ?? '';
      expect(atomicSql).toContain('bill_status_on_discharge = ?');
      expect(atomicSql).toContain("status = 'discharged'");
      const admissionUpdate = mockDB.queries.find((query) => query.sql.includes('UPDATE admissions'));
      expect(admissionUpdate?.params).toContain('credit_approved');
      expect(atomicSql).not.toContain("status = 'admitted'");
      expect(atomicSql).not.toContain('UPDATE beds');
      expect(atomicSql).toContain('INSERT INTO approval_events');
    });

    it('rejects a credit discharge as a financial exception without readmitting the patient', async () => {
      const creditApproval = {
        ...existingApproval,
        id: 502,
        type: 'credit_discharge',
        entity_id: 22,
        entity_no: 'ADM-000022',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          admissionId: 22,
          patientId: 101,
          totalDueMinor: 620000,
          actionState: 'executed_pending_review',
        }),
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [creditApproval],
          admissions: [{
            id: 22,
            tenant_id: TENANT_1.id,
            status: 'discharged',
            bill_status_on_discharge: 'credit_pending',
            bed_id: 9,
          }],
          beds: [{ id: 9, tenant_id: TENANT_1.id, status: 'cleaning' }],
          users: [{ id: RECEPTIONIST.id, tenant_id: TENANT_1.id, is_active: 1 }],
        },
      });

      const res = await jsonRequest(app, '/approvals/502/review', {
        method: 'PUT',
        body: { action: 'reject', notes: 'Insufficient justification; collection follow-up required' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; financialStatus?: string } };
      expect(body.data).toMatchObject({
        status: 'rejected',
        financialStatus: 'credit_rejected',
      });
      const atomicSql = mockDB.batchCalls.find((batch) => (
        batch.some((sql) => sql.includes('UPDATE approval_requests'))
        && batch.some((sql) => sql.includes('UPDATE admissions'))
      ))?.join('\n') ?? '';
      expect(atomicSql).toContain('bill_status_on_discharge = ?');
      expect(atomicSql).toContain("status = 'discharged'");
      const admissionUpdate = mockDB.queries.find((query) => query.sql.includes('UPDATE admissions'));
      expect(admissionUpdate?.params).toContain('credit_rejected');
      expect(atomicSql).not.toContain("status = 'admitted'");
      expect(atomicSql).not.toContain('UPDATE beds');
    });

    it('records the first distinct approval as partially approved', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; approvalCount: number; requiredApprovals: number } };
      expect(body.data).toMatchObject({
        status: 'partially_approved',
        approvalCount: 1,
        requiredApprovals: 2,
      });
    });

    it('records an approved event for individual reviews', async () => {
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(testApp.app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(200);
      const events = approvalEventQueries(testApp.mockDB);
      expect(events).toHaveLength(1);
      expect(events[0].params[2]).toBe('approved');
      expect(events[0].params[4]).toBe('pending');
      expect(events[0].params[5]).toBe('partially_approved');
    });

    it('executes payment reversal for legacy refund approvals on receipt entities', async () => {
      const approval = {
        ...existingApproval,
        id: 11,
        type: 'refund' as const,
        entity_id: 253,
        entity_no: 'RCP-000083',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          oldValue: { receiptNo: 'RCP-000083', amount: 1900, invoiceNo: 'INV-D-2026-000012' },
          newValue: { status: 'payment_reversal_requested' },
          reason: 'Wrong cash receipt',
        }),
        status: 'pending' as const,
      };
      const firstReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [approval],
          payments: [{ id: 253, bill_id: 5279, amount: 1900, payment_type: 'current', receipt_no: 'RCP-000083', payment_method: 'cash', counter_id: 1, counter_session_id: 2, tenant_id: TENANT_1.id, paid: 1900, total: 1900, status: 'paid' }],
          bills: [{ id: 5279, tenant_id: TENANT_1.id, paid: 1900, total: 1900, status: 'paid' }],
          billing_deposits: [],
        },
      });

      const firstRes = await jsonRequest(firstReviewer.app, '/approvals/11/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'First approval' },
      });
      expect(firstRes.status).toBe(200);
      expect(firstReviewer.mockDB.queries.some(q => q.sql.includes("execution_status = 'processing'") && q.params.includes(11))).toBe(false);

      const secondReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        mockDB: firstReviewer.mockDB,
      });
      const secondRes = await jsonRequest(secondReviewer.app, '/approvals/11/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'Second approval' },
      });

      expect(secondRes.status).toBe(200);
      const lockQueryIndex = firstReviewer.mockDB.queries.findIndex(q => q.sql.includes("execution_status = 'processing'") && q.params.includes(11));
      const reversalQueryIndex = firstReviewer.mockDB.queries.findIndex(q => q.sql.includes('INSERT INTO payments') && q.params.includes(-1900));
      expect(lockQueryIndex).toBeGreaterThan(-1);
      expect(reversalQueryIndex).toBeGreaterThan(lockQueryIndex);
      expect(firstReviewer.mockDB.queries.some(q => q.sql.includes('UPDATE bills SET paid = ?') && q.params.includes(0) && q.params.includes(1900) && q.params.includes('open'))).toBe(true);
      const events = approvalEventQueries(firstReviewer.mockDB).map((query) => query.params[2]);
      expect(events).toEqual(['approved', 'approved', 'execution_started', 'execution_succeeded']);
    });

    it('approves an executed-pending payment void without a second reversal', async () => {
      const approval = {
        ...existingApproval,
        id: 81,
        type: 'payment_void',
        entity_id: 83,
        entity_no: 'RCP-000083',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          executionMode: 'executed_pending',
          financialState: 'reversed_pending_review',
          disputeStatus: 'not_required',
          originalPaymentId: 83,
          originalAmount: 700,
          originalReceivedBy: 77,
          billId: 12,
          reversalReceiptNo: 'RVR-000001',
          counterId: 3,
          counterSessionId: 9,
          reason: 'Wrongly marked as paid',
        }),
        status: 'pending',
        execution_status: 'succeeded',
        required_approvals: 1,
        approval_count: 0,
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [approval] },
      });

      const res = await jsonRequest(app, '/approvals/81/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'Reversal is operationally valid' },
      });

      const approvalBody = await res.clone().json();
      expect(res.status, JSON.stringify(approvalBody)).toBe(200);
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO payments') && query.params.includes(-700))).toBe(false);
      expect(mockDB.queries.some((query) => query.sql.includes("execution_status = 'processing'") && query.params.includes(81))).toBe(false);
      const finalUpdate = mockDB.queries.find((query) => query.sql.includes('UPDATE approval_requests') && query.params.includes(81) && query.params.some((value) => typeof value === 'string' && value.includes('approved_reversal')));
      expect(finalUpdate).toBeDefined();
    });

    it('reviews an executed-pending refund at one-of-two and two-of-two without refunding twice', async () => {
      const approval = {
        ...existingApproval,
        id: 83,
        type: 'refund',
        entity_id: 75,
        entity_no: 'INV-75',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          refundKind: 'item_partial_refund',
          executionMode: 'executed_pending',
          financialState: 'refunded_pending_review',
          cashHoldStatus: 'consumed',
          approvalRevision: 1,
          requestedRefundAmount: 800,
          cashRefundAmount: 800,
          receivableReduction: 0,
          creditNoteNo: 'CN-000083',
          counterId: 3,
          counterSessionId: 9,
          reason: 'Service was not performed',
        }),
        status: 'pending',
        execution_status: 'succeeded',
        required_approvals: 2,
        approval_count: 0,
        approval_revision: 1,
      };
      const firstReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [approval], approval_decisions: [] },
      });

      const firstRes = await jsonRequest(firstReviewer.app, '/approvals/83/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'First review completed' },
      });
      expect(firstRes.status).toBe(200);
      await expect(firstRes.json()).resolves.toMatchObject({
        data: { status: 'partially_approved', approvalCount: 1, requiredApprovals: 2 },
      });

      const secondReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        mockDB: firstReviewer.mockDB,
      });
      const secondRes = await jsonRequest(secondReviewer.app, '/approvals/83/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'Second review completed' },
      });
      const responseText = await secondRes.clone().text();
      expect(secondRes.status, responseText).toBe(200);
      await expect(secondRes.json()).resolves.toMatchObject({
        data: {
          status: 'approved',
          executionStatus: 'succeeded',
          financialState: 'approved_refund',
          approvalCount: 2,
          requiredApprovals: 2,
        },
      });

      expect(firstReviewer.mockDB.queries.some((query) => /INSERT INTO billing_credit_notes/i.test(query.sql))).toBe(false);
      expect(firstReviewer.mockDB.queries.some((query) => /INSERT INTO emp_cash_transactions/i.test(query.sql) && /SalesReturn/i.test(query.sql))).toBe(false);
      expect(firstReviewer.mockDB.queries.some((query) => query.sql.includes("execution_status = 'processing'") && query.params.includes(83))).toBe(false);
      const finalUpdate = firstReviewer.mockDB.queries.find((query) =>
        /UPDATE approval_requests/i.test(query.sql)
        && query.params.includes(83)
        && query.params.some((value) => typeof value === 'string' && value.includes('approved_refund'))
      );
      expect(finalUpdate).toBeDefined();
    });

    it('requires an idempotency key before rejecting an executed-pending refund', async () => {
      const approval = {
        ...existingApproval,
        id: 84,
        type: 'refund',
        entity_id: 75,
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          executionMode: 'executed_pending',
          financialState: 'refunded_pending_review',
          cashHoldStatus: 'consumed',
          requestedRefundAmount: 400,
          cashRefundAmount: 400,
          receivableReduction: 0,
          creditNoteNo: 'CN-000084',
          originalBill: { total: 1000, paid: 1000, due: 0, status: 'paid', testBill: 1000, doctorVisitBill: 0, admissionBill: 0, operationBill: 0, medicineBill: 0 },
          refundedBill: { total: 600, paid: 600, due: 0, status: 'paid', testBill: 600, doctorVisitBill: 0, admissionBill: 0, operationBill: 0, medicineBill: 0 },
        }),
        status: 'pending',
        execution_status: 'succeeded',
      };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [approval] },
      });

      const res = await jsonRequest(app, '/approvals/84/review', {
        method: 'PUT',
        body: { action: 'reject', notes: 'Refund evidence is invalid' },
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: 'Idempotency key is required for executed refund rejection',
      });
    });

    it('replays the same executed refund rejection and blocks a conflicting replay', async () => {
      const approval = {
        ...existingApproval,
        id: 85,
        type: 'refund',
        entity_id: 75,
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          executionMode: 'executed_pending',
          executionStatus: 'succeeded',
          financialState: 'refund_reversed_disputed',
          cashHoldStatus: 'disputed',
          disputeStatus: 'open',
          cashResolution: 'open_dispute',
          cashReturnedAcknowledged: false,
          rejectionIdempotencyKey: 'refund-reject-85',
          canonicalRefundPublicId: 'crrefund_ABC',
          canonicalReversalPublicId: 'crfrv_ABC',
        }),
        status: 'rejected',
        execution_status: 'succeeded',
      };
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'director',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [approval] },
      });

      const replay = await jsonRequest(testApp.app, '/approvals/85/review', {
        method: 'PUT',
        body: {
          action: 'reject',
          notes: 'Refund evidence is invalid',
          idempotencyKey: 'refund-reject-85',
        },
      });
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        data: {
          id: 85,
          status: 'rejected',
          replayed: true,
          cashResolution: 'open_dispute',
          cashHoldStatus: 'disputed',
          disputeStatus: 'open',
        },
      });

      const conflict = await jsonRequest(testApp.app, '/approvals/85/review', {
        method: 'PUT',
        body: {
          action: 'reject',
          notes: 'Refund evidence is invalid',
          idempotencyKey: 'refund-reject-different',
        },
      });
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({
        error: 'Executed refund rejection conflicts with the committed result',
      });
      expect(testApp.mockDB.queries.some((query) => /UPDATE bills/i.test(query.sql))).toBe(false);
      expect(testApp.mockDB.queries.some((query) => /INSERT INTO cash_drawer_movements/i.test(query.sql))).toBe(false);
    });

    it('rejects an executed-pending payment void into an operational dispute without undoing the reversal', async () => {
      const approval = {
        ...existingApproval,
        id: 82,
        type: 'payment_void',
        entity_id: 83,
        entity_no: 'RCP-000083',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          executionMode: 'executed_pending',
          financialState: 'reversed_pending_review',
          disputeStatus: 'not_required',
          originalPaymentId: 83,
          originalAmount: 700,
          originalReceivedBy: 77,
          billId: 12,
          reversalReceiptNo: 'RVR-000001',
          counterId: 3,
          counterSessionId: 9,
          paymentMethod: 'cash',
          reason: 'Wrongly marked as paid',
        }),
        status: 'pending',
        execution_status: 'succeeded',
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [approval], billing_payment_void_disputes: [] },
      });

      const res = await jsonRequest(app, '/approvals/82/review', {
        method: 'PUT',
        body: { action: 'reject', notes: 'Cashier must explain this correction' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string; dispute?: { status: string; accountableEmployeeId: number } } };
      expect(body.data).toMatchObject({
        status: 'rejected',
        dispute: { status: 'open', accountableEmployeeId: 77 },
      });
      const disputeInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO billing_payment_void_disputes'));
      expect(disputeInsert?.params).toEqual(expect.arrayContaining([82, 83, 12, 'RVR-000001', RECEPTIONIST.id, 77, 700, 'cash', 'Cashier must explain this correction', ADMIN_USER.id]));
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO payments'))).toBe(false);
      expect(mockDB.queries.some((query) => query.sql.includes('UPDATE bills SET paid'))).toBe(false);
    });

    it('rejects a pending request with notes', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'reject', notes: 'Incorrect information' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('rejected');
    });

    it('reopens the requester dispute when an authorized write-off request is rejected', async () => {
      const writeoffApproval = {
        ...existingApproval,
        id: 70,
        type: 'manual_adjustment',
        entity_id: 31,
        entity_no: 'RCD-31',
        requested_by: RECEPTIONIST.id,
        request_data: JSON.stringify({
          kind: 'refund_dispute_writeoff',
          refundDisputeId: 31,
          refundCashHoldId: 9,
          originalRefundApprovalRequestId: 55,
          amount: 400,
          reason: 'Recognize unrecovered cash shortage',
        }),
        status: 'pending',
        execution_status: 'pending',
      };
      const dispute = {
        id: 31,
        tenant_id: TENANT_1.id,
        refund_cash_hold_id: 9,
        approval_request_id: 55,
        bill_id: 75,
        requester_user_id: RECEPTIONIST.id,
        amount: 400,
        status: 'writeoff_pending',
        rejection_reason: 'Refund request rejected',
        rejected_by: ADMIN_USER.id,
        counter_id: 7,
        counter_session_id: 17,
        settlement_method: 'authorized_writeoff',
        settlement_reference_type: 'approval_request',
        settlement_reference_id: 70,
        settlement_idempotency_key: 'writeoff-dispute-31',
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: {
          approval_requests: [writeoffApproval],
          billing_refund_cash_disputes: [dispute],
        },
        queryOverride: (sql) => {
          if (/UPDATE approval_requests[\s\S]*status = 'rejected'/i.test(sql)) return { meta: { changes: 1 } };
          if (/UPDATE billing_refund_cash_disputes[\s\S]*status = 'open'/i.test(sql)) return { meta: { changes: 1 } };
          return null;
        },
      });

      const res = await jsonRequest(app, '/approvals/70/review', {
        method: 'PUT',
        body: { action: 'reject', notes: 'Recover the cash instead of writing it off' },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        data: { status: 'rejected', refundDisputeId: 31, disputeStatus: 'open' },
      });
      expect(mockDB.batchCalls.some((batch) =>
        batch.some((sql) => /UPDATE billing_refund_cash_disputes[\s\S]*status = 'open'/i.test(sql)),
      )).toBe(true);
    });

    it('enforces separation of duties — cannot approve own request', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id, // same as requested_by
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(403);
    });

    it('requires notes for rejection', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'reject' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 for already reviewed request', async () => {
      const reviewedApproval = { ...existingApproval, status: 'approved', reviewed_by: 2 };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [reviewedApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(409);
    });

    it('returns 404 for non-existent request', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/999/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id parameter', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/abc/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for negative id parameter', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/-1/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 403 for non-admin role on review', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid action', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [existingApproval] },
      });

      const res = await jsonRequest(app, '/approvals/1/review', {
        method: 'PUT',
        body: { action: 'cancel' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /approvals/bulk-review — bulk approve or reject', () => {
    const bulkIds = [1, 2, 3].map(id => ({
      ...existingApproval,
      id,
      type: 'bill_edit' as const,
      status: 'pending' as const,
      entity_id: 100 + id,
      entity_no: `INV-00${id}`,
      requested_by: OTHER_USER.id, // different from reviewer (ADMIN_USER) to satisfy separation of duties
    }));

    it('records the first approval for multiple pending requests', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id, // reviewer
        tables: { approval_requests: bulkIds },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2, 3], action: 'approve' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        data: { requested: number; succeeded: number; failed: number; status: string };
      };
      expect(body.data.requested).toBe(3);
      expect(body.data.succeeded).toBe(3);
      expect(body.data.failed).toBe(0);
      expect(body.data.status).toBe('partially_approved');
    });

    it('records one event per successful bulk review item', async () => {
      const testApp = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: bulkIds },
      });

      const res = await jsonRequest(testApp.app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2, 3], action: 'approve' },
      });

      expect(res.status).toBe(200);
      const events = approvalEventQueries(testApp.mockDB);
      expect(events).toHaveLength(3);
      expect(events.map((event) => event.params[2])).toEqual(['bulk_approved', 'bulk_approved', 'bulk_approved']);
    });

    it('blocks credit note bulk approval because it requires individual review', async () => {
      const approval = {
        ...existingApproval,
        id: 12,
        type: 'credit_note' as const,
        entity_id: 512,
        entity_no: 'CN-512',
        requested_by: OTHER_USER.id,
        request_data: JSON.stringify({ amount: 3200, reason: 'Credit note needs accounting review' }),
        status: 'pending' as const,
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [approval] },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [12], action: 'approve', notes: 'Approved' },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { unsafeIds?: number[]; unsafeTypes?: string[] };
      expect(body.unsafeIds).toContain(12);
      expect(body.unsafeTypes).toContain('credit_note');
      expect(approvalEventQueries(mockDB)).toHaveLength(0);
    });

    it('blocks payment reversal during bulk approval because it requires individual review', async () => {
      const approval = {
        ...existingApproval,
        id: 10,
        type: 'payment_void' as const,
        entity_id: 83,
        entity_no: 'RCP-000083',
        requested_by: OTHER_USER.id,
        request_data: JSON.stringify({ reason: 'Wrong receipt' }),
        status: 'pending' as const,
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [approval],
          payments: [{ id: 83, bill_id: 12, amount: 1900, payment_type: 'receipt', receipt_no: 'RCP-000083', payment_method: 'cash', counter_id: 1, counter_session_id: 2, tenant_id: TENANT_1.id, paid: 1900, total: 1900, status: 'paid' }],
          bills: [{ id: 12, tenant_id: TENANT_1.id, paid: 1900, total: 1900, status: 'paid' }],
          billing_deposits: [],
        },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [10], action: 'approve', notes: 'Approved' },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { unsafeIds?: number[]; unsafeTypes?: string[] };
      expect(body.unsafeIds).toContain(10);
      expect(body.unsafeTypes).toContain('payment_void');
      expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO payments') && q.params.includes(-1900))).toBe(false);
    });

    it('blocks executed-pending payment void bulk rejection because dispute creation requires individual review', async () => {
      const approval = {
        ...existingApproval,
        id: 13,
        type: 'payment_void' as const,
        entity_id: 83,
        entity_no: 'RCP-000083',
        requested_by: OTHER_USER.id,
        request_data: JSON.stringify({
          executionMode: 'executed_pending',
          financialState: 'reversed_pending_review',
          originalPaymentId: 83,
          billId: 12,
          originalAmount: 1900,
          originalReceivedBy: 77,
          reversalReceiptNo: 'RVR-000083',
          paymentMethod: 'cash',
          reason: 'Wrong receipt',
        }),
        status: 'pending' as const,
        execution_status: 'succeeded',
      };
      const { app, mockDB } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [approval] },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [13], action: 'reject', notes: 'Rejected' },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { unsafeIds?: number[]; unsafeTypes?: string[] };
      expect(body.unsafeIds).toContain(13);
      expect(body.unsafeTypes).toContain('payment_void');
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO billing_payment_void_disputes'))).toBe(false);
    });

    it('rejects multiple pending requests with notes', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: bulkIds },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'reject', notes: 'Bulk rejection reason' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('rejected');
    });

    it('returns 400 when ids array is empty', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [], action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when ids array exceeds 100', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const oversized = Array.from({ length: 101 }, (_, i) => i + 1);
      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: oversized, action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-integer ids', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1.5, 2], action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for negative ids', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [-1, 2], action: 'approve' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid action', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [] },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'cancel' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when bulk rejecting without notes', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: bulkIds },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'reject' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 403 when reviewer is the requester of any approval (separation of duties)', async () => {
      // Use ADMIN_USER as the requester for one approval — the same user is also the reviewer
      const mixedIds = [
        { ...existingApproval, id: 1, status: 'pending', requested_by: OTHER_USER.id },
        { ...existingApproval, id: 2, status: 'pending', requested_by: ADMIN_USER.id },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id, // reviewer == requester of id 2
        tables: { approval_requests: mixedIds },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'approve' },
      });

      expect(res.status).toBe(403);
      const body = await res.json() as { selfRequestedIds?: number[] };
      expect(body.selfRequestedIds).toContain(2);
    });

    it('returns 409 when any of the requests have already been reviewed', async () => {
      const partiallyReviewed = [
        { ...existingApproval, id: 1, status: 'pending', requested_by: OTHER_USER.id },
        { ...existingApproval, id: 2, status: 'approved', requested_by: OTHER_USER.id, reviewed_by: 99 },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: partiallyReviewed },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'approve' },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { alreadyReviewedIds?: number[] };
      expect(body.alreadyReviewedIds).toContain(2);
    });

    it('returns 404 when one or more IDs do not exist', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: [bulkIds[0]] }, // only id 1 exists
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 99], action: 'approve' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 403 for non-admin role', async () => {
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: { approval_requests: bulkIds },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'approve' },
      });

      expect(res.status).toBe(403);
    });

    it('locks each approval row before running side effects so a concurrent reviewer cannot double-execute', async () => {
      // Verifies the single-review path (PUT /:id/review). Without the lock,
      // two concurrent reviewers can both pass the 'status = pending' check
      // and BOTH execute the side effect (double credit note, double payment
      // reversal). The lock sets execution_status='processing' first; the
      // second concurrent caller's conditional UPDATE then returns changes=0
      // and they see 409 instead of double-executing.
      const approval = {
        ...existingApproval,
        id: 20,
        type: 'refund' as const,
        entity_id: 53,
        entity_no: 'RCP-000053',
        requested_by: OTHER_USER.id,
        request_data: JSON.stringify({
          oldValue: { receiptNo: 'RCP-000053', amount: 1000, invoiceNo: 'INV-D-2026-000053' },
          newValue: { status: 'payment_reversal_requested' },
          reason: 'Wrong receipt',
        }),
        status: 'pending' as const,
        execution_status: 'not_required',
      };
      const firstReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [approval],
          payments: [{
            id: 53, bill_id: 5279, amount: 1000, payment_type: 'current', receipt_no: 'RCP-000053',
            payment_method: 'cash', counter_id: 1, counter_session_id: 2, tenant_id: TENANT_1.id, paid: 1000, total: 1000, status: 'paid',
          }],
          bills: [{ id: 5279, tenant_id: TENANT_1.id, paid: 1000, total: 1000, status: 'paid' }],
          billing_deposits: [],
        },
      });

      const firstRes = await jsonRequest(firstReviewer.app, '/approvals/20/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'First approval' },
      });
      expect(firstRes.status).toBe(200);
      expect(firstReviewer.mockDB.queries.some((q) => /UPDATE\s+approval_requests[\s\S]*execution_status\s*=\s*'processing'/i.test(q.sql))).toBe(false);

      const secondReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: 4,
        mockDB: firstReviewer.mockDB,
      });
      const secondRes = await jsonRequest(secondReviewer.app, '/approvals/20/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'Second approval' },
      });
      expect(secondRes.status).toBe(200);

      // After the second distinct approval, the route MUST update execution_status
      // to 'processing' before running the guarded payment-reversal side effect.
      const lockQuery = firstReviewer.mockDB.queries.findIndex((q) => /UPDATE\s+approval_requests[\s\S]*execution_status\s*=\s*'processing'/i.test(q.sql));
      const reversalQuery = firstReviewer.mockDB.queries.findIndex((q) => /INSERT\s+INTO\s+payments/i.test(q.sql) && q.params.includes(-1000));
      expect(lockQuery).toBeGreaterThan(-1);
      expect(reversalQuery).toBeGreaterThan(-1);
      expect(lockQuery).toBeLessThan(reversalQuery);
    });

    it('groups all bill-cancellation writes into a single D1 batch so partial failure cannot split state', async () => {
      const approval = {
        ...existingApproval,
        id: 21,
        type: 'bill_cancel' as const,
        entity_id: 100,
        entity_no: 'INV-001',
        requested_by: OTHER_USER.id,
        request_data: JSON.stringify({ reason: 'Wrong patient' }),
        status: 'pending' as const,
      };
      const firstReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: {
          approval_requests: [approval],
          bills: [{ ...existingBill, status: 'open', paid: 0 }],
          invoice_items: [],
        },
      });

      const firstRes = await jsonRequest(firstReviewer.app, '/approvals/21/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'First approval' },
      });
      expect(firstRes.status).toBe(200);
      expect(firstReviewer.mockDB.batchCalls.some((stmts) => stmts.some((sql) => /UPDATE\s+bills[\s\S]*status\s*=\s*'cancelled'/i.test(sql)))).toBe(false);

      const secondReviewer = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: 4,
        mockDB: firstReviewer.mockDB,
      });
      const secondRes = await jsonRequest(secondReviewer.app, '/approvals/21/review', {
        method: 'PUT',
        body: { action: 'approve', notes: 'Second approval' },
      });

      expect(secondRes.status).toBe(200);
      // After 2/2, every state-mutating DML for bill-cancel MUST go through one batch
      // so a failure mid-flight rolls the whole side effect back.
      const billCancelBatch = firstReviewer.mockDB.batchCalls.find((stmts) =>
        stmts.some((sql) => /UPDATE\s+bills[\s\S]*SET\s+status\s*=\s*'cancelled'/i.test(sql))
        && stmts.some((sql) => /UPDATE\s+invoice_items[\s\S]*SET\s+status\s*=\s*'cancelled'/i.test(sql))
        && stmts.some((sql) => /INSERT\s+INTO\s+income/i.test(sql)),
      );
      expect(billCancelBatch, 'bill-cancel writes must share one db.batch call').toBeDefined();
    });

    it('does not review approvals from other tenants', async () => {
      const crossTenant = [
        { ...existingApproval, id: 1, status: 'pending', tenant_id: 'tenant-1', requested_by: OTHER_USER.id },
        { ...existingApproval, id: 2, status: 'pending', tenant_id: 'tenant-2', requested_by: OTHER_USER.id },
      ];
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: ADMIN_USER.id,
        tables: { approval_requests: crossTenant },
      });

      const res = await jsonRequest(app, '/approvals/bulk-review', {
        method: 'POST',
        body: { ids: [1, 2], action: 'approve' },
      });

      // Only id 1 belongs to tenant-1, so the lookup should find only 1 of 2 → 404
      expect(res.status).toBe(404);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('does not show approvals from other tenants', async () => {
      const otherTenantApproval = { ...existingApproval, tenant_id: 'tenant-2', id: 99 };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { approval_requests: [existingApproval, otherTenantApproval] },
      });

      const res = await app.request('/approvals');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('cannot review approval from another tenant', async () => {
      const otherTenantApproval = { ...existingApproval, tenant_id: 'tenant-2', id: 99 };
      const { app } = createTestApp({
        route: approvalsRoute,
        routePath: '/approvals',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        userId: OTHER_USER.id,
        tables: { approval_requests: [otherTenantApproval] },
      });

      const res = await jsonRequest(app, '/approvals/99/review', {
        method: 'PUT',
        body: { action: 'approve' },
      });

      expect(res.status).toBe(404);
    });
  });
});
