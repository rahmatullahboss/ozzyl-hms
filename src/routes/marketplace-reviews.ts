import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId, requireUserId } from '../lib/context-helpers';
import { requireRole } from '../middleware/rbac';
import {
  ReviewModerationValidationError,
  listProviderReviewModerationEvents,
  moderateProviderReview,
  postProviderReviewReply,
  type ReviewModerationResult,
  type ReviewRejectionReason,
} from '../services/marketplace/reviewModeration';
import type { Env, Variables } from '../types';

const reviewModRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

reviewModRoutes.use('*', requireRole('hospital_admin'));

function positiveReviewId(value: string): number {
  const reviewId = Number(value);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
    throw new HTTPException(400, { message: 'Review ID must be a positive integer' });
  }
  return reviewId;
}

function actorIdFromContext(value: string): number {
  const actorId = Number(value);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    throw new HTTPException(400, { message: 'Authenticated user ID is invalid' });
  }
  return actorId;
}

function throwModerationResult(result: Exclude<ReviewModerationResult, 'updated'>): never {
  if (result === 'not_found') {
    throw new HTTPException(404, { message: 'Review not found' });
  }
  throw new HTTPException(409, { message: 'Review was already moderated' });
}

async function withValidationMapping<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ReviewModerationValidationError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
}

async function readOptionalJson<T>(request: { text(): Promise<string> }): Promise<Partial<T>> {
  const raw = await request.text();
  if (!raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object');
    }
    return parsed as Partial<T>;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }
}

// GET /api/v1/marketplace/reviews/pending — List pending reviews for this hospital
reviewModRoutes.get('/pending', async (c) => {
  const tenantId = String(requireTenantId(c));
  const { page = '1', limit = '20' } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  const { results } = await c.env.DB.prepare(`
    SELECT r.*,
      g.primary_name as reviewer_name,
      CASE WHEN r.target_doctor_id IS NOT NULL THEN d.name ELSE NULL END as doctor_name
    FROM provider_reviews r
    LEFT JOIN global_patient_identity g ON g.uhid = r.reviewer_global_patient_id
    LEFT JOIN doctors d ON d.id = r.target_doctor_id AND d.tenant_id = r.target_tenant_id
    WHERE r.target_tenant_id = ? AND r.is_approved = 0
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, Number(limit), offset).all();

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = 0`,
  ).bind(tenantId).first<{ total: number }>();

  return c.json({ data: results, pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 } });
});

// GET /api/v1/marketplace/reviews/all — List all reviews for this hospital
reviewModRoutes.get('/all', async (c) => {
  const tenantId = String(requireTenantId(c));
  const { page = '1', limit = '20', status } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT r.*,
      g.primary_name as reviewer_name,
      CASE WHEN r.target_doctor_id IS NOT NULL THEN d.name ELSE NULL END as doctor_name
    FROM provider_reviews r
    LEFT JOIN global_patient_identity g ON g.uhid = r.reviewer_global_patient_id
    LEFT JOIN doctors d ON d.id = r.target_doctor_id AND d.tenant_id = r.target_tenant_id
    WHERE r.target_tenant_id = ?
  `;
  const binds: (string | number)[] = [tenantId];

  if (status === 'pending') {
    query += ` AND r.is_approved = 0`;
  } else if (status === 'approved') {
    query += ` AND r.is_approved = 1`;
  } else if (status === 'rejected') {
    query += ` AND r.is_approved = -1`;
  }

  query += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
  binds.push(Number(limit), offset);

  const { results } = await c.env.DB.prepare(query).bind(...binds).all();

  const countQuery = status === 'pending'
    ? `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = 0`
    : status === 'approved'
      ? `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = 1`
      : status === 'rejected'
        ? `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ? AND is_approved = -1`
        : `SELECT COUNT(*) as total FROM provider_reviews WHERE target_tenant_id = ?`;

  const countResult = await c.env.DB.prepare(countQuery).bind(tenantId).first<{ total: number }>();

  return c.json({ data: results, pagination: { page: Number(page), limit: Number(limit), total: countResult?.total ?? 0 } });
});

// GET /api/v1/marketplace/reviews/:id/moderation-events
reviewModRoutes.get('/:id/moderation-events', async (c) => {
  const tenantId = String(requireTenantId(c));
  const reviewId = positiveReviewId(c.req.param('id'));
  const events = await withValidationMapping(() => listProviderReviewModerationEvents({
    db: c.env.DB,
    tenantId,
    reviewId,
  }));

  if (!events) throw new HTTPException(404, { message: 'Review not found' });
  return c.json({ data: events });
});

// PUT /api/v1/marketplace/reviews/:id/approve
reviewModRoutes.put('/:id/approve', async (c) => {
  const tenantId = String(requireTenantId(c));
  const actorId = actorIdFromContext(String(requireUserId(c)));
  const reviewId = positiveReviewId(c.req.param('id'));
  const body = await readOptionalJson<{ note?: string }>(c.req);

  const result = await withValidationMapping(() => moderateProviderReview({
    db: c.env.DB,
    tenantId,
    reviewId,
    actorId,
    decision: 'approve',
    note: body.note,
  }));

  if (result !== 'updated') throwModerationResult(result);
  return c.json({ message: 'Review approved' });
});

// PUT /api/v1/marketplace/reviews/:id/reject
reviewModRoutes.put('/:id/reject', async (c) => {
  const tenantId = String(requireTenantId(c));
  const actorId = actorIdFromContext(String(requireUserId(c)));
  const reviewId = positiveReviewId(c.req.param('id'));
  const body = await readOptionalJson<{
    reasonCode?: ReviewRejectionReason;
    note?: string;
    reason?: string;
  }>(c.req);
  const legacyReason = typeof body.reason === 'string' ? body.reason.trim() : '';

  const result = await withValidationMapping(() => moderateProviderReview({
    db: c.env.DB,
    tenantId,
    reviewId,
    actorId,
    decision: 'reject',
    reasonCode: body.reasonCode ?? (legacyReason ? 'other' : undefined),
    note: body.note ?? (legacyReason || undefined),
  }));

  if (result !== 'updated') throwModerationResult(result);
  return c.json({ message: 'Review rejected' });
});

// POST /api/v1/marketplace/reviews/:id/reply
reviewModRoutes.post('/:id/reply', async (c) => {
  const tenantId = String(requireTenantId(c));
  const actorId = actorIdFromContext(String(requireUserId(c)));
  const reviewId = positiveReviewId(c.req.param('id'));
  const body = await readOptionalJson<{ reply_text?: string }>(c.req);

  const result = await withValidationMapping(() => postProviderReviewReply({
    db: c.env.DB,
    tenantId,
    reviewId,
    actorId,
    replyText: body.reply_text ?? '',
  }));

  if (result === 'not_found') throw new HTTPException(404, { message: 'Review not found' });
  return c.json({ message: 'Reply posted' });
});

export default reviewModRoutes;
