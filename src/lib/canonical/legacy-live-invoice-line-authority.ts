import type { CanonicalBatchDatabase } from './command-batch';
import { ensureCanonicalInvoiceForLegacyBill } from './legacy-bill-payment-recovery';
import { createDeterministicSourceId } from './source-mapping';

export interface LegacyLiveInvoiceLineAuthorityInput {
  tenantId: string;
  billId: number;
  invoiceNo: string;
  invoiceSourceLineId: string;
}

export interface LegacyLiveInvoiceLineAuthority {
  invoicePublicId: string;
  invoiceLinePublicId: string;
  lineAmountMinor: number;
  invoiceStatus: string;
  authority: 'live_gross' | 'legacy_recovered_net';
}

type CanonicalInvoiceLineRow = {
  line_amount_minor: number;
  invoice_status: string;
};

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

async function readCanonicalInvoiceLine(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
  invoiceLinePublicId: string,
): Promise<CanonicalInvoiceLineRow | null> {
  return db.prepare(`
    SELECT l.line_amount_minor,i.status invoice_status
    FROM canonical_invoice_lines l
    JOIN canonical_invoices i
      ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
    WHERE l.tenant_id=? AND l.invoice_public_id=? AND l.line_public_id=?
    LIMIT 1
  `).bind(tenantId, invoicePublicId, invoiceLinePublicId).first<CanonicalInvoiceLineRow>();
}

async function readRecoveredInvoiceItemLine(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    billId: number;
    invoiceNo: string;
    invoiceSourceLineId: string;
    invoicePublicId: string;
  },
): Promise<{ invoiceLinePublicId: string; line: CanonicalInvoiceLineRow } | null> {
  const lineNumberMatch = /^(\d+):/.exec(input.invoiceSourceLineId);
  const lineNumber = Number(lineNumberMatch?.[1] ?? 0);
  if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) return null;

  const legacyItem = await db.prepare(`
    SELECT id
    FROM invoice_items
    WHERE CAST(tenant_id AS TEXT)=? AND bill_id=? AND COALESCE(status,'active')='active'
    ORDER BY id
    LIMIT 1 OFFSET ?
  `).bind(input.tenantId, input.billId, lineNumber - 1).first<{ id: number }>();
  if (!legacyItem?.id) return null;

  const invoiceLinePublicId = await createDeterministicSourceId(
    'invline',
    input.tenantId,
    'legacy_live_bill_line',
    `${input.invoiceNo}:invoice_item:${legacyItem.id}`,
  );
  const line = await readCanonicalInvoiceLine(
    db,
    input.tenantId,
    input.invoicePublicId,
    invoiceLinePublicId,
  );
  return line ? { invoiceLinePublicId, line } : null;
}

export async function resolveLegacyLiveInvoiceLineAuthority(
  db: CanonicalBatchDatabase,
  input: LegacyLiveInvoiceLineAuthorityInput,
): Promise<LegacyLiveInvoiceLineAuthority> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const invoiceSourceLineId = exact(input.invoiceSourceLineId, 'invoiceSourceLineId');
  const billId = positiveInteger(input.billId, 'billId');

  const invoicePublicId = await createDeterministicSourceId(
    'inv',
    tenantId,
    'legacy_live_bill',
    invoiceNo,
  );
  const liveInvoiceLinePublicId = await createDeterministicSourceId(
    'invline',
    tenantId,
    'legacy_live_bill_line',
    `${invoiceNo}:${invoiceSourceLineId}`,
  );

  let line = await readCanonicalInvoiceLine(
    db,
    tenantId,
    invoicePublicId,
    liveInvoiceLinePublicId,
  );
  if (!line) {
    await ensureCanonicalInvoiceForLegacyBill(db, { tenantId, billId });
    line = await readCanonicalInvoiceLine(
      db,
      tenantId,
      invoicePublicId,
      liveInvoiceLinePublicId,
    );
  }
  if (line) {
    return {
      invoicePublicId,
      invoiceLinePublicId: liveInvoiceLinePublicId,
      lineAmountMinor: Number(line.line_amount_minor),
      invoiceStatus: line.invoice_status,
      authority: 'live_gross',
    };
  }

  const recovered = await readRecoveredInvoiceItemLine(db, {
    tenantId,
    billId,
    invoiceNo,
    invoiceSourceLineId,
    invoicePublicId,
  });
  if (!recovered) throw new Error('Canonical invoice line not found for financial projection');

  return {
    invoicePublicId,
    invoiceLinePublicId: recovered.invoiceLinePublicId,
    lineAmountMinor: Number(recovered.line.line_amount_minor),
    invoiceStatus: recovered.line.invoice_status,
    authority: 'legacy_recovered_net',
  };
}
