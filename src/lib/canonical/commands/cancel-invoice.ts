import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';

interface QueryPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): QueryPreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface CancelUnpaidInvoiceInput {
  tenantId: string;
  invoicePublicId: string;
  reasonCode: string;
  cancelledAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface CancelUnpaidInvoiceResult {
  invoicePublicId: string;
  status: 'cancelled';
  totalMinor: number;
  reversedCompensationMinor: number;
  reversedCompensationCount: number;
}

interface InvoiceRow {
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

interface CompensationRow {
  accrual_public_id: string;
  practitioner_public_id: string | null;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  status: string;
}

interface CompensationCancellation {
  row: CompensationRow;
  adjustmentPublicId: string;
  sourcePublicId: string;
  evidenceSha256: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

function businessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('businessDate must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function safeNonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function query(db: CanonicalBatchDatabase, sql: string): QueryPreparedStatement {
  return db.prepare(sql) as QueryPreparedStatement;
}

function compensationMappingStatement(
  db: CanonicalBatchDatabase,
  input: CancelUnpaidInvoiceInput,
  cancellation: CompensationCancellation,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'compensation_adjustment',?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    cancellation.adjustmentPublicId,
    'legacy_bill_cancellation_compensation',
    cancellation.sourcePublicId,
    input.sourceTable,
    cancellation.evidenceSha256,
  );
}

async function buildCompensationCancellations(
  input: CancelUnpaidInvoiceInput,
  rows: readonly CompensationRow[],
): Promise<CompensationCancellation[]> {
  const cancellations: CompensationCancellation[] = [];
  for (const row of rows) {
    safeNonNegative(row.adjusted_minor, 'compensation adjusted_minor');
    safeNonNegative(row.settled_minor, 'compensation settled_minor');
    safeNonNegative(row.payable_minor, 'compensation payable_minor');
    if (row.settled_minor > 0) {
      throw new Error('Settled canonical compensation blocks unpaid invoice cancellation');
    }
    if (row.payable_minor === 0) continue;

    const sourcePublicId = `${input.sourcePublicId}:${row.accrual_public_id}`;
    const adjustmentPublicId = await createDeterministicSourceId(
      'compadj',
      input.tenantId,
      'legacy_bill_cancellation_compensation',
      sourcePublicId,
    );
    const evidenceSha256 = await createSourceEvidenceSha256({
      sourceEvidenceSha256: input.sourceEvidenceSha256,
      invoicePublicId: input.invoicePublicId,
      accrualPublicId: row.accrual_public_id,
      adjustedMinor: row.adjusted_minor,
      settledMinor: row.settled_minor,
      payableMinor: row.payable_minor,
      status: row.status,
      cancellationReasonCode: input.reasonCode,
      cancelledAtUtc: input.cancelledAtUtc,
    });
    cancellations.push({ row, adjustmentPublicId, sourcePublicId, evidenceSha256 });
  }
  return cancellations;
}

export async function cancelUnpaidInvoice(
  db: CanonicalBatchDatabase,
  input: CancelUnpaidInvoiceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CancelUnpaidInvoiceResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.invoicePublicId, 'invoicePublicId');
  exact(input.reasonCode, 'reasonCode');
  utc(input.cancelledAtUtc, 'cancelledAtUtc');
  businessDate(input.businessDate);
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');

  const request = {
    invoicePublicId: input.invoicePublicId,
    reasonCode: input.reasonCode,
    cancelledAtUtc: input.cancelledAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<CancelUnpaidInvoiceResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.cancel_unpaid',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const invoice = await db.prepare(`
    SELECT total_minor,paid_minor,due_minor,credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.invoicePublicId).first<InvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  safeNonNegative(invoice.total_minor, 'invoice total_minor');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (
    invoice.paid_minor !== 0
    || invoice.due_minor !== invoice.total_minor
    || invoice.credited_minor !== 0
    || invoice.net_due_minor !== invoice.total_minor
  ) {
    throw new Error('Canonical invoice is not an unpaid unadjusted invoice');
  }

  const conflictingAuthority = await db.prepare(`
    SELECT 1 present
    WHERE EXISTS (
      SELECT 1 FROM canonical_payment_allocations
      WHERE tenant_id=? AND invoice_public_id=? AND status='active' AND remaining_minor>0
    ) OR EXISTS (
      SELECT 1 FROM canonical_deposit_applications
      WHERE tenant_id=? AND invoice_public_id=? AND status='active'
    ) OR EXISTS (
      SELECT 1 FROM canonical_credit_notes
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
    )
    LIMIT 1
  `).bind(
    input.tenantId,
    input.invoicePublicId,
    input.tenantId,
    input.invoicePublicId,
    input.tenantId,
    input.invoicePublicId,
  ).first<{ present: number }>();
  if (conflictingAuthority) {
    throw new Error('Canonical payment, deposit, or credit authority blocks unpaid invoice cancellation');
  }

