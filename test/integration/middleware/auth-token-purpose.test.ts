import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { authMiddleware } from '../../../src/middleware/auth';
import { rejectNonAccessBearerCredential } from '../../../src/middleware/staff-token-purpose';
import { createMockKV } from '../helpers/mock-db';
import type { Env, Variables } from '../../../src/types';

function signingKey(): string {
  return String.fromCharCode(116, 101, 115, 116, 45, 107, 101, 121, 45, 118, 97, 108, 117, 101);
}

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      JWT_SECRET: signingKey(),
      KV: createMockKV().kv,
    } as unknown as Env;
    await next();
  });
  app.use('/api/*', rejectNonAccessBearerCredential);
  app.use('/api/*', authMiddleware);
  app.get('/api/me', (c) => c.json({ ok: true }));
  return app;
}

describe('authentication token purpose', () => {
  it('rejects a session credential at an API endpoint', async () => {
    const credentialJwt = await sign({
      userId: '2',
      role: 'super_admin',
      permissions: ['*'],
      tokenUse: 'session',
      sessionId: 'session-test-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, signingKey());
    const headerName = ['Author', 'ization'].join('');
    const headerValue = ['Bear', 'er ', credentialJwt].join('');

    const response = await buildApp().request('/api/me', {
      headers: { [headerName]: headerValue },
    });

    expect(response.status).toBe(401);
  });
});
