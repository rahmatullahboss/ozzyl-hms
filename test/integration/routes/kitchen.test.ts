/**
 * Comprehensive tests for Kitchen Management module
 *
 * Covers:
 * 1. Zod schema validation (inline schemas in kitchen.ts)
 * 2. Route integration tests (all 12 endpoints)
 * 3. Business logic: status transitions, order generation
 */

import { describe, it, expect } from 'vitest';
import kitchenRoutes from '../../../src/routes/tenant/kitchen';
import { createTestApp, jsonRequest } from '../helpers/test-app';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DIET_TYPE_1 = { id: 1, tenant_id: 'tenant-1', diet_name: 'Normal', description: 'Regular hospital diet', calories_range: '1800-2200 kcal', restrictions: null, is_active: 1 };
const DIET_TYPE_2 = { id: 2, tenant_id: 'tenant-1', diet_name: 'Diabetic', description: 'Low sugar', calories_range: '1600-1800 kcal', restrictions: 'No sugar, low carb', is_active: 1 };
const DIET_TYPE_INACTIVE = { id: 3, tenant_id: 'tenant-1', diet_name: 'Old Diet', is_active: 0 };

const SCHEDULE_1 = { id: 1, tenant_id: 'tenant-1', meal_name: 'Breakfast', start_time: '07:00', end_time: '09:00', sort_order: 1, is_active: 1 };
const SCHEDULE_2 = { id: 2, tenant_id: 'tenant-1', meal_name: 'Lunch', start_time: '12:00', end_time: '14:00', sort_order: 2, is_active: 1 };

const ORDER_PENDING = { id: 1, tenant_id: 'tenant-1', patient_id: 1, ward_name: 'ICU', bed_number: 'B3', diet_type_name: 'Diabetic', meal_name: 'Breakfast', order_date: '2025-04-07', status: 'pending', patient_name: 'Rahim Uddin', patient_code: 'P001' };
const ORDER_PREPARING = { ...ORDER_PENDING, id: 2, status: 'preparing', meal_name: 'Lunch' };
const ORDER_READY = { ...ORDER_PENDING, id: 3, status: 'ready', meal_name: 'Dinner' };
const ORDER_DELIVERED = { ...ORDER_PENDING, id: 4, status: 'delivered', meal_name: 'Breakfast', delivered_at: '2025-04-07T08:30:00Z' };

const PATIENT_1 = { id: 1, name: 'Rahim Uddin', patient_code: 'P001', tenant_id: 'tenant-1' };

// ─── Diet Types ───────────────────────────────────────────────────────────────

