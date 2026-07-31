import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLegacyLiveInvoiceSourceLineId } from '../../src/lib/canonical/live-invoice-line-identity';
import {
  buildLiveInvoiceProjection,
  buildLivePaymentProjection,
} from '../../src/lib/canonical/live-financial-projection';
import { toUtcIso } from '../../src/lib/canonical/time';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const PREDEPLOY_BILLING_BACKFILL_APPROVAL = 'CDB101_PREDEPLOY_BILLING_BACKFILL_20260722';
const TENANT_ID = '100';
const INVOICE_NO = 'INV-A-2026-000037';
const RECEIPT_NO = 'RCP-000269';

export interface PredeployBillingBackfillState extends Record<string, unknown> {
  bill_id: number;
  patient_id: number;
  invoice_no: string;
  invoice_code: string | null;
  discount: number;
  discount_reason: string | null;
  discount_by_name: string | null;
  tax_total: number | null;
  total: number;
  paid: number;
  due: number;
  bill_status: string;
  bill_cancelled_at: string | null;
  bill_created_by: number | null;
  bill_created_at: string;
  bill_updated_at: string | null;
  referring_doctor_id: number | null;
  bill_counter_id: number | null;
  bill_counter_session_id: number | null;
  item_id: number;
  item_category: string;
  item_description: string | null;
  item_quantity: number;
  item_unit_price: number;
  item_line_total: number;
  item_reference_id: number | null;
  item_status: string | null;
  item_cancelled_at: string | null;
  item_tax_amount: number | null;
  item_created_at: string;
  payment_id: number;
  payment_amount: number;
  payment_type: string | null;
  payment_legacy_type: string | null;
  receipt_no: string;
  payment_received_by: number | null;
  payment_method: string | null;
  payment_idempotency_key: string | null;
  payment_external_transaction_id: string | null;
  payment_counter_id: number | null;
  payment_counter_session_id: number | null;
  payment_source: string | null;
  payment_date: string;
  payment_created_at: string | null;
  invoice_public_id: string | null;
  invoice_subtotal_minor: number | null;
  invoice_adjustment_total_minor: number | null;
  invoice_total_minor: number | null;
  invoice_paid_minor: number | null;
  invoice_due_minor: number | null;
  invoice_net_due_minor: number | null;
  canonical_invoice_status: string | null;
  invoice_source_evidence_sha256: string | null;
  gross_line_public_id: string | null;
  gross_line_amount_minor: number | null;
  gross_line_source_evidence_sha256: string | null;
  discount_line_public_id: string | null;
  discount_line_amount_minor: number | null;
  discount_line_source_evidence_sha256: string | null;
  canonical_invoice_line_count: number;
  invoice_mapping_count: number;
  invoice_mapping_public_id: string | null;
  invoice_mapping_evidence_sha256: string | null;
  receipt_public_id: string | null;
  receipt_total_minor: number | null;
  receipt_allocated_total_minor: number | null;
  receipt_unallocated_minor: number | null;
  canonical_receipt_status: string | null;
  receipt_source_evidence_sha256: string | null;
  tender_public_id: string | null;
  tender_amount_minor: number | null;
  tender_remaining_minor: number | null;
  tender_source_evidence_sha256: string | null;
  tender_count: number;
  allocation_public_id: string | null;
  allocation_amount_minor: number | null;
  allocation_due_before_minor: number | null;
  allocation_due_after_minor: number | null;
  allocation_balance_guard: number | null;
  allocation_source_evidence_sha256: string | null;
  allocation_count: number;
  payment_mapping_count: number;
  payment_mapping_public_id: string | null;
  payment_mapping_evidence_sha256: string | null;
}

export interface PredeployBillingBackfillGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readState(): Promise<PredeployBillingBackfillState>;
  writeRepair(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

type InvoiceProjection = Awaited<ReturnType<typeof buildLiveInvoiceProjection>>;
type PaymentProjection = Awaited<ReturnType<typeof buildLivePaymentProjection>>;

export interface PredeployBillingBackfillExpectedState {
  invoice: InvoiceProjection;
  grossLine: InvoiceProjection['lines'][number];
  discountLine: InvoiceProjection['lines'][number];
  payment: PaymentProjection;
  tender: PaymentProjection['tenders'][number];
  allocation: PaymentProjection['allocations'][number];
  issuedAtUtc: string;
  receivedAtUtc: string;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function localTimestampToUtc(value: string, label: string): string {
  const raw = value.trim();
  if (!raw) throw new Error(`${label} is missing`);
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}+06:00`);
}

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe integer`);
  return parsed;
}

