import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import { createRequestFingerprint, stableCanonicalJson } from './idempotency';
import {
  validateCanonicalSyncEnvelope,
  type CanonicalSyncDependency,
  type CanonicalSyncEnvelope,
} from './local-sync-protocol';

export type CanonicalSyncReceiveResult =
  | { status: 'received'; eventPublicId: string }
  | { status: 'replayed'; eventPublicId: string };

export interface CanonicalSyncClaimReceipt {
  tenantId: string;
  eventPublicId: string;
  claimPublicId: string;
  claimOwnerPublicId: string;
  claimExpiresAtUtc: string;
  attemptCount: number;
}

export type CanonicalSyncInboxLifecycleStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'retry'
  | 'dead_letter';

export interface CanonicalSyncInboxLifecycleReceipt {
  tenantId: string;
  eventPublicId: string;
  status: CanonicalSyncInboxLifecycleStatus;
  attemptCount: number;
  claimPublicId: string | null;
  claimOwnerPublicId: string | null;
  claimExpiresAtUtc: string | null;
  nextAttemptAtUtc: string | null;
  appliedAtUtc: string | null;
  errorCode: string | null;
  errorHash: string | null;
}

export class CanonicalSyncInboxConflictError extends Error {
  readonly code = 'CANONICAL_SYNC_INBOX_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'CanonicalSyncInboxConflictError';
  }
}

export class CanonicalSyncInboxStateError extends Error {
  readonly code = 'CANONICAL_SYNC_INBOX_STATE';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncInboxStateError';
  }
}

interface InboxEvidenceRow {
  tenant_id: string;
  event_public_id: string;
  protocol_version: number;
  entity_type: string;
  entity_public_id: string;
  event_type: string;
  aggregate_version: number;
  operation: string;
  occurred_at_utc: string | null;
  payload_json: string;
  payload_sha256: string;
  idempotency_key: string;
  source_node_public_id: string;
}

interface DependencyEvidenceRow {
  dependency_entity_type: string;
  dependency_entity_public_id: string;
  minimum_version: number;
}

interface ClaimedRow {
  tenant_id: string;
  event_public_id: string;
  claim_public_id: string;
  claim_owner_public_id: string;
  claim_expires_at_utc: string;
  attempt_count: number;
}

interface InboxLifecycleRow {
  status: string;
  attempt_count: number;
  claim_public_id: string | null;
  claim_owner_public_id: string | null;
  claim_expires_at_utc: string | null;
  next_attempt_at_utc: string | null;
  applied_at_utc: string | null;
  error_code: string | null;
  error_hash: string | null;
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

function assertErrorEvidence(errorCode: unknown, errorHash: unknown): asserts errorCode is string {
  if (typeof errorCode !== 'string' || !ERROR_CODE_PATTERN.test(errorCode)) {
    throw new TypeError('errorCode must be a stable uppercase code of at most 96 characters');
  }
  if (typeof errorHash !== 'string' || !HASH_PATTERN.test(errorHash)) {
    throw new TypeError('errorHash must be a lowercase SHA-256 digest');
  }
}

function normalizeDependencies(
  dependencies: readonly CanonicalSyncDependency[],
): DependencyEvidenceRow[] {
  return dependencies.map((dependency) => ({
    dependency_entity_type: dependency.entityType,
    dependency_entity_public_id: dependency.entityPublicId,
    minimum_version: dependency.minimumVersion,
  }));
}

function semanticEvidence(envelope: CanonicalSyncEnvelope): Record<string, unknown> {
  return {
    tenant_id: envelope.tenantId,
    event_public_id: envelope.eventPublicId,
    protocol_version: envelope.protocolVersion,
    entity_type: envelope.entityType,
    entity_public_id: envelope.entityPublicId,
    event_type: envelope.eventType,
    aggregate_version: envelope.aggregateVersion,
    operation: envelope.operation,
    occurred_at_utc: envelope.occurredAtUtc,
    payload_json: stableCanonicalJson(envelope.payload),
    payload_sha256: envelope.payloadSha256,
    idempotency_key: envelope.idempotencyKey,
    source_node_public_id: envelope.sourceNodePublicId,
  };
}

function evidenceMatches(row: InboxEvidenceRow, envelope: CanonicalSyncEnvelope): boolean {
  return stableCanonicalJson(row) === stableCanonicalJson(semanticEvidence(envelope));
}

async function loadInboxEvidence(
  db: CanonicalBatchDatabase,
  envelope: Pick<CanonicalSyncEnvelope, 'tenantId' | 'eventPublicId' | 'idempotencyKey'>,
): Promise<InboxEvidenceRow | null> {
  return db.prepare(`
    SELECT
      tenant_id,event_public_id,protocol_version,entity_type,entity_public_id,
      event_type,aggregate_version,operation,occurred_at_utc,payload_json,
      payload_sha256,idempotency_key,source_node_public_id
    FROM canonical_sync_inbox_events
    WHERE tenant_id = ?
      AND (event_public_id = ? OR idempotency_key = ?)
    ORDER BY CASE WHEN event_public_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(
    envelope.tenantId,
    envelope.eventPublicId,
    envelope.idempotencyKey,
    envelope.eventPublicId,
  ).first<InboxEvidenceRow>();
}

async function loadDependencyEvidence(
  db: CanonicalBatchDatabase,
  tenantId: string,
  eventPublicId: string,
): Promise<DependencyEvidenceRow[]> {
  const rows: DependencyEvidenceRow[] = [];
  // D1 exposes all(), while the repository's portable statement interface only requires first()/run().
  // Query one deterministic row at a time to keep this adapter compatible with both D1 and test SQLite.
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT dependency_entity_type,dependency_entity_public_id,minimum_version
      FROM canonical_sync_inbox_dependencies
      WHERE tenant_id = ? AND inbox_event_public_id = ?
      ORDER BY dependency_entity_type,dependency_entity_public_id,minimum_version
      LIMIT 1 OFFSET ?
    `).bind(tenantId, eventPublicId, offset).first<DependencyEvidenceRow>();
    if (!row) break;
    rows.push(row);
  }
  return rows;
}

