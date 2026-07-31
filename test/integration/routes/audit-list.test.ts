import { describe, expect, it } from 'vitest';
import auditRoutes from '../../../src/routes/tenant/audit';
import { createTestApp } from '../helpers/test-app';

describe('audit list bill payment state', () => {
  it('reconciles paid from total and due when the raw paid column is stale', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (!sql.includes('FROM audit_logs a')) return null;
        return {
          results: [{
            id: 21,
            user_id: 7,
            user_name: 'Audit Supervisor',
            action: 'CREATE',
            table_name: 'bills',
            record_id: 5215,
            old_value: null,
            new_value: JSON.stringify({ invoiceNo: 'BL-000009', total: 8000 }),
            created_at: '2026-06-10 09:35:00',
            billStatus: 'partially_paid',
            billTotal: 8000,
            billPaid: 5000,
            billDue: 3000,
          }],
        };
      },
    });

    const response = await app.request('/audit/logs');
    expect(response.status).toBe(200);
    const body = await response.json() as { auditLogs: Array<Record<string, unknown>> };
    expect(body.auditLogs[0]).toMatchObject({
      billStatus: 'partially_paid',
      billTotal: 8000,
      billPaid: 5000,
      billDue: 3000,
    });

    const listQuery = mockDB.queries.find((query) => query.sql.includes('FROM audit_logs a') && query.method === 'all');
    expect(listQuery?.sql).toContain('LEFT JOIN bills b');
    expect(listQuery?.sql).toContain('a.tenant_id = b.tenant_id');
    expect(listQuery?.sql).toContain("a.table_name IN ('bills', 'billing')");
    expect(listQuery?.sql).toContain('a.record_id = b.id');
    expect(listQuery?.sql).toContain('b.status AS billStatus');
    expect(listQuery?.sql).toContain('AS billTotal');
    expect(listQuery?.sql).toContain('AS billPaid');
    expect(listQuery?.sql).toContain('AS billDue');
    expect(listQuery?.sql).toContain('MAX(0,');
    expect(listQuery?.sql).toContain('COALESCE(b.total, 0)');
    expect(listQuery?.sql).toContain("LOWER(COALESCE(b.status, '')) = 'paid'");
    expect(listQuery?.sql).not.toContain('b.total_amount');
    expect(listQuery?.sql).not.toContain('b.paid_amount');
  });

  it('joins current expense state into expense audit rows', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (!sql.includes('FROM audit_logs a')) return null;
        return {
          results: [{
            id: 22,
            user_id: 7,
            user_name: 'Audit Supervisor',
            action: 'APPROVE',
            table_name: 'expenses',
            record_id: 88,
            old_value: JSON.stringify({ status: 'pending' }),
            new_value: JSON.stringify({ status: 'approved' }),
            created_at: '2026-06-10 09:35:00',
            expenseStatus: 'approved',
            expenseAmount: 3500,
            expenseCategory: 'MAINTENANCE',
            expenseDescription: 'Generator repair',
          }],
        };
      },
    });

    const response = await app.request('/audit/logs');
    expect(response.status).toBe(200);
    const body = await response.json() as { auditLogs: Array<Record<string, unknown>> };
    expect(body.auditLogs[0]).toMatchObject({
      expenseStatus: 'approved',
      expenseAmount: 3500,
      expenseCategory: 'MAINTENANCE',
      expenseDescription: 'Generator repair',
    });

    const listQuery = mockDB.queries.find((query) => query.sql.includes('FROM audit_logs a') && query.method === 'all');
    expect(listQuery?.sql).toContain('LEFT JOIN expenses e');
    expect(listQuery?.sql).toContain("a.table_name = 'expenses'");
    expect(listQuery?.sql).toContain('e.status as expenseStatus');
    expect(listQuery?.sql).toContain('e.amount as expenseAmount');
  });

  it('joins cash custody transfer state into transfer audit rows', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: '102',
      queryOverride: (sql) => {
        if (!sql.includes('FROM audit_logs a')) return null;
        return {
          results: [{
            id: 23,
            user_id: 119,
            user_name: 'Safaoat Ullah',
            action: 'CREATE',
            table_name: 'billing_counter_cash_transfers',
            record_id: 2,
            old_value: null,
            new_value: JSON.stringify({ amount: 18450, status: 'pending' }),
            created_at: '2026-06-19 22:23:36',
            transferNo: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
            transferStatus: 'pending',
            transferAmount: 18450,
            transferReceivedAmount: 0,
            transferDueAmount: 18450,
            transferDestinationType: 'admin_custody',
            transferCustodyLabel: 'Dr. Nazmus Sakib (hospital_admin)',
            transferByName: 'Safaoat Ullah',
            transferToName: 'Dr. Nazmus Sakib',
          }],
        };
      },
    });

    const response = await app.request('/audit/logs');
    expect(response.status).toBe(200);
    const body = await response.json() as { auditLogs: Array<Record<string, unknown>> };
    expect(body.auditLogs[0]).toMatchObject({
      transferNo: 'CCT-8-c1a1eef7-4f45-487d-a586-9e14cf8d7f4a',
      transferStatus: 'pending',
      transferAmount: 18450,
      transferDueAmount: 18450,
      transferByName: 'Safaoat Ullah',
      transferToName: 'Dr. Nazmus Sakib',
    });

    const listQuery = mockDB.queries.find((query) => query.sql.includes('FROM audit_logs a') && query.method === 'all');
    expect(listQuery?.sql).toContain('LEFT JOIN billing_counter_cash_transfers cct');
    expect(listQuery?.sql).toContain("a.table_name = 'billing_counter_cash_transfers'");
    expect(listQuery?.sql).toContain('cct.transfer_no as transferNo');
    expect(listQuery?.sql).toContain('sender.name as transferByName');
    expect(listQuery?.sql).toContain('receiver.name as transferToName');
  });
});
