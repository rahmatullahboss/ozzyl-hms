import { describe, it, expect } from 'vitest';
import hkRoutes from '../../../src/routes/tenant/housekeeping';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const AREA_1 = { id: 1, tenant_id: 'tenant-1', area_name: 'Ward A', area_type: 'ward', floor: '1F', is_active: 1 };
const TASK_1 = { id: 1, tenant_id: 'tenant-1', task_number: 'HK-20250407-001', area_name: 'Ward A', task_type: 'routine', priority: 'normal', scheduled_date: '2025-04-07', status: 'pending' };
const TASK_IP = { ...TASK_1, id: 2, task_number: 'HK-20250407-002', status: 'in_progress' };
const COMP_1 = { id: 1, tenant_id: 'tenant-1', complaint_number: 'HC-20250407-001', area_name: 'ICU', reported_by: 'Nurse Fatima', complaint_type: 'cleanliness', description: 'Floor dirty', priority: 'high', status: 'open' };

describe('Housekeeping Routes', () => {

  // Areas
  describe('GET /areas', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_areas: [AREA_1] }, universalFallback: true });
      expect((await app.request('/hk/areas')).status).toBe(200);
    });
  });
  describe('POST /areas', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {}, universalFallback: true });
      expect((await jsonRequest(app, '/hk/areas', { method: 'POST', body: { area_name: 'OT 2', area_type: 'ot' } })).status).toBe(201);
    });
    it('rejects missing area_name (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/areas', { method: 'POST', body: { area_type: 'ward' } })).status).toBe(400);
    });
    it('rejects invalid area_type (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/areas', { method: 'POST', body: { area_name: 'X', area_type: 'garage' } })).status).toBe(400);
    });
  });
  describe('DELETE /areas/:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_areas: [] } });
      expect((await app.request('/hk/areas/999', { method: 'DELETE' })).status).toBe(404);
    });
  });

  // Stats
  describe('GET /stats', () => {
    it('returns 200 with tasks + complaints', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [TASK_1], housekeeping_complaints: [COMP_1] }, universalFallback: true });
      const res = await app.request('/hk/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('tasks');
      expect(body).toHaveProperty('open_complaints');
    });
  });

  // Tasks
  describe('GET /tasks', () => {
    it('returns 200 with pagination', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [TASK_1] }, universalFallback: true });
      const res = await app.request('/hk/tasks?date=2025-04-07');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('pagination');
    });
    it('filters by status', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [TASK_1] }, universalFallback: true });
      expect((await app.request('/hk/tasks?status=pending')).status).toBe(200);
    });
  });
  describe('POST /tasks', () => {
    it('returns 201 with task_number', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/hk/tasks', { method: 'POST', body: { task_type: 'deep_clean', scheduled_date: '2025-04-07', priority: 'high' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { task_number: string };
      expect(body.task_number).toMatch(/^HK-/);
    });
    it('rejects invalid task_type (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/tasks', { method: 'POST', body: { task_type: 'mopping', scheduled_date: '2025-04-07' } })).status).toBe(400);
    });
    it('rejects invalid date format (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/tasks', { method: 'POST', body: { task_type: 'routine', scheduled_date: '07-04-2025' } })).status).toBe(400);
    });
    it('rejects invalid priority (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/tasks', { method: 'POST', body: { task_type: 'routine', scheduled_date: '2025-04-07', priority: 'critical' } })).status).toBe(400);
    });
  });
  describe('PUT /tasks/:id/status', () => {
    it('pending → in_progress (200)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [TASK_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/hk/tasks/1/status', { method: 'PUT', body: { status: 'in_progress' } })).status).toBe(200);
    });
    it('completed with quality_rating (200)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [TASK_IP] }, universalFallback: true });
      expect((await jsonRequest(app, '/hk/tasks/2/status', { method: 'PUT', body: { status: 'completed', quality_rating: 4 } })).status).toBe(200);
    });
    it('verified (200)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_tasks: [TASK_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/hk/tasks/1/status', { method: 'PUT', body: { status: 'verified', quality_rating: 5 } })).status).toBe(200);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/tasks/1/status', { method: 'PUT', body: { status: 'done' } })).status).toBe(400);
    });
    it('rejects quality_rating > 5 (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/tasks/1/status', { method: 'PUT', body: { status: 'completed', quality_rating: 10 } })).status).toBe(400);
    });
  });

  // Complaints
  describe('GET /complaints', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_complaints: [COMP_1] }, universalFallback: true });
      expect((await app.request('/hk/complaints')).status).toBe(200);
    });
  });
  describe('POST /complaints', () => {
    it('returns 201 with complaint_number', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_complaints: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/hk/complaints', { method: 'POST', body: { reported_by: 'Dr. Khan', complaint_type: 'pest', description: 'Cockroaches in ward', priority: 'urgent' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { complaint_number: string };
      expect(body.complaint_number).toMatch(/^HC-/);
    });
    it('rejects missing reported_by (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/complaints', { method: 'POST', body: { description: 'test' } })).status).toBe(400);
    });
    it('rejects missing description (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/complaints', { method: 'POST', body: { reported_by: 'X' } })).status).toBe(400);
    });
    it('rejects invalid complaint_type (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/complaints', { method: 'POST', body: { reported_by: 'X', description: 'Y', complaint_type: 'noise' } })).status).toBe(400);
    });
  });
  describe('PUT /complaints/:id/status', () => {
    it('open → assigned (200)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_complaints: [COMP_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/hk/complaints/1/status', { method: 'PUT', body: { status: 'assigned', assigned_to: 'Karim' } })).status).toBe(200);
    });
    it('resolved with notes (200)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: { housekeeping_complaints: [COMP_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/hk/complaints/1/status', { method: 'PUT', body: { status: 'resolved', resolution_notes: 'Deep cleaned and pest spray done' } })).status).toBe(200);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: hkRoutes, routePath: '/hk', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/hk/complaints/1/status', { method: 'PUT', body: { status: 'fixed' } })).status).toBe(400);
    });
  });
});
