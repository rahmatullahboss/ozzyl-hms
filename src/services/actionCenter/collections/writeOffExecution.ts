import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import { applyReceivableAdjustment } from '../../billing/receivableAdjustment/authority';
import type {
  ReceivableAdjustmentResult,
} from '../../billing/receivableAdjustment/types';
import { getLiveReceivable } from './liveSource';
import type {
  CollectionStatus,
  ReceivableAuthorityMode,
  ReceivableSourceRef,
} from './types';
import {
  RECEIVABLE_WRITE_OFF_REASON_CODES,
  type ReceivableWriteOffReasonCode,
} from './writeOff';

interface ApprovalRow {
  id: number;
  entityId: number;
  entityNo: string | null;
  requestedBy: number;
  requestData: string;
  status: string;
  executionStatus: string | null;
  executionAttempts: number;
  lockedBy: number | null;
  approvalCount: number;
  requiredApprovals: number;
}

interface CollectionCaseRow {
  id: number;
  status: CollectionStatus;
  canonicalInvoicePublicId: string | null;
  legacyBillId: number | null;
}

interface PreviousCollectionState {
  status: CollectionStatus;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  currencyCode: string | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  updatedAtUtc: string | null;
}

interface StoredExecutionResult {
  schemaVersion: 1;
  adjustmentPublicId: string;
  legacyCreditNoteId?: number;
  canonicalCreditNotePublicId?: string;
  previousDueMinor: number;
  newDueMinor: number;
  appliedAmountMinor: number;
  currencyCode: string;
  authorityMode: ReceivableAuthorityMode;
  collectionStatus: CollectionStatus;
  executedBy: number;
  executedAtUtc: string;
}

interface WriteOffRequestData {
  schemaVersion: 1;
  source: ReceivableSourceRef;
  amountMinor: number;
  currencyCode: string;
  liveDueMinorAtRequest: number;
  authorityModeAtRequest: ReceivableAuthorityMode;
  reasonCode: ReceivableWriteOffReasonCode;
  note: string;
  evidenceUrls: string[];
  previousCollectionState: PreviousCollectionState;
  sourceEvidence: Record<string, unknown>;
  executionResult?: StoredExecutionResult;
}

export interface ExecuteReceivableWriteOffApprovalInput {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  approverId: number;
  reviewNotes: string;
}

export interface ExecuteReceivableWriteOffApprovalResult {
  adjustmentPublicId: string;
  newDueMinor: number;
  currencyCode: string;
  collectionStatus: CollectionStatus;
}

export interface RejectReceivableWriteOffApprovalInput {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  approverId: number;
  reviewNotes: string;
}

export class ReceivableWriteOffExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableWriteOffExecutionError';
  }
}

export class ReceivableWriteOffExecutionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableWriteOffExecutionConflictError';
  }
}

