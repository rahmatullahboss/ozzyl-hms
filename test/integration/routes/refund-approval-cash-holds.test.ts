import { describe, expect, it } from 'vitest';
import approvalsRoute from '../../../src/routes/tenant/approvals';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const requestData = {
  refundKind: 'item_partial_refund',
  paymentMethod: 'cash',
  reason: 'CBC was not performed',
  items: [{ invoiceItemId: 101, returnQuantity: 1, description: 'CBC', calculatedAmount: 800 }],
  requestedRefundAmount: 800,
  refundRequestIdempotencyKey: 'refund-request-75-12345678',
  refundRequestHash: 'hash-1',
  counterId: 7,
  counterSessionId: 17,
};

const approval = {
  id: 55,
  tenant_id: 'tenant-1',
  type: 'refund',
  entity_id: 75,
  entity_no: 'INV-75',
  requested_by: 3,
  request_data: JSON.stringify(requestData),
  status: 'partially_approved',
  approval_count: 1,
  required_approvals: 2,
  execution_status: 'pending',
};

const firstApprovalDecision = {
  id: 501,
  tenant_id: 'tenant-1',
  approval_source: 'approval_requests',
  approval_request_id: 55,
  approver_id: 2,
  approver_role: 'director',
  decision: 'approve',
  notes: 'First independent approval',
};

const disputeAccountingMappings = [
  { id: 1, tenant_id: 'tenant-1', mapping_key: 'cash', account_id: 1, is_active: 1 },
  { id: 2, tenant_id: 'tenant-1', mapping_key: 'employee_dispute_receivable', account_id: 2, is_active: 1 },
];

const heldCash = {
  id: 9,
  tenant_id: 'tenant-1',
  approval_request_id: 55,
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
};

