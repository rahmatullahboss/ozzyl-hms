import type { CanonicalBatchDatabase } from './command-batch';
import { collectPayment, type PaymentTenderType } from './commands/collect-payment';
import { issueInvoice } from './commands/issue-invoice';
import {
  buildLiveInvoiceProjection,
  buildLivePaymentProjection,
  type LiveLegacyInvoiceLine,
} from './live-financial-projection';
import { buildLegacyLiveInvoiceSourceLineId } from './live-invoice-line-identity';
import { toMinorUnits } from './money';

type JsonAggregateRow = {
  rows_json: string | null;
};

type LegacyBillRow = {
  id: number;
  patient_id: number;
  invoice_no: string | null;
  total: number;
  discount: number | null;
  tax_total: number | null;
  created_at: string;
  canonical_public_id: string | null;
};

type LegacyInvoiceItemRow = {
  id: number;
  item_category: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_amount: number | null;
  reference_id: number | null;
};

type LegacyPaymentRow = {
  id: number;
  amount: number;
  receipt_no: string | null;
  payment_method: string | null;
  received_by: number | null;
  created_at: string;
  counter_id: number | null;
  counter_session_id: number | null;
  external_transaction_id: string | null;
};

type ExistingCanonicalInvoiceRow = {
  invoice_public_id: string;
  legacy_patient_id: number;
  total_minor: number;
  status: string;
};

export interface LegacyBillPaymentRecoveryInput {
  tenantId: string;
  billId: number;
}

export interface LegacyBillPaymentRecoveryResult {
  invoicePublicId: string;
  projectedReceiptCount: number;
}

function parseJsonRows<T>(row: JsonAggregateRow | null, label: string): T[] {
  if (!row?.rows_json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.rows_json);
  } catch (error) {
    throw new TypeError(`${label} aggregate is not valid JSON`, { cause: error });
  }
  if (!Array.isArray(parsed)) throw new TypeError(`${label} aggregate must be an array`);
  return parsed as T[];
}

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function legacyDhakaTimestampToUtc(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError('Legacy bill created_at cannot be empty');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) return new Date(normalized).toISOString();
  return new Date(`${normalized.replace(' ', 'T')}+06:00`).toISOString();
}

function legacyUtcTimestamp(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError('Legacy payment created_at cannot be empty');
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) return new Date(normalized).toISOString();
  return new Date(`${normalized.replace(' ', 'T')}Z`).toISOString();
}

function paymentTenderType(paymentMethod: string | null): PaymentTenderType {
  const normalized = String(paymentMethod ?? 'cash').trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'card') return 'card';
  if (['mobile_wallet', 'mobile banking', 'mobile_banking', 'bkash', 'nagad', 'rocket'].includes(normalized)) {
    return 'mobile_wallet';
  }
  if (['bank', 'bank_transfer', 'bank transfer', 'cheque', 'check'].includes(normalized)) return 'bank_transfer';
  if (['gateway', 'online'].includes(normalized)) return 'gateway';
  return 'other';
}

function adjustmentCode(category: string): string {
  const normalized = category.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `LEGACY_${normalized || 'ITEM'}`;
}

async function loadBill(
  db: CanonicalBatchDatabase,
  input: LegacyBillPaymentRecoveryInput,
): Promise<LegacyBillRow> {
  const bill = await db.prepare(`
    SELECT
      b.id,b.patient_id,b.invoice_no,b.total,b.discount,b.tax_total,b.created_at,
      (
        SELECT m.canonical_public_id
        FROM canonical_source_mappings m
        WHERE m.tenant_id=CAST(b.tenant_id AS TEXT)
          AND m.entity_type='invoice'
          AND m.mapping_status='mapped'
          AND (
            (m.source_type='legacy_live_bill' AND m.source_public_id=b.invoice_no)
            OR (m.source_type='legacy_bill' AND m.source_public_id=CAST(b.id AS TEXT))
          )
        ORDER BY CASE m.source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END
        LIMIT 1
      ) AS canonical_public_id
    FROM bills b
    WHERE CAST(b.tenant_id AS TEXT)=? AND b.id=?
    LIMIT 1
  `).bind(input.tenantId, input.billId).first<LegacyBillRow>();
  if (!bill) throw new Error('Legacy bill not found for canonical payment recovery');
  positiveId(Number(bill.id), 'billId');
  positiveId(Number(bill.patient_id), 'patientId');
  if (!String(bill.invoice_no ?? '').trim()) throw new Error('Legacy bill invoice number is missing');
  return bill;
}

