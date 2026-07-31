/**
 * Tests for the admin-panel API client.
 *
 * Contract: since the JWT now lives in an httpOnly cookie, the api client
 * must NOT read it from localStorage and must NOT add an Authorization
 * header. The browser sends the cookie automatically when fetch is called
 * with credentials: 'include'.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('admin-panel api client — cookie auth', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset fetch mock between tests
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does NOT add an Authorization header derived from localStorage', async () => {
    // Plant a stale token in localStorage to prove the client ignores it
    localStorage.setItem('admin_token', 'stale-leaked-token');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: '1' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // Import after stubbing fetch so the module uses the mocked fetch
    const { api } = await import('../services/api');
    await api.users.list(1, 10);

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
  });

  it('forwards the request with credentials: include so the browser sends the cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ users: [], pagination: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('../services/api');
    await api.users.list(1, 10);

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe('include');
  });

  it('login() does NOT persist the JWT to localStorage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ user: { id: '1', email: 'a@b.c', name: 'A', role: 'super_admin' } }),
        {
          status: 200,
          headers: {
            'set-cookie': 'admin_token=jwt; Path=/; HttpOnly; SameSite=Strict',
            'content-type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('../services/api');
    await api.auth.login('admin@example.com', 'pw');

    expect(localStorage.getItem('admin_token')).toBeNull();
  });
});
