import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import { createRequestFingerprint, stableCanonicalJson } from './idempotency';
import {
  CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST,
  convertCanonicalOutboxEventToSyncEnvelope,
} from './local-sync-outbox-converter';
import {
  validateCanonicalSyncEnvelope,
  type CanonicalSyncEnvelope,
} from './local-sync-protocol';

export interface CanonicalSyncOutboxClaimReceipt {
  tenantId: string;
  eventPublicId: string;
  claimPublicId: string;
  claimOwnerPublicId: string;
  claimExpiresAtUtc: string;
  attemptCount: number;
  envelopeSha256: string;
  envelope: CanonicalSyncEnvelope;
}

export class CanonicalSyncOutboxStateError extends Error {
  readonly code = 'CANONICAL_SYNC_OUTBOX_STATE';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncOutboxStateError';
  }
}

export class CanonicalSyncOutboxPublicationConflictError extends Error {
  readonly code = 'CANONICAL_SYNC_OUTBOX_PUBLICATION_CONFLICT';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncOutboxPublicationConflictError';
  }
}

interface CandidateRow {
  event_public_id: string;
}

interface ClaimedRow {
  tenant_id: string;
  event_public_id: string;
  claim_public_id: string;
  locked_by: string;
  claim_expires_at_utc: string;
  processing_attempts: number;
}

interface RecoverableRow {
  processing_attempts: number;
  claim_expires_at_utc: string;
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,95}$/;

function assertExact(value: unknown, label: string, maxLength: number): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
  ) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace and at most ${maxLength} characters`);
  }
}

function assertPublicId(value: unknown, label: string, maxLength: number): asserts value is string {
  assertExact(value, label, maxLength);
  if (/^\d+$/.test(value)) {
    throw new TypeError(`${label} must be a stable public identifier, not a raw numeric database ID`);
  }
}

function assertUtc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid ISO-8601 UTC timestamp`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertErrorEvidence(
  errorCode: unknown,
  errorSha256: unknown,
  errorSummary: unknown,
): string | null {
  if (typeof errorCode !== 'string' || !ERROR_CODE_PATTERN.test(errorCode)) {
    throw new TypeError('errorCode must be a stable uppercase code of at most 96 characters');
  }
  if (typeof errorSha256 !== 'string' || !HASH_PATTERN.test(errorSha256)) {
    throw new TypeError('errorSha256 must be a lowercase SHA-256 digest');
  }
  if (errorSummary == null) return null;
  assertExact(errorSummary, 'errorSummary', 512);
  return errorSummary;
}

function isAssertionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical_sync_batch_assertions|assertion_value/i.test(message)) return true;
    if (typeof current !== 'object') break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function prepareClearAssertions(
  db: CanonicalBatchDatabase,
  tenantId: string,
  operationKey: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    DELETE FROM canonical_sync_batch_assertions
    WHERE tenant_id = ? AND operation_key = ?
  `).bind(tenantId, operationKey);
}

function prepareAssertion(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    operationKey: string;
    stepKey: string;
    expectedChanges: number;
    createdAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_sync_batch_assertions (
      tenant_id,operation_key,step_key,assertion_value,created_at_utc
    ) VALUES (?, ?, ?, CASE WHEN changes() = ? THEN 1 ELSE 0 END, ?)
  `).bind(
    input.tenantId,
    input.operationKey,
    input.stepKey,
    input.expectedChanges,
    input.createdAtUtc,
  );
}

const ALLOWLIST_PREDICATE = CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST
  .map(() => '(e.aggregate_type = ? AND e.event_type = ?)')
  .join(' OR ');

const ALLOWLIST_PARAMETERS = CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST.flatMap((entry) => [
  entry.aggregateType,
  entry.eventType,
]);

const PREDECESSOR_PREDICATE = `
  NOT EXISTS (
    SELECT 1
    FROM canonical_outbox_events predecessor
    WHERE predecessor.tenant_id = e.tenant_id
      AND predecessor.aggregate_type = e.aggregate_type
      AND predecessor.aggregate_public_id = e.aggregate_public_id
      AND predecessor.id < e.id
      AND predecessor.status <> 'published'
  )
`;

