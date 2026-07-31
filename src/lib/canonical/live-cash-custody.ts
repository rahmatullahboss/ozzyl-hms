import type { DecimalAmount } from './money';
import { toMinorUnits } from './money';
import {
  type CanonicalBatchDatabase,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
  type PreparedCanonicalBatch,
} from './command-batch';
import {
  prepareRecordCashCustodyMovement,
  recordCashCustodyMovement,
  type CashCustodyDirection,
  type CashCustodyMovementType,
  type CashCustodyType,
  type RecordCashCustodyMovementResult,
} from './contracts/manage-cash-custody';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import {
  executeStrictFinancialMutation,
  type FinancialMutationExecution,
} from './strict-financial-mutation';
import { toUtcIso } from './time';

export interface LiveCashCustodyMovementInput {
  tenantId: string;
  legacyStatements?: readonly CanonicalPreparedStatement[];
  custodyPublicId?: string | null;
  custodyType: CashCustodyType;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
  movementType: CashCustodyMovementType;
  direction: CashCustodyDirection;
  amount: DecimalAmount;
  occurredAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  idempotencyKey?: string | null;
  outboxEventPublicId?: string | null;
  evidence?: Record<string, unknown>;
}

export type LiveCashCustodyMovementExecution = FinancialMutationExecution<
  CanonicalCommandResult<RecordCashCustodyMovementResult>
>;

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function validBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('businessDate must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

async function resolveCommandInput(input: LiveCashCustodyMovementInput) {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const occurredAtUtc = toUtcIso(input.occurredAtUtc);
  const businessDate = validBusinessDate(input.businessDate);
  const amountMinor = Number(toMinorUnits(input.amount));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError('Cash custody amount must be a positive safe integer in minor units');
  }
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    sourceTable,
    custodyPublicId: input.custodyPublicId ?? null,
    custodyType: input.custodyType,
    legacyCounterId: input.legacyCounterId ?? null,
    legacyCounterSessionId: input.legacyCounterSessionId ?? null,
    movementType: input.movementType,
    direction: input.direction,
    amountMinor,
    occurredAtUtc,
    businessDate,
    evidence: input.evidence ?? {},
  });
  const idempotencyKey = exact(
    input.idempotencyKey?.trim() || `cash-custody:${sourceType}:${sourcePublicId}`,
    'idempotencyKey',
  );
  const outboxEventPublicId = input.outboxEventPublicId?.trim()
    ? exact(input.outboxEventPublicId.trim(), 'outboxEventPublicId')
    : await createDeterministicSourceId(
        'outevt',
        tenantId,
        'canonical_cash_custody_movement',
        `${sourceType}:${sourcePublicId}`,
      );
  return {
    tenantId,
    custodyPublicId: input.custodyPublicId ?? null,
    custodyType: input.custodyType,
    legacyCounterId: input.legacyCounterId ?? null,
    legacyCounterSessionId: input.legacyCounterSessionId ?? null,
    movementType: input.movementType,
    direction: input.direction,
    amountMinor,
    occurredAtUtc,
    businessDate,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    idempotencyKey,
    outboxEventPublicId,
  } as const;
}

export async function prepareLiveCashCustodyMovement(
  db: CanonicalBatchDatabase,
  input: LiveCashCustodyMovementInput,
): Promise<PreparedCanonicalBatch<RecordCashCustodyMovementResult>> {
  return prepareRecordCashCustodyMovement(db, await resolveCommandInput(input));
}

export async function executeLiveCashCustodyMovement(
  db: CanonicalBatchDatabase,
  input: LiveCashCustodyMovementInput,
): Promise<LiveCashCustodyMovementExecution> {
  const commandInput = await resolveCommandInput(input);
  const legacyStatements = input.legacyStatements ?? [];
  return executeStrictFinancialMutation({
    db,
    tenantId: commandInput.tenantId,
    boundary: 'cash-custody.movement',
    legacyStatements,
    strictAuthoritativeStatements: legacyStatements,
    canonical: (execution) => recordCashCustodyMovement(db, commandInput, execution),
  });
}
