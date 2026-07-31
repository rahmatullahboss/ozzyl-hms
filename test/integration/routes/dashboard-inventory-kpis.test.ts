import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

function inventoryQueryResult(sql: string) {
  const lower = sql.toLowerCase();
  if (lower.includes('executive_inventory:inventory_stock_skus:summary')) {
    return { results: [{ total: 3 }] };
  }
  if (lower.includes('executive_inventory:inventory_low_stock:summary')) {
    return { results: [{ total: 1 }] };
  }
  if (lower.includes('executive_inventory:inventory_out_of_stock:summary')) {
    return { results: [{ total: 2 }] };
  }
  if (lower.includes('executive_inventory:lab_tests_completed:summary')) {
    return { results: [{ total: 18 }] };
  }
  if (lower.includes('executive_inventory:lab_reagent_consumed:summary')) {
    return { results: [{ total: 2 }] };
  }
  if (lower.includes('executive_inventory:lab_reagent_qc_issues:summary')) {
    return { results: [{ total: 2 }] };
  }
  if (lower.includes('executive_inventory:unmapped_lab_tests:summary')) {
    return { results: [{ total: 1 }] };
  }
  if (lower.includes('executive_inventory:consumption_exceptions:summary')) {
    return { results: [{ total: 3 }] };
  }
  if (lower.includes('executive_inventory:radiology_exams_completed:summary')) {
    return { results: [{ total: 7 }] };
  }
  if (lower.includes('executive_inventory:radiology_low_stock:summary')) {
    return { results: [{ total: 2 }] };
  }
  if (lower.includes('executive_inventory:inventory_stock_skus:details')) {
    return {
      results: [
        {
          id: 'inventory-item-10',
          occurred_at: '2026-07-12',
          source_type: 'inventory_stock',
          source_label: 'CBC Reagent',
          reference_no: 'CBC-REAG',
          amount: 45,
          status: 'available',
          item_name: 'CBC Reagent',
          item_code: 'CBC-REAG',
          unit_name: 'test',
          available_quantity: 45,
          reorder_level: 20,
          store_name: 'Main Store',
          batch_no: 'LOT-1',
          expiry_date: '2026-12-31',
        },
        {
          id: 'inventory-item-11',
          occurred_at: '2026-07-12',
          source_type: 'inventory_stock',
          source_label: 'X-ray Film',
          reference_no: 'XR-FILM',
          amount: 20,
          status: 'available',
          item_name: 'X-ray Film',
          item_code: 'XR-FILM',
          unit_name: 'pcs',
          available_quantity: 20,
          reorder_level: 10,
          store_name: 'Radiology Store',
          batch_no: 'XR-1',
          expiry_date: '2027-01-01',
        },
      ],
    };
  }
  return null;
}

