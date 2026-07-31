import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './command-batch';
import type { CancelUnpaidInvoiceInput } from './commands/cancel-invoice';
import { toMinorUnits, type DecimalAmount } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { deriveBusinessDate, toUtcIso } from './time';

interface QueryPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): QueryPreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface LiveUnpaidInvoiceCancellationAuthority {
  tenantId: string;
  legacyBillId: number;
  invoiceNumber: string;
  totalAmount: DecimalAmount;
  paidAmount: DecimalAmount;
  reasonCode: string;
  cancelledAtUtc: string;
}

interface InvoiceMappingRow {
  canonical_public_id: string;
  invoice_number: string;
  total_minor: number;
  paid_minor: number;
  source_type: string;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function reasonCode(value: string): string {
  const exactValue = exact(value, 'reasonCode');
  if (!/^[a-z0-9][a-z0-9_:-]{1,99}$/.test(exactValue)) {
    throw new TypeError('reasonCode must be a stable lowercase code');
  }
  return exactValue;
}

function query(db: CanonicalBatchDatabase, sql: string): QueryPreparedStatement {
  return db.prepare(sql) as QueryPreparedStatement;
}

export async function resolveLiveUnpaidInvoiceCancellationProjection(
  db: CanonicalBatchDatabase,
  authority: LiveUnpaidInvoiceCancellationAuthority,
): Promise<CancelUnpaidInvoiceInput> {
  const tenantId = exact(authority.tenantId, 'tenantId');
  const legacyBillId = positiveId(authority.legacyBillId, 'legacyBillId');
  const invoiceNumber = exact(authority.invoiceNumber, 'invoiceNumber');
  const totalMinor = toMinorUnits(authority.totalAmount);
  const paidMinor = toMinorUnits(authority.paidAmount);
  const cancellationReasonCode = reasonCode(authority.reasonCode);
  const cancelledAtUtc = toUtcIso(authority.cancelledAtUtc);
  if (totalMinor <= 0) throw new RangeError('Unpaid invoice cancellation requires a positive total');
  if (paidMinor !== 0) throw new Error('Legacy bill must be unpaid before canonical cancellation');

  const candidates = (await query(db, `
    SELECT
      m.canonical_public_id,
      i.invoice_number,
      i.total_minor,
      i.paid_minor,
      m.source_type
    FROM canonical_source_mappings m
    JOIN canonical_invoices i
      ON i.tenant_id=m.tenant_id AND i.invoice_public_id=m.canonical_public_id
    WHERE m.tenant_id=?
      AND m.entity_type='invoice'
      AND m.mapping_status='mapped'
      AND (
        (m.source_type='legacy_live_bill' AND m.source_public_id=?)
        OR (m.source_type='legacy_bill' AND m.source_public_id=?)
      )
    ORDER BY CASE m.source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END,
      m.canonical_public_id
  `).bind(
    tenantId,
    invoiceNumber,
    String(legacyBillId),
  ).all<InvoiceMappingRow>()).results ?? [];

  if (candidates.length === 0) throw new Error('Canonical invoice mapping not found');
  const canonicalIds = new Set(candidates.map((candidate) => candidate.canonical_public_id));
  if (canonicalIds.size !== 1) {
    throw new Error('Conflicting canonical invoice mappings found for legacy bill cancellation');
  }

  const mapped = candidates[0];
  if (mapped.invoice_number !== invoiceNumber) {
    throw new Error('Canonical invoice number does not match legacy bill authority');
  }
  if (Number(mapped.total_minor) !== totalMinor || Number(mapped.paid_minor) !== 0) {
    throw new Error('Canonical invoice balance does not match unpaid legacy bill authority');
  }

  const sourceType = 'legacy_bill_cancellation';
  const sourcePublicId = String(legacyBillId);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType,
    legacyBillId,
    invoiceNumber,
    canonicalInvoicePublicId: mapped.canonical_public_id,
    totalMinor,
    paidMinor,
    reasonCode: cancellationReasonCode,
    cancelledAtUtc,
  });
  const outboxEventPublicId = await createDeterministicSourceId(
    'outevt',
    tenantId,
    sourceType,
    sourcePublicId,
  );

  return {
    tenantId,
    invoicePublicId: mapped.canonical_public_id,
    reasonCode: cancellationReasonCode,
    cancelledAtUtc,
    businessDate: deriveBusinessDate(cancelledAtUtc, 'Asia/Dhaka'),
    sourceType,
    sourcePublicId,
    sourceTable: 'bills',
    sourceEvidenceSha256,
    idempotencyKey: `canonical:invoice-cancel:${sourcePublicId}`,
    outboxEventPublicId,
  };
}
