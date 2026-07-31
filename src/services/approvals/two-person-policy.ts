import type { D1Database, D1Result } from '@cloudflare/workers-types';

export const TWO_PERSON_APPROVER_ROLES = [
  'hospital_admin',
  'md',
  'director',
  'ceo',
] as const;

export type TwoPersonApproverRole = (typeof TWO_PERSON_APPROVER_ROLES)[number];
export type ApprovalLifecycleStatus = 'pending' | 'partially_approved' | 'approved' | 'rejected' | string;

export type ApprovalPolicyErrorCode =
  | 'UNAUTHORIZED_APPROVER'
  | 'APPROVAL_NOT_FOUND'
  | 'SELF_APPROVAL_BLOCKED'
  | 'DUPLICATE_APPROVER'
  | 'APPROVAL_TERMINAL';

export class ApprovalPolicyError extends Error {
  readonly code: ApprovalPolicyErrorCode;

  constructor(code: ApprovalPolicyErrorCode, message: string) {
    super(message);
    this.name = 'ApprovalPolicyError';
    this.code = code;
  }
}

export interface ApprovalStage {
  status: ApprovalLifecycleStatus;
  approvalCount: number;
  requiredApprovals: number;
  remainingApprovals: number;
  label: string;
  isFullyApproved: boolean;
}

export interface RecordApprovalDecisionInput {
  tenantId: string;
  approvalRequestId: number;
  actorId: number;
  actorRole: string;
  notes?: string | null;
  approvalSource?: string;
}

export interface ApprovalDecisionResult extends ApprovalStage {
  decisionId: number;
  approvalRevision: number;
  becameFullyApproved: boolean;
  alreadyApprovedByActor: false;
}

export interface RecordSourceApprovalDecisionInput {
  tenantId: string;
  approvalSource: string;
  approvalRequestId: number;
  requesterId: number;
  subjectStatus: ApprovalLifecycleStatus;
  actorId: number;
  actorRole: string;
  notes?: string | null;
  requiredApprovals?: number;
}

interface ApprovalRequestProgressRow {
  id: number;
  requested_by: number;
  status: string;
  approval_count: number | null;
  required_approvals: number | null;
  approval_revision: number | null;
}

export interface ReturnApprovalForCorrectionInput {
  tenantId: string;
  approvalRequestId: number;
  actorId: number;
  reason: string;
  missingItems?: string[];
  requestDataJson?: string | null;
  event?: {
    notes: string;
    metadataJson: string;
  };
}

export interface ReturnApprovalForCorrectionResult {
  previousRevision: number;
  approvalRevision: number;
  approvalCount: 0;
  requiredApprovals: number;
}

