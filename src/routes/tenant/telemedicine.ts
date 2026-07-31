import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { createTeleRoomSchema } from '../../schemas/clinical';

const ALLOWED_ROLES = ['doctor', 'md', 'hospital_admin', 'reception', 'nurse'];

/**
 * Telemedicine route — manages rooms via KV store.
 * This doesn't use a DB table; rooms are stored in KV with short TTL.
 * Video/audio uses Cloudflare Realtime SFU via environment bindings.
 */
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper: KV key for a room
const roomKey = (tenantId: string, roomId: string) => `tele:${tenantId}:room:${roomId}`;
const roomListKey = (tenantId: string) => `tele:${tenantId}:rooms`;

function getRealtimeCredentials(env: Env) {
  const appId = env.CF_REALTIME_APP_ID || env.CF_CALLS_APP_ID;
  const appSecret = env.CF_REALTIME_APP_SECRET || env.CF_CALLS_APP_SECRET;
  return appId && appSecret ? { appId, appSecret } : null;
}

interface TeleRoom {
  id: string;
  name: string;
  status: 'waiting' | 'in_progress' | 'ended';
  patientId?: number;
  doctorId?: number;
  patientName?: string;
  doctorName?: string;
  createdAt: string;
  sessionId?: string;
  participantSessionIds?: string[];
}

// ─── GET /api/telemedicine/rooms — list all active rooms ─────────────────────
app.get('/rooms', async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || !ALLOWED_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to list rooms' });
  }

  const listJson = await c.env.KV.get(roomListKey(tenantId));
  const roomIds: string[] = listJson ? JSON.parse(listJson) : [];

  const rooms: TeleRoom[] = [];
  for (const id of roomIds) {
    const data = await c.env.KV.get(roomKey(tenantId, id));
    if (data) rooms.push(JSON.parse(data));
  }

  return c.json({ rooms: rooms.filter(r => r.status !== 'ended') });
});

// ─── GET /api/telemedicine/rooms/:id — get single room ───────────────────────
app.get('/rooms/:id', async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || (!ALLOWED_ROLES.includes(role) && role !== 'patient')) {
    throw new HTTPException(403, { message: 'Not authorized to view room' });
  }

  const id = c.req.param('id');
  const data = await c.env.KV.get(roomKey(tenantId, id));
  if (!data) throw new HTTPException(404, { message: 'Room not found' });

  return c.json({ room: JSON.parse(data) });
});

// ─── POST /api/telemedicine/rooms — create room ──────────────────────────────
app.post('/rooms', zValidator('json', createTeleRoomSchema), async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || !ALLOWED_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to create room' });
  }

  const body = c.req.valid('json');

  const derivedName =
    body.name ||
    (body.doctorName || body.patientName
      ? `${body.doctorName || 'Doctor'} - ${body.patientName || 'Patient'}`
      : 'Telemedicine Room');

  const id = crypto.randomUUID();
  const room: TeleRoom = {
    id,
    name: derivedName,
    status: 'waiting',
    patientId: body.patientId,
    doctorId: body.doctorId,
    patientName: body.patientName,
    doctorName: body.doctorName,
    createdAt: new Date().toISOString(),
  };

  // Store room, TTL 4 hours
  await c.env.KV.put(roomKey(tenantId, id), JSON.stringify(room), { expirationTtl: 14400 });

  // Add to listing
  const listJson = await c.env.KV.get(roomListKey(tenantId));
  const list: string[] = listJson ? JSON.parse(listJson) : [];
  list.push(id);
  await c.env.KV.put(roomListKey(tenantId), JSON.stringify(list), { expirationTtl: 14400 });

  return c.json({ room }, 201);
});

