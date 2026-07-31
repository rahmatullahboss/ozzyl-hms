import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import expenseRoutes from '../../../src/routes/tenant/expenses';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const tenantId = 'tenant-1';

describe('Expense receipt verification', () => {
  it('allows directors to verify an uploaded optional voucher without approving the expense', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'director',
      tenantId,
      userId: 44,
      tables: {
        expenses: [{
          id: 9,
          tenant_id: tenantId,
          date: '2026-06-18',
          category: 'MISC',
          amount: 750,
          status: 'approved',
          receipt_key: 'expenses/tenant-1/9/voucher.webp',
          receipt_status: 'uploaded',
        }],
      },
    });

    const res = await jsonRequest(app, '/expenses/9/receipt/verify', { method: 'POST' });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find(q => /SET receipt_status = 'verified'/i.test(q.sql));
    expect(update).toBeTruthy();
    expect(update?.params).toContain('44');
  });

  it('does not verify when no voucher photo is uploaded', async () => {
    const { app } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'md',
      tenantId,
      tables: {
        expenses: [{ id: 10, tenant_id: tenantId, receipt_key: null, receipt_status: 'not_uploaded' }],
      },
    });

    const res = await jsonRequest(app, '/expenses/10/receipt/verify', { method: 'POST' });

    expect(res.status).toBe(400);
  });

  it('does not treat the non-canonical manager label as an authenticated tenant role', async () => {
    const { app } = createTestApp({ route: expenseRoutes, routePath: '/expenses', role: 'manager', tenantId });

    const createRes = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: { date: '2026-06-18', category: 'MISC', amount: 500, description: 'No write access' },
    });
    const readRes = await app.request('/expenses');

    expect(createRes.status).toBe(403);
    expect(readRes.status).toBe(403);
  });

  it('rejects voucher verification for unauthorized accounting roles', async () => {
    const { app } = createTestApp({ route: expenseRoutes, routePath: '/expenses', role: 'accountant', tenantId });
    const res = await jsonRequest(app, '/expenses/9/receipt/verify', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('does not allow a verified voucher to be replaced', async () => {
    const { app } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'hospital_admin',
      tenantId,
      tables: { expenses: [{ id: 9, tenant_id: tenantId, receipt_key: 'old.webp', receipt_status: 'verified' }] },
    });
    const form = new FormData();
    form.append('receipt', new File(['image'], 'voucher.webp', { type: 'image/webp' }));

    const res = await app.request('/expenses/9/receipt', { method: 'POST', body: form });
    expect(res.status).toBe(409);
  });

  it('allows directors to reject a verified voucher with an audited reason', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'director',
      tenantId,
      userId: 44,
      tables: { expenses: [{
        id: 9,
        tenant_id: tenantId,
        receipt_key: 'expenses/tenant-1/9/verified.webp',
        receipt_status: 'verified',
      }] },
    });

    const res = await jsonRequest(app, '/expenses/9/receipt/reject', {
      method: 'POST',
      body: { reason: 'Wrong patient voucher attached' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.find(q => /SET receipt_status = 'rejected'/i.test(q.sql))?.params)
      .toEqual(expect.arrayContaining(['Wrong patient voucher attached']));
    expect(mockDB.queries.some(q => q.params.includes('REJECT_RECEIPT'))).toBe(true);
  });

  it('allows replacing a rejected voucher and resets it to uploaded with an audit log', async () => {
    const put = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'hospital_admin',
      tenantId,
      userId: 7,
      tables: { expenses: [{
        id: 9,
        tenant_id: tenantId,
        receipt_key: 'expenses/tenant-1/9/rejected.webp',
        receipt_status: 'rejected',
      }] },
      extraEnv: {
        UPLOADS: { put, delete: remove } as unknown as R2Bucket,
      },
    });
    const form = new FormData();
    form.append('receipt', new File(['replacement'], 'replacement.webp', { type: 'image/webp' }));

    const res = await app.request('/expenses/9/receipt', { method: 'POST', body: form });

    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('expenses/tenant-1/9/rejected.webp');
    expect(mockDB.queries.some(q => /receipt_status = 'uploaded'/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some(q => q.params.includes('UPLOAD_RECEIPT'))).toBe(true);
  });

  it('requires a reason when rejecting a voucher', async () => {
    const { app } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'director',
      tenantId,
      tables: { expenses: [{ id: 9, tenant_id: tenantId, receipt_key: 'voucher.webp', receipt_status: 'uploaded' }] },
    });
    const res = await jsonRequest(app, '/expenses/9/receipt/reject', { method: 'POST', body: { reason: ' ' } });
    expect(res.status).toBe(400);
  });

  it('requires a rejected voucher to be replaced before it can be verified again', async () => {
    const { app } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'md',
      tenantId,
      tables: { expenses: [{
        id: 9,
        tenant_id: tenantId,
        receipt_key: 'expenses/tenant-1/9/rejected.webp',
        receipt_status: 'rejected',
      }] },
    });

    const res = await jsonRequest(app, '/expenses/9/receipt/verify', { method: 'POST' });

    expect(res.status).toBe(409);
  });

  it('allows a delegated manager to upload a receipt without full expense write access', async () => {
    const put = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'manager',
      tenantId,
      userId: 77,
      tables: {
        expenses: [{ id: 19, tenant_id: tenantId, receipt_key: null, receipt_status: 'not_uploaded' }],
        user_permission_overrides: [{ tenant_id: tenantId, user_id: '77', permission: 'expenses.receipts.upload', action: 'grant' }],
      },
      extraEnv: {
        UPLOADS: { put, delete: remove } as unknown as R2Bucket,
      },
    });
    const form = new FormData();
    form.append('receipt', new File(['webp-image'], 'voucher.webp', { type: 'image/webp' }));

    const res = await app.request('/expenses/19/receipt', { method: 'POST', body: form });

    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledOnce();
    expect(mockDB.queries.some(q => q.params.includes('UPLOAD_RECEIPT'))).toBe(true);
  });

  it('does not let reception upload receipts unless the upload responsibility is delegated', async () => {
    const put = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const { app } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'reception',
      tenantId,
      userId: 88,
      tables: {
        expenses: [{ id: 20, tenant_id: tenantId, receipt_key: null, receipt_status: 'not_uploaded' }],
      },
      extraEnv: {
        UPLOADS: { put, delete: remove } as unknown as R2Bucket,
      },
    });
    const form = new FormData();
    form.append('receipt', new File(['webp-image'], 'voucher.webp', { type: 'image/webp' }));

    const res = await app.request('/expenses/20/receipt', { method: 'POST', body: form });

    expect(res.status).toBe(403);
    expect(put).not.toHaveBeenCalled();
  });

  it('exposes a limited missing and rejected receipt queue to receipt uploaders', async () => {
    const { app, mockDB } = createTestApp({
      route: expenseRoutes,
      routePath: '/expenses',
      role: 'accountant',
      tenantId,
      tables: {
        expenses: [
          { id: 21, tenant_id: tenantId, receipt_key: null, receipt_status: 'not_uploaded', date: '2026-06-20', category: 'MISC', amount: 500 },
          { id: 22, tenant_id: tenantId, receipt_key: 'bad.webp', receipt_status: 'rejected', date: '2026-06-21', category: 'MISC', amount: 600 },
          { id: 23, tenant_id: tenantId, receipt_key: 'ok.webp', receipt_status: 'verified', date: '2026-06-22', category: 'MISC', amount: 700 },
        ],
      },
    });

    const res = await app.request('/expenses/receipt-queue');

    expect(res.status).toBe(200);
    const body = await res.json() as { expenses: unknown[] };
    expect(Array.isArray(body.expenses)).toBe(true);
    expect(mockDB.queries.some(q => /receipt_status/i.test(q.sql) && /not_uploaded/i.test(q.sql) && /rejected/i.test(q.sql))).toBe(true);
  });

  it('enforces allowed receipt statuses at the database boundary', () => {
    const migration = readFileSync(new URL('../../../migrations/0254_expense_receipt_verification.sql', import.meta.url), 'utf8');
    expect(migration).toContain('trg_expenses_receipt_status_insert');
    expect(migration).toContain('trg_expenses_receipt_status_update');
    expect(migration).toContain("'not_uploaded', 'uploaded', 'verified', 'rejected'");
  });
});
