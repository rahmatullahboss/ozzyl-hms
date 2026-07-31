import {
  CanonicalIdempotencyConflictError,
  createRequestFingerprint,
  parseCanonicalCommandEnvelope,
  stableCanonicalJson,
  type CanonicalCommandEnvelope,
} from './idempotency';
import { toUtcIso } from './time';

export interface CanonicalPreparedStatement {
  bind(...values: unknown[]): CanonicalPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/**
 * Minimal transaction/batch adapter implemented by D1 and by local test adapters.
 * Domain command definitions do not depend on a global D1 binding.
 */
export interface CanonicalBatchDatabase {
  prepare(sql: string): CanonicalPreparedStatement;
  batch(statements: CanonicalPreparedStatement[]): Promise<unknown[]>;
}

export interface CanonicalCommandExecutionOptions {
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
}

export interface CanonicalOutboxEvent {
  eventPublicId: string;
  aggregateType: string;
  aggregatePublicId: string;
  eventType: string;
  eventVersion?: number;
  payload: unknown;
  occurredAtUtc: string;
  businessDate?: string | null;
}

export interface CanonicalBatch<T> {
  tenantId: string;
  commandName: string;
  idempotencyKey: string;
  request: unknown;
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
  statements: readonly CanonicalPreparedStatement[];
  reconciliationStatements?: readonly CanonicalPreparedStatement[];
  /** Replay-safe response metadata only; do not store PHI or free-text clinical content here. */
  result: T;
  event: CanonicalOutboxEvent;
}

export type CanonicalCommandResult<T> =
  | { status: 'applied'; result: T }
  | { status: 'replayed'; result: T };

export type PreparedCanonicalBatch<T> =
  | { status: 'replayed'; result: T; statements: readonly CanonicalPreparedStatement[] }
  | { status: 'prepared'; result: T; statements: readonly CanonicalPreparedStatement[] };

interface StoredOutboxRow {
  payload_json: string;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function validateBusinessDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('businessDate must use YYYY-MM-DD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year
    || instant.getUTCMonth() !== month - 1
    || instant.getUTCDate() !== day
  ) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
}

function validateEvent(event: CanonicalOutboxEvent): Required<Pick<CanonicalOutboxEvent, 'eventVersion'>> {
  requireNonEmpty(event.eventPublicId, 'eventPublicId');
  requireNonEmpty(event.aggregateType, 'aggregateType');
  requireNonEmpty(event.aggregatePublicId, 'aggregatePublicId');
  requireNonEmpty(event.eventType, 'eventType');

  if (toUtcIso(event.occurredAtUtc) !== event.occurredAtUtc) {
    throw new RangeError('occurredAtUtc must be a normalized UTC ISO timestamp');
  }
  if (event.businessDate != null) validateBusinessDate(event.businessDate);

  const eventVersion = event.eventVersion ?? 1;
  if (!Number.isInteger(eventVersion) || eventVersion <= 0) {
    throw new RangeError('eventVersion must be a positive integer');
  }
  return { eventVersion };
}

async function readStoredEnvelope<T>(
  db: CanonicalBatchDatabase,
  tenantId: string,
  idempotencyKey: string,
): Promise<CanonicalCommandEnvelope<T> | null> {
  const row = await db
    .prepare(
      `SELECT payload_json
       FROM canonical_outbox_events
       WHERE tenant_id = ? AND idempotency_key = ?
       LIMIT 1`,
    )
    .bind(tenantId, idempotencyKey)
    .first<StoredOutboxRow>();

  if (!row) return null;
  return parseCanonicalCommandEnvelope<T>(String(row.payload_json));
}

function replayOrConflict<T>(
  envelope: CanonicalCommandEnvelope<T>,
  input: { tenantId: string; idempotencyKey: string; commandName: string; requestFingerprint: string },
): CanonicalCommandResult<T> {
  if (
    envelope.command.name !== input.commandName
    || envelope.command.requestFingerprint !== input.requestFingerprint
  ) {
    throw new CanonicalIdempotencyConflictError(input.tenantId, input.idempotencyKey);
  }
  return { status: 'replayed', result: envelope.command.result };
}

/** Reads a previously committed command result before state-dependent validation. */
export async function readCanonicalCommandReplay<T>(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    commandName: string;
    idempotencyKey: string;
    request: unknown;
  },
): Promise<CanonicalCommandResult<T> | null> {
  const tenantId = requireNonEmpty(input.tenantId, 'tenantId');
  const commandName = requireNonEmpty(input.commandName, 'commandName');
  const idempotencyKey = requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
  const requestFingerprint = await createRequestFingerprint(input.request);
  const envelope = await readStoredEnvelope<T>(db, tenantId, idempotencyKey);
  if (!envelope) return null;
  return replayOrConflict(envelope, {
    tenantId,
    idempotencyKey,
    commandName,
    requestFingerprint,
  });
}

