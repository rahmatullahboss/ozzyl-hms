import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

/**
 * Tests for OT Rooms CRUD endpoints.
 *
 * Per docs/ot-blueptint.md §27.1, §28.2:
 * - GET    /api/ot/rooms          — list active rooms
 * - GET    /api/ot/rooms/:id      — get one room
 * - POST   /api/ot/rooms          — create room
 * - PUT    /api/ot/rooms/:id      — update room
 * - DELETE /api/ot/rooms/:id      — soft-delete (is_active=0)
 *
 * All write actions must be tenant-scoped and require an authenticated user.
 */

function makeRoomsApp(opts: {
  rows?: Record<string, unknown>[];
  insertedId?: number | null;
  updatedId?: number | null;
  deletedId?: number | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const rows = opts.rows ?? [
    { id: 1, tenant_id: 1, name: 'OT-1', room_code: 'R1', floor: '3F',
      room_type: 'general', status: 'available', cleaning_duration_minutes: 30,
      sterilization_duration_minutes: 45, is_active: 1 },
  ];
  return {
    calls,
    ...createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'hospital_admin',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.startsWith('insert into ot_rooms') || s.includes('insert into ot_rooms')) {
          return { first: { id: opts.insertedId ?? 42 }, results: [{ id: opts.insertedId ?? 42 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_rooms set is_active')) {
          if (opts.deletedId === null) return { first: null, results: [], success: true, meta: {} };
          return { first: { id: opts.deletedId ?? 1 }, results: [{ id: opts.deletedId ?? 1 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_rooms')) {
          if (opts.updatedId === null) return { first: null, results: [], success: true, meta: {} };
          return { first: { id: opts.updatedId ?? 1 }, results: [{ id: opts.updatedId ?? 1 }], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_rooms') && s.includes('and id = ?')) {
          return { first: rows[0] ?? null, results: rows[0] ? [rows[0]] : [], success: true, meta: {} };
        }
        if (s.startsWith('select') && s.includes('from ot_rooms')) {
          return { first: null, results: rows, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/rooms', () => {
  it('returns 200 with active rooms for the tenant', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms');
    expect(res.status).toBe(200);
    const body = await res.json() as { rooms: Array<{ id: number; name: string }> };
    expect(body.rooms.length).toBe(1);
    expect(body.rooms[0].name).toBe('OT-1');
  });
});

describe('GET /api/ot/rooms/:id', () => {
  it('returns 200 with the room by id', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms/1');
    expect(res.status).toBe(200);
    const body = await res.json() as { room: { id: number; name: string } };
    expect(body.room.id).toBe(1);
  });

  it('returns 404 when the room does not exist', async () => {
    const { app } = makeRoomsApp({ rows: [] });
    const res = await jsonRequest(app, '/ot/rooms/999');
    expect(res.status).toBe(404);
  });

  it('rejects non-numeric id with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms/abc');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ot/rooms', () => {
  it('creates a room and returns 201 with the new id', async () => {
    const { app, calls } = makeRoomsApp({ insertedId: 99 });
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: {
        name: 'OT-2',
        room_code: 'R2',
        floor: '3F',
        room_type: 'cardiac',
        cleaning_duration_minutes: 45,
        sterilization_duration_minutes: 60,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(99);
    expect(body.success).toBe(true);
    const insert = calls.find(c => c.sql.toLowerCase().startsWith('insert into ot_rooms'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('OT-2');
  });

  it('rejects missing name with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: { room_type: 'general' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid room_type with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: { name: 'OT-3', room_type: 'moonbase' },
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/ot/rooms/:id', () => {
  it('updates a room and returns 200', async () => {
    const { app, calls } = makeRoomsApp({ updatedId: 1 });
    const res = await jsonRequest(app, '/ot/rooms/1', {
      method: 'PUT',
      body: { name: 'OT-1-renamed', status: 'maintenance' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const update = calls.find(c => c.sql.toLowerCase().startsWith('update ot_rooms') && !c.sql.toLowerCase().includes('is_active = 0'));
    expect(update).toBeDefined();
  });
});

describe('DELETE /api/ot/rooms/:id', () => {
  it('soft-deletes the room (is_active=0) and returns 200', async () => {
    const { app, calls } = makeRoomsApp({ deletedId: 1 });
    const res = await jsonRequest(app, '/ot/rooms/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const del = calls.find(c => c.sql.toLowerCase().includes('update ot_rooms set is_active = 0'));
    expect(del).toBeDefined();
    expect(del!.params).toContain(1);
    expect(del!.params).toContain('1');
  });

  it('rejects non-numeric id with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms/zzz', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('Rooms edge cases', () => {
  it('GET /rooms returns empty array when no rooms exist', async () => {
    const { app } = makeRoomsApp({ rows: [] });
    const res = await jsonRequest(app, '/ot/rooms');
    expect(res.status).toBe(200);
    const body = await res.json() as { rooms: unknown[] };
    expect(body.rooms).toEqual([]);
  });

  it('GET /rooms/:id returns 404 for non-existent room', async () => {
    const { app } = makeRoomsApp({ rows: [] });
    const res = await jsonRequest(app, '/ot/rooms/999');
    expect(res.status).toBe(404);
  });

  it('POST /rooms rejects empty name with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: { name: '' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /rooms rejects invalid room_type with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: { name: 'OT-X', room_type: 'moonbase' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /rooms rejects negative cleaning_duration_minutes with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: { name: 'OT-X', cleaning_duration_minutes: -5 },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /rooms/:id rejects empty body with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms/1', {
      method: 'PUT',
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('PUT /rooms/:id rejects invalid status with 400', async () => {
    const { app } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms/1', {
      method: 'PUT',
      body: { status: 'broken' },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /rooms/:id returns 404 when room not found', async () => {
    const { app } = makeRoomsApp({ updatedId: null });
    const res = await jsonRequest(app, '/ot/rooms/999', {
      method: 'PUT',
      body: { name: 'Updated' },
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /rooms/:id returns 404 when room not found', async () => {
    const { app } = makeRoomsApp({ deletedId: null });
    const res = await jsonRequest(app, '/ot/rooms/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('POST /rooms uses all provided fields in INSERT', async () => {
    const { app, calls } = makeRoomsApp({ insertedId: 50 });
    const res = await jsonRequest(app, '/ot/rooms', {
      method: 'POST',
      body: {
        name: 'OT-Cardiac',
        room_code: 'CARD-01',
        floor: '5F',
        room_type: 'cardiac',
        cleaning_duration_minutes: 60,
        sterilization_duration_minutes: 90,
      },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_rooms'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('OT-Cardiac');
    expect(insert!.params).toContain('CARD-01');
    expect(insert!.params).toContain('5F');
    expect(insert!.params).toContain('cardiac');
    expect(insert!.params).toContain(60);
    expect(insert!.params).toContain(90);
  });

  it('PUT /rooms/:id only updates provided fields', async () => {
    const { app, calls } = makeRoomsApp();
    const res = await jsonRequest(app, '/ot/rooms/1', {
      method: 'PUT',
      body: { status: 'cleaning' },
    });
    expect(res.status).toBe(200);
    const update = calls.find(c => c.sql.toLowerCase().startsWith('update ot_rooms') && !c.sql.toLowerCase().includes('is_active = 0'));
    expect(update).toBeDefined();
    // Should contain status but not name
    expect(update!.params).toContain('cleaning');
    expect(update!.params).not.toContain('OT-1');
  });
});
