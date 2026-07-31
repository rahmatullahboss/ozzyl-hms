import { describe, expect, it } from 'vitest';
import qrRoute from '../../../../src/routes/tenant/inventory/qr';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — QR routes', () => {
  it('generates a QR label whose printed value is only the opaque tag code', async () => {
    const { app } = createTestApp({
      route: qrRoute,
      routePath: '/qr',
      role: 'hospital_admin',
      tenantId: 'tenant-qr',
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryItem')) {
          return {
            first: {
              ItemId: 7,
              ItemName: 'Cannula',
              ItemCode: 'CAN-001',
              IsFixedAsset: 0,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/qr/generate', {
      method: 'POST',
      body: {
        EntityType: 'item',
        EntityId: 7,
        TagCode: 'ITEM 000007',
        HumanLabel: 'Cannula label',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      tagCode: string;
      qrPayload: string;
      payload: Record<string, unknown>;
      svg: string;
    };

    expect(body.tagCode).toBe('ITEM000007');
    expect(body.qrPayload).toBe('ITEM000007');
    expect(body.payload).not.toHaveProperty('entity');
    expect(body.svg).toContain('<svg');
  });
});
