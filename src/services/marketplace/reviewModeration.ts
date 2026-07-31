import type { D1Database, D1Result } from '@cloudflare/workers-types';

export const REVIEW_REJECTION_REASONS = [
  'abusive_language',
  'personal_information',
  'spam',
  'irrelevant_content',
  'conflict_of_interest',
  'fraudulent_review',
  'other',
] as const;

export type ReviewRejectionReason = (typeof REVIEW_REJECTION_REASONS)[number];
export type ReviewModerationResult = 'updated' | 'not_found' | 'conflict';
export type ReviewReplyResult = 'updated' | 'not_found';

export interface ReviewModerationEvent {
  id: number;
  reviewId: number;
  eventType: 'approved' | 'rejected' | 'reply_posted';
  actorId: number;
  actorName: string | null;
  reasonCode: ReviewRejectionReason | null;
  note: string | null;
  oldState: -1 | 0 | 1;
  newState: -1 | 0 | 1;
  metadata: Record<string, unknown>;
  createdAtUtc: string;
}

interface ReviewStateRow {
  id: number;
  isApproved: -1 | 0 | 1;
}

interface ActorRow {
  id: number;
}

interface ReviewModerationEventRow {
  id: number;
  reviewId: number;
  eventType: ReviewModerationEvent['eventType'];
  actorId: number;
  actorName: string | null;
  reasonCode: ReviewRejectionReason | null;
  note: string | null;
  oldState: -1 | 0 | 1;
  newState: -1 | 0 | 1;
  metadataJson: string;
  createdAtUtc: string;
}

export class ReviewModerationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewModerationValidationError';
  }
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null || value === '') {
    throw new ReviewModerationValidationError(`${label} is required.`);
  }
  if (typeof value !== 'string') {
    throw new ReviewModerationValidationError(`${label} must be text.`);
  }
  const text = value.trim();
  if (!text) throw new ReviewModerationValidationError(`${label} is required.`);
  if (text.length > maxLength) {
    throw new ReviewModerationValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ReviewModerationValidationError(`${label} must be text.`);
  }
  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new ReviewModerationValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReviewModerationValidationError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function utcTimestamp(value?: string): string {
  const timestamp = requiredText(value ?? new Date().toISOString(), 'Current time', 40);
  if (!timestamp.endsWith('Z') || !Number.isFinite(Date.parse(timestamp))) {
    throw new ReviewModerationValidationError('Current time must be a valid UTC timestamp.');
  }
  return timestamp;
}

function normalizeReason(value: unknown): ReviewRejectionReason {
  if (!(REVIEW_REJECTION_REASONS as readonly unknown[]).includes(value)) {
    throw new ReviewModerationValidationError('Rejection reason is required.');
  }
  return value as ReviewRejectionReason;
}

