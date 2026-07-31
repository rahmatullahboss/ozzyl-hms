import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp } from '../../helpers/test-app';

const payload = {
  IssueType: 'department_issue',
  FromStoreId: 1,
  ToDepartment: 'Lab',
  Items: [{ ItemId: 5, StockId: 10, Quantity: 2 }],
};

describe('Inventory — issue request idempotency', () => {
  it('replays a completed issue for the same key and rejects payload mismatch', async () => {
    let operationStatus: 'missing' | 'pending' | 'processing' | 'completed' = 'missing';
    let requestHash = '';
    let responseJson = '';
    let operationInsertCount = 0;
    let atomicBatchCount = 0;

    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql, params) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10,
              ItemId: 5,
              StoreId: 1,
              AvailableQuantity: 10,
              ReservedQuantity: 0,
              DamagedQuantity: 0,
              BlockedQuantity: 0,
              BatchNo: 'IDEMP-LOT',
              ExpiryDate: '2027-12-31',
              CostPrice: 10,
              IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Replay Item', StandardRate: 10, IssueUnit: 'pcs' } };
        }
        if (sql.includes('INSERT OR IGNORE INTO inventory_issue_operation')) {
          operationInsertCount += 1;
          if (operationStatus === 'missing') {
            requestHash = String(params[2]);
            operationStatus = 'pending';
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        if (sql.includes('FROM inventory_issue_operation')) {
          return {
            first: operationStatus === 'missing' ? null : {
              request_hash: requestHash,
              status: operationStatus,
              response_json: responseJson || null,
              attempt_no: 1,
            },
          };
        }
        if (sql.includes("SET status = 'processing'")) {
          operationStatus = 'processing';
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("SET status = 'completed'")) {
          operationStatus = 'completed';
          responseJson = String(params[2]);
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes('SELECT ConsumptionId, ConsumptionNo, TotalCost, TotalCharge')) {
          return {
            first: {
              ConsumptionId: 77,
              ConsumptionNo: 'ISS-77',
              TotalCost: 20,
              TotalCharge: 0,
            },
          };
        }
        if (sql.includes('INSERT INTO InventoryConsumption') && !sql.includes('InventoryConsumptionItem')) {
          atomicBatchCount += 1;
        }
        if (sql.includes('UPDATE InventoryStock')) return { success: true, meta: { changes: 1 } };
        return null;
      },
    });

    const first = await app.request('/inventory/issues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'issue-request-0001',
      },
      body: JSON.stringify(payload),
    });

    expect(first.status).toBe(201);
    const firstBody = await first.json() as any;
    expect(firstBody).toMatchObject({
      OperationKey: 'issue-request-0001',
      replayed: false,
    });
    expect(Number(firstBody.ConsumptionId)).toBeGreaterThan(0);
    expect(String(firstBody.IssueNo)).toMatch(/^ISS-/);

    const second = await app.request('/inventory/issues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'issue-request-0001',
      },
      body: JSON.stringify(payload),
    });

    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      ConsumptionId: firstBody.ConsumptionId,
      IssueNo: firstBody.IssueNo,
      OperationKey: 'issue-request-0001',
      replayed: true,
    });

    const mismatch = await app.request('/inventory/issues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'issue-request-0001',
      },
      body: JSON.stringify({
        ...payload,
        Items: [{ ItemId: 5, StockId: 10, Quantity: 3 }],
      }),
    });

    expect(mismatch.status).toBe(409);
    expect(operationInsertCount).toBe(3);
    expect(mockDB.batchCalls).toHaveLength(1);
    expect(atomicBatchCount).toBe(1);
    expect(mockDB.queries.filter((query) => query.sql.includes('UPDATE InventoryStock'))).toHaveLength(1);
  });

  it('generates and returns an operation key when the client omits one', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      universalFallback: true,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 10,
              ReservedQuantity: 0, DamagedQuantity: 0, BlockedQuantity: 0,
              BatchNo: 'AUTO-KEY', ExpiryDate: '2027-12-31', CostPrice: 10, IsActive: 1,
            },
          };
        }
        if (sql.includes('FROM InventoryItem') && sql.includes('ItemId = ?')) {
          return { first: { ItemId: 5, ItemName: 'Auto Key Item', StandardRate: 10 } };
        }
        if (sql.includes('INSERT OR IGNORE INTO inventory_issue_operation')) return { success: true, meta: { changes: 1 } };
        if (sql.includes("SET status = 'processing'")) return { success: true, meta: { changes: 1 } };
        if (sql.includes("SET status = 'completed'")) return { success: true, meta: { changes: 1 } };
        if (sql.includes('UPDATE InventoryStock')) return { success: true, meta: { changes: 1 } };
        if (sql.includes('SELECT ConsumptionId, ConsumptionNo, TotalCost, TotalCharge')) {
          return { first: { ConsumptionId: 88, ConsumptionNo: 'ISS-88', TotalCost: 20, TotalCharge: 0 } };
        }
        return null;
      },
    });

    const response = await app.request('/inventory/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(String(body.OperationKey)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.replayed).toBe(false);
  });
});
