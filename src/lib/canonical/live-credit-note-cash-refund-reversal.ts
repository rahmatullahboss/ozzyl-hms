import type { CanonicalBatchDatabase } from './command-batch';
import type { ReverseCreditNoteCashRefundInput } from './commands/reverse-credit-note-cash-refund';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { toUtcIso } from './time';

export interface LiveCreditNoteCashRefundReversalAuthority {
  tenantId: string;
  refundPublicId: string;
  approvalRequestId: number;
  actorUserId: number;
  reasonCode: string;
  reversedAtUtc: string;
  businessDate: string;
}

interface RefundAuthorityRow {
  refund_public_id: string;
  credit_note_public_id: string;
  invoice_public_id: string;
  amount_minor: number;
  status: string;
  legacy_counter_id: number;
  legacy_counter_session_id: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export async function resolveLiveCreditNoteCashRefundReversal(
  db: CanonicalBatchDatabase,
  authority: LiveCreditNoteCashRefundReversalAuthority,
): Promise<ReverseCreditNoteCashRefundInput> {
  const tenantId = exact(authority.tenantId, 'tenantId');
  const refundPublicId = exact(authority.refundPublicId, 'refundPublicId');
  const approvalRequestId = positiveInteger(authority.approvalRequestId, 'approvalRequestId');
  const actorUserId = positiveInteger(authority.actorUserId, 'actorUserId');
  const reasonCode = exact(authority.reasonCode, 'reasonCode');
  const reversedAtUtc = toUtcIso(exact(authority.reversedAtUtc, 'reversedAtUtc'));
  const businessDate = exact(authority.businessDate, 'businessDate');

  const refund = await db.prepare(`
    SELECT
      refund_public_id,
      credit_note_public_id,
      invoice_public_id,
      amount_minor,
      status,
      legacy_counter_id,
      legacy_counter_session_id
    FROM canonical_credit_note_cash_refunds
    WHERE tenant_id=? AND refund_public_id=?
    LIMIT 1
  `).bind(tenantId, refundPublicId).first<RefundAuthorityRow>();

  if (!refund) throw new Error('Canonical cash refund not found');
  if (String(refund.status) !== 'posted') {
    throw new Error('Canonical cash refund is not posted or is already reversed');
  }
  positiveInteger(Number(refund.amount_minor), 'refund.amount_minor');
  positiveInteger(Number(refund.legacy_counter_id), 'refund.legacy_counter_id');
  positiveInteger(Number(refund.legacy_counter_session_id), 'refund.legacy_counter_session_id');

  const sourcePublicId = String(approvalRequestId);
  const reversalPublicId = await createDeterministicSourceId(
    'crfrv',
    tenantId,
    'legacy_live_credit_note_cash_refund_reversal',
    sourcePublicId,
  );
  const outboxEventPublicId = await createDeterministicSourceId(
    'outevt',
    tenantId,
    'credit_note_cash_refund_reversal_event',
    sourcePublicId,
  );
  const recoveryRequiredEventPublicId = await createDeterministicSourceId(
    'outevt',
    tenantId,
    'cash_custody_refund_recovery_required_event',
    sourcePublicId,
  );
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    tenantId,
    approvalRequestId,
    actorUserId,
    reasonCode,
    reversedAtUtc,
    businessDate,
    refundPublicId: refund.refund_public_id,
    creditNotePublicId: refund.credit_note_public_id,
    invoicePublicId: refund.invoice_public_id,
    amountMinor: Number(refund.amount_minor),
    legacyCounterId: Number(refund.legacy_counter_id),
    legacyCounterSessionId: Number(refund.legacy_counter_session_id),
  });

  return {
    tenantId,
    reversalPublicId,
    refundPublicId,
    reasonCode,
    reversedAtUtc,
    businessDate,
    actorUserId,
    sourceType: 'approval_request',
    sourcePublicId,
    sourceTable: 'approval_requests',
    sourceEvidenceSha256,
    idempotencyKey: `legacy_live_credit_note_cash_refund_reversal:${approvalRequestId}`,
    outboxEventPublicId,
    recoveryRequiredEventPublicId,
  };
}
