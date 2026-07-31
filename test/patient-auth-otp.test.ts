import { describe, expect, test, vi } from 'vitest';
import patientAuthRoutes from '../src/routes/patient-auth';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── Mock OTP module ──────────────────────────────────────────────────────────
vi.mock('../src/lib/otp', () => ({
  sendOtp: vi.fn(async () => ({ success: true })),
  verifyOtp: vi.fn(async (_env: unknown, _phone: string, code: string) => {
    if (code === '123456') return { valid: true };
    return { valid: false, error: 'Incorrect OTP' };
  }),
  OtpSmsTemplates: {
    appointmentWithPortal: () => 'mock appointment sms',
    appointmentWithPortalEn: () => 'mock appointment sms en',
    otpVerification: () => 'mock otp sms',
  },
}));

vi.mock('../src/lib/sms', () => ({
  createSmsProvider: () => ({
    sendSMS: vi.fn(async () => ({ success: true, messageId: 'mock-sms-id' })),
  }),
}));

function findQuery(
  queries: Array<{ sql: string; params: unknown[]; method: string }>,
  pattern: string,
  method?: string,
) {
  return queries.find((query) =>
    query.sql.toLowerCase().includes(pattern.toLowerCase()) && (!method || query.method === method));
}

describe('Patient Auth OTP Endpoints', () => {
  describe('POST /patient-auth/send-otp', () => {
    test('sends OTP to valid phone', async () => {
      const mockDB = createMockDB({});
      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/send-otp', {
        method: 'POST',
        body: { phone: '01712345678', purpose: 'signup' },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { message: string; phone: string };
      expect(data.message).toContain('OTP sent');
      expect(data.phone).toBe('01712345678');
    });

    test('rejects invalid phone format', async () => {
      const mockDB = createMockDB({});
      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/send-otp', {
        method: 'POST',
        body: { phone: '12345', purpose: 'signup' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /patient-auth/verify-otp', () => {
    test('verifies correct OTP', async () => {
      const mockDB = createMockDB({});
      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/verify-otp', {
        method: 'POST',
        body: { phone: '01712345678', code: '123456' },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { verified: boolean };
      expect(data.verified).toBe(true);
    });

    test('rejects incorrect OTP', async () => {
      const mockDB = createMockDB({});
      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/verify-otp', {
        method: 'POST',
        body: { phone: '01712345678', code: '000000' },
      });

      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain('Incorrect OTP');
    });
  });

  describe('POST /patient-auth/register-with-otp', () => {
    test('registers new user with OTP verification', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          // No existing auth account
          if (normalized.includes('select id from global_patient_auth where phone = ?')) {
            return { first: null, success: true, meta: {} };
          }

          // No existing identity
          if (normalized.includes('from global_patient_identity') && normalized.includes('where primary_phone = ?')) {
            return { first: null, success: true, meta: {} };
          }

          // Insert auth account
          if (normalized.includes('insert into global_patient_auth')) {
            return { success: true, meta: { last_row_id: 42 } };
          }

          // Insert new identity
          if (normalized.includes('insert into global_patient_identity')) {
            return { success: true, meta: { last_row_id: 10 } };
          }

          // Update identity claim
          if (normalized.includes('update global_patient_identity')) {
            return { success: true, meta: {} };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/register-with-otp', {
        method: 'POST',
        body: {
          name: 'Rahim Uddin',
          phone: '01712345678',
          otp: '123456',
          password: 'Test1234',
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json() as { token: string; user: { id: number; autoLinked: boolean } };
      expect(data.token).toBeDefined();
      expect(data.user.id).toBe(42);
      expect(data.user.autoLinked).toBe(false); // No existing identity
    });

    test('auto-links to existing hospital patient on OTP verify', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          // No existing auth account
          if (normalized.includes('select id from global_patient_auth where phone = ?')) {
            return { first: null, success: true, meta: {} };
          }

          // Existing identity found (hospital patient)
          if (normalized.includes('from global_patient_identity') && normalized.includes('where primary_phone = ?')) {
            return {
              first: {
                id: 7,
                uhid: 'OZ-000123',
                primary_name: 'Rahim Uddin',
                primary_phone: '01712345678',
                national_id: null,
                claim_status: 'unclaimed',
                claimed_auth_user_id: null,
              },
              success: true,
              meta: {},
            };
          }

          // Insert auth account
          if (normalized.includes('insert into global_patient_auth')) {
            return { success: true, meta: { last_row_id: 42 } };
          }

          // Update identity claim
          if (normalized.includes('update global_patient_identity') && normalized.includes('set')) {
            return { success: true, meta: {} };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/register-with-otp', {
        method: 'POST',
        body: {
          name: 'Rahim Uddin',
          phone: '01712345678',
          otp: '123456',
          password: 'Test1234',
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json() as { user: { autoLinked: boolean; uhid: string } };
      expect(data.user.autoLinked).toBe(true);
      expect(data.user.uhid).toBe('OZ-000123');

      // Verify identity was claimed
      const claimQuery = findQuery(mockDB.queries, 'update global_patient_identity', 'run');
      expect(claimQuery).toBeDefined();
    });

    test('rejects if phone already has portal account', async () => {
      const mockDB = createMockDB({
        queryOverride(sql) {
          const normalized = sql.toLowerCase();

          // Existing auth account found
          if (normalized.includes('select id from global_patient_auth where phone = ?')) {
            return { first: { id: 99 }, success: true, meta: {} };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/register-with-otp', {
        method: 'POST',
        body: {
          name: 'Rahim Uddin',
          phone: '01712345678',
          otp: '123456',
          password: 'Test1234',
        },
      });

      expect(res.status).toBe(409);
    });

    test('rejects incorrect OTP', async () => {
      const mockDB = createMockDB({});
      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/register-with-otp', {
        method: 'POST',
        body: {
          name: 'Rahim Uddin',
          phone: '01712345678',
          otp: '000000', // Wrong OTP
          password: 'Test1234',
        },
      });

      expect(res.status).toBe(400);
    });

    test('rejects weak password', async () => {
      const mockDB = createMockDB({});
      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/register-with-otp', {
        method: 'POST',
        body: {
          name: 'Rahim Uddin',
          phone: '01712345678',
          otp: '123456',
          password: 'weak', // Too short, no number
        },
      });

      expect(res.status).toBe(400);
    });

    test('does not auto-link if identity already claimed by another user', async () => {
      const mockDB = createMockDB({
        queryOverride(sql) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('select id from global_patient_auth where phone = ?')) {
            return { first: null, success: true, meta: {} };
          }

          // Identity exists but already claimed
          if (normalized.includes('from global_patient_identity') && normalized.includes('where primary_phone = ?')) {
            return {
              first: {
                id: 7,
                uhid: 'OZ-000123',
                primary_name: 'Rahim Uddin',
                primary_phone: '01712345678',
                national_id: null,
                claim_status: 'claimed',
                claimed_auth_user_id: 99, // Someone else
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('insert into global_patient_auth')) {
            return { success: true, meta: { last_row_id: 42 } };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: patientAuthRoutes,
        routePath: '/patient-auth',
        mockDB,
      });

      const res = await jsonRequest(app, '/patient-auth/register-with-otp', {
        method: 'POST',
        body: {
          name: 'Rahim Uddin',
          phone: '01712345678',
          otp: '123456',
          password: 'Test1234',
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json() as { user: { autoLinked: boolean } };
      expect(data.user.autoLinked).toBe(false); // Should NOT auto-link
    });
  });
});
