import { describe, expect, it } from 'vitest';
import shiftHandoverReportRoutes from '../../../src/routes/tenant/shiftHandoverReport';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const tenantId = 'tenant-1';

function frozenSnapshot() {
  return {
    session: { sessionId: 17, status: 'closed', counterId: 3, counterName: 'Main Reception Counter', counterCode: 'RC-1', cashierId: 21, cashierName: 'Nusrat Jahan Sony', openedAt: '2026-06-19 09:00:00', closedAt: '2026-06-19 17:00:00', openingCash: 1000 },
    activity: { serialCreated: 25, doctorSeen: 5, serialCancelled: 1, serialWaiting: 0, invoiceCount: 26, patientsSeen: 5, doctorVisits: 5, testOrders: 21, testItems: 21 },
    finance: { totalReceived: 13400, cashReceived: 13400, dueCollection: 0, doctorVisitCollection: 1900, testCollection: 11500, refund: 0, discount: 100, doctorPayout: 900, pettyExpense: 250, transferOut: 1000, bankDeposit: 500, acceptedTransferIn: 200, totalDue: 0, expectedCash: 11950, countedCash: 11950, variance: 0 },
    paymentMethods: [{ paymentMethod: 'cash', transactionCount: 3, totalAmount: 13400 }],
    expenses: [],
    transfers: [],
    exceptions: { cancelledBills: [], refundedBills: [], discountedBills: [], dueBills: [], editedBills: [], approvalRequests: [], manualMovements: [] },
    audit: { reportNo: 'SHR-20260619-17', generatedAt: '2026-06-19T12:00:00.000Z', generatedBy: 21, scope: 'own_shift' },
  };
}