  const compensationRows = (await query(db, `
    SELECT accrual_public_id,practitioner_public_id,adjusted_minor,settled_minor,payable_minor,status
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND invoice_public_id=?
    ORDER BY accrual_public_id
  `).bind(input.tenantId, input.invoicePublicId).all<CompensationRow>()).results ?? [];
  const cancellations = await buildCompensationCancellations(input, compensationRows);

  let reversedCompensationMinor = 0;
  for (const cancellation of cancellations) {
    reversedCompensationMinor += cancellation.row.payable_minor;
    if (!Number.isSafeInteger(reversedCompensationMinor)) {
      throw new RangeError('Reversed compensation total exceeds safe integer range');
    }
  }
  const result: CancelUnpaidInvoiceResult = {
    invoicePublicId: input.invoicePublicId,
    status: 'cancelled',
    totalMinor: invoice.total_minor,
    reversedCompensationMinor,
    reversedCompensationCount: cancellations.length,
  };

  const compensationStatements: CanonicalPreparedStatement[] = [];
  for (const cancellation of cancellations) {
    const row = cancellation.row;
    const adjustedAfter = row.adjusted_minor + row.payable_minor;
    compensationStatements.push(
      db.prepare(`
        INSERT INTO canonical_compensation_adjustments (
          tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
          settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
          accrual_adjusted_before_minor,accrual_adjusted_after_minor,
          accrual_settled_before_minor,accrual_settled_after_minor,
          accrual_payable_before_minor,accrual_payable_after_minor,
          occurred_at_utc,business_date,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,NULL,NULL,'service_cancellation',?,?,?,?,?,?,?,?,?,?,1,?)
      `).bind(
        input.tenantId,
        cancellation.adjustmentPublicId,
        row.accrual_public_id,
        input.reasonCode,
        row.payable_minor,
        row.adjusted_minor,
        adjustedAfter,
        row.settled_minor,
        row.settled_minor,
        row.payable_minor,
        0,
        input.cancelledAtUtc,
        input.businessDate,
        cancellation.evidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor=?,payable_minor=0,status='reversed',updated_at_utc=?
        WHERE tenant_id=? AND accrual_public_id=?
          AND adjusted_minor=? AND settled_minor=0 AND payable_minor=? AND status=?
      `).bind(
        adjustedAfter,
        input.cancelledAtUtc,
        input.tenantId,
        row.accrual_public_id,
        row.adjusted_minor,
        row.payable_minor,
        row.status,
      ),
      db.prepare(`
        UPDATE canonical_compensation_adjustments
        SET balance_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_compensation_accruals
          WHERE tenant_id=? AND accrual_public_id=?
            AND adjusted_minor=? AND settled_minor=0 AND payable_minor=0 AND status='reversed'
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND adjustment_public_id=?
      `).bind(
        input.tenantId,
        row.accrual_public_id,
        adjustedAfter,
        input.tenantId,
        cancellation.adjustmentPublicId,
      ),
      compensationMappingStatement(db, input, cancellation),
    );
  }

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.cancel_unpaid',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements: [
      db.prepare(`
        UPDATE canonical_invoices
        SET status='cancelled',cancelled_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND invoice_public_id=?
          AND status='posted' AND paid_minor=0 AND due_minor=total_minor
          AND credited_minor=0 AND net_due_minor=total_minor
      `).bind(
        input.cancelledAtUtc,
        input.cancelledAtUtc,
        input.tenantId,
        input.invoicePublicId,
      ),
      ...compensationStatements,
      db.prepare(`
        UPDATE canonical_invoices
        SET adjustment_projection_guard=CASE WHEN
          status='cancelled' AND cancelled_at_utc=?
          AND paid_minor=0 AND due_minor=total_minor
          AND credited_minor=0 AND net_due_minor=total_minor
          AND NOT EXISTS (
            SELECT 1 FROM canonical_compensation_accruals a
            WHERE a.tenant_id=canonical_invoices.tenant_id
              AND a.invoice_public_id=canonical_invoices.invoice_public_id
              AND (a.settled_minor>0 OR a.payable_minor>0)
          )
        THEN 1 ELSE 0 END
        WHERE tenant_id=? AND invoice_public_id=?
      `).bind(
        input.cancelledAtUtc,
        input.tenantId,
        input.invoicePublicId,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_invoice',
      aggregatePublicId: input.invoicePublicId,
      eventType: 'canonical.invoice.cancelled',
      occurredAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      payload: {
        invoicePublicId: input.invoicePublicId,
        status: 'cancelled',
        totalMinor: invoice.total_minor,
        reversedCompensationMinor,
        reversedCompensationCount: cancellations.length,
      },
    },
  });
}
