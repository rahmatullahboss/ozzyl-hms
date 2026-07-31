import { stableCanonicalJson } from './canonical/idempotency';
import { prepareLiveCashCustodyMovement } from './canonical/live-cash-custody';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './canonical/command-batch';
import { getNextSequence } from './sequence';

export type CashLedgerDirection = 'in' | 'out' | 'transfer' | 'neutral';

export type CashLedgerWriteInput = {
  tenantId: string;
  sourceType: string;
  sourceId: string | number;
  sourceNo?: string | null;
  eventType: string;
  movementDirection: CashLedgerDirection;
  cashStatus: string;
  status?: string;
  amount: number;
  expectedAmount?: number | null;
  receivedAmount?: number | null;
  dueAmount?: number | null;
  varianceAmount?: number | null;
  paymentMethod?: string | null;
  fromUserId?: number | null;
  toUserId?: number | null;
  counterSessionId?: number | null;
  counterId?: number | null;
  currentLocationType: string;
  currentLocationLabel?: string | null;
  accountingVoucherId?: number | null;
  accountingPostingStatus?: string | null;
  referenceType?: string | null;
  referenceId?: string | number | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  createdBy?: number | null;
  occurredAt?: string | null;
  postedAt?: string | null;
  canonicalBridge?: {
    currencyCode: string;
    businessDate: string;
    sourceEvidenceSha256: string;
    accountingEventPublicId: string;
    cashCustodyEventPublicId: string;
    expenseMappingKey?: string;
    accountingEventType?:
      | 'canonical.accounting.expense.paid'
      | 'canonical.accounting.payroll.paid'
      | 'canonical.accounting.inventory_receipt.posted';
    settlementMode?: 'credit' | 'cash' | 'bank_transfer' | 'card' | 'mobile_wallet' | 'other';
  };
};

export type CashLedgerWriteResult = {
  inserted: boolean;
  ledgerEntryNo: string;
  idempotencyKey: string;
};

export type CashLedgerShadowWriteResult =
  | (CashLedgerWriteResult & { shadowSkipped?: false })
  | { inserted: false; ledgerEntryNo: null; idempotencyKey: string | null; shadowSkipped: true; errorMessage: string };

function assertNonEmpty(value: string | null | undefined, field: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error(`${field} is required for cash ledger entry`);
  return trimmed;
}

function assertAmount(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('amount must be a non-negative finite number for cash ledger entry');
  }
  return Math.round(amount * 100) / 100;
}

function optionalAmount(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  return assertAmount(value);
}

function bridgeMinorUnits(amount: number): number {
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error('canonical bridge amount must be a positive safe integer in minor units');
  }
  return minor;
}