function validateSourceState(row: PredeployBillingBackfillState): void {
  const exact = (
    Number(row.bill_id) === 6917
    && Number(row.patient_id) === 1995
    && row.invoice_no === INVOICE_NO
    && row.invoice_code === 'BL'
    && Number(row.discount) === 100
    && row.discount_reason === null
    && row.discount_by_name === 'Sir'
    && row.tax_total === null
    && Number(row.total) === 400
    && Number(row.paid) === 400
    && Number(row.due) === 0
    && row.bill_status === 'paid'
    && row.bill_cancelled_at === null
    && Number(row.bill_created_by) === 103
    && row.bill_created_at === '2026-07-22 17:07:53'
    && row.bill_updated_at === '2026-07-22 11:07:53'
    && row.referring_doctor_id === null
    && Number(row.bill_counter_id) === 2
    && Number(row.bill_counter_session_id) === 28
    && Number(row.item_id) === 3078
    && row.item_category === 'doctor_visit'
    && row.item_description === 'Consultation - Dr. Aminul Islam'
    && Number(row.item_quantity) === 1
    && Number(row.item_unit_price) === 500
    && Number(row.item_line_total) === 400
    && Number(row.item_reference_id) === 101
    && row.item_status === 'active'
    && row.item_cancelled_at === null
    && row.item_tax_amount === null
    && row.item_created_at === '2026-07-22 17:07:53'
    && Number(row.payment_id) === 1907
    && Number(row.payment_amount) === 400
    && row.payment_type === 'current'
    && row.payment_legacy_type === 'current'
    && row.receipt_no === RECEIPT_NO
    && Number(row.payment_received_by) === 103
    && row.payment_method === 'cash'
    && row.payment_idempotency_key === null
    && row.payment_external_transaction_id === null
    && Number(row.payment_counter_id) === 2
    && Number(row.payment_counter_session_id) === 28
    && row.payment_source === 'reception'
    && row.payment_date === '2026-07-22 17:07:53'
    && row.payment_created_at === '2026-07-22 11:07:53'
  );
  if (!exact) throw new Error('Pre-deploy billing source state changed');
}

export async function buildPredeployBillingBackfillExpectedState(
  row: PredeployBillingBackfillState,
): Promise<PredeployBillingBackfillExpectedState> {
  validateSourceState(row);
  const issuedAtUtc = localTimestampToUtc(row.bill_created_at, 'bill_created_at');
  const receivedAtUtc = localTimestampToUtc(row.payment_date, 'payment_date');
  const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
    lineNumber: 1,
    itemCategory: row.item_category,
    referenceId: row.item_reference_id,
  });
  const invoice = await buildLiveInvoiceProjection({
    tenantId: TENANT_ID,
    patientId: integer(row.patient_id, 'patient_id'),
    invoiceNo: row.invoice_no,
    currencyCode: 'BDT',
    issuedAtUtc,
    items: [{
      sourceLineId,
      lineType: 'other_adjustment',
      adjustmentCode: 'LEGACY_DOCTOR_VISIT',
      quantity: 1,
      unitAmount: row.item_unit_price,
    }],
    discount: row.discount,
    taxTotal: 0,
  });
  const grossLine = invoice.lines.find((line) => line.adjustmentCode === 'LEGACY_DOCTOR_VISIT');
  const discountLine = invoice.lines.find((line) => line.adjustmentCode === 'LEGACY_DISCOUNT');
  if (!grossLine || !discountLine) throw new Error('Expected invoice projections were not created');
  const payment = await buildLivePaymentProjection({
    tenantId: TENANT_ID,
    patientId: integer(row.patient_id, 'patient_id'),
    paymentNo: row.receipt_no,
    receiptNo: row.receipt_no,
    currencyCode: 'BDT',
    receivedAtUtc,
    amount: row.payment_amount,
    tenderType: 'cash',
    methodCode: 'cash',
    status: 'captured',
    allocations: [{
      sourceAllocationId: `bill:${row.bill_id}`,
      invoicePublicId: invoice.invoicePublicId,
      amount: row.payment_amount,
    }],
    collectorId: row.payment_received_by,
    counterId: row.payment_counter_id,
    counterSessionId: row.payment_counter_session_id,
    externalTransactionId: null,
  });
  const tender = payment.tenders[0];
  const allocation = payment.allocations[0];
  if (!tender || !allocation) throw new Error('Expected payment projections were not created');
  return { invoice, grossLine, discountLine, payment, tender, allocation, issuedAtUtc, receivedAtUtc };
}

