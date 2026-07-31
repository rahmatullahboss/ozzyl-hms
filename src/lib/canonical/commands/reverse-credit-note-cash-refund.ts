import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { stableCanonicalJson } from '../idempotency';
import { toUtcIso } from '../time';

export interface ReverseCreditNoteCashRefundInput {
  tenantId: string;
  reversalPublicId: string;
  refundPublicId: string;
  reasonCode: string;
  reversedAtUtc: string;
  businessDate: string;
  actorUserId: number;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
  recoveryRequiredEventPublicId: string;
}

export interface ReverseCreditNoteCashRefundResult {
  reversalPublicId: string;
  refundPublicId: string;
  creditNotePublicId: string;
  invoicePublicId: string;
  totalMinor: number;
  cashRefundMinor: number;
  invoicePaidMinor: number;
  invoiceDueMinor: number;
  invoiceCreditedMinor: number;
  invoiceNetDueMinor: number;
  legacyCounterId: number;
  legacyCounterSessionId: number;
}

interface AuthorityRow {
  refund_public_id: string;
  credit_note_public_id: string;
  invoice_public_id: string;
  cash_refund_minor: number;
  payout_method_code: string;
  legacy_counter_id: number;
  legacy_counter_session_id: number;
  refund_status: string;
  credit_total_minor: number;
  invoice_credited_before_minor: number;
  invoice_credited_after_minor: number;
  invoice_net_due_before_minor: number;
  invoice_net_due_after_minor: number;
  credit_status: string;
  currency_code: string;
  invoice_total_minor: number;
  invoice_paid_minor: number;
  invoice_due_minor: number;
  invoice_credited_minor: number;
  invoice_net_due_minor: number;
  invoice_status: string;
}

interface JsonRows {
  rows_json: string;
}

interface ReceiptAuthority {
  receiptPublicId: string;
  amountMinor: number;
  refundedBeforeMinor: number;
  refundedAfterMinor: number;
  netReceivedBeforeMinor: number;
  netReceivedAfterMinor: number;
  currentRefundedMinor: number;
  currentNetReceivedMinor: number;
  currentStatus: string;
}

interface AllocationAuthority {
  allocationPublicId: string;
  receiptPublicId: string;
  amountMinor: number;
  reversedBeforeMinor: number;
  reversedAfterMinor: number;
  remainingBeforeMinor: number;
  remainingAfterMinor: number;
  currentReversedMinor: number;
  currentRemainingMinor: number;
  currentStatus: string;
}

interface TenderAuthority {
  tenderPublicId: string;
  receiptPublicId: string;
  amountMinor: number;
  tenderType: string;
  methodCode: string;
  attributableBeforeMinor: number;
  attributableAfterMinor: number;
  currentAttributableMinor: number;
  currentStatus: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function parseRows<T>(row: JsonRows | null, label: string): T[] {
  if (!row) throw new Error(`${label} could not be loaded`);
  try {
    const parsed = JSON.parse(String(row.rows_json ?? '[]'));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as T[];
  } catch {
    throw new Error(`${label} could not be parsed`);
  }
}

function safeSum(rows: readonly { amountMinor: number }[], label: string): number {
  let total = 0n;
  for (const row of rows) {
    total += BigInt(positive(Number(row.amountMinor), `${label}.amountMinor`));
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`${label} total exceeds safe integer range`);
    }
  }
  return Number(total);
}

async function loadReceiptAuthority(
  db: CanonicalBatchDatabase,
  tenantId: string,
  refundPublicId: string,
): Promise<ReceiptAuthority[]> {
  const row = await db.prepare(`
    SELECT COALESCE(json_group_array(json_object(
      'receiptPublicId', rr.receipt_public_id,
      'amountMinor', rr.amount_minor,
      'refundedBeforeMinor', rr.receipt_refunded_before_minor,
      'refundedAfterMinor', rr.receipt_refunded_after_minor,
      'netReceivedBeforeMinor', rr.receipt_net_received_before_minor,
      'netReceivedAfterMinor', rr.receipt_net_received_after_minor,
      'currentRefundedMinor', r.refunded_minor,
      'currentNetReceivedMinor', r.net_received_minor,
      'currentStatus', r.status
    )), '[]') AS rows_json
    FROM canonical_credit_note_refund_receipts rr
    INNER JOIN canonical_payment_receipts r
      ON r.tenant_id=rr.tenant_id
     AND r.receipt_public_id=rr.receipt_public_id
    WHERE rr.tenant_id=? AND rr.refund_public_id=?
  `).bind(tenantId, refundPublicId).first<JsonRows>();
  return parseRows<ReceiptAuthority>(row, 'Canonical refund receipt authority');
}

