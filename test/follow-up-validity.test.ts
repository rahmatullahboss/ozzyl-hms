import { describe, it, expect } from 'vitest';
import {
  calculateVisitValidity,
  getValiditySettings,
  DEFAULT_FOLLOW_UP_VALID_DAYS,
  DEFAULT_REPORT_SHOW_VALID_DAYS,
  type ValidityBadge,
} from '../src/lib/follow-up-validity';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createTestApp } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

// ─── Pure function tests ─────────────────────────────────────────────────────

describe('Follow-up Validity System', () => {

  describe('calculateVisitValidity', () => {
    it('returns "new_visit" for new_patient appointments regardless of date', () => {
      const result = calculateVisitValidity('new_patient', '2026-05-20', '2026-05-26');
      expect(result.badge).toBe('new_visit');
    });

    it('returns "valid_follow_up" for follow_up within 7 days', () => {
      const result = calculateVisitValidity('follow_up', '2026-05-22', '2026-05-26', 7);
      expect(result.badge).toBe('valid_follow_up');
    });

    it('returns "follow_up_expired" for follow_up after 7 days', () => {
      const result = calculateVisitValidity('follow_up', '2026-05-15', '2026-05-26', 7);
      expect(result.badge).toBe('follow_up_expired');
    });

    it('returns "valid_follow_up" on exactly the last valid day', () => {
      // appointment was on May 19, today is May 26 = 7 days difference
      const result = calculateVisitValidity('follow_up', '2026-05-19', '2026-05-26', 7);
      expect(result.badge).toBe('valid_follow_up');
    });

    it('returns "follow_up_expired" one day past validity window', () => {
      // appointment was on May 18, today is May 26 = 8 days difference
      const result = calculateVisitValidity('follow_up', '2026-05-18', '2026-05-26', 7);
      expect(result.badge).toBe('follow_up_expired');
    });

    it('returns "valid_report_show" for report_show within 15 days', () => {
      const result = calculateVisitValidity('report_show', '2026-05-15', '2026-05-26', 7, 15);
      expect(result.badge).toBe('valid_report_show');
    });

    it('returns "report_show_expired" for report_show after 15 days', () => {
      const result = calculateVisitValidity('report_show', '2026-05-05', '2026-05-26', 7, 15);
      expect(result.badge).toBe('report_show_expired');
    });

    it('returns "valid_report_show" on exactly the last valid day (15)', () => {
      // May 11 to May 26 = 15 days
      const result = calculateVisitValidity('report_show', '2026-05-11', '2026-05-26', 7, 15);
      expect(result.badge).toBe('valid_report_show');
    });

    it('returns "report_show_expired" one day past report show window', () => {
      // May 10 to May 26 = 16 days
      const result = calculateVisitValidity('report_show', '2026-05-10', '2026-05-26', 7, 15);
      expect(result.badge).toBe('report_show_expired');
    });

    it('returns "new_visit" for old_patient (treated as follow-up with default window)', () => {
      // old_patient is mapped to follow_up behavior
      const result = calculateVisitValidity('old_patient', '2026-05-22', '2026-05-26', 7);
      expect(result.badge).toBe('valid_follow_up');
    });

    it('returns "new_visit" for emergency appointments', () => {
      const result = calculateVisitValidity('emergency', '2026-05-20', '2026-05-26');
      expect(result.badge).toBe('new_visit');
    });

    it('returns "new_visit" when appointment_type is null', () => {
      const result = calculateVisitValidity(null, '2026-05-20', '2026-05-26');
      expect(result.badge).toBe('new_visit');
    });

    it('returns "new_visit" when appointment_type is undefined', () => {
      const result = calculateVisitValidity(undefined, '2026-05-20', '2026-05-26');
      expect(result.badge).toBe('new_visit');
    });

    it('includes days_elapsed in the result', () => {
      const result = calculateVisitValidity('follow_up', '2026-05-22', '2026-05-26', 7);
      expect(result.days_elapsed).toBe(4);
    });

    it('includes valid_days in the result', () => {
      const result = calculateVisitValidity('follow_up', '2026-05-22', '2026-05-26', 7);
      expect(result.valid_days).toBe(7);
    });

    it('uses custom follow_up_valid_days from settings', () => {
      // 10-day window: May 16 to May 26 = 10 days
      const result = calculateVisitValidity('follow_up', '2026-05-16', '2026-05-26', 10);
      expect(result.badge).toBe('valid_follow_up');
    });

    it('follow_up with custom 10-day window expires after 10 days', () => {
      // May 15 to May 26 = 11 days
      const result = calculateVisitValidity('follow_up', '2026-05-15', '2026-05-26', 10);
      expect(result.badge).toBe('follow_up_expired');
    });
  });

  describe('getValiditySettings', () => {
    it('returns default values when no settings exist in DB', async () => {
      const mockDB = createMockDB({
        queryOverride(sql) {
          if (sql.toLowerCase().includes('from settings')) return { first: null };
          return null;
        },
      });

      const db = mockDB.db as unknown as import('drizzle-orm/d1').DrizzleD1Database;
      const settings = await getValiditySettings(db as any, 'tenant-1');
      expect(settings.follow_up_valid_days).toBe(DEFAULT_FOLLOW_UP_VALID_DAYS);
      expect(settings.report_show_valid_days).toBe(DEFAULT_REPORT_SHOW_VALID_DAYS);
    });

    it('returns stored values when settings exist in DB', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const s = sql.toLowerCase();
          if (s.includes('from settings') && s.includes('key = ?')) {
            // Return value based on the bound key parameter
            const key = String(params[0] ?? '');
            if (key === 'follow_up_valid_days') return { first: { value: '10' } };
            if (key === 'report_show_valid_days') return { first: { value: '20' } };
            return { first: null };
          }
          return null;
        },
      });

      const settings = await getValiditySettings(mockDB.db as any, 'tenant-1');
      expect(settings.follow_up_valid_days).toBe(10);
      expect(settings.report_show_valid_days).toBe(20);
    });
  });

  describe('Default constants', () => {
    it('DEFAULT_FOLLOW_UP_VALID_DAYS is 7', () => {
      expect(DEFAULT_FOLLOW_UP_VALID_DAYS).toBe(7);
    });

    it('DEFAULT_REPORT_SHOW_VALID_DAYS is 15', () => {
      expect(DEFAULT_REPORT_SHOW_VALID_DAYS).toBe(15);
    });
  });
});

