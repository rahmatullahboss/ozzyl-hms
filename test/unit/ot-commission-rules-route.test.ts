import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const SAMPLE_ROWS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, role: 'surgeon', rule_type: 'percentage_of_surgery',
    amount: 0, percent: 15, procedure_id: null, department_id: null,
    doctor_id: null, include_emergency_surcharge: 0, is_active: 1,
    priority: 10, created_by: 1, created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, role: 'anesthetist', rule_type: 'fixed_amount',
    amount: 5000, percent: 0, procedure_id: null, department_id: null,
    doctor_id: null, include_emergency_surcharge: 0, is_active: 1,
    priority: 5, created_by: 1, created_at: '2026-06-05 10:00:00' },
];

function makeApp(opts: {
  rows?: Record<string, unknown>[];
  insertedId?: number;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? SAMPLE_ROWS;
  return {
    calls,
    ...createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'hospital_admin',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.includes('insert into ot_commission_rules')) {
          return { first: { id: opts.insertedId ?? 99 }, results: [{ id: opts.insertedId ?? 99 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_commission_rules')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_commission_rules')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_commission_rules') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_commission_rules')) {
          return { first: null, results: rows, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/commission-rules', () => {
  it('returns 200 with all active commission rules', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/commission-rules');
    expect(res.status).toBe(200);
    const body = await res.json() as { rules: Array<{ role: string; rule_type: string }> };
    expect(body.rules.length).toBe(2);
    expect(body.rules[0].role).toBe('surgeon');
  });
});

describe('POST /api/ot/commission-rules', () => {
  it('creates a rule and returns 201', async () => {
    const { app, calls } = makeApp({ insertedId: 55 });
    const res = await jsonRequest(app, '/ot/commission-rules', {
      method: 'POST',
      body: {
        role: 'assistant_surgeon',
        rule_type: 'percentage_of_surgery',
        percent: 10,
        priority: 8,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(55);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_commission_rules'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('assistant_surgeon');
  });

  it('rejects missing role with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/commission-rules', {
      method: 'POST',
      body: { rule_type: 'fixed_amount', amount: 5000 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid rule_type with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/commission-rules', {
      method: 'POST',
      body: { role: 'surgeon', rule_type: 'profit_share' },
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ot/commission-rules/:id', () => {
  it('updates a rule and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/commission-rules/1', {
      method: 'PUT',
      body: { percent: 20, priority: 15 },
    });
    expect(res.status).toBe(200);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_commission_rules'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain(20);
  });
});

describe('DELETE /api/ot/commission-rules/:id', () => {
  it('soft-deletes the rule (is_active=0) and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/commission-rules/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const del = calls.find(c => c.sql.toLowerCase().includes('update ot_commission_rules set is_active = 0'));
    expect(del).toBeDefined();
  });
});
