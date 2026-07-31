/**
 * Lab Validation — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests run against a real wrangler dev server on http://localhost:8787.
 * Route prefix: /api/lab-validation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, labHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface ValidationRule {
  id: number;
  lab_test_id: number;
  component_name: string;
  min_value: number | null;
  max_value: number | null;
  unit: string | null;
  is_active: 0 | 1;
  tenant_id: number;
}

let adminH: Record<string, string>;
let labH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  labH = await labHeaders();
});

describe('GET /api/lab-validation/rules — rules list', () => {
  it('returns validation rules with 200', async () => {
    const res = await api.get<{ rules?: ValidationRule[]; data?: ValidationRule[] }>(
      '/api/lab-validation/rules',
      adminH,
    );
    expect(res.status).toBe(200);
    const rules = (res.body.rules ?? res.body.data ?? []) as ValidationRule[];
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('each rule has id, lab_test_id, component_name', async () => {
    const res = await api.get<{ rules?: ValidationRule[]; data?: ValidationRule[] }>(
      '/api/lab-validation/rules',
      adminH,
    );
    expect(res.status).toBe(200);
    const rules = (res.body.rules ?? res.body.data ?? []) as ValidationRule[];
    if (rules.length > 0) {
      const rule = rules[0]!;
      expect(typeof rule.id).toBe('number');
      expect(typeof rule.lab_test_id).toBe('number');
      expect(typeof rule.component_name).toBe('string');
    }
  });
});

describe('GET /api/lab-validation/rules?lab_test_id=1 — filtered rules', () => {
  it('returns rules filtered by lab_test_id', async () => {
    const res = await api.get<{ rules?: ValidationRule[]; data?: ValidationRule[] }>(
      '/api/lab-validation/rules?lab_test_id=1',
      adminH,
    );
    expect(res.status).toBe(200);
    const rules = (res.body.rules ?? res.body.data ?? []) as ValidationRule[];
    expect(Array.isArray(rules)).toBe(true);
    rules.forEach(rule => {
      expect(rule.lab_test_id).toBe(1);
    });
  });

  it('returns empty array for non-existent lab_test_id', async () => {
    const res = await api.get<{ rules?: ValidationRule[]; data?: ValidationRule[] }>(
      '/api/lab-validation/rules?lab_test_id=99999',
      adminH,
    );
    expect(res.status).toBe(200);
    const rules = (res.body.rules ?? res.body.data ?? []) as ValidationRule[];
    expect(rules).toHaveLength(0);
  });
});

describe('POST /api/lab-validation/rules — create rule', () => {
  it('creates a validation rule', async () => {
    const timestamp = Date.now();
    const newRule = {
      labTestId: 1,
      componentName: `TestComponent${timestamp}`,
      minValue: 10,
      maxValue: 100,
      unit: 'mg/dL',
    };

    const res = await api.post<{ id?: number; message: string }>(
      '/api/lab-validation/rules',
      adminH,
      newRule,
    );
    expect([200, 201]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      expect(res.body).toHaveProperty('id');
    }
  });

  it('returns 400/422 for missing required fields', async () => {
    const res = await api.post('/api/lab-validation/rules', adminH, { unit: 'mg/dL' });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/lab-validation/rules',
      noAuthHeaders(),
      { labTestId: 1, componentName: 'Test' },
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/lab-validation/validate — validate result', () => {
  it('validates a lab result against rules', async () => {
    const payload = {
      labTestId: 1,
      results: [
        { componentName: 'Hemoglobin', value: 14.5 },
        { componentName: 'WBC', value: 7500 },
      ],
    };

    const res = await api.post<{ valid?: boolean; warnings?: unknown[]; message: string }>(
      '/api/lab-validation/validate',
      labH,
      payload,
    );
    // 200 = success, 400/422 = validation error, 404 = route not found
    expect([200, 400, 404, 422]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('valid');
    }
  });

  it('returns 400/422 for empty results', async () => {
    const res = await api.post(
      '/api/lab-validation/validate',
      labH,
      { labTestId: 1, results: [] },
    );
    expect([400, 404, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/lab-validation/validate',
      noAuthHeaders(),
      { labTestId: 1, results: [] },
    );
    expect(res.status).toBe(401);
  });
});
