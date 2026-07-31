/**
 * Ward Supply — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Covers requisitions, dispatches, locations, stock, consumption, and stats.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

let adminH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
});

describe('GET /api/ward-supply/requisitions', () => {
  it('returns list with pagination', async () => {
    const res = await api.get<{
      requisitions: unknown[];
      pagination: { page: number; limit: number; total: number };
    }>('/api/ward-supply/requisitions?page=1&limit=5', adminH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.requisitions)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(5);
    expect(typeof res.body.pagination.total).toBe('number');
  });

  it('filters by status', async () => {
    const res = await api.get<{ requisitions: unknown[] }>(
      '/api/ward-supply/requisitions?status=submitted',
      adminH,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.requisitions)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/ward-supply/requisitions', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/ward-supply/requisitions/:id', () => {
  it('returns 404 for non-existent requisition', async () => {
    const res = await api.get('/api/ward-supply/requisitions/999999', adminH);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/ward-supply/requisitions', () => {
  it('creates requisition with valid data', async () => {
    const payload = {
      wardId: 1,
      wardName: 'Test Ward',
      requestedBy: 'Nurse Joy',
      priority: 'routine',
      items: [
        {
          itemName: 'Gloves',
          quantityRequested: 100,
          unit: 'pcs',
        },
      ],
    };

    const res = await api.post<{ id: number; requisitionNo: string }>(
      '/api/ward-supply/requisitions',
      adminH,
      payload,
    );

    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.requisitionNo).toMatch(/^WSR-/);
  });

  it('returns 400 with missing required fields', async () => {
    const res = await api.post('/api/ward-supply/requisitions', adminH, {
      wardName: 'No Ward ID',
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post('/api/ward-supply/requisitions', noAuthHeaders(), {
      wardId: 1,
      requestedBy: 'Test',
      items: [{ itemName: 'X', quantityRequested: 1 }],
    });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/ward-supply/requisitions/:id/status', () => {
  it('returns 404 for non-existent requisition', async () => {
    const res = await api.patch('/api/ward-supply/requisitions/999999/status', adminH, {
      status: 'approved',
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/ward-supply/requisitions/:id', () => {
  it('soft-deletes a requisition', async () => {
    const createRes = await api.post<{ id: number }>(
      '/api/ward-supply/requisitions',
      adminH,
      {
        wardId: 1,
        requestedBy: 'Delete Test',
        items: [{ itemName: 'Temp Item', quantityRequested: 1 }],
      },
    );

    if (createRes.status === 201) {
      const res = await api.delete(
        `/api/ward-supply/requisitions/${createRes.body.id}`,
        adminH,
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    }
  });
});

describe('GET /api/ward-supply/dispatches', () => {
  it('returns dispatch list', async () => {
    const res = await api.get<{ dispatches: unknown[] }>(
      '/api/ward-supply/dispatches',
      adminH,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.dispatches)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/ward-supply/dispatches', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/ward-supply/dispatches/:id', () => {
  it('returns 404 for non-existent dispatch', async () => {
    const res = await api.get('/api/ward-supply/dispatches/999999', adminH);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /api/ward-supply/locations', () => {
  it('returns ward locations', async () => {
    const res = await api.get<{ locations: unknown[] }>(
      '/api/ward-supply/locations',
      adminH,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.locations)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/ward-supply/locations', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/ward-supply/stock/:wardId', () => {
  it('returns stock for a ward', async () => {
    const res = await api.get<{ stock: unknown[] }>(
      '/api/ward-supply/stock/1',
      adminH,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stock)).toBe(true);
  });
});

describe('GET /api/ward-supply/stats', () => {
  it('returns dashboard stats', async () => {
    const res = await api.get<{
      pendingRequisitions: number;
      todayDispatches: number;
      lowStockItems: number;
      totalRequisitionsThisMonth: number;
    }>('/api/ward-supply/stats', adminH);

    expect(res.status).toBe(200);
    expect(typeof res.body.pendingRequisitions).toBe('number');
    expect(typeof res.body.todayDispatches).toBe('number');
    expect(typeof res.body.lowStockItems).toBe('number');
    expect(typeof res.body.totalRequisitionsThisMonth).toBe('number');
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/ward-supply/stats', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/ward-supply/consumption', () => {
  it('returns 400 with insufficient stock', async () => {
    const res = await api.post('/api/ward-supply/consumption', adminH, {
      wardId: 1,
      itemName: 'NonExistentItem',
      quantity: 999999,
      unit: 'pcs',
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 without auth', async () => {
    const res = await api.post('/api/ward-supply/consumption', noAuthHeaders(), {
      wardId: 1,
      itemName: 'Test',
      quantity: 1,
    });

    expect(res.status).toBe(401);
  });
});
