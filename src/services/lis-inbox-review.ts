const LIS_INBOX_REVIEW_ROLES = new Set([
  'pathologist',
  'lab_supervisor',
  'hospital_admin',
  'md',
]);

export class LisInboxReviewError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LisInboxReviewError';
  }
}

export interface RejectStagedLisResultInput {
  tenantId: string | number;
  inboxId: number;
  expectedVersion: number;
  reviewerUserId: string | number;
  reviewerRole: string;
  reason: string;
}

export interface LisInboxRejectionResult {
  rejected: true;
  inboxId: number;
  nextVersion: number;
}

interface ReviewableInboxRow {
  id: number;
  disposition: string;
  state_version: number;
  staged_by: number | null;
}

function normalizeRole(role: string): string {
  return String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function positiveInteger(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LisInboxReviewError(`${label} must be a positive integer`, 'invalid_identifier', 400);
  }
  return parsed;
}

export function canFinalizeLisInboxReview(role: string): boolean {
  return LIS_INBOX_REVIEW_ROLES.has(normalizeRole(role));
}

export function canViewLisInbox(role: string): boolean {
  const normalized = normalizeRole(role);
  return canFinalizeLisInboxReview(normalized)
    || normalized === 'laboratory'
    || normalized === 'lab'
    || normalized === 'lab_tech';
}

export async function rejectStagedLisResult(
  db: D1Database,
  input: RejectStagedLisResultInput,
): Promise<LisInboxRejectionResult> {
  if (!canFinalizeLisInboxReview(input.reviewerRole)) {
    throw new LisInboxReviewError(
      'Only pathologists, laboratory supervisors, hospital administrators, or MDs can reject analyzer results',
      'review_forbidden',
      403,
    );
  }

  const inboxId = positiveInteger(input.inboxId, 'inboxId');
  const expectedVersion = positiveInteger(input.expectedVersion, 'expectedVersion');
  const reviewerUserId = positiveInteger(input.reviewerUserId, 'reviewerUserId');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new LisInboxReviewError(
      'Rejection reason must be between 5 and 500 characters',
      'invalid_rejection_reason',
      400,
    );
  }

  const row = await db.prepare(`
    SELECT id, disposition, state_version, staged_by
    FROM lis_analyzer_inbox
    WHERE id = ? AND tenant_id = ?
  `).bind(inboxId, input.tenantId).first<ReviewableInboxRow>();

  if (!row) {
    throw new LisInboxReviewError('Analyzer inbox result not found', 'inbox_not_found', 404);
  }
  if (Number(row.state_version) !== expectedVersion) {
    throw new LisInboxReviewError('Analyzer inbox result changed; refresh before reviewing', 'review_conflict', 409);
  }
  if (row.staged_by != null && Number(row.staged_by) === reviewerUserId) {
    throw new LisInboxReviewError(
      'The same user cannot stage and make the final rejection decision',
      'self_review_forbidden',
      409,
    );
  }
  if (row.disposition === 'accepted' || row.disposition === 'rejected') {
    throw new LisInboxReviewError('Analyzer inbox review is already closed', 'review_already_closed', 409);
  }

  const result = await db.prepare(`
    UPDATE lis_analyzer_inbox
    SET disposition = 'rejected',
        disposition_reason = ?,
        rejected_by = ?,
        rejected_at = CURRENT_TIMESTAMP,
        rejection_reason = ?,
        state_version = state_version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND tenant_id = ?
      AND state_version = ?
      AND disposition NOT IN ('accepted', 'rejected')
      AND (staged_by IS NULL OR staged_by <> ?)
  `).bind(
    reason,
    reviewerUserId,
    reason,
    inboxId,
    input.tenantId,
    expectedVersion,
    reviewerUserId,
  ).run();

  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new LisInboxReviewError(
      'Analyzer inbox result changed; refresh before reviewing',
      'review_conflict',
      409,
    );
  }

  return {
    rejected: true,
    inboxId,
    nextVersion: expectedVersion + 1,
  };
}
