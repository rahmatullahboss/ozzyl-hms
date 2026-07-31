import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const SETTINGS: Record<string, unknown> = {
  id: 1, tenant_id: 1, default_cleaning_minutes: 30,
  default_sterilization_minutes: 45, vitals_reminder_minutes: 5,
  emergency_override_allowed: 1, hard_block_on_consent: 1,
  hard_block_on_anesthesia_fitness: 1, hard_block_on_payment: 0,
  hard_block_on_blood: 0, bill_post_requires_review: 1,
  commission_calculation_enabled: 1, auto_deduct_stock_on_post: 1,
  offline_draft_enabled: 0, created_by: 1, created_at: '2026-06-05 10:00:00',
  updated_at: null,
};

function makeApp(opts: {
  settings?: Record<string, unknown> | null;
  upsertedId?: number;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const settings = opts.settings === undefined ? SETTINGS : opts.settings;
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
        if (s.includes('insert into ot_settings') || s.includes('insert or replace into ot_settings')) {
          return { first: { id: opts.upsertedId ?? 1 }, results: [{ id: opts.upsertedId ?? 1 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_settings')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_settings')) {
          return { first: settings, results: settings ? [settings] : [], success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/settings', () => {
  it('returns 200 with the OT settings', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: { hard_block_on_consent: number; default_cleaning_minutes: number } };
    expect(body.settings.hard_block_on_consent).toBe(1);
    expect(body.settings.default_cleaning_minutes).toBe(30);
  });

  it('returns defaults when no settings exist', async () => {
    const { app } = makeApp({ settings: null });
    const res = await jsonRequest(app, '/ot/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: { default_cleaning_minutes: number; hard_block_on_consent: number } };
    expect(body.settings.default_cleaning_minutes).toBe(30);
    expect(body.settings.hard_block_on_consent).toBe(1);
  });
});

describe('PUT /api/ot/settings', () => {
  it('upserts settings and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/settings', {
      method: 'PUT',
      body: {
        default_cleaning_minutes: 45,
        hard_block_on_payment: 1,
        vitals_reminder_minutes: 10,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upsert = calls.find(c =>
      c.sql.toLowerCase().includes('insert') && c.sql.toLowerCase().includes('ot_settings')
    );
    expect(upsert).toBeDefined();
    expect(upsert!.params).toContain(45);
    expect(upsert!.params).toContain(10);
  });
});
