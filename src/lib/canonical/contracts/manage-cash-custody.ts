import {
  prepareCanonicalBatch,
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type PreparedCanonicalBatch,
} from '../command-batch';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';

export type CashCustodyMovementType =
  | 'collection'
  | 'refund'
  | 'expense'
  | 'payroll'
  | 'practitioner_payout'
  | 'handover'
  | 'adjustment'
  | 'shadow';

export type CashCustodyDirection = 'in' | 'out' | 'neutral';
export type CashCustodyType = 'counter_session' | 'user' | 'safe' | 'bank_transit' | 'other';

export interface RecordCashCustodyMovementInput {
  tenantId: string;
  custodyPublicId?: string | null;
  custodyType: CashCustodyType;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
  movementType: CashCustodyMovementType;
  direction: CashCustodyDirection;
  amountMinor: number;
  occurredAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface RecordCashCustodyMovementResult {
  custodyPublicId: string;
  custodyMovementPublicId: string;
  outboxEventPublicId: string;
  movementType: CashCustodyMovementType;
  direction: CashCustodyDirection;
  amountMinor: number;
}

export interface ReverseCashCustodyMovementInput {
  tenantId: string;
  originalCustodyMovementPublicId: string;
  occurredAtUtc: string;
  businessDate: string;
  reasonCode: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface CloseCashCustodySessionInput {
  tenantId: string;
  custodyPublicId: string;
  expectedBalanceMinor: number;
  countedMinor: number;
  occurredAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface CloseCashCustodySessionResult {
  custodyPublicId: string;
  balanceMinor: number;
  countedMinor: number;
  varianceMinor: number;
  closeEventPublicId: string;
}

type CashMovementRow = {
  custody_movement_public_id: string;
  custody_public_id: string;
  movement_type: CashCustodyMovementType;
  direction: CashCustodyDirection;
  amount_minor: number;
  legacy_counter_id: number | null;
  legacy_counter_session_id: number | null;
  occurred_at_utc: string;
  business_date: string;
  source_evidence_sha256: string;
};

type CashBalanceRow = {
  custody_public_id: string;
  custody_type: CashCustodyType;
  legacy_counter_id: number | null;
  legacy_counter_session_id: number | null;
  balance_minor: number;
  version: number;
};

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function optionalPositive(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function safeMinor(value: number, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new RangeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`);
  }
  return value;
}

function normalizedUtc(value: string, label: string): string {
  if (new Date(value).toISOString() !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

function validBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function resolveCustodyPublicId(input: {
  custodyPublicId?: string | null;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
}): string {
  const sessionId = optionalPositive(input.legacyCounterSessionId, 'legacyCounterSessionId');
  const counterId = optionalPositive(input.legacyCounterId, 'legacyCounterId');
  if (sessionId != null) return `counter-session:${sessionId}`;
  if (counterId != null) return `counter:${counterId}`;
  return exact(input.custodyPublicId ?? '', 'custodyPublicId');
}

function opposite(direction: CashCustodyDirection): CashCustodyDirection {
  if (direction === 'in') return 'out';
  if (direction === 'out') return 'in';
  return 'neutral';
}

function movementMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    custodyMovementPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    sourceEvidenceSha256: string;
  },
) {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'cash_custody_movement',?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    input.custodyMovementPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

async function resolveRecordInput(
  input: RecordCashCustodyMovementInput,
): Promise<{
  tenantId: string;
  custodyPublicId: string;
  custodyMovementPublicId: string;
  eventType: string;
  request: Record<string, unknown>;
  result: RecordCashCustodyMovementResult;
}> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const custodyPublicId = resolveCustodyPublicId(input);
  const legacyCounterId = optionalPositive(input.legacyCounterId, 'legacyCounterId');
  const legacyCounterSessionId = optionalPositive(input.legacyCounterSessionId, 'legacyCounterSessionId');
  if (!['counter_session', 'user', 'safe', 'bank_transit', 'other'].includes(input.custodyType)) {
    throw new TypeError('custodyType is invalid');
  }
  if (![
    'collection', 'refund', 'expense', 'payroll', 'practitioner_payout',
    'handover', 'adjustment', 'shadow',
  ].includes(input.movementType)) {
    throw new TypeError('movementType is invalid');
  }
  if (!['in', 'out', 'neutral'].includes(input.direction)) {
    throw new TypeError('direction is invalid');
  }
  const amountMinor = safeMinor(input.amountMinor, 'amountMinor');
  const occurredAtUtc = normalizedUtc(input.occurredAtUtc, 'occurredAtUtc');
  const businessDate = validBusinessDate(input.businessDate);
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const sourceEvidenceSha256 = digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const idempotencyKey = exact(input.idempotencyKey, 'idempotencyKey');
  const outboxEventPublicId = exact(input.outboxEventPublicId, 'outboxEventPublicId');
  const eventType = 'canonical.cash_custody.movement_recorded';
  const custodyMovementPublicId = await createDeterministicSourceId(
    'cashmove', tenantId, eventType, outboxEventPublicId,
  );
  const request = {
    custodyPublicId,
    custodyMovementPublicId,
    custodyType: input.custodyType,
    legacyCounterId,
    legacyCounterSessionId,
    movementType: input.movementType,
    direction: input.direction,
    amountMinor,
    occurredAtUtc,
    businessDate,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
  };
  return {
    tenantId,
    custodyPublicId,
    custodyMovementPublicId,
    eventType,
    request,
    result: {
      custodyPublicId,
      custodyMovementPublicId,
      outboxEventPublicId,
      movementType: input.movementType,
      direction: input.direction,
      amountMinor,
    },
  };
}

export async function prepareRecordCashCustodyMovement(
  db: CanonicalBatchDatabase,
  input: RecordCashCustodyMovementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<PreparedCanonicalBatch<RecordCashCustodyMovementResult>> {
  const resolved = await resolveRecordInput(input);
  const replay = await readCanonicalCommandReplay<RecordCashCustodyMovementResult>(db, {
    tenantId: resolved.tenantId,
    commandName: 'canonical.cash_custody.movement.record',
    idempotencyKey: input.idempotencyKey,
    request: resolved.request,
  });
  if (replay) return { status: 'replayed', result: replay.result, statements: [] };

  return prepareCanonicalBatch(db, {
    tenantId: resolved.tenantId,
    commandName: 'canonical.cash_custody.movement.record',
    idempotencyKey: input.idempotencyKey,
    request: resolved.request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [],
    reconciliationStatements: [movementMappingStatement(db, {
      tenantId: resolved.tenantId,
      custodyMovementPublicId: resolved.custodyMovementPublicId,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    })],
    result: resolved.result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_cash_custody',
      aggregatePublicId: resolved.custodyPublicId,
      eventType: resolved.eventType,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        custodyPublicId: resolved.custodyPublicId,
        custodyMovementPublicId: resolved.custodyMovementPublicId,
        custodyType: input.custodyType,
        counterId: input.legacyCounterId ?? null,
        counterSessionId: input.legacyCounterSessionId ?? null,
        movementType: input.movementType,
        direction: input.direction,
        amountMinor: input.amountMinor,
        sourceEvidenceSha256: input.sourceEvidenceSha256,
      },
    },
  });
}

export async function recordCashCustodyMovement(
  db: CanonicalBatchDatabase,
  input: RecordCashCustodyMovementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RecordCashCustodyMovementResult>> {
  const prepared = await prepareRecordCashCustodyMovement(db, input, execution);
  if (prepared.status === 'replayed') {
    return { status: 'replayed', result: prepared.result };
  }
  await db.batch([...prepared.statements]);
  return { status: 'applied', result: prepared.result };
}

export async function reverseCashCustodyMovement(
  db: CanonicalBatchDatabase,
  input: ReverseCashCustodyMovementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RecordCashCustodyMovementResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.originalCustodyMovementPublicId, 'originalCustodyMovementPublicId');
  exact(input.reasonCode, 'reasonCode');
  const original = await db.prepare(`
    SELECT custody_movement_public_id,custody_public_id,movement_type,direction,
           amount_minor,legacy_counter_id,legacy_counter_session_id,occurred_at_utc,
           business_date,source_evidence_sha256
    FROM canonical_cash_custody_movements
    WHERE tenant_id=? AND custody_movement_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.originalCustodyMovementPublicId).first<CashMovementRow>();
  if (!original) throw new Error('Canonical cash custody movement not found');
  const sourceEvidenceSha256 = digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  const reversalEvidence = await createSourceEvidenceSha256({
    originalCustodyMovementPublicId: original.custody_movement_public_id,
    originalSourceEvidenceSha256: original.source_evidence_sha256,
    reasonCode: input.reasonCode,
    callerSourceEvidenceSha256: sourceEvidenceSha256,
  });
  return recordCashCustodyMovement(db, {
    tenantId: input.tenantId,
    custodyPublicId: original.custody_public_id,
    custodyType: original.legacy_counter_session_id != null ? 'counter_session' : 'other',
    legacyCounterId: original.legacy_counter_id,
    legacyCounterSessionId: original.legacy_counter_session_id,
    movementType: 'adjustment',
    direction: opposite(original.direction),
    amountMinor: original.amount_minor,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: reversalEvidence,
    idempotencyKey: input.idempotencyKey,
    outboxEventPublicId: input.outboxEventPublicId,
  }, execution);
}

export async function closeCashCustodySession(
  db: CanonicalBatchDatabase,
  input: CloseCashCustodySessionInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CloseCashCustodySessionResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const custodyPublicId = exact(input.custodyPublicId, 'custodyPublicId');
  const expectedBalanceMinor = safeMinor(input.expectedBalanceMinor, 'expectedBalanceMinor', true);
  const countedMinor = safeMinor(input.countedMinor, 'countedMinor', true);
  normalizedUtc(input.occurredAtUtc, 'occurredAtUtc');
  validBusinessDate(input.businessDate);
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');

  const closeEventPublicId = await createDeterministicSourceId(
    'cashclose', tenantId, input.sourceType, input.sourcePublicId,
  );
  const varianceMinor = countedMinor - expectedBalanceMinor;
  const request = {
    custodyPublicId,
    expectedBalanceMinor,
    countedMinor,
    varianceMinor,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<CloseCashCustodySessionResult>(db, {
    tenantId,
    commandName: 'canonical.cash_custody.session.close',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const balance = await db.prepare(`
    SELECT custody_public_id,custody_type,legacy_counter_id,legacy_counter_session_id,
           balance_minor,version
    FROM canonical_cash_custody_balances
    WHERE tenant_id=? AND custody_public_id=?
    LIMIT 1
  `).bind(tenantId, custodyPublicId).first<CashBalanceRow>();
  if (!balance) throw new Error('Canonical cash custody balance not found');
  if (balance.balance_minor !== expectedBalanceMinor) {
    throw new Error('Canonical cash custody balance changed before close');
  }
  const result: CloseCashCustodySessionResult = {
    custodyPublicId,
    balanceMinor: expectedBalanceMinor,
    countedMinor,
    varianceMinor,
    closeEventPublicId,
  };
  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.cash_custody.session.close',
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [],
    reconciliationStatements: [db.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES (?,'cash_custody_close_event',?,?,?,?,'mapped',1,?)
    `).bind(
      tenantId,
      closeEventPublicId,
      input.sourceType,
      input.sourcePublicId,
      input.sourceTable,
      input.sourceEvidenceSha256,
    )],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_cash_custody',
      aggregatePublicId: custodyPublicId,
      eventType: 'canonical.cash_custody.session_closed',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        custodyPublicId,
        closeEventPublicId,
        balanceMinor: expectedBalanceMinor,
        countedMinor,
        varianceMinor,
        sourceEvidenceSha256: input.sourceEvidenceSha256,
      },
    },
  });
}
