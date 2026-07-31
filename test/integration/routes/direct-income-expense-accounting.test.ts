import { describe, expect, it, vi } from 'vitest';
import expenseRoutes from '../../../src/routes/tenant/expenses';
import incomeRoutes from '../../../src/routes/tenant/income';
import { ACCOUNTING_EVENT_TYPES } from '../../../src/lib/accounting-posting';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const tenantId = 'tenant-1';

describe('Direct income and expense accounting posting', () => {
  it('queues a direct-income accounting event when income is created', async () => {
    const { app, mockDB } = createTestApp({
      route: incomeRoutes,
      routePath: '/income',
      role: 'accountant',
      tenantId,
      tables: {
        income: [],
      },
    });

    const res = await jsonRequest(app, '/income', {
      method: 'POST',
      body: {
        date: '2026-05-10',
        source: 'canteen',
        amount: 900,
        description: 'Canteen cash collection',
      },
    });

    expect(res.status).toBe(201);
    const eventInsert = mockDB.queries.find(q =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql)
        && q.params.includes(ACCOUNTING_EVENT_TYPES.directIncomeReceived)
    );
    expect(eventInsert).toBeTruthy();
  });

  it('blocks editing income once a posting event exists', async () => {
    const { app } = createTestApp({
      route: incomeRoutes,
      routePath: '/income',
      role: 'accountant',
      tenantId,
      tables: {
        income: [{ id: 7, tenant_id: tenantId, date: '2026-05-10', source: 'canteen', amount: 900 }],
      },
      queryOverride: (sql) => {
        if (sql.includes('FROM accounting_posting_events')) {
          return { first: { id: 1 } };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/income/7', {
      method: 'PUT',
      body: { amount: 950 },
    });

    expect(res.status).toBe(409);
  });

  it('queues a reversal journal for posted direct income', async () => {
    const { app, mockDB } = createTestApp({
      route: incomeRoutes,
      routePath: '/income',
      role: 'accountant',
      tenantId,
      tables: {
        income: [{ id: 7, tenant_id: tenantId, date: '2026-05-10', source: 'canteen', amount: 900 }],
      },
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from accounting_posting_events') && lower.includes("source_type = 'direct_income_reversal'")) {
          return { first: null };
        }
        if (lower.includes('from accounting_posting_events') && lower.includes("source_type = 'direct_income'")) {
          return { first: { id: 12, payload_json: JSON.stringify({ paymentMethod: 'cash', amount: 900 }) } };
        }
        if (lower.includes('from accounting_account_mappings')) {
          return {
            results: [
              { mapping_key: 'other_revenue', account_id: 401 },
              { mapping_key: 'cash', account_id: 101 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/income/7/reverse', {
      method: 'POST',
      body: { date: '2026-05-15', reason: 'Wrong cash entry' },
    });

    expect(res.status).toBe(201);
    const eventInsert = mockDB.queries.find(q =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql)
        && q.params.includes(ACCOUNTING_EVENT_TYPES.manualJournal)
        && q.params.includes('direct_income_reversal')
    );
    expect(eventInsert).toBeTruthy();
    const payload = JSON.parse(String(eventInsert?.params.find(param => typeof param === 'string' && param.includes('"lines"'))));
    expect(payload).toMatchObject({
      incomeId: '7',
      reversalOf: 'direct_income',
      reason: 'Wrong cash entry',
      lines: [
        { accountId: 401, debit: 900, credit: 0 },
        { accountId: 101, debit: 0, credit: 900 },
      ],
    });
  });

  it('queues a direct-expense accounting event when an expense is auto-approved', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'accountant',
      tenantId,
      tables: {
        expenses: [],
      },
    });

    const res = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: {
        date: '2026-05-10',
        category: 'maintenance',
        amount: 500,
        description: 'Generator service',
      },
    });

    expect(res.status).toBe(201);
    const eventInsert = mockDB.queries.find(q =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql)
        && q.params.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    );
    expect(eventInsert).toBeTruthy();
  });

  it('does not queue a direct-expense accounting event when a pending expense is approved', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'director',
      tenantId,
      tables: {
        expenses: [{
          id: 8,
          tenant_id: tenantId,
          date: '2026-05-10',
          category: 'maintenance',
          amount: 15000,
          description: 'Generator replacement',
          status: 'pending',
          approval_status: 'pending',
          payment_status: 'unpaid',
        }],
      },
    });

    const res = await jsonRequest(app, '/expenses/8/approve', { method: 'POST' });

    expect(res.status).toBe(200);
    const eventInsert = mockDB.queries.find(q =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql)
        && q.params.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    );
    expect(eventInsert).toBeFalsy();
    const auditInsert = mockDB.queries.find(q => /INSERT INTO audit_logs/i.test(q.sql));
    expect(auditInsert?.params.some(param => String(param).includes('"amount":15000'))).toBe(true);
  });

  it('queues a direct-expense accounting event when an approved expense is executed', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'receptionist',
      userId: 21,
      tenantId,
      tables: {
        expenses: [{
          id: 9,
          tenant_id: tenantId,
          date: '2026-05-10',
          category: 'maintenance',
          amount: 15000,
          description: 'Generator replacement',
          status: 'approved',
          approval_status: 'approved',
          payment_status: 'unpaid',
        }],
        billing_counter_sessions: [{
          id: 1,
          tenant_id: tenantId,
          employee_id: 21,
          counter_id: 3,
          counter_name: 'Main Cash Counter',
          counter_code: 'MAIN',
          counter_type: 'billing',
          opening_cash: 20000,
          opened_at: '2026-05-10 09:00:00',
          status: 'active',
          workstation_id: null,
          heartbeat_at: null,
          variance_approval_status: null,
        }],
        cash_drawer_movements: [],
      },
      queryOverride: (sql) => {
        if (/FROM billing_counter_sessions s/i.test(sql) && /appointment_cash/i.test(sql)) {
          return {
            first: {
              opening_cash: 20000,
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

    const res = await jsonRequest(app, '/expenses/9/execute', {
      method: 'POST',
      body: { idempotencyKey: 'expense-exec-direct-9' },
    });

    expect(res.status).toBe(200);
    const eventInsert = mockDB.queries.find(q =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql)
        && q.params.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    );
    expect(eventInsert).toBeTruthy();
  });

  it('serves a missing local expense receipt through the shared cloud fallback', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }),
    );

    try {
      const { app } = createTestApp({
        route: expenseRoutes,
        routePath: '/expenses',
        role: 'hospital_admin',
        tenantId,
        tables: {
          expenses: [{
            id: 8,
            tenant_id: tenantId,
            receipt_key: 'expenses/tenant-1/8/receipt.webp',
          }],
        },
        extraEnv: {
          ENVIRONMENT: 'local_server',
          CLOUD_SYNC_BASE_URL: 'https://cloud.example',
          CLOUD_SYNC_TOKEN: 'sync-token',
          UPLOADS: {
            get: vi.fn().mockResolvedValue(null),
            put,
          } as any,
        },
      });

      const res = await app.request('/expenses/8/receipt');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/webp');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://cloud.example/api/sync/uploads?key=expenses%2Ftenant-1%2F8%2Freceipt.webp',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer sync-token' }),
        }),
      );
      expect(put).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
