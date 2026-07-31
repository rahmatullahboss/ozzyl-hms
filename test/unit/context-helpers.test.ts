/**
 * Unit tests for context-helpers — Test the error/negative paths
 * (missing tenantId, userId, role) that are normally never hit.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireTenantId, requireUserId, requireRole, requireSpecificRole } from '../../src/lib/context-helpers';

describe('context-helpers', () => {
  it('requireTenantId — throws 403 when missing', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      const id = requireTenantId(c);
      return c.json({ id });
    });
    app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
    const r = await app.request('/');
    expect(r.status).toBe(403);
  });

  it('requireTenantId — returns tenantId when present', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('tenantId', 'test-t'); await next(); });
    app.get('/', (c) => {
      const id = requireTenantId(c);
      return c.json({ id });
    });
    const r = await app.request('/');
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.id).toBe('test-t');
  });

  it('requireUserId — throws 401 when missing', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      const id = requireUserId(c);
      return c.json({ id });
    });
    app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
    const r = await app.request('/');
    expect(r.status).toBe(401);
  });

  it('requireUserId — returns userId when present', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('userId', 'u1'); await next(); });
    app.get('/', (c) => {
      const id = requireUserId(c);
      return c.json({ id });
    });
    const r = await app.request('/');
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.id).toBe('u1');
  });

  it('requireRole — throws 401 when missing', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      const role = requireRole(c);
      return c.json({ role });
    });
    app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
    const r = await app.request('/');
    expect(r.status).toBe(401);
  });

  it('requireRole — returns role when present', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('role', 'doctor'); await next(); });
    app.get('/', (c) => {
      const role = requireRole(c);
      return c.json({ role });
    });
    const r = await app.request('/');
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.role).toBe('doctor');
  });

  it('requireSpecificRole — throws 403 when role mismatch', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('role', 'nurse'); await next(); });
    app.get('/', (c) => {
      const role = requireSpecificRole(c, 'doctor', 'director');
      return c.json({ role });
    });
    app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
    const r = await app.request('/');
    expect(r.status).toBe(403);
  });

  it('requireSpecificRole — allows matching role', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('role', 'director'); await next(); });
    app.get('/', (c) => {
      const role = requireSpecificRole(c, 'doctor', 'director');
      return c.json({ role });
    });
    const r = await app.request('/');
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.role).toBe('director');
  });

  it('requireSpecificRole — allows single role', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('role', 'doctor'); await next(); });
    app.get('/', (c) => {
      const role = requireSpecificRole(c, 'doctor');
      return c.json({ role });
    });
    const r = await app.request('/');
    expect(r.status).toBe(200);
  });
});
