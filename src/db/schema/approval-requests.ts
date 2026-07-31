import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const approvalRequests = sqliteTable('approval_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  type: text('type').notNull(), // canonical approval type, e.g. bill_edit, bill_cancel, discount, payment_void, cash_handover
  entityId: integer('entity_id').notNull(),
  entityNo: text('entity_no'),
  requestedBy: integer('requested_by').notNull(),
  requestData: text('request_data').notNull(), // JSON
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected'
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  reviewNotes: text('review_notes'),
  requiredApprovals: integer('required_approvals').notNull().default(2),
  approvalCount: integer('approval_count').notNull().default(0),
  approvalRevision: integer('approval_revision').notNull().default(1),
  firstApprovedAt: text('first_approved_at'),
  fullyApprovedAt: text('fully_approved_at'),
  executionStatus: text('execution_status').default('not_required'),
  executionAttempts: integer('execution_attempts').notNull().default(0),
  executionStartedAt: text('execution_started_at'),
  executionCompletedAt: text('execution_completed_at'),
  executionError: text('execution_error'),
  lockedBy: integer('locked_by'),
  lockedAt: text('locked_at'),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_approval_requests_tenant').on(table.tenantId),
  index('idx_approval_requests_tenant_type_status').on(table.tenantId, table.type, table.status),
  index('idx_approval_requests_entity').on(table.tenantId, table.type, table.entityId),
  index('idx_approval_requests_execution_status').on(table.tenantId, table.executionStatus, table.status),
  index('idx_approval_requests_progress').on(
    table.tenantId,
    table.status,
    table.approvalRevision,
    table.approvalCount,
    table.requiredApprovals,
  ),
  check('approval_requests_revision_check', sql`${table.approvalRevision} > 0`),
]);

export const approvalDecisions = sqliteTable('approval_decisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  approvalSource: text('approval_source').notNull().default('approval_requests'),
  approvalRequestId: integer('approval_request_id').notNull(),
  approvalRevision: integer('approval_revision').notNull().default(1),
  approverId: integer('approver_id').notNull(),
  approverRole: text('approver_role').notNull(),
  decision: text('decision').notNull().default('approve'),
  notes: text('notes'),
  supersededAt: text('superseded_at'),
  supersededByRevision: integer('superseded_by_revision'),
  supersededReason: text('superseded_reason'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  uniqueIndex('uq_approval_decisions_actor').on(
    table.tenantId,
    table.approvalSource,
    table.approvalRequestId,
    table.approvalRevision,
    table.approverId,
  ),
  index('idx_approval_decisions_request').on(
    table.tenantId,
    table.approvalSource,
    table.approvalRequestId,
    table.approvalRevision,
    table.createdAt,
  ),
  index('idx_approval_decisions_current').on(
    table.tenantId,
    table.approvalSource,
    table.approvalRequestId,
    table.approvalRevision,
    table.decision,
    table.supersededAt,
  ),
  check('approval_decisions_revision_check', sql`${table.approvalRevision} > 0`),
  check(
    'approval_decisions_supersession_check',
    sql`(
      ${table.supersededAt} IS NULL
      AND ${table.supersededByRevision} IS NULL
      AND ${table.supersededReason} IS NULL
    ) OR (
      ${table.supersededAt} IS NOT NULL
      AND ${table.supersededByRevision} IS NOT NULL
      AND ${table.supersededByRevision} > ${table.approvalRevision}
      AND length(trim(COALESCE(${table.supersededReason}, ''))) > 0
    )`,
  ),
]);

export const approvalEvents = sqliteTable('approval_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  approvalRequestId: integer('approval_request_id').notNull(),
  action: text('action').notNull(),
  actorId: integer('actor_id'),
  oldStatus: text('old_status'),
  newStatus: text('new_status'),
  notes: text('notes'),
  metadata: text('metadata'), // JSON
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_approval_events_tenant_request').on(table.tenantId, table.approvalRequestId),
  index('idx_approval_events_tenant_created').on(table.tenantId, table.createdAt),
]);
