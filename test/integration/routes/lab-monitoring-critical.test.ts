import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app';
import labMonitoringRoutes from '../../../src/routes/tenant/labMonitoring';

describe('lab monitoring critical alerts', () => {
  it('soft-removes test reagent mappings instead of hard deleting audit history', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('update lab_test_consumable_map')) return { success: true, meta: { changes: 1 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/test-consumable-map/55', { method: 'DELETE' });

    expect(res.status).toBe(200);
    const mappingQuery = mockDB.queries.find((q) => q.sql.includes('lab_test_consumable_map'));
    expect(mappingQuery?.sql).toContain('UPDATE lab_test_consumable_map');
    expect(mappingQuery?.sql).toContain('is_active = 0');
    expect(mockDB.queries.some((q) => q.sql.includes('DELETE FROM lab_test_consumable_map'))).toBe(false);
  });

  it('reactivates a previously removed test reagent mapping instead of inserting a duplicate', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('select id, coalesce(is_active, 1) as is_active') && lower.includes('from lab_test_consumable_map')) {
          return { first: { id: 55, is_active: 0 } };
        }
        if (lower.includes('update lab_test_consumable_map')) return { success: true, meta: { changes: 1 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/test-consumable-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lab_test_id: 10, consumable_id: 20, qty_per_test: 1.5, is_mandatory: true }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; message: string };
    expect(body).toEqual({ id: 55, message: 'Mapping reactivated' });
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_test_consumable_map'))).toBe(false);
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_test_consumable_map') && q.sql.includes('is_active = 1'))).toBe(true);
  });

  it('reports strict-mode reagent readiness before enabling strict policy', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('sum(lot_count)')) return { first: { count: 6 } };
        if (lower.includes('join lab_test_consumable_map')) return { first: { count: 9 } };
        if (lower.includes('from lab_test_catalog')) return { first: { count: 9 } };
        if (lower.includes('from lab_consumables')) return { first: { count: 12 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('qc_status')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('onboard_expires_at')) return { first: { count: 1 } };
        if (lower.includes('from lab_consumable_stock')) return { first: { count: 6 } };
        if (lower.includes('from lab_test_consumable_map')) return { first: { count: 9 } };
        if (lower.includes('from lab_inventory_exceptions')) return { first: { count: 0 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/inventory-readiness');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.ready).toBe(true);
    expect(body.data.score).toBeGreaterThanOrEqual(80);
    expect(body.data.counts.activeConsumables).toBe(12);
    expect(body.data.warnings).toContain('Some opened/on-board reagent lots are near expiry');
  });

  it('reports LIS go-live readiness using existing analyzer, QC, mapping, and reagent signals', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_machines') && lower.includes('coalesce(is_active, 1) = 1') && !lower.includes('join lab_machine_test_map')) return { first: { count: 1 } };
        if (lower.includes('from lab_machine_test_map mtm')) return { first: { count: 8 } };
        if (lower.includes('from lis_bridge_agents')) return { first: { total: 1, healthy: 1 } };
        if (lower.includes('from lab_qc_controls') && lower.includes('from lab_qc_ranges')) return { first: { controls: 2, ranges: 3 } };
        if (lower.includes('from lab_validation_rules')) return { first: { count: 5 } };
        if (lower.includes('from lis_unmatched_results')) return { first: { count: 0 } };
        if (lower.includes('from lab_machine_result_log')) return { first: { total: 4, needs_review: 0 } };
        if (lower.includes('sum(lot_count)')) return { first: { count: 6 } };
        if (lower.includes('join lab_test_consumable_map')) return { first: { count: 9 } };
        if (lower.includes('from lab_test_catalog')) return { first: { count: 9 } };
        if (lower.includes('from lab_consumables')) return { first: { count: 12 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('qc_status')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('onboard_expires_at')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock')) return { first: { count: 6 } };
        if (lower.includes('from lab_test_consumable_map')) return { first: { count: 9 } };
        if (lower.includes('from lab_inventory_exceptions')) return { first: { count: 0 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/lis-go-live-readiness?machineId=7');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.machine_id).toBe(7);
    expect(body.data.overall_status).toBe('ready');
    expect(body.data.readiness_score).toBe(100);
    expect(body.data.summary).toMatchObject({ blockers: 0, warnings: 0, ready: 8 });
    expect(body.data.checks.map((check: any) => check.id)).toEqual([
      'machine-config',
      'test-mapping',
      'bridge-heartbeat',
      'qc-setup',
      'validation-rules',
      'unmatched-queue',
      'analyzer-run-smoke-test',
      'reagent-readiness',
    ]);
    expect(mockDB.queries.some((q) => q.sql.includes('lab_machine_result_log'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('lis_bridge_agents'))).toBe(true);
  });

  it('blocks LIS go-live readiness when the analyzer machine or mapping is missing', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_machines') && lower.includes('coalesce(is_active, 1) = 1') && !lower.includes('join lab_machine_test_map')) return { first: { count: 0 } };
        if (lower.includes('from lab_machine_test_map mtm')) return { first: { count: 0 } };
        if (lower.includes('from lis_bridge_agents')) return { first: { total: 0, healthy: 0 } };
        if (lower.includes('from lab_qc_controls') && lower.includes('from lab_qc_ranges')) return { first: { controls: 0, ranges: 0 } };
        if (lower.includes('from lab_validation_rules')) return { first: { count: 0 } };
        if (lower.includes('from lis_unmatched_results')) return { first: { count: 2 } };
        if (lower.includes('from lab_machine_result_log')) return { first: { total: 0, needs_review: 0 } };
        if (lower.includes('from lab_consumables')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock')) return { first: { count: 0 } };
        if (lower.includes('from lab_test_consumable_map')) return { first: { count: 0 } };
        if (lower.includes('from lab_inventory_exceptions')) return { first: { count: 1 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/lis-go-live-readiness');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.overall_status).toBe('blocked');
    expect(body.data.summary.blockers).toBeGreaterThanOrEqual(3);
    expect(body.data.checks.find((check: any) => check.id === 'machine-config')).toMatchObject({ status: 'blocked' });
    expect(body.data.checks.find((check: any) => check.id === 'test-mapping')).toMatchObject({ status: 'blocked' });
    expect(body.data.checks.find((check: any) => check.id === 'bridge-heartbeat')).toMatchObject({ status: 'blocked' });
  });

  it('blocks strict lab inventory mode when reagent readiness has blockers', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_consumables')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock')) return { first: { count: 0 } };
        if (lower.includes('from lab_test_consumable_map')) return { first: { count: 0 } };
        if (lower.includes('from lab_inventory_exceptions')) return { first: { count: 2 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lab_inventory_mode: 'strict', reagent_consumption_timing: 'result' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toContain('Strict lab reagent mode is not ready');
    expect(body.code).toBe('STRICT_LAB_INVENTORY_NOT_READY');
    expect(body.readiness.ready).toBe(false);
    expect(body.readiness.blockers).toContain('No active reagent/consumable catalog found');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO lab_inventory_policy'))).toBe(false);
  });

  it('blocks strict lab inventory mode when canonical inventory has QC-risk reagent stock', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('insert into lab_inventory_policy')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('from inventorystock')) return { first: { count: 1 } };
        if (lower.includes('join lab_test_consumable_map')) return { first: { count: 1 } };
        if (lower.includes('from lab_test_catalog')) return { first: { count: 1 } };
        if (lower.includes('from lab_consumables')) return { first: { count: 1 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('onboard_expires_at')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock')) return { first: { count: 1 } };
        if (lower.includes('from lab_test_consumable_map')) return { first: { count: 1 } };
        if (lower.includes('from lab_inventory_exceptions')) return { first: { count: 0 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lab_inventory_mode: 'strict',
        reagent_consumption_timing: 'billing',
        allow_result_without_stock: false,
        require_test_mapping_for_completion: true,
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.code).toBe('STRICT_LAB_INVENTORY_NOT_READY');
    expect(body.readiness.counts.qcRiskLots).toBe(1);
    expect(body.readiness.blockers).toContain('QC pending or failed reagent lots exist');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO lab_inventory_policy'))).toBe(false);
  });

  it('keeps strict production fail-closed even when catalog and stock readiness are clean', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('insert into lab_inventory_policy')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('sum(lot_count)')) return { first: { count: 1 } };
        if (lower.includes('join lab_test_consumable_map')) return { first: { count: 1 } };
        if (lower.includes('from lab_test_catalog')) return { first: { count: 1 } };
        if (lower.includes('from lab_consumables')) return { first: { count: 1 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('qc_status')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock') && lower.includes('onboard_expires_at')) return { first: { count: 0 } };
        if (lower.includes('from lab_consumable_stock')) return { first: { count: 1 } };
        if (lower.includes('from lab_test_consumable_map')) return { first: { count: 1 } };
        if (lower.includes('from lab_inventory_exceptions')) return { first: { count: 0 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lab_inventory_mode: 'strict',
        reagent_consumption_timing: 'result',
        allow_result_without_stock: true,
        require_test_mapping_for_completion: false,
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.code).toBe('STRICT_LAB_INVENTORY_ATOMICITY_REQUIRED');
    expect(body.readiness.ready).toBe(true);
    expect(body.capabilities).toMatchObject({
      strict_mode_available: false,
      strict_billing_atomicity_ready: false,
    });
    expect(body.message).toContain('transactional reservation/commit workflow');
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO lab_inventory_policy'))).toBe(false);
  });

  it('blocks receptionist from changing lab inventory policy', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'receptionist',
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/inventory-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reagent_consumption_timing: 'result' }),
    });

    expect(res.status).toBe(403);
  });

  it('uses the current lab_order_items result column for production schema compatibility', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      tables: {
        lab_order_items: [],
        lab_orders: [],
        patients: [],
        lab_test_catalog: [],
      },
    });

    const res = await app.request('/lab-monitoring/critical');

    expect(res.status).toBe(200);
    const criticalQuery = mockDB.queries.find((q) => q.sql.includes('FROM lab_order_items loi'));
    expect(criticalQuery?.sql).toContain('loi.result AS result_value');
    expect(criticalQuery?.sql).not.toContain('loi.result_value');
  });

  it('computes daily reagent usage from canonical inventory consumption before legacy operation logs', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_daily_summaries')) return { first: null };
        if (lower.includes('from lab_orders where')) return { first: { total: 2, done: 1, pending: 1 } };
        if (lower.includes('from lab_order_items loi')) return { first: { total: 3 } };
        if (lower.includes('sum(print_count)')) return { first: { total: 1 } };
        if (lower.includes('from bills')) return { first: { total: 500 } };
        if (lower.includes('from lab_results')) return { first: { total: 0 } };
        if (lower.includes('from inventoryconsumption')) return { first: { total: 7 } };
        if (lower.includes("log_type = 'film_used'")) return { first: { total: 0 } };
        if (lower.includes("log_type = 'reagent_used'")) return { first: { total: 99 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/daily-summary?date=2026-06-28');

    expect(res.status).toBe(200);
    const body = await res.json() as { summary: { total_reagents_used: number } };
    expect(body.summary.total_reagents_used).toBe(7);
    expect(mockDB.queries.some((q) => q.sql.includes('InventoryConsumption'))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes("log_type = 'reagent_used'"))).toBe(false);
  });

  it('retries an open lab reagent inventory exception and resolves it after consumption succeeds', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_inventory_exceptions') && lower.includes("status = 'open'")) {
          return { first: { id: 99, lab_order_id: 10, lab_order_item_id: 20, lab_test_id: 30, reason: 'insufficient_stock' } };
        }
        if (lower.includes('from lab_consumable_movements') && lower.includes('reference_type')) return { first: null };
        if (lower.includes('from lab_test_consumable_map')) {
          return { results: [{ id: 1, consumable_id: 40, qty_per_test: 2, is_mandatory: 1, consumable_name: 'CBC reagent' }] };
        }
        if (lower.includes('select inventory_item_id') && lower.includes('from lab_consumables')) return { first: { inventory_item_id: null } };
        if (lower.includes('from lab_consumable_stock')) {
          return { results: [{ id: 50, quantity_available: 5, purchase_price: 100, unit_price: 100, ledger_type: 'lab' }] };
        }
        if (lower.includes('update lab_consumable_stock')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('insert or ignore into lab_consumable_consumption_claims')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('update lab_consumable_consumption_claims')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('insert into lab_consumable_movements')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('insert into lab_operation_logs')) return { success: true, meta: { changes: 1 } };
        if (lower.includes('update lab_inventory_exceptions')) return { success: true, meta: { changes: 1 } };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/inventory-exceptions/99/retry-consumption', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { message: string; data: { mappings: number; quantity: number; cost: number } };
    expect(body.message).toBe('Lab reagent consumption retry succeeded');
    expect(body.data).toEqual({ mappings: 1, quantity: 2, cost: 200 });
    expect(mockDB.queries.some((q) => q.sql.includes('UPDATE lab_inventory_exceptions') && q.sql.includes("status = 'resolved'"))).toBe(true);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_consumable_movements') && q.params.includes('lab_order_item'))).toBe(true);
  });

  it('does not retry lab inventory exceptions that have no lab order item context', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'laboratory',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_inventory_exceptions') && lower.includes("status = 'open'")) {
          return { first: { id: 100, lab_order_id: null, lab_order_item_id: null, lab_test_id: null, reason: 'manual_exception' } };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/inventory-exceptions/100/retry-consumption', { method: 'POST' });

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((q) => q.sql.includes('INSERT INTO lab_consumable_movements'))).toBe(false);
  });


  it('summarizes reagent reconciliation rows for billed tests', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from invoice_items') && lower.includes('lab_consumable_movements')) {
          return { results: [
            {
              lab_order_item_id: 10,
              lab_order_id: 5,
              lab_test_id: 100,
              test_name: 'CBC',
              order_no: 'LO-1',
              patient_name: 'Rahim',
              bill_id: 77,
              invoice_no: 'INV-1',
              bill_date: '2026-07-01',
              ordered_at: '2026-07-01 09:00:00',
              collected_at: '2026-07-01 09:10:00',
              received_at: '2026-07-01 09:20:00',
              completed_at: '2026-07-01 10:00:00',
              test_status: 'completed',
              sample_status: 'received_in_lab',
              result_status: 'final',
              tat_target_minutes: 90,
              performed_flag: 1,
              resulted_flag: 1,
              tat_minutes_actual: 60,
              expected_quantity: 2,
              consumed_quantity: 2,
              consumed_cost: 120,
              exception_count: 0,
            },
            {
              lab_order_item_id: 11,
              lab_order_id: 5,
              lab_test_id: 101,
              test_name: 'RBS',
              order_no: 'LO-1',
              patient_name: 'Rahim',
              bill_id: 77,
              invoice_no: 'INV-1',
              bill_date: '2026-07-01',
              ordered_at: '2026-07-01 09:00:00',
              received_at: '2026-07-01 09:30:00',
              completed_at: '2026-07-01 11:30:00',
              test_status: 'completed',
              tat_target_minutes: 90,
              performed_flag: 1,
              resulted_flag: 1,
              tat_minutes_actual: 150,
              expected_quantity: 1,
              consumed_quantity: 0,
              consumed_cost: 0,
              exception_count: 0,
            },
            {
              lab_order_item_id: 12,
              lab_order_id: 6,
              lab_test_id: 102,
              test_name: 'Unmapped Ferritin',
              order_no: 'LO-2',
              patient_name: 'Karim',
              bill_id: 78,
              invoice_no: 'INV-2',
              bill_date: '2026-07-01',
              expected_quantity: 0,
              consumed_quantity: 0,
              consumed_cost: 0,
              exception_count: 0,
            },
            {
              lab_order_item_id: 13,
              lab_order_id: 6,
              lab_test_id: 103,
              test_name: 'Lipid',
              order_no: 'LO-2',
              patient_name: 'Karim',
              bill_id: 78,
              invoice_no: 'INV-2',
              bill_date: '2026-07-01',
              expected_quantity: 3,
              consumed_quantity: 0,
              consumed_cost: 0,
              exception_count: 1,
            },
          ] };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/reagent-reconciliation?from=2026-07-01&to=2026-07-01');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ status: string; status_meaning: string; test_name: string; performed: boolean; resulted: boolean; tat_status: string; tat_minutes: number | null }>; summary: Record<string, number | null> };
    expect(body.data.map((row) => row.status)).toEqual(['ok', 'missing', 'missing', 'exception']);
    expect(body.data.find((row) => row.test_name === 'CBC')).toMatchObject({
      performed: true,
      resulted: true,
      tat_minutes: 60,
      tat_status: 'on_time',
    });
    expect(body.data.find((row) => row.test_name === 'RBS')).toMatchObject({
      performed: true,
      resulted: true,
      tat_minutes: 150,
      tat_status: 'delayed',
    });
    expect(body.data.find((row) => row.test_name === 'Unmapped Ferritin')).toMatchObject({
      status: 'missing',
      status_meaning: 'Mapping/stock missing',
      performed: false,
      resulted: false,
      tat_status: 'pending',
    });
    expect(body.summary).toMatchObject({
      tests: 4,
      billed: 4,
      performed: 2,
      resulted: 2,
      ok: 1,
      missing: 2,
      exception: 1,
      expected_quantity: 6,
      consumed_quantity: 2,
      consumed_cost: 120,
      exceptions: 1,
      delayed: 1,
      on_time: 1,
      tat_observed: 2,
      average_tat_minutes: 105,
    });
    const reconciliationQuery = mockDB.queries.find((q) => q.sql.includes('FROM invoice_items ii'));
    expect(reconciliationQuery?.sql).toContain('lab_test_consumable_map');
    expect(reconciliationQuery?.sql).toContain('lab_consumable_movements');
    expect(reconciliationQuery?.sql).toContain('loi.completed_at');
    expect(reconciliationQuery?.sql).toContain('tat_minutes_actual');
    expect(reconciliationQuery?.params).toEqual(['tenant-1', '2026-07-01', '2026-07-01', 200]);
  });

  it('filters reagent reconciliation to only missing deductions', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from invoice_items') && lower.includes('lab_consumable_movements')) {
          return { results: [
            { lab_order_item_id: 10, lab_order_id: 5, lab_test_id: 100, test_name: 'CBC', bill_id: 77, expected_quantity: 2, consumed_quantity: 2, consumed_cost: 120, exception_count: 0 },
            { lab_order_item_id: 11, lab_order_id: 5, lab_test_id: 101, test_name: 'RBS', bill_id: 77, expected_quantity: 1, consumed_quantity: 0, consumed_cost: 0, exception_count: 0 },
            { lab_order_item_id: 12, lab_order_id: 6, lab_test_id: 102, test_name: 'Lipid', bill_id: 78, expected_quantity: 3, consumed_quantity: 0, consumed_cost: 0, exception_count: 1 },
          ] };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/reagent-reconciliation?from=2026-07-01&status=missing');

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; data: Array<{ status: string; test_name: string }>; summary: Record<string, number> };
    expect(body.status).toBe('missing');
    expect(body.data).toEqual([expect.objectContaining({ status: 'missing', test_name: 'RBS' })]);
    expect(body.summary).toMatchObject({ tests: 1, missing: 1, expected_quantity: 1, consumed_quantity: 0 });
  });


  it('summarizes lab reagent mapping coverage for strict-mode readiness', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_test_catalog') && lower.includes('lab_test_consumable_map')) {
          return { results: [
            { id: 1, code: 'CBC', name: 'CBC', category: 'Haematology', department: 'Lab', test_type: 'single', mapping_count: 2, mandatory_count: 2, expected_quantity: 3 },
            { id: 2, code: 'RBS', name: 'RBS', category: 'Biochemistry', department: 'Lab', test_type: 'single', mapping_count: 0, mandatory_count: 0, expected_quantity: 0 },
            { id: 3, code: 'LFT', name: 'LFT', category: 'Biochemistry', department: 'Lab', test_type: 'panel', mapping_count: 1, mandatory_count: 1, expected_quantity: 5 },
          ] };
        }
        if (lower.includes('qc_failed_usable_lot_count')) {
          return { first: { qc_failed_usable_lot_count: 1 } };
        }
        if (lower.includes('open_stock_shortage_exceptions')) {
          return { first: { open_stock_shortage_exceptions: 2 } };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/mapping-coverage');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ status: string }>; summary: Record<string, number | boolean> };
    expect(body.data.map((row) => row.status)).toEqual(['mapped', 'missing', 'mapped']);
    expect(body.summary).toMatchObject({
      total_tests: 3,
      mapped_tests: 2,
      missing_tests: 1,
      expected_quantity: 8,
      coverage_percent: 66.67,
      coverage_target_min: 95,
      qc_failed_usable_lots: 1,
      open_stock_shortage_exceptions: 2,
      strict_mode_ready: false,
    });
    const coverageQuery = mockDB.queries.find((q) => q.sql.includes('FROM lab_test_catalog t'));
    expect(coverageQuery?.sql).toContain('lab_test_consumable_map');
    expect(coverageQuery?.sql).toContain('billing_service_items');
    expect(coverageQuery?.sql).toContain('t.billing_service_item_id IS NOT NULL');
    expect(coverageQuery?.sql).toContain('COALESCE(si.is_active, 1) = 1');
    expect(coverageQuery?.params).toEqual(['tenant-1', 0, 500]);
    const qcQuery = mockDB.queries.find((q) => q.sql.includes('qc_failed_usable_lot_count'));
    expect(qcQuery?.sql).toContain('FROM InventoryStock inv');
    expect(qcQuery?.sql).toContain("LOWER(COALESCE(inv.QCStatus, 'accepted')) IN ('failed', 'rejected')");
    const shortageQuery = mockDB.queries.find((q) => q.sql.includes('open_stock_shortage_exceptions'));
    expect(shortageQuery?.sql).toContain("status = 'open'");
    expect(shortageQuery?.sql).toContain("reason = 'insufficient_stock'");
  });

  it('keeps mapping coverage available when newer inventory metadata columns are unavailable', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_test_catalog') && lower.includes('lab_test_consumable_map')) {
          return { results: [
            { id: 1, code: 'CBC', name: 'CBC', category: 'Haematology', department: 'Lab', test_type: 'single', mapping_count: 1, mandatory_count: 1, expected_quantity: 2 },
          ] };
        }
        if (lower.includes('qc_failed_usable_lot_count') && lower.includes('inventorystock')) {
          throw new Error('no such column: inv.QCStatus');
        }
        if (lower.includes('qc_failed_usable_lot_count') && lower.includes('lab_consumable_stock')) {
          return { first: { qc_failed_usable_lot_count: 0 } };
        }
        if (lower.includes('open_stock_shortage_exceptions')) {
          return { first: { open_stock_shortage_exceptions: 0 } };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/mapping-coverage');

    expect(res.status).toBe(200);
    const body = await res.json() as { summary: Record<string, number | boolean> };
    expect(body.summary).toMatchObject({
      total_tests: 1,
      mapped_tests: 1,
      missing_tests: 0,
      coverage_percent: 100,
      qc_failed_usable_lots: 0,
      open_stock_shortage_exceptions: 0,
      strict_mode_ready: true,
    });
  });

  it('marks lab reagent mapping coverage strict-mode ready when all production targets are clean', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_test_catalog') && lower.includes('lab_test_consumable_map')) {
          return { results: [
            { id: 1, code: 'CBC', name: 'CBC', category: 'Haematology', department: 'Lab', test_type: 'single', mapping_count: 2, mandatory_count: 2, expected_quantity: 3 },
            { id: 2, code: 'RBS', name: 'RBS', category: 'Biochemistry', department: 'Lab', test_type: 'single', mapping_count: 1, mandatory_count: 1, expected_quantity: 1 },
          ] };
        }
        if (lower.includes('qc_failed_usable_lot_count')) {
          return { first: { qc_failed_usable_lot_count: 0 } };
        }
        if (lower.includes('open_stock_shortage_exceptions')) {
          return { first: { open_stock_shortage_exceptions: 0 } };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/mapping-coverage');

    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ status: string }>; summary: Record<string, number | boolean> };
    expect(body.data.map((row) => row.status)).toEqual(['mapped', 'mapped']);
    expect(body.summary).toMatchObject({
      total_tests: 2,
      mapped_tests: 2,
      missing_tests: 0,
      expected_quantity: 4,
      coverage_percent: 100,
      coverage_target_min: 95,
      qc_failed_usable_lots: 0,
      open_stock_shortage_exceptions: 0,
      strict_mode_ready: true,
    });
  });

  it('filters lab reagent mapping coverage to missing test mappings', async () => {
    const { app } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from lab_test_catalog') && lower.includes('lab_test_consumable_map')) {
          return { results: [
            { id: 1, code: 'CBC', name: 'CBC', mapping_count: 1, mandatory_count: 1, expected_quantity: 2 },
            { id: 2, code: 'RBS', name: 'RBS', mapping_count: 0, mandatory_count: 0, expected_quantity: 0 },
          ] };
        }
        return null;
      },
    });

    const res = await app.request('/lab-monitoring/mapping-coverage?status=missing&include_outsourced=true&limit=25');

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; include_outsourced: boolean; data: Array<{ status: string; name: string }>; summary: Record<string, number | boolean> };
    expect(body.status).toBe('missing');
    expect(body.include_outsourced).toBe(true);
    expect(body.data).toEqual([expect.objectContaining({ status: 'missing', name: 'RBS' })]);
    expect(body.summary).toMatchObject({ total_tests: 2, mapped_tests: 1, missing_tests: 1, coverage_percent: 50, strict_mode_ready: false });
  });

  it('qualifies tenant and date filters for operation log lookups with joins', async () => {
    const { app, mockDB } = createTestApp({
      route: labMonitoringRoutes,
      routePath: '/lab-monitoring',
      role: 'hospital_admin',
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from lab_operation_logs l')) return { results: [] };
        return null;
      },
      universalFallback: true,
    });

    const res = await app.request('/lab-monitoring/operation-logs?date=2026-07-09');

    expect(res.status).toBe(200);
    const operationLogQuery = mockDB.queries.find((q) => q.sql.includes('FROM lab_operation_logs l'));
    expect(operationLogQuery?.sql).toContain('WHERE l.tenant_id = ? AND l.log_date = ?');
    expect(operationLogQuery?.sql).not.toContain('WHERE tenant_id = ? AND log_date = ?');
  });

});
