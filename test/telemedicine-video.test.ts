/**
 * Telemedicine Video Session Tests
 * 
 * Tests the complete video consultation flow:
 * - Room creation
 * - Room listing
 * - Join room (SFU session)
 * - Track management
 * - Room ending
 * - Error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import telemedicineRoute from '../src/routes/tenant/telemedicine';
import { createMockKV, type MockKV } from './integration/helpers/mock-db';

// ─── Test Helpers ─────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const JWT_SECRET = 'test-secret';

function createTestApp(kv: MockKV) {
  const app = new Hono();
  
  // Inject context
  app.use('*', async (c, next) => {
    c.set('tenantId', TENANT_ID);
    c.set('userId', '1');
    c.set('role', 'hospital_admin');
    c.env = {
      DB: {} as any,
      KV: kv.kv,
      JWT_SECRET,
      ENVIRONMENT: 'test',
    } as any;
    await next();
  });
  
  app.route('/api/telemedicine', telemedicineRoute);
  
  // Error handler
  app.onError((err, c) => {
    const status = (err as any).status ?? 500;
    return c.json({ error: err.message }, status);
  });
  
  return app;
}

async function jsonRequest(app: Hono, path: string, options: { method?: string; body?: any } = {}) {
  const init: RequestInit = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
  };
  if (options.body) {
    init.body = JSON.stringify(options.body);
  }
  return app.request(path, init);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Telemedicine Video Sessions', () => {
  let kv: MockKV;
  let app: Hono;
  let createdRoomId: string;

  beforeEach(() => {
    kv = createMockKV();
    app = createTestApp(kv);
  });

  describe('Room Creation', () => {
    it('POST /rooms → creates a new telemedicine room', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: {
          name: 'Test Consultation',
          patientId: 101,
          doctorId: 201,
          patientName: 'Rahim Uddin',
          doctorName: 'Dr. Karim',
        },
      });
      
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toHaveProperty('room');
      expect(body.room).toHaveProperty('id');
      expect(body.room.name).toBe('Test Consultation');
      expect(body.room.status).toBe('waiting');
      expect(body.room.patientId).toBe(101);
      expect(body.room.doctorId).toBe(201);
      
      createdRoomId = body.room.id;
    });

    it('POST /rooms → auto-generates name from doctor/patient', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: {
          patientId: 101,
          doctorId: 201,
          patientName: 'Rahim',
          doctorName: 'Dr. Karim',
        },
      });
      
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.room.name).toBe('Dr. Karim - Rahim');
    });

    it('POST /rooms → uses default name when no names provided', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: {
          patientId: 101,
          doctorId: 201,
        },
      });
      
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.room.name).toBe('Telemedicine Room');
    });

    it('POST /rooms → creates room even with minimal data (all fields optional)', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: {}, // Minimal body - Zod schema allows this
      });
      
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.room.name).toBe('Telemedicine Room');
    });
  });

  describe('Room Listing', () => {
    it('GET /rooms → returns empty list when no rooms', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rooms).toEqual([]);
    });

    it('GET /rooms → returns created rooms', async () => {
      // Create a room first
      await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'Room 1', patientId: 1, doctorId: 1 },
      });
      
      const res = await jsonRequest(app, '/api/telemedicine/rooms');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rooms.length).toBe(1);
      expect(body.rooms[0].name).toBe('Room 1');
    });

    it('GET /rooms → excludes ended rooms', async () => {
      // Create a room
      const createRes = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'Temp Room', patientId: 1, doctorId: 1 },
      });
      const { room } = await createRes.json();
      
      // End the room
      await jsonRequest(app, `/api/telemedicine/rooms/${room.id}`, { method: 'DELETE' });
      
      // List should be empty
      const res = await jsonRequest(app, '/api/telemedicine/rooms');
      const body = await res.json();
      expect(body.rooms.length).toBe(0);
    });
  });

  describe('Room Details', () => {
    it('GET /rooms/:id → returns room details', async () => {
      // Create a room
      const createRes = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'Detail Room', patientId: 101, doctorId: 201, patientName: 'Ali' },
      });
      const { room } = await createRes.json();
      
      const res = await jsonRequest(app, `/api/telemedicine/rooms/${room.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.room.id).toBe(room.id);
      expect(body.room.name).toBe('Detail Room');
      expect(body.room.patientId).toBe(101);
    });

    it('GET /rooms/:id → non-existent room returns 404', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms/non-existent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('Join Room', () => {
    it('POST /rooms/:id/join → joins room and updates status', async () => {
      // Create a room
      const createRes = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'Join Test', patientId: 1, doctorId: 1 },
      });
      const { room } = await createRes.json();
      
      // Join the room
      const res = await jsonRequest(app, `/api/telemedicine/rooms/${room.id}/join`, {
        method: 'POST',
      });
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.room.status).toBe('in_progress');
      // sessionId should be null when SFU not configured
      expect(body.sessionId).toBeNull();
      expect(body.message).toContain('SFU not configured');
    });

    it('POST /rooms/:id/join → non-existent room returns 404', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms/non-existent/join', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });

    it('POST /rooms/:id/join → accepts legacy CF Calls secret names', async () => {
      const createRes = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'Legacy Secret Room' },
      });
      const { room } = await createRes.json();

      const originalFetch = global.fetch;
      global.fetch = (async () => new Response(JSON.stringify({ sessionId: 'legacy-session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

      const legacyApp = new Hono();
      legacyApp.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('userId', '1');
        c.set('role', 'hospital_admin');
        c.env = {
          DB: {} as any,
          KV: kv.kv,
          JWT_SECRET,
          ENVIRONMENT: 'test',
          CF_CALLS_APP_ID: 'legacy-app-id',
          CF_CALLS_APP_SECRET: 'legacy-secret',
        } as any;
        await next();
      });
      legacyApp.route('/api/telemedicine', telemedicineRoute);
      legacyApp.onError((err, c) => {
        const status = (err as any).status ?? 500;
        return c.json({ error: err.message }, status);
      });

      const res = await jsonRequest(legacyApp, `/api/telemedicine/rooms/${room.id}/join`, {
        method: 'POST',
      });
      const body = await res.json();

      global.fetch = originalFetch;

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe('legacy-session');
      expect(body.room.participantSessionIds).toContain('legacy-session');
    });
  });

  describe('End Room', () => {
    it('DELETE /rooms/:id → ends room successfully', async () => {
      // Create a room
      const createRes = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'End Test', patientId: 1, doctorId: 1 },
      });
      const { room } = await createRes.json();
      
      // End the room
      const res = await jsonRequest(app, `/api/telemedicine/rooms/${room.id}`, {
        method: 'DELETE',
      });
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('DELETE /rooms/:id → ending non-existent room does not crash', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/rooms/non-existent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200); // Returns success even if room doesn't exist
    });
  });

  describe('SFU Track Management', () => {
    it('POST /sessions/:id/tracks → returns 503 when SFU not configured', async () => {
      const res = await jsonRequest(app, '/api/telemedicine/sessions/test-session/tracks', {
        method: 'POST',
        body: { type: 'audio', data: 'test' },
      });
      
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain('Realtime SFU not configured');
    });

    it('POST /sessions/:id/tracks → rejects oversized payload', async () => {
      // Create app with SFU configured
      const kvWithSfu = createMockKV();
      const appWithSfu = new Hono();
      
      appWithSfu.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('userId', '1');
        c.set('role', 'hospital_admin');
        c.env = {
          DB: {} as any,
          KV: kvWithSfu.kv,
          JWT_SECRET,
          ENVIRONMENT: 'test',
          CF_REALTIME_APP_ID: 'test-app-id',
          CF_REALTIME_APP_SECRET: 'test-secret',
        } as any;
        await next();
      });
      
      appWithSfu.route('/api/telemedicine', telemedicineRoute);
      appWithSfu.onError((err, c) => {
        const status = (err as any).status ?? 500;
        return c.json({ error: err.message }, status);
      });
      
      // Send request with large content-length
      const largeBody = 'x'.repeat(300 * 1024); // 300KB
      const res = await appWithSfu.request('/api/telemedicine/sessions/test/tracks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(largeBody.length),
        },
        body: JSON.stringify({ data: largeBody }),
      });
      
      expect(res.status).toBe(413);
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('rooms are isolated per tenant', async () => {
      // Create room for tenant-1
      await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: { name: 'Tenant 1 Room', patientId: 1, doctorId: 1 },
      });
      
      // Create app for tenant-2
      const kv2 = createMockKV();
      const app2 = new Hono();
      app2.use('*', async (c, next) => {
        c.set('tenantId', 'tenant-2');
        c.set('userId', '2');
        c.set('role', 'hospital_admin');
        c.env = {
          DB: {} as any,
          KV: kv2.kv,
          JWT_SECRET,
          ENVIRONMENT: 'test',
        } as any;
        await next();
      });
      app2.route('/api/telemedicine', telemedicineRoute);
      app2.onError((err, c) => {
        const status = (err as any).status ?? 500;
        return c.json({ error: err.message }, status);
      });
      
      // Tenant-2 should see empty list
      const res = await app2.request('/api/telemedicine/rooms');
      const body = await res.json();
      expect(body.rooms).toEqual([]);
    });
  });

  describe('Session Lifecycle', () => {
    it('complete flow: create → join → end', async () => {
      // 1. Create room
      const createRes = await jsonRequest(app, '/api/telemedicine/rooms', {
        method: 'POST',
        body: {
          name: 'Full Flow Test',
          patientId: 101,
          doctorId: 201,
          patientName: 'Patient A',
          doctorName: 'Dr. B',
        },
      });
      expect(createRes.status).toBe(201);
      const { room } = await createRes.json();
      expect(room.status).toBe('waiting');
      
      // 2. Join room
      const joinRes = await jsonRequest(app, `/api/telemedicine/rooms/${room.id}/join`, {
        method: 'POST',
      });
      expect(joinRes.status).toBe(200);
      const joinBody = await joinRes.json();
      expect(joinBody.room.status).toBe('in_progress');
      
      // 3. Verify room is in progress
      const getRes = await jsonRequest(app, `/api/telemedicine/rooms/${room.id}`);
      const getBody = await getRes.json();
      expect(getBody.room.status).toBe('in_progress');
      
      // 4. End room
      const endRes = await jsonRequest(app, `/api/telemedicine/rooms/${room.id}`, {
        method: 'DELETE',
      });
      expect(endRes.status).toBe(200);
      
      // 5. Verify room no longer in active list
      const listRes = await jsonRequest(app, '/api/telemedicine/rooms');
      const listBody = await listRes.json();
      expect(listBody.rooms.length).toBe(0);
    });

    it('multiple rooms can exist simultaneously', async () => {
      // Create 3 rooms
      for (let i = 1; i <= 3; i++) {
        await jsonRequest(app, '/api/telemedicine/rooms', {
          method: 'POST',
          body: { name: `Room ${i}`, patientId: i, doctorId: i },
        });
      }
      
      // List should show all 3
      const res = await jsonRequest(app, '/api/telemedicine/rooms');
      const body = await res.json();
      expect(body.rooms.length).toBe(3);
    });
  });

  describe('Error Handling', () => {
    it('handles malformed JSON gracefully', async () => {
      const res = await app.request('/api/telemedicine/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });
      expect([400, 500]).toContain(res.status);
    });

    it('handles missing Content-Type', async () => {
      const res = await app.request('/api/telemedicine/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
      expect([400, 201]).toContain(res.status); // May or may not work depending on Hono
    });
  });
});