async function loadInvoiceItems(
  db: CanonicalBatchDatabase,
  tenantId: string,
  billId: number,
): Promise<LegacyInvoiceItemRow[]> {
  const row = await db.prepare(`
    SELECT COALESCE(json_group_array(json_object(
      'id',id,
      'item_category',item_category,
      'quantity',quantity,
      'unit_price',unit_price,
      'line_total',line_total,
      'tax_amount',tax_amount,
      'reference_id',reference_id
    )), '[]') AS rows_json
    FROM (
      SELECT id,item_category,quantity,unit_price,line_total,tax_amount,reference_id
      FROM invoice_items
      WHERE CAST(tenant_id AS TEXT)=? AND bill_id=? AND COALESCE(status,'active')='active'
      ORDER BY id
    )
  `).bind(tenantId, billId).first<JsonAggregateRow>();
  return parseJsonRows<LegacyInvoiceItemRow>(row, 'Legacy invoice items');
}

async function assertNoLegacyDepositAdjustments(
  db: CanonicalBatchDatabase,
  tenantId: string,
  billId: number,
): Promise<void> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM billing_deposits
    WHERE CAST(tenant_id AS TEXT)=? AND reference_bill_id=?
      AND transaction_type='adjustment' AND COALESCE(is_active,1)=1
      AND amount>0
  `).bind(tenantId, billId).first<{ count: number }>();
  if (Number(row?.count ?? 0) > 0) {
    throw new Error('Legacy bill payment recovery does not yet support deposit adjustments');
  }
}

async function loadPayments(
  db: CanonicalBatchDatabase,
  tenantId: string,
  billId: number,
): Promise<LegacyPaymentRow[]> {
  const row = await db.prepare(`
    SELECT COALESCE(json_group_array(json_object(
      'id',id,
      'amount',amount,
      'receipt_no',receipt_no,
      'payment_method',payment_method,
      'received_by',received_by,
      'created_at',created_at,
      'counter_id',counter_id,
      'counter_session_id',counter_session_id,
      'external_transaction_id',external_transaction_id
    )), '[]') AS rows_json
    FROM (
      SELECT id,amount,receipt_no,payment_method,received_by,created_at,
             counter_id,counter_session_id,external_transaction_id
      FROM payments
      WHERE CAST(tenant_id AS TEXT)=? AND bill_id=?
      ORDER BY created_at,id
    )
  `).bind(tenantId, billId).first<JsonAggregateRow>();
  return parseJsonRows<LegacyPaymentRow>(row, 'Legacy payments');
}

function assertCompatibleExistingInvoice(
  existing: ExistingCanonicalInvoiceRow,
  bill: LegacyBillRow,
  headerTotalMinor: number,
): void {
  if (
    Number(existing.legacy_patient_id) !== Number(bill.patient_id)
    || Number(existing.total_minor) !== headerTotalMinor
    || existing.status !== 'posted'
  ) {
    throw new Error('Existing canonical invoice conflicts with legacy bill payment recovery');
  }
}

async function readExistingInvoice(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoiceNo: string,
): Promise<ExistingCanonicalInvoiceRow | null> {
  return db.prepare(`
    SELECT invoice_public_id,legacy_patient_id,total_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_number=?
    LIMIT 1
  `).bind(tenantId, invoiceNo).first<ExistingCanonicalInvoiceRow>();
}

async function ensureLiveInvoiceMapping(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
  sourceType: string,
  sourcePublicId: string,
  evidenceSha256: string,
): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'invoice',?,?,?,'bills','mapped',1,?)
  `).bind(
    tenantId,
    invoicePublicId,
    sourceType,
    sourcePublicId,
    evidenceSha256,
  ).run();
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, sourceType, sourcePublicId).first<{
    canonical_public_id: string | null;
    mapping_status: string;
  }>();
  if (
    mapping?.mapping_status !== 'mapped'
    || mapping.canonical_public_id !== invoicePublicId
  ) {
    throw new Error('Canonical invoice source mapping conflicts with legacy bill payment recovery');
  }
}