async function canonicalBridgeStatements(
  db: D1Database,
  input: CashLedgerWriteInput,
  tenantId: string,
  sourceType: string,
  sourceId: string,
  amount: number,
  occurredAt: string,
  ledgerEntryNo: string,
  idempotencyKey: string,
): Promise<CanonicalPreparedStatement[]> {
  const bridge = input.canonicalBridge;
  if (!bridge) return [];
  if (!/^[A-Z]{3}$/.test(bridge.currencyCode)) throw new Error('canonical bridge currencyCode must use three uppercase letters');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bridge.businessDate)) throw new Error('canonical bridge businessDate must use YYYY-MM-DD');
  if (!/^[a-f0-9]{64}$/.test(bridge.sourceEvidenceSha256)) throw new Error('canonical bridge sourceEvidenceSha256 must be a lowercase SHA-256 digest');
  if (!occurredAt.endsWith('Z')) throw new Error('canonical bridge occurredAt must be a UTC timestamp');
  const accountingEventType = bridge.accountingEventType
    ?? (sourceType === 'expense' ? 'canonical.accounting.expense.paid' : null);
  if (!accountingEventType) throw new Error('canonical bridge accountingEventType is required for this cash source');
  const amountMinor = bridgeMinorUnits(amount);
  const aggregatePublicId = `${sourceType}:${sourceId}`;
  const accountingPayload: Record<string, unknown> = {
    amountMinor,
    currencyCode: bridge.currencyCode,
    paymentMethod: input.paymentMethod ?? 'cash',
    sourceEvidenceSha256: bridge.sourceEvidenceSha256,
  };
  if (accountingEventType === 'canonical.accounting.expense.paid') {
    accountingPayload.expenseMappingKey = bridge.expenseMappingKey ?? 'expense_default';
  }
  if (accountingEventType === 'canonical.accounting.inventory_receipt.posted') {
    accountingPayload.settlementMode = bridge.settlementMode ?? 'cash';
  }
  const direction = input.movementDirection === 'in'
    ? 'in'
    : input.movementDirection === 'out'
      ? 'out'
      : 'neutral';
  const custody = await prepareLiveCashCustodyMovement(
    db as unknown as CanonicalBatchDatabase,
    {
      tenantId,
      custodyPublicId: input.counterSessionId || input.counterId
        ? null
        : `aggregate:${aggregatePublicId}`,
      custodyType: input.counterSessionId ? 'counter_session' : 'other',
      legacyCounterId: input.counterId ?? null,
      legacyCounterSessionId: input.counterSessionId ?? null,
      movementType: 'shadow',
      direction,
      amount,
      occurredAtUtc: occurredAt,
      businessDate: bridge.businessDate,
      sourceType: 'legacy_cash_ledger_entry',
      sourcePublicId: idempotencyKey,
      sourceTable: 'cash_ledger_entries',
      idempotencyKey: `cash-ledger-custody:${idempotencyKey}`,
      outboxEventPublicId: bridge.cashCustodyEventPublicId,
      evidence: {
        ledgerEntryNo,
        sourceType,
        sourceId,
        eventType: input.eventType,
        movementDirection: input.movementDirection,
        cashStatus: input.cashStatus,
        currentLocationType: input.currentLocationType,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        sourceEvidenceSha256: bridge.sourceEvidenceSha256,
      },
    },
  );
  return [
    db.prepare(`
      INSERT OR IGNORE INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?, 'canonical_cash_bridge',?,?,1,?,?,?,?,'pending')
    `).bind(
      tenantId,
      bridge.accountingEventPublicId,
      aggregatePublicId,
      accountingEventType,
      stableCanonicalJson(accountingPayload),
      occurredAt,
      bridge.businessDate,
      `canonical-bridge:${bridge.accountingEventPublicId}`,
    ) as unknown as CanonicalPreparedStatement,
    ...custody.statements,
  ];
}

export function cashLedgerDefaultIdempotencyKey(input: CashLedgerWriteInput): string {
  return [
    input.tenantId,
    input.sourceType,
    String(input.sourceId),
    input.eventType,
    input.movementDirection,
    input.cashStatus,
  ].join(':');
}

