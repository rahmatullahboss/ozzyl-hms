import { describe, it, expect } from 'vitest';
import fractionRoutes from '../src/routes/tenant/fractions';
import { createTestApp, createTestAppNoRole, jsonRequest } from './integration/helpers/test-app';

describe('Fractions / Incentives', () => {
  describe('POST /percent', () => {
    it('creates a fraction percent rule with valid 60/40 split', async () => {
      const { app } = createTestApp({
        route: fractionRoutes,
        routePath: '/fractions',
        role: 'hospital_admin',
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/fractions/percent', {
        method: 'POST',
        body: { hospitalPercent: 60, doctorPercent: 40 },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.message).toBe('Fraction percent rule created');
      expect(body.id).toBeDefined();
    });

    it('rejects when hospital_percent + doctor_percent does not equal 100', async () => {
      const { app } = createTestApp({
        route: fractionRoutes,
        routePath: '/fractions',
        role: 'hospital_admin',
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/fractions/percent', {
        method: 'POST',
        body: { hospitalPercent: 70, doctorPercent: 20 },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('must equal 100');
    });

    it('requires authentication (role)', async () => {
      const { app } = createTestAppNoRole({
        route: fractionRoutes,
        routePath: '/fractions',
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/fractions/percent', {
        method: 'POST',
        body: { hospitalPercent: 60, doctorPercent: 40 },
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /percent', () => {
    it('returns a list of fraction percent rules', async () => {
      const { app } = createTestApp({
        route: fractionRoutes,
        routePath: '/fractions',
        role: 'director',
        tables: {
          fraction_percents: [
            { id: 1, tenant_id: 'tenant-1', hospital_percent: 60, doctor_percent: 40, is_active: 1 },
            { id: 2, tenant_id: 'tenant-1', hospital_percent: 70, doctor_percent: 30, is_active: 1 },
          ],
        },
      });

      const res = await jsonRequest(app, '/fractions/percent');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toHaveLength(2);
      expect(body.rules[0].hospital_percent).toBe(60);
    });
  });

  describe('POST /calculate', () => {
    it('calculates fraction for a bill', async () => {
      const { app } = createTestApp({
        route: fractionRoutes,
        routePath: '/fractions',
        role: 'accountant',
        tables: {
          invoice_items: [
            { id: 1, bill_id: 10, tenant_id: 'tenant-1', item_category: 'consultation', description: 'Consultation fee', quantity: 1, unit_price: 1000, line_total: 1000, reference_id: null },
          ],
          fraction_percents: [
            { id: 1, tenant_id: 'tenant-1', service_item_id: null, bill_item_category: 'consultation', hospital_percent: 60, doctor_percent: 40, is_active: 1 },
          ],
        },
      });

      const res = await jsonRequest(app, '/fractions/calculate', {
        method: 'POST',
        body: { billId: 10, doctorId: 5 },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.message).toBe('Fractions calculated successfully');
      expect(body.billId).toBe(10);
      expect(body.doctorId).toBe(5);
      expect(body.itemCount).toBe(1);
      expect(body.summary.totalGross).toBe(1000);
      expect(body.summary.totalHospital).toBe(600);
      expect(body.summary.totalDoctor).toBe(400);
      expect(body.items[0].fractionPercentId).toBe(1);
    });
  });
});
