/**
 * Integration tests for queue \u0074oken endpoints in src/routes/tenant/queue.ts
 *
 * Tests \u0074oken issuance, listing, status updates, stats, display config
 * using actual route handlers with mock D1.
 */

import { describe, it, expect } from 'vitest';
import queueRoutes from '../../../src/routes/tenant/queue';
import { createTestApp, jsonRequest } from '../helpers/test-app';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PATIENT_1 = {
  id: 1, name: 'Rahim Uddin', patient_code: 'P001',
  gender: 'Male', mobile: '01711111111', tenant_id: 'tenant-1',
};

const DEPT_1 = {
  id: 1, name: 'General Medicine', is_active: 1, tenant_id: 'tenant-1',
};

const QUEUE_ENTRY_1 = {
  id: 1, \u0074oken_no: 'T001', \u0074oken_number: 1, patient_id: 1,
  department_id: 1, queue_date: '2025-04-07', status: 'waiting',
  priority: 'normal', tenant_id: 'tenant-1',
  check_in_time: '2025-04-07T09:00:00Z',
  patient_name: 'Rahim Uddin', patient_code: 'P001',
};

const TOKEN_COUNTER = {
  id: 1, tenant_id: 'tenant-1', department_id: 0,
  counter_date: '2025-04-07', last_\u0074oken: 1, prefix: 'T',
};

