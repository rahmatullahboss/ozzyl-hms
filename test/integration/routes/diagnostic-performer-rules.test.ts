import { describe, expect, it } from 'vitest';
import billingMasterRoutes from '../../../src/routes/tenant/billingMaster';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, TENANT_2 } from '../helpers/fixtures';

const LAB_ITEM = {
  id: 501,
  tenant_id: TENANT_1.id,
  item_name: 'USG Whole Abdomen',
  item_code: 'RAD-USG-WA',
  price: 1000,
  department_code: 'RAD',
  diagnostic_kind: 'radiology',
};

function createRulesApp(options: {
  item?: Record<string, unknown> | null;
  latestRule?: Record<string, unknown> | null;
  history?: Record<string, unknown>[];
  tenantId?: string;
} = {}) {
  const item = options.item === undefined ? LAB_ITEM : options.item;
  const latestRule = options.latestRule ?? null;
  const history = options.history ?? (latestRule ? [latestRule] : []);
  return createTestApp({
    route: billingMasterRoutes,
    routePath: '/billing-master',
    role: 'hospital_admin',
    tenantId: options.tenantId ?? TENANT_1.id,
    queryOverride: (sql) => {
      if (/FROM\s+billing_service_items\s+si/i.test(sql) && /diagnostic_kind/i.test(sql)) {
        return { first: item };
      }
      if (/FROM\s+diagnostic_performer_payout_rules/i.test(sql) && /ORDER BY\s+effective_from\s+DESC/i.test(sql)) {
        return { first: latestRule, results: history };
      }
      return null;
    },
  });
}