async function loadAllocationAuthority(
  db: CanonicalBatchDatabase,
  tenantId: string,
  refundPublicId: string,
): Promise<AllocationAuthority[]> {
  const row = await db.prepare(`
    SELECT COALESCE(json_group_array(json_object(
      'allocationPublicId', ra.allocation_public_id,
      'receiptPublicId', ra.receipt_public_id,
      'amountMinor', ra.amount_minor,
      'reversedBeforeMinor', ra.allocation_reversed_before_minor,
      'reversedAfterMinor', ra.allocation_reversed_after_minor,
      'remainingBeforeMinor', ra.allocation_remaining_before_minor,
      'remainingAfterMinor', ra.allocation_remaining_after_minor,
      'currentReversedMinor', a.reversed_minor,
      'currentRemainingMinor', a.remaining_minor,
      'currentStatus', a.status
    )), '[]') AS rows_json
    FROM canonical_credit_note_refund_allocations ra
    INNER JOIN canonical_payment_allocations a
      ON a.tenant_id=ra.tenant_id
     AND a.allocation_public_id=ra.allocation_public_id
     AND a.receipt_public_id=ra.receipt_public_id
    WHERE ra.tenant_id=? AND ra.refund_public_id=?
  `).bind(tenantId, refundPublicId).first<JsonRows>();
  return parseRows<AllocationAuthority>(row, 'Canonical refund allocation authority');
}

async function loadTenderAuthority(
  db: CanonicalBatchDatabase,
  tenantId: string,
  refundPublicId: string,
): Promise<TenderAuthority[]> {
  const row = await db.prepare(`
    SELECT COALESCE(json_group_array(json_object(
      'tenderPublicId', ta.tender_public_id,
      'receiptPublicId', ta.receipt_public_id,
      'amountMinor', ta.amount_minor,
      'tenderType', ta.original_tender_type,
      'methodCode', ta.original_method_code,
      'attributableBeforeMinor', ta.attributable_before_minor,
      'attributableAfterMinor', ta.attributable_after_minor,
      'currentAttributableMinor', t.remaining_minor-COALESCE((
        SELECT SUM(other.amount_minor)
        FROM canonical_credit_note_refund_tender_attributions other
        INNER JOIN canonical_credit_note_cash_refunds posted_refund
          ON posted_refund.tenant_id=other.tenant_id
         AND posted_refund.refund_public_id=other.refund_public_id
        WHERE other.tenant_id=t.tenant_id
          AND other.tender_public_id=t.tender_public_id
          AND posted_refund.status='posted'
      ),0),
      'currentStatus', t.status
    )), '[]') AS rows_json
    FROM canonical_credit_note_refund_tender_attributions ta
    INNER JOIN canonical_payment_tenders t
      ON t.tenant_id=ta.tenant_id
     AND t.tender_public_id=ta.tender_public_id
     AND t.receipt_public_id=ta.receipt_public_id
    WHERE ta.tenant_id=? AND ta.refund_public_id=?
  `).bind(tenantId, refundPublicId).first<JsonRows>();
  return parseRows<TenderAuthority>(row, 'Canonical refund tender authority');
}

