import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { toUtcIso } from '../time';

export type InvoiceLineType =
  | 'service'
  | 'discount'
  | 'tax'
  | 'rounding'
  | 'surcharge'
  | 'waiver'
  | 'other_adjustment';

export interface IssueInvoiceLineInput {
  linePublicId: string;
  lineType: InvoiceLineType;
  serviceEventPublicId?: string | null;
  adjustmentCode?: string | null;
  quantity: number;
  unitAmountMinor: number;
  sourceEvidenceSha256: string;
}

export interface IssueInvoiceInput {
  tenantId: string;
  invoicePublicId: string;
  invoiceNumber: string;
  legacyPatientId: number;
  currencyCode: string;
  issuedAtUtc: string;
  lines: readonly IssueInvoiceLineInput[];
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
  businessDate: string;
}

export interface IssueInvoiceResult {
  invoicePublicId: string;
  status: 'posted';
  subtotalMinor: number;
  adjustmentTotalMinor: number;
  totalMinor: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function positive(value: number, label: string): number {
  safeInteger(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function addSafe(total: bigint, value: bigint, label: string): bigint {
  const next = total + value;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (next > max || next < -max) throw new RangeError(`${label} exceeds the safe integer range`);
  return next;
}

function validateLine(line: IssueInvoiceLineInput): number {
  exact(line.linePublicId, 'line.linePublicId');
  hash(line.sourceEvidenceSha256, 'line.sourceEvidenceSha256');
  positive(line.quantity, 'line.quantity');
  safeInteger(line.unitAmountMinor, 'line.unitAmountMinor');

  if (line.lineType === 'service') {
    exact(line.serviceEventPublicId ?? '', 'line.serviceEventPublicId');
    if (line.adjustmentCode != null) throw new TypeError('service line cannot have adjustmentCode');
    if (line.unitAmountMinor < 0) throw new RangeError('service line amount cannot be negative');
    const amount = BigInt(line.quantity) * BigInt(line.unitAmountMinor);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('service line amount exceeds the safe integer range');
    }
    return Number(amount);
  }

  if (line.serviceEventPublicId != null) {
    throw new TypeError('adjustment line cannot have serviceEventPublicId');
  }
  exact(line.adjustmentCode ?? '', 'line.adjustmentCode');
  if (line.quantity !== 1) throw new RangeError('adjustment line quantity must be 1');
  if ((line.lineType === 'discount' || line.lineType === 'waiver') && line.unitAmountMinor > 0) {
    throw new RangeError(`${line.lineType} must be negative or zero`);
  }
  if ((line.lineType === 'tax' || line.lineType === 'surcharge') && line.unitAmountMinor < 0) {
    throw new RangeError(`${line.lineType} must be positive or zero`);
  }
  return line.unitAmountMinor;
}

function lineStatement(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceInput,
  line: IssueInvoiceLineInput,
  lineAmountMinor: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,
      service_event_public_id,adjustment_code,quantity,unit_amount_minor,
      line_amount_minor,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    line.linePublicId,
    input.invoicePublicId,
    line.lineType,
    line.serviceEventPublicId ?? null,
    line.adjustmentCode ?? null,
    line.quantity,
    line.unitAmountMinor,
    lineAmountMinor,
    line.sourceEvidenceSha256,
  );
}

export async function issueInvoice(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<IssueInvoiceResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.invoicePublicId, 'invoicePublicId');
  exact(input.invoiceNumber, 'invoiceNumber');
  positive(input.legacyPatientId, 'legacyPatientId');
  exact(input.currencyCode, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
    throw new RangeError('currencyCode must be three uppercase letters');
  }
  if (toUtcIso(input.issuedAtUtc) !== input.issuedAtUtc) {
    throw new RangeError('issuedAtUtc must be a normalized UTC ISO timestamp');
  }
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  if (input.lines.length === 0) throw new RangeError('invoice must contain at least one line');

  const lineIds = new Set<string>();
  const serviceEvents = new Set<string>();
  const lineAmounts: number[] = [];
  let subtotal = 0n;
  let adjustments = 0n;

  for (const line of input.lines) {
    if (lineIds.has(line.linePublicId)) throw new RangeError('duplicate linePublicId in invoice');
    lineIds.add(line.linePublicId);
    if (line.lineType === 'service') {
      const eventId = line.serviceEventPublicId ?? '';
      if (serviceEvents.has(eventId)) throw new RangeError('duplicate serviceEventPublicId in invoice');
      serviceEvents.add(eventId);
    }
    const amount = validateLine(line);
    lineAmounts.push(amount);
    if (line.lineType === 'service' || (line.lineType === 'other_adjustment' && amount > 0)) {
      subtotal = addSafe(subtotal, BigInt(amount), 'subtotal');
    } else {
      adjustments = addSafe(adjustments, BigInt(amount), 'adjustment total');
    }
  }

  const total = addSafe(subtotal, adjustments, 'invoice total');
  if (total < 0n) throw new RangeError('invoice total cannot be negative');
  const result: IssueInvoiceResult = {
    invoicePublicId: input.invoicePublicId,
    status: 'posted',
    subtotalMinor: Number(subtotal),
    adjustmentTotalMinor: Number(adjustments),
    totalMinor: Number(total),
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.issue',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request: {
      invoicePublicId: input.invoicePublicId,
      invoiceNumber: input.invoiceNumber,
      legacyPatientId: input.legacyPatientId,
      currencyCode: input.currencyCode,
      issuedAtUtc: input.issuedAtUtc,
      lines: input.lines,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    },
    statements: [
      db.prepare(`
        INSERT INTO canonical_invoices (
          tenant_id,invoice_public_id,invoice_number,legacy_patient_id,
          currency_code,subtotal_minor,adjustment_total_minor,total_minor,
          paid_minor,due_minor,credited_minor,net_due_minor,adjustment_projection_guard,
          status,issued_at_utc,posted_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,0,?,0,?,1,'posted',?,?,?)
      `).bind(
        input.tenantId,
        input.invoicePublicId,
        input.invoiceNumber,
        input.legacyPatientId,
        input.currencyCode,
        result.subtotalMinor,
        result.adjustmentTotalMinor,
        result.totalMinor,
        result.totalMinor,
        result.totalMinor,
        input.issuedAtUtc,
        input.issuedAtUtc,
        input.sourceEvidenceSha256,
      ),
      ...input.lines.map((line, index) => lineStatement(db, input, line, lineAmounts[index])),
    ],
    reconciliationStatements: [
      db.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (?,'invoice',?,?,?,?,'mapped',1,?)
      `).bind(
        input.tenantId,
        input.invoicePublicId,
        input.sourceType,
        input.sourcePublicId,
        input.sourceTable,
        input.sourceEvidenceSha256,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_invoice',
      aggregatePublicId: input.invoicePublicId,
      eventType: 'canonical.invoice.issued',
      occurredAtUtc: input.issuedAtUtc,
      businessDate: input.businessDate,
      payload: {
        invoicePublicId: input.invoicePublicId,
        status: 'posted',
        subtotalMinor: result.subtotalMinor,
        adjustmentTotalMinor: result.adjustmentTotalMinor,
        totalMinor: result.totalMinor,
      },
    },
  });
}
