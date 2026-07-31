import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import billingRoutes from '../src/routes/tenant/billing';
import type { Env, Variables } from '../src/types';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── Tax Calculation Tests ──────────────────────────────────────────────────
// Verifies that the main billing route calculates VAT/tax correctly,
// matching the billing counter formula:
//   taxAmount = taxable ? Math.round(((gross - discount) * tax_percent) / 100) : 0
//   lineTotal = gross - discount + taxAmount
//   total = subtotal - discount + taxTotal

function taxQueryOverride(sql: string) {
  const lower = sql.toLowerCase();
  if (lower.includes('from billing_counter_sessions')) {
    return {
      results: [{
        id: 1,
        counter_id: 10,
        employee_id: 1,
        tenant_id: 'tenant-1',
        status: 'active',
        counter_name: 'Main',
        counter_code: 'C1',
        counter_type: 'billing',
        opening_cash: 0,
        opened_at: '2025-01-01',
      }],
    };
  }
  if (lower.includes('from billing_item_price_category_maps')) {
    return { results: [] };
  }
  if (lower.includes('from accounting_periods')) {
    return { results: [{ status: 'open' }] };
  }
  if (lower.includes('from patients')) {
    return {
      first: { id: 1, tenant_id: 'tenant-1' },
      results: [{ id: 1, tenant_id: 'tenant-1' }],
    };
  }
  return null;
}

describe('Billing Tax Calculation', () => {
  describe('resolveBillItemsFromCatalog — tax fields', () => {
    it('calculates 15% tax on a taxable item', async () => {
      // Service item: price=1000, tax_applicable=1, tax_percent=15
      // gross = 1000*1 = 1000, discount=0, tax = Math.round(1000*15/100) = 150
      // lineTotal = 1000 - 0 + 150 = 1150
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const override = taxQueryOverride(sql);
          if (override) return override;
          const lower = sql.toLowerCase();
          if (lower.includes('from billing_service_items')) {
            return {
              results: [{
                id: 101,
                item_name: 'CBC Test',
                price: 1000,
                department_name: 'Lab',
                tax_applicable: 1,
                tax_percent: 15,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [
            { itemCategory: 'test', quantity: 1, unitPrice: 1000, serviceItemId: 101 },
          ],
          discount: 0,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      // total should be subtotal(1000) - discount(0) + taxTotal(150) = 1150
      expect(body.total).toBe(1150);
    });

    it('returns tax=0 for a non-taxable item', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const override = taxQueryOverride(sql);
          if (override) return override;
          const lower = sql.toLowerCase();
          if (lower.includes('from billing_service_items')) {
            return {
              results: [{
                id: 102,
                item_name: 'Dressing',
                price: 500,
                department_name: 'Nursing',
                tax_applicable: 0,
                tax_percent: null,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [
            { itemCategory: 'service', quantity: 1, unitPrice: 500, serviceItemId: 102 },
          ],
          discount: 0,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      // No tax: total = 500 - 0 + 0 = 500
      expect(body.total).toBe(500);
    });

    it('handles mixed bill: taxable + non-taxable items', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const override = taxQueryOverride(sql);
          if (override) return override;
          const lower = sql.toLowerCase();
          if (lower.includes('from billing_service_items')) {
            return {
              results: [
                {
                  id: 101,
                  item_name: 'CBC Test',
                  price: 1000,
                  department_name: 'Lab',
                  tax_applicable: 1,
                  tax_percent: 15,
                },
                {
                  id: 102,
                  item_name: 'Dressing',
                  price: 500,
                  department_name: 'Nursing',
                  tax_applicable: 0,
                  tax_percent: null,
                },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [
            { itemCategory: 'test', quantity: 1, unitPrice: 1000, serviceItemId: 101 },
            { itemCategory: 'service', quantity: 1, unitPrice: 500, serviceItemId: 102 },
          ],
          discount: 0,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      // CBC: 1000 + 150 tax = 1150
      // Dressing: 500 + 0 tax = 500
      // subtotal = 1500, taxTotal = 150, total = 1500 - 0 + 150 = 1650
      expect(body.total).toBe(1650);
    });

    it('calculates tax AFTER discount, not before', async () => {
      // Item price=1000, qty=1, discount=200, tax=15%
      // gross = 1000, discount = 200
      // tax = Math.round((1000 - 200) * 15 / 100) = Math.round(120) = 120
      // lineTotal = 1000 - 200 + 120 = 920
      // subtotal = 1000, discount = 200, taxTotal = 120
      // total = subtotal - discount + taxTotal = 1000 - 200 + 120 = 920
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const override = taxQueryOverride(sql);
          if (override) return override;
          const lower = sql.toLowerCase();
          if (lower.includes('from billing_service_items')) {
            return {
              results: [{
                id: 101,
                item_name: 'CBC Test',
                price: 1000,
                department_name: 'Lab',
                tax_applicable: 1,
                tax_percent: 15,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [
            { itemCategory: 'test', quantity: 1, unitPrice: 1000, serviceItemId: 101 },
          ],
          discount: 200,
          discountReason: 'Staff discount',
          discountByName: 'Director',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      // total = subtotal(1000) - discount(200) + taxTotal(120) = 920
      expect(body.total).toBe(920);
    });

    it('total = subtotal - discount + taxTotal for a complete bill', async () => {
      // Item 1: price=2000, qty=2, tax=10% → gross=4000
      // Item 2: price=300, qty=1, no tax  → gross=300
      // subtotal = 4300, discount = 500
      // Proportional discount distribution:
      //   ratio = 500/4300 = 0.116279...
      //   item1 discount = round(4000 * 500/4300) = 465
      //   item2 discount = round(300 * 500/4300) = 35
      //   (465 + 35 = 500 ✓)
      // Tax: item1 tax = round((4000-465) * 10/100) = round(353.5) = 354
      //       item2 tax = 0
      // lineTotals: item1 = 4000-465+354 = 3889, item2 = 300-35+0 = 265
      // total = 3889 + 265 = 4154
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const override = taxQueryOverride(sql);
          if (override) return override;
          const lower = sql.toLowerCase();
          if (lower.includes('from billing_service_items')) {
            return {
              results: [
                {
                  id: 201,
                  item_name: 'X-Ray',
                  price: 2000,
                  department_name: 'Radiology',
                  tax_applicable: 1,
                  tax_percent: 10,
                },
                {
                  id: 202,
                  item_name: 'Bandage',
                  price: 300,
                  department_name: 'Nursing',
                  tax_applicable: 0,
                  tax_percent: null,
                },
              ],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing', {
        method: 'POST',
        body: {
          patientId: 1,
          items: [
            { itemCategory: 'test', quantity: 2, unitPrice: 2000, serviceItemId: 201 },
            { itemCategory: 'service', quantity: 1, unitPrice: 300, serviceItemId: 202 },
          ],
          discount: 500,
          discountReason: 'Promotion',
          discountByName: 'Director',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.total).toBe(4154);
    });
  });
});