function sourcePredicate(): string {
  return `CAST(b.tenant_id AS TEXT)='100'
  AND b.id=6917 AND b.patient_id=1995 AND b.invoice_no='INV-A-2026-000037'
  AND b.invoice_code='BL' AND b.discount=100 AND b.discount_reason IS NULL
  AND b.discount_by_name='Sir' AND b.tax_total IS NULL AND b.total=400 AND b.paid=400
  AND b.due=0 AND b.status='paid' AND b.cancelled_at IS NULL AND b.created_by=103
  AND b.created_at='2026-07-22 17:07:53' AND b.updated_at='2026-07-22 11:07:53'
  AND b.referring_doctor_id IS NULL AND b.counter_id=2 AND b.counter_session_id=28
  AND CAST(ii.tenant_id AS TEXT)='100' AND ii.id=3078 AND ii.bill_id=b.id
  AND ii.item_category='doctor_visit' AND ii.description='Consultation - Dr. Aminul Islam'
  AND ii.quantity=1 AND ii.unit_price=500 AND ii.line_total=400 AND ii.reference_id=101
  AND ii.status='active' AND ii.cancelled_at IS NULL AND ii.tax_amount IS NULL
  AND ii.created_at='2026-07-22 17:07:53'
  AND CAST(p.tenant_id AS TEXT)='100' AND p.id=1907 AND p.bill_id=b.id AND p.amount=400
  AND p.payment_type='current' AND p.type='current' AND p.receipt_no='RCP-000269'
  AND p.received_by=103 AND p.payment_method='cash' AND p.idempotency_key IS NULL
  AND p.external_transaction_id IS NULL AND p.counter_id=2 AND p.counter_session_id=28
  AND p.payment_source='reception' AND p.date='2026-07-22 17:07:53'
  AND p.created_at='2026-07-22 11:07:53'`;
}

function sourceFrom(): string {
  return `FROM bills b
JOIN invoice_items ii ON ii.bill_id=b.id AND CAST(ii.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
JOIN payments p ON p.bill_id=b.id AND CAST(p.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
WHERE ${sourcePredicate()}`;
}

function mappingInsert(input: {
  entityType: 'invoice' | 'payment_receipt';
  canonicalPublicId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  evidenceSha256: string;
  nowUtc: string;
}): string {
  return `INSERT INTO canonical_source_mappings (
  tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
  mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(input.entityType)},${sqlString(input.canonicalPublicId)},
       ${sqlString(input.sourceType)},${sqlString(input.sourcePublicId)},${sqlString(input.sourceTable)},
       'mapped',1,${sqlString(input.evidenceSha256)},${sqlString(input.nowUtc)},${sqlString(input.nowUtc)}
${sourceFrom()}
  AND NOT EXISTS (
    SELECT 1 FROM canonical_source_mappings m
    WHERE m.tenant_id='100' AND m.entity_type=${sqlString(input.entityType)}
      AND m.source_type=${sqlString(input.sourceType)} AND m.source_public_id=${sqlString(input.sourcePublicId)}
  );`;
}

