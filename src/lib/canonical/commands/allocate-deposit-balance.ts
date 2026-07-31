import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { allocateOldestAvailableDeposits } from '../deposit-source-allocation';
import { stableCanonicalJson } from '../idempotency';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';
import type { AdjustmentTenderType } from './apply-deposit';

interface DepositSourceIdentity {
  tenantId: string;
  legacyPatientId: number;
  amountMinor: number;
  occurredAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
  operationPublicId: string;
}

export interface ApplyAvailableDepositsInput extends DepositSourceIdentity {
  invoicePublicId: string;
  invoiceLinePublicId?: string | null;
}

export interface RefundAvailableDepositsInput extends DepositSourceIdentity {
  tenderType: AdjustmentTenderType;
  methodCode: string;
}

export interface AppliedDepositAllocationResult {
  applicationPublicId: string;
  depositPublicId: string;
  amountMinor: number;
  availableMinor: number;
}

export interface RefundedDepositAllocationResult {
  refundPublicId: string;
  depositPublicId: string;
  amountMinor: number;
  availableMinor: number;
}

export interface ApplyAvailableDepositsResult {
  operationPublicId: string;
  appliedMinor: number;
  invoiceNetDueMinor: number;
  allocations: AppliedDepositAllocationResult[];
}

export interface RefundAvailableDepositsResult {
  operationPublicId: string;
  refundedMinor: number;
  allocations: RefundedDepositAllocationResult[];
}

interface DepositRow {
  deposit_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  status: string;
  received_at_utc: string;
}

interface InvoiceRow {
  legacy_patient_id: number;
  currency_code: string;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  return value;
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

function businessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  return value;
}

function validateBase(input: DepositSourceIdentity): void {
  exact(input.tenantId, 'tenantId');
  positive(input.legacyPatientId, 'legacyPatientId');
  positive(input.amountMinor, 'amountMinor');
  utc(input.occurredAtUtc, 'occurredAtUtc');
  businessDate(input.businessDate);
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  exact(input.operationPublicId, 'operationPublicId');
}