function resultChanges(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

async function requireTenantActor(input: {
  db: D1Database;
  tenantId: string;
  actorId: number;
}): Promise<void> {
  const actor = await input.db.prepare(`
    SELECT id
    FROM users
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(input.actorId, input.tenantId).first<ActorRow>();
  if (!actor) {
    throw new ReviewModerationValidationError('Actor must belong to this tenant.');
  }
}

async function findTenantReview(input: {
  db: D1Database;
  tenantId: string;
  reviewId: number;
}): Promise<ReviewStateRow | null> {
  return input.db.prepare(`
    SELECT id, is_approved AS isApproved
    FROM provider_reviews
    WHERE id = ? AND target_tenant_id = ?
    LIMIT 1
  `).bind(input.reviewId, input.tenantId).first<ReviewStateRow>();
}

export async function moderateProviderReview(input: {
  db: D1Database;
  tenantId: string;
  reviewId: number;
  actorId: number;
  decision: 'approve' | 'reject';
  reasonCode?: ReviewRejectionReason;
  note?: string;
  nowUtc?: string;
}): Promise<ReviewModerationResult> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 200);
  const reviewId = positiveId(input.reviewId, 'Review ID');
  const actorId = positiveId(input.actorId, 'Actor ID');
  if (input.decision !== 'approve' && input.decision !== 'reject') {
    throw new ReviewModerationValidationError('Moderation decision is invalid.');
  }
  const note = optionalText(input.note, 'Moderation note', 2000);
  const now = utcTimestamp(input.nowUtc);
  const reasonCode = input.decision === 'reject'
    ? normalizeReason(input.reasonCode)
    : null;

  if (input.decision === 'approve' && input.reasonCode !== undefined) {
    throw new ReviewModerationValidationError('Approval cannot include a rejection reason.');
  }

  await requireTenantActor({ db: input.db, tenantId, actorId });
  const current = await findTenantReview({ db: input.db, tenantId, reviewId });
  if (!current) return 'not_found';
  if (current.isApproved !== 0) return 'conflict';

  const newState = input.decision === 'approve' ? 1 : -1;
  const eventType = input.decision === 'approve' ? 'approved' : 'rejected';
  const results = await input.db.batch([
    input.db.prepare(`
      UPDATE provider_reviews
      SET
        is_approved = ?,
        moderation_reason = ?,
        moderation_reason_code = ?,
        moderation_note = ?,
        moderated_by = ?,
        moderated_at = datetime(?),
        moderated_at_utc = ?,
        updated_at = datetime(?)
      WHERE id = ?
        AND target_tenant_id = ?
        AND is_approved = 0
    `).bind(
      newState,
      reasonCode,
      reasonCode,
      note,
      actorId,
      now,
      now,
      now,
      reviewId,
      tenantId,
    ),
    input.db.prepare(`
      INSERT INTO provider_review_moderation_events (
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
      )
      SELECT ?, id, ?, ?, ?, ?, 0, ?, '{}', ?
      FROM provider_reviews
      WHERE id = ?
        AND target_tenant_id = ?
        AND is_approved = ?
        AND moderated_by = ?
        AND moderated_at_utc = ?
        AND changes() = 1
      LIMIT 1
    `).bind(
      tenantId,
      eventType,
      actorId,
      reasonCode,
      note,
      newState,
      now,
      reviewId,
      tenantId,
      newState,
      actorId,
      now,
    ),
  ]);

  return resultChanges(results[0]) === 1 ? 'updated' : 'conflict';
}

export async function postProviderReviewReply(input: {
  db: D1Database;
  tenantId: string;
  reviewId: number;
  actorId: number;
  replyText: string;
  nowUtc?: string;
}): Promise<ReviewReplyResult> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 200);
  const reviewId = positiveId(input.reviewId, 'Review ID');
  const actorId = positiveId(input.actorId, 'Actor ID');
  const replyText = requiredText(input.replyText, 'Reply text', 4000);
  const now = utcTimestamp(input.nowUtc);

  await requireTenantActor({ db: input.db, tenantId, actorId });
  const current = await findTenantReview({ db: input.db, tenantId, reviewId });
  if (!current) return 'not_found';

  const metadataJson = JSON.stringify({ replyLength: replyText.length });
  const results = await input.db.batch([
    input.db.prepare(`
      UPDATE provider_reviews
      SET
        provider_reply = ?,
        provider_reply_by = ?,
        provider_reply_at = datetime(?),
        provider_reply_at_utc = ?,
        updated_at = datetime(?)
      WHERE id = ?
        AND target_tenant_id = ?
    `).bind(
      replyText,
      actorId,
      now,
      now,
      now,
      reviewId,
      tenantId,
    ),
    input.db.prepare(`
      INSERT INTO provider_review_moderation_events (
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
      )
      SELECT ?, id, 'reply_posted', ?, NULL, NULL, is_approved, is_approved, ?, ?
      FROM provider_reviews
      WHERE id = ?
        AND target_tenant_id = ?
        AND provider_reply_by = ?
        AND provider_reply_at_utc = ?
        AND changes() = 1
      LIMIT 1
    `).bind(
      tenantId,
      actorId,
      metadataJson,
      now,
      reviewId,
      tenantId,
      actorId,
      now,
    ),
  ]);

  return resultChanges(results[0]) === 1 ? 'updated' : 'not_found';
}

export async function listProviderReviewModerationEvents(input: {
  db: D1Database;
  tenantId: string;
  reviewId: number;
}): Promise<ReviewModerationEvent[] | null> {
  const tenantId = requiredText(input.tenantId, 'Tenant ID', 200);
  const reviewId = positiveId(input.reviewId, 'Review ID');
  const review = await findTenantReview({ db: input.db, tenantId, reviewId });
  if (!review) return null;

  const response = await input.db.prepare(`
    SELECT
      e.id AS id,
      e.review_id AS reviewId,
      e.event_type AS eventType,
      e.actor_id AS actorId,
      u.name AS actorName,
      e.reason_code AS reasonCode,
      e.note AS note,
      e.old_state AS oldState,
      e.new_state AS newState,
      e.metadata_json AS metadataJson,
      e.created_at_utc AS createdAtUtc
    FROM provider_review_moderation_events e
    LEFT JOIN users u
      ON u.id = e.actor_id
      AND u.tenant_id = e.tenant_id
    WHERE e.tenant_id = ?
      AND e.review_id = ?
    ORDER BY e.created_at_utc ASC, e.id ASC
  `).bind(tenantId, reviewId).all<ReviewModerationEventRow>();

  return (response.results ?? []).map((row) => ({
    id: Number(row.id),
    reviewId: Number(row.reviewId),
    eventType: row.eventType,
    actorId: Number(row.actorId),
    actorName: row.actorName ?? null,
    reasonCode: row.reasonCode ?? null,
    note: row.note ?? null,
    oldState: row.oldState,
    newState: row.newState,
    metadata: JSON.parse(row.metadataJson || '{}') as Record<string, unknown>,
    createdAtUtc: row.createdAtUtc,
  }));
}
