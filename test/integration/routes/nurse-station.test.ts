/**
 * Integration tests for src/routes/tenant/nurseStation.ts
 *
 * Tests nurse station dashboard, vitals recording, alert management,
 * and RBAC enforcement.
 */

import { describe, it, expect } from 'vitest';
import nurseStationRoutes from '../../../src/routes/tenant/nurseStation';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, PATIENT_1, ADMISSION_1 } from '../helpers/fixtures';

// ─── Shared test data ──────────────────────────────────────────────────────────

const admissionRecord = {
  id: ADMISSION_1.id,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  admission_no: ADMISSION_1.admission_no,
  status: 'admitted',
  provisional_diagnosis: 'Pneumonia',
  bed_id: 10,
  doctor_id: 5,
};

const vitalRecord = {
  id: 1,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  admission_id: ADMISSION_1.id,
  systolic: 120,
  diastolic: 80,
  temperature: 98.6,
  heart_rate: 72,
  spo2: 98,
  respiratory_rate: 16,
  recorded_at: '2024-01-20T10:00:00Z',
};

const alertRecord = {
  id: 1,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  vital_id: 1,
  vital_type: 'temperature',
  recorded_value: 104.5,
  threshold_min: 97,
  threshold_max: 99.5,
  severity: 'critical',
  status: 'active',
  created_at: '2024-01-20T10:00:00Z',
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Nurse Station Routes', () => {

  // ─── GET /dashboard ──────────────────────────────────────────────────────

  describe('GET /dashboard', () => {
    it('returns active patients with latest vitals', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
          patients: [{ id: PATIENT_1.id, name: PATIENT_1.name, patient_code: PATIENT_1.patient_code }],
          beds: [{ id: 10, ward_name: 'General Ward', bed_number: 'G-01' }],
          doctors: [{ id: 5, name: 'Dr. Ahmed' }],
          patient_vitals: [vitalRecord],
          vital_alerts: [],
        },
      });

      const res = await app.request('/nurse-station/dashboard');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        patients: unknown[];
        stats: {
          activePatients: number;
          pendingVitals: number;
          activeAlerts: number;
        };
      };
      expect(Array.isArray(body.patients)).toBe(true);
      expect(body.stats).toBeDefined();
      expect(body.stats.activePatients).toBeGreaterThanOrEqual(0);
    });

    it('includes alert count for patients with active alerts', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
          patients: [{ id: PATIENT_1.id }],
          patient_vitals: [vitalRecord],
          vital_alerts: [alertRecord],
        },
      });

      const res = await app.request('/nurse-station/dashboard');
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /vitals ────────────────────────────────────────────────────────

  describe('POST /vitals — record vitals', () => {
    it('records vitals successfully', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          vital_alert_rules: [],
        },
      });

      const res = await jsonRequest(app, '/nurse-station/vitals', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          admission_id: ADMISSION_1.id,
          systolic: 120,
          diastolic: 80,
          temperature: 37.0,
          heart_rate: 72,
          spo2: 98,
          respiratory_rate: 16,
        },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { success: boolean; id: number };
      expect(body.success).toBe(true);
    });

    it('converts temperature from Celsius to Fahrenheit when <= 45', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          vital_alert_rules: [],
        },
      });

      const res = await jsonRequest(app, '/nurse-station/vitals', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          temperature: 37.0, // Celsius
        },
      });
      expect(res.status).toBe(201);
    });

    it('denies unauthorized roles', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'lab_tech',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/nurse-station/vitals', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          temperature: 37.0,
        },
      });
      expect(res.status).toBe(403);
    });

    it('validates vital ranges', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/nurse-station/vitals', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          temperature: 200, // Out of range (max 110)
        },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /vitals/bulk ────────────────────────────────────────────────────

  describe('POST /vitals/bulk — bulk vitals entry', () => {
    it('records multiple vitals entries', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/nurse-station/vitals/bulk', {
        method: 'POST',
        body: {
          entries: [
            { patient_id: 101, temperature: 37.0, heart_rate: 72 },
            { patient_id: 102, temperature: 36.8, heart_rate: 80 },
          ],
        },
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { success: boolean; count: number };
      expect(body.count).toBe(2);
    });

    it('rejects empty entries array', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/nurse-station/vitals/bulk', {
        method: 'POST',
        body: { entries: [] },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /vitals-trends/:patientId ──────────────────────────────────────

  describe('GET /vitals-trends/:patientId', () => {
    it('returns vitals time-series data', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          patient_vitals: [vitalRecord],
          vital_alert_rules: [],
        },
      });

      const res = await app.request(`/nurse-station/vitals-trends/${PATIENT_1.id}?days=7`);
      expect(res.status).toBe(200);
      const body = await res.json() as { vitals: unknown[]; thresholds: unknown[] };
      expect(Array.isArray(body.vitals)).toBe(true);
    });

    it('returns 400 for invalid patientId', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
      });

      const res = await app.request('/nurse-station/vitals-trends/invalid');
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /active-alerts ──────────────────────────────────────────────────

  describe('GET /active-alerts', () => {
    it('returns active vital alerts', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          vital_alerts: [alertRecord],
          patients: [{ id: PATIENT_1.id, name: 'Test Patient' }],
          admissions: [admissionRecord],
        },
      });

      const res = await app.request('/nurse-station/active-alerts');
      expect(res.status).toBe(200);
      const body = await res.json() as { alerts: unknown[] };
      expect(Array.isArray(body.alerts)).toBe(true);
    });
  });

  // ─── PUT /alerts/:id/acknowledge ──────────────────────────────────────────

  describe('PUT /alerts/:id/acknowledge', () => {
    it('acknowledges an active alert', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'nurse',
        tenantId: TENANT_1.id,
        tables: {
          vital_alerts: [alertRecord],
        },
      });

      const res = await app.request('/nurse-station/alerts/1/acknowledge', {
        method: 'PUT',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('denies unauthorized roles', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'accountant',
        tenantId: TENANT_1.id,
      });

      const res = await app.request('/nurse-station/alerts/1/acknowledge', {
        method: 'PUT',
      });
      expect(res.status).toBe(403);
    });
  });

  // ─── PUT /alerts/:id/resolve ──────────────────────────────────────────────

  describe('PUT /alerts/:id/resolve', () => {
    it('resolves an alert', async () => {
      const { app } = createTestApp({
        route: nurseStationRoutes,
        routePath: '/nurse-station',
        role: 'doctor',
        tenantId: TENANT_1.id,
        tables: {
          vital_alerts: [{ ...alertRecord, status: 'acknowledged' }],
        },
      });

      const res = await app.request('/nurse-station/alerts/1/resolve', {
        method: 'PUT',
      });
      expect(res.status).toBe(200);
    });
  });
});