export async function buildPredeployBillingBackfillSql(
  row: PredeployBillingBackfillState,
  nowUtc: string = new Date().toISOString(),
): Promise<string> {
  const expected = await buildPredeployBillingBackfillExpectedState(row);
  const normalizedNow = toUtcIso(nowUtc);
  const { invoice, grossLine, discountLine, payment, tender, allocation } = expected;
  return `INSERT INTO canonical_invoices (
  tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
  subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,credited_minor,net_due_minor,
  adjustment_projection_guard,status,issued_at_utc,posted_at_utc,cancelled_at_utc,reversed_at_utc,
  source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(invoice.invoicePublicId)},${sqlString(invoice.invoiceNumber)},1995,'BDT',
       50000,-10000,40000,40000,0,0,0,1,'posted',${sqlString(expected.issuedAtUtc)},
       ${sqlString(expected.issuedAtUtc)},NULL,NULL,${sqlString(invoice.sourceEvidenceSha256)},
       ${sqlString(normalizedNow)},${sqlString(normalizedNow)}
${sourceFrom()}
  AND NOT EXISTS (
    SELECT 1 FROM canonical_invoices ci
    WHERE ci.tenant_id='100'
      AND (ci.invoice_public_id=${sqlString(invoice.invoicePublicId)} OR ci.invoice_number='INV-A-2026-000037')
  );
INSERT INTO canonical_invoice_lines (
  tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,adjustment_code,
  quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(grossLine.linePublicId)},${sqlString(invoice.invoicePublicId)},
       ${sqlString(grossLine.lineType)},NULL,${sqlString(grossLine.adjustmentCode ?? '')},1,50000,50000,
       ${sqlString(grossLine.sourceEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
${sourceFrom()}
  AND EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.tenant_id='100' AND ci.invoice_public_id=${sqlString(invoice.invoicePublicId)})
  AND NOT EXISTS (SELECT 1 FROM canonical_invoice_lines cil WHERE cil.tenant_id='100' AND cil.line_public_id=${sqlString(grossLine.linePublicId)});
INSERT INTO canonical_invoice_lines (
  tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,adjustment_code,
  quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(discountLine.linePublicId)},${sqlString(invoice.invoicePublicId)},
       'discount',NULL,'LEGACY_DISCOUNT',1,-10000,-10000,
       ${sqlString(discountLine.sourceEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
${sourceFrom()}
  AND EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.tenant_id='100' AND ci.invoice_public_id=${sqlString(invoice.invoicePublicId)})
  AND NOT EXISTS (SELECT 1 FROM canonical_invoice_lines cil WHERE cil.tenant_id='100' AND cil.line_public_id=${sqlString(discountLine.linePublicId)});
${mappingInsert({
    entityType: 'invoice',
    canonicalPublicId: invoice.invoicePublicId,
    sourceType: invoice.sourceType,
    sourcePublicId: invoice.sourcePublicId,
    sourceTable: invoice.sourceTable,
    evidenceSha256: invoice.sourceEvidenceSha256,
    nowUtc: normalizedNow,
  })}
INSERT INTO canonical_payment_receipts (
  tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,total_minor,
  allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,legacy_collector_id,
  legacy_counter_id,legacy_counter_session_id,external_transaction_id,posted_at_utc,failed_at_utc,
  refunded_minor,net_received_minor,refund_projection_guard,reconciliation_guard,
  source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(payment.receiptPublicId)},${sqlString(payment.receiptNumber)},1995,'BDT',
       40000,40000,0,'posted',${sqlString(expected.receivedAtUtc)},${sqlString(payment.businessDate)},
       103,2,28,NULL,${sqlString(expected.receivedAtUtc)},NULL,0,40000,1,1,
       ${sqlString(payment.sourceEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
${sourceFrom()}
  AND EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.tenant_id='100' AND ci.invoice_public_id=${sqlString(invoice.invoicePublicId)})
  AND NOT EXISTS (
    SELECT 1 FROM canonical_payment_receipts r
    WHERE r.tenant_id='100'
      AND (r.receipt_public_id=${sqlString(payment.receiptPublicId)} OR r.receipt_number='RCP-000269')
  );
INSERT INTO canonical_payment_tenders (
  tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,amount_minor,status,
  external_transaction_id,captured_at_utc,failed_at_utc,reversed_minor,remaining_minor,
  reversal_projection_guard,source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(tender.tenderPublicId)},${sqlString(payment.receiptPublicId)},'cash','cash',
       40000,'captured',NULL,${sqlString(expected.receivedAtUtc)},NULL,0,40000,1,
       ${sqlString(tender.sourceEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
${sourceFrom()}
  AND EXISTS (SELECT 1 FROM canonical_payment_receipts r WHERE r.tenant_id='100' AND r.receipt_public_id=${sqlString(payment.receiptPublicId)})
  AND NOT EXISTS (SELECT 1 FROM canonical_payment_tenders t WHERE t.tenant_id='100' AND t.tender_public_id=${sqlString(tender.tenderPublicId)});
INSERT INTO canonical_payment_allocations (
  tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,invoice_line_public_id,
  amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,allocated_at_utc,
  reversed_minor,remaining_minor,reversal_projection_guard,balance_guard,
  source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(allocation.allocationPublicId)},${sqlString(payment.receiptPublicId)},
       ${sqlString(invoice.invoicePublicId)},NULL,40000,40000,0,'active',${sqlString(expected.receivedAtUtc)},
       0,40000,1,1,${sqlString(allocation.sourceEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
${sourceFrom()}
  AND EXISTS (SELECT 1 FROM canonical_payment_receipts r WHERE r.tenant_id='100' AND r.receipt_public_id=${sqlString(payment.receiptPublicId)})
  AND EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.tenant_id='100' AND ci.invoice_public_id=${sqlString(invoice.invoicePublicId)} AND ci.paid_minor=40000 AND ci.due_minor=0)
  AND NOT EXISTS (SELECT 1 FROM canonical_payment_allocations a WHERE a.tenant_id='100' AND a.allocation_public_id=${sqlString(allocation.allocationPublicId)});
${mappingInsert({
    entityType: 'payment_receipt',
    canonicalPublicId: payment.receiptPublicId,
    sourceType: payment.sourceType,
    sourcePublicId: payment.sourcePublicId,
    sourceTable: payment.sourceTable,
    evidenceSha256: payment.sourceEvidenceSha256,
    nowUtc: normalizedNow,
  })}`;
}

