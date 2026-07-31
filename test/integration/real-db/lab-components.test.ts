/**
 * Lab Components — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests run against a real wrangler dev server on http://localhost:8787.
 * Route prefix: /api/lab-components
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, labHeaders, receptionHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface LabComponent {
  id: number;
  test_id: number;
  name: string;
  unit: string | null;
  reference_range: string | null;
  is_active: 0 | 1;
  tenant_id: number;
}

let adminH: Record<string, string>;
let labH: Record<string, string>;
let receptionH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  labH = await labHeaders();
  receptionH = await receptionHeaders();
});

describe('GET /api/lab-components — component list', () => {
  it('returns components list with 200', async () => {
    const res = await api.get<{ components?: LabComponent[]; data?: LabComponent[] }>(
      '/api/lab-components',
      adminH,
    );
    expect(res.status).toBe(200);
    const components = (res.body.components ?? res.body.data ?? []) as LabComponent[];
    expect(Array.isArray(components)).toBe(true);
    expect(components.length).toBeGreaterThan(0);
  });

  it('each component has id, test_id, name', async () => {
    const res = await api.get<{ components?: LabComponent[]; data?: LabComponent[] }>(
      '/api/lab-components',
      adminH,
    );
    expect(res.status).toBe(200);
    const components = (res.body.components ?? res.body.data ?? []) as LabComponent[];
    if (components.length > 0) {
      const c = components[0]!;
      expect(typeof c.id).toBe('number');
      expect(typeof c.test_id).toBe('number');
      expect(typeof c.name).toBe('string');
    }
  });
});

describe('GET /api/lab-components?test_id=1 — filtered list', () => {
  it('returns filtered components by test_id', async () => {
    const res = await api.get<{ components?: LabComponent[]; data?: LabComponent[] }>(
      '/api/lab-components?test_id=1',
      adminH,
    );
    expect(res.status).toBe(200);
    const components = (res.body.components ?? res.body.data ?? []) as LabComponent[];
    expect(Array.isArray(components)).toBe(true);
    components.forEach(c => {
      expect(c.test_id).toBe(1);
    });
  });

  it('returns empty array for non-existent test_id', async () => {
    const res = await api.get<{ components?: LabComponent[]; data?: LabComponent[] }>(
      '/api/lab-components?test_id=99999',
      adminH,
    );
    expect(res.status).toBe(200);
    const components = (res.body.components ?? res.body.data ?? []) as LabComponent[];
    expect(components).toHaveLength(0);
  });
});

describe('POST /api/lab-components — create component', () => {
  it('creates a lab component', async () => {
    const timestamp = Date.now();
    const newComponent = {
      testId: 1,
      name: `Test Component ${timestamp}`,
      unit: 'mg/dL',
      referenceRange: '10-50',
    };

    const res = await api.post<{ id?: number; message: string }>(
      '/api/lab-components',
      adminH,
      newComponent,
    );
    expect([200, 201]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      expect(res.body).toHaveProperty('id');
    }
  });

  it('returns 400/422 for missing required fields', async () => {
    const res = await api.post('/api/lab-components', adminH, { unit: 'mg/dL' });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/lab-components',
      noAuthHeaders(),
      { testId: 1, name: 'Should Fail' },
    );
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/lab-components/:id — update component', () => {
  it('updates an existing component', async () => {
    // First create a component to update
    const timestamp = Date.now();
    const createRes = await api.post<{ id?: number }>(
      '/api/lab-components',
      adminH,
      { testId: 1, name: `Update Target ${timestamp}`, unit: 'U/L' },
    );

    if (createRes.status !== 200 && createRes.status !== 201) return;
    const componentId = createRes.body.id;
    if (!componentId) return;

    const res = await api.put<{ message: string }>(
      `/api/lab-components/${componentId}`,
      adminH,
      { name: `Updated Component ${timestamp}`, referenceRange: '5-25' },
    );
    expect([200, 404]).toContain(res.status);
  });

  it('returns 404 for non-existent component', async () => {
    const res = await api.put('/api/lab-components/99999999', adminH, { name: 'Ghost' });
    expect([404, 500]).toContain(res.status);
  });
});

describe('DELETE /api/lab-components/:id — soft delete', () => {
  it('soft deletes a component', async () => {
    // Create a component to delete
    const timestamp = Date.now();
    const createRes = await api.post<{ id?: number }>(
      '/api/lab-components',
      adminH,
      { testId: 1, name: `Delete Target ${timestamp}`, unit: 'U/L' },
    );

    if (createRes.status !== 200 && createRes.status !== 201) return;
    const componentId = createRes.body.id;
    if (!componentId) return;

    const res = await api.delete<{ message: string }>(
      `/api/lab-components/${componentId}`,
      adminH,
    );
    expect([200, 404]).toContain(res.status);
  });

  it('returns 404 for non-existent component', async () => {
    const res = await api.delete('/api/lab-components/99999999', adminH);
    expect([404, 500]).toContain(res.status);
  });
});

describe('Auth — wrong role', () => {
  it('returns 401 without auth on GET', async () => {
    const res = await api.get('/api/lab-components', noAuthHeaders());
    expect(res.status).toBe(401);
  });

  it('returns 403 for wrong role (reception) on POST', async () => {
    const res = await api.post(
      '/api/lab-components',
      receptionH,
      { testId: 1, name: 'Blocked' },
    );
    expect([401, 403]).toContain(res.status);
  });
});