async function loadCandidate(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    claimedAtUtc: string;
    maxAttempts: number;
  },
): Promise<CandidateRow> {
  const candidate = await db.prepare(`
    SELECT e.event_public_id
    FROM canonical_outbox_events e
    WHERE e.tenant_id = ?
      AND (${ALLOWLIST_PREDICATE})
      AND e.processing_attempts < ?
      AND (
        (e.status = 'pending' AND e.available_at_utc <= ?)
        OR (e.status = 'retry' AND e.available_at_utc <= ?)
        OR (e.status = 'processing' AND e.claim_expires_at_utc <= ?)
      )
      AND ${PREDECESSOR_PREDICATE}
    ORDER BY e.id
    LIMIT 1
  `).bind(
    input.tenantId,
    ...ALLOWLIST_PARAMETERS,
    input.maxAttempts,
    input.claimedAtUtc,
    input.claimedAtUtc,
    input.claimedAtUtc,
  ).first<CandidateRow>();

  if (!candidate) {
    throw new CanonicalSyncOutboxStateError(
      `No claimable canonical sync outbox event exists for tenant ${input.tenantId}`,
    );
  }
  return candidate;
}

export async function claimNextCanonicalSyncOutboxEnvelope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourceNodePublicId: string;
    claimPublicId: string;
    claimOwnerPublicId: string;
    claimedAtUtc: string;
    claimExpiresAtUtc: string;
    maxAttempts: number;
  },
): Promise<CanonicalSyncOutboxClaimReceipt> {
  assertExact(input.tenantId, 'tenantId', 128);
  assertPublicId(input.sourceNodePublicId, 'sourceNodePublicId', 192);
  assertPublicId(input.claimPublicId, 'claimPublicId', 160);
  assertPublicId(input.claimOwnerPublicId, 'claimOwnerPublicId', 192);
  assertUtc(input.claimedAtUtc, 'claimedAtUtc');
  assertUtc(input.claimExpiresAtUtc, 'claimExpiresAtUtc');
  assertPositiveInteger(input.maxAttempts, 'maxAttempts');
  if (Date.parse(input.claimExpiresAtUtc) <= Date.parse(input.claimedAtUtc)) {
    throw new RangeError('claimExpiresAtUtc must be later than claimedAtUtc');
  }

  const candidate = await loadCandidate(db, input);
  const envelope = await convertCanonicalOutboxEventToSyncEnvelope(db, {
    tenantId: input.tenantId,
    eventPublicId: candidate.event_public_id,
    sourceNodePublicId: input.sourceNodePublicId,
  });
  const envelopeSha256 = await createRequestFingerprint(envelope);
  const operationKey = `source-outbox-claim:${await createRequestFingerprint({
    tenantId: input.tenantId,
    eventPublicId: candidate.event_public_id,
    claimPublicId: input.claimPublicId,
    claimOwnerPublicId: input.claimOwnerPublicId,
    claimedAtUtc: input.claimedAtUtc,
    claimExpiresAtUtc: input.claimExpiresAtUtc,
    maxAttempts: input.maxAttempts,
    envelopeSha256,
  })}`;

  const update = db.prepare(`
    UPDATE canonical_outbox_events AS e
    SET status = 'processing',
        claim_public_id = ?,
        locked_by = ?,
        locked_at_utc = ?,
        claim_expires_at_utc = ?,
        processing_attempts = processing_attempts + 1,
        published_at_utc = NULL,
        published_envelope_sha256 = NULL,
        last_error_code = NULL,
        last_error_summary = NULL,
        last_error_sha256 = NULL,
        updated_at_utc = ?
    WHERE e.tenant_id = ?
      AND e.event_public_id = ?
      AND e.processing_attempts < ?
      AND (
        (e.status IN ('pending', 'retry') AND e.available_at_utc <= ?)
        OR (e.status = 'processing' AND e.claim_expires_at_utc <= ?)
      )
      AND ${PREDECESSOR_PREDICATE}
  `).bind(
    input.claimPublicId,
    input.claimOwnerPublicId,
    input.claimedAtUtc,
    input.claimExpiresAtUtc,
    input.claimedAtUtc,
    input.tenantId,
    candidate.event_public_id,
    input.maxAttempts,
    input.claimedAtUtc,
    input.claimedAtUtc,
  );

  try {
    await db.batch([
      prepareClearAssertions(db, input.tenantId, operationKey),
      update,
      prepareAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: 'claim',
        expectedChanges: 1,
        createdAtUtc: input.claimedAtUtc,
      }),
      prepareClearAssertions(db, input.tenantId, operationKey),
    ]);
  } catch (error) {
    if (isAssertionError(error)) {
      throw new CanonicalSyncOutboxStateError(
        `Canonical sync outbox event ${candidate.event_public_id} lost claim eligibility`,
        { cause: error },
      );
    }
    throw error;
  }

  const claimed = await db.prepare(`
    SELECT tenant_id,event_public_id,claim_public_id,locked_by,
           claim_expires_at_utc,processing_attempts
    FROM canonical_outbox_events
    WHERE tenant_id = ? AND event_public_id = ?
      AND status = 'processing' AND claim_public_id = ?
      AND locked_by = ?
  `).bind(
    input.tenantId,
    candidate.event_public_id,
    input.claimPublicId,
    input.claimOwnerPublicId,
  ).first<ClaimedRow>();

  if (!claimed) {
    throw new CanonicalSyncOutboxStateError(
      `Canonical sync outbox claim receipt is missing for ${candidate.event_public_id}`,
    );
  }
  const attemptCount = Number(claimed.processing_attempts);
  assertPositiveInteger(attemptCount, 'processing attempts');

  return {
    tenantId: claimed.tenant_id,
    eventPublicId: claimed.event_public_id,
    claimPublicId: claimed.claim_public_id,
    claimOwnerPublicId: claimed.locked_by,
    claimExpiresAtUtc: claimed.claim_expires_at_utc,
    attemptCount,
    envelopeSha256,
    envelope,
  };
}

