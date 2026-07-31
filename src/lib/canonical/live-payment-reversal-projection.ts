import type { CanonicalBatchDatabase } from './command-batch';
import { buildLivePaymentReversalProjection } from './live-financial-projection';
import type { ReversePaymentInput } from './commands/reverse-payment';

export interface LivePaymentReversalAuthority {
  tenantId: string;
  paymentId: number;
  billId: number;
  paymentReceiptNo: string;
  reversalReceiptNo: string;
  amount: string | number;
  paymentMethod: string | null;
  reason: string;
  reversedAtUtc: string;
}

interface CanonicalPaymentAuthorityRow {
  receipt_public_id: string;
  tender_public_id: string;
  allocation_public_id: string;
  tender_type: string;
  tender_count: number;
  allocation_count: number;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function canonicalTenderType(value: string): 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other' {
  if (value === 'cash') return 'cash';
  if (value === 'card') return 'card';
  if (value === 'mobile_wallet') return 'mobile_wallet';
  if (value === 'bank_transfer') return 'bank_transfer';
  if (value === 'gateway') return 'gateway';
  return 'other';
}

export async function resolveLivePaymentReversalProjection(
  db: CanonicalBatchDatabase,
  authority: LivePaymentReversalAuthority,
): Promise<ReversePaymentInput> {
  const tenantId = exact(authority.tenantId, 'tenantId');
  const paymentReceiptNo = exact(authority.paymentReceiptNo, 'paymentReceiptNo');
  const reversalReceiptNo = exact(authority.reversalReceiptNo, 'reversalReceiptNo');
  positiveId(authority.paymentId, 'paymentId');
  positiveId(authority.billId, 'billId');
  exact(authority.reason, 'reason');

  const mapped = await db.prepare(`
    SELECT
      r.receipt_public_id,
      (
        SELECT t.tender_public_id
        FROM canonical_payment_tenders t
        WHERE t.tenant_id=r.tenant_id AND t.receipt_public_id=r.receipt_public_id
          AND t.status='captured'
        ORDER BY t.tender_public_id
        LIMIT 1
      ) AS tender_public_id,
      (
        SELECT a.allocation_public_id
        FROM canonical_payment_allocations a
        WHERE a.tenant_id=r.tenant_id AND a.receipt_public_id=r.receipt_public_id
          AND a.status='active'
        ORDER BY a.allocation_public_id
        LIMIT 1
      ) AS allocation_public_id,
      (
        SELECT t.tender_type
        FROM canonical_payment_tenders t
        WHERE t.tenant_id=r.tenant_id AND t.receipt_public_id=r.receipt_public_id
          AND t.status='captured'
        ORDER BY t.tender_public_id
        LIMIT 1
      ) AS tender_type,
      (
        SELECT COUNT(*)
        FROM canonical_payment_tenders t
        WHERE t.tenant_id=r.tenant_id AND t.receipt_public_id=r.receipt_public_id
          AND t.status='captured'
      ) AS tender_count,
      (
        SELECT COUNT(*)
        FROM canonical_payment_allocations a
        WHERE a.tenant_id=r.tenant_id AND a.receipt_public_id=r.receipt_public_id
          AND a.status='active'
      ) AS allocation_count
    FROM canonical_source_mappings m
    JOIN canonical_payment_receipts r
      ON r.tenant_id=m.tenant_id AND r.receipt_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='payment_receipt' AND m.mapping_status='mapped'
      AND (
        (m.source_type='legacy_live_payment' AND m.source_public_id=?)
        OR (m.source_type='legacy_payment' AND m.source_public_id=?)
      )
    ORDER BY CASE m.source_type WHEN 'legacy_live_payment' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(tenantId, paymentReceiptNo, String(authority.paymentId)).first<CanonicalPaymentAuthorityRow>();

  if (!mapped?.receipt_public_id) throw new Error('Canonical payment receipt mapping not found');
  if (Number(mapped.tender_count) !== 1 || !mapped.tender_public_id) {
    throw new Error('Canonical payment reversal requires exactly one captured tender');
  }
  if (Number(mapped.allocation_count) !== 1 || !mapped.allocation_public_id) {
    throw new Error('Canonical payment reversal requires exactly one active allocation');
  }

  const tenderType = canonicalTenderType(String(mapped.tender_type ?? authority.paymentMethod ?? 'other'));
  return buildLivePaymentReversalProjection({
    tenantId,
    reversalNo: reversalReceiptNo,
    refundNo: `${reversalReceiptNo}:refund`,
    receiptPublicId: mapped.receipt_public_id,
    tenderPublicId: mapped.tender_public_id,
    allocationPublicId: mapped.allocation_public_id,
    amount: authority.amount,
    reasonCode: authority.reason,
    reversedAtUtc: authority.reversedAtUtc,
    tenderType,
  });
}