async function assertReplayOrConflict(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
): Promise<CanonicalSyncReceiveResult | null> {
  const existing = await loadInboxEvidence(db, envelope);
  if (!existing) return null;
  const dependencies = await loadDependencyEvidence(db, envelope.tenantId, existing.event_public_id);
  if (
    evidenceMatches(existing, envelope)
    && stableCanonicalJson(dependencies) === stableCanonicalJson(normalizeDependencies(envelope.dependencies))
  ) {
    return { status: 'replayed', eventPublicId: envelope.eventPublicId };
  }
  throw new CanonicalSyncInboxConflictError(
    `Canonical sync event or idempotency identity conflicts for ${envelope.eventPublicId}`,
  );
}

export async function inspectCanonicalSyncInboxEnvelope(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
): Promise<CanonicalSyncInboxLifecycleReceipt | null> {
  const validated = await validateCanonicalSyncEnvelope(envelope);
  const existing = await loadInboxEvidence(db, validated);
  if (!existing) return null;
  const dependencies = await loadDependencyEvidence(db, validated.tenantId, existing.event_public_id);
  if (
    !evidenceMatches(existing, validated)
    || stableCanonicalJson(dependencies) !== stableCanonicalJson(normalizeDependencies(validated.dependencies))
  ) {
    throw new CanonicalSyncInboxConflictError(
      `Canonical sync event or idempotency identity conflicts for ${validated.eventPublicId}`,
    );
  }

  const lifecycle = await db.prepare(`
    SELECT status,attempt_count,claim_public_id,claim_owner_public_id,
           claim_expires_at_utc,next_attempt_at_utc,applied_at_utc,error_code,error_hash
    FROM canonical_sync_inbox_events
    WHERE tenant_id = ? AND event_public_id = ?
    LIMIT 1
  `).bind(validated.tenantId, existing.event_public_id).first<InboxLifecycleRow>();
  if (!lifecycle) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox lifecycle evidence is missing for ${validated.eventPublicId}`,
    );
  }

  const allowedStatuses: readonly CanonicalSyncInboxLifecycleStatus[] = [
    'pending', 'applying', 'applied', 'retry', 'dead_letter',
  ];
  if (!allowedStatuses.includes(lifecycle.status as CanonicalSyncInboxLifecycleStatus)) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox lifecycle status is unsupported for ${validated.eventPublicId}`,
    );
  }
  const attemptCount = Number(lifecycle.attempt_count);
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox attempt evidence is invalid for ${validated.eventPublicId}`,
    );
  }
  const status = lifecycle.status as CanonicalSyncInboxLifecycleStatus;
  const hasClaim = lifecycle.claim_public_id != null
    || lifecycle.claim_owner_public_id != null
    || lifecycle.claim_expires_at_utc != null;
  if (status === 'applying') {
    if (
      lifecycle.claim_public_id == null
      || lifecycle.claim_owner_public_id == null
      || lifecycle.claim_expires_at_utc == null
    ) {
      throw new CanonicalSyncInboxStateError(
        `Canonical sync inbox claim evidence is incomplete for ${validated.eventPublicId}`,
      );
    }
    assertUtc(lifecycle.claim_expires_at_utc, 'stored claimExpiresAtUtc');
  } else if (hasClaim) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox claim evidence is inconsistent for ${validated.eventPublicId}`,
    );
  }
  if (status === 'retry') {
    if (lifecycle.next_attempt_at_utc == null) {
      throw new CanonicalSyncInboxStateError(
        `Canonical sync inbox retry evidence is incomplete for ${validated.eventPublicId}`,
      );
    }
    assertUtc(lifecycle.next_attempt_at_utc, 'stored nextAttemptAtUtc');
  } else if (lifecycle.next_attempt_at_utc != null) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox retry evidence is inconsistent for ${validated.eventPublicId}`,
    );
  }
  if (status === 'applied') {
    if (lifecycle.applied_at_utc == null) {
      throw new CanonicalSyncInboxStateError(
        `Canonical sync inbox applied evidence is incomplete for ${validated.eventPublicId}`,
      );
    }
    assertUtc(lifecycle.applied_at_utc, 'stored appliedAtUtc');
  } else if (lifecycle.applied_at_utc != null) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox applied evidence is inconsistent for ${validated.eventPublicId}`,
    );
  }
  if (status === 'retry' || status === 'dead_letter') {
    assertErrorEvidence(lifecycle.error_code, lifecycle.error_hash);
  } else if (lifecycle.error_code != null || lifecycle.error_hash != null) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync inbox error evidence is inconsistent for ${validated.eventPublicId}`,
    );
  }

  return {
    tenantId: validated.tenantId,
    eventPublicId: existing.event_public_id,
    status,
    attemptCount,
    claimPublicId: lifecycle.claim_public_id,
    claimOwnerPublicId: lifecycle.claim_owner_public_id,
    claimExpiresAtUtc: lifecycle.claim_expires_at_utc,
    nextAttemptAtUtc: lifecycle.next_attempt_at_utc,
    appliedAtUtc: lifecycle.applied_at_utc,
    errorCode: lifecycle.error_code,
    errorHash: lifecycle.error_hash,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/unique constraint|constraint failed.*unique|uq_canonical_sync_inbox/i.test(message)) return true;
    if (typeof current !== 'object') break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function isSyncAssertionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical_sync_batch_assertions|assertion_value/i.test(message)) return true;
    if (typeof current !== 'object') break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function prepareSyncAssertion(
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

function prepareClearSyncAssertions(
  db: CanonicalBatchDatabase,
  tenantId: string,
  operationKey: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    DELETE FROM canonical_sync_batch_assertions
    WHERE tenant_id = ? AND operation_key = ?
  `).bind(tenantId, operationKey);
}