export async function createCashLedgerEntry(
  db: D1Database,
  input: CashLedgerWriteInput,
): Promise<CashLedgerWriteResult> {
  const tenantId = assertNonEmpty(input.tenantId, 'tenantId');
  const sourceType = assertNonEmpty(input.sourceType, 'sourceType');
  const sourceId = assertNonEmpty(String(input.sourceId), 'sourceId');
  const eventType = assertNonEmpty(input.eventType, 'eventType');
  const movementDirection = assertNonEmpty(input.movementDirection, 'movementDirection') as CashLedgerDirection;
  const cashStatus = assertNonEmpty(input.cashStatus, 'cashStatus');
  const currentLocationType = assertNonEmpty(input.currentLocationType, 'currentLocationType');
  const amount = assertAmount(input.amount);
  const idempotencyKey = assertNonEmpty(input.idempotencyKey ?? cashLedgerDefaultIdempotencyKey({ ...input, tenantId }), 'idempotencyKey');

  const existing = await db.prepare(`
    SELECT ledger_entry_no
    FROM cash_ledger_entries
    WHERE tenant_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<{ ledger_entry_no: string }>();

  if (existing?.ledger_entry_no) {
    return { inserted: false, ledgerEntryNo: existing.ledger_entry_no, idempotencyKey };
  }

  const ledgerEntryNo = await getNextSequence(db, tenantId, 'cash_ledger_entry', 'CLE');

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const cashLedgerStatement = db.prepare(`
    INSERT INTO cash_ledger_entries (
      tenant_id, ledger_entry_no,
      source_type, source_id, source_no, event_type,
      movement_direction, cash_status, status,
      amount, expected_amount, received_amount, due_amount, variance_amount, payment_method,
      from_user_id, to_user_id, counter_session_id, counter_id,
      current_location_type, current_location_label,
      accounting_voucher_id, accounting_posting_status,
      reference_type, reference_id, note, metadata_json, idempotency_key,
      created_by, occurred_at, posted_at
    ) VALUES (
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `).bind(
    tenantId,
    ledgerEntryNo,
    sourceType,
    sourceId,
    input.sourceNo ?? null,
    eventType,
    movementDirection,
    cashStatus,
    input.status ?? 'posted',
    amount,
    optionalAmount(input.expectedAmount),
    optionalAmount(input.receivedAmount),
    optionalAmount(input.dueAmount),
    optionalAmount(input.varianceAmount),
    input.paymentMethod ?? 'cash',
    input.fromUserId ?? null,
    input.toUserId ?? null,
    input.counterSessionId ?? null,
    input.counterId ?? null,
    currentLocationType,
    input.currentLocationLabel ?? null,
    input.accountingVoucherId ?? null,
    input.accountingPostingStatus ?? null,
    input.referenceType ?? null,
    input.referenceId === undefined || input.referenceId === null ? null : String(input.referenceId),
    input.note ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    idempotencyKey,
    input.createdBy ?? null,
    occurredAt,
    input.postedAt ?? null,
  );
  const bridgeStatements = await canonicalBridgeStatements(
    db,
    input,
    tenantId,
    sourceType,
    sourceId,
    amount,
    occurredAt,
    ledgerEntryNo,
    idempotencyKey,
  );
  if (bridgeStatements.length > 0) {
    await db.batch([
      cashLedgerStatement,
      ...bridgeStatements as unknown as D1PreparedStatement[],
    ]);
  } else {
    await cashLedgerStatement.run();
  }

  return { inserted: true, ledgerEntryNo, idempotencyKey };
}

async function recordCashLedgerShadowIssue(
  db: D1Database,
  input: CashLedgerWriteInput,
  idempotencyKey: string | null,
  issueMessage: string,
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO cash_ledger_shadow_issues (
        tenant_id, source_type, source_id, event_type, idempotency_key, issue_message, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.sourceType,
      String(input.sourceId),
      input.eventType,
      idempotencyKey,
      issueMessage,
      JSON.stringify({
        amount: input.amount,
        cashStatus: input.cashStatus,
        movementDirection: input.movementDirection,
        counterSessionId: input.counterSessionId ?? null,
        counterId: input.counterId ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
      }),
    ).run();
  } catch {
    // Keep shadow mode non-blocking even when the issue-log table is unavailable.
  }
}

export async function shadowCreateCashLedgerEntry(
  db: D1Database,
  input: CashLedgerWriteInput,
  logger: Pick<Console, 'warn'> = console,
): Promise<CashLedgerShadowWriteResult> {
  const fallbackIdempotencyKey = input.idempotencyKey ?? cashLedgerDefaultIdempotencyKey(input);
  try {
    return await createCashLedgerEntry(db, input);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('Cash ledger shadow-write skipped', {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      eventType: input.eventType,
      errorMessage,
    });
    await recordCashLedgerShadowIssue(db, input, fallbackIdempotencyKey, errorMessage);
    return {
      inserted: false,
      ledgerEntryNo: null,
      idempotencyKey: fallbackIdempotencyKey,
      shadowSkipped: true,
      errorMessage,
    };
  }
}