function validateAuthority(
  authority: AuthorityRow,
  receipts: readonly ReceiptAuthority[],
  allocations: readonly AllocationAuthority[],
  tenders: readonly TenderAuthority[],
): ReverseCreditNoteCashRefundResult {
  if (authority.refund_status !== 'posted') throw new Error('Canonical cash refund is not posted or is already reversed');
  if (authority.credit_status !== 'posted') throw new Error('Canonical credit note is not posted or is already reversed');
  if (authority.invoice_status !== 'posted') throw new Error('Canonical invoice is not posted');

  const cashRefundMinor = positive(Number(authority.cash_refund_minor), 'cashRefundMinor');
  const totalMinor = positive(Number(authority.credit_total_minor), 'creditTotalMinor');
  if (cashRefundMinor > totalMinor) throw new Error('Canonical refund exceeds credit-note total');
  positive(Number(authority.legacy_counter_id), 'legacyCounterId');
  positive(Number(authority.legacy_counter_session_id), 'legacyCounterSessionId');

  const creditedBefore = nonNegative(Number(authority.invoice_credited_before_minor), 'invoiceCreditedBeforeMinor');
  const creditedAfter = nonNegative(Number(authority.invoice_credited_after_minor), 'invoiceCreditedAfterMinor');
  const netDueBeforeCredit = nonNegative(Number(authority.invoice_net_due_before_minor), 'invoiceNetDueBeforeMinor');
  const netDueAfterCredit = nonNegative(Number(authority.invoice_net_due_after_minor), 'invoiceNetDueAfterMinor');
  if (creditedAfter !== creditedBefore + totalMinor) throw new Error('Canonical credit-note credited balance does not reconcile');
  if (netDueAfterCredit !== netDueBeforeCredit - totalMinor) throw new Error('Canonical credit-note net due does not reconcile');

  const invoiceTotal = nonNegative(Number(authority.invoice_total_minor), 'invoiceTotalMinor');
  const expectedCurrentDue = netDueBeforeCredit + creditedBefore;
  const expectedCurrentPaid = invoiceTotal - expectedCurrentDue;
  if (
    expectedCurrentPaid < 0
    || Number(authority.invoice_paid_minor) !== expectedCurrentPaid
    || Number(authority.invoice_due_minor) !== expectedCurrentDue
    || Number(authority.invoice_credited_minor) !== creditedAfter
    || Number(authority.invoice_net_due_minor) !== netDueAfterCredit
    || expectedCurrentPaid + expectedCurrentDue !== invoiceTotal
  ) {
    throw new Error('Canonical invoice authority changed after cash refund');
  }

  const restoredPaid = expectedCurrentPaid + cashRefundMinor;
  const restoredDue = expectedCurrentDue - cashRefundMinor;
  const restoredCredited = creditedBefore;
  const restoredNetDue = netDueBeforeCredit - cashRefundMinor;
  if (
    restoredDue < 0
    || restoredNetDue < 0
    || restoredPaid + restoredDue !== invoiceTotal
    || restoredDue - restoredCredited !== restoredNetDue
  ) {
    throw new Error('Canonical invoice reversal does not reconcile');
  }

  if (receipts.length === 0 || allocations.length === 0 || tenders.length === 0) {
    throw new Error('Canonical refund funding authority is incomplete');
  }
  if (
    safeSum(receipts, 'receipt') !== cashRefundMinor
    || safeSum(allocations, 'allocation') !== cashRefundMinor
    || safeSum(tenders, 'tender') !== cashRefundMinor
  ) {
    throw new Error('Canonical refund funding totals do not reconcile');
  }

  for (const row of receipts) {
    positive(Number(row.amountMinor), 'receipt.amountMinor');
    if (
      row.currentStatus !== 'posted'
      || Number(row.currentRefundedMinor) !== Number(row.refundedAfterMinor)
      || Number(row.currentNetReceivedMinor) !== Number(row.netReceivedAfterMinor)
      || Number(row.refundedAfterMinor) !== Number(row.refundedBeforeMinor) + Number(row.amountMinor)
      || Number(row.netReceivedAfterMinor) !== Number(row.netReceivedBeforeMinor) - Number(row.amountMinor)
    ) {
      throw new Error('Canonical payment receipt authority changed after cash refund');
    }
  }
  for (const row of allocations) {
    positive(Number(row.amountMinor), 'allocation.amountMinor');
    if (
      !['active', 'reversed'].includes(String(row.currentStatus))
      || Number(row.currentReversedMinor) !== Number(row.reversedAfterMinor)
      || Number(row.currentRemainingMinor) !== Number(row.remainingAfterMinor)
      || Number(row.reversedAfterMinor) !== Number(row.reversedBeforeMinor) + Number(row.amountMinor)
      || Number(row.remainingAfterMinor) !== Number(row.remainingBeforeMinor) - Number(row.amountMinor)
    ) {
      throw new Error('Canonical payment allocation authority changed after cash refund');
    }
  }
  for (const row of tenders) {
    positive(Number(row.amountMinor), 'tender.amountMinor');
    if (
      row.currentStatus !== 'captured'
      || Number(row.currentAttributableMinor) !== Number(row.attributableAfterMinor)
      || Number(row.attributableAfterMinor) !== Number(row.attributableBeforeMinor) - Number(row.amountMinor)
    ) {
      throw new Error('Canonical payment tender attribution authority changed after cash refund');
    }
  }

  return {
    reversalPublicId: '',
    refundPublicId: authority.refund_public_id,
    creditNotePublicId: authority.credit_note_public_id,
    invoicePublicId: authority.invoice_public_id,
    totalMinor,
    cashRefundMinor,
    invoicePaidMinor: restoredPaid,
    invoiceDueMinor: restoredDue,
    invoiceCreditedMinor: restoredCredited,
    invoiceNetDueMinor: restoredNetDue,
    legacyCounterId: Number(authority.legacy_counter_id),
    legacyCounterSessionId: Number(authority.legacy_counter_session_id),
  };
}

