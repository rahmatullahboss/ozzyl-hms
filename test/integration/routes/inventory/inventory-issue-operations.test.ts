import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp } from '../../helpers/test-app';

const diagnosticRows = [
  { issue_code: 'header_without_lines', operation_id: 1, consumption_id: 10, issue_no: 'ISS-10', detail: 'Header has no issue lines', detected_at: '2026-07-10' },
  { issue_code: 'header_total_mismatch', operation_id: 2, consumption_id: 11, issue_no: 'ISS-11', detail: 'Header totals differ from lines', detected_at: '2026-07-10' },
  { issue_code: 'missing_stock_transaction', operation_id: 3, consumption_id: 12, issue_no: 'ISS-12', detail: 'Issue line has no stock transaction', detected_at: '2026-07-10' },
  { issue_code: 'missing_provisional_billing', operation_id: 4, consumption_id: 13, issue_no: 'ISS-13', detail: 'Chargeable issue line has no billing reference', detected_at: '2026-07-10' },
  { issue_code: 'stale_processing_operation', operation_id: 5, consumption_id: null, issue_no: null, detail: 'Operation is processing beyond threshold', detected_at: '2026-07-10' },
];

describe('Inventory — issue operation diagnostics', () => {
  it('lists tenant-scoped failed operations for hospital administrators', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-a',
      userId: 7,
      queryOverride(sql, params) {
        if (sql.includes('FROM inventory_issue_operation') && !sql.includes('UNION ALL')) {
          expect(params).toEqual(['tenant-a', 'failed', 25]);
          return {
            results: [{
              operation_id: 9,
              idempotency_key: 'issue-key-9',
              request_hash: 'hash-9',
              status: 'failed',
              consumption_id: null,
              issue_no: null,
              last_error: 'Stock conflict',
              attempt_no: 2,
              created_by: '7',
              created_at: '2026-07-10',
              updated_at: '2026-07-10',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/inventory/issue-operations?status=failed&limit=25');
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ operationId: 9, status: 'failed', attemptNo: 2 });
    expect(mockDB.queries.every((query) => !query.sql.includes('inventory_issue_operation') || query.params.includes('tenant-a'))).toBe(true);
  });

  it('classifies legacy partial records and stale operations', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'director',
      tenantId: 'tenant-a',
      userId: 7,
      queryOverride(sql, params) {
        if (sql.includes("'header_without_lines' AS issue_code") && sql.includes('UNION ALL')) {
          expect(params).toEqual(['tenant-a', 'tenant-a', 'tenant-a', 'tenant-a', 'tenant-a', 100]);
          return { results: diagnosticRows };
        }
        return null;
      },
    });

    const response = await app.request('/inventory/issue-operations/diagnostics?limit=100');
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data.map((row: any) => row.issueCode)).toEqual([
      'header_without_lines',
      'header_total_mismatch',
      'missing_stock_transaction',
      'missing_provisional_billing',
      'stale_processing_operation',
    ]);
    expect(body.summary).toEqual({
      header_without_lines: 1,
      header_total_mismatch: 1,
      missing_stock_transaction: 1,
      missing_provisional_billing: 1,
      stale_processing_operation: 1,
    });
    expect(mockDB.queries.every((query) => !query.sql.includes('UNION ALL') || query.params.filter((value) => value === 'tenant-a').length === 5)).toBe(true);
  });

  it('denies operation diagnostics to receptionists', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'receptionist',
      tenantId: 'tenant-a',
      userId: 7,
    });

    const listResponse = await app.request('/inventory/issue-operations');
    const diagnosticResponse = await app.request('/inventory/issue-operations/diagnostics');
    expect(listResponse.status).toBe(403);
    expect(diagnosticResponse.status).toBe(403);
  });
});
