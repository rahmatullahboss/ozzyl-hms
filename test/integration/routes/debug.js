const { describe, it } = require('vitest');

async function run() {
  const { Hono } = require('hono');
  const lab = require('../../../src/routes/tenant/lab').default;
  const { createMockDB } = require('../helpers/mock-db');
  
  function smartQO(sql) {
    const s = sql.toLowerCase();
    if ((s.includes('select id from') || s.includes('select 1 from')) && s.includes('where'))
      return { first: null, results: [], success: true, meta: {} };
    if (s.includes('count(*)') || s.includes('count(1)'))
      return { first: { cnt: 3, count: 3, total: 3, 'count(*)': 3 }, results: [{ cnt: 3 }], success: true, meta: {} };
    if (s.includes('max('))
      return { first: { next_token: 5, max_no: 5 }, results: [{ next_token: 5 }], success: true, meta: {} };
    if (s.includes('coalesce(') || s.includes('sum('))
      return { first: { total: 10000 }, results: [{ total: 10000 }], success: true, meta: {} };
    return null;
  }
  
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: smartQO });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1'); c.set('userId', '1'); c.set('role', 'hospital_admin');
    c.env = {
      DB: mock.db,
    };
    await next();
  });
  app.route('/lb', lab);
  app.onError((e, c) => c.json({ error: e.message }, e.status ?? 500));
  
  const r = await app.request('/lb/items/1/sample-status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'collected', notes: 'Blood drawn' })
  });
  console.log('Status:', r.status);
  console.log('Body:', await r.text());
}

run();