async function operationKey(kind: string, evidence: Record<string, unknown>): Promise<string> {
  return `${kind}:${await createRequestFingerprint(evidence)}`;
}

export async function receiveCanonicalSyncEnvelope(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  receivedAtUtc: string,
): Promise<CanonicalSyncReceiveResult> {
  await validateCanonicalSyncEnvelope(envelope);
  assertUtc(receivedAtUtc, 'receivedAtUtc');

  const replay = await assertReplayOrConflict(db, envelope);
  if (replay) return replay;

  const inboxPublicId = `sync-inbox-${envelope.idempotencyKey.slice(0, 40)}`;
  const payloadJson = stableCanonicalJson(envelope.payload);
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_sync_inbox_events (
        tenant_id,inbox_public_id,event_public_id,protocol_version,
        entity_type,entity_public_id,event_type,aggregate_version,operation,
        occurred_at_utc,payload_json,payload_sha256,idempotency_key,source_node_public_id,
        status,attempt_count,received_at_utc,updated_at_utc
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    `).bind(
      envelope.tenantId,
      inboxPublicId,
      envelope.eventPublicId,
      envelope.entityType,
      envelope.entityPublicId,
      envelope.eventType,
      envelope.aggregateVersion,
      envelope.operation,
      envelope.occurredAtUtc,
      payloadJson,
      envelope.payloadSha256,
      envelope.idempotencyKey,
      envelope.sourceNodePublicId,
      receivedAtUtc,
      receivedAtUtc,
    ),
    ...envelope.dependencies.map((dependency) => db.prepare(`
      INSERT INTO canonical_sync_inbox_dependencies (
        tenant_id,inbox_event_public_id,dependency_entity_type,
        dependency_entity_public_id,minimum_version
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      envelope.tenantId,
      envelope.eventPublicId,
      dependency.entityType,
      dependency.entityPublicId,
      dependency.minimumVersion,
    )),
  ];

  try {
    await db.batch(statements);
    return { status: 'received', eventPublicId: envelope.eventPublicId };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await assertReplayOrConflict(db, envelope);
    if (raced) return raced;
    throw new CanonicalSyncInboxConflictError(
      `Concurrent canonical sync receive conflicted for ${envelope.eventPublicId}`,
    );
  }
}