function canonicalStateCount(row: PredeployBillingBackfillState): number {
  const values = [
    row.invoice_public_id,
    row.gross_line_public_id,
    row.discount_line_public_id,
    row.receipt_public_id,
    row.tender_public_id,
    row.allocation_public_id,
  ];
  return values.filter(Boolean).length
    + Number(row.canonical_invoice_line_count ?? 0)
    + Number(row.invoice_mapping_count ?? 0)
    + Number(row.payment_mapping_count ?? 0);
}

function validateCompleteState(
  row: PredeployBillingBackfillState,
  expected: PredeployBillingBackfillExpectedState,
): void {
  const exact = (
    row.invoice_public_id === expected.invoice.invoicePublicId
    && Number(row.invoice_subtotal_minor) === 50_000
    && Number(row.invoice_adjustment_total_minor) === -10_000
    && Number(row.invoice_total_minor) === 40_000
    && Number(row.invoice_paid_minor) === 40_000
    && Number(row.invoice_due_minor) === 0
    && Number(row.invoice_net_due_minor) === 0
    && row.canonical_invoice_status === 'posted'
    && row.invoice_source_evidence_sha256 === expected.invoice.sourceEvidenceSha256
    && row.gross_line_public_id === expected.grossLine.linePublicId
    && Number(row.gross_line_amount_minor) === 50_000
    && row.gross_line_source_evidence_sha256 === expected.grossLine.sourceEvidenceSha256
    && row.discount_line_public_id === expected.discountLine.linePublicId
    && Number(row.discount_line_amount_minor) === -10_000
    && row.discount_line_source_evidence_sha256 === expected.discountLine.sourceEvidenceSha256
    && Number(row.canonical_invoice_line_count) === 2
    && Number(row.invoice_mapping_count) === 1
    && row.invoice_mapping_public_id === expected.invoice.invoicePublicId
    && row.invoice_mapping_evidence_sha256 === expected.invoice.sourceEvidenceSha256
    && row.receipt_public_id === expected.payment.receiptPublicId
    && Number(row.receipt_total_minor) === 40_000
    && Number(row.receipt_allocated_total_minor) === 40_000
    && Number(row.receipt_unallocated_minor) === 0
    && row.canonical_receipt_status === 'posted'
    && row.receipt_source_evidence_sha256 === expected.payment.sourceEvidenceSha256
    && row.tender_public_id === expected.tender.tenderPublicId
    && Number(row.tender_amount_minor) === 40_000
    && Number(row.tender_remaining_minor) === 40_000
    && row.tender_source_evidence_sha256 === expected.tender.sourceEvidenceSha256
    && Number(row.tender_count) === 1
    && row.allocation_public_id === expected.allocation.allocationPublicId
    && Number(row.allocation_amount_minor) === 40_000
    && Number(row.allocation_due_before_minor) === 40_000
    && Number(row.allocation_due_after_minor) === 0
    && Number(row.allocation_balance_guard) === 1
    && row.allocation_source_evidence_sha256 === expected.allocation.sourceEvidenceSha256
    && Number(row.allocation_count) === 1
    && Number(row.payment_mapping_count) === 1
    && row.payment_mapping_public_id === expected.payment.receiptPublicId
    && row.payment_mapping_evidence_sha256 === expected.payment.sourceEvidenceSha256
  );
  if (!exact) throw new Error('Pre-deploy billing canonical post-state verification failed');
}