function exactText(value: string, label: string): string {
  if (!value.trim()) throw new ReceivableWriteOffExecutionError(`${label} is required.`);
  if (value.trim() !== value) {
    throw new ReceivableWriteOffExecutionError(`${label} cannot contain surrounding whitespace.`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReceivableWriteOffExecutionError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function reviewNotes(value: string): string {
  const notes = exactText(value, 'Review notes');
  if (notes.length < 10 || notes.length > 2000) {
    throw new ReceivableWriteOffExecutionError('Review notes must contain 10 to 2000 characters.');
  }
  return notes;
}

function parseSource(value: unknown): ReceivableSourceRef {
  if (!value || typeof value !== 'object') {
    throw new ReceivableWriteOffExecutionError('Write-off request source is missing.');
  }
  const raw = value as Record<string, unknown>;
  if (raw.sourceType !== 'invoice') {
    throw new ReceivableWriteOffExecutionError('Write-off request source must be an invoice.');
  }
  const legacyBillId = raw.legacyBillId === undefined
    ? undefined
    : positiveSafeInteger(Number(raw.legacyBillId), 'Legacy bill ID');
  const canonicalInvoicePublicId = raw.canonicalInvoicePublicId === undefined
    ? undefined
    : exactText(String(raw.canonicalInvoicePublicId), 'Canonical invoice public ID');
  if (legacyBillId === undefined && canonicalInvoicePublicId === undefined) {
    throw new ReceivableWriteOffExecutionError('Write-off request source identity is incomplete.');
  }
  return {
    sourceType: 'invoice',
    ...(legacyBillId !== undefined ? { legacyBillId } : {}),
    ...(canonicalInvoicePublicId !== undefined ? { canonicalInvoicePublicId } : {}),
  };
}

function collectionStatus(value: unknown, fallback: CollectionStatus): CollectionStatus {
  const status = String(value ?? '');
  if ([
    'new',
    'contact_due',
    'contacted',
    'promised',
    'disputed',
    'escalated',
    'write_off_requested',
    'closed',
  ].includes(status)) return status as CollectionStatus;
  return fallback;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function parsePreviousCollectionState(value: unknown): PreviousCollectionState {
  const raw = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  return {
    status: collectionStatus(raw.status, 'contact_due'),
    assignedTo: nullablePositiveInteger(raw.assignedTo),
    nextFollowupAtUtc: nullableText(raw.nextFollowupAtUtc),
    promiseDate: nullableText(raw.promiseDate),
    promiseAmountMinor: raw.promiseAmountMinor === null || raw.promiseAmountMinor === undefined
      ? null
      : Number.isSafeInteger(Number(raw.promiseAmountMinor)) && Number(raw.promiseAmountMinor) > 0
        ? Number(raw.promiseAmountMinor)
        : null,
    currencyCode: nullableText(raw.currencyCode),
    latestNote: nullableText(raw.latestNote),
    lastContactedAtUtc: nullableText(raw.lastContactedAtUtc),
    updatedAtUtc: nullableText(raw.updatedAtUtc),
  };
}

function parseStoredExecutionResult(value: unknown): StoredExecutionResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const mode = String(raw.authorityMode ?? '');
  const status = collectionStatus(raw.collectionStatus, 'contact_due');
  if (
    raw.schemaVersion !== 1
    || typeof raw.adjustmentPublicId !== 'string'
    || !raw.adjustmentPublicId.trim()
    || !Number.isSafeInteger(Number(raw.previousDueMinor))
    || !Number.isSafeInteger(Number(raw.newDueMinor))
    || !Number.isSafeInteger(Number(raw.appliedAmountMinor))
    || typeof raw.currencyCode !== 'string'
    || !['legacy', 'shadow', 'canonical'].includes(mode)
    || !Number.isSafeInteger(Number(raw.executedBy))
    || typeof raw.executedAtUtc !== 'string'
  ) return undefined;
  return {
    schemaVersion: 1,
    adjustmentPublicId: raw.adjustmentPublicId,
    ...(Number.isSafeInteger(Number(raw.legacyCreditNoteId)) && Number(raw.legacyCreditNoteId) > 0
      ? { legacyCreditNoteId: Number(raw.legacyCreditNoteId) }
      : {}),
    ...(typeof raw.canonicalCreditNotePublicId === 'string' && raw.canonicalCreditNotePublicId.trim()
      ? { canonicalCreditNotePublicId: raw.canonicalCreditNotePublicId }
      : {}),
    previousDueMinor: Number(raw.previousDueMinor),
    newDueMinor: Number(raw.newDueMinor),
    appliedAmountMinor: Number(raw.appliedAmountMinor),
    currencyCode: raw.currencyCode,
    authorityMode: mode as ReceivableAuthorityMode,
    collectionStatus: status,
    executedBy: Number(raw.executedBy),
    executedAtUtc: raw.executedAtUtc,
  };
}

function parseRequestData(value: string): WriteOffRequestData {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new ReceivableWriteOffExecutionError('Write-off request data is invalid.');
  }
  const reasonCode = String(raw.reasonCode ?? '');
  if (!RECEIVABLE_WRITE_OFF_REASON_CODES.includes(reasonCode as ReceivableWriteOffReasonCode)) {
    throw new ReceivableWriteOffExecutionError('Write-off request reason is invalid.');
  }
  const currencyCode = String(raw.currencyCode ?? '');
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new ReceivableWriteOffExecutionError('Write-off request currency is invalid.');
  }
  const mode = String(raw.authorityModeAtRequest ?? '');
  if (!['legacy', 'shadow', 'canonical'].includes(mode)) {
    throw new ReceivableWriteOffExecutionError('Write-off request authority evidence is invalid.');
  }
  if (raw.schemaVersion !== 1) {
    throw new ReceivableWriteOffExecutionError('Write-off request schema is not supported.');
  }
  return {
    schemaVersion: 1,
    source: parseSource(raw.source),
    amountMinor: positiveSafeInteger(Number(raw.amountMinor), 'Approved write-off amount'),
    currencyCode,
    liveDueMinorAtRequest: positiveSafeInteger(Number(raw.liveDueMinorAtRequest), 'Due at request'),
    authorityModeAtRequest: mode as ReceivableAuthorityMode,
    reasonCode: reasonCode as ReceivableWriteOffReasonCode,
    note: exactText(String(raw.note ?? ''), 'Write-off explanation'),
    evidenceUrls: Array.isArray(raw.evidenceUrls) ? raw.evidenceUrls.map(String) : [],
    previousCollectionState: parsePreviousCollectionState(raw.previousCollectionState),
    sourceEvidence: raw.sourceEvidence && typeof raw.sourceEvidence === 'object'
      ? raw.sourceEvidence as Record<string, unknown>
      : {},
    executionResult: parseStoredExecutionResult(raw.executionResult),
  };
}

async function loadApproval(
  db: D1Database,
  tenantId: string,
  approvalId: number,
): Promise<ApprovalRow | null> {
  return db.prepare(`
    SELECT
      id,
      entity_id AS "entityId",
      entity_no AS "entityNo",
      requested_by AS "requestedBy",
      request_data AS "requestData",
      status,
      execution_status AS "executionStatus",
      COALESCE(execution_attempts, 0) AS "executionAttempts",
      locked_by AS "lockedBy",
      COALESCE(approval_count, 0) AS "approvalCount",
      COALESCE(required_approvals, 2) AS "requiredApprovals"
    FROM approval_requests
    WHERE tenant_id = ? AND id = ? AND type = 'receivable_write_off'
    LIMIT 1
  `).bind(tenantId, approvalId).first<ApprovalRow>();
}

async function loadCollectionCase(
  db: D1Database,
  tenantId: string,
  collectionCaseId: number,
): Promise<CollectionCaseRow | null> {
  return db.prepare(`
    SELECT
      id,
      status,
      canonical_invoice_public_id AS "canonicalInvoicePublicId",
      legacy_bill_id AS "legacyBillId"
    FROM collection_cases
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, collectionCaseId).first<CollectionCaseRow>();
}

function assertSourceMatchesCase(source: ReceivableSourceRef, row: CollectionCaseRow): void {
  if (
    source.legacyBillId !== undefined
    && Number(row.legacyBillId) !== source.legacyBillId
  ) {
    throw new ReceivableWriteOffExecutionConflictError('Collection case no longer matches the approved legacy bill source.');
  }
  if (
    source.canonicalInvoicePublicId !== undefined
    && row.canonicalInvoicePublicId !== source.canonicalInvoicePublicId
  ) {
    throw new ReceivableWriteOffExecutionConflictError('Collection case no longer matches the approved canonical invoice source.');
  }
}

function replayResult(stored: StoredExecutionResult): ExecuteReceivableWriteOffApprovalResult {
  return {
    adjustmentPublicId: stored.adjustmentPublicId,
    newDueMinor: stored.newDueMinor,
    currencyCode: stored.currencyCode,
    collectionStatus: stored.collectionStatus,
  };
}

function approvalEventStatement(input: {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  action: 'execution_started' | 'execution_succeeded' | 'execution_failed' | 'rejected';
  actorId: number;
  oldStatus: string | null;
  newStatus: string | null;
  notes: string;
  metadata: Record<string, unknown>;
}): D1PreparedStatement {
  return input.db.prepare(`
    INSERT INTO approval_events (
      tenant_id, approval_request_id, action, actor_id,
      old_status, new_status, notes, metadata
    ) VALUES (
      CASE WHEN changes() = 1 THEN ? ELSE NULL END,
      ?, ?, ?, ?, ?, ?, ?
    )
  `).bind(
    input.tenantId,
    input.approvalId,
    input.action,
    input.actorId,
    input.oldStatus,
    input.newStatus,
    input.notes,
    JSON.stringify(input.metadata),
  );
}

async function acquireExecutionLock(input: {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  approverId: number;
  notes: string;
  attempt: number;
}): Promise<void> {
  const statements = [
    input.db.prepare(`
      UPDATE approval_requests
      SET execution_status = 'processing',
          execution_started_at = datetime('now', '+6 hours'),
          execution_completed_at = NULL,
          execution_error = NULL,
          execution_attempts = COALESCE(execution_attempts, 0) + 1,
          locked_by = ?,
          locked_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND type = 'receivable_write_off'
        AND status = 'approved'
        AND COALESCE(approval_count, 0) >= COALESCE(required_approvals, 2)
        AND COALESCE(execution_status, 'pending') IN ('pending', 'failed')
    `).bind(input.approverId, input.tenantId, input.approvalId),
    approvalEventStatement({
      db: input.db,
      tenantId: input.tenantId,
      approvalId: input.approvalId,
      action: 'execution_started',
      actorId: input.approverId,
      oldStatus: 'approved',
      newStatus: 'approved',
      notes: input.notes,
      metadata: {
        schemaVersion: 1,
        executionAttempt: input.attempt,
      },
    }),
  ];
  try {
    await input.db.batch(statements);
  } catch {
    const current = await loadApproval(input.db, input.tenantId, input.approvalId);
    if (current?.executionStatus === 'processing') {
      throw new ReceivableWriteOffExecutionConflictError('Approval execution is already processing under an active lock.');
    }
    throw new ReceivableWriteOffExecutionConflictError('Approval execution lock could not be acquired.');
  }
}

async function markExecutionFailed(input: {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  approverId: number;
  notes: string;
  error: unknown;
}): Promise<void> {
  const message = (input.error instanceof Error ? input.error.message : String(input.error)).slice(0, 1000);
  try {
    await input.db.batch([
      input.db.prepare(`
        UPDATE approval_requests
        SET execution_status = 'failed',
            execution_completed_at = datetime('now', '+6 hours'),
            execution_error = ?,
            locked_by = NULL,
            locked_at = NULL
        WHERE tenant_id = ?
          AND id = ?
          AND type = 'receivable_write_off'
          AND execution_status = 'processing'
          AND locked_by = ?
      `).bind(message, input.tenantId, input.approvalId, input.approverId),
      approvalEventStatement({
        db: input.db,
        tenantId: input.tenantId,
        approvalId: input.approvalId,
        action: 'execution_failed',
        actorId: input.approverId,
        oldStatus: 'approved',
        newStatus: 'approved',
        notes: message || input.notes,
        metadata: {
          schemaVersion: 1,
          retryable: true,
        },
      }),
    ]);
  } catch {
    // Preserve the original financial/workflow error if failure-state evidence cannot be written.
  }
}

function storedExecutionResult(
  adjustment: ReceivableAdjustmentResult,
  collectionStatusValue: CollectionStatus,
  approverId: number,
  nowUtc: string,
): StoredExecutionResult {
  return {
    schemaVersion: 1,
    adjustmentPublicId: adjustment.adjustmentPublicId,
    ...(adjustment.legacyCreditNoteId ? { legacyCreditNoteId: adjustment.legacyCreditNoteId } : {}),
    ...(adjustment.canonicalCreditNotePublicId
      ? { canonicalCreditNotePublicId: adjustment.canonicalCreditNotePublicId }
      : {}),
    previousDueMinor: adjustment.previousDueMinor,
    newDueMinor: adjustment.newDueMinor,
    appliedAmountMinor: adjustment.appliedAmountMinor,
    currencyCode: adjustment.currencyCode,
    authorityMode: adjustment.authorityMode,
    collectionStatus: collectionStatusValue,
    executedBy: approverId,
    executedAtUtc: nowUtc,
  };
}

async function finalizeExecution(input: {
  db: D1Database;
  tenantId: string;
  approval: ApprovalRow;
  requestData: WriteOffRequestData;
  approverId: number;
  notes: string;
  adjustment: ReceivableAdjustmentResult;
}): Promise<ExecuteReceivableWriteOffApprovalResult> {
  const collectionCase = await loadCollectionCase(
    input.db,
    input.tenantId,
    input.approval.entityId,
  );
  if (!collectionCase) {
    throw new ReceivableWriteOffExecutionConflictError('Linked collection case was not found.');
  }
  assertSourceMatchesCase(input.requestData.source, collectionCase);
  if (collectionCase.status !== 'write_off_requested') {
    throw new ReceivableWriteOffExecutionConflictError('Collection case is not awaiting write-off execution.');
  }

  const nextStatus: CollectionStatus = input.adjustment.newDueMinor === 0 ? 'closed' : 'contact_due';
  const nowUtc = new Date().toISOString();
  const execution = storedExecutionResult(input.adjustment, nextStatus, input.approverId, nowUtc);
  const nextRequestData = JSON.stringify({
    ...input.requestData,
    executionResult: execution,
  });
  const metadata = {
    schemaVersion: 1,
    approvalId: input.approval.id,
    adjustmentPublicId: input.adjustment.adjustmentPublicId,
    legacyCreditNoteId: input.adjustment.legacyCreditNoteId ?? null,
    canonicalCreditNotePublicId: input.adjustment.canonicalCreditNotePublicId ?? null,
    previousDueMinor: input.adjustment.previousDueMinor,
    newDueMinor: input.adjustment.newDueMinor,
    appliedAmountMinor: input.adjustment.appliedAmountMinor,
    currencyCode: input.adjustment.currencyCode,
    authorityMode: input.adjustment.authorityMode,
    source: input.requestData.source,
  };

  await input.db.batch([
    input.db.prepare(`
      UPDATE collection_cases
      SET status = ?,
          next_followup_at_utc = CASE WHEN ? = 'contact_due' THEN ? ELSE NULL END,
          promise_date = NULL,
          promise_amount_minor = NULL,
          currency_code = NULL,
          latest_note = CASE WHEN ? = 'contact_due' THEN ? ELSE latest_note END,
          closed_at_utc = CASE WHEN ? = 'closed' THEN ? ELSE NULL END,
          updated_at_utc = ?
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'write_off_requested'
    `).bind(
      nextStatus,
      nextStatus,
      nowUtc,
      nextStatus,
      input.notes,
      nextStatus,
      nowUtc,
      nowUtc,
      input.tenantId,
      collectionCase.id,
    ),
    input.db.prepare(`
      INSERT INTO collection_case_events (
        tenant_id, case_id, event_type, actor_id,
        old_status, new_status, note, metadata_json, created_at_utc
      ) VALUES (
        CASE WHEN changes() = 1 THEN ? ELSE NULL END,
        ?, 'write_off_executed', ?, 'write_off_requested', ?, ?, ?, ?
      )
    `).bind(
      input.tenantId,
      collectionCase.id,
      input.approverId,
      nextStatus,
      input.notes,
      JSON.stringify(metadata),
      nowUtc,
    ),
    input.db.prepare(`
      UPDATE approval_requests
      SET execution_status = 'succeeded',
          execution_completed_at = datetime('now', '+6 hours'),
          execution_error = NULL,
          locked_by = NULL,
          locked_at = NULL,
          reviewed_by = ?,
          reviewed_at = datetime('now', '+6 hours'),
          review_notes = ?,
          request_data = ?
      WHERE tenant_id = ?
        AND id = ?
        AND type = 'receivable_write_off'
        AND status = 'approved'
        AND execution_status = 'processing'
        AND locked_by = ?
        AND changes() = 1
    `).bind(
      input.approverId,
      input.notes,
      nextRequestData,
      input.tenantId,
      input.approval.id,
      input.approverId,
    ),
    approvalEventStatement({
      db: input.db,
      tenantId: input.tenantId,
      approvalId: input.approval.id,
      action: 'execution_succeeded',
      actorId: input.approverId,
      oldStatus: 'approved',
      newStatus: 'approved',
      notes: input.notes,
      metadata,
    }),
  ]);

  return replayResult(execution);
}

export async function executeReceivableWriteOffApproval(
  rawInput: ExecuteReceivableWriteOffApprovalInput,
): Promise<ExecuteReceivableWriteOffApprovalResult> {
  const tenantId = exactText(rawInput.tenantId, 'Tenant ID');
  const approvalId = positiveSafeInteger(rawInput.approvalId, 'Approval ID');
  const approverId = positiveSafeInteger(rawInput.approverId, 'Approver ID');
  const notes = reviewNotes(rawInput.reviewNotes);
  let approval = await loadApproval(rawInput.db, tenantId, approvalId);
  if (!approval) throw new ReceivableWriteOffExecutionError('Receivable write-off approval was not found.');
  if (approval.requestedBy === approverId) {
    throw new ReceivableWriteOffExecutionError('Requester cannot execute their own write-off request.');
  }
  let requestData = parseRequestData(approval.requestData);
  if (approval.executionStatus === 'succeeded' && requestData.executionResult) {
    return replayResult(requestData.executionResult);
  }
  if (
    approval.status !== 'approved'
    || approval.approvalCount < approval.requiredApprovals
  ) {
    throw new ReceivableWriteOffExecutionConflictError('Write-off request must be fully approved before execution.');
  }
  if (approval.executionStatus === 'processing') {
    throw new ReceivableWriteOffExecutionConflictError('Approval execution is already processing under an active lock.');
  }
  if (!['pending', 'failed'].includes(String(approval.executionStatus ?? 'pending'))) {
    throw new ReceivableWriteOffExecutionConflictError('Approval execution is not available from its current state.');
  }

  await acquireExecutionLock({
    db: rawInput.db,
    tenantId,
    approvalId,
    approverId,
    notes,
    attempt: approval.executionAttempts + 1,
  });
  approval = await loadApproval(rawInput.db, tenantId, approvalId);
  if (!approval || approval.executionStatus !== 'processing' || approval.lockedBy !== approverId) {
    throw new ReceivableWriteOffExecutionConflictError('Approval execution lock could not be verified.');
  }
  requestData = parseRequestData(approval.requestData);

  try {
    const adjustment = await applyReceivableAdjustment({
      db: rawInput.db,
      tenantId,
      source: requestData.source,
      amountMinor: requestData.amountMinor,
      currencyCode: requestData.currencyCode,
      reasonCode: requestData.reasonCode,
      note: requestData.note,
      actorId: approverId,
      sourceType: 'receivable_write_off',
      sourceRequestId: approvalId,
      idempotencyKey: `receivable-write-off:${approvalId}`,
    });
    return await finalizeExecution({
      db: rawInput.db,
      tenantId,
      approval,
      requestData,
      approverId,
      notes,
      adjustment,
    });
  } catch (error) {
    await markExecutionFailed({
      db: rawInput.db,
      tenantId,
      approvalId,
      approverId,
      notes,
      error,
    });
    throw error;
  }
}

function restoredState(input: {
  previous: PreviousCollectionState;
  live: Awaited<ReturnType<typeof getLiveReceivable>>;
}): PreviousCollectionState & { closedAtUtc: string | null } {
  const nowUtc = new Date().toISOString();
  if (!input.live || input.live.record.financialStatus !== 'open' || input.live.record.dueMinor <= 0) {
    return {
      status: 'closed',
      assignedTo: input.previous.assignedTo,
      nextFollowupAtUtc: null,
      promiseDate: null,
      promiseAmountMinor: null,
      currencyCode: null,
      latestNote: input.previous.latestNote,
      lastContactedAtUtc: input.previous.lastContactedAtUtc,
      updatedAtUtc: input.previous.updatedAtUtc,
      closedAtUtc: nowUtc,
    };
  }

  const previousStatus = input.previous.status;
  const allowed = ['new', 'contact_due', 'contacted', 'promised', 'disputed', 'escalated']
    .includes(previousStatus)
    ? previousStatus
    : 'contact_due';
  const promisedValid = allowed === 'promised'
    && input.previous.promiseDate !== null
    && input.previous.promiseAmountMinor !== null
    && input.previous.promiseAmountMinor > 0
    && input.previous.promiseAmountMinor <= input.live.record.dueMinor
    && (input.previous.currencyCode === null || input.previous.currencyCode === input.live.record.currencyCode);
  const status: CollectionStatus = allowed === 'promised' && !promisedValid
    ? 'contact_due'
    : allowed as CollectionStatus;
  return {
    status,
    assignedTo: input.previous.assignedTo,
    nextFollowupAtUtc: status === 'closed' ? null : input.previous.nextFollowupAtUtc,
    promiseDate: promisedValid ? input.previous.promiseDate : null,
    promiseAmountMinor: promisedValid ? input.previous.promiseAmountMinor : null,
    currencyCode: promisedValid ? input.live.record.currencyCode : input.previous.currencyCode,
    latestNote: input.previous.latestNote,
    lastContactedAtUtc: input.previous.lastContactedAtUtc,
    updatedAtUtc: input.previous.updatedAtUtc,
    closedAtUtc: null,
  };
}

export async function rejectReceivableWriteOffApproval(
  rawInput: RejectReceivableWriteOffApprovalInput,
): Promise<{ collectionStatus: CollectionStatus }> {
  const tenantId = exactText(rawInput.tenantId, 'Tenant ID');
  const approvalId = positiveSafeInteger(rawInput.approvalId, 'Approval ID');
  const approverId = positiveSafeInteger(rawInput.approverId, 'Approver ID');
  const notes = reviewNotes(rawInput.reviewNotes);
  const approval = await loadApproval(rawInput.db, tenantId, approvalId);
  if (!approval) throw new ReceivableWriteOffExecutionError('Receivable write-off approval was not found.');
  if (approval.requestedBy === approverId) {
    throw new ReceivableWriteOffExecutionError('Requester cannot reject their own write-off request.');
  }
  if (!['pending', 'partially_approved'].includes(approval.status)) {
    throw new ReceivableWriteOffExecutionConflictError('Write-off request is already terminal.');
  }
  if (approval.executionStatus === 'processing') {
    throw new ReceivableWriteOffExecutionConflictError('Write-off execution is already processing.');
  }
  const requestData = parseRequestData(approval.requestData);
  const collectionCase = await loadCollectionCase(rawInput.db, tenantId, approval.entityId);
  if (!collectionCase) throw new ReceivableWriteOffExecutionError('Linked collection case was not found.');
  assertSourceMatchesCase(requestData.source, collectionCase);
  if (collectionCase.status !== 'write_off_requested') {
    throw new ReceivableWriteOffExecutionConflictError('Collection case is not awaiting write-off review.');
  }
  const live = await getLiveReceivable({
    db: rawInput.db,
    tenantId,
    source: requestData.source,
  });
  const restored = restoredState({
    previous: requestData.previousCollectionState,
    live,
  });
  const nowUtc = new Date().toISOString();
  const metadata = {
    schemaVersion: 1,
    approvalId,
    source: requestData.source,
    requestedAmountMinor: requestData.amountMinor,
    currencyCode: requestData.currencyCode,
    restoredStatus: restored.status,
    sourceFinancialStatus: live?.record.financialStatus ?? 'missing',
    liveDueMinor: live?.record.dueMinor ?? null,
  };

  await rawInput.db.batch([
    rawInput.db.prepare(`
      UPDATE approval_requests
      SET status = 'rejected',
          reviewed_by = ?,
          reviewed_at = datetime('now', '+6 hours'),
          review_notes = ?,
          execution_status = 'not_required',
          execution_completed_at = datetime('now', '+6 hours'),
          execution_error = NULL,
          locked_by = NULL,
          locked_at = NULL
      WHERE tenant_id = ?
        AND id = ?
        AND type = 'receivable_write_off'
        AND status IN ('pending', 'partially_approved')
        AND COALESCE(execution_status, 'pending') != 'processing'
    `).bind(approverId, notes, tenantId, approvalId),
    approvalEventStatement({
      db: rawInput.db,
      tenantId,
      approvalId,
      action: 'rejected',
      actorId: approverId,
      oldStatus: approval.status,
      newStatus: 'rejected',
      notes,
      metadata,
    }),
    rawInput.db.prepare(`
      UPDATE collection_cases
      SET status = ?,
          assigned_to = ?,
          next_followup_at_utc = ?,
          promise_date = ?,
          promise_amount_minor = ?,
          currency_code = ?,
          latest_note = ?,
          last_contacted_at_utc = ?,
          closed_at_utc = ?,
          updated_at_utc = ?
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'write_off_requested'
        AND changes() = 1
    `).bind(
      restored.status,
      restored.assignedTo,
      restored.nextFollowupAtUtc,
      restored.promiseDate,
      restored.promiseAmountMinor,
      restored.currencyCode,
      restored.latestNote,
      restored.lastContactedAtUtc,
      restored.closedAtUtc,
      nowUtc,
      tenantId,
      collectionCase.id,
    ),
    rawInput.db.prepare(`
      INSERT INTO collection_case_events (
        tenant_id, case_id, event_type, actor_id,
        old_status, new_status, note, metadata_json, created_at_utc
      ) VALUES (
        CASE WHEN changes() = 1 THEN ? ELSE NULL END,
        ?, 'write_off_rejected', ?, 'write_off_requested', ?, ?, ?, ?
      )
    `).bind(
      tenantId,
      collectionCase.id,
      approverId,
      restored.status,
      notes,
      JSON.stringify(metadata),
      nowUtc,
    ),
  ]);

  return { collectionStatus: restored.status };
}
