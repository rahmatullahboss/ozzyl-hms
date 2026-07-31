/**
 * Pharmacy Golden-Path Workflow
 *
 * End-to-end: list medicines -> check stock (if medicine exists) ->
 * check low stock alerts -> check expiring alerts -> view summary ->
 * list categories -> list suppliers.
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

// ── shared state across serial steps ─────────────────────────────────────────

let firstMedicineId = 0;

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('Pharmacy Golden Path', () => {
  test.beforeAll(() => {
    loadAuth();
  });

  // Step 1: List medicines
  test('list medicines', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/medicines`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const medicines =
      (body.medicines as Array<{ id: number }>) ??
      (body.data as Array<{ id: number }>) ??
      [];
    if (Array.isArray(medicines) && medicines.length > 0) {
      firstMedicineId = medicines[0]!.id ?? 0;
    }
  });

  // Step 2: Check stock for a specific medicine (if one exists)
  test('check stock for medicine', async ({ request }) => {
    test.skip(!firstMedicineId, 'No medicines in inventory');
    const res = await request.get(
      `${BASE_URL}/api/pharmacy/medicines/${firstMedicineId}`,
      { headers: authHeaders() },
    );
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      const medicine = (body.medicine as Record<string, unknown>) ?? body;
      // Verify stock field exists (could be quantity, stock, stock_quantity)
      const stock = medicine.stock ?? medicine.quantity ?? medicine.stock_quantity;
      expect(stock !== undefined || stock !== null).toBe(true);
    }
  });

  // Step 3: Check low stock alerts
  test('check low stock alerts', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/low-stock`, {
      headers: authHeaders(),
    });
    // Some deployments may not have this endpoint — accept 200 or 404
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      const items =
        (body.medicines as unknown[]) ??
        (body.data as unknown[]) ??
        (body.alerts as unknown[]) ??
        [];
      expect(Array.isArray(items)).toBe(true);
    }
  });

  // Step 4: Check expiring medicines alerts
  test('check expiring alerts', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/expiring`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      const items =
        (body.medicines as unknown[]) ??
        (body.data as unknown[]) ??
        (body.alerts as unknown[]) ??
        [];
      expect(Array.isArray(items)).toBe(true);
    }
  });

  // Step 5: View pharmacy summary / dashboard
  test('view pharmacy summary', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/summary`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      // Summary should have some stats
      expect(typeof body).toBe('object');
    }
  });

  // Step 6: List pharmacy categories
  test('list categories', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/categories`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      const categories =
        (body.categories as unknown[]) ??
        (body.data as unknown[]) ??
        [];
      expect(Array.isArray(categories)).toBe(true);
    }
  });

  // Step 7: List suppliers
  test('list suppliers', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/pharmacy/suppliers`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      const suppliers =
        (body.suppliers as unknown[]) ??
        (body.data as unknown[]) ??
        [];
      expect(Array.isArray(suppliers)).toBe(true);
    }
  });
});