async function ensureCanonicalInvoice(
  db: CanonicalBatchDatabase,
  input: LegacyBillPaymentRecoveryInput,
  bill: LegacyBillRow,
): Promise<string> {
  if (bill.canonical_public_id) return bill.canonical_public_id;

  const invoiceNo = String(bill.invoice_no);
  const items = await loadInvoiceItems(db, input.tenantId, input.billId);
  const lines: LiveLegacyInvoiceLine[] = items.map((item, index) => {
    positiveId(Number(item.id), 'invoiceItemId');
    const quantity = Number(item.quantity ?? 1);
    const computedGross = Number(item.unit_price) * quantity;
    const lineTotal = Number(item.line_total);
    const grossAmount = Number.isFinite(computedGross) && (computedGross > 0 || lineTotal <= 0)
      ? Math.round(computedGross * 100) / 100
      : lineTotal;
    return {
      sourceLineId: buildLegacyLiveInvoiceSourceLineId({
        lineNumber: index + 1,
        itemCategory: String(item.item_category),
        referenceId: item.reference_id,
      }),
      lineType: 'other_adjustment',
      adjustmentCode: adjustmentCode(String(item.item_category)),
      quantity: 1,
      unitAmount: grossAmount,
    };
  });
  const discount = Number(bill.discount ?? 0);
  const taxTotal = Number(bill.tax_total ?? 0);
  const headerTotalMinor = Number(toMinorUnits(Number(bill.total)));
  const projectedTotalMinor = lines.reduce(
    (sum, line) => sum + Number(toMinorUnits(line.unitAmount)),
    0,
  ) - Number(toMinorUnits(discount)) + Number(toMinorUnits(taxTotal));
  const headerDifferenceMinor = headerTotalMinor - projectedTotalMinor;
  if (headerDifferenceMinor !== 0 || lines.length === 0) {
    lines.push({
      sourceLineId: `bill:${input.billId}:header-balance`,
      lineType: 'other_adjustment',
      adjustmentCode: 'LEGACY_BILL_HEADER_BALANCE',
      quantity: 1,
      unitAmount: headerDifferenceMinor / 100,
    });
  }

  const projection = await buildLiveInvoiceProjection({
    tenantId: input.tenantId,
    patientId: Number(bill.patient_id),
    invoiceNo,
    currencyCode: 'BDT',
    issuedAtUtc: legacyDhakaTimestampToUtc(bill.created_at),
    items: lines,
    discount,
    taxTotal,
  });
  if (projection.lines.reduce((sum, line) => sum + line.quantity * line.unitAmountMinor, 0) !== headerTotalMinor) {
    throw new Error('Recovered canonical invoice does not reconcile to legacy bill total');
  }

  const existing = await readExistingInvoice(db, input.tenantId, invoiceNo);
  if (existing) {
    assertCompatibleExistingInvoice(existing, bill, headerTotalMinor);
    await ensureLiveInvoiceMapping(
      db,
      input.tenantId,
      existing.invoice_public_id,
      projection.sourceType,
      projection.sourcePublicId,
      projection.sourceEvidenceSha256,
    );
    return existing.invoice_public_id;
  }

  try {
    await issueInvoice(db, projection);
    return projection.invoicePublicId;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/unique|constraint/i.test(message)) throw cause;
    const racedInvoice = await readExistingInvoice(db, input.tenantId, invoiceNo);
    if (!racedInvoice) throw cause;
    assertCompatibleExistingInvoice(racedInvoice, bill, headerTotalMinor);
    await ensureLiveInvoiceMapping(
      db,
      input.tenantId,
      racedInvoice.invoice_public_id,
      projection.sourceType,
      projection.sourcePublicId,
      projection.sourceEvidenceSha256,
    );
    return racedInvoice.invoice_public_id;
  }
}

export async function ensureCanonicalInvoiceForLegacyBill(
  db: CanonicalBatchDatabase,
  input: LegacyBillPaymentRecoveryInput,
): Promise<string> {
  positiveId(input.billId, 'billId');
  const bill = await loadBill(db, input);
  return ensureCanonicalInvoice(db, input, bill);
}

export async function projectLegacyBillPaymentHistory(
  db: CanonicalBatchDatabase,
  input: LegacyBillPaymentRecoveryInput,
): Promise<LegacyBillPaymentRecoveryResult> {
  positiveId(input.billId, 'billId');
  const bill = await loadBill(db, input);
  await assertNoLegacyDepositAdjustments(db, input.tenantId, input.billId);
  const invoicePublicId = await ensureCanonicalInvoice(db, input, bill);
  const payments = await loadPayments(db, input.tenantId, input.billId);

  for (const payment of payments) {
    const paymentId = positiveId(Number(payment.id), 'paymentId');
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('Legacy payment amount must be positive');
    const sourcePaymentNo = String(payment.receipt_no ?? '').trim() || `payment:${paymentId}`;
    const receiptNo = String(payment.receipt_no ?? '').trim() || `LEGACY-PAY-${paymentId}`;
    const tenderType = paymentTenderType(payment.payment_method);
    await collectPayment(db, await buildLivePaymentProjection({
      tenantId: input.tenantId,
      patientId: Number(bill.patient_id),
      paymentNo: sourcePaymentNo,
      receiptNo,
      currencyCode: 'BDT',
      receivedAtUtc: legacyUtcTimestamp(payment.created_at),
      amount,
      tenderType,
      methodCode: String(payment.payment_method ?? tenderType),
      status: 'captured',
      allocations: [{
        sourceAllocationId: `payment:${paymentId}:bill:${input.billId}`,
        invoicePublicId,
        amount,
      }],
      collectorId: payment.received_by == null ? null : Number(payment.received_by),
      counterId: payment.counter_id == null ? null : Number(payment.counter_id),
      counterSessionId: payment.counter_session_id == null ? null : Number(payment.counter_session_id),
      externalTransactionId: payment.external_transaction_id,
    }));
  }

  return {
    invoicePublicId,
    projectedReceiptCount: payments.length,
  };
}