export async function executePredeployBillingBackfill(
  input: { approval: string; execute: boolean },
  gateway: PredeployBillingBackfillGateway,
): Promise<{
  repaired: true;
  execution: 'created' | 'verified_existing';
  canonicalRowsCreated: 8;
  invoiceNumber: typeof INVOICE_NO;
  receiptNumber: typeof RECEIPT_NO;
  writeMeta: { changes: number; rowsWritten: number } | null;
}> {
  if (!input.execute) throw new Error('Explicit execute switch is required');
  if (input.approval !== PREDEPLOY_BILLING_BACKFILL_APPROVAL) throw new Error('Pre-deploy billing backfill approval mismatch');
  const identity = await gateway.readDatabaseIdentity();
  if (identity.uuid !== CDB101_PRODUCTION_DATABASE_ID || identity.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production database identity mismatch');
  }
  const before = await gateway.readState();
  validateSourceState(before);
  const expected = await buildPredeployBillingBackfillExpectedState(before);
  const currentCount = canonicalStateCount(before);
  if (currentCount > 0) {
    try {
      validateCompleteState(before, expected);
    } catch (cause) {
      throw new Error('Pre-deploy billing has partial canonical state', { cause });
    }
    return {
      repaired: true,
      execution: 'verified_existing',
      canonicalRowsCreated: 8,
      invoiceNumber: INVOICE_NO,
      receiptNumber: RECEIPT_NO,
      writeMeta: null,
    };
  }
  const writeMeta = await gateway.writeRepair(await buildPredeployBillingBackfillSql(before));
  const after = await gateway.readState();
  validateSourceState(after);
  validateCompleteState(after, expected);
  return {
    repaired: true,
    execution: 'created',
    canonicalRowsCreated: 8,
    invoiceNumber: INVOICE_NO,
    receiptNumber: RECEIPT_NO,
    writeMeta,
  };
}