function createShiftReportApp(options: { role?: string; userId?: number; snapshot?: boolean } = {}) {
  return createTestApp({
    route: shiftHandoverReportRoutes,
    routePath: '/reports/shift-handover',
    tenantId,
    role: options.role ?? 'receptionist',
    userId: options.userId ?? 21,
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from shift_handover_reports r')) {
        if (!options.snapshot) return { results: [] };
        return { results: [{ id: 44, session_id: 17, report_no: 'SHR-20260619-17', status: 'finalized', snapshot_json: JSON.stringify(frozenSnapshot()), snapshot_hash: 'hash-demo', generated_by: 21, generated_at: '2026-06-19 17:01:00', finalized_at: '2026-06-19 17:01:00', accepted_by: null, accepted_at: null, cashier_id: 21, cashier_name: 'Nusrat Jahan Sony', accepted_by_name: null }] };
      }
      if (normalized.includes('from shift_handover_reports')) {
        if (!options.snapshot) return { first: null };
        return { first: { id: 44, report_no: 'SHR-20260619-17', status: 'finalized', snapshot_json: JSON.stringify(frozenSnapshot()), snapshot_hash: 'hash-demo', finalized_at: '2026-06-19 17:01:00', accepted_by: null, accepted_at: null } };
      }
      if (normalized.includes('from billing_counter_sessions s')) {
        return { first: { id: 17, tenant_id: tenantId, counter_id: 3, employee_id: 21, opening_cash: 1000, closing_cash_declared: 11950, closing_denominations: JSON.stringify({ note1000: 11, note500: 1, note200: 2, note50: 1 }), expected_cash: 11950, variance: 0, status: 'active', opened_at: '2026-06-19 09:00:00', closed_at: null, counter_name: 'Main Reception Counter', counter_code: 'RC-1', cashier_name: 'Nusrat Jahan Sony' } };
      }
      if (normalized.includes('from emp_cash_transactions')) {
        return { first: { total_cash_sales: 13400, total_sales_return: 0, total_collection_from_receivable: 0, total_cash_discount_given: 100, cash_received: 13400, total_received: 13400 } };
      }
      if (normalized.includes('from billing_credit_notes')) {
        return { results: [{ id: 71, credit_note_no: 'CN-71', invoice_no: 'INV-21', refund_amount: 300, reason: 'Patient returned item', created_at: '2026-06-19 12:30:00', patient_name: 'Rahim', created_by_name: 'Nusrat' }] };
      }
      if (normalized.includes('from bill_versions')) {
        return { results: [{ id: 91, bill_id: 21, invoice_no: 'INV-21', version_number: 2, total: 1300, discount: 100, edit_reason: 'Wrong item corrected', created_at: '2026-06-19 13:00:00', edited_by_name: 'Nusrat' }] };
      }
      if (normalized.includes('from approval_requests')) {
        return { results: [{ id: 81, type: 'discount', entity_id: 21, entity_no: 'INV-21', status: 'approved', requested_by_name: 'Nusrat', reviewed_by_name: 'Admin', review_notes: 'OK', created_at: '2026-06-19 13:05:00' }] };
      }
      if (normalized.includes('from cash_drawer_movements') && normalized.includes('manual_cash')) {
        return { results: [{ id: 66, movement_type: 'cash_out', amount: 50, reference_type: 'manual_cash_out', description: 'Manual correction', created_by_name: 'Nusrat', created_at: '2026-06-19 14:00:00' }] };
      }
      if (normalized.includes('from bills') && normalized.includes('cancelled_at')) {
        return { results: [{ id: 31, invoice_no: 'INV-CAN', total: 700, cancel_reason: 'Duplicate bill', cancelled_at: '2026-06-19 11:00:00', patient_name: 'Karim', cancelled_by_name: 'Admin' }] };
      }
      if (normalized.includes('from bills') && normalized.includes('order by b.discount')) {
        return { results: [{ id: 21, invoice_no: 'INV-21', patient_name: 'Rahim', total: 1300, discount: 100, discount_reason: 'Poor patient', discount_by_name: 'Chairman', approved_by_name: 'Admin' }] };
      }
      if (normalized.includes('from bills') && normalized.includes('order by b.due')) {
        return { results: [{ id: 22, invoice_no: 'INV-DUE', patient_name: 'Jamal', total: 1000, paid: 600, due: 400, status: 'open' }] };
      }
      if (normalized.includes('from bills') && !normalized.includes('invoice_items')) {
        return { first: { invoice_count: 26, patient_count: 5, doctor_visit_count: 5, doctor_visit_amount: 1900, test_amount: 11500, total_due: 0 } };
      }
      if (normalized.includes('from invoice_items')) return { first: { test_count: 21, test_order_count: 21 } };
      if (normalized.includes('from appointments')) return { first: { serial_created: 25, doctor_seen: 5, cancelled: 1, waiting: 2 } };
      if (normalized.includes('from cash_drawer_movements')) {
        return { first: { doctor_payout: 900, petty_expense: 250, transfer_out: 1000, bank_deposit: 500, accepted_transfer_in: 200 } };
      }
      if (normalized.includes('from payments') && normalized.includes('group by')) return { results: [{ payment_method: 'cash', transaction_count: 3, total_amount: 13400 }] };
      if (normalized.includes('from expenses')) return { results: [{ id: 8, category: 'MISC', amount: 250, description: 'Courier', status: 'approved' }] };
      if (normalized.includes('from billing_counter_cash_transfers')) return { results: [{ id: 4, transfer_no: 'CCT-17-demo', amount: 1000, status: 'pending', transfer_to_name: 'Accountant' }] };
      return null;
    },
  });
}