export async function claimCanonicalSyncInboxEvent(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    claimPublicId: string;
    claimOwnerPublicId: string;
    claimedAtUtc: string;
    claimExpiresAtUtc: string;
  },
): Promise<CanonicalSyncClaimReceipt> {
  assertExact(input.tenantId, 'tenantId', 128);
  assertPublicId(input.eventPublicId, 'eventPublicId', 160);
  assertPublicId(input.claimPublicId, 'claimPublicId', 160);
  assertPublicId(input.claimOwnerPublicId, 'claimOwnerPublicId', 192);
  assertUtc(input.claimedAtUtc, 'claimedAtUtc');
  assertUtc(input.claimExpiresAtUtc, 'claimExpiresAtUtc');
  if (Date.parse(input.claimExpiresAtUtc) <= Date.parse(input.claimedAtUtc)) {
    throw new RangeError('claimExpiresAtUtc must be later than claimedAtUtc');
  }

  const key = await operationKey('claim', input);
  const update = db.prepare(`
    UPDATE canonical_sync_inbox_events
    SET status = 'applying',
        claim_public_id = ?,
        claim_owner_public_id = ?,
        claim_expires_at_utc = ?,
        next_attempt_at_utc = NULL,
        error_code = NULL,
        error_hash = NULL,
        applied_at_utc = NULL,
        attempt_count = attempt_count + 1,
        updated_at_utc = ?
    WHERE tenant_id = ?
      AND event_public_id = ?
      AND (
        status = 'pending'
        OR (status = 'retry' AND next_attempt_at_utc <= ?)
        OR (status = 'applying' AND claim_expires_at_utc <= ?)
      )
  `).bind(
    input.claimPublicId,
    input.claimOwnerPublicId,
    input.claimExpiresAtUtc,
    input.claimedAtUtc,
    input.tenantId,
    input.eventPublicId,
    input.claimedAtUtc,
    input.claimedAtUtc,
  );

  try {
    await db.batch([
      prepareClearSyncAssertions(db, input.tenantId, key),
      update,
      prepareSyncAssertion(db, {
        tenantId: input.tenantId,
        operationKey: key,
        stepKey: 'claim',
        expectedChanges: 1,
        createdAtUtc: input.claimedAtUtc,
      }),
      prepareClearSyncAssertions(db, input.tenantId, key),
    ]);
  } catch (error) {
    if (isSyncAssertionError(error)) {
      throw new CanonicalSyncInboxStateError(
        `Canonical sync event ${input.eventPublicId} is not claimable`,
        { cause: error },
      );
    }
    throw error;
  }

  const claimed = await db.prepare(`
    SELECT tenant_id,event_public_id,claim_public_id,claim_owner_public_id,
           claim_expires_at_utc,attempt_count
    FROM canonical_sync_inbox_events
    WHERE tenant_id = ? AND event_public_id = ?
      AND status = 'applying' AND claim_public_id = ?
  `).bind(input.tenantId, input.eventPublicId, input.claimPublicId).first<ClaimedRow>();
  if (!claimed) {
    throw new CanonicalSyncInboxStateError(
      `Canonical sync claim receipt is missing for ${input.eventPublicId}`,
    );
  }
  return {
    tenantId: claimed.tenant_id,
    eventPublicId: claimed.event_public_id,
    claimPublicId: claimed.claim_public_id,
    claimOwnerPublicId: claimed.claim_owner_public_id,
    claimExpiresAtUtc: claimed.claim_expires_at_utc,
    attemptCount: claimed.attempt_count,
  };
}