export const PREDEPLOY_BILLING_BACKFILL_READ_SQL = `
SELECT
  b.id AS bill_id,b.patient_id,b.invoice_no,b.invoice_code,b.discount,b.discount_reason,
  b.discount_by_name,b.tax_total,b.total,b.paid,b.due,b.status AS bill_status,
  b.cancelled_at AS bill_cancelled_at,b.created_by AS bill_created_by,
  b.created_at AS bill_created_at,b.updated_at AS bill_updated_at,b.referring_doctor_id,
  b.counter_id AS bill_counter_id,b.counter_session_id AS bill_counter_session_id,
  ii.id AS item_id,ii.item_category,ii.description AS item_description,
  ii.quantity AS item_quantity,ii.unit_price AS item_unit_price,ii.line_total AS item_line_total,
  ii.reference_id AS item_reference_id,ii.status AS item_status,
  ii.cancelled_at AS item_cancelled_at,ii.tax_amount AS item_tax_amount,
  ii.created_at AS item_created_at,p.id AS payment_id,p.amount AS payment_amount,
  p.payment_type,p.type AS payment_legacy_type,p.receipt_no,p.received_by AS payment_received_by,
  p.payment_method,p.idempotency_key AS payment_idempotency_key,
  p.external_transaction_id AS payment_external_transaction_id,
  p.counter_id AS payment_counter_id,p.counter_session_id AS payment_counter_session_id,
  p.payment_source,p.date AS payment_date,p.created_at AS payment_created_at,
  ci.invoice_public_id,ci.subtotal_minor AS invoice_subtotal_minor,
  ci.adjustment_total_minor AS invoice_adjustment_total_minor,ci.total_minor AS invoice_total_minor,
  ci.paid_minor AS invoice_paid_minor,ci.due_minor AS invoice_due_minor,
  ci.net_due_minor AS invoice_net_due_minor,ci.status AS canonical_invoice_status,
  ci.source_evidence_sha256 AS invoice_source_evidence_sha256,
  (SELECT line_public_id FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id
     AND l.adjustment_code='LEGACY_DOCTOR_VISIT' LIMIT 1) AS gross_line_public_id,
  (SELECT line_amount_minor FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id
     AND l.adjustment_code='LEGACY_DOCTOR_VISIT' LIMIT 1) AS gross_line_amount_minor,
  (SELECT source_evidence_sha256 FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id
     AND l.adjustment_code='LEGACY_DOCTOR_VISIT' LIMIT 1) AS gross_line_source_evidence_sha256,
  (SELECT line_public_id FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id
     AND l.adjustment_code='LEGACY_DISCOUNT' LIMIT 1) AS discount_line_public_id,
  (SELECT line_amount_minor FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id
     AND l.adjustment_code='LEGACY_DISCOUNT' LIMIT 1) AS discount_line_amount_minor,
  (SELECT source_evidence_sha256 FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id
     AND l.adjustment_code='LEGACY_DISCOUNT' LIMIT 1) AS discount_line_source_evidence_sha256,
  (SELECT COUNT(*) FROM canonical_invoice_lines l
   WHERE l.tenant_id='100' AND l.invoice_public_id=ci.invoice_public_id) AS canonical_invoice_line_count,
  (SELECT COUNT(*) FROM canonical_source_mappings m
   WHERE m.tenant_id='100' AND m.entity_type='invoice' AND m.source_type='legacy_live_bill'
     AND m.source_public_id=b.invoice_no AND m.mapping_status='mapped') AS invoice_mapping_count,
  (SELECT canonical_public_id FROM canonical_source_mappings m
   WHERE m.tenant_id='100' AND m.entity_type='invoice' AND m.source_type='legacy_live_bill'
     AND m.source_public_id=b.invoice_no AND m.mapping_status='mapped' LIMIT 1) AS invoice_mapping_public_id,
  (SELECT evidence_sha256 FROM canonical_source_mappings m
   WHERE m.tenant_id='100' AND m.entity_type='invoice' AND m.source_type='legacy_live_bill'
     AND m.source_public_id=b.invoice_no AND m.mapping_status='mapped' LIMIT 1) AS invoice_mapping_evidence_sha256,
  r.receipt_public_id,r.total_minor AS receipt_total_minor,
  r.allocated_total_minor AS receipt_allocated_total_minor,r.unallocated_minor AS receipt_unallocated_minor,
  r.status AS canonical_receipt_status,r.source_evidence_sha256 AS receipt_source_evidence_sha256,
  (SELECT tender_public_id FROM canonical_payment_tenders t
   WHERE t.tenant_id='100' AND t.receipt_public_id=r.receipt_public_id LIMIT 1) AS tender_public_id,
  (SELECT amount_minor FROM canonical_payment_tenders t
   WHERE t.tenant_id='100' AND t.receipt_public_id=r.receipt_public_id LIMIT 1) AS tender_amount_minor,
  (SELECT remaining_minor FROM canonical_payment_tenders t
   WHERE t.tenant_id='100' AND t.receipt_public_id=r.receipt_public_id LIMIT 1) AS tender_remaining_minor,
  (SELECT source_evidence_sha256 FROM canonical_payment_tenders t
   WHERE t.tenant_id='100' AND t.receipt_public_id=r.receipt_public_id LIMIT 1) AS tender_source_evidence_sha256,
  (SELECT COUNT(*) FROM canonical_payment_tenders t
   WHERE t.tenant_id='100' AND t.receipt_public_id=r.receipt_public_id) AS tender_count,
  (SELECT allocation_public_id FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id LIMIT 1) AS allocation_public_id,
  (SELECT amount_minor FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id LIMIT 1) AS allocation_amount_minor,
  (SELECT invoice_due_before_minor FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id LIMIT 1) AS allocation_due_before_minor,
  (SELECT invoice_due_after_minor FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id LIMIT 1) AS allocation_due_after_minor,
  (SELECT balance_guard FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id LIMIT 1) AS allocation_balance_guard,
  (SELECT source_evidence_sha256 FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id LIMIT 1) AS allocation_source_evidence_sha256,
  (SELECT COUNT(*) FROM canonical_payment_allocations a
   WHERE a.tenant_id='100' AND a.receipt_public_id=r.receipt_public_id) AS allocation_count,
  (SELECT COUNT(*) FROM canonical_source_mappings m
   WHERE m.tenant_id='100' AND m.entity_type='payment_receipt'
     AND m.source_type='legacy_live_payment' AND m.source_public_id=p.receipt_no
     AND m.mapping_status='mapped') AS payment_mapping_count,
  (SELECT canonical_public_id FROM canonical_source_mappings m
   WHERE m.tenant_id='100' AND m.entity_type='payment_receipt'
     AND m.source_type='legacy_live_payment' AND m.source_public_id=p.receipt_no
     AND m.mapping_status='mapped' LIMIT 1) AS payment_mapping_public_id,
  (SELECT evidence_sha256 FROM canonical_source_mappings m
   WHERE m.tenant_id='100' AND m.entity_type='payment_receipt'
     AND m.source_type='legacy_live_payment' AND m.source_public_id=p.receipt_no
     AND m.mapping_status='mapped' LIMIT 1) AS payment_mapping_evidence_sha256
FROM bills b
JOIN invoice_items ii ON ii.bill_id=b.id AND CAST(ii.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND ii.id=3078
JOIN payments p ON p.bill_id=b.id AND CAST(p.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND p.id=1907
LEFT JOIN canonical_invoices ci ON ci.tenant_id='100' AND ci.invoice_number=b.invoice_no
LEFT JOIN canonical_payment_receipts r ON r.tenant_id='100' AND r.receipt_number=p.receipt_no
WHERE CAST(b.tenant_id AS TEXT)='100' AND b.id=6917;
`.trim();

