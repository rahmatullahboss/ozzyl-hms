import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import stockRoutes from '../src/routes/tenant/inventory/stock';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function source(path: string): string {
  return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

describe('inventory global audit logging coverage', () => {
  it('records required inventory events through the shared audit log helper', () => {
    const helpers = source('src/routes/tenant/inventory/helpers.ts');
    expect(helpers).toContain('export async function createInventoryAuditLog');
    expect(helpers).toContain('whoChanged');
    expect(helpers).toContain('whatChanged');
    expect(helpers).toContain('before: input.before');
    expect(helpers).toContain('after: input.after');
    expect(helpers).toContain('timestamp');
    expect(helpers).toContain('device');
    expect(helpers).toContain('CF-Connecting-IP');
    expect(helpers).toContain('user-agent');

    const adjustmentRequests = source('src/routes/tenant/inventory/adjustmentRequests.ts');
    expect(adjustmentRequests).toContain('eventType: "inventory_adjustment_request"');
    expect(adjustmentRequests).toContain('eventType: "adjustment_approval"');
    expect(adjustmentRequests).toContain('eventType: "adjustment_rejection"');

    const stock = source('src/routes/tenant/inventory/stock.ts');
    expect(stock).toContain('eventType: "inventory_stock_adjustment"');

    const transfers = source('src/routes/tenant/inventory/transfers.ts');
    expect(transfers).toContain('eventType: "stock_transfer"');
    expect(transfers).toContain('eventType: "stock_transfer_receipt"');

    const goodsReceipts = source('src/routes/tenant/inventory/gr.ts');
    expect(goodsReceipts).toMatch(/eventType:\s*['"]goods_receipt['"]/);
    expect(goodsReceipts).toMatch(/eventType:\s*['"]goods_receipt_verification['"]/);

    const writeoff = source('src/routes/tenant/inventory/writeoff.ts');
    expect(writeoff).toContain('eventType: "write_off"');
  });

  it('persists stock adjustment audit payload with before/after, reason, IP, device, and timestamp', async () => {
    const { app, mockDB } = createTestApp({
      route: stockRoutes,
      routePath: '/stock',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 77,
      tables: {
        inventorystock: [{
          StockId: 501,
          ItemId: 101,
          StoreId: 3,
          BatchNo: 'B-1',
          AvailableQuantity: 10,
          CostPrice: 25,
          tenant_id: 'tenant-1',
        }],
      },
    });

    const res = await jsonRequest(app, '/stock/adjustment', {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': '203.0.113.10',
        'user-agent': 'Vitest Audit Agent',
      },
      body: {
        StoreId: 3,
        Remarks: 'Monthly physical count correction',
        Items: [{
          ItemId: 101,
          StockId: 501,
          StoreId: 3,
          AdjustmentType: 'subtract',
          Quantity: 2,
          Remarks: 'Found shortage during shelf count',
        }],
      },
    });

    expect(res.status).toBe(200);
    const auditInsert = mockDB.queries.find((query) => query.method === 'run' && query.sql.includes('INSERT INTO audit_logs'));
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.params).toEqual(expect.arrayContaining([
      'tenant-1',
      '77',
      'UPDATE',
      'InventoryStock',
      '203.0.113.10',
      'Vitest Audit Agent',
    ]));

    const oldValue = JSON.parse(String(auditInsert?.params[5] ?? '{}')) as Record<string, unknown>;
    const newValue = JSON.parse(String(auditInsert?.params[6] ?? '{}')) as Record<string, unknown>;

    expect(oldValue).toMatchObject({
      auditEventType: 'inventory_stock_adjustment',
      reason: 'Monthly physical count correction',
      device: {
        ipAddress: '[REDACTED]',
        userAgent: 'Vitest Audit Agent',
      },
    });
    expect(typeof oldValue.timestamp).toBe('string');
    expect(newValue).toMatchObject({
      auditEventType: 'inventory_stock_adjustment',
      whoChanged: '77',
      reason: 'Monthly physical count correction',
      device: {
        ipAddress: '[REDACTED]',
        userAgent: 'Vitest Audit Agent',
      },
      whatChanged: {
        itemCount: 1,
        totalAdjustmentOutValue: 50,
      },
      before: {
        items: [{ StockId: 501, before: { AvailableQuantity: 10 } }],
      },
      after: {
        items: [{ StockId: 501, after: { AvailableQuantity: 8 } }],
      },
    });
    expect(typeof newValue.timestamp).toBe('string');
  });
});