export async function completeCanonicalSyncOutboxPublication(
  db: CanonicalBatchDatabase,
  input: {
    receipt: CanonicalSyncOutboxClaimReceipt;
    sourceNodePublicId: string;
    envelope: CanonicalSyncEnvelope;
    publishedAtUtc: string;
  },
): Promise<void> {
  assertExact(input.receipt.tenantId, 'receipt.tenantId', 128);
  assertPublicId(input.receipt.eventPublicId, 'receipt.eventPublicId', 160);
  assertPublicId(input.receipt.claimPublicId, 'receipt.claimPublicId', 160);
  assertPublicId(input.receipt.claimOwnerPublicId, 'receipt.claimOwnerPublicId', 192);
  assertUtc(input.receipt.claimExpiresAtUtc, 'receipt.claimExpiresAtUtc');
  assertPositiveInteger(input.receipt.attemptCount, 'receipt.attemptCount');
  assertExact(input.receipt.envelopeSha256, 'receipt.envelopeSha256', 64);
  assertPublicId(input.sourceNodePublicId, 'sourceNodePublicId', 192);
  assertUtc(input.publishedAtUtc, 'publishedAtUtc');

  try {
    await validateCanonicalSyncEnvelope(input.envelope);
  } catch (error) {
    throw new CanonicalSyncOutboxPublicationConflictError(
      `Canonical sync publication envelope is invalid for ${input.receipt.eventPublicId}`,
      { cause: error },
    );
  }

  const expected = await convertCanonicalOutboxEventToSyncEnvelope(db, {
    tenantId: input.receipt.tenantId,
    eventPublicId: input.receipt.eventPublicId,
    sourceNodePublicId: input.sourceNodePublicId,
  });
  const expectedSha256 = await createRequestFingerprint(expected);
  if (
    expectedSha256 !== input.receipt.envelopeSha256
    || stableCanonicalJson(expected) !== stableCanonicalJson(input.envelope)
  ) {
    throw new CanonicalSyncOutboxPublicationConflictError(
      `Canonical sync publication envelope conflicts for ${input.receipt.eventPublicId}`,
    );
  }

  const operationKey = `source-outbox-publish:${await createRequestFingerprint({
    tenantId: input.receipt.tenantId,
    eventPublicId: input.receipt.eventPublicId,
    claimPublicId: input.receipt.claimPublicId,
    claimOwnerPublicId: input.receipt.claimOwnerPublicId,
    claimExpiresAtUtc: input.receipt.claimExpiresAtUtc,
    attemptCount: input.receipt.attemptCount,
    envelopeSha256: expectedSha256,
    publishedAtUtc: input.publishedAtUtc,
  })}`;

  try {
    await db.batch([
      prepareClearAssertions(db, input.receipt.tenantId, operationKey),
      db.prepare(`
        UPDATE canonical_outbox_events
        SET status = 'published',
            published_at_utc = ?,
            published_envelope_sha256 = ?,
            claim_public_id = NULL,
            claim_expires_at_utc = NULL,
            locked_at_utc = NULL,
            locked_by = NULL,
            last_error_code = NULL,
            last_error_summary = NULL,
            last_error_sha256 = NULL,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND event_public_id = ?
          AND status = 'processing'
          AND claim_public_id = ?
          AND locked_by = ?
          AND claim_expires_at_utc = ?
          AND claim_expires_at_utc > ?
          AND processing_attempts = ?
      `).bind(
        input.publishedAtUtc,
        expectedSha256,
        input.publishedAtUtc,
        input.receipt.tenantId,
        input.receipt.eventPublicId,
        input.receipt.claimPublicId,
        input.receipt.claimOwnerPublicId,
        input.receipt.claimExpiresAtUtc,
        input.publishedAtUtc,
        input.receipt.attemptCount,
      ),
      prepareAssertion(db, {
        tenantId: input.receipt.tenantId,
        operationKey,
        stepKey: 'publish',
        expectedChanges: 1,
        createdAtUtc: input.publishedAtUtc,
      }),
      prepareClearAssertions(db, input.receipt.tenantId, operationKey),
    ]);
  } catch (error) {
    if (isAssertionError(error)) {
      throw new CanonicalSyncOutboxStateError(
        `Canonical sync outbox publication rejected for ${input.receipt.eventPublicId}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export type CanonicalSyncOutboxFailureStatus = 'retry' | 'dead_letter';

export async function deadLetterCanonicalSyncOutboxPublication(
  db: CanonicalBatchDatabase,
  input: {
    receipt: CanonicalSyncOutboxClaimReceipt;
    failedAtUtc: string;
    errorCode: string;
    errorSha256: string;
    errorSummary?: string | null;
  },
): Promise<void> {
  assertExact(input.receipt.tenantId, 'receipt.tenantId', 128);
  assertPublicId(input.receipt.eventPublicId, 'receipt.eventPublicId', 160);
  assertPublicId(input.receipt.claimPublicId, 'receipt.claimPublicId', 160);
  assertPublicId(input.receipt.claimOwnerPublicId, 'receipt.claimOwnerPublicId', 192);
  assertUtc(input.receipt.claimExpiresAtUtc, 'receipt.claimExpiresAtUtc');
  assertPositiveInteger(input.receipt.attemptCount, 'receipt.attemptCount');
  assertUtc(input.failedAtUtc, 'failedAtUtc');
  const errorSummary = assertErrorEvidence(input.errorCode, input.errorSha256, input.errorSummary);
  const operationKey = `source-outbox-dead-letter:${await createRequestFingerprint({
    tenantId: input.receipt.tenantId,
    eventPublicId: input.receipt.eventPublicId,
    claimPublicId: input.receipt.claimPublicId,
    claimOwnerPublicId: input.receipt.claimOwnerPublicId,
    claimExpiresAtUtc: input.receipt.claimExpiresAtUtc,
    attemptCount: input.receipt.attemptCount,
    failedAtUtc: input.failedAtUtc,
    errorCode: input.errorCode,
    errorSha256: input.errorSha256,
    errorSummary,
  })}`;

  try {
    await db.batch([
      prepareClearAssertions(db, input.receipt.tenantId, operationKey),
      db.prepare(`
        UPDATE canonical_outbox_events
        SET status = 'dead_letter',
            available_at_utc = ?,
            claim_public_id = NULL,
            claim_expires_at_utc = NULL,
            locked_at_utc = NULL,
            locked_by = NULL,
            published_at_utc = NULL,
            published_envelope_sha256 = NULL,
            last_error_code = ?,
            last_error_summary = ?,
            last_error_sha256 = ?,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND event_public_id = ?
          AND status = 'processing'
          AND claim_public_id = ?
          AND locked_by = ?
          AND claim_expires_at_utc = ?
          AND claim_expires_at_utc > ?
          AND processing_attempts = ?
      `).bind(
        input.failedAtUtc,
        input.errorCode,
        errorSummary,
        input.errorSha256,
        input.failedAtUtc,
        input.receipt.tenantId,
        input.receipt.eventPublicId,
        input.receipt.claimPublicId,
        input.receipt.claimOwnerPublicId,
        input.receipt.claimExpiresAtUtc,
        input.failedAtUtc,
        input.receipt.attemptCount,
      ),
      prepareAssertion(db, {
        tenantId: input.receipt.tenantId,
        operationKey,
        stepKey: 'dead-letter',
        expectedChanges: 1,
        createdAtUtc: input.failedAtUtc,
      }),
      prepareClearAssertions(db, input.receipt.tenantId, operationKey),
    ]);
  } catch (error) {
    if (isAssertionError(error)) {
      throw new CanonicalSyncOutboxStateError(
        `Canonical sync outbox permanent dead-letter rejected for ${input.receipt.eventPublicId}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function failCanonicalSyncOutboxPublication(
  db: CanonicalBatchDatabase,
  input: {
    receipt: CanonicalSyncOutboxClaimReceipt;
    failedAtUtc: string;
    nextAttemptAtUtc: string;
    maxAttempts: number;
    errorCode: string;
    errorSha256: string;
    errorSummary?: string | null;
  },
): Promise<CanonicalSyncOutboxFailureStatus> {
  assertExact(input.receipt.tenantId, 'receipt.tenantId', 128);
  assertPublicId(input.receipt.eventPublicId, 'receipt.eventPublicId', 160);
  assertPublicId(input.receipt.claimPublicId, 'receipt.claimPublicId', 160);
  assertPublicId(input.receipt.claimOwnerPublicId, 'receipt.claimOwnerPublicId', 192);
  assertUtc(input.receipt.claimExpiresAtUtc, 'receipt.claimExpiresAtUtc');
  assertPositiveInteger(input.receipt.attemptCount, 'receipt.attemptCount');
  assertUtc(input.failedAtUtc, 'failedAtUtc');
  assertUtc(input.nextAttemptAtUtc, 'nextAttemptAtUtc');
  assertPositiveInteger(input.maxAttempts, 'maxAttempts');
  const errorSummary = assertErrorEvidence(input.errorCode, input.errorSha256, input.errorSummary);
  const status: CanonicalSyncOutboxFailureStatus = input.receipt.attemptCount >= input.maxAttempts
    ? 'dead_letter'
    : 'retry';
  if (status === 'retry' && Date.parse(input.nextAttemptAtUtc) <= Date.parse(input.failedAtUtc)) {
    throw new RangeError('nextAttemptAtUtc must be later than failedAtUtc');
  }
  const availableAtUtc = status === 'retry' ? input.nextAttemptAtUtc : input.failedAtUtc;
  const operationKey = `source-outbox-${status}:${await createRequestFingerprint({
    tenantId: input.receipt.tenantId,
    eventPublicId: input.receipt.eventPublicId,
    claimPublicId: input.receipt.claimPublicId,
    claimOwnerPublicId: input.receipt.claimOwnerPublicId,
    claimExpiresAtUtc: input.receipt.claimExpiresAtUtc,
    attemptCount: input.receipt.attemptCount,
    failedAtUtc: input.failedAtUtc,
    nextAttemptAtUtc: input.nextAttemptAtUtc,
    maxAttempts: input.maxAttempts,
    errorCode: input.errorCode,
    errorSha256: input.errorSha256,
    errorSummary,
  })}`;

  try {
    await db.batch([
      prepareClearAssertions(db, input.receipt.tenantId, operationKey),
      db.prepare(`
        UPDATE canonical_outbox_events
        SET status = ?,
            available_at_utc = ?,
            claim_public_id = NULL,
            claim_expires_at_utc = NULL,
            locked_at_utc = NULL,
            locked_by = NULL,
            published_at_utc = NULL,
            published_envelope_sha256 = NULL,
            last_error_code = ?,
            last_error_summary = ?,
            last_error_sha256 = ?,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND event_public_id = ?
          AND status = 'processing'
          AND claim_public_id = ?
          AND locked_by = ?
          AND claim_expires_at_utc = ?
          AND claim_expires_at_utc > ?
          AND processing_attempts = ?
      `).bind(
        status,
        availableAtUtc,
        input.errorCode,
        errorSummary,
        input.errorSha256,
        input.failedAtUtc,
        input.receipt.tenantId,
        input.receipt.eventPublicId,
        input.receipt.claimPublicId,
        input.receipt.claimOwnerPublicId,
        input.receipt.claimExpiresAtUtc,
        input.failedAtUtc,
        input.receipt.attemptCount,
      ),
      prepareAssertion(db, {
        tenantId: input.receipt.tenantId,
        operationKey,
        stepKey: status,
        expectedChanges: 1,
        createdAtUtc: input.failedAtUtc,
      }),
      prepareClearAssertions(db, input.receipt.tenantId, operationKey),
    ]);
  } catch (error) {
    if (isAssertionError(error)) {
      throw new CanonicalSyncOutboxStateError(
        `Canonical sync outbox ${status} transition rejected for ${input.receipt.eventPublicId}`,
        { cause: error },
      );
    }
    throw error;
  }
  return status;
}

export async function recoverExpiredCanonicalSyncOutboxLease(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    recoveredAtUtc: string;
    maxAttempts: number;
    errorCode: string;
    errorSha256: string;
    errorSummary?: string | null;
  },
): Promise<CanonicalSyncOutboxFailureStatus> {
  assertExact(input.tenantId, 'tenantId', 128);
  assertPublicId(input.eventPublicId, 'eventPublicId', 160);
  assertUtc(input.recoveredAtUtc, 'recoveredAtUtc');
  assertPositiveInteger(input.maxAttempts, 'maxAttempts');
  const errorSummary = assertErrorEvidence(input.errorCode, input.errorSha256, input.errorSummary);

  const recoverable = await db.prepare(`
    SELECT processing_attempts,claim_expires_at_utc
    FROM canonical_outbox_events
    WHERE tenant_id = ? AND event_public_id = ? AND status = 'processing'
    LIMIT 1
  `).bind(input.tenantId, input.eventPublicId).first<RecoverableRow>();
  if (!recoverable || recoverable.claim_expires_at_utc > input.recoveredAtUtc) {
    throw new CanonicalSyncOutboxStateError(
      `Canonical sync outbox lease is not recoverable for ${input.eventPublicId}`,
    );
  }
  const attemptCount = Number(recoverable.processing_attempts);
  assertPositiveInteger(attemptCount, 'processing attempts');
  const status: CanonicalSyncOutboxFailureStatus = attemptCount >= input.maxAttempts
    ? 'dead_letter'
    : 'retry';
  const operationKey = `source-outbox-recover-${status}:${await createRequestFingerprint({
    tenantId: input.tenantId,
    eventPublicId: input.eventPublicId,
    recoveredAtUtc: input.recoveredAtUtc,
    maxAttempts: input.maxAttempts,
    attemptCount,
    claimExpiresAtUtc: recoverable.claim_expires_at_utc,
    errorCode: input.errorCode,
    errorSha256: input.errorSha256,
    errorSummary,
  })}`;

  try {
    await db.batch([
      prepareClearAssertions(db, input.tenantId, operationKey),
      db.prepare(`
        UPDATE canonical_outbox_events
        SET status = ?,
            available_at_utc = ?,
            claim_public_id = NULL,
            claim_expires_at_utc = NULL,
            locked_at_utc = NULL,
            locked_by = NULL,
            published_at_utc = NULL,
            published_envelope_sha256 = NULL,
            last_error_code = ?,
            last_error_summary = ?,
            last_error_sha256 = ?,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND event_public_id = ?
          AND status = 'processing'
          AND claim_expires_at_utc = ?
          AND claim_expires_at_utc <= ?
          AND processing_attempts = ?
      `).bind(
        status,
        input.recoveredAtUtc,
        input.errorCode,
        errorSummary,
        input.errorSha256,
        input.recoveredAtUtc,
        input.tenantId,
        input.eventPublicId,
        recoverable.claim_expires_at_utc,
        input.recoveredAtUtc,
        attemptCount,
      ),
      prepareAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `recover-${status}`,
        expectedChanges: 1,
        createdAtUtc: input.recoveredAtUtc,
      }),
      prepareClearAssertions(db, input.tenantId, operationKey),
    ]);
  } catch (error) {
    if (isAssertionError(error)) {
      throw new CanonicalSyncOutboxStateError(
        `Canonical sync outbox lease recovery rejected for ${input.eventPublicId}`,
        { cause: error },
      );
    }
    throw error;
  }
  return status;
}
