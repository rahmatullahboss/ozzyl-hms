import { describe, expect, it } from 'vitest';
import accountsRoutes from '../../../src/routes/tenant/accounts';
import { createTestApp } from '../helpers/test-app';

describe('chart of accounts governance', () => {
  it('allows hospital admin to create a chart account when code and parent are valid', async () => {
    const { app, mockDB } = createTestApp({
      route: accountsRoutes,
      routePath: '/accounts',
      role: 'hospital_admin',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select id from chart_of_accounts where code')) return { first: null };
        if (lower.includes('insert into chart_of_accounts')) return { success: true, meta: { last_row_id: 77, changes: 1 } };
        return null;
      },
    });

    const res = await app.request('/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '5901', name: 'Bank Charge', type: 'expense' }),
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((q) => /INSERT INTO chart_of_accounts/i.test(q.sql))).toBe(true);
  });

  it('rejects creating a child account under a parent of a different account type', async () => {
    const { app, mockDB } = createTestApp({
      route: accountsRoutes,
      routePath: '/accounts',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select id from chart_of_accounts where code')) return { first: null };
        if (lower.includes('select id, type, is_active from chart_of_accounts where id')) {
          return { first: { id: 10, type: 'asset', is_active: 1 } };
        }
        return null;
      },
    });

    const res = await app.request('/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '5902', name: 'Invalid Child', type: 'expense', parent_id: 10 }),
    });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/same account type/i);
    expect(mockDB.queries.some((q) => /INSERT INTO chart_of_accounts/i.test(q.sql))).toBe(false);
  });

  it('blocks account type changes after the account has journal activity', async () => {
    const { app, mockDB } = createTestApp({
      route: accountsRoutes,
      routePath: '/accounts',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select * from chart_of_accounts')) {
          return { first: { id: 5, tenant_id: 'tenant-1', code: '1100', name: 'Cash', type: 'asset', is_active: 1 } };
        }
        if (lower.includes('from accounting_journal_lines')) return { first: { count: 3 } };
        return null;
      },
    });

    const res = await app.request('/accounts/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cash Drawer', type: 'expense' }),
    });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/cannot change account type/i);
    expect(mockDB.queries.some((q) => /UPDATE chart_of_accounts/i.test(q.sql))).toBe(false);
  });

  it('deactivates chart accounts instead of hard deleting them', async () => {
    const { app, mockDB } = createTestApp({
      route: accountsRoutes,
      routePath: '/accounts',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select * from chart_of_accounts')) {
          return { first: { id: 9, tenant_id: 'tenant-1', code: '5999', name: 'Old Expense', type: 'expense', is_active: 1 } };
        }
        if (lower.includes('from accounting_account_mappings')) return { first: { count: 0 } };
        if (lower.includes('update chart_of_accounts set is_active = 0')) return { success: true, meta: { changes: 1 } };
        return null;
      },
    });

    const res = await app.request('/accounts/9', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((q) => /UPDATE chart_of_accounts SET is_active = 0/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /DELETE FROM chart_of_accounts/i.test(q.sql))).toBe(false);
  });

  it('blocks deactivating accounts mapped to central posting configuration', async () => {
    const { app, mockDB } = createTestApp({
      route: accountsRoutes,
      routePath: '/accounts',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('select * from chart_of_accounts')) {
          return { first: { id: 1, tenant_id: 'tenant-1', code: '1100', name: 'Cash', type: 'asset', is_active: 1 } };
        }
        if (lower.includes('from accounting_account_mappings')) return { first: { count: 1 } };
        return null;
      },
    });

    const res = await app.request('/accounts/1', { method: 'DELETE' });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/posting configuration/i);
    expect(mockDB.queries.some((q) => /UPDATE chart_of_accounts/i.test(q.sql))).toBe(false);
  });
});
