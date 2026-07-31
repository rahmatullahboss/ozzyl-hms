import { describe, it, expect } from 'vitest';
import ambRoutes from '../../../src/routes/tenant/ambulance';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const VEHICLE_1 = { id: 1, tenant_id: 'tenant-1', vehicle_number: 'DH-KA-1234', vehicle_type: 'advanced', make_model: 'Toyota HiAce', driver_name: 'Rahim', current_status: 'available', is_active: 1 };
const VEHICLE_BUSY = { ...VEHICLE_1, id: 2, vehicle_number: 'DH-KA-5678', current_status: 'on_trip' };
const TRIP_1 = { id: 1, tenant_id: 'tenant-1', trip_number: 'AMB-20250407-001', vehicle_id: 1, patient_name: 'Karim', trip_type: 'emergency_pickup', urgency: 'emergency', pickup_location: 'Dhanmondi 27', status: 'dispatched', dispatched_at: '2025-04-07T10:00:00Z', vehicle_number: 'DH-KA-1234' };
const TRIP_TRANSIT = { ...TRIP_1, id: 2, trip_number: 'AMB-20250407-002', status: 'in_transit' };
const TRIP_DONE = { ...TRIP_1, id: 3, trip_number: 'AMB-20250407-003', status: 'completed' };

describe('Ambulance Routes', () => {

  // ─── RBAC ──────────────────────────────────────────────────────────────────

  describe('Permission guards', () => {
    it('allows hospital_admin to access stats', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {}, universalFallback: true });
      expect((await app.request('/amb/stats')).status).toBe(200);
    });
    it('blocks doctor from ambulance routes (403)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'doctor', tables: {}, universalFallback: true });
      expect((await app.request('/amb/stats')).status).toBe(403);
    });
    it('allows reception role (read permission) to access stats', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'reception', tables: {}, universalFallback: true });
      expect((await app.request('/amb/stats')).status).toBe(200);
    });
  });

  // Stats
  describe('GET /stats', () => {
    it('returns 200 with vehicles + trip counts', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_vehicles: [VEHICLE_1], ambulance_trips: [TRIP_1] }, universalFallback: true });
      const res = await app.request('/amb/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('vehicles');
      expect(body).toHaveProperty('today_trips');
      expect(body).toHaveProperty('active_trips');
    });
  });

  // Vehicles
  describe('GET /vehicles', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_vehicles: [VEHICLE_1] }, universalFallback: true });
      expect((await app.request('/amb/vehicles')).status).toBe(200);
    });
  });
  describe('POST /vehicles', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {}, universalFallback: true });
      expect((await jsonRequest(app, '/amb/vehicles', { method: 'POST', body: { vehicle_number: 'DH-NEW', vehicle_type: 'icu' } })).status).toBe(201);
    });
    it('rejects missing vehicle_number (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/vehicles', { method: 'POST', body: { vehicle_type: 'basic' } })).status).toBe(400);
    });
    it('rejects invalid vehicle_type (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/vehicles', { method: 'POST', body: { vehicle_number: 'X', vehicle_type: 'helicopter' } })).status).toBe(400);
    });
  });
  describe('PUT /vehicles/:id', () => {
    it('updates status (200)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_vehicles: [VEHICLE_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/amb/vehicles/1', { method: 'PUT', body: { current_status: 'maintenance' } })).status).toBe(200);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/vehicles/1', { method: 'PUT', body: { current_status: 'broken' } })).status).toBe(400);
    });
    it('rejects empty body (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/vehicles/1', { method: 'PUT', body: {} })).status).toBe(400);
    });
  });
  describe('DELETE /vehicles/:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_vehicles: [] } });
      expect((await app.request('/amb/vehicles/999', { method: 'DELETE' })).status).toBe(404);
    });
  });

  // Trips
  describe('GET /trips', () => {
    it('returns 200 with pagination', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_1] }, universalFallback: true });
      const res = await app.request('/amb/trips');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('pagination');
    });
    it('filters by status', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_1] }, universalFallback: true });
      expect((await app.request('/amb/trips?status=dispatched')).status).toBe(200);
    });
  });
  describe('GET /trips/:id', () => {
    it('returns trip detail', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_1] }, universalFallback: true });
      expect((await app.request('/amb/trips/1')).status).toBe(200);
    });
    it('returns 404', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [] } });
      expect((await app.request('/amb/trips/999')).status).toBe(404);
    });
  });
  describe('POST /trips', () => {
    it('returns 201 with trip_number', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [], ambulance_vehicles: [VEHICLE_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/amb/trips', { method: 'POST', body: { vehicle_id: 1, trip_type: 'emergency_pickup', pickup_location: 'Mirpur 10', urgency: 'emergency' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { trip_number: string };
      expect(body.trip_number).toMatch(/^AMB-/);
    });
    it('rejects missing pickup_location (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/trips', { method: 'POST', body: { vehicle_id: 1, trip_type: 'referral' } })).status).toBe(400);
    });
    it('rejects invalid trip_type (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/trips', { method: 'POST', body: { vehicle_id: 1, trip_type: 'taxi', pickup_location: 'X' } })).status).toBe(400);
    });
    it('rejects invalid urgency (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/trips', { method: 'POST', body: { vehicle_id: 1, trip_type: 'referral', pickup_location: 'X', urgency: 'asap' } })).status).toBe(400);
    });
  });
  describe('PUT /trips/:id/status', () => {
    it('dispatched → en_route (200)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/amb/trips/1/status', { method: 'PUT', body: { status: 'en_route' } })).status).toBe(200);
    });
    it('in_transit → completed (200, marks vehicle available)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_TRANSIT], ambulance_vehicles: [VEHICLE_BUSY] }, universalFallback: true });
      expect((await jsonRequest(app, '/amb/trips/2/status', { method: 'PUT', body: { status: 'completed', distance_km: 12.5, fare_amount: 500 } })).status).toBe(200);
    });
    it('cancelled with reason (200)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_1], ambulance_vehicles: [VEHICLE_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/amb/trips/1/status', { method: 'PUT', body: { status: 'cancelled', cancelled_reason: 'Patient refused' } })).status).toBe(200);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/amb/trips/1/status', { method: 'PUT', body: { status: 'flying' } })).status).toBe(400);
    });
  });

  // Active
  describe('GET /active', () => {
    it('returns 200 with active trips only', async () => {
      const { app } = createTestApp({ route: ambRoutes, routePath: '/amb', role: 'hospital_admin', tables: { ambulance_trips: [TRIP_1, TRIP_DONE] }, universalFallback: true });
      const res = await app.request('/amb/active');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });
});