const DISPLAY_CONFIG = {
  id: 1, tenant_id: 'tenant-1', display_name: 'Main OPD',
  is_active: 1, refresh_seconds: 10, theme: 'default',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Queue Token Routes', () => {

  // ── POST /\u0074oken — issue \u0074oken ───────────────────────────────────────────
  describe('POST /\u0074oken — issue \u0074oken', () => {
    it('returns 201 with \u0074oken data', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {
          queue_entries: [], queue_\u0074oken_counters: [TOKEN_COUNTER],
          patients: [PATIENT_1], departments: [DEPT_1],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074oken', {
        method: 'POST',
        body: { patientId: 1 },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { message: string; data: { \u0074okenNo: string } };
      expect(body.message).toContain('Token issued');
      expect(body.data).toHaveProperty('\u0074okenNo');
    });

    it('rejects missing patientId (400)', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/queue/\u0074oken', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(400);
    });

    it('accepts priority field', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_entries: [], queue_\u0074oken_counters: [TOKEN_COUNTER] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074oken', {
        method: 'POST',
        body: { patientId: 1, priority: 'emergency' },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { data: { priority: string } };
      expect(body.data.priority).toBe('emergency');
    });

    it('blocks doctor queue \u0074oken when a visit still has a pending consultation charge', async () => {
      const { app, mockDB } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {
          visits: [
            {
              id: 10,
              tenant_id: 'tenant-1',
              patient_id: 1,
              doctor_id: 1,
              appointment_id: null,
              visit_date: '2025-04-07',
            },
          ],
          visit_services: [
            {
              id: 77,
              tenant_id: 'tenant-1',
              visit_id: 10,
              patient_id: 1,
              service_type: 'doctor_visit',
              description: 'Consultation',
              status: 'pending',
              total_amount: 500,
            },
          ],
          queue_entries: [],
          queue_\u0074oken_counters: [TOKEN_COUNTER],
          patients: [PATIENT_1],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074oken', {
        method: 'POST',
        body: { patientId: 1, visitId: 10 },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/payment|due|no-charge/i);
      expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into queue_entries'))).toBe(false);
    });

    it('blocks doctor queue \u0074oken when a linked appointment is not financially cleared', async () => {
      const { app, mockDB } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {
          visits: [
            {
              id: 11,
              tenant_id: 'tenant-1',
              patient_id: 1,
              doctor_id: 1,
              appointment_id: 22,
              visit_date: '2025-04-07',
            },
          ],
          appointments: [
            {
              id: 22,
              tenant_id: 'tenant-1',
              patient_id: 1,
              doctor_id: 1,
              status: 'scheduled',
              billing_status: 'unpaid',
            },
          ],
          visit_services: [],
          queue_entries: [],
          queue_\u0074oken_counters: [TOKEN_COUNTER],
          patients: [PATIENT_1],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074oken', {
        method: 'POST',
        body: { patientId: 1, visitId: 11 },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/appointment payment|due approval|no-charge/i);
      expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into queue_entries'))).toBe(false);
    });

    it('rejects invalid priority value (400)', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/queue/\u0074oken', {
        method: 'POST',
        body: { patientId: 1, priority: 'super_urgent' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /\u0074okens — list \u0074okens ───────────────────────────────────────────
  describe('GET /\u0074okens — list \u0074okens', () => {
    it('returns 200 with Results array', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {
          queue_entries: [QUEUE_ENTRY_1], patients: [PATIENT_1],
          departments: [DEPT_1],
        },
        universalFallback: true,
      });

      const res = await app.request('/queue/\u0074okens');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body).toHaveProperty('Results');
      expect(Array.isArray(body.Results)).toBe(true);
    });
  });

  // ── GET /\u0074okens/stats — statistics ──────────────────────────────────────
  describe('GET /\u0074okens/stats', () => {
    it('returns 200 with Results containing counts', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_entries: [QUEUE_ENTRY_1] },
        universalFallback: true,
      });

      const res = await app.request('/queue/\u0074okens/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: Record<string, unknown> };
      expect(body).toHaveProperty('Results');
    });
  });

  // ── PUT /\u0074okens/:id/status — update status ─────────────────────────────
  describe('PUT /\u0074okens/:id/status', () => {
    it('returns 200 on valid status update', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_entries: [QUEUE_ENTRY_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074okens/1/status', {
        method: 'PUT',
        body: { status: 'serving' },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('serving');
    });

    it('rejects invalid status value (400)', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/queue/\u0074okens/1/status', {
        method: 'PUT',
        body: { status: 'invalid_status' },
      });

      expect(res.status).toBe(400);
    });

    it('accepts completed status (sets serve_end_time)', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_entries: [QUEUE_ENTRY_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074okens/1/status', {
        method: 'PUT',
        body: { status: 'completed' },
      });

      expect(res.status).toBe(200);
    });

    it('syncs appointment to completed when queue completed (with appointment_id)', async () => {
      const queueWithAppt = {
        ...QUEUE_ENTRY_1,
        appointment_id: 10,
      };
      const appt = {
        id: 10, patient_id: 1, doctor_id: 1, appt_date: '2025-04-07', appt_time: '09:00',
        appointment_type: 'new_patient', visit_type: 'new_patient', source: 'reception',
        \u0074oken_no: 1, \u0074oken_assignment_type: 'auto', notes: null, canonical_source_key: null,
        status: 'checked_in', tenant_id: 'tenant-1',
      };

      const { app, mockDB } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_entries: [queueWithAppt], appointments: [appt] },
        queryOverride(sql) {
          const lower = sql.toLowerCase();
          if (lower.includes('count(*) as link_count') && lower.includes('canonical_tenant_patient_links')) {
            return { first: { link_count: 1, patient_link_public_id: 'ptl-1' } };
          }
          if (lower.includes('from canonical_tenant_patient_links') && lower.includes('patient_link_public_id=?')) {
            return { first: { legacy_patient_id: 1, link_status: 'unlinked', effective_to_utc: null } };
          }
          if (lower.includes('select canonical_source_key') && lower.includes('from doctors')) {
            return { first: { canonical_source_key: 'doctor-source-1' } };
          }
          if (lower.includes("entity_type='practitioner'") && lower.includes('canonical_source_mappings')) {
            return { first: { canonical_public_id: 'practitioner-1', mapping_status: 'mapped' } };
          }
          if (lower.includes("entity_type='encounter'") && lower.includes('canonical_source_mappings')) {
            return { first: { canonical_public_id: 'encounter-1', mapping_status: 'mapped' } };
          }
          if (lower.includes("entity_type='appointment'") && lower.includes('canonical_source_mappings')) {
            return { first: null };
          }
          if (lower.includes('from canonical_practitioners')) return { first: { status: 'active' } };
          if (lower.includes('from canonical_encounters')) {
            return { first: { legacy_patient_id: 1, status: 'completed' } };
          }
          if (lower.includes('from canonical_appointment_encounter_links')) return { first: null };
          if (lower.includes('from canonical_appointments')) return { first: null };
          if (lower.includes('from canonical_outbox_events')) return { first: null };
          return null;
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074okens/1/status', {
        method: 'PUT',
        body: { status: 'completed' },
      });

      expect(res.status).toBe(200);
      expect(mockDB.batchCalls.some((batch) =>
        batch.some((sql) => sql.includes('canonical_appointments'))
        && batch.some((sql) => sql.includes('UPDATE appointments'))
        && batch.some((sql) => sql.includes('audit_logs'))
        && batch.some((sql) => sql.includes('canonical_outbox_events'))
      )).toBe(true);
    });

    it('accepts no_show status', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_entries: [QUEUE_ENTRY_1] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/\u0074okens/1/status', {
        method: 'PUT',
        body: { status: 'no_show' },
      });

      expect(res.status).toBe(200);
    });
  });

  // ── GET /announcements — recent calls ──────────────────────────────────
  describe('GET /announcements', () => {
    it('returns 200 with Results', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_announcements: [] },
        universalFallback: true,
      });

      const res = await app.request('/queue/announcements');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body).toHaveProperty('Results');
    });
  });

  // ── POST /display-config — create display config ───────────────────────
  describe('POST /display-config', () => {
    it('returns 201 with valid config', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_display_config: [] },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/queue/display-config', {
        method: 'POST',
        body: {
          displayName: 'Main OPD Display',
          showDoctorName: true,
          showEstimatedWait: true,
          refreshSeconds: 15,
          theme: 'dark',
        },
      });

      expect(res.status).toBe(201);
    });

    it('rejects missing displayName (400)', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/queue/display-config', {
        method: 'POST',
        body: { refreshSeconds: 15 },
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid theme (400)', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: {},
      });

      const res = await jsonRequest(app, '/queue/display-config', {
        method: 'POST',
        body: { displayName: 'X', theme: 'neon_pink' },
      });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /display-config ────────────────────────────────────────────────
  describe('GET /display-config', () => {
    it('returns 200 with Results', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { queue_display_config: [DISPLAY_CONFIG] },
        universalFallback: true,
      });

      const res = await app.request('/queue/display-config');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body).toHaveProperty('Results');
    });
  });

  // ── Legacy: GET /departments ────────────────────────────────────────────
  describe('GET /departments (legacy)', () => {
    it('returns 200 with Results', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { departments: [DEPT_1] },
        universalFallback: true,
      });

      const res = await app.request('/queue/departments');
      expect(res.status).toBe(200);
      const body = await res.json() as { Results: unknown[] };
      expect(body).toHaveProperty('Results');
    });
  });

  // ── Legacy: GET /stats ──────────────────────────────────────────────────
  describe('GET /stats (legacy)', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({
        route: queueRoutes, routePath: '/queue', role: 'hospital_admin',
        tables: { visits: [] },
        universalFallback: true,
      });

      const res = await app.request('/queue/stats');
      expect(res.status).toBe(200);
    });
  });
});
