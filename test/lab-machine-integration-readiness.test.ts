import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import { parseHL7Message } from '../src/lib/hl7-parser';
import { parseASTMMessage } from '../src/lib/astm-parser';
import {
  deriveMachineResultWorkflowState,
  getLabMachineCapabilities,
} from '../src/lib/lab-machine-capabilities';
import labMachines from '../src/routes/tenant/labMachines';
import { createMockDB } from './integration/helpers/mock-db';

describe('lab machine integration readiness', () => {
  it('advertises common analyzer classes and protocol families', () => {
    const caps = getLabMachineCapabilities();
    expect(caps.protocols).toEqual(expect.arrayContaining(['astm', 'hl7', 'hl7_mllp', 'json', 'csv', 'file_drop']));
    expect(caps.connectionTypes).toEqual(expect.arrayContaining(['tcp', 'serial', 'http', 'mllp', 'sftp']));
    expect(caps.machineTypes).toEqual(expect.arrayContaining([
      'hematology',
      'biochemistry',
      'immunoassay',
      'coagulation',
      'urinalysis',
      'microbiology',
      'blood_gas',
      'electrolyte',
      'molecular',
      'poct',
    ]));
  });

  it('keeps preliminary machine results in processing and only final-like results completed', () => {
    expect(deriveMachineResultWorkflowState('P')).toMatchObject({ resultStatus: 'preliminary', itemStatus: 'processing', isFinalLike: false });
    expect(deriveMachineResultWorkflowState('F')).toMatchObject({ resultStatus: 'final', itemStatus: 'completed', isFinalLike: true });
    expect(deriveMachineResultWorkflowState('C')).toMatchObject({ resultStatus: 'corrected', itemStatus: 'completed', isFinalLike: true });
    expect(deriveMachineResultWorkflowState('X')).toMatchObject({ resultStatus: 'cancelled', itemStatus: 'cancelled', isFinalLike: false });
  });

  it('parses HL7 SPM specimen id for barcode-based analyzer matching', () => {
    const msg = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260420120000||ORU^R01|MSG1|P|2.3',
      'PID|||P001||TEST^PATIENT',
      'ORC|RE|LO-1',
      'OBR|1|LO-1|FILLER-1|CBC^Complete Blood Count',
      'SPM|1|BC-20260430-0001||BLD^Blood',
      'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
    ].join('\r');

    const parsed = parseHL7Message(msg);
    expect(parsed.orders[0].order.specimenId).toBe('BC-20260430-0001');
    expect(parsed.orders[0].order.specimenType).toBe('BLD');
  });

  it('parses ASTM Q records for host-query worklist mode', () => {
    const msg = [
      'H|\\^&|||Analyzer',
      'Q|1|BC-20260430-0001^BC-20260430-0001|^^^CBC|||O',
      'L|1|N',
    ].join('\r');

    const parsed = parseASTMMessage(msg);
    expect(parsed.queries).toHaveLength(1);
    expect(parsed.queries[0]).toMatchObject({ startId: 'BC-20260430-0001', endId: 'BC-20260430-0001' });
  });




  it('filters unmatched LIS results by machine id', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('count(*) as total from lis_unmatched_results')) {
          return { first: { total: 1 } };
        }
        if (lower.includes('from lis_unmatched_results ur')) {
          return { results: [{ id: 77, machine_id: 501, status: 'open', identifier_type: 'barcode', identifier_value: 'BC-1', machine_test_code: 'HGB', machine_name: 'Analyzer 501', machine_code: 'A-501' }] };
        }
        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1');
      c.set('userId', '9');
      c.set('role', 'lab_tech' as any);
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-' + 'secret',
        ENVIRONMENT: 'development',
        UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      } as any;
      await next();
    });
    app.route('/lab-machines', labMachines);
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/lab-machines/unmatched-results?status=open&machineId=501');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: 77, machine_id: 501, machine_name: 'Analyzer 501' }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
    expect(mock.queries.some((q) => q.sql.includes('machine_id = ?') && q.params.filter((param) => param === 501).length >= 2)).toBe(true);
  });

  it('consumes mapped reagents when an unmatched LIS result is manually resolved', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();

        if (lower.includes('from lis_unmatched_results') && lower.includes('select id, status, machine_id')) {
          return { first: { id: 77, status: 'open', machine_id: 501 } };
        }

        if (lower.includes('from lab_order_items loi') && lower.includes('where loi.id = ?')) {
          return { first: { id: 11, lab_order_id: 22, lab_test_id: 33, status: 'collected' } };
        }

        if (lower.includes('from lab_consumable_movements') && lower.includes("reference_type = 'lab_order_item'")) {
          return { first: null, results: [] };
        }

        if (lower.includes('from lab_test_consumable_map')) {
          return { results: [{ consumable_id: 5, qty_per_test: 2, is_mandatory: 1, consumable_name: 'CBC Reagent', category: 'reagent' }] };
        }

        if (lower.includes('from lab_' + 'inventory_' + 'policy')) {
          return { first: { reagent_consumption_timing: 'result' } };
        }

        if (lower.includes('select inventory_item_id') && lower.includes('from lab_consumables')) {
          return { first: null };
        }

        if (lower.includes('from lab_consumable_stock')) {
          return { results: [{ id: 99, quantity_available: 5, purchase_price: 120, unit_price: 100, ledger_type: 'lab' }] };
        }

        if (lower.includes('update lab_consumable_stock')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('update lis_unmatched_results')) return { success: true, meta: { changes: 1 } };

        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1');
      c.set('userId', '9');
      c.set('role', 'lab_tech' as any);
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-' + 'secret',
        ENVIRONMENT: 'development',
        UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      } as any;
      await next();
    });
    app.route('/lab-machines', labMachines);
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/lab-machines/unmatched-results/77/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', labOrderItemId: 11, notes: 'matched barcode manually' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: 'resolved',
      reagentUsage: { mappings: 1, quantity: 2, cost: 240 },
    });
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_consumable_stock') && q.params.includes(2) && q.params.includes(99))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_consumable_movements') && q.params.includes('lab_order_item') && q.params.includes(11))).toBe(true);
  });

  it('does not consume reagents when an unmatched LIS result is ignored', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lis_unmatched_results') && lower.includes('select id, status, machine_id')) {
          return { first: { id: 78, status: 'open', machine_id: 501 } };
        }
        if (lower.includes('update lis_unmatched_results')) return { success: true, meta: { changes: 1 } };
        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1');
      c.set('userId', '9');
      c.set('role', 'lab_tech' as any);
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-' + 'secret',
        ENVIRONMENT: 'development',
        UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      } as any;
      await next();
    });
    app.route('/lab-machines', labMachines);
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/lab-machines/unmatched-results/78/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ignored', notes: 'control sample' }),
    });

    expect(res.status).toBe(200);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_consumable_stock'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_consumable_movements'))).toBe(false);
  });

  it('rejects resolving an unmatched LIS result without a lab order item', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lis_unmatched_results') && lower.includes('select id, status, machine_id')) {
          return { first: { id: 79, status: 'open', machine_id: 501 } };
        }
        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1');
      c.set('userId', '9');
      c.set('role', 'lab_tech' as any);
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-' + 'secret',
        ENVIRONMENT: 'development',
        UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      } as any;
      await next();
    });
    app.route('/lab-machines', labMachines);
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/lab-machines/unmatched-results/79/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'labOrderItemId is required when resolving an unmatched result' });
  });

  it('defers mapped consumable deduction until a staged JSON analyzer result is accepted', async () => {
    const mock = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();

        if (lower.includes('from lab_machines')) {
          return { first: { id: 1, machine_code: 'M1', protocol: 'json', is_active: 1 }, results: [], success: true, meta: {} };
        }

        if (sql.includes('INSERT INTO lab_machine_result_log')) {
          return { success: true, meta: { last_row_id: 1001, changes: 1 } };
        }

        if (lower.includes('from lab_machine_test_map')) {
          return {
            first: {
              lab_test_id: 33,
              component_id: null,
              machine_unit: 'g/dL',
              conversion_factor: 1,
              normal_range: '10-20',
              critical_low: 5,
              critical_high: 30,
              unit: 'g/dL',
              code: 'HGB',
            },
            results: [],
          };
        }
        if (lower.includes('from lab_qc_ranges') && lower.includes('count(*)')) {
          return { first: { total: 1 } };
        }
        if (lower.includes('from lab_calibrations')) {
          return { first: { total: 0 } };
        }
        if (lower.includes('from lab_qc_results')) {
          return { first: { is_out_of_range: 0, westgard_violations: '[]', created_at: new Date().toISOString() } };
        }

        if (lower.includes('from lab_order_items loi') && lower.includes('join lab_orders lo')) {
          const candidate = {
            id: 11,
            lab_order_id: 22,
            specimen_id: 'BC-1',
            patient_id: 44,
            bill_id: null,
            bill_status: null,
            bill_total: 0,
            bill_paid: 0,
            diagnostic_billing_status: null,
          };
          return { first: candidate, results: [candidate] };
        }

        if (lower.includes('select id, result') && lower.includes('from lab_order_items')) {
          return { first: { id: 11, result: null, result_numeric: null, machine_result_log_id: null, status: 'collected' } };
        }

        if (lower.includes('from lab_consumable_movements') && lower.includes("reference_type = 'lab_order_item'")) {
          return { first: null, results: [] };
        }

        if (lower.includes('from lab_test_consumable_map')) {
          return { results: [{ consumable_id: 5, qty_per_test: 2, is_mandatory: 1, consumable_name: 'CBC Reagent', category: 'reagent' }] };
        }
        if (lower.includes('from lab_' + 'inventory_' + 'policy')) {
          return { first: { reagent_consumption_timing: 'result' } };
        }


        if (lower.includes('select inventory_item_id') && lower.includes('from lab_consumables')) {
          return { first: null };
        }

        if (lower.includes('from lab_consumable_stock')) {
          return { results: [{ id: 99, quantity_available: 5, purchase_price: 120, unit_price: 100, ledger_type: 'lab' }] };
        }

        if (lower.includes('update lab_consumable_stock')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('select id from lab_reports')) return { first: { id: 555 } };
        if (lower.includes('count(*) as cnt')) return { results: [{ cnt: 0 }] };

        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1');
      c.set('userId', '9');
      c.set('role', 'lab_tech' as any);
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-' + 'secret',
        ENVIRONMENT: 'development',
        UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      } as any;
      await next();
    });
    app.route('/lab-machines', labMachines);
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'BC-1',
        results: [{ testCode: 'HGB', value: '15', units: 'g/dL', resultStatus: 'F' }],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Results staged',
      outcomes: [{ staged: true, matched: true, disposition: 'review_required', orderItemId: 11 }],
    });
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(true);
    expect(mock.queries.some((q) => q.sql.includes('UPDATE lab_consumable_stock'))).toBe(false);
    expect(mock.queries.some((q) => q.sql.includes('INSERT INTO lab_consumable_movements'))).toBe(false);
  });

});

describe('lab machine route readiness', () => {
  it('routes /hl7/receive to the HL7 receiver instead of the numeric JSON receiver', async () => {
    const mock = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from lab_machines')) {
          return { first: { id: 1, machine_code: 'M1', protocol: 'hl7', is_active: 1 }, results: [], success: true, meta: {} };
        }
        if (s.includes('from lab_machine_test_map')) {
          return { first: null, results: [], success: true, meta: {} };
        }
        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', 'tenant-1');
      c.set('userId', '1');
      c.set('role', 'lab_tech' as any);
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-' + 'secret',
        ENVIRONMENT: 'development',
        UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      } as any;
      await next();
    });
    app.route('/lab-machines', labMachines);
    app.onError((err, c) => c.json({ error: err.message }, (err as any).status ?? 500));

    const res = await app.request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        machineCode: 'M1',
        message: [
          'MSH|^~\\&|APP|FAC|HMS|LAB|20260430||ORU^R01|1|P|2.3',
          'OBR|1|ORDER-1||HGB^Hemoglobin',
          'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
        ].join('\r'),
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ message: 'HL7 message staged', disposition: 'staged' });
  });
});
