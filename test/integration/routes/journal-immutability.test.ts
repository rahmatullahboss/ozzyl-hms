import { describe, expect, it } from 'vitest';
import journalRoutes from '../../../src/routes/tenant/journal';
import { createTestApp } from '../helpers/test-app';

describe('journal voucher immutability', () => {
  it('rejects manual journal creation without an accounting finance role', async () => {
    const { app, mockDB } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'receptionist',
    });

    const res = await app.request('/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_date: '2026-05-10',
        debit_account_id: 1,
        credit_account_id: 2,
        amount: 1000,
        description: 'Unauthorized journal',
      }),
    });

    expect(res.status).toBe(403);
    expect(mockDB.queries.some((q) => /INSERT INTO accounting_posting_events/i.test(q.sql))).toBe(false);
  });

  it('rejects creating a manual journal in a closed accounting period', async () => {
    const { app, mockDB } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'director',
      tables: {
        accounting_period_closes: [{
          id: 1,
          tenant_id: 'tenant-1',
          fiscal_year_id: 1,
          period_name: '2026-05',
          status: 'closed',
        }],
      },
    });

    const res = await app.request('/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_date: '2026-05-10',
        debit_account_id: 1,
        credit_account_id: 2,
        amount: 1000,
        description: 'Closed-period journal',
      }),
    });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/period 2026-05 is closed/i);
    expect(mockDB.queries.some((q) => /INSERT INTO accounting_posting_events/i.test(q.sql))).toBe(false);
  });

  it('rejects deleting a verified legacy journal voucher', async () => {
    const { app, mockDB } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'director',
      tables: {
        journal_entries: [{
          id: 8,
          tenant_id: 'tenant-1',
          is_deleted: 0,
          status: 'verified',
          amount: 1000,
          debit_account_id: 1,
          credit_account_id: 2,
        }],
      },
    });

    const res = await app.request('/journal/8', { method: 'DELETE' });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/reversal/i);
    expect(mockDB.queries.some((q) => /UPDATE journal_entries SET is_deleted = 1/i.test(q.sql))).toBe(false);
  });

  it('rejects deleting a pending journal voucher in a closed accounting period', async () => {
    const { app, mockDB } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'director',
      tables: {
        journal_entries: [{
          id: 9,
          tenant_id: 'tenant-1',
          is_deleted: 0,
          status: 'pending',
          entry_date: '2026-05-15',
          amount: 750,
          debit_account_id: 1,
          credit_account_id: 2,
        }],
        accounting_period_closes: [{
          id: 1,
          tenant_id: 'tenant-1',
          fiscal_year_id: 1,
          period_name: '2026-05',
          status: 'closed',
        }],
      },
    });

    const res = await app.request('/journal/9', { method: 'DELETE' });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/period 2026-05 is closed/i);
    expect(mockDB.queries.some((q) => /UPDATE journal_entries SET is_deleted = 1/i.test(q.sql))).toBe(false);
  });

  it('lists posting-engine manual journals from verified accounting vouchers', async () => {
    const { app, mockDB } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'accountant',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_vouchers v') && lower.includes("v.event_type = 'manual_journal'")) {
          return {
            results: [{
              id: 44,
              entry_date: '2026-05-11',
              reference: 'JV-FY26-044',
              voucher_number: 'JV-FY26-044',
              voucher_type_code: 'JV',
              voucher_type_name: 'Journal Voucher',
              status: 'verified',
              description: 'Manual correction',
              debit_account_id: 101,
              debit_code: '5100',
              debit_name: 'Expense',
              credit_account_id: 202,
              credit_code: '1100',
              credit_name: 'Cash',
              amount: 1250,
              created_by_name: 'Accountant',
            }],
          };
        }
        if (lower.includes('from journal_entries j')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await app.request('/journal?startDate=2026-05-01&endDate=2026-05-31');
    const body = await res.json() as {
      journalEntries: Array<{ id: number; reference: string; debit_code: string; credit_code: string; amount: number; status: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.journalEntries).toEqual([
      expect.objectContaining({
        id: 44,
        reference: 'JV-FY26-044',
        debit_code: '5100',
        credit_code: '1100',
        amount: 1250,
        status: 'verified',
      }),
    ]);
    expect(mockDB.queries.some((q) => q.sql.includes('FROM accounting_vouchers v'))).toBe(true);
  });

  it('serves the frontend pending-voucher route alias before the dynamic journal id route', async () => {
    const { app } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'director',
      tables: { journal_entries: [] },
    });

    const res = await app.request('/journal/pending');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pendingEntries: [] });
  });

  it('rejects deleting a verified posting-engine voucher with reversal guidance', async () => {
    const { app, mockDB } = createTestApp({
      route: journalRoutes,
      routePath: '/journal',
      role: 'director',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from journal_entries')) return { first: null };
        if (lower.includes('from accounting_vouchers')) {
          return { first: { id: 44, tenant_id: 'tenant-1', status: 'verified', entry_date: '2026-05-11' } };
        }
        return null;
      },
    });

    const res = await app.request('/journal/44', { method: 'DELETE' });
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/reversal/i);
    expect(mockDB.queries.some((q) => /DELETE FROM accounting_vouchers/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE accounting_vouchers/i.test(q.sql))).toBe(false);
  });
});
