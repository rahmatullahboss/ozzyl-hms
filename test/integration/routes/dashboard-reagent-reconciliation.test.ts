import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type ReconciliationResponse = {
  rows: Array<{
    consumableId: number;
    reagentCode: string | null;
    reagentName: string;
    unit: string;
    completedTests: number;
    expectedUsage: number;
    actualUsage: number;
    returnedQuantity: number;
    variance: number;
    currentStock: number;
    reorderLevel: number;
    status: string;
  }>;
  exceptions: {
    unmappedCompletedTests: number;
    consumptionExceptions: number;
    unmappedTests: Array<{ testId: number; testName: string; completedTests: number }>;
  };
  quantityTotals: Array<{ unit: string; quantity: number }>;
  availability: { mapping: boolean; movements: boolean; stock: boolean };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
};

describe('executive reagent expected-vs-actual reconciliation', () => {
  it('reconciles mapped CBC usage, returns, stock, units, and unmapped RBS tests', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_reagent:expected')) {
          expect(lower).toContain('lab_test_consumable_map');
          expect(lower).toContain('qty_per_test');
          expect(lower).toContain("in ('completed', 'resulted', 'verified', 'final')");
          expect(lower).toContain('coalesce(m.is_active, 1) = 1');
          return { results: [
            { consumable_id: 10, reagent_code: 'CBC-R', reagent_name: 'CBC Reagent', unit: 'test', completed_tests: 2, expected_usage: 2, reorder_level: 5 },
            { consumable_id: 11, reagent_code: 'DIL', reagent_name: 'Diluent', unit: 'ml', completed_tests: 2, expected_usage: 4, reorder_level: 10 },
          ] };
        }
        if (lower.includes('executive_reagent:movements')) {
          expect(lower).toContain("movement_type = 'usage_out'");
          expect(lower).toContain("movement_type = 'return'");
          expect(lower).toContain('abs(quantity)');
          return { results: [
            { consumable_id: 10, usage_out: 3, returned_quantity: 1 },
            { consumable_id: 11, usage_out: 5, returned_quantity: 1 },
          ] };
        }
        if (lower.includes('executive_reagent:stock')) {
          expect(lower).toContain("in ('failed', 'quarantined', 'rejected')");
          return { results: [
            { consumable_id: 10, current_stock: 8, qc_blocked_lots: 0 },
            { consumable_id: 11, current_stock: 0, qc_blocked_lots: 1 },
          ] };
        }
        if (lower.includes('executive_reagent:unmapped')) {
          return { results: [{ test_id: 2, test_name: 'RBS', completed_tests: 1 }] };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/reagent-reconciliation?date=2026-07-10');
    expect(response.status).toBe(200);
    const body = await response.json() as ReconciliationResponse;
    const cbc = body.rows.find((row) => row.consumableId === 10)!;
    expect(cbc.expectedUsage).toBe(2);
    expect(cbc.actualUsage).toBe(2);
    expect(cbc.returnedQuantity).toBe(1);
    expect(cbc.variance).toBe(0);
    expect(cbc.status).toBe('ok');
    const diluent = body.rows.find((row) => row.consumableId === 11)!;
    expect(diluent.status).toBe('qc_blocked');
    expect(body.exceptions.unmappedCompletedTests).toBe(1);
    expect(body.exceptions.unmappedTests).toEqual([{ testId: 2, testName: 'RBS', completedTests: 1 }]);
    expect(body.quantityTotals).toEqual([
      { unit: 'test', quantity: 2 },
      { unit: 'ml', quantity: 4 },
    ]);
    expect(body.availability).toEqual({ mapping: true, movements: true, stock: true });
  });

  it('classifies missing, excess, low, and out-of-stock conditions deterministically', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('executive_reagent:expected')) return { results: [
          { consumable_id: 1, reagent_code: 'A', reagent_name: 'A', unit: 'test', completed_tests: 2, expected_usage: 2, reorder_level: 5 },
          { consumable_id: 2, reagent_code: 'B', reagent_name: 'B', unit: 'test', completed_tests: 2, expected_usage: 2, reorder_level: 5 },
          { consumable_id: 3, reagent_code: 'C', reagent_name: 'C', unit: 'test', completed_tests: 2, expected_usage: 2, reorder_level: 5 },
          { consumable_id: 4, reagent_code: 'D', reagent_name: 'D', unit: 'test', completed_tests: 2, expected_usage: 2, reorder_level: 5 },
        ] };
        if (sql.includes('executive_reagent:movements')) return { results: [
          { consumable_id: 1, usage_out: 0, returned_quantity: 0 },
          { consumable_id: 2, usage_out: 4, returned_quantity: 0 },
          { consumable_id: 3, usage_out: 2, returned_quantity: 0 },
          { consumable_id: 4, usage_out: 1, returned_quantity: 3 },
        ] };
        if (sql.includes('executive_reagent:stock')) return { results: [
          { consumable_id: 1, current_stock: 6, qc_blocked_lots: 0 },
          { consumable_id: 2, current_stock: 3, qc_blocked_lots: 0 },
          { consumable_id: 3, current_stock: 0, qc_blocked_lots: 0 },
          { consumable_id: 4, current_stock: 6, qc_blocked_lots: 0 },
        ] };
        if (sql.includes('executive_reagent:unmapped')) return { results: [] };
        return null;
      },
    });

    const response = await app.request('/dashboard/reagent-reconciliation?date=2026-07-10');
    const body = await response.json() as ReconciliationResponse;
    expect(body.rows.find((row) => row.consumableId === 1)?.status).toBe('missing_consumption');
    expect(body.rows.find((row) => row.consumableId === 2)?.status).toBe('over_consumption');
    expect(body.rows.find((row) => row.consumableId === 3)?.status).toBe('out_of_stock');
    expect(body.rows.find((row) => row.consumableId === 4)).toMatchObject({
      actualUsage: 0,
      returnedQuantity: 3,
      variance: -2,
      status: 'missing_consumption',
    });
    expect(body.exceptions.consumptionExceptions).toBe(4);
  });

  it('paginates deterministically across the 100-row boundary', async () => {
    const expectedRows = Array.from({ length: 101 }, (_, index) => ({
      consumable_id: index + 1,
      reagent_code: `R-${String(index + 1).padStart(3, '0')}`,
      reagent_name: `Reagent ${String(index + 1).padStart(3, '0')}`,
      unit: 'ml',
      completed_tests: 1,
      expected_usage: 1,
      reorder_level: 0,
    }));
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('executive_reagent:expected')) return { results: expectedRows };
        if (sql.includes('executive_reagent:movements')) return { results: expectedRows.map((row) => ({ consumable_id: row.consumable_id, usage_out: 1, returned_quantity: 0 })) };
        if (sql.includes('executive_reagent:stock')) return { results: expectedRows.map((row) => ({ consumable_id: row.consumable_id, current_stock: 10, qc_blocked_lots: 0 })) };
        if (sql.includes('executive_reagent:unmapped')) return { results: [] };
        return null;
      },
    });

    const response = await app.request('/dashboard/reagent-reconciliation?date=2026-07-10&page=2&pageSize=50');
    expect(response.status).toBe(200);
    const body = await response.json() as ReconciliationResponse;
    expect(body).toMatchObject({ page: 2, pageSize: 50, totalRows: 101, hasNextPage: true });
    expect(body.rows).toHaveLength(50);
    expect(body.rows[0]?.consumableId).toBe(51);
    expect(body.rows[49]?.consumableId).toBe(100);
  });

  it('isolates an unavailable optional movement table without hiding mapping and stock data', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        if (sql.includes('executive_reagent:expected')) return { results: [{ consumable_id: 10, reagent_code: 'CBC-R', reagent_name: 'CBC Reagent', unit: 'test', completed_tests: 2, expected_usage: 2, reorder_level: 5 }] };
        if (sql.includes('executive_reagent:movements')) throw new Error('no such table: lab_consumable_movements');
        if (sql.includes('executive_reagent:stock')) return { results: [{ consumable_id: 10, current_stock: 8, qc_blocked_lots: 0 }] };
        if (sql.includes('executive_reagent:unmapped')) return { results: [] };
        return null;
      },
    });

    const response = await app.request('/dashboard/reagent-reconciliation?date=2026-07-10');
    expect(response.status).toBe(200);
    const body = await response.json() as ReconciliationResponse;
    expect(body.availability).toEqual({ mapping: true, movements: false, stock: true });
    expect(body.rows[0]).toMatchObject({ consumableId: 10, expectedUsage: 2, currentStock: 8 });
  });
});