// ─── API endpoint tests ──────────────────────────────────────────────────────

describe('Follow-up Validity API', () => {

  describe('GET /doctors/dashboard/validity-settings', () => {
    it('returns current validity settings with defaults', async () => {
      const mockDB = createMockDB({
        queryOverride(sql) {
          if (sql.toLowerCase().includes('from settings')) return { first: null };
          return null;
        },
      });

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/validity-settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.follow_up_valid_days).toBe(7);
      expect(body.report_show_valid_days).toBe(15);
    });

    it('returns stored settings when they exist', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const s = sql.toLowerCase();
          if (s.includes('from settings') && s.includes('key = ?')) {
            const key = String(params[0] ?? '');
            if (key === 'follow_up_valid_days') return { first: { value: '10' } };
            if (key === 'report_show_valid_days') return { first: { value: '20' } };
            return { first: null };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/validity-settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.follow_up_valid_days).toBe(10);
      expect(body.report_show_valid_days).toBe(20);
    });
  });

  describe('PUT /doctors/dashboard/validity-settings', () => {
    it('allows hospital_admin to update settings', async () => {
      const settingsStore = new Map<string, string>();
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const lower = sql.toLowerCase();
          if (lower.includes('from settings') && lower.includes('select')) {
            const key = params[0] as string;
            const val = settingsStore.get(key);
            return val ? { first: { value: val } } : { first: null };
          }
          if (lower.includes('insert into settings')) {
            const key = params[0] as string;
            const value = params[1] as string;
            settingsStore.set(key, value);
            return { success: true, meta: { last_row_id: 1 } };
          }
          if (lower.includes('update settings')) {
            const value = params[0] as string;
            const key = params[1] as string;
            settingsStore.set(key, value);
            return { success: true, meta: { changes: 1 } };
          }
          return null;
        },
      });

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/validity-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          follow_up_valid_days: 10,
          report_show_valid_days: 20,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.follow_up_valid_days).toBe(10);
      expect(body.report_show_valid_days).toBe(20);
    });

    it('rejects non-admin roles', async () => {
      const mockDB = createMockDB();

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/validity-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          follow_up_valid_days: 10,
          report_show_valid_days: 20,
        }),
      });

      expect(res.status).toBe(403);
    });

    it('rejects invalid values (too low)', async () => {
      const mockDB = createMockDB();

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/validity-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          follow_up_valid_days: 0,
          report_show_valid_days: 20,
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects invalid values (too high)', async () => {
      const mockDB = createMockDB();

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        mockDB,
      });

      const res = await app.request('/doctors/dashboard/validity-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          follow_up_valid_days: 10,
          report_show_valid_days: 100,
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Queue validity badge integration', () => {
    it('queue items include validity_badge field', async () => {
      const today = '2026-05-26';
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const s = sql.toLowerCase();
          // Doctor lookup
          if (s.includes('from doctors') && s.includes('user_id = ?')) {
            return {
              first: {
                id: 1, name: 'Dr. Test', specialty: 'General',
                department: null, qualifications: null, consultation_fee: 500,
              },
            };
          }
          // Settings
          if (s.includes('from settings')) return { first: null };
          // Enhanced queue query — return one follow_up appointment
          if (s.includes('from appointments') && s.includes('left join patients') && s.includes('appt_date = ?')) {
            return {
              results: [{
                id: 10,
                appointment_id: 10,
                patient_id: 1,
                token_no: 1,
                appt_time: '10:00',
                visit_type: 'opd',
                appointment_type: 'follow_up',
                appointment_status: 'checked_in',
                queue_status: 'waiting',
                queue_priority: null,
                queue_called_at: null,
                billing_status: 'paid',
                final_fee: 500,
                discount_amount: 0,
                created_by: null,
                created_by_name: null,
                chief_complaint: 'Follow-up checkup',
                notes: null,
                patient_name: 'Test Patient',
                patient_code: 'P001',
                patient_mobile: '017',
                patient_age: 30,
                date_of_birth: '1996-01-01',
                gender: 'male',
                visit_id: null,
                visit_status: null,
                queue_entry_id: null,
                allergy_count: 0,
                allergy_summary: null,
                vitals_count: 0,
                latest_vitals_summary: null,
                active_rx_count: 0,
                current_medicine_summary: null,
                lab_count: 0,
                pending_lab_count: 0,
                pending_imaging_count: 0,
                soap_count: 0,
                last_visit_at: '2026-05-01',  // Source visit is outside the 7-day follow-up window.
                last_diagnosis: null,
                latest_abnormal_lab_summary: null,
              }],
            };
          }
          // Fallback queue query
          if (s.includes('from appointments') && s.includes('a.appt_date = ?') && !s.includes('left join patients')) {
            return {
              results: [{
                id: 10,
                appointment_id: 10,
                patient_id: 1,
                token_no: 1,
                appt_time: '10:00',
                visit_type: 'opd',
                appointment_type: 'follow_up',
                appointment_status: 'checked_in',
                queue_status: 'waiting',
                billing_status: 'paid',
                chief_complaint: 'Follow-up',
                notes: null,
                final_fee: 500,
                discount_amount: 0,
                created_by: null,
                patient_name: 'Test Patient',
                patient_code: 'P001',
                patient_mobile: '017',
                patient_age: 30,
                date_of_birth: '1996-01-01',
                gender: 'male',
              }],
            };
          }
          // Yesterday count
          if (s.includes('count(*)') && s.includes('appt_date = ?')) {
            return { first: { cnt: 5 } };
          }
          // Visit types
          if (s.includes('visit_type') && s.includes('count(*)') && s.includes('group by')) {
            return { results: [] };
          }
          // Recent prescriptions
          if (s.includes('from prescriptions') && s.includes('order by') && s.includes('limit 5')) {
            return { results: [] };
          }
          // Follow-ups
          if (s.includes('follow_up_date')) {
            return { results: [] };
          }
          // Available doctors
          if (s.includes('from doctors') && s.includes('is_active = 1') && !s.includes('id = ?')) {
            return { results: [] };
          }
          // Pending lab orders
          if (s.includes('from lab_orders')) {
            return { results: [] };
          }
          // Pending imaging orders
          if (s.includes('from radiology_requisitions')) {
            return { results: [] };
          }
          // Inpatients
          if (s.includes('from admissions')) {
            return { results: [] };
          }
          // Website config
          if (s.includes('from website_config')) return { first: null };
          return null;
        },
      });

      const { app } = createTestApp({
        route: doctorRoutes,
        routePath: '/doctors',
        role: 'doctor',
        tenantId: 'tenant-1',
        userId: 1,
        mockDB,
      });

      const res = await app.request(`/doctors/dashboard?date=${today}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.queue).toBeDefined();
      expect(body.queue.length).toBeGreaterThan(0);
      expect(body.queue[0]).toHaveProperty('validity_badge');
      // A same-day queue token must not renew eligibility from an expired source visit.
      expect(body.queue[0].validity_badge).toBe('follow_up_expired');
    });
  });
});