export async function reverseCreditNoteCashRefund(
  db: CanonicalBatchDatabase,
  input: ReverseCreditNoteCashRefundInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ReverseCreditNoteCashRefundResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.reversalPublicId, 'reversalPublicId');
  exact(input.refundPublicId, 'refundPublicId');
  exact(input.reasonCode, 'reasonCode');
  utc(input.reversedAtUtc, 'reversedAtUtc');
  exact(input.businessDate, 'businessDate');
  positive(input.actorUserId, 'actorUserId');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  exact(input.recoveryRequiredEventPublicId, 'recoveryRequiredEventPublicId');

  const request = {
    reversalPublicId: input.reversalPublicId,
    refundPublicId: input.refundPublicId,
    reasonCode: input.reasonCode,
    reversedAtUtc: input.reversedAtUtc,
    businessDate: input.businessDate,
    actorUserId: input.actorUserId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<ReverseCreditNoteCashRefundResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.credit_note.cash_refund.reverse',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const authority = await db.prepare(`
    SELECT
      r.refund_public_id,
      r.credit_note_public_id,
      r.invoice_public_id,
      r.amount_minor AS cash_refund_minor,
      r.payout_method_code,
      r.legacy_counter_id,
      r.legacy_counter_session_id,
      r.status AS refund_status,
      c.total_minor AS credit_total_minor,
      c.invoice_credited_before_minor,
      c.invoice_credited_after_minor,
      c.invoice_net_due_before_minor,
      c.invoice_net_due_after_minor,
      c.status AS credit_status,
      i.currency_code,
      i.total_minor AS invoice_total_minor,
      i.paid_minor AS invoice_paid_minor,
      i.due_minor AS invoice_due_minor,
      i.credited_minor AS invoice_credited_minor,
      i.net_due_minor AS invoice_net_due_minor,
      i.status AS invoice_status
    FROM canonical_credit_note_cash_refunds r
    INNER JOIN canonical_credit_notes c
      ON c.tenant_id=r.tenant_id
     AND c.credit_note_public_id=r.credit_note_public_id
     AND c.invoice_public_id=r.invoice_public_id
    INNER JOIN canonical_invoices i
      ON i.tenant_id=r.tenant_id
     AND i.invoice_public_id=r.invoice_public_id
    WHERE r.tenant_id=? AND r.refund_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.refundPublicId).first<AuthorityRow>();
  if (!authority) throw new Error('Canonical cash refund not found');

  const [receipts, allocations, tenders] = await Promise.all([
    loadReceiptAuthority(db, input.tenantId, input.refundPublicId),
    loadAllocationAuthority(db, input.tenantId, input.refundPublicId),
    loadTenderAuthority(db, input.tenantId, input.refundPublicId),
  ]);
  const validated = validateAuthority(authority, receipts, allocations, tenders);
  const result: ReverseCreditNoteCashRefundResult = {
    ...validated,
    reversalPublicId: input.reversalPublicId,
  };

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_credit_note_cash_refund_reversals (
        tenant_id,reversal_public_id,idempotency_key,refund_public_id,
        credit_note_public_id,invoice_public_id,amount_minor,credit_total_minor,
        currency_code,reason_code,reversed_at_utc,business_date,actor_user_id,
        legacy_counter_id,legacy_counter_session_id,source_evidence_sha256,
        reconciliation_guard
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `).bind(
      input.tenantId,
      input.reversalPublicId,
      input.idempotencyKey,
      input.refundPublicId,
      authority.credit_note_public_id,
      authority.invoice_public_id,
      result.cashRefundMinor,
      result.totalMinor,
      authority.currency_code,
      input.reasonCode,
      input.reversedAtUtc,
      input.businessDate,
      input.actorUserId,
      result.legacyCounterId,
      result.legacyCounterSessionId,
      input.sourceEvidenceSha256,
    ),
    ...allocations.map((row) => db.prepare(`
      UPDATE canonical_payment_allocations
      SET reversed_minor=?,remaining_minor=?,status='active',reversed_at_utc=NULL,updated_at_utc=?
      WHERE tenant_id=?
        AND allocation_public_id=?
        AND receipt_public_id=?
        AND invoice_public_id=?
        AND reversed_minor=?
        AND remaining_minor=?
        AND status=?
    `).bind(
      Number(row.reversedBeforeMinor),
      Number(row.remainingBeforeMinor),
      input.reversedAtUtc,
      input.tenantId,
      row.allocationPublicId,
      row.receiptPublicId,
      authority.invoice_public_id,
      Number(row.reversedAfterMinor),
      Number(row.remainingAfterMinor),
      row.currentStatus,
    )),
    ...receipts.map((row) => db.prepare(`
      UPDATE canonical_payment_receipts
      SET refunded_minor=?,net_received_minor=?,updated_at_utc=?
      WHERE tenant_id=?
        AND receipt_public_id=?
        AND status='posted'
        AND refunded_minor=?
        AND net_received_minor=?
    `).bind(
      Number(row.refundedBeforeMinor),
      Number(row.netReceivedBeforeMinor),
      input.reversedAtUtc,
      input.tenantId,
      row.receiptPublicId,
      Number(row.refundedAfterMinor),
      Number(row.netReceivedAfterMinor),
    )),
    db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,credited_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=?
        AND invoice_public_id=?
        AND status='posted'
        AND paid_minor=?
        AND due_minor=?
        AND credited_minor=?
        AND net_due_minor=?
    `).bind(
      result.invoicePaidMinor,
      result.invoiceDueMinor,
      result.invoiceCreditedMinor,
      result.invoiceNetDueMinor,
      input.reversedAtUtc,
      input.tenantId,
      authority.invoice_public_id,
      Number(authority.invoice_paid_minor),
      Number(authority.invoice_due_minor),
      Number(authority.invoice_credited_minor),
      Number(authority.invoice_net_due_minor),
    ),
    db.prepare(`
      UPDATE canonical_credit_notes
      SET status='reversed',reversed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=?
        AND credit_note_public_id=?
        AND invoice_public_id=?
        AND status='posted'
        AND reversed_at_utc IS NULL
        AND total_minor=?
        AND invoice_credited_before_minor=?
        AND invoice_credited_after_minor=?
        AND invoice_net_due_before_minor=?
        AND invoice_net_due_after_minor=?
    `).bind(
      input.reversedAtUtc,
      input.reversedAtUtc,
      input.tenantId,
      authority.credit_note_public_id,
      authority.invoice_public_id,
      result.totalMinor,
      Number(authority.invoice_credited_before_minor),
      Number(authority.invoice_credited_after_minor),
      Number(authority.invoice_net_due_before_minor),
      Number(authority.invoice_net_due_after_minor),
    ),
    db.prepare(`
      UPDATE canonical_credit_note_cash_refunds
      SET status='reversed',reversed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=?
        AND refund_public_id=?
        AND credit_note_public_id=?
        AND invoice_public_id=?
        AND status='posted'
        AND reversed_at_utc IS NULL
        AND amount_minor=?
        AND legacy_counter_id=?
        AND legacy_counter_session_id=?
    `).bind(
      input.reversedAtUtc,
      input.reversedAtUtc,
      input.tenantId,
      input.refundPublicId,
      authority.credit_note_public_id,
      authority.invoice_public_id,
      result.cashRefundMinor,
      result.legacyCounterId,
      result.legacyCounterSessionId,
    ),
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      input.recoveryRequiredEventPublicId,
      'canonical_cash_custody',
      input.refundPublicId,
      'canonical.cash_custody.refund_recovery_required',
      stableCanonicalJson({
        amountMinor: result.cashRefundMinor,
        counterId: result.legacyCounterId,
        counterSessionId: result.legacyCounterSessionId,
        direction: 'recovery_required',
        refundPublicId: input.refundPublicId,
        reversalPublicId: input.reversalPublicId,
      }),
      input.reversedAtUtc,
      input.businessDate,
      `${input.idempotencyKey}:recovery-required`,
    ),
    db.prepare(`
      UPDATE canonical_credit_note_cash_refund_reversals
      SET reconciliation_guard=CASE WHEN
        EXISTS (
          SELECT 1 FROM canonical_invoices i
          WHERE i.tenant_id=? AND i.invoice_public_id=? AND i.status='posted'
            AND i.paid_minor=? AND i.due_minor=?
            AND i.credited_minor=? AND i.net_due_minor=?
        )
        AND EXISTS (
          SELECT 1 FROM canonical_credit_notes c
          WHERE c.tenant_id=? AND c.credit_note_public_id=?
            AND c.status='reversed' AND c.reversed_at_utc=?
        )
        AND EXISTS (
          SELECT 1 FROM canonical_credit_note_cash_refunds r
          WHERE r.tenant_id=? AND r.refund_public_id=?
            AND r.status='reversed' AND r.reversed_at_utc=?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_credit_note_refund_receipts rr
          LEFT JOIN canonical_payment_receipts r
            ON r.tenant_id=rr.tenant_id AND r.receipt_public_id=rr.receipt_public_id
          WHERE rr.tenant_id=? AND rr.refund_public_id=?
            AND (
              r.receipt_public_id IS NULL OR r.status<>'posted'
              OR r.refunded_minor<>rr.receipt_refunded_before_minor
              OR r.net_received_minor<>rr.receipt_net_received_before_minor
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_credit_note_refund_allocations ra
          LEFT JOIN canonical_payment_allocations a
            ON a.tenant_id=ra.tenant_id
           AND a.allocation_public_id=ra.allocation_public_id
           AND a.receipt_public_id=ra.receipt_public_id
          WHERE ra.tenant_id=? AND ra.refund_public_id=?
            AND (
              a.allocation_public_id IS NULL OR a.status<>'active'
              OR a.reversed_minor<>ra.allocation_reversed_before_minor
              OR a.remaining_minor<>ra.allocation_remaining_before_minor
              OR a.reversed_at_utc IS NOT NULL
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_credit_note_refund_tender_attributions ta
          LEFT JOIN canonical_payment_tenders t
            ON t.tenant_id=ta.tenant_id
           AND t.tender_public_id=ta.tender_public_id
           AND t.receipt_public_id=ta.receipt_public_id
          WHERE ta.tenant_id=? AND ta.refund_public_id=?
            AND (
              t.tender_public_id IS NULL OR t.status<>'captured'
              OR t.tender_type<>ta.original_tender_type
              OR t.method_code<>ta.original_method_code
              OR t.remaining_minor-COALESCE((
                SELECT SUM(other.amount_minor)
                FROM canonical_credit_note_refund_tender_attributions other
                INNER JOIN canonical_credit_note_cash_refunds posted_refund
                  ON posted_refund.tenant_id=other.tenant_id
                 AND posted_refund.refund_public_id=other.refund_public_id
                WHERE other.tenant_id=t.tenant_id
                  AND other.tender_public_id=t.tender_public_id
                  AND posted_refund.status='posted'
              ),0)<>ta.attributable_before_minor
            )
        )
      THEN 1 ELSE 0 END
      WHERE tenant_id=? AND reversal_public_id=?
    `).bind(
      input.tenantId,
      authority.invoice_public_id,
      result.invoicePaidMinor,
      result.invoiceDueMinor,
      result.invoiceCreditedMinor,
      result.invoiceNetDueMinor,
      input.tenantId,
      authority.credit_note_public_id,
      input.reversedAtUtc,
      input.tenantId,
      input.refundPublicId,
      input.reversedAtUtc,
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.reversalPublicId,
    ),
  ];

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.credit_note.cash_refund.reverse',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: [
      db.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (?,?,?,?,?,?,'mapped',1,?)
      `).bind(
        input.tenantId,
        'credit_note_cash_refund_reversal',
        input.reversalPublicId,
        input.sourceType,
        input.sourcePublicId,
        input.sourceTable,
        input.sourceEvidenceSha256,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_credit_note_cash_refund',
      aggregatePublicId: input.refundPublicId,
      eventType: 'canonical.credit_note.cash_refund_reversed',
      occurredAtUtc: input.reversedAtUtc,
      businessDate: input.businessDate,
      payload: {
        cashRefundMinor: result.cashRefundMinor,
        creditNotePublicId: result.creditNotePublicId,
        invoicePublicId: result.invoicePublicId,
        reasonCode: input.reasonCode,
        refundPublicId: result.refundPublicId,
        reversalPublicId: result.reversalPublicId,
        totalMinor: result.totalMinor,
      },
    },
  });
}