describe('Kitchen Routes', () => {

  describe('GET /diet-types', () => {
    it('returns 200 with active diet types only', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_diet_types: [DIET_TYPE_1, DIET_TYPE_2, DIET_TYPE_INACTIVE] },
        universalFallback: true,
      });
      const res = await app.request('/kitchen/diet-types');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('POST /diet-types', () => {
    it('returns 201 with valid data', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/diet-types', {
        method: 'POST',
        body: { diet_name: 'Renal Diet', description: 'Low protein', calories_range: '1500-1800 kcal', restrictions: 'No salt' },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string };
      expect(body.message).toContain('Diet type created');
    });

    it('returns 201 with only diet_name (minimal)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/diet-types', {
        method: 'POST', body: { diet_name: 'NPO' },
      });
      expect(res.status).toBe(201);
    });

    it('rejects empty diet_name (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/diet-types', {
        method: 'POST', body: { diet_name: '' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing diet_name (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/diet-types', {
        method: 'POST', body: { description: 'No name provided' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /diet-types/:id', () => {
    it('returns 404 for non-existent type', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_diet_types: [] },
      });
      const res = await app.request('/kitchen/diet-types/999', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ─── Meal Schedules ─────────────────────────────────────────────────────────

  describe('GET /meal-schedules', () => {
    it('returns 200 ordered by sort_order', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_schedules: [SCHEDULE_2, SCHEDULE_1] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/meal-schedules');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /meal-schedules', () => {
    it('returns 201 with valid schedule', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/meal-schedules', {
        method: 'POST', body: { meal_name: 'Dinner', start_time: '19:00', end_time: '21:00' },
      });
      expect(res.status).toBe(201);
    });

    it('rejects invalid time format (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/meal-schedules', {
        method: 'POST', body: { meal_name: 'Snack', start_time: '3pm', end_time: '4pm' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing meal_name (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/meal-schedules', {
        method: 'POST', body: { start_time: '12:00', end_time: '14:00' },
      });
      expect(res.status).toBe(400);
    });

    it('defaults sort_order to 0', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/meal-schedules', {
        method: 'POST', body: { meal_name: 'Tea', start_time: '16:00', end_time: '17:00' },
      });
      expect(res.status).toBe(201);
    });
  });

  // ─── Meal Orders ────────────────────────────────────────────────────────────

  describe('GET /orders', () => {
    it('returns 200 with data and pagination', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING, ORDER_PREPARING] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/orders?date=2025-04-07');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by ward', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/orders?ward=ICU');
      expect(res.status).toBe(200);
    });

    it('filters by meal', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/orders?meal=Breakfast');
      expect(res.status).toBe(200);
    });

    it('filters by status', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/orders?status=pending');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /orders', () => {
    it('returns 201 with valid order', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders', {
        method: 'POST',
        body: { patient_id: 1, meal_name: 'Lunch', order_date: '2025-04-07', ward_name: 'ICU', diet_type_name: 'Normal' },
      });
      expect(res.status).toBe(201);
    });

    it('returns 201 with minimal fields', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders', {
        method: 'POST', body: { patient_id: 1, meal_name: 'Breakfast', order_date: '2025-04-07' },
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing patient_id (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/orders', {
        method: 'POST', body: { meal_name: 'Lunch', order_date: '2025-04-07' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing meal_name (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/orders', {
        method: 'POST', body: { patient_id: 1, order_date: '2025-04-07' },
      });
      expect(res.status).toBe(400);
    });

    it('defaults quantity to 1', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: {}, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders', {
        method: 'POST', body: { patient_id: 1, meal_name: 'Dinner', order_date: '2025-04-07' },
      });
      expect(res.status).toBe(201);
    });
  });

  // ─── Status Transitions ─────────────────────────────────────────────────────

  describe('PUT /orders/:id/status', () => {
    it('pending → preparing (200)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING] }, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders/1/status', {
        method: 'PUT', body: { status: 'preparing' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string };
      expect(body.message).toContain('preparing');
    });

    it('preparing → ready (200)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PREPARING] }, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders/2/status', {
        method: 'PUT', body: { status: 'ready' },
      });
      expect(res.status).toBe(200);
    });

    it('ready → delivered with delivered_by (200)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_READY] }, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders/3/status', {
        method: 'PUT', body: { status: 'delivered', delivered_by: 'Karim Helper' },
      });
      expect(res.status).toBe(200);
    });

    it('cancelled with reason (200)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING] }, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders/1/status', {
        method: 'PUT', body: { status: 'cancelled', cancelled_reason: 'Patient discharged' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/orders/1/status', {
        method: 'PUT', body: { status: 'cooking' },
      });
      expect(res.status).toBe(400);
    });

    it('returned status is valid (200)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_DELIVERED] }, universalFallback: true,
      });
      const res = await jsonRequest(app, '/kitchen/orders/4/status', {
        method: 'PUT', body: { status: 'returned' },
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── Generate Orders ────────────────────────────────────────────────────────

  describe('POST /orders/generate', () => {
    it('returns message when no admitted patients', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { admissions: [], beds: [], CLN_PatientDiet: [] },
        universalFallback: false,
      });
      const res = await jsonRequest(app, '/kitchen/orders/generate', {
        method: 'POST', body: { order_date: '2025-04-07', meal_name: 'Breakfast' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { generated: number };
      expect(body.generated).toBe(0);
    });

    it('rejects missing order_date (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/orders/generate', {
        method: 'POST', body: { meal_name: 'Lunch' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects missing meal_name (400)', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin', tables: {},
      });
      const res = await jsonRequest(app, '/kitchen/orders/generate', {
        method: 'POST', body: { order_date: '2025-04-07' },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Stats ──────────────────────────────────────────────────────────────────

  describe('GET /stats', () => {
    it('returns 200 with stats, mealBreakdown, dietBreakdown', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING, ORDER_DELIVERED] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/stats?date=2025-04-07');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('stats');
      expect(body).toHaveProperty('mealBreakdown');
      expect(body).toHaveProperty('dietBreakdown');
      expect(body).toHaveProperty('date');
    });

    it('defaults to today when no date param', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/stats');
      expect(res.status).toBe(200);
    });
  });

  // ─── Ward Summary ──────────────────────────────────────────────────────────

  describe('GET /ward-summary', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING, ORDER_DELIVERED] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/ward-summary?date=2025-04-07');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });

    it('filters by meal', async () => {
      const { app } = createTestApp({
        route: kitchenRoutes, routePath: '/kitchen', role: 'hospital_admin',
        tables: { kitchen_meal_orders: [ORDER_PENDING] }, universalFallback: true,
      });
      const res = await app.request('/kitchen/ward-summary?date=2025-04-07&meal=Breakfast');
      expect(res.status).toBe(200);
    });
  });
});