describe('executive inventory, reagent, and radiology KPI metrics', () => {
  it('returns source-only inventory, reagent, and radiology totals in the KPI summary', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: inventoryQueryResult,
    });

    const response = await app.request('/dashboard/kpi-summary?date=2026-07-12');
    expect(response.status).toBe(200);
    const body = await response.json() as { metrics: Array<{ metric: string; total: number; valueType: string }> };
    const totals = new Map(body.metrics.map((metric) => [metric.metric, metric]));

    expect(totals.get('inventory_stock_skus')).toMatchObject({ total: 3, valueType: 'count' });
    expect(totals.get('inventory_low_stock')).toMatchObject({ total: 1, valueType: 'count' });
    expect(totals.get('inventory_out_of_stock')).toMatchObject({ total: 2, valueType: 'count' });
    expect(totals.get('lab_tests_completed')).toMatchObject({ total: 18, valueType: 'count' });
    expect(totals.get('lab_reagent_consumed')).toMatchObject({ total: 2, valueType: 'count' });
    expect(totals.get('lab_reagent_qc_issues')).toMatchObject({ total: 2, valueType: 'count' });
    expect(totals.get('unmapped_lab_tests')).toMatchObject({ total: 1, valueType: 'count' });
    expect(totals.get('consumption_exceptions')).toMatchObject({ total: 3, valueType: 'count' });
    expect(totals.get('radiology_exams_completed')).toMatchObject({ total: 7, valueType: 'count' });
    expect(totals.get('radiology_low_stock')).toMatchObject({ total: 2, valueType: 'count' });
    expect(mockDB.queries.some((query) => query.sql.includes(':details'))).toBe(false);
  });

  it('keeps inventory card total equal to its item drilldown and preserves stock metadata', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'hospital-a',
      queryOverride: inventoryQueryResult,
    });

    const response = await app.request('/dashboard/kpi-breakdown?metric=inventory_stock_skus&date=2026-07-12');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      metric: string;
      total: number;
      totalRows: number;
      rows: Array<{
        itemName?: string;
        itemCode?: string;
        unitName?: string;
        availableQuantity?: number;
        reorderLevel?: number;
        storeName?: string;
        batchNo?: string;
        expiryDate?: string;
      }>;
    };

    expect(body).toMatchObject({ metric: 'inventory_stock_skus', total: 3, totalRows: 3 });
    expect(body.rows[0]).toMatchObject({
      itemName: 'CBC Reagent',
      itemCode: 'CBC-REAG',
      unitName: 'test',
      availableQuantity: 45,
      reorderLevel: 20,
      storeName: 'Main Store',
      batchNo: 'LOT-1',
      expiryDate: '2026-12-31',
    });

    const summaryQuery = mockDB.queries.find((query) => query.sql.includes('executive_inventory:inventory_stock_skus:summary'));
    expect(summaryQuery?.params).toContain('hospital-a');
  });

  it('keeps every inventory, reagent, and radiology card equal to a non-zero detail drilldown', async () => {
    const metrics = [
      'inventory_stock_skus', 'inventory_low_stock', 'inventory_out_of_stock', 'inventory_expiring_soon', 'inventory_expired', 'inventory_pending_purchase',
      'lab_tests_completed', 'lab_reagent_consumed', 'lab_reagent_stock_skus', 'lab_reagent_low_stock', 'lab_reagent_out_of_stock',
      'lab_reagent_expiring_soon', 'lab_reagent_qc_issues', 'unmapped_lab_tests', 'consumption_exceptions',
      'radiology_exams_completed', 'radiology_stock_skus', 'radiology_low_stock', 'radiology_out_of_stock', 'radiology_expiring_soon', 'radiology_issue_lines',
    ] as const;
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        const metric = metrics.find((candidate) => lower.includes(`executive_inventory:${candidate}:`));
        if (!metric) return null;
        if (lower.includes(':summary')) return { results: [{ total: 1 }] };
        if (lower.includes(':details')) {
          return { results: [{
            id: `${metric}-1`, occurred_at: '2026-07-12 10:00:00', source_type: metric, source_label: 'Detail row',
            reference_no: `REF-${metric}`, amount: 1, status: 'active', item_name: 'Tracked item', item_code: 'ITEM-1',
            unit_name: 'pcs', available_quantity: 1, reorder_level: 1, store_name: 'Main Store', batch_no: 'LOT-1', expiry_date: '2026-12-31',
          }] };
        }
        return null;
      },
    });

    for (const metric of metrics) {
      const summaryResponse = await app.request(`/dashboard/kpi-summary?date=2026-07-12&metrics=${metric}`);
      expect(summaryResponse.status, `${metric} summary status`).toBe(200);
      const summary = await summaryResponse.json() as { metrics: Array<{ metric: string; total: number; valueType: string }> };
      expect(summary.metrics).toEqual([expect.objectContaining({ metric, total: 1, valueType: 'count' })]);

      const response = await app.request(`/dashboard/kpi-breakdown?metric=${metric}&date=2026-07-12`);
      expect(response.status, `${metric} drilldown status`).toBe(200);
      const breakdown = await response.json() as { total: number; totalRows: number; valueType: string; rows: Array<Record<string, unknown>> };
      expect(breakdown).toMatchObject({ total: 1, totalRows: 1, valueType: 'count' });
      expect(breakdown.rows).toHaveLength(1);
      expect(breakdown.rows[0]).toMatchObject({ referenceNo: `REF-${metric}`, itemName: 'Tracked item' });
    }
  });
});
