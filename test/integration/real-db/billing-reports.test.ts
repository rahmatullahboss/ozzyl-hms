/**
 * Billing Reports — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Validates report endpoints for structure, auth, and input validation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, accountantHeaders, receptionHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

let adminH: Record<string, string>;
let accountantH: Record<string, string>;
let receptionH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  accountantH = await accountantHeaders();
  receptionH = await receptionHeaders();
});

describe('GET /api/billing-reports/daily-sales', () => {
  it('returns invoices, settlements, user_collections, summary with correct structure', async () => {
    const res = await api.get('/api/billing-reports/daily-sales?date=2024-01-15', accountantH);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('invoices');
    expect(body).toHaveProperty('settlements');
    expect(body).toHaveProperty('user_collections');
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.invoices)).toBe(true);
    expect(Array.isArray(body.settlements)).toBe(true);
    expect(Array.isArray(body.user_collections)).toBe(true);
    expect(typeof body.summary).toBe('object');
  });

  it('supports counter_id filter', async () => {
    const res = await api.get('/api/billing-reports/daily-sales?date=2024-01-15&counter_id=1', accountantH);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/billing-reports/sales-daybook', () => {
  it('returns daybook array', async () => {
    const res = await api.get(
      '/api/billing-reports/sales-daybook?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.data ?? body.daybook ?? body)).toBe(true);
  });
});

describe('GET /api/billing-reports/handover/receive', () => {
  it('returns handovers and summary', async () => {
    const res = await api.get(
      '/api/billing-reports/handover/receive?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('handovers');
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.handovers)).toBe(true);
  });
});

describe('GET /api/billing-reports/handover/summary', () => {
  it('returns summary data', async () => {
    const res = await api.get(
      '/api/billing-reports/handover/summary?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/billing-reports/discount/scheme-wise', () => {
  it('returns discounts and summary', async () => {
    const res = await api.get(
      '/api/billing-reports/discount/scheme-wise?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('discounts');
    expect(body).toHaveProperty('summary');
    expect(Array.isArray(body.discounts)).toBe(true);
  });
});

describe('GET /api/billing-reports/payment-mode', () => {
  it('returns payment_modes array', async () => {
    const res = await api.get(
      '/api/billing-reports/payment-mode?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.payment_modes ?? body.data ?? body)).toBe(true);
  });
});

describe('GET /api/billing-reports/item-summary', () => {
  it('returns items array', async () => {
    const res = await api.get(
      '/api/billing-reports/item-summary?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body.items ?? body.data ?? body)).toBe(true);
  });
});

describe('GET /api/billing-reports/user-cash-collection', () => {
  it('returns cash collection data', async () => {
    const res = await api.get(
      '/api/billing-reports/user-cash-collection?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/billing-reports/doctor-income-summary', () => {
  it('returns doctor income data', async () => {
    const res = await api.get(
      '/api/billing-reports/doctor-income-summary?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/billing-reports/department-sales-daybook', () => {
  it('returns department sales data', async () => {
    const res = await api.get(
      '/api/billing-reports/department-sales-daybook?start_date=2024-01-01&end_date=2024-01-31',
      accountantH,
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /api/billing-reports/denomination', () => {
  it('returns denomination data for a given date', async () => {
    const res = await api.get('/api/billing-reports/denomination?date=2024-01-15', accountantH);
    expect(res.status).toBe(200);
  });
});

describe('Validation — missing and invalid params', () => {
  it('returns 400 when start_date is missing on sales-daybook', async () => {
    const res = await api.get('/api/billing-reports/sales-daybook?end_date=2024-01-31', accountantH);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await api.get('/api/billing-reports/daily-sales?date=not-a-date', accountantH);
    expect(res.status).toBe(400);
  });
});

describe('Auth — no authentication', () => {
  it('returns 401 without auth token on daily-sales', async () => {
    const res = await api.get('/api/billing-reports/daily-sales?date=2024-01-15', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('Auth — wrong role', () => {
  it('returns 403 for reception on finance-only endpoints', async () => {
    const res = await api.get(
      '/api/billing-reports/sales-daybook?start_date=2024-01-01&end_date=2024-01-31',
      receptionH,
    );
    expect([401, 403]).toContain(res.status);
  });
});
