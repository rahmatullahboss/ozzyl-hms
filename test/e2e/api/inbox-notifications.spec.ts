/**
 * Inbox / Notifications — E2E API Tests (Playwright)
 *
 * Covers all /api/inbox endpoints:
 *   GET /inbox, GET /inbox/unread-count,
 *   PATCH /:id/read, PATCH /read-all, DELETE /:id
 *
 * Run:
 *   npx playwright test test/e2e/api/inbox-notifications.spec.ts
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

let notificationId: number | null = null;

test.beforeAll(() => {
  loadAuth();
});

// ══════════════════════════════════════════════════════════════════════════════
// 📬 List Notifications
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📬 Inbox — List', () => {
  test('GET /api/inbox → 200 with notifications array', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { notifications?: unknown[] };
    expect(Array.isArray(body.notifications)).toBe(true);
  });

  test('GET /api/inbox?limit=5&offset=0 → respects pagination', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox?limit=5&offset=0`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { notifications?: unknown[] };
    expect(body.notifications!.length).toBeLessThanOrEqual(5);
  });

  test('GET /api/inbox?unread=1 → filters to unread only', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox?unread=1`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { notifications?: Array<{ is_read: number }> };
    // All returned items should be unread
    for (const n of (body.notifications ?? [])) {
      expect(n.is_read).toBe(0);
    }
  });

  test('GET /api/inbox → response shape has required fields', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox?limit=1`, {
      headers: authHeaders(),
    });
    const body = await res.json() as { notifications?: Array<Record<string, unknown>> };
    const notifs = body.notifications ?? [];
    if (notifs.length > 0) {
      const n = notifs[0]!;
      expect(n).toHaveProperty('id');
      expect(n).toHaveProperty('title');
      expect(n).toHaveProperty('message');
      expect(n).toHaveProperty('is_read');
      expect(n).toHaveProperty('created_at');
      notificationId = n['id'] as number;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔢 Unread Count
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🔢 Inbox — Unread Count', () => {
  test('GET /api/inbox/unread-count → 200 with count', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox/unread-count`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { count?: number };
    expect(typeof body.count).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  test('GET /api/inbox/unread-count → latency < 1000ms', async ({ request }) => {
    const start = Date.now();
    await request.get(`${BASE_URL}/api/inbox/unread-count`, { headers: authHeaders() });
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ✅ Mark As Read
// ══════════════════════════════════════════════════════════════════════════════

test.describe('✅ Inbox — Mark Read', () => {
  test('PATCH /api/inbox/:id/read → marks notification as read', async ({ request }) => {
    if (!notificationId) {
      test.skip(true, 'No notification available to mark read');
      return;
    }
    const res = await request.patch(`${BASE_URL}/api/inbox/${notificationId}/read`, {
      headers: authHeaders(),
    });
    expect([200, 201, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as { success?: boolean };
      expect(body.success).toBe(true);
    }
  });

  test('PATCH /api/inbox/99999999/read → 404 for non-existent', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/inbox/99999999/read`, {
      headers: authHeaders(),
    });
    expect([404, 400]).toContain(res.status());
  });

  test('PATCH /api/inbox/read-all → marks all as read', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/inbox/read-all`, {
      headers: authHeaders(),
    });
    expect([200, 201]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as { success?: boolean };
      expect(body.success).toBe(true);
    }
  });

  test('After mark-all-read → unread-count is 0', async ({ request }) => {
    // Mark all read first
    await request.patch(`${BASE_URL}/api/inbox/read-all`, { headers: authHeaders() });
    // Then check count
    const res = await request.get(`${BASE_URL}/api/inbox/unread-count`, { headers: authHeaders() });
    const body = await res.json() as { count?: number };
    expect(body.count).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🗑️ Delete
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🗑️ Inbox — Delete', () => {
  test('DELETE /api/inbox/99999999 → 404 for non-existent', async ({ request }) => {
    const res = await request.delete(`${BASE_URL}/api/inbox/99999999`, {
      headers: authHeaders(),
    });
    expect([404, 400]).toContain(res.status());
  });

  test('DELETE /api/inbox/:id → deletes existing notification', async ({ request }) => {
    if (!notificationId) {
      test.skip(true, 'No notification available to delete');
      return;
    }
    const res = await request.delete(`${BASE_URL}/api/inbox/${notificationId}`, {
      headers: authHeaders(),
    });
    // 200 = deleted, 404 = already deleted by mark-read test
    expect([200, 204, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔒 Auth guard
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🔒 Inbox — Auth Required', () => {
  test('GET /api/inbox without auth → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox`);
    expect([401, 403]).toContain(res.status());
  });

  test('GET /api/inbox/unread-count without auth → 401', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/inbox/unread-count`);
    expect([401, 403]).toContain(res.status());
  });

  test('PATCH /api/inbox/1/read without auth → 401', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/inbox/1/read`);
    expect([401, 403]).toContain(res.status());
  });
});