describe('refund approval cash hold lifecycle', () => {
  it('approves selected items, consumes the hold, and posts one originating-counter SalesReturn', async () => {
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [approval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [heldCash],
        bills: [{ id: 75, tenant_id: 'tenant-1', patient_id: 50, invoice_no: 'INV-75', status: 'paid', total: 2000, paid: 2000, due: 0 }],
        invoice_items: [{ id: 101, tenant_id: 'tenant-1', bill_id: 75, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, status: 'active' }],
        billing_credit_notes: [],
        billing_credit_note_items: [],
        sequences: [],
      },
      queryOverride: (sql) => {
        if (/UPDATE approval_requests[\s\S]*execution_status = 'processing'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests[\s\S]*execution_status = 'succeeded'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests SET status/i.test(sql)) return { meta: { changes: 1 } };
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: heldCash };
        if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) return { results: [{ invoice_item_id: 101, lab_order_item_id: 501 }] };
        if (/SELECT item_category[\s\S]*FROM invoice_items/i.test(sql)) return { results: [{ item_category: 'test' }] };
        if (/FROM doctor_commission_accruals[\s\S]*lab_order_item_id IN/i.test(sql)) {
          return { results: [{ id: 300, doctor_id: 12, patient_id: 50, visit_id: null, bill_id: 75, source_type: 'lab_test', gross_amount: 800, commission_amount: 80, accrued_date: '2026-07-12' }] };
        }
        if (/FROM radiology_requisitions|JOIN radiology_requisitions rr/i.test(sql)) return { results: [] };
        if (/SELECT[\s\S]*loi\.lab_order_id[\s\S]*lo\.bill_id[\s\S]*FROM lab_order_items loi/i.test(sql)) return { first: null };
        if (/FROM invoice_items ii/i.test(sql)) return { results: [{ id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 }] };
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [approval] };
        if (/FROM lab_order_items/i.test(sql)) return { results: [{ id: 501, status: 'pending', lab_order_id: 600 }] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'approve', notes: 'Approved after verification' },
    });

    expect(res.status).toBe(200);
    const financialBatch = mockDB.batchCalls.find((batch) => batch.some((sql) => /INSERT INTO billing_credit_notes/i.test(sql)));
    expect(financialBatch).toBeTruthy();
    expect(financialBatch!.some((sql) => /INSERT INTO billing_credit_note_items/i.test(sql))).toBe(true);
    expect(financialBatch!.some((sql) => /INSERT INTO emp_cash_transactions/i.test(sql) && /SalesReturn/i.test(sql))).toBe(true);
    expect(financialBatch!.some((sql) => /UPDATE billing_refund_cash_holds[\s\S]*consumed/i.test(sql))).toBe(true);

    const cashInsert = mockDB.queries.find((query) => /INSERT INTO emp_cash_transactions/i.test(query.sql));
    expect(cashInsert?.params).toContain(3);
    expect(cashInsert?.params).toContain(7);
    expect(cashInsert?.params).toContain(17);

    const commissionUpdate = mockDB.queries.find((query) =>
      /UPDATE doctor_commission_accruals/i.test(query.sql) && /lab_order_item_id IN/i.test(query.sql),
    );
    expect(commissionUpdate?.params).toContain(501);
    expect(commissionUpdate?.sql).not.toMatch(/source_type IN/i);
  });

  it('approves a manual amount refund without returning items or cancelling clinical work', async () => {
    const amountRequestData = {
      refundKind: 'amount_partial_refund',
      paymentMethod: 'cash',
      reason: 'Manual partial refund approved by management',
      requestedRefundAmount: 250,
      cashRefundAmount: 250,
      receivableReduction: 0,
      refundRequestIdempotencyKey: 'refund-request-75-amount-1234',
      refundRequestHash: 'hash-amount-1',
      commissionReservationStatus: 'held',
      commissionReservedAmount: 25,
      counterId: 7,
      counterSessionId: 17,
    };
    const amountApproval = { ...approval, request_data: JSON.stringify(amountRequestData) };
    const amountHold = { ...heldCash, amount: 250, idempotency_key: 'refund-request-75-amount-1234' };
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [amountApproval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [amountHold],
        bills: [{ id: 75, tenant_id: 'tenant-1', patient_id: 50, invoice_no: 'INV-75', status: 'paid', total: 2000, paid: 2000, due: 0, test_bill: 2000, doctor_visit_bill: 0, admission_bill: 0, operation_bill: 0, medicine_bill: 0 }],
        invoice_items: [{ id: 101, tenant_id: 'tenant-1', bill_id: 75, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, status: 'active' }],
        billing_credit_notes: [],
        billing_credit_note_items: [],
        sequences: [],
      },
      queryOverride: (sql) => {
        if (/UPDATE approval_requests[\s\S]*execution_status = 'processing'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests[\s\S]*execution_status = 'succeeded'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests SET status/i.test(sql)) return { meta: { changes: 1 } };
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: amountHold };
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{ id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, approved_credit_amount: 0 }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [amountApproval] };
        if (/FROM billing_refund_commission_reservations reservation/i.test(sql)) {
          return { results: [{
            id: 700,
            approval_request_id: 55,
            refund_cash_hold_id: 9,
            bill_id: 75,
            accrual_id: 300,
            invoice_item_id: 101,
            allocated_refund_amount: 250,
            commission_base_reduction: 250,
            reserved_commission_amount: 25,
            original_commission_base_amount: 800,
            original_earned_commission_amount: 80,
            original_doctor_waiver_amount: 0,
            original_payable_commission_amount: 80,
            original_balance_amount: 80,
            reserved_commission_base_amount: 550,
            reserved_earned_commission_amount: 55,
            reserved_doctor_waiver_amount: 0,
            reserved_payable_commission_amount: 55,
            reserved_balance_amount: 55,
            status: 'held',
            doctor_id: 12,
            doctor_name: 'Dr. Referrer',
            patient_id: 50,
            visit_id: null,
            source_type: 'lab_test',
            gross_amount: 800,
            paid_amount: 0,
            accrued_date: '2026-07-12',
            item_description: 'CBC',
          }] };
        }
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
            gross_amount: 800,
            commission_base_amount: 800,
            commission_rate_bps: 1000,
            commission_flat_amount: 0,
            commission_amount: 80,
            earned_commission_amount: 80,
            doctor_waiver_amount: 0,
            payable_commission_amount: 80,
            paid_amount: 0,
            balance_amount: 80,
            status: 'accrued',
            accrued_date: '2026-07-12',
          }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'approve', notes: 'Approved manual amount refund' },
    });

    expect(res.status).toBe(200);
    const financialBatch = mockDB.batchCalls.find((batch) => batch.some((sql) => /INSERT INTO billing_credit_notes/i.test(sql)));
    expect(financialBatch).toBeTruthy();
    expect(financialBatch!.some((sql) => /INSERT INTO billing_credit_note_items/i.test(sql))).toBe(true);
    expect(mockDB.queries.some((query) => /FROM invoice_items ii/i.test(query.sql))).toBe(true);
    expect(mockDB.queries.some((query) => /UPDATE lab_order_items|UPDATE radiology_requisitions/i.test(query.sql))).toBe(false);
    const billUpdate = mockDB.queries.find((query) => /UPDATE bills[\s\S]*SET total = \?, paid = \?, due = \?/i.test(query.sql));
    expect(billUpdate?.params.slice(0, 5)).toEqual([1750, 1750, 0, 'paid', 1750]);
    const cashInsert = mockDB.queries.find((query) => /INSERT INTO emp_cash_transactions/i.test(query.sql));
    expect(cashInsert?.params).toContain(250);
    const creditNoteInsert = mockDB.queries.find((query) => /INSERT INTO billing_credit_notes/i.test(query.sql));
    expect(creditNoteInsert?.params).toContain(250);
    expect(creditNoteInsert?.params.some((param) => typeof param === 'string' && /manual amount/i.test(param))).toBe(true);
    const allocationInsert = mockDB.queries.find((query) => /INSERT INTO billing_credit_note_items/i.test(query.sql));
    expect(allocationInsert?.params).toEqual(expect.arrayContaining([101, 'CBC', 250]));
    expect(mockDB.queries.some((query) => /UPDATE doctor_commission_accruals/i.test(query.sql))).toBe(false);
    const reservationTransition = mockDB.queries.find((query) =>
      /UPDATE billing_refund_commission_reservations/i.test(query.sql)
      && /status = \?/i.test(query.sql),
    );
    expect(reservationTransition?.params).toEqual(expect.arrayContaining(['consumed', 55, 'held']));
    expect(mockDB.queries.some((query) =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(query.sql)
      && query.params.includes('commission_cancelled')
    )).toBe(false);
  });

  it('blocks approval when a manual partial amount has become the full current bill total', async () => {
    const amountRequestData = {
      refundKind: 'amount_partial_refund',
      paymentMethod: 'cash',
      reason: 'Manual partial refund approved by management',
      requestedRefundAmount: 250,
      cashRefundAmount: 250,
      receivableReduction: 0,
      refundRequestIdempotencyKey: 'refund-request-75-amount-stale',
      refundRequestHash: 'hash-amount-stale',
      counterId: 7,
      counterSessionId: 17,
    };
    const amountApproval = { ...approval, request_data: JSON.stringify(amountRequestData) };
    const amountHold = { ...heldCash, amount: 250, idempotency_key: 'refund-request-75-amount-stale' };
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [amountApproval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [amountHold],
        bills: [{ id: 75, tenant_id: 'tenant-1', patient_id: 50, invoice_no: 'INV-75', status: 'paid', total: 250, paid: 250, due: 0, test_bill: 250, doctor_visit_bill: 0, admission_bill: 0, operation_bill: 0, medicine_bill: 0 }],
        invoice_items: [{ id: 101, tenant_id: 'tenant-1', bill_id: 75, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 250, line_total: 250, reference_id: 501, status: 'active' }],
        billing_credit_notes: [],
        billing_credit_note_items: [],
        sequences: [],
      },
      queryOverride: (sql) => {
        if (/UPDATE approval_requests[\s\S]*execution_status = 'processing'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests[\s\S]*execution_status = 'failed'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests SET status/i.test(sql)) return { meta: { changes: 1 } };
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: amountHold };
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{ id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 250, line_total: 250, reference_id: 501, approved_credit_amount: 0 }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [amountApproval] };
        if (/FROM doctor_commission_accruals dca/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'approve', notes: 'Approve stale amount refund' },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Approval execution failed',
      detail: expect.stringMatching(/full refund flow/i),
    });
    expect(mockDB.batchCalls.some((batch) => batch.some((sql) => /INSERT INTO billing_credit_notes/i.test(sql)))).toBe(false);
  });

  it('applies a partially-paid credit to receivable first and refunds only the paid excess', async () => {
    const partialRequestData = {
      ...requestData,
      items: [{ invoiceItemId: 101, returnQuantity: 1, description: 'Unused service', calculatedAmount: 500 }],
      requestedRefundAmount: 500,
      cashRefundAmount: 100,
      receivableReduction: 400,
    };
    const partialApproval = { ...approval, request_data: JSON.stringify(partialRequestData) };
    const partialHold = { ...heldCash, amount: 100 };
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [partialApproval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [partialHold],
        bills: [{ id: 75, tenant_id: 'tenant-1', patient_id: 50, invoice_no: 'INV-75', status: 'partially_paid', total: 1000, paid: 600, due: 400 }],
        invoice_items: [{ id: 101, tenant_id: 'tenant-1', bill_id: 75, description: 'Unused service', item_category: 'service', quantity: 1, unit_price: 500, line_total: 500, reference_id: null, status: 'active' }],
        billing_credit_notes: [],
        billing_credit_note_items: [],
        sequences: [],
      },
      queryOverride: (sql) => {
        if (/UPDATE approval_requests[\s\S]*execution_status = 'processing'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests[\s\S]*execution_status = 'succeeded'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests SET status/i.test(sql)) return { meta: { changes: 1 } };
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: partialHold };
        if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) return { results: [] };
        if (/SELECT item_category[\s\S]*FROM invoice_items/i.test(sql)) return { results: [{ item_category: 'service' }] };
        if (/JOIN radiology_requisitions rr/i.test(sql)) return { results: [] };
        if (/FROM invoice_items ii/i.test(sql)) return { results: [{ id: 101, description: 'Unused service', item_category: 'service', quantity: 1, unit_price: 500, line_total: 500, reference_id: null, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 }] };
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [partialApproval] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'approve', notes: 'Approved partial paid refund' },
    });

    expect(res.status).toBe(200);
    const billUpdate = mockDB.queries.find((query) => /UPDATE bills[\s\S]*SET total = \?, paid = \?, due = \?/i.test(query.sql));
    expect(billUpdate?.params.slice(0, 4)).toEqual([500, 500, 0, 'paid']);
    const cashInsert = mockDB.queries.find((query) => /INSERT INTO emp_cash_transactions/i.test(query.sql));
    expect(cashInsert?.params).toContain(100);
    expect(cashInsert?.params).not.toContain(500);
    const incomeInsert = mockDB.queries.find((query) => /INSERT INTO income/i.test(query.sql));
    expect(incomeInsert?.params).toContain(-500);
    const posting = mockDB.queries.find((query) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(query.sql));
    const payload = posting?.params.find((param) => typeof param === 'string' && param.includes('receivableReduction')) as string | undefined;
    expect(payload ? JSON.parse(payload) : null).toMatchObject({
      total: 500,
      cashRefund: 100,
      receivableReduction: 400,
    });
  });

  it('returns a conflict instead of a server error when the held cash no longer matches', async () => {
    const mismatchedHold = { ...heldCash, amount: 700 };
    const { app } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [approval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [mismatchedHold],
        bills: [{ id: 75, tenant_id: 'tenant-1', patient_id: 50, invoice_no: 'INV-75', status: 'paid', total: 2000, paid: 2000, due: 0 }],
        invoice_items: [{ id: 101, tenant_id: 'tenant-1', bill_id: 75, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, status: 'active' }],
      },
      queryOverride: (sql) => {
        if (/UPDATE approval_requests[\s\S]*execution_status = 'processing'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests[\s\S]*execution_status = 'failed'/i.test(sql)) return { meta: { changes: 1 } };
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: mismatchedHold };
        if (/FROM invoice_items ii/i.test(sql)) return { results: [{ id: 101, description: 'CBC', item_category: 'test', quantity: 1, unit_price: 800, line_total: 800, reference_id: 501, invoice_status: 'active', approved_returned_qty: 0, pending_credit_note_qty: 0 }] };
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [approval] };
        if (/FROM lab_order_items/i.test(sql)) return { results: [{ id: 501, status: 'pending' }] };
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'approve', notes: 'Review stale hold' },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Approval execution failed',
      detail: expect.stringMatching(/cash hold amount/i),
    });
  });

  it('resumes clinical completion after financial refund was already committed', async () => {
    const consumedHold = { ...heldCash, status: 'consumed', credit_note_id: 44, consumed_at: '2026-07-12 10:05:00' };
    const failedApproval = { ...approval, execution_status: 'failed' };
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [failedApproval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [consumedHold],
        billing_credit_notes: [{ id: 44, tenant_id: 'tenant-1', credit_note_no: 'CN-000044', refund_amount: 800, total_amount: 800, status: 'approved', is_active: 1 }],
        invoice_items: [{ id: 101, tenant_id: 'tenant-1', bill_id: 75, description: 'CBC', item_category: 'test', reference_id: 501 }],
      },
      queryOverride: (sql) => {
        if (/UPDATE approval_requests[\s\S]*execution_status = 'processing'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests[\s\S]*execution_status = 'succeeded'/i.test(sql)) return { meta: { changes: 1 } };
        if (/UPDATE approval_requests SET status/i.test(sql)) return { meta: { changes: 1 } };
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) return { first: consumedHold };
        if (/UNION ALL/i.test(sql) && /lab_test_catalog ltc/i.test(sql)) return { results: [] };
        if (/JOIN radiology_requisitions rr/i.test(sql)) return { results: [] };
        if (/SELECT item_category[\s\S]*FROM invoice_items/i.test(sql)) return { results: [{ item_category: 'test' }] };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'approve', notes: 'Resume failed clinical completion' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) => /INSERT INTO billing_credit_notes/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /execution_status = 'succeeded'/i.test(query.sql))).toBe(true);
  });

  it('converts a rejected reserve into requester-owned disputed cash even after custody transfer', async () => {
    const custodyHold = {
      ...heldCash,
      custody_user_id: 2,
      release_status: 'not_applicable',
    };
    const amountApproval = {
      ...approval,
      request_data: JSON.stringify({
        ...requestData,
        refundKind: 'amount_partial_refund',
        requestedRefundAmount: 800,
        cashRefundAmount: 800,
        commissionReservationStatus: 'held',
        commissionReservedAmount: 80,
        items: [{
          invoiceItemId: 101,
          allocatedRefundAmount: 800,
          allocationSource: 'auto',
        }],
      }),
    };
    let holdReads = 0;
    const disputedHold = {
      ...custodyHold,
      status: 'disputed',
      release_status: 'not_applicable',
      release_counter_session_id: null,
      release_cash_movement_id: null,
      resolution_reason: 'Refund not justified',
    };
    const dispute = {
      id: 31,
      tenant_id: 'tenant-1',
      refund_cash_hold_id: 9,
      approval_request_id: 55,
      bill_id: 75,
      requester_user_id: 3,
      amount: 800,
      status: 'open',
      rejection_reason: 'Refund not justified',
      rejected_by: 1,
      rejected_at: '2026-07-12 11:10:00',
      custody_user_id: 2,
      counter_id: 7,
      counter_session_id: 17,
      dispute_cash_movement_id: 501,
      settlement_method: null,
      settlement_reference_type: null,
      settlement_reference_id: null,
      settlement_idempotency_key: null,
      settled_by: null,
      settled_at: null,
    };
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [amountApproval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [custodyHold],
        accounting_account_mappings: disputeAccountingMappings,
        billing_counter_sessions: [{ id: 88, tenant_id: 'tenant-1', counter_id: 9, employee_id: 2, status: 'active', opened_at: '2026-07-12 11:00:00' }],
      },
      queryOverride: (sql) => {
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) {
          holdReads += 1;
          return { first: holdReads === 1 ? custodyHold : disputedHold };
        }
        if (/FROM billing_refund_commission_reservations reservation/i.test(sql)) {
          return { results: [{
            id: 700,
            approval_request_id: 55,
            refund_cash_hold_id: 9,
            bill_id: 75,
            accrual_id: 300,
            invoice_item_id: 101,
            allocated_refund_amount: 800,
            commission_base_reduction: 800,
            reserved_commission_amount: 80,
            original_commission_base_amount: 800,
            original_earned_commission_amount: 80,
            original_doctor_waiver_amount: 0,
            original_payable_commission_amount: 80,
            original_balance_amount: 80,
            reserved_commission_base_amount: 0,
            reserved_earned_commission_amount: 0,
            reserved_doctor_waiver_amount: 0,
            reserved_payable_commission_amount: 0,
            reserved_balance_amount: 0,
            status: 'held',
            doctor_id: 12,
            doctor_name: 'Dr. Referrer',
            patient_id: 50,
            visit_id: null,
            source_type: 'lab_test',
            gross_amount: 800,
            paid_amount: 0,
            accrued_date: '2026-07-12',
            item_description: 'CBC',
          }] };
        }
        if (/FROM billing_refund_cash_disputes[\s\S]*refund_cash_hold_id/i.test(sql)) return { first: dispute };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'reject', notes: 'Refund not justified' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        cashHold: {
          status: 'disputed',
        },
        dispute: {
          id: 31,
          status: 'open',
          requesterUserId: 3,
          amount: 800,
        },
      },
    });
    const disputeMovement = mockDB.queries.find((query) =>
      /INSERT OR IGNORE INTO cash_drawer_movements/i.test(query.sql)
      && /refund_cash_dispute/i.test(query.sql),
    );
    expect(disputeMovement?.params).toEqual(expect.arrayContaining(['tenant-1', 17, 7, 3, 800, 9, 1]));
    expect(mockDB.queries.some((query) => /refund_reserve_release/i.test(query.sql))).toBe(false);
    const holdDispute = mockDB.queries.find((query) =>
      /UPDATE billing_refund_cash_holds/i.test(query.sql) && /status = 'disputed'/i.test(query.sql),
    );
    expect(holdDispute).toBeTruthy();
    const commissionDispute = mockDB.queries.find((query) =>
      /UPDATE billing_refund_commission_reservations/i.test(query.sql)
      && /status = \?/i.test(query.sql),
    );
    expect(commissionDispute?.params).toEqual(expect.arrayContaining(['disputed', 55, 'held']));
  });

  it('rejects without changing the patient bill, collection, or doctor commission', async () => {
    let holdReads = 0;
    const disputedHold = {
      ...heldCash,
      status: 'disputed',
      resolution_reason: 'Service was actually performed',
    };
    const dispute = {
      id: 32,
      tenant_id: 'tenant-1',
      refund_cash_hold_id: 9,
      approval_request_id: 55,
      bill_id: 75,
      requester_user_id: 3,
      amount: 800,
      status: 'open',
      rejection_reason: 'Service was actually performed',
      rejected_by: 1,
      rejected_at: '2026-07-12 11:20:00',
      custody_user_id: null,
      counter_id: 7,
      counter_session_id: 17,
      dispute_cash_movement_id: 502,
      settlement_method: null,
      settlement_reference_type: null,
      settlement_reference_id: null,
      settlement_idempotency_key: null,
      settled_by: null,
      settled_at: null,
    };
    const { app, mockDB } = createTestApp({
      route: approvalsRoute,
      routePath: '/approvals',
      role: 'director',
      tenantId: 'tenant-1',
      userId: 1,
      tables: {
        approval_requests: [approval],
        approval_decisions: [firstApprovalDecision],
        billing_refund_cash_holds: [heldCash],
        accounting_account_mappings: disputeAccountingMappings,
      },
      queryOverride: (sql) => {
        if (/FROM billing_refund_cash_holds[\s\S]*approval_request_id/i.test(sql)) {
          holdReads += 1;
          return { first: holdReads === 1 ? heldCash : disputedHold };
        }
        if (/FROM billing_refund_cash_disputes[\s\S]*refund_cash_hold_id/i.test(sql)) return { first: dispute };
        return null;
      },
    });

    const res = await jsonRequest(app, '/approvals/55/review', {
      method: 'PUT',
      body: { action: 'reject', notes: 'Service was actually performed' },
    });

    expect(res.status).toBe(200);
    const rejectionBatch = mockDB.batchCalls.find((batch) => batch.some((sql) => /UPDATE approval_requests/i.test(sql)));
    expect(rejectionBatch).toBeTruthy();
    expect(rejectionBatch!.some((sql) => /INSERT OR IGNORE INTO billing_refund_cash_disputes/i.test(sql))).toBe(true);
    expect(rejectionBatch!.some((sql) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(sql))).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(query.sql)
      && query.params.includes('manual_journal'),
    )).toBe(true);
    expect(rejectionBatch!.some((sql) => /UPDATE billing_refund_cash_holds[\s\S]*status = 'disputed'/i.test(sql))).toBe(true);
    expect(mockDB.queries.some((query) =>
      /INSERT INTO billing_credit_notes|INSERT INTO emp_cash_transactions|UPDATE bills|UPDATE doctor_commission_accruals/i.test(query.sql),
    )).toBe(false);
  });
});
