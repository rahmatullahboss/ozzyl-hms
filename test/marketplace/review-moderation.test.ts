import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness, type SqliteD1Harness } from '../helpers/sqlite-d1';
import {
  ReviewModerationValidationError,
  listProviderReviewModerationEvents,
  moderateProviderReview,
  postProviderReviewReply,
} from '../../src/services/marketplace/reviewModeration';

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
      (1, 'patient-a', 'hospital', 'tenant-a', 5, 'Excellent care.', 0),
      (2, 'patient-b', 'hospital', 'tenant-a', 2, 'Already reviewed.', 1),
      (3, 'patient-c', 'hospital', 'tenant-b', 1, 'Other tenant review.', 0),
      (4, 'patient-d', 'hospital', 'tenant-a', 3, 'Reply requested.', -1);
  `);
  return harness;
}

function reviewRow(harness: SqliteD1Harness, reviewId: number): Record<string, unknown> {
  return harness.sqlite.prepare(`
    SELECT
      id,
      target_tenant_id,
      is_approved,
      moderation_reason,
      moderation_reason_code,
      moderation_note,
      moderated_by,
      moderated_at,
      moderated_at_utc,
      provider_reply,
      provider_reply_by,
      provider_reply_at,
      provider_reply_at_utc
    FROM provider_reviews
    WHERE id = ?
  `).get(reviewId) as Record<string, unknown>;
}

function eventRows(harness: SqliteD1Harness, reviewId: number): Array<Record<string, unknown>> {
  return harness.sqlite.prepare(`
    SELECT
      tenant_id,
      review_id,
      event_type,
      actor_id,
      reason_code,
      note,
      old_state,
      new_state,
      metadata_json,
      created_at_utc
    FROM provider_review_moderation_events
    WHERE review_id = ?
    ORDER BY id
  `).all(reviewId) as Array<Record<string, unknown>>;
}

describe('structured provider review moderation service', () => {
  it('approves one pending tenant review and appends an immutable event', async () => {
    const harness = createHarness();

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'approve',
      note: '  Verified against the visit record.  ',
      nowUtc: '2026-07-15T12:00:00.000Z',
    })).resolves.toBe('updated');

    expect(reviewRow(harness, 1)).toEqual(expect.objectContaining({
      is_approved: 1,
      moderation_reason: null,
      moderation_reason_code: null,
      moderation_note: 'Verified against the visit record.',
      moderated_by: 7,
      moderated_at_utc: '2026-07-15T12:00:00.000Z',
    }));
    expect(reviewRow(harness, 1).moderated_at).toBe('2026-07-15 12:00:00');
    expect(eventRows(harness, 1)).toEqual([
      expect.objectContaining({
        tenant_id: 'tenant-a',
        review_id: 1,
        event_type: 'approved',
        actor_id: 7,
        reason_code: null,
        note: 'Verified against the visit record.',
        old_state: 0,
        new_state: 1,
        metadata_json: '{}',
        created_at_utc: '2026-07-15T12:00:00.000Z',
      }),
    ]);
  });

  it('requires a structured rejection reason and preserves a trimmed optional note', async () => {
    const harness = createHarness();

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 8,
      decision: 'reject',
      note: 'Missing reason.',
    })).rejects.toBeInstanceOf(ReviewModerationValidationError);

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 8,
      decision: 'reject',
      reasonCode: 'personal_information',
      note: '  Contains a patient phone number.  ',
      nowUtc: '2026-07-15T12:05:00.000Z',
    })).resolves.toBe('updated');

    expect(reviewRow(harness, 1)).toEqual(expect.objectContaining({
      is_approved: -1,
      moderation_reason: 'personal_information',
      moderation_reason_code: 'personal_information',
      moderation_note: 'Contains a patient phone number.',
      moderated_by: 8,
      moderated_at_utc: '2026-07-15T12:05:00.000Z',
    }));
    expect(eventRows(harness, 1)).toEqual([
      expect.objectContaining({
        event_type: 'rejected',
        actor_id: 8,
        reason_code: 'personal_information',
        note: 'Contains a patient phone number.',
        old_state: 0,
        new_state: -1,
      }),
    ]);
  });

  it('rejects invalid reason codes and notes longer than the schema limit', async () => {
    const harness = createHarness();

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'reject',
      reasonCode: 'not-a-real-reason' as never,
    })).rejects.toBeInstanceOf(ReviewModerationValidationError);

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'approve',
      note: 'x'.repeat(2001),
    })).rejects.toBeInstanceOf(ReviewModerationValidationError);

    expect(reviewRow(harness, 1).is_approved).toBe(0);
    expect(eventRows(harness, 1)).toHaveLength(0);
  });

  it('rejects non-text fields and unsupported moderation decisions', async () => {
    await expect(moderateProviderReview({
      db: createHarness().db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'approve',
      note: { text: 'not-a-string' } as never,
    })).rejects.toBeInstanceOf(ReviewModerationValidationError);

    await expect(postProviderReviewReply({
      db: createHarness().db,
      tenantId: 'tenant-a',
      reviewId: 4,
      actorId: 8,
      replyText: ['not-a-string'] as never,
    })).rejects.toBeInstanceOf(ReviewModerationValidationError);

    await expect(moderateProviderReview({
      db: createHarness().db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'archive' as never,
    })).rejects.toBeInstanceOf(ReviewModerationValidationError);
  });

  it('returns conflict for an already-moderated review without appending another event', async () => {
    const harness = createHarness();

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 2,
      actorId: 7,
      decision: 'reject',
      reasonCode: 'spam',
    })).resolves.toBe('conflict');

    expect(reviewRow(harness, 2).is_approved).toBe(1);
    expect(eventRows(harness, 2)).toHaveLength(0);
  });

  it('hides reviews owned by another tenant and leaves them unchanged', async () => {
    const harness = createHarness();

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 3,
      actorId: 7,
      decision: 'approve',
    })).resolves.toBe('not_found');

    expect(reviewRow(harness, 3).is_approved).toBe(0);
    expect(eventRows(harness, 3)).toHaveLength(0);
  });

  it('rolls back the review decision when the audit event cannot be inserted', async () => {
    const harness = createHarness();
    harness.sqlite.exec(`
      CREATE TRIGGER fail_review_moderation_event
      BEFORE INSERT ON provider_review_moderation_events
      BEGIN
        SELECT RAISE(ABORT, 'event write failed');
      END;
    `);

    await expect(moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'approve',
      nowUtc: '2026-07-15T12:10:00.000Z',
    })).rejects.toThrow('event write failed');

    expect(reviewRow(harness, 1)).toEqual(expect.objectContaining({
      is_approved: 0,
      moderated_by: null,
      moderated_at_utc: null,
    }));
    expect(eventRows(harness, 1)).toHaveLength(0);
  });

  it('posts a tenant-scoped provider reply and records a state-preserving reply event', async () => {
    const harness = createHarness();

    await expect(postProviderReviewReply({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 4,
      actorId: 8,
      replyText: '  Thank you. We have reviewed your concern.  ',
      nowUtc: '2026-07-15T12:15:00.000Z',
    })).resolves.toBe('updated');

    expect(reviewRow(harness, 4)).toEqual(expect.objectContaining({
      is_approved: -1,
      provider_reply: 'Thank you. We have reviewed your concern.',
      provider_reply_by: 8,
      provider_reply_at: '2026-07-15 12:15:00',
      provider_reply_at_utc: '2026-07-15T12:15:00.000Z',
    }));
    expect(eventRows(harness, 4)).toEqual([
      expect.objectContaining({
        event_type: 'reply_posted',
        actor_id: 8,
        reason_code: null,
        note: null,
        old_state: -1,
        new_state: -1,
        metadata_json: JSON.stringify({ replyLength: 41 }),
      }),
    ]);
  });

  it('records the actual review state when moderation changes immediately before a reply batch', async () => {
    const harness = createHarness();
    harness.beforeBatch = () => {
      harness.beforeBatch = undefined;
      harness.sqlite.prepare(`UPDATE provider_reviews SET is_approved = 1 WHERE id = 4`).run();
    };

    await expect(postProviderReviewReply({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 4,
      actorId: 8,
      replyText: 'We have followed up.',
      nowUtc: '2026-07-15T12:18:00.000Z',
    })).resolves.toBe('updated');

    expect(eventRows(harness, 4)).toEqual([
      expect.objectContaining({
        event_type: 'reply_posted',
        old_state: 1,
        new_state: 1,
      }),
    ]);
  });

  it('lists tenant-isolated moderation history with actor names', async () => {
    const harness = createHarness();
    await moderateProviderReview({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
      actorId: 7,
      decision: 'approve',
      nowUtc: '2026-07-15T12:20:00.000Z',
    });

    await expect(listProviderReviewModerationEvents({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 1,
    })).resolves.toEqual([
      expect.objectContaining({
        id: expect.any(Number),
        reviewId: 1,
        eventType: 'approved',
        actorId: 7,
        actorName: 'Review Admin',
        oldState: 0,
        newState: 1,
        createdAtUtc: '2026-07-15T12:20:00.000Z',
      }),
    ]);

    await expect(listProviderReviewModerationEvents({
      db: harness.db,
      tenantId: 'tenant-a',
      reviewId: 3,
    })).resolves.toBeNull();
  });
});