async function loadAvailableDeposits(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<DepositRow[]> {
  const rows: DepositRow[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT deposit_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,received_at_utc
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND status='posted' AND available_minor>0
      ORDER BY received_at_utc ASC,deposit_public_id ASC
      LIMIT 1 OFFSET ?
    `).bind(tenantId, legacyPatientId, offset).first<DepositRow>();
    if (!row) break;
    rows.push(row);
  }
  return rows;
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: DepositSourceIdentity,
  entityType: string,
  canonicalPublicId: string,
  index: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    entityType,
    canonicalPublicId,
    input.sourceType,
    `${input.sourcePublicId}:${index + 1}`,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

function assertSourceRows(input: DepositSourceIdentity, rows: DepositRow[]): void {
  for (const row of rows) {
    if (row.legacy_patient_id !== input.legacyPatientId) throw new Error('Canonical deposit patient mismatch');
    if (row.currency_code !== 'BDT') throw new Error('Canonical deposit currency must be BDT');
    if (row.status !== 'posted') throw new Error('Canonical deposit is not posted');
  }
}

export async function applyAvailableDeposits(
  db: CanonicalBatchDatabase,
  input: ApplyAvailableDepositsInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ApplyAvailableDepositsResult>> {
  validateBase(input);
  exact(input.invoicePublicId, 'invoicePublicId');
  if (input.invoiceLinePublicId != null) exact(input.invoiceLinePublicId, 'invoiceLinePublicId');

  const request = {
    operationPublicId: input.operationPublicId,
    legacyPatientId: input.legacyPatientId,
    amountMinor: input.amountMinor,
    invoicePublicId: input.invoicePublicId,
    invoiceLinePublicId: input.invoiceLinePublicId ?? null,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<ApplyAvailableDepositsResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.apply-available',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const sources = await loadAvailableDeposits(db, input.tenantId, input.legacyPatientId);
  assertSourceRows(input, sources);
  const allocationPlan = allocateOldestAvailableDeposits(sources.map((row) => ({
    depositPublicId: row.deposit_public_id,
    availableMinor: row.available_minor,
    receivedAtUtc: row.received_at_utc,
    status: row.status,
  })), input.amountMinor);

  const invoice = await db.prepare(`
    SELECT legacy_patient_id,currency_code,paid_minor,due_minor,credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.invoicePublicId).first<InvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (invoice.legacy_patient_id !== input.legacyPatientId) throw new Error('Deposit and invoice patient mismatch');
  if (invoice.currency_code !== 'BDT') throw new Error('Deposit and invoice currency mismatch');
  if (invoice.due_minor < input.amountMinor || invoice.net_due_minor < input.amountMinor) {
    throw new RangeError('Deposit application exceeds invoice outstanding balance');
  }
  if (input.invoiceLinePublicId != null) {
    const line = await db.prepare(`
      SELECT 1 present FROM canonical_invoice_lines
      WHERE tenant_id=? AND invoice_public_id=? AND line_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.invoicePublicId, input.invoiceLinePublicId).first<{ present: number }>();
    if (!line) throw new Error('Canonical invoice line not found');
  }

  const sourceById = new Map(sources.map((row) => [row.deposit_public_id, row]));
  const statements: CanonicalPreparedStatement[] = [];
  const mappings: CanonicalPreparedStatement[] = [];
  const resultAllocations: AppliedDepositAllocationResult[] = [];
  let runningPaid = invoice.paid_minor;
  let runningDue = invoice.due_minor;
  let runningNetDue = invoice.net_due_minor;

  for (let index = 0; index < allocationPlan.length; index += 1) {
    const allocation = allocationPlan[index];
    const source = sourceById.get(allocation.depositPublicId)!;
    const applicationPublicId = await createDeterministicSourceId(
      'depapp',
      input.tenantId,
      'canonical_deposit_application',
      `${input.operationPublicId}:${allocation.depositPublicId}:${index + 1}`,
    );
    const availableAfter = source.available_minor - allocation.amountMinor;
    const appliedAfter = source.applied_minor + allocation.amountMinor;
    const paidBefore = runningPaid;
    const dueBefore = runningDue;
    const netDueBefore = runningNetDue;
    runningPaid += allocation.amountMinor;
    runningDue -= allocation.amountMinor;
    runningNetDue -= allocation.amountMinor;

    statements.push(
      db.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,deposit_available_before_minor,
          deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
          invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
          invoice_net_due_after_minor,status,applied_at_utc,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,1,?)
      `).bind(
        input.tenantId,
        applicationPublicId,
        allocation.depositPublicId,
        input.invoicePublicId,
        input.invoiceLinePublicId ?? null,
        allocation.amountMinor,
        source.available_minor,
        availableAfter,
        paidBefore,
        runningPaid,
        dueBefore,
        runningDue,
        netDueBefore,
        runningNetDue,
        input.occurredAtUtc,
        input.sourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET applied_minor=?,available_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
          AND applied_minor=? AND refunded_minor=? AND available_minor=?
      `).bind(
        appliedAfter,
        availableAfter,
        input.occurredAtUtc,
        input.tenantId,
        allocation.depositPublicId,
        source.applied_minor,
        source.refunded_minor,
        source.available_minor,
      ),
    );
    mappings.push(mappingStatement(db, input, 'deposit_application', applicationPublicId, index));
    resultAllocations.push({
      applicationPublicId,
      depositPublicId: allocation.depositPublicId,
      amountMinor: allocation.amountMinor,
      availableMinor: availableAfter,
    });
  }

  statements.push(db.prepare(`
    UPDATE canonical_invoices
    SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
    WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
      AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
  `).bind(
    runningPaid,
    runningDue,
    runningNetDue,
    input.occurredAtUtc,
    input.tenantId,
    input.invoicePublicId,
    invoice.paid_minor,
    invoice.due_minor,
    invoice.credited_minor,
    invoice.net_due_minor,
  ));

  for (let index = 0; index < resultAllocations.length; index += 1) {
    const resultAllocation = resultAllocations[index];
    const source = sourceById.get(resultAllocation.depositPublicId)!;
    const appliedAfter = source.applied_minor + resultAllocation.amountMinor;
    const isLast = index === resultAllocations.length - 1;
    statements.push(db.prepare(`
      UPDATE canonical_deposit_applications
      SET balance_guard=CASE WHEN
        EXISTS (
          SELECT 1 FROM canonical_deposits
          WHERE tenant_id=? AND deposit_public_id=?
            AND applied_minor=? AND refunded_minor=? AND available_minor=?
        ) ${isLast ? `AND EXISTS (
          SELECT 1 FROM canonical_invoices
          WHERE tenant_id=? AND invoice_public_id=?
            AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
        )` : ''} THEN 1 ELSE 0 END
      WHERE tenant_id=? AND application_public_id=?
    `).bind(
      input.tenantId,
      resultAllocation.depositPublicId,
      appliedAfter,
      source.refunded_minor,
      resultAllocation.availableMinor,
      ...(isLast ? [
        input.tenantId,
        input.invoicePublicId,
        runningPaid,
        runningDue,
        invoice.credited_minor,
        runningNetDue,
      ] : []),
      input.tenantId,
      resultAllocation.applicationPublicId,
    ));
  }

  const result: ApplyAvailableDepositsResult = {
    operationPublicId: input.operationPublicId,
    appliedMinor: input.amountMinor,
    invoiceNetDueMinor: runningNetDue,
    allocations: resultAllocations,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.apply-available',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: mappings,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_deposit_operation',
      aggregatePublicId: input.operationPublicId,
      eventType: 'canonical.deposit.available_applied',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        amountMinor: input.amountMinor,
        invoicePublicId: input.invoicePublicId,
        operationPublicId: input.operationPublicId,
        allocations: resultAllocations,
      },
    },
  });
}

export async function refundAvailableDeposits(
  db: CanonicalBatchDatabase,
  input: RefundAvailableDepositsInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<RefundAvailableDepositsResult>> {
  validateBase(input);
  exact(input.methodCode, 'methodCode');
  if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(input.tenderType)) {
    throw new RangeError(`Unsupported tenderType: ${input.tenderType}`);
  }

  const request = {
    operationPublicId: input.operationPublicId,
    legacyPatientId: input.legacyPatientId,
    amountMinor: input.amountMinor,
    tenderType: input.tenderType,
    methodCode: input.methodCode,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<RefundAvailableDepositsResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.refund-available',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const sources = await loadAvailableDeposits(db, input.tenantId, input.legacyPatientId);
  assertSourceRows(input, sources);
  const allocationPlan = allocateOldestAvailableDeposits(sources.map((row) => ({
    depositPublicId: row.deposit_public_id,
    availableMinor: row.available_minor,
    receivedAtUtc: row.received_at_utc,
    status: row.status,
  })), input.amountMinor);
  const sourceById = new Map(sources.map((row) => [row.deposit_public_id, row]));
  const statements: CanonicalPreparedStatement[] = [];
  const mappings: CanonicalPreparedStatement[] = [];
  const resultAllocations: RefundedDepositAllocationResult[] = [];

  for (let index = 0; index < allocationPlan.length; index += 1) {
    const allocation = allocationPlan[index];
    const source = sourceById.get(allocation.depositPublicId)!;
    const refundPublicId = await createDeterministicSourceId(
      'depref',
      input.tenantId,
      'canonical_deposit_refund',
      `${input.operationPublicId}:${allocation.depositPublicId}:${index + 1}`,
    );
    const availableAfter = source.available_minor - allocation.amountMinor;
    const refundedAfter = source.refunded_minor + allocation.amountMinor;

    statements.push(
      db.prepare(`
        INSERT INTO canonical_refunds (
          tenant_id,refund_public_id,source_type,deposit_public_id,amount_minor,
          tender_type,method_code,status,refunded_at_utc,business_date,
          source_available_before_minor,source_available_after_minor,liability_guard,
          source_evidence_sha256
        ) VALUES (?,?,'deposit',?,?,?,?,'posted',?,?,?,?,1,?)
      `).bind(
        input.tenantId,
        refundPublicId,
        allocation.depositPublicId,
        allocation.amountMinor,
        input.tenderType,
        input.methodCode,
        input.occurredAtUtc,
        input.businessDate,
        source.available_minor,
        availableAfter,
        input.sourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET refunded_minor=?,available_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
          AND applied_minor=? AND refunded_minor=? AND available_minor=?
      `).bind(
        refundedAfter,
        availableAfter,
        input.occurredAtUtc,
        input.tenantId,
        allocation.depositPublicId,
        source.applied_minor,
        source.refunded_minor,
        source.available_minor,
      ),
      db.prepare(`
        UPDATE canonical_refunds
        SET liability_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_deposits
          WHERE tenant_id=? AND deposit_public_id=?
            AND applied_minor=? AND refunded_minor=? AND available_minor=?
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND refund_public_id=?
      `).bind(
        input.tenantId,
        allocation.depositPublicId,
        source.applied_minor,
        refundedAfter,
        availableAfter,
        input.tenantId,
        refundPublicId,
      ),
    );

    if (input.tenderType === 'cash') {
      const custodyEventPublicId = await createDeterministicSourceId(
        'custody',
        input.tenantId,
        'canonical_deposit_refund_custody',
        `${input.operationPublicId}:${allocation.depositPublicId}:${index + 1}`,
      );
      statements.push(db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        custodyEventPublicId,
        'canonical_cash_custody',
        refundPublicId,
        'canonical.cash_custody.refund_recorded',
        stableCanonicalJson({ amountMinor: allocation.amountMinor, refundPublicId }),
        input.occurredAtUtc,
        input.businessDate,
        `${input.idempotencyKey}:cash-custody:${index + 1}`,
      ));
    }

    mappings.push(mappingStatement(db, input, 'refund', refundPublicId, index));
    resultAllocations.push({
      refundPublicId,
      depositPublicId: allocation.depositPublicId,
      amountMinor: allocation.amountMinor,
      availableMinor: availableAfter,
    });
  }

  const result: RefundAvailableDepositsResult = {
    operationPublicId: input.operationPublicId,
    refundedMinor: input.amountMinor,
    allocations: resultAllocations,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.deposit.refund-available',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: mappings,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_deposit_operation',
      aggregatePublicId: input.operationPublicId,
      eventType: 'canonical.deposit.available_refunded',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        amountMinor: input.amountMinor,
        operationPublicId: input.operationPublicId,
        tenderType: input.tenderType,
        allocations: resultAllocations,
      },
    },
  });
}