// ─── POST /api/telemedicine/rooms/:id/join — join a room (get SFU session) ───
app.post('/rooms/:id/join', async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || (!ALLOWED_ROLES.includes(role) && role !== 'patient')) {
    throw new HTTPException(403, { message: 'Not authorized to join room' });
  }

  const id = c.req.param('id');
  const data = await c.env.KV.get(roomKey(tenantId, id));
  if (!data) throw new HTTPException(404, { message: 'Room not found' });

  const room: TeleRoom = JSON.parse(data);
  const realtime = getRealtimeCredentials(c.env);

  // If Cloudflare Realtime SFU is configured, create a session
  if (realtime) {
    try {
      const resp = await fetch(
        `https://rtc.live.cloudflare.com/v1/apps/${realtime.appId}/sessions/new`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${realtime.appSecret}`,
          },
        }
      );
      if (!resp.ok) {
        const errorBody = await resp.text();
        console.error('[telemedicine] realtime session create failed', {
          status: resp.status,
          body: errorBody,
        });
        throw new Error(`Realtime session create failed with ${resp.status}`);
      }
      const session = await resp.json() as { sessionId: string };
      room.sessionId = session.sessionId;
      room.status = 'in_progress';
      room.participantSessionIds = Array.from(new Set([...(room.participantSessionIds ?? []), session.sessionId]));
      await c.env.KV.put(roomKey(tenantId, id), JSON.stringify(room), { expirationTtl: 14400 });
      return c.json({ sessionId: session.sessionId, room });
    } catch (error) {
      console.error('[telemedicine] room join fallback', {
        roomId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      // fallback — return without SFU session
    }
  }

  // Fallback: return room without SFU
  room.status = 'in_progress';
  await c.env.KV.put(roomKey(tenantId, id), JSON.stringify(room), { expirationTtl: 14400 });
  return c.json({ sessionId: null, room, message: 'SFU not configured — video not available' });
});

// ─── POST /api/telemedicine/sessions/:sessionId/tracks — proxy to SFU ────────
app.post('/sessions/:sessionId/tracks', async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || (!ALLOWED_ROLES.includes(role) && role !== 'patient')) {
    throw new HTTPException(403, { message: 'Not authorized' });
  }

  const realtime = getRealtimeCredentials(c.env);
  if (!realtime) {
    throw new HTTPException(503, { message: 'Realtime SFU not configured' });
  }

  const sessionId = c.req.param('sessionId');

  // Limit opaque SFU payload size (256KB max)
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > 256 * 1024) {
    throw new HTTPException(413, { message: 'Payload too large' });
  }

  const body = await c.req.json(); // SFU track data is opaque — pass through raw

  const resp = await fetch(
    `https://rtc.live.cloudflare.com/v1/apps/${realtime.appId}/sessions/${sessionId}/tracks/new`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${realtime.appSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const errorBody = await resp.text();
    console.error('[telemedicine] track publish failed', {
      sessionId,
      status: resp.status,
      body: errorBody,
    });
    throw new HTTPException(resp.status as 400 | 401 | 403 | 404 | 409 | 500, {
      message: 'Realtime track negotiation failed',
    });
  }

  const result = await resp.json();
  return c.json(result);
});

app.put('/sessions/:sessionId/renegotiate', async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || (!ALLOWED_ROLES.includes(role) && role !== 'patient')) {
    throw new HTTPException(403, { message: 'Not authorized' });
  }

  const realtime = getRealtimeCredentials(c.env);
  if (!realtime) {
    throw new HTTPException(503, { message: 'Realtime SFU not configured' });
  }

  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();

  const resp = await fetch(
    `https://rtc.live.cloudflare.com/v1/apps/${realtime.appId}/sessions/${sessionId}/renegotiate`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${realtime.appSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const errorBody = await resp.text();
    console.error('[telemedicine] renegotiate failed', {
      sessionId,
      status: resp.status,
      body: errorBody,
    });
  }

  const result = await resp.json();
  return c.json(result, resp.status as 200 | 400 | 401 | 403 | 404 | 409 | 500);
});

// ─── DELETE /api/telemedicine/rooms/:id — end room ───────────────────────────
app.delete('/rooms/:id', async (c) => {
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

  const role = c.get('role');
  if (!role || !ALLOWED_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to end room' });
  }

  const id = c.req.param('id');
  const data = await c.env.KV.get(roomKey(tenantId, id));
  if (data) {
    const room: TeleRoom = JSON.parse(data);
    room.status = 'ended';
    await c.env.KV.put(roomKey(tenantId, id), JSON.stringify(room), { expirationTtl: 300 });
  }

  // Remove from listing
  const listJson = await c.env.KV.get(roomListKey(tenantId));
  if (listJson) {
    const list: string[] = JSON.parse(listJson);
    await c.env.KV.put(roomListKey(tenantId), JSON.stringify(list.filter(r => r !== id)), { expirationTtl: 14400 });
  }

  return c.json({ success: true });
});

export default app;