describe('diagnostic performer payout rules', () => {
  it('stores a flat performer reserve rule for a tenant diagnostic test', async () => {
    const { app, mockDB } = createRulesApp();

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 200,
        effective_from: '2026-07-13',
        notes: 'USG performer fee',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { rate_type: string; rate_value: number; flat_amount: number } };
    expect(body.data).toMatchObject({ rate_type: 'flat', rate_value: 200, flat_amount: 200 });
    const insert = mockDB.queries.find((query) => /INSERT INTO diagnostic_performer_payout_rules/i.test(query.sql));
    expect(insert?.params).toEqual(expect.arrayContaining([TENANT_1.id, LAB_ITEM.id, 'radiology', 'flat', 200, '2026-07-13']));
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/INSERT INTO diagnostic_performer_payout_rules/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_compensation_rules/i);
    expect(batch).toMatch(/INSERT INTO canonical_outbox_events/i);
  });

  it('normalizes a percentage rule to basis points', async () => {
    const { app, mockDB } = createRulesApp();

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'percent',
        percent: 15,
        effective_from: '2026-07-13',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { rate_type: string; rate_value: number; percent: number } };
    expect(body.data).toMatchObject({ rate_type: 'percent', rate_value: 1500, percent: 15 });
    const insert = mockDB.queries.find((query) => /INSERT INTO diagnostic_performer_payout_rules/i.test(query.sql));
    expect(insert?.params).toContain(1500);
  });

  it('rejects rule configuration for a non-diagnostic service item', async () => {
    const { app } = createRulesApp({
      item: null,
    });

    const res = await jsonRequest(app, '/billing-master/service-items/700/performer-payout-rule', {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 100,
        effective_from: '2026-07-13',
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expect.objectContaining({ error: expect.stringMatching(/LAB or RAD/i) }));
  });

  it('does not allow a tenant to configure another tenant service item', async () => {
    const { app } = createRulesApp({ item: null, tenantId: TENANT_2.id });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 200,
        effective_from: '2026-07-13',
      },
    });

    expect(res.status).toBe(400);
  });

  it('closes the previous version before inserting a new effective version', async () => {
    const existing = {
      id: 91,
      tenant_id: TENANT_1.id,
      billing_service_item_id: LAB_ITEM.id,
      diagnostic_kind: 'radiology',
      rate_type: 'flat',
      rate_value: 200,
      effective_from: '2026-07-01',
      effective_to: null,
      is_active: 1,
    };
    const { app, mockDB } = createRulesApp({ latestRule: existing });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 250,
        effective_from: '2026-08-01',
      },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((query) => /UPDATE diagnostic_performer_payout_rules/i.test(query.sql));
    expect(update?.params).toEqual(expect.arrayContaining(['2026-07-31', 91, TENANT_1.id]));
    expect(mockDB.queries.some((query) => /INSERT INTO diagnostic_performer_payout_rules/i.test(query.sql))).toBe(true);
  });

  it('disables the current version without deleting history or inserting a new rule', async () => {
    const existing = {
      id: 92,
      tenant_id: TENANT_1.id,
      billing_service_item_id: LAB_ITEM.id,
      diagnostic_kind: 'radiology',
      rate_type: 'flat',
      rate_value: 200,
      effective_from: '2026-07-01',
      effective_to: null,
      is_active: 1,
    };
    const { app, mockDB } = createRulesApp({ latestRule: existing });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: false,
        effective_from: '2026-08-01',
      },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) => /DELETE FROM diagnostic_performer_payout_rules/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO diagnostic_performer_payout_rules/i.test(query.sql))).toBe(false);
    const update = mockDB.queries.find((query) => /UPDATE diagnostic_performer_payout_rules/i.test(query.sql));
    expect(update?.params).toEqual(expect.arrayContaining(['2026-07-31', 92, TENANT_1.id]));
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/UPDATE diagnostic_performer_payout_rules/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_compensation_rules/i);
    expect(batch).toMatch(/'retired'/i);
    const outbox = mockDB.queries.find((query) => /INSERT INTO canonical_outbox_events/i.test(query.sql));
    expect(outbox?.params).toContain('canonical.compensation-rule.retired');
  });

  it('rejects a new version whose effective date is not after the current version', async () => {
    const { app } = createRulesApp({
      latestRule: {
        id: 93,
        tenant_id: TENANT_1.id,
        billing_service_item_id: LAB_ITEM.id,
        diagnostic_kind: 'radiology',
        rate_type: 'flat',
        rate_value: 200,
        effective_from: '2026-08-01',
        effective_to: null,
        is_active: 1,
      },
    });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 250,
        effective_from: '2026-08-01',
      },
    });

    expect(res.status).toBe(409);
  });

  it('accepts an unchanged same-date rule save without creating another version', async () => {
    const existing = {
      id: 94,
      tenant_id: TENANT_1.id,
      billing_service_item_id: LAB_ITEM.id,
      diagnostic_kind: 'radiology',
      rate_type: 'flat',
      rate_value: 200,
      effective_from: '2026-08-01',
      effective_to: null,
      is_active: 1,
      notes: 'USG performer fee',
    };
    const { app, mockDB } = createRulesApp({ latestRule: existing });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 200,
        effective_from: '2026-08-01',
        notes: ' USG performer fee ',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      unchanged: true,
      data: { id: 94, flat_amount: 200, effective_from: '2026-08-01' },
    });
    expect(mockDB.batchCalls).toHaveLength(0);
    expect(mockDB.queries.some((query) => /UPDATE diagnostic_performer_payout_rules/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT INTO diagnostic_performer_payout_rules/i.test(query.sql))).toBe(false);
  });

  it('does not treat a diagnostic-kind change as an unchanged rule save', async () => {
    const existing = {
      id: 95,
      tenant_id: TENANT_1.id,
      billing_service_item_id: LAB_ITEM.id,
      diagnostic_kind: 'lab',
      rate_type: 'flat',
      rate_value: 200,
      effective_from: '2026-08-01',
      effective_to: null,
      is_active: 1,
      notes: 'USG performer fee',
    };
    const { app } = createRulesApp({ latestRule: existing });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`, {
      method: 'PUT',
      body: {
        enabled: true,
        rate_type: 'flat',
        flat_amount: 200,
        effective_from: '2026-08-01',
        notes: 'USG performer fee',
      },
    });

    expect(res.status).toBe(409);
  });

  it('returns the current rule and bounded history with human percentage', async () => {
    const history = [
      {
        id: 100,
        tenant_id: TENANT_1.id,
        billing_service_item_id: LAB_ITEM.id,
        diagnostic_kind: 'radiology',
        rate_type: 'percent',
        rate_value: 1500,
        effective_from: '2026-07-13',
        effective_to: null,
        is_active: 1,
        notes: null,
      },
      {
        id: 99,
        tenant_id: TENANT_1.id,
        billing_service_item_id: LAB_ITEM.id,
        diagnostic_kind: 'radiology',
        rate_type: 'flat',
        rate_value: 200,
        effective_from: '2026-07-01',
        effective_to: '2026-07-12',
        is_active: 0,
        notes: null,
      },
    ];
    const { app } = createRulesApp({ latestRule: history[0], history });

    const res = await jsonRequest(app, `/billing-master/service-items/${LAB_ITEM.id}/performer-payout-rule`);

    expect(res.status).toBe(200);
    const body = await res.json() as { current: { percent: number }; history: unknown[] };
    expect(body.current.percent).toBe(15);
    expect(body.history).toHaveLength(2);
  });
});