interface ApprovalDecisionRow {
  id: number;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function isTwoPersonApproverRole(role: string): role is TwoPersonApproverRole {
  return (TWO_PERSON_APPROVER_ROLES as readonly string[]).includes(String(role ?? '').trim().toLowerCase());
}

export function approvalStage(
  status: ApprovalLifecycleStatus,
  approvalCount: number,
  requiredApprovals: number,
): ApprovalStage {
  const required = positiveInt(requiredApprovals, 2);
  const normalizedStatus = String(status || 'pending');
  const recorded = nonNegativeInt(approvalCount);
  const effectiveCount = normalizedStatus === 'approved'
    ? Math.max(required, recorded)
    : Math.min(required, recorded);
  const remaining = Math.max(0, required - effectiveCount);
  const isFullyApproved = normalizedStatus === 'approved' || effectiveCount >= required;
  const label = isFullyApproved
    ? `Fully Approved (${effectiveCount}/${required})`
    : effectiveCount > 0 || normalizedStatus === 'partially_approved'
      ? `Partially Approved (${effectiveCount}/${required})`
      : `Pending (${effectiveCount}/${required})`;

  return {
    status: isFullyApproved ? 'approved' : effectiveCount > 0 ? 'partially_approved' : normalizedStatus,
    approvalCount: effectiveCount,
    requiredApprovals: required,
    remainingApprovals: remaining,
    label,
    isFullyApproved,
  };
}

async function readRequest(
  db: D1Database,
  tenantId: string,
  approvalRequestId: number,
): Promise<ApprovalRequestProgressRow | null> {
  return db.prepare(`
    SELECT id, requested_by, status, approval_count, required_approvals, approval_revision
    FROM approval_requests
    WHERE tenant_id = ? AND id = ?
  `).bind(tenantId, approvalRequestId).first<ApprovalRequestProgressRow>();
}

async function readActorDecision(
  db: D1Database,
  tenantId: string,
  approvalSource: string,
  approvalRequestId: number,
  approvalRevision: number,
  actorId: number,
): Promise<ApprovalDecisionRow | null> {
  return db.prepare(`
    SELECT id
    FROM approval_decisions
    WHERE tenant_id = ?
      AND approval_source = ?
      AND approval_request_id = ?
      AND approval_revision = ?
      AND approver_id = ?
      AND decision = 'approve'
      AND superseded_at IS NULL
  `).bind(
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  ).first<ApprovalDecisionRow>();
}

function assertRequestCanBeReviewed(
  request: ApprovalRequestProgressRow | null,
  actorId: number,
): asserts request is ApprovalRequestProgressRow {
  if (!request) {
    throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval request not found for this tenant.');
  }
  if (Number(request.requested_by) === actorId) {
    throw new ApprovalPolicyError('SELF_APPROVAL_BLOCKED', 'Requester cannot approve their own request.');
  }
  if (!['pending', 'partially_approved'].includes(String(request.status))) {
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval request is already terminal.');
  }
}

export async function recordApprovalDecision(
  db: D1Database,
  input: RecordApprovalDecisionInput,
): Promise<ApprovalDecisionResult> {
  const tenantId = String(input.tenantId ?? '').trim();
  const approvalRequestId = positiveInt(input.approvalRequestId, 0);
  const actorId = positiveInt(input.actorId, 0);
  const actorRole = String(input.actorRole ?? '').trim().toLowerCase();
  const approvalSource = String(input.approvalSource ?? 'approval_requests').trim() || 'approval_requests';

  if (!tenantId || approvalRequestId <= 0 || actorId <= 0) {
    throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval request identity is invalid.');
  }
  if (!isTwoPersonApproverRole(actorRole)) {
    throw new ApprovalPolicyError('UNAUTHORIZED_APPROVER', 'This role cannot approve controlled requests.');
  }

  const before = await readRequest(db, tenantId, approvalRequestId);
  assertRequestCanBeReviewed(before, actorId);
  const approvalRevision = positiveInt(before.approval_revision, 1);
  if (await readActorDecision(
    db,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  )) {
    throw new ApprovalPolicyError('DUPLICATE_APPROVER', 'This user has already approved the request.');
  }

  const insertDecision = db.prepare(`
    INSERT INTO approval_decisions (
      tenant_id, approval_source, approval_request_id, approval_revision,
      approver_id, approver_role, decision, notes
    )
    SELECT ?, ?, ?, ?, ?, ?, 'approve', ?
    WHERE EXISTS (
      SELECT 1
      FROM approval_requests
      WHERE tenant_id = ?
        AND id = ?
        AND requested_by <> ?
        AND approval_revision = ?
        AND status IN ('pending', 'partially_approved')
    )
      AND NOT EXISTS (
        SELECT 1
        FROM approval_decisions
        WHERE tenant_id = ?
          AND approval_source = ?
          AND approval_request_id = ?
          AND approval_revision = ?
          AND approver_id = ?
          AND superseded_at IS NULL
      )
  `).bind(
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
    actorRole,
    input.notes?.trim() || null,
    tenantId,
    approvalRequestId,
    actorId,
    approvalRevision,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  );

  const countSql = `(SELECT COUNT(*) FROM approval_decisions d
    WHERE d.tenant_id = approval_requests.tenant_id
      AND d.approval_source = ?
      AND d.approval_request_id = approval_requests.id
      AND d.approval_revision = approval_requests.approval_revision
      AND d.decision = 'approve'
      AND d.superseded_at IS NULL)`;
  const updateProgress = db.prepare(`
    UPDATE approval_requests
    SET approval_count = MIN(required_approvals, ${countSql}),
        status = CASE
          WHEN ${countSql} >= required_approvals THEN 'approved'
          ELSE 'pending'
        END,
        first_approved_at = CASE
          WHEN first_approved_at IS NULL AND ${countSql} > 0 THEN datetime('now', '+6 hours')
          ELSE first_approved_at
        END,
        fully_approved_at = CASE
          WHEN fully_approved_at IS NULL AND ${countSql} >= required_approvals THEN datetime('now', '+6 hours')
          ELSE fully_approved_at
        END
    WHERE tenant_id = ?
      AND id = ?
      AND approval_revision = ?
      AND status IN ('pending', 'partially_approved')
  `).bind(
    approvalSource,
    approvalSource,
    approvalSource,
    approvalSource,
    tenantId,
    approvalRequestId,
    approvalRevision,
  );

  const [insertResult] = await db.batch([insertDecision, updateProgress]) as Array<D1Result<Record<string, unknown>>>;
  const inserted = Number(insertResult.meta?.changes ?? 0) === 1;
  const after = await readRequest(db, tenantId, approvalRequestId);
  const actorDecision = await readActorDecision(
    db,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  );

  if (!inserted || !actorDecision) {
    if (actorDecision) {
      throw new ApprovalPolicyError('DUPLICATE_APPROVER', 'This user has already approved the request.');
    }
    if (!after) {
      throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval request not found for this tenant.');
    }
    if (Number(after.requested_by) === actorId) {
      throw new ApprovalPolicyError('SELF_APPROVAL_BLOCKED', 'Requester cannot approve their own request.');
    }
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval request was finalized by another reviewer.');
  }

  if (!after) {
    throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval request disappeared after approval.');
  }

  const stage = approvalStage(
    after.status,
    Number(after.approval_count ?? 0),
    Number(after.required_approvals ?? 2),
  );

  return {
    ...stage,
    decisionId: Number(actorDecision.id),
    approvalRevision,
    becameFullyApproved: inserted && stage.isFullyApproved,
    alreadyApprovedByActor: false,
  };
}

export async function returnApprovalForCorrection(
  db: D1Database,
  input: ReturnApprovalForCorrectionInput,
): Promise<ReturnApprovalForCorrectionResult> {
  const tenantId = String(input.tenantId ?? '').trim();
  const approvalRequestId = positiveInt(input.approvalRequestId, 0);
  const actorId = positiveInt(input.actorId, 0);
  const reason = String(input.reason ?? '').trim();

  if (!tenantId || approvalRequestId <= 0 || actorId <= 0) {
    throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval request identity is invalid.');
  }
  if (!reason) {
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Return reason is required.');
  }

  const before = await readRequest(db, tenantId, approvalRequestId);
  assertRequestCanBeReviewed(before, actorId);
  const previousRevision = positiveInt(before.approval_revision, 1);
  const approvalRevision = previousRevision + 1;
  const requiredApprovals = positiveInt(before.required_approvals, 2);

  const updateRequest = db.prepare(`
    UPDATE approval_requests
    SET approval_revision = ?,
        approval_count = 0,
        status = 'pending',
        first_approved_at = NULL,
        fully_approved_at = NULL,
        request_data = COALESCE(?, request_data)
    WHERE tenant_id = ?
      AND id = ?
      AND requested_by <> ?
      AND approval_revision = ?
      AND status IN ('pending', 'partially_approved')
  `).bind(
    approvalRevision,
    input.requestDataJson ?? null,
    tenantId,
    approvalRequestId,
    actorId,
    previousRevision,
  );

  const supersedeDecisions = db.prepare(`
    UPDATE approval_decisions
    SET superseded_at = datetime('now', '+6 hours'),
        superseded_by_revision = ?,
        superseded_reason = ?
    WHERE tenant_id = ?
      AND approval_source = 'approval_requests'
      AND approval_request_id = ?
      AND approval_revision = ?
      AND superseded_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM approval_requests
        WHERE tenant_id = ?
          AND id = ?
          AND approval_revision = ?
          AND status = 'pending'
          AND approval_count = 0
      )
  `).bind(
    approvalRevision,
    reason,
    tenantId,
    approvalRequestId,
    previousRevision,
    tenantId,
    approvalRequestId,
    approvalRevision,
  );

  const statements = [updateRequest, supersedeDecisions];
  if (input.event) {
    statements.push(db.prepare(`
      INSERT INTO approval_events (
        tenant_id,
        approval_request_id,
        action,
        actor_id,
        old_status,
        new_status,
        notes,
        metadata
      )
      SELECT ?, ?, 'request_info', ?, ?, 'pending', ?, ?
      WHERE EXISTS (
        SELECT 1
        FROM approval_requests
        WHERE tenant_id = ?
          AND id = ?
          AND approval_revision = ?
          AND status = 'pending'
          AND approval_count = 0
      )
    `).bind(
      tenantId,
      approvalRequestId,
      actorId,
      String(before.status),
      input.event.notes,
      input.event.metadataJson,
      tenantId,
      approvalRequestId,
      approvalRevision,
    ));
  }

  const [requestResult] = await db.batch(statements) as Array<D1Result<Record<string, unknown>>>;

  if (Number(requestResult.meta?.changes ?? 0) !== 1) {
    const current = await readRequest(db, tenantId, approvalRequestId);
    if (!current) {
      throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval request not found for this tenant.');
    }
    if (Number(current.requested_by) === actorId) {
      throw new ApprovalPolicyError('SELF_APPROVAL_BLOCKED', 'Requester cannot return their own request.');
    }
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval request changed before it could be returned.');
  }

  const after = await readRequest(db, tenantId, approvalRequestId);
  if (
    !after
    || positiveInt(after.approval_revision, 0) !== approvalRevision
    || nonNegativeInt(after.approval_count) !== 0
    || String(after.status) !== 'pending'
  ) {
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval revision reset could not be verified.');
  }

  return {
    previousRevision,
    approvalRevision,
    approvalCount: 0,
    requiredApprovals,
  };
}

export async function recordSourceApprovalDecision(
  db: D1Database,
  input: RecordSourceApprovalDecisionInput,
): Promise<ApprovalDecisionResult> {
  const tenantId = String(input.tenantId ?? '').trim();
  const approvalSource = String(input.approvalSource ?? '').trim();
  const approvalRequestId = positiveInt(input.approvalRequestId, 0);
  const requesterId = positiveInt(input.requesterId, 0);
  const actorId = positiveInt(input.actorId, 0);
  const actorRole = String(input.actorRole ?? '').trim().toLowerCase();
  const requiredApprovals = positiveInt(input.requiredApprovals, 2);
  const subjectStatus = String(input.subjectStatus ?? 'pending');

  if (!tenantId || !approvalSource || approvalSource === 'approval_requests' || approvalRequestId <= 0) {
    throw new ApprovalPolicyError('APPROVAL_NOT_FOUND', 'Approval subject identity is invalid.');
  }
  if (!isTwoPersonApproverRole(actorRole)) {
    throw new ApprovalPolicyError('UNAUTHORIZED_APPROVER', 'This role cannot approve controlled requests.');
  }
  if (requesterId > 0 && requesterId === actorId) {
    throw new ApprovalPolicyError('SELF_APPROVAL_BLOCKED', 'Requester cannot approve their own request.');
  }
  if (!['pending', 'partially_approved'].includes(subjectStatus)) {
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval subject is already terminal.');
  }

  const approvalRevision = 1;
  const existingActorDecision = await readActorDecision(
    db,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  );
  if (existingActorDecision) {
    throw new ApprovalPolicyError('DUPLICATE_APPROVER', 'This user has already approved the request.');
  }

  const insertResult = await db.prepare(`
    INSERT INTO approval_decisions (
      tenant_id, approval_source, approval_request_id, approval_revision,
      approver_id, approver_role, decision, notes
    )
    SELECT ?, ?, ?, ?, ?, ?, 'approve', ?
    WHERE (
      SELECT COUNT(*)
      FROM approval_decisions
      WHERE tenant_id = ?
        AND approval_source = ?
        AND approval_request_id = ?
        AND approval_revision = ?
        AND decision = 'approve'
        AND superseded_at IS NULL
    ) < ?
      AND NOT EXISTS (
        SELECT 1
        FROM approval_decisions
        WHERE tenant_id = ?
          AND approval_source = ?
          AND approval_request_id = ?
          AND approval_revision = ?
          AND approver_id = ?
          AND superseded_at IS NULL
      )
  `).bind(
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
    actorRole,
    input.notes?.trim() || null,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    requiredApprovals,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  ).run();

  const inserted = Number(insertResult.meta?.changes ?? 0) === 1;
  const actorDecision = await readActorDecision(
    db,
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
    actorId,
  );
  const countRow = await db.prepare(`
    SELECT COUNT(*) AS approval_count
    FROM approval_decisions
    WHERE tenant_id = ?
      AND approval_source = ?
      AND approval_request_id = ?
      AND approval_revision = ?
      AND decision = 'approve'
      AND superseded_at IS NULL
  `).bind(
    tenantId,
    approvalSource,
    approvalRequestId,
    approvalRevision,
  ).first<{ approval_count: number }>();
  const approvalCount = nonNegativeInt(countRow?.approval_count);

  if (!inserted || !actorDecision) {
    if (actorDecision) {
      throw new ApprovalPolicyError('DUPLICATE_APPROVER', 'This user has already approved the request.');
    }
    if (approvalCount >= requiredApprovals) {
      throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval request already has the required distinct approvals.');
    }
    throw new ApprovalPolicyError('APPROVAL_TERMINAL', 'Approval request was finalized by another reviewer.');
  }

  const stage = approvalStage(
    approvalCount >= requiredApprovals ? 'approved' : 'partially_approved',
    approvalCount,
    requiredApprovals,
  );

  return {
    ...stage,
    decisionId: Number(actorDecision.id),
    approvalRevision,
    becameFullyApproved: inserted && approvalCount === requiredApprovals,
    alreadyApprovedByActor: false,
  };
}
