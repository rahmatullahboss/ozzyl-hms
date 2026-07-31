import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { toUtcIso } from '../time';

export interface CreditNoteLineInput {
  creditLinePublicId: string;
  invoiceLinePublicId?: string | null;
  amountMinor: number;
  reasonCode: string;
  sourceEvidenceSha256: string;
}

export interface IssueCreditNoteInput {
  tenantId: string;
  creditNotePublicId: string;
  creditNoteNumber: string;
  invoicePublicId: string;
  reasonCode: string;
  issuedAtUtc: string;
  businessDate: string;
  lines: readonly CreditNoteLineInput[];
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface IssueCreditNoteResult {
  creditNotePublicId: string;
  totalMinor: number;
  creditedMinor: number;
  netDueMinor: number;
}

interface InvoiceRow {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

interface NameRow {
  name: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function mappingStatement(db: CanonicalBatchDatabase, input: IssueCreditNoteInput): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'credit_note',?,?,?,?, 'mapped',1,?)
  `).bind(
    input.tenantId,
    input.creditNotePublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

async function tableExists(
  db: CanonicalBatchDatabase,
  tableName: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type='table' AND name=?
    LIMIT 1
  `).bind(tableName).first<NameRow>();
  return row !== null;
}

async function assertCompensationSafe(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<void> {
  const canonicalBlocked = await db.prepare(`
    SELECT 1 present
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND invoice_public_id=? AND settled_minor>0
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (canonicalBlocked) {
    throw new Error('Paid performer reserve or compensation settlement blocks credit adjustment');
  }

  const [hasPerformerReserves, hasDoctorAccruals] = await Promise.all([
    tableExists(db, 'diagnostic_performer_reserves'),
    tableExists(db, 'doctor_commission_accruals'),
  ]);
  if (!hasPerformerReserves && !hasDoctorAccruals) return;

  const invalidMapping = await db.prepare(`
    SELECT 1 present
    FROM canonical_source_mappings
    WHERE tenant_id=?
      AND entity_type='invoice'
      AND canonical_public_id=?
      AND mapping_status='mapped'
      AND source_table='bills'
      AND (
        source_public_id=''
        OR source_public_id GLOB '*[^0-9]*'
        OR CAST(source_public_id AS INTEGER)<=0
      )
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (invalidMapping) {
    throw new Error('Canonical invoice has an invalid legacy bill mapping for compensation safety');
  }

  const legacyPredicates: string[] = [];
  if (hasPerformerReserves) {
    legacyPredicates.push(`EXISTS (
      SELECT 1
      FROM diagnostic_performer_reserves r
      WHERE r.tenant_id=m.tenant_id
        AND r.bill_id=CAST(m.source_public_id AS INTEGER)
        AND r.status='paid'
    )`);
  }
  if (hasDoctorAccruals) {
    legacyPredicates.push(`EXISTS (
      SELECT 1
      FROM doctor_commission_accruals a
      WHERE a.tenant_id=m.tenant_id
        AND a.bill_id=CAST(m.source_public_id AS INTEGER)
        AND a.status='paid'
    )`);
  }

  const legacyBlocked = await db.prepare(`
    SELECT 1 present
    FROM canonical_source_mappings m
    WHERE m.tenant_id=?
      AND m.entity_type='invoice'
      AND m.canonical_public_id=?
      AND m.mapping_status='mapped'
      AND m.source_table='bills'
      AND (${legacyPredicates.join(' OR ')})
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (legacyBlocked) {
    throw new Error('Paid performer reserve or compensation settlement blocks credit adjustment');
  }
}

export async function issueCreditNote(
  db: CanonicalBatchDatabase,
  input: IssueCreditNoteInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<IssueCreditNoteResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.creditNotePublicId, 'creditNotePublicId');
  exact(input.creditNoteNumber, 'creditNoteNumber');
  exact(input.invoicePublicId, 'invoicePublicId');
  exact(input.reasonCode, 'reasonCode');
  utc(input.issuedAtUtc, 'issuedAtUtc');
  exact(input.businessDate, 'businessDate');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  if (input.lines.length === 0) throw new RangeError('Credit note must contain at least one line');

  const lineIds = new Set<string>();
  let total = 0n;
  for (const line of input.lines) {
    exact(line.creditLinePublicId, 'line.creditLinePublicId');
    if (lineIds.has(line.creditLinePublicId)) throw new RangeError('duplicate creditLinePublicId');
    lineIds.add(line.creditLinePublicId);
    optionalExact(line.invoiceLinePublicId, 'line.invoiceLinePublicId');
    positive(line.amountMinor, 'line.amountMinor');
    exact(line.reasonCode, 'line.reasonCode');
    digest(line.sourceEvidenceSha256, 'line.sourceEvidenceSha256');
    total += BigInt(line.amountMinor);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('credit note total exceeds safe integer range');
  }
  const totalMinor = Number(total);

  const request = {
    creditNotePublicId: input.creditNotePublicId,
    creditNoteNumber: input.creditNoteNumber,
    invoicePublicId: input.invoicePublicId,
    reasonCode: input.reasonCode,
    issuedAtUtc: input.issuedAtUtc,
    businessDate: input.businessDate,
    lines: input.lines,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<IssueCreditNoteResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.credit_note.issue',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const invoice = await db.prepare(`
    SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.invoicePublicId).first<InvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (invoice.net_due_minor < totalMinor) throw new RangeError('Credit note exceeds invoice net outstanding balance');
  await assertCompensationSafe(db, input.tenantId, input.invoicePublicId);

  for (const line of input.lines) {
    if (line.invoiceLinePublicId == null) continue;
    const found = await db.prepare(`
      SELECT 1 present FROM canonical_invoice_lines
      WHERE tenant_id=? AND invoice_public_id=? AND line_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.invoicePublicId, line.invoiceLinePublicId).first<{ present: number }>();
    if (!found) throw new Error('Canonical invoice line not found');
  }

  const creditedAfter = invoice.credited_minor + totalMinor;
  const netDueAfter = invoice.net_due_minor - totalMinor;
  const result: IssueCreditNoteResult = {
    creditNotePublicId: input.creditNotePublicId,
    totalMinor,
    creditedMinor: creditedAfter,
    netDueMinor: netDueAfter,
  };

  const lineStatements = input.lines.map((line) => db.prepare(`
    INSERT INTO canonical_credit_note_lines (
      tenant_id,credit_line_public_id,credit_note_public_id,invoice_public_id,
      invoice_line_public_id,amount_minor,reason_code,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    line.creditLinePublicId,
    input.creditNotePublicId,
    input.invoicePublicId,
    line.invoiceLinePublicId ?? null,
    line.amountMinor,
    line.reasonCode,
    line.sourceEvidenceSha256,
  ));

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.credit_note.issue',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements: [
      db.prepare(`
        INSERT INTO canonical_credit_notes (
          tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
          legacy_patient_id,currency_code,reason_code,total_minor,
          invoice_credited_before_minor,invoice_credited_after_minor,
          invoice_net_due_before_minor,invoice_net_due_after_minor,status,
          issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
          source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?,1,?)
      `).bind(
        input.tenantId,
        input.creditNotePublicId,
        input.creditNoteNumber,
        input.invoicePublicId,
        invoice.legacy_patient_id,
        invoice.currency_code,
        input.reasonCode,
        totalMinor,
        invoice.credited_minor,
        creditedAfter,
        invoice.net_due_minor,
        netDueAfter,
        input.issuedAtUtc,
        input.businessDate,
        input.issuedAtUtc,
        input.sourceEvidenceSha256,
      ),
      ...lineStatements,
      db.prepare(`
        UPDATE canonical_invoices
        SET credited_minor=?,net_due_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      `).bind(
        creditedAfter,
        netDueAfter,
        input.issuedAtUtc,
        input.tenantId,
        input.invoicePublicId,
        invoice.paid_minor,
        invoice.due_minor,
        invoice.credited_minor,
        invoice.net_due_minor,
      ),
      db.prepare(`
        UPDATE canonical_credit_notes
        SET reconciliation_guard=CASE WHEN
          total_minor=COALESCE((
            SELECT SUM(amount_minor) FROM canonical_credit_note_lines
            WHERE tenant_id=? AND credit_note_public_id=?
          ),0)
          AND EXISTS (
            SELECT 1 FROM canonical_invoices
            WHERE tenant_id=? AND invoice_public_id=?
              AND credited_minor=? AND net_due_minor=?
          )
        THEN 1 ELSE 0 END
        WHERE tenant_id=? AND credit_note_public_id=?
      `).bind(
        input.tenantId,
        input.creditNotePublicId,
        input.tenantId,
        input.invoicePublicId,
        creditedAfter,
        netDueAfter,
        input.tenantId,
        input.creditNotePublicId,
      ),
    ],
    reconciliationStatements: [mappingStatement(db, input)],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_credit_note',
      aggregatePublicId: input.creditNotePublicId,
      eventType: 'canonical.credit_note.posted',
      occurredAtUtc: input.issuedAtUtc,
      businessDate: input.businessDate,
      payload: {
        creditNotePublicId: input.creditNotePublicId,
        invoicePublicId: input.invoicePublicId,
        totalMinor,
      },
    },
  });
}