describe('shift handover report API', () => {
  it('returns cashier shift accountability totals for handover PDF generation', async () => {
    const { app } = createShiftReportApp();
    const response = await app.request('/reports/shift-handover?sessionId=17');
    expect(response.status).toBe(200);
    const body = await response.json() as { report: Record<string, any> };
    expect(body.report.session).toMatchObject({ sessionId: 17, cashierName: 'Nusrat Jahan Sony', counterName: 'Main Reception Counter', openingCash: 1000 });
    expect(body.report.activity).toMatchObject({ serialCreated: 25, doctorSeen: 5, patientsSeen: 5, doctorVisits: 5, testItems: 21, testOrders: 21 });
    expect(body.report.finance).toMatchObject({ totalReceived: 13400, cashReceived: 13400, doctorVisitCollection: 1900, testCollection: 11500, doctorPayout: 900, pettyExpense: 250, transferOut: 1000, bankDeposit: 500, acceptedTransferIn: 200, expectedCash: 11950, countedCash: 11950, variance: 0 });
    expect(body.report.paymentMethods).toEqual([{ paymentMethod: 'cash', transactionCount: 3, totalAmount: 13400 }]);
    expect(body.report.settlement.paymentMethods[0]).toMatchObject({ paymentMethod: 'cash', systemAmount: 13400, declaredAmount: null, difference: null });
    expect(body.report.handover).toMatchObject({ handoverAmount: 0, handoverDue: 0, status: null });
    expect(body.report.denominations).toEqual([
      { note: 1000, count: 11, total: 11000 },
      { note: 500, count: 1, total: 500 },
      { note: 200, count: 2, total: 400 },
      { note: 50, count: 1, total: 50 },
    ]);
    expect(body.report.exceptions.cancelledBills).toHaveLength(1);
    expect(body.report.exceptions.refundedBills[0]).toMatchObject({ creditNoteNo: 'CN-71', refundAmount: 300 });
    expect(body.report.exceptions.discountedBills[0]).toMatchObject({ invoiceNo: 'INV-21', discount: 100 });
    expect(body.report.exceptions.dueBills[0]).toMatchObject({ invoiceNo: 'INV-DUE', due: 400 });
    expect(body.report.exceptions.editedBills[0]).toMatchObject({ billId: 21, versionNumber: 2 });
    expect(body.report.exceptions.approvalRequests[0]).toMatchObject({ type: 'discount', status: 'approved' });
    expect(body.report.exceptions.manualMovements[0]).toMatchObject({ referenceType: 'manual_cash_out', amount: 50 });
    expect(body.report.audit.reportNo).toMatch(/^SHR-20260619-17$/);
  });

  it('blocks receptionists from viewing another cashier shift report', async () => {
    const { app } = createShiftReportApp({ userId: 99 });
    const response = await app.request('/reports/shift-handover?sessionId=17');
    expect(response.status).toBe(403);
  });

  it('returns a finalized immutable snapshot when one exists', async () => {
    const { app, mockDB } = createShiftReportApp({ snapshot: true });
    const response = await app.request('/reports/shift-handover?sessionId=17');
    expect(response.status).toBe(200);
    const body = await response.json() as { report: Record<string, any>; snapshot: Record<string, any> };
    expect(body.snapshot).toMatchObject({ id: 44, status: 'finalized', hash: 'hash-demo' });
    expect(body.report.session.status).toBe('closed');
    expect(body.report.finance.expectedCash).toBe(11950);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('from emp_cash_transactions'))).toBe(false);
  });

  it('lists finalized shift handover report history with audit summary fields', async () => {
    const { app, mockDB } = createShiftReportApp({ snapshot: true });
    const response = await app.request('/reports/shift-handover/history?limit=10');
    expect(response.status).toBe(200);
    const body = await response.json() as { reports: Array<Record<string, any>> };
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({
      id: 44,
      sessionId: 17,
      reportNo: 'SHR-20260619-17',
      status: 'finalized',
      cashierName: 'Nusrat Jahan Sony',
      expectedCash: 11950,
      countedCash: 11950,
      variance: 0,
    });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('from shift_handover_reports r'))).toBe(true);
  });

  it('allows supervisors to accept finalized shift handover snapshots', async () => {
    const { app, mockDB } = createShiftReportApp({ role: 'accountant', userId: 30, snapshot: true });
    const response = await jsonRequest(app, '/reports/shift-handover/sessions/17/accept', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(mockDB.queries.some((query) => query.method === 'run' && query.sql.toLowerCase().includes('update shift_handover_reports'))).toBe(true);
  });

  it('finalizes and stores a shift handover snapshot with hash metadata', async () => {
    const { app, mockDB } = createShiftReportApp();
    const response = await jsonRequest(app, '/reports/shift-handover/sessions/17/finalize', { method: 'POST' });
    expect(response.status).toBe(201);
    const body = await response.json() as { snapshot: Record<string, any>; report: Record<string, any> };
    expect(body.snapshot).toMatchObject({ reportNo: 'SHR-20260619-17', status: 'finalized' });
    expect(String(body.snapshot.hash)).toHaveLength(64);
    expect(body.report.finance.expectedCash).toBe(11950);
    expect(mockDB.queries.some((query) => query.method === 'run' && query.sql.toLowerCase().includes('insert into shift_handover_reports'))).toBe(true);
  });
});
