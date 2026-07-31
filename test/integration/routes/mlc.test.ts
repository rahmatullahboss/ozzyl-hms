/**
 * Integration tests for src/routes/tenant/mlc.ts
 * Medico-Legal Case management
 */

import { describe, it, expect } from 'vitest';
import mlcRoutes from '../../../src/routes/tenant/mlc';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const MLC_1 = { id: 1, tenant_id: 'tenant-1', mlc_number: 'MLC-20250407-001', patient_id: 1, case_type: 'assault', case_date: '2025-04-07', status: 'active', police_station: 'Dhanmondi PS', fir_number: 'FIR-2025-123', nature_of_injury: 'grievous', patient_name: 'Rahim', patient_code: 'P001' };
const INJURY_1 = { id: 1, tenant_id: 'tenant-1', mlc_id: 1, injury_number: 1, body_part: 'Head', injury_type: 'Laceration', size_cm: '5x2 cm' };
const NOTE_1 = { id: 1, tenant_id: 'tenant-1', mlc_id: 1, note_type: 'progress', note_text: 'Patient stable', noted_at: '2025-04-07T10:00:00Z' };

describe('MLC Routes', () => {

  // ── List ─────────────────────────────────────────────────────────────────
  describe('GET /', () => {
    it('returns 200 with data and pagination', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await app.request('/mlc');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by case_type', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await app.request('/mlc?case_type=assault');
      expect(res.status).toBe(200);
    });

    it('filters by status', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await app.request('/mlc?status=active');
      expect(res.status).toBe(200);
    });

    it('searches by MLC number', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await app.request('/mlc?search=MLC-2025');
      expect(res.status).toBe(200);
    });
  });

  // ── Detail ──────────────────────────────────────────────────────────────
  describe('GET /:id', () => {
    it('returns case with injuries and notes', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1], mlc_injuries: [INJURY_1], mlc_notes: [NOTE_1] }, universalFallback: true });
      const res = await app.request('/mlc/1');
      expect(res.status).toBe(200);
      const body = await res.json() as { injuries: unknown[]; notes: unknown[] };
      expect(body).toHaveProperty('injuries');
      expect(body).toHaveProperty('notes');
    });

    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [] } });
      const res = await app.request('/mlc/999');
      expect(res.status).toBe(404);
    });
  });

  // ── Create ──────────────────────────────────────────────────────────────
  describe('POST /', () => {
    it('returns 201 with mlc_number', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc', { method: 'POST', body: { patient_id: 1, case_type: 'accident', case_date: '2025-04-07' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { mlc_number: string };
      expect(body.mlc_number).toMatch(/^MLC-/);
    });

    it('returns 201 with full data', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc', { method: 'POST', body: {
        patient_id: 1, case_type: 'assault', case_date: '2025-04-07', case_time: '22:30',
        brought_by: 'Police', police_station: 'Gulshan PS', fir_number: 'FIR-999',
        informant_name: 'Kabir', incident_place: 'Road 11, Dhanmondi',
        general_condition: 'conscious', nature_of_injury: 'grievous',
        injury_description: 'Multiple lacerations on head',
      }});
      expect(res.status).toBe(201);
    });

    it('rejects missing patient_id (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc', { method: 'POST', body: { case_type: 'accident', case_date: '2025-04-07' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid case_type (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc', { method: 'POST', body: { patient_id: 1, case_type: 'kidnapping', case_date: '2025-04-07' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid nature_of_injury (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc', { method: 'POST', body: { patient_id: 1, case_type: 'accident', case_date: '2025-04-07', nature_of_injury: 'critical' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid general_condition (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc', { method: 'POST', body: { patient_id: 1, case_type: 'accident', case_date: '2025-04-07', general_condition: 'sleeping' } });
      expect(res.status).toBe(400);
    });
  });

  // ── Status Update ───────────────────────────────────────────────────────
  describe('PUT /:id/status', () => {
    it('updates to closed (200)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc/1/status', { method: 'PUT', body: { status: 'closed', final_opinion: 'Injuries consistent with blunt force trauma', cause_of_injury: 'Assault with iron rod' } });
      expect(res.status).toBe(200);
    });

    it('updates to discharged (200)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc/1/status', { method: 'PUT', body: { status: 'discharged', discharge_date: '2025-04-10' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc/1/status', { method: 'PUT', body: { status: 'pending' } });
      expect(res.status).toBe(400);
    });
  });

  // ── Injuries ────────────────────────────────────────────────────────────
  describe('POST /:id/injuries', () => {
    it('returns 201 with injury_number', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_injuries: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc/1/injuries', { method: 'POST', body: { body_part: 'Left forearm', injury_type: 'Incised wound', size_cm: '8x1 cm', weapon_used: 'Knife' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { injury_number: number };
      expect(body).toHaveProperty('injury_number');
    });

    it('rejects missing body_part (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc/1/injuries', { method: 'POST', body: { injury_type: 'Contusion' } });
      expect(res.status).toBe(400);
    });
  });

  // ── Notes ───────────────────────────────────────────────────────────────
  describe('POST /:id/notes', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_notes: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc/1/notes', { method: 'POST', body: { note_type: 'police_visit', note_text: 'IO visited, collected statement' } });
      expect(res.status).toBe(201);
    });

    it('defaults note_type to progress', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_notes: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/mlc/1/notes', { method: 'POST', body: { note_text: 'Patient improving' } });
      expect(res.status).toBe(201);
    });

    it('rejects empty note_text (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc/1/notes', { method: 'POST', body: { note_text: '' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid note_type (400)', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/mlc/1/notes', { method: 'POST', body: { note_type: 'random', note_text: 'test' } });
      expect(res.status).toBe(400);
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns 200 with stats and byType', async () => {
      const { app } = createTestApp({ route: mlcRoutes, routePath: '/mlc', role: 'hospital_admin', tables: { mlc_cases: [MLC_1] }, universalFallback: true });
      const res = await app.request('/mlc/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as { stats: unknown; byType: unknown[] };
      expect(body).toHaveProperty('stats');
      expect(body).toHaveProperty('byType');
    });
  });
});
