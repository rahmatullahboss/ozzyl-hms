import type { CanonicalBatchDatabase } from './command-batch';
import { buildLiveCreditProjection } from './live-financial-projection';
import type { IssueCreditNoteInput } from './commands/issue-credit-note';

export interface LiveCreditNoteAuthorityLine {
  invoiceItemId: number;
  amount: string | number;
  reason: string;
}

export interface LiveCreditNoteAuthority {
  tenantId: string;
  creditNoteId?: number;
  creditNoteNo: string;
  billId: number;
  billInvoiceNo: string;
  reason: string;
  issuedAtUtc: string;
  cashRefund: number;
  lines: readonly LiveCreditNoteAuthorityLine[];
}

interface InvoiceMappingRow {
  canonical_public_id: string;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

export async function resolveLiveCreditNoteProjection(
  db: CanonicalBatchDatabase,
  authority: LiveCreditNoteAuthority,
): Promise<IssueCreditNoteInput> {
  const tenantId = exact(authority.tenantId, 'tenantId');
  if (authority.creditNoteId != null) positive(authority.creditNoteId, 'creditNoteId');
  positive(authority.billId, 'billId');
  const creditNoteNo = exact(authority.creditNoteNo, 'creditNoteNo');
  const billInvoiceNo = exact(authority.billInvoiceNo, 'billInvoiceNo');
  const reason = exact(authority.reason, 'reason');
  if (!Number.isFinite(authority.cashRefund) || authority.cashRefund < 0) throw new RangeError('cashRefund must be non-negative');
  if (authority.cashRefund > 0) {
    throw new Error('Cash refund requires one atomic payment reversal and credit note command');
  }
  if (authority.lines.length === 0) throw new RangeError('Credit note requires at least one line');

  const mapping = await db.prepare(`
    SELECT canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND mapping_status='mapped'
      AND (
        (source_type='legacy_live_bill' AND source_public_id=?)
        OR (source_type='legacy_bill' AND source_public_id=?)
      )
    ORDER BY CASE source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(tenantId, billInvoiceNo, String(authority.billId)).first<InvoiceMappingRow>();
  if (!mapping?.canonical_public_id) throw new Error('Canonical invoice mapping not found');

  return buildLiveCreditProjection({
    tenantId,
    creditNo: creditNoteNo,
    invoicePublicId: mapping.canonical_public_id,
    reasonCode: reason,
    issuedAtUtc: authority.issuedAtUtc,
    lines: authority.lines.map((line) => ({
      sourceLineId: String(positive(line.invoiceItemId, 'line.invoiceItemId')),
      invoiceLinePublicId: null,
      amount: line.amount,
      reasonCode: exact(line.reason, 'line.reason'),
    })),
  });
}