async function transitionClaimedEvent(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    claimPublicId: string;
    updatedAtUtc: string;
    status: 'retry' | 'dead_letter';
    nextAttemptAtUtc: string | null;
    errorCode: string;
    errorHash: string;
  },
): Promise<void> {
  assertExact(input.tenantId, 'tenantId', 128);
  assertPublicId(input.eventPublicId, 'eventPublicId', 160);
  assertPublicId(input.claimPublicId, 'claimPublicId', 160);
  assertUtc(input.updatedAtUtc, 'updatedAtUtc');
  assertErrorEvidence(input.errorCode, input.errorHash);
  if (input.status === 'retry') {
    assertUtc(input.nextAttemptAtUtc, 'nextAttemptAtUtc');
    if (Date.parse(input.nextAttemptAtUtc) <= Date.parse(input.updatedAtUtc)) {
      throw new RangeError('nextAttemptAtUtc must be later than updatedAtUtc');
    }
  } else if (input.nextAttemptAtUtc !== null) {
    throw new TypeError('dead-letter transitions cannot retain nextAttemptAtUtc');
  }

  const key = await operationKey(input.status, input);
  try {
    await db.batch([
      prepareClearSyncAssertions(db, input.tenantId, key),
      db.prepare(`
        UPDATE canonical_sync_inbox_events
        SET status = ?,
            claim_public_id = NULL,
            claim_owner_public_id = NULL,
            claim_expires_at_utc = NULL,
            next_attempt_at_utc = ?,
            error_code = ?,
            error_hash = ?,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND event_public_id = ?
          AND status = 'applying'
          AND claim_public_id = ?
          AND claim_expires_at_utc > ?
      `).bind(
        input.status,
        input.nextAttemptAtUtc,
        input.errorCode,
        input.errorHash,
        input.updatedAtUtc,
        input.tenantId,
        input.eventPublicId,
        input.claimPublicId,
        input.updatedAtUtc,
      ),
      prepareSyncAssertion(db, {
        tenantId: input.tenantId,
        operationKey: key,
        stepKey: input.status,
        expectedChanges: 1,
        createdAtUtc: input.updatedAtUtc,
      }),
      prepareClearSyncAssertions(db, input.tenantId, key),
    ]);
  } catch (error) {
    if (isSyncAssertionError(error)) {
      throw new CanonicalSyncInboxStateError(
        `Canonical sync ${input.status} transition rejected for ${input.eventPublicId}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function scheduleCanonicalSyncRetry(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    claimPublicId: string;
    updatedAtUtc: string;
    nextAttemptAtUtc: string;
    errorCode: string;
    errorHash: string;
  },
): Promise<void> {
  return transitionClaimedEvent(db, {
    ...input,
    status: 'retry',
  });
}

export async function deadLetterCanonicalSyncInboxEvent(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    claimPublicId: string;
    updatedAtUtc: string;
    errorCode: string;
    errorHash: string;
  },
): Promise<void> {
  return transitionClaimedEvent(db, {
    ...input,
    status: 'dead_letter',
    nextAttemptAtUtc: null,
  });
}

export async function completeCanonicalSyncInboxEvent(
  db: CanonicalBatchDatabase,
  input: {
    envelope: CanonicalSyncEnvelope;
    claimPublicId: string;
    appliedAtUtc: string;
    authoritativeStatements: readonly CanonicalPreparedStatement[];
  },
): Promise<void> {
  const envelope = await validateCanonicalSyncEnvelope(input.envelope);
  assertPublicId(input.claimPublicId, 'claimPublicId', 160);
  assertUtc(input.appliedAtUtc, 'appliedAtUtc');
  if (!Array.isArray(input.authoritativeStatements) || input.authoritativeStatements.length === 0) {
    throw new TypeError('authoritativeStatements must contain at least one canonical business mutation');
  }

  const key = await operationKey('apply', {
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    entityType: envelope.entityType,
    entityPublicId: envelope.entityPublicId,
    aggregateVersion: envelope.aggregateVersion,
    claimPublicId: input.claimPublicId,
  });

  const versionMutation = envelope.aggregateVersion === 1
    ? db.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, entity_type, entity_public_id)
        DO UPDATE SET
          applied_version = 1,
          last_event_public_id = excluded.last_event_public_id,
          last_operation = excluded.last_operation,
          last_payload_sha256 = excluded.last_payload_sha256,
          updated_at_utc = excluded.updated_at_utc
        WHERE canonical_sync_entity_versions.applied_version = 0
      `).bind(
        envelope.tenantId,
        envelope.entityType,
        envelope.entityPublicId,
        envelope.eventPublicId,
        envelope.operation,
        envelope.payloadSha256,
        input.appliedAtUtc,
      )
    : db.prepare(`
        UPDATE canonical_sync_entity_versions
        SET applied_version = ?,
            last_event_public_id = ?,
            last_operation = ?,
            last_payload_sha256 = ?,
            updated_at_utc = ?
        WHERE tenant_id = ?
          AND entity_type = ?
          AND entity_public_id = ?
          AND applied_version = ?
      `).bind(
        envelope.aggregateVersion,
        envelope.eventPublicId,
        envelope.operation,
        envelope.payloadSha256,
        input.appliedAtUtc,
        envelope.tenantId,
        envelope.entityType,
        envelope.entityPublicId,
        envelope.aggregateVersion - 1,
      );

  const inboxMutation = db.prepare(`
    UPDATE canonical_sync_inbox_events
    SET status = 'applied',
        claim_public_id = NULL,
        claim_owner_public_id = NULL,
        claim_expires_at_utc = NULL,
        next_attempt_at_utc = NULL,
        applied_at_utc = ?,
        updated_at_utc = ?,
        error_code = NULL,
        error_hash = NULL
    WHERE tenant_id = ?
      AND event_public_id = ?
      AND status = 'applying'
      AND claim_public_id = ?
      AND claim_expires_at_utc > ?
      AND protocol_version = 1
      AND entity_type = ?
      AND entity_public_id = ?
      AND event_type = ?
      AND aggregate_version = ?
      AND operation = ?
      AND occurred_at_utc = ?
      AND payload_sha256 = ?
      AND idempotency_key = ?
      AND source_node_public_id = ?
  `).bind(
    input.appliedAtUtc,
    input.appliedAtUtc,
    envelope.tenantId,
    envelope.eventPublicId,
    input.claimPublicId,
    input.appliedAtUtc,
    envelope.entityType,
    envelope.entityPublicId,
    envelope.eventType,
    envelope.aggregateVersion,
    envelope.operation,
    envelope.occurredAtUtc,
    envelope.payloadSha256,
    envelope.idempotencyKey,
    envelope.sourceNodePublicId,
  );

  try {
    await db.batch([
      prepareClearSyncAssertions(db, envelope.tenantId, key),
      ...input.authoritativeStatements,
      versionMutation,
      prepareSyncAssertion(db, {
        tenantId: envelope.tenantId,
        operationKey: key,
        stepKey: 'entity-version',
        expectedChanges: 1,
        createdAtUtc: input.appliedAtUtc,
      }),
      inboxMutation,
      prepareSyncAssertion(db, {
        tenantId: envelope.tenantId,
        operationKey: key,
        stepKey: 'inbox-applied',
        expectedChanges: 1,
        createdAtUtc: input.appliedAtUtc,
      }),
      prepareClearSyncAssertions(db, envelope.tenantId, key),
    ]);
  } catch (error) {
    if (isSyncAssertionError(error)) {
      throw new CanonicalSyncInboxStateError(
        `Canonical sync apply receipt rejected for ${envelope.eventPublicId}`,
        { cause: error },
      );
    }
    throw error;
  }
}
