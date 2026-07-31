import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

describe('admin dashboard finance controls', () => {
  it('returns cash lifecycle and finance-control metrics with dashboard stats', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as today_collection_total')) {
          return { results: [{ today_collection_total: 1500 }] };
        }
        if (lower.includes('as pending_handover_amount')) {
          return { results: [{ pending_handover_amount: 700, pending_handover_count: 2 }] };
        }
        if (lower.includes('as patient_due_total')) {
          expect(sql).toContain('COALESCE(b.due, COALESCE(b.total, 0) - COALESCE(b.paid, 0), 0)');
          expect(sql).toContain('FROM bills b');
          return { results: [{ patient_due_total: 650 }] };
        }
        if (lower.includes('as patient_advance_total')) {
          return { results: [{ patient_advance_total: 950 }] };
        }
        if (lower.includes('as pending_posting_events')) {
          return { results: [{ pending_posting_events: 4 }] };
        }
        if (lower.includes('as total_expense')) {
          return { results: [{ total_expense: 500 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/stats');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      finance: {
        todayCollection: number;
        pendingHandoverAmount: number;
        pendingHandoverCount: number;
        patientDue: number;
        patientAdvance: number;
        todayDeposit: number;
        pendingPostingEvents: number;
        todayExpense: number;
      };
    };
    expect(body.finance).toEqual({
      todayCollection: 1500,
      pendingHandoverAmount: 700,
      pendingHandoverCount: 2,
      patientDue: 650,
      patientAdvance: 950,
      todayDeposit: 0,
      pendingPostingEvents: 4,
      todayExpense: 500,
    });
    expect(mockDB.queries.some((q) => q.sql.includes('FROM accounting_posting_events'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM payments'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM billing_handovers'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM billing_deposits'))).toBe(true);
    const expenseQuery = mockDB.queries.find((q) => q.sql.toLowerCase().includes('as total_expense'));
    expect(expenseQuery?.sql).toContain("COALESCE(e.status, 'approved') != 'rejected'");
    expect(expenseQuery?.sql).toContain("COALESCE(e.payment_status, 'unpaid') = 'paid'");
    expect(expenseQuery?.sql).toContain('e.cash_movement_id IS NOT NULL');
    expect(expenseQuery?.sql).toContain('FROM cash_drawer_movements m');
    expect(expenseQuery?.sql).toContain("doctor_commission_settlement");
    const recentActivityQuery = mockDB.queries.find((q) => q.sql.includes('FROM audit_logs al'));
    expect(recentActivityQuery?.sql).toContain('AS billPaid');
    expect(recentActivityQuery?.sql).toContain('MAX(0,');
    expect(recentActivityQuery?.sql).toContain('COALESCE(b.total, 0)');
    expect(recentActivityQuery?.sql).toContain("LOWER(COALESCE(b.status, '')) = 'paid'");
    expect(recentActivityQuery?.sql).not.toContain('b.total_amount');
    expect(recentActivityQuery?.sql).not.toContain('b.paid_amount');
  });

  it('returns evidence-rich cash-control monitoring for admin review', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('as bill_cash_in')) {
          return {
            results: [{
              bill_cash_in: 6901,
              refund_cash_out: 0,
              manual_cash_in: 0,
              manual_cash_out: 1600,
              cash_drop_total: 0,
              handover_collected: 5301,
              active_expected_cash: 5301,
              active_counter_count: 1,
              pending_handover_amount: 0,
              pending_handover_count: 0,
              closed_variance: 0,
              closed_session_count: 0,
              approved_expense_total: 1600,
              expense_count: 1,
              expense_with_receipt_count: 1,
              expense_missing_receipt_count: 0,
              pending_expense_count: 0,
            }],
          };
        }
        if (lower.includes('from emp_cash_transactions ect') && lower.includes('union all')) {
          return {
            results: [
              {
                source_type: 'patient_transaction',
                id: 41,
                created_at: '2026-06-06 10:00:00',
                label: 'Patient cash collection',
                detail: 'OPD bill payment',
                signed_amount: 6901,
                counter_name: 'Reception',
                operator_name: 'Nusrat Jahan Sony',
                reference_type: 'bill',
                reference_id: 76,
              },
              {
                source_type: 'drawer_movement',
                id: 42,
                created_at: '2026-06-06 12:59:00',
                label: 'Expense payment',
                detail: 'adjust',
                signed_amount: -1600,
                counter_name: 'Reception',
                operator_name: 'Nusrat Jahan Sony',
                reference_type: 'expense',
                reference_id: 77,
              },
            ],
          };
        }
        if (lower.includes('from cash_drawer_movements m')) {
          return {
            results: [{
              id: 42,
              movement_type: 'cash_out',
              amount: 1600,
              description: 'adjust',
              created_at: '2026-06-06 12:59:00',
              counter_name: 'Reception',
              counter_code: 'REC',
              operator_name: 'Nusrat Jahan Sony',
              created_by_name: 'Nusrat Jahan Sony',
              reference_type: 'expense',
              reference_id: 77,
              expense_category: 'MISC',
              expense_description: 'adjust',
              receipt_key: 'expenses/tenant-1/77/photo.webp',
            }],
          };
        }
        if (lower.includes('from expenses e')) {
          return {
            results: [{
              id: 77,
              date: '2026-06-06',
              category: 'MISC',
              amount: 1600,
              description: 'adjust',
              status: 'approved',
              receipt_key: 'expenses/tenant-1/77/photo.webp',
              created_by_name: 'Nusrat Jahan Sony',
              approved_by_name: 'Admin User',
            }],
          };
        }
        if (lower.includes('from billing_handovers h')) {
          return {
            results: [{
              id: 9,
              handover_amount: 5301,
              due_amount: 0,
              status: 'pending',
              created_at: '2026-06-06 13:10:00',
              handover_by_name: 'Nusrat Jahan Sony',
              handover_to_name: 'Admin User',
              counter_name: 'Reception',
              variance: 0,
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/cash-control?date=2026-06-06');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      date: string;
      totals: {
        billCashIn: number;
        manualCashOut: number;
        handoverCollected: number;
        activeExpectedCash: number;
      };
      receiptSummary: {
        expenseCount: number;
        withReceiptCount: number;
        missingReceiptCount: number;
      };
      latestMovements: Array<{
        movementType: string;
        amount: number;
        reason: string;
        receiptAvailable: boolean;
      }>;
      latestExpenses: Array<{ id: number; hasReceipt: boolean }>;
      latestHandovers: Array<{ id: number; status: string }>;
      cashStatement: Array<{
        id: string;
        signedAmount: number;
        balanceAfter: number;
        sourceType: string;
      }>;
    };

    expect(body.date).toBe('2026-06-06');
    expect(body.totals.billCashIn).toBe(6901);
    expect(body.totals.manualCashOut).toBe(1600);
    expect(body.totals.handoverCollected).toBe(5301);
    expect(body.totals.activeExpectedCash).toBe(5301);
    expect(body.receiptSummary).toMatchObject({
      expenseCount: 1,
      withReceiptCount: 1,
      missingReceiptCount: 0,
    });
    expect(body.latestMovements[0]).toMatchObject({
      movementType: 'cash_out',
      amount: 1600,
      reason: 'adjust',
      receiptAvailable: true,
    });
    expect(body.latestExpenses[0]).toMatchObject({ id: 77, hasReceipt: true });
    expect(body.latestHandovers[0]).toMatchObject({ id: 9, status: 'pending' });
    expect(body.cashStatement).toEqual([
      expect.objectContaining({
        id: 'drawer_movement-42',
        signedAmount: -1600,
        balanceAfter: 5301,
        sourceType: 'drawer_movement',
      }),
      expect.objectContaining({
        id: 'patient_transaction-41',
        signedAmount: 6901,
        balanceAfter: 6901,
        sourceType: 'patient_transaction',
      }),
    ]);
    const statementQuery = mockDB.queries.find((query) => query.sql.includes('FROM emp_cash_transactions ect') && query.sql.includes('UNION ALL'));
    expect(statementQuery?.sql).toContain('FROM cash_drawer_movements m');
    expect(statementQuery?.sql).toContain('emp_cash_transactions');
    expect(statementQuery?.sql).toContain("COALESCE(m.reference_type, '') NOT IN");
    expect(statementQuery?.sql).toContain('COALESCE(ect.transaction_date, ect.created_at)');
    expect(statementQuery?.sql).not.toContain('COALESCE(COALESCE(ect.transaction_date, ect.created_at))');
    expect(mockDB.queries.some((q) => q.sql.includes('cash_drawer_movements'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('receipt_key'))).toBe(true);
  });

  it('rejects clinical-only users from owner financial and security dashboards', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'nurse',
      tenantId: 'tenant-1',
    });

    const statsResponse = await app.request('/dashboard/stats');
    const securityResponse = await app.request('/dashboard/security-alerts');

    expect(statsResponse.status).toBe(403);
    expect(securityResponse.status).toBe(403);
  });



  it('includes all discounted bills separately from high-discount alerts', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/dashboard/security-alerts?date=2026-06-23');

    expect(response.status).toBe(200);
    const discountQuery = mockDB.queries.find((query) => query.sql.includes('/* all_discount_bills */'));
    const highDiscountQuery = mockDB.queries.find((query) => query.sql.includes('/* high_discount_bills */'));
    expect(discountQuery?.sql).toContain('AND b.discount > 0');
    expect(discountQuery?.sql).not.toContain('(b.discount * 100.0 / bs.subtotal) > 20');
    expect(highDiscountQuery?.sql).toContain('(b.discount * 100.0 / bs.subtotal) > 20');
  });

  it('reads security alerts from deployed handover and medicine columns', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/dashboard/security-alerts');

    expect(response.status).toBe(200);
    const handoverQuery = mockDB.queries.find((query) => query.sql.includes('FROM billing_handovers h'));
    const stockQuery = mockDB.queries.find((query) => query.sql.includes('FROM medicines'));

    expect(handoverQuery?.sql).toContain('s.variance');
    expect(handoverQuery?.sql).not.toContain('h.received_amount');
    expect(handoverQuery?.sql).not.toContain('h.variance');
    expect(stockQuery?.sql).not.toMatch(/quantity,\s*unit/);
  });
});
