import { describe, expect, test } from 'vitest';
import { sign } from 'hono/jwt';
import notificationRoutes from '../src/routes/notifications';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const JWT_SECRET = 'test-secret-key-for-testing-only';

async function makePatientToken(patientId: number): Promise<string> {
  return sign({ userId: String(patientId), scope: 'global' }, JWT_SECRET);
}

function makeAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /device-notifications/register', () => {
  test('registers a device with auth', async () => {
    const mockDB = createMockDB({ tables: { user_devices: [] } });
    const { app } = createTestApp({ route: notificationRoutes, routePath: '/device-notifications', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/device-notifications/register', {
      method: 'POST',
      body: { device_id: 'dev_123', platform: 'android', push_token: 'fcm_token_abc' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('requires authentication', async () => {
    const mockDB = createMockDB({ tables: { user_devices: [] } });
    const { app } = createTestApp({ route: notificationRoutes, routePath: '/device-notifications', mockDB });

    const res = await jsonRequest(app, '/device-notifications/register', {
      method: 'POST',
      body: { device_id: 'dev_123', platform: 'android' },
    });

    expect(res.status).toBe(401);
  });

  test('validates platform enum', async () => {
    const mockDB = createMockDB({ tables: { user_devices: [] } });
    const { app } = createTestApp({ route: notificationRoutes, routePath: '/device-notifications', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/device-notifications/register', {
      method: 'POST',
      body: { device_id: 'dev_123', platform: 'windows' },
      headers: makeAuthHeaders(token),
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /device-notifications/devices', () => {
  test('returns devices for authenticated patient', async () => {
    const mockDB = createMockDB({
      tables: {
        user_devices: [
          { id: 1, patient_id: 1, device_id: 'dev_123', platform: 'android', push_token: 'fcm_abc', last_seen_at: '2026-04-16T10:00:00', created_at: '2026-04-16T10:00:00' },
        ],
      },
    });
    const { app } = createTestApp({ route: notificationRoutes, routePath: '/device-notifications', mockDB });

    const token = await makePatientToken(1);
    const res = await jsonRequest(app, '/device-notifications/devices', { headers: makeAuthHeaders(token) });

    expect(res.status).toBe(200);
    const body = await res.json() as { devices: any[] };
    expect(Array.isArray(body.devices)).toBe(true);
  });
});

describe('POST /device-notifications/send', () => {
  test('returns sent count with tokens', async () => {
    const mockDB = createMockDB({
      tables: {
        user_devices: [
          { patient_id: 1, push_token: 'fcm_token_123', platform: 'android' },
        ],
      },
    });
    const { app } = createTestApp({ route: notificationRoutes, routePath: '/device-notifications', mockDB });

    const res = await jsonRequest(app, '/device-notifications/send', {
      method: 'POST',
      body: {
        patient_id: 1,
        category: 'daily_checkin',
        title: 'Time to check in!',
        body: 'How are you feeling today?',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; sent: number };
    expect(body.success).toBe(true);
    expect(body.sent).toBeGreaterThanOrEqual(0);
  });

  test('validates category enum', async () => {
    const mockDB = createMockDB({ tables: { user_devices: [] } });
    const { app } = createTestApp({ route: notificationRoutes, routePath: '/device-notifications', mockDB });

    const res = await jsonRequest(app, '/device-notifications/send', {
      method: 'POST',
      body: {
        patient_id: 1,
        category: 'invalid_category',
        title: 'Test',
        body: 'Test body',
      },
    });

    expect(res.status).toBe(400);
  });
});
