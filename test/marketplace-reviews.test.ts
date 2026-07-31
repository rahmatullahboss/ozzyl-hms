import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import marketplaceReviewRoutes from '../src/routes/marketplace-reviews';
import type { Env, Variables } from '../src/types';
import { createSqliteD1Harness, type SqliteD1Harness } from './helpers/sqlite-d1';

function createHarness(): SqliteD1Harness {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(readFileSync('migrations/0121_provider_reviews.sql', 'utf8'));
  harness.sqlite.exec(readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8'));
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL
    );

    INSERT INTO users (id, tenant_id, name) VALUES
      (7, 'tenant-a', 'Review Admin'),
      (8, 'tenant-a', 'Patient Experience Lead'),
      (20, 'tenant-b', 'Other Tenant Admin');

    INSERT INTO provider_reviews (
      id,
      reviewer_global_patient_id,
      target_type,
      target_tenant_id,
      rating,
      review_text,
      is_approved
    ) VALUES
      (1, 'patient-a', 'hospital', 'tenant-a', 5, 'Excellent doctor.', 0),
      (2, 'patient-b', 'hospital', 'tenant-a', 2, 'Needs review.', 0),
      (3, 'patient-c', 'hospital', 'tenant-b', 1, 'Other tenant review.', 0),
      (4, 'patient-d', 'hospital', 'tenant-a', 3, 'Reply requested.', -1);
  `);
  return harness;
}

function createApp(input: {
  harness: SqliteD1Harness;
  tenantId?: string;
  userId?: number;
  role?: string;
}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', input.tenantId ?? 'tenant-a');
    c.set('userId', String(input.userId ?? 7));
    c.set('role', input.role ?? 'hospital_admin');
    c.env = { DB: input.harness.db, ENVIRONMENT: 'test' } as Env;
    await next();
  });
  app.route('/api/v1/marketplace/reviews', marketplaceReviewRoutes);
  app.onError((error, c) => {
    const status = 'status' in error && typeof error.status === 'number' ? error.status : 500;
    return c.json({ error: error.message }, status as 400);
  });
  return app;
}

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Marketplace Reviews Contract', () => {
  describe('Review Response Shape', () => {
    it('should define valid review list response', () => {
      const response = {
        reviews: [
          {
            id: 1,
            rating: 5,
            review_text: 'Excellent doctor',
            is_verified_visit: 1,
            created_at: '2026-04-13T10:00:00',
            reviewer_name: 'Patient A',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      };

      expect(response.reviews).toHaveLength(1);
      expect(response.reviews[0].rating).toBe(5);
      expect(response.reviews[0].is_verified_visit).toBe(1);
    });
  });

  describe('Rating Aggregation', () => {
    it('should calculate correct average rating', () => {
      const ratings = [5, 4, 5, 3, 4];
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      expect(avg).toBe(4.2);
    });

    it('should handle single rating', () => {
      const ratings = [5];
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      expect(avg).toBe(5);
    });

    it('should return 0 for no ratings', () => {
      const ratings: number[] = [];
      const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      expect(avg).toBe(0);
    });
  });

  describe('Moderation States', () => {
    it('should have correct moderation states', () => {
      const states = { rejected: -1, pending: 0, approved: 1 };
      expect(states.rejected).toBe(-1);
      expect(states.pending).toBe(0);
      expect(states.approved).toBe(1);
    });
  });
});

describe('marketplace review moderation routes', () => {
  it('denies moderation access to authenticated non-admin tenant roles', async () => {
    const harness = createHarness();
    const app = createApp({ harness, role: 'accountant' });

    const response = await jsonRequest(app, '/api/v1/marketplace/reviews/1/approve', 'PUT');

    expect(response.status).toBe(403);
    expect(harness.sqlite.prepare(`SELECT is_approved FROM provider_reviews WHERE id = 1`).get()).toEqual({ is_approved: 0 });
    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM provider_review_moderation_events WHERE review_id = 1`).get()).toEqual({ count: 0 });
  });

  it('approves a pending review through the structured service and returns 409 on a stale second decision', async () => {
    const harness = createHarness();
    const app = createApp({ harness });

    const approved = await jsonRequest(app, '/api/v1/marketplace/reviews/1/approve', 'PUT', {
      note: 'Verified visit.',
    });
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toEqual({ message: 'Review approved' });

    const stale = await jsonRequest(app, '/api/v1/marketplace/reviews/1/reject', 'PUT', {
      reasonCode: 'spam',
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: 'Review was already moderated' });

    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM provider_review_moderation_events WHERE review_id = 1`).get()).toEqual({ count: 1 });
  });

  it('rejects malformed approval JSON without changing review state', async () => {
    const harness = createHarness();
    const app = createApp({ harness });

    const response = await app.request('/api/v1/marketplace/reviews/1/approve', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });

    expect(response.status).toBe(400);
    expect(harness.sqlite.prepare(`SELECT is_approved FROM provider_reviews WHERE id = 1`).get()).toEqual({ is_approved: 0 });
    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM provider_review_moderation_events WHERE review_id = 1`).get()).toEqual({ count: 0 });
  });

  it('requires a valid structured reason for rejection and validates route input', async () => {
    const harness = createHarness();
    const app = createApp({ harness, userId: 8 });

    const missingReason = await jsonRequest(app, '/api/v1/marketplace/reviews/2/reject', 'PUT', {
      note: 'No code supplied.',
    });
    expect(missingReason.status).toBe(400);
    await expect(missingReason.json()).resolves.toEqual({ error: 'Rejection reason is required.' });

    const invalidId = await jsonRequest(app, '/api/v1/marketplace/reviews/not-an-id/approve', 'PUT');
    expect(invalidId.status).toBe(400);

    const rejected = await jsonRequest(app, '/api/v1/marketplace/reviews/2/reject', 'PUT', {
      reasonCode: 'irrelevant_content',
      note: 'Not related to the visit.',
    });
    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toEqual({ message: 'Review rejected' });
  });

  it('maps the legacy free-text rejection payload to the structured other reason', async () => {
    const harness = createHarness();
    const app = createApp({ harness, userId: 8 });

    const response = await jsonRequest(app, '/api/v1/marketplace/reviews/2/reject', 'PUT', {
      reason: 'Duplicate review submitted by the same patient.',
    });

    expect(response.status).toBe(200);
    expect(harness.sqlite.prepare(`
      SELECT moderation_reason_code, moderation_note
      FROM provider_reviews
      WHERE id = 2
    `).get()).toEqual({
      moderation_reason_code: 'other',
      moderation_note: 'Duplicate review submitted by the same patient.',
    });
  });

  it('returns tenant-isolated moderation events with actor names', async () => {
    const harness = createHarness();
    const app = createApp({ harness });

    await jsonRequest(app, '/api/v1/marketplace/reviews/1/approve', 'PUT');

    const response = await jsonRequest(app, '/api/v1/marketplace/reviews/1/moderation-events', 'GET');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          reviewId: 1,
          eventType: 'approved',
          actorId: 7,
          actorName: 'Review Admin',
          oldState: 0,
          newState: 1,
        }),
      ],
    });

    const hidden = await jsonRequest(app, '/api/v1/marketplace/reviews/3/moderation-events', 'GET');
    expect(hidden.status).toBe(404);
  });

  it('posts provider replies through the audited service and includes reply events in the timeline', async () => {
    const harness = createHarness();
    const app = createApp({ harness, userId: 8 });

    const replied = await jsonRequest(app, '/api/v1/marketplace/reviews/4/reply', 'POST', {
      reply_text: 'We have reviewed this concern.',
    });
    expect(replied.status).toBe(200);
    await expect(replied.json()).resolves.toEqual({ message: 'Reply posted' });

    const response = await jsonRequest(app, '/api/v1/marketplace/reviews/4/moderation-events', 'GET');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          reviewId: 4,
          eventType: 'reply_posted',
          actorId: 8,
          actorName: 'Patient Experience Lead',
          oldState: -1,
          newState: -1,
        }),
      ],
    });
  });
});