/**
 * Prepares one replay-safe Canonical command without executing it. This enables
 * multiple reviewed command claims and their business statements to be committed
 * by one outer D1 batch while preserving the same idempotency envelope used by
 * `runCanonicalBatch`.
 */
export async function prepareCanonicalBatch<T>(
  db: CanonicalBatchDatabase,
  command: CanonicalBatch<T>,
): Promise<PreparedCanonicalBatch<T>> {
  const tenantId = requireNonEmpty(command.tenantId, 'tenantId');
  const commandName = requireNonEmpty(command.commandName, 'commandName');
  const idempotencyKey = requireNonEmpty(command.idempotencyKey, 'idempotencyKey');
  const { eventVersion } = validateEvent(command.event);
  const requestFingerprint = await createRequestFingerprint(command.request);
  const existing = await readStoredEnvelope<T>(db, tenantId, idempotencyKey);
  if (existing) {
    const replay = replayOrConflict(existing, { tenantId, idempotencyKey, commandName, requestFingerprint });
    return { status: 'replayed', result: replay.result, statements: [] };
  }

  const envelope: CanonicalCommandEnvelope<T> = {
    schemaVersion: 1,
    command: {
      name: commandName,
      requestFingerprint,
      result: command.result,
    },
    event: command.event.payload,
  };
  const payloadJson = stableCanonicalJson(envelope);
  const claimAndOutbox = db.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,'pending')
  `).bind(
    tenantId,
    command.event.eventPublicId,
    command.event.aggregateType,
    command.event.aggregatePublicId,
    command.event.eventType,
    eventVersion,
    payloadJson,
    command.event.occurredAtUtc,
    command.event.businessDate ?? null,
    idempotencyKey,
  );
  return {
    status: 'prepared',
    result: command.result,
    statements: [
      claimAndOutbox,
      ...(command.authoritativeStatements ?? []),
      ...command.statements,
      ...(command.reconciliationStatements ?? []),
    ],
  };
}

/**
 * Runs one canonical command as a D1 atomic batch.
 *
 * The outbox insert is also the tenant-scoped idempotency claim. It is submitted
 * in the same batch as domain and reconciliation writes, so any failure rolls
 * back the claim, event, and all business state together.
 */
export async function runCanonicalBatch<T>(
  db: CanonicalBatchDatabase,
  command: CanonicalBatch<T>,
): Promise<CanonicalCommandResult<T>> {
  const prepared = await prepareCanonicalBatch(db, command);
  if (prepared.status === 'replayed') {
    return { status: 'replayed', result: prepared.result };
  }

  try {
    await db.batch([...prepared.statements]);
    return { status: 'applied', result: command.result };
  } catch (error) {
    const tenantId = requireNonEmpty(command.tenantId, 'tenantId');
    const commandName = requireNonEmpty(command.commandName, 'commandName');
    const idempotencyKey = requireNonEmpty(command.idempotencyKey, 'idempotencyKey');
    const requestFingerprint = await createRequestFingerprint(command.request);
    // A concurrent request may have won the unique tenant/key claim. D1 rolls
    // back this whole batch before this read, so replay is safe and deterministic.
    const raced = await readStoredEnvelope<T>(db, tenantId, idempotencyKey);
    if (raced) {
      return replayOrConflict(raced, { tenantId, idempotencyKey, commandName, requestFingerprint });
    }
    throw error;
  }
}
