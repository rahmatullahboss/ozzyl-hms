import { describe, expect, it } from 'vitest';
import { medicationReconciliationRoutes } from '../src/routes/tenant/nursing/medication-reconciliation';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

describe('medication reconciliation linked prescription', () => {
  it('returns the existing prescription so the doctor opens it instead of creating a duplicate', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from "cln_medication_reconciliation_items"')) {
          return { results: [] };
        }
        if (lower.includes('from "cln_medication_reconciliation"')) {
          return {
            results: [{
              id: 55,
              tenant_id: 'tenant-1',
              patient_id: 10,
              visit_id: 20,
              reconciliation_type: 'discharge',
              status: 'completed',
              performed_by: 42,
              completed_at: '2026-07-11T00:00:00Z',
              notes: null,
              is_active: 1,
              created_by: 42,
              created_at: '2026-07-11T00:00:00Z',
              updated_at: null,
              updated_by: 42,
            }],
          };
        }
        if (lower.includes('from prescriptions') && lower.includes('source_reconciliation_id')) {
          return {
            first: { id: 901, rx_no: 'RX-901', status: 'draft' },
            results: [{ id: 901, rx_no: 'RX-901', status: 'draft' }],
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: medicationReconciliationRoutes,
      routePath: '/medication-reconciliation',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 42,
      mockDB,
    });

    const res = await app.request('/medication-reconciliation/55');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      Results: {
        linked_prescription: { id: 901, rx_no: 'RX-901', status: 'draft' },
      },
    });
  });
});