interface CommandResult { stdout: string; stderr: string; status: number }
type Runner = (args: string[]) => CommandResult;

function defaultRunner(args: string[]): CommandResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
}

function run(runner: Runner, args: string[], label: string): CommandResult {
  const result = runner(args);
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  return result;
}

function extractJson(text: string): unknown {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  throw new Error('Wrangler output did not contain JSON');
}

interface D1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

function envelopes(text: string): D1Envelope[] {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('D1 output was not a non-empty array');
  const rows = parsed as D1Envelope[];
  if (rows.some((row) => row.success !== true)) throw new Error('D1 output contained an unsuccessful envelope');
  return rows;
}

export function createProductionGateway(runner: Runner = defaultRunner): PredeployBillingBackfillGateway {
  return {
    async readDatabaseIdentity() {
      const result = run(runner, [
        'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json',
      ], 'production database identity');
      return extractJson(result.stdout) as { uuid: unknown; name: unknown };
    },
    async readState() {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--command', PREDEPLOY_BILLING_BACKFILL_READ_SQL,
      ], 'pre-deploy billing backfill read');
      const rows = envelopes(result.stdout).flatMap((row) => row.results ?? []);
      if (rows.length !== 1) throw new Error('Pre-deploy billing source query did not return exactly one row');
      return rows[0] as PredeployBillingBackfillState;
    },
    async writeRepair(sql: string) {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--yes', '--command', sql,
      ], 'pre-deploy billing backfill write');
      const rows = envelopes(result.stdout);
      return {
        changes: rows.reduce((sum, row) => sum + Number(row.meta?.changes ?? 0), 0),
        rowsWritten: rows.reduce((sum, row) => sum + Number(row.meta?.rows_written ?? 0), 0),
      };
    },
  };
}

function outsideRepository(path: string, root: string): string {
  const absolute = resolve(path);
  const repository = resolve(root);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Pre-deploy billing backfill receipt must remain outside repository');
  }
  return absolute;
}

function protectedDirectory(path: string, root: string): string {
  const absolute = outsideRepository(path, root);
  if (!existsSync(absolute)) throw new Error(`Protected directory missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Protected directory must be mode 700');
  }
  return absolute;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const outputIndex = args.indexOf('--output');
  const approvalIndex = args.indexOf('--approval');
  const execute = args.includes('--execute');
  if (outputIndex < 0 || !args[outputIndex + 1] || approvalIndex < 0 || !args[approvalIndex + 1]) {
    throw new Error('--output and --approval are required');
  }
  const output = outsideRepository(args[outputIndex + 1], process.cwd());
  protectedDirectory(dirname(output), process.cwd());
  if (existsSync(output)) throw new Error('Pre-deploy billing backfill receipt already exists');
  const result = await executePredeployBillingBackfill({
    approval: args[approvalIndex + 1],
    execute,
  }, createProductionGateway());
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    executedAtUtc: new Date().toISOString(),
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    result,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(output, 0o600);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
