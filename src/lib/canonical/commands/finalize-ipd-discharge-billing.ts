import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { allocateOldestAvailableDeposits } from '../deposit-source-allocation';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../financial-batch-assertion';
import { stableCanonicalJson } from '../idempotency';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';
import {
  prepareInvoiceSettlementBatch,
  type IssueInvoiceWithSettlementInput,
  type IssueInvoiceWithSettlementResult,
} from './issue-invoice-settlement';

export interface IpdDischargeDepositRefundInput {
  operationPublicId: string;
  amountMinor: number;
  refundReceiptNumber: string;
  tenderType: 'cash';
  methodCode: 'cash';
  sourceType: 'legacy_live_deposit_refund';
  sourcePublicId: string;
  sourceTable: 'billing_deposits';
  sourceEvidenceSha256: string;
  outboxEventPublicId: string;
}

export interface FinalizeIpdDischargeBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoiceSettlement: IssueInvoiceWithSettlementInput;
  encounter: {
    legacyAdmissionId: number;
    legacyPatientId: number;
    completedAtUtc: string;
    sourceType: 'legacy_admission_discharge';
    sourcePublicId: string;
    sourceTable: 'admissions';
    sourceEvidenceSha256: string;
    eventPublicId: string;
  };
  depositRefund?: IpdDischargeDepositRefundInput | null;
}

export interface IpdDischargeRefundAllocationResult {
  refundPublicId: string;
  depositPublicId: string;
  amountMinor: number;
  availableMinor: number;
}

export interface FinalizeIpdDischargeBillingResult extends IssueInvoiceWithSettlementResult {
  encounterPublicId: string;
  legacyAdmissionId: number;
  refundedMinor: number;
  refundAllocations: IpdDischargeRefundAllocationResult[];
}

interface EncounterRow {
  encounter_public_id: string;
  legacy_patient_id: number;
  status: string;
  ended_at_utc: string | null;
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

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
  );
}

async function loadAvailableDeposits(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyPatientId: number,
  currencyCode: string,
): Promise<DepositRow[]> {
  const rows: DepositRow[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT deposit_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,received_at_utc
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND currency_code=?
        AND status='posted' AND available_minor>0
      ORDER BY received_at_utc ASC,deposit_public_id ASC
      LIMIT 1 OFFSET ?
    `).bind(tenantId, legacyPatientId, currencyCode, offset).first<DepositRow>();
    if (!row) break;
    rows.push(row);
  }
  return rows;
}

function validate(input: FinalizeIpdDischargeBillingInput): void {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  if (input.invoiceSettlement.tenantId !== input.tenantId) {
    throw new Error('invoice settlement tenant must match command tenant');
  }
  positive(input.encounter.legacyAdmissionId, 'encounter.legacyAdmissionId');
  positive(input.encounter.legacyPatientId, 'encounter.legacyPatientId');
  utc(input.encounter.completedAtUtc, 'encounter.completedAtUtc');
  exact(input.encounter.sourcePublicId, 'encounter.sourcePublicId');
  hash(input.encounter.sourceEvidenceSha256, 'encounter.sourceEvidenceSha256');
  exact(input.encounter.eventPublicId, 'encounter.eventPublicId');
  const refund = input.depositRefund ?? null;
  if (refund) {
    exact(refund.operationPublicId, 'depositRefund.operationPublicId');
    positive(refund.amountMinor, 'depositRefund.amountMinor');
    exact(refund.refundReceiptNumber, 'depositRefund.refundReceiptNumber');
    exact(refund.sourcePublicId, 'depositRefund.sourcePublicId');
    hash(refund.sourceEvidenceSha256, 'depositRefund.sourceEvidenceSha256');
    exact(refund.outboxEventPublicId, 'depositRefund.outboxEventPublicId');
    if (refund.tenderType !== 'cash' || refund.methodCode !== 'cash') {
      throw new RangeError('IPD excess deposit refund must use cash authority');
    }
  }
}

export async function finalizeIpdDischargeBilling(
  db: CanonicalBatchDatabase,
  input: FinalizeIpdDischargeBillingInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<FinalizeIpdDischargeBillingResult>> {
  validate(input);
  const refund = input.depositRefund ?? null;
  const request = {
    invoiceSettlement: input.invoiceSettlement,
    encounter: input.encounter,
    depositRefund: refund,
  };
  const replay = await readCanonicalCommandReplay<FinalizeIpdDischargeBillingResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.ipd.discharge_billing.finalize',
    idempotencyKey: input.commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const encounter = await db.prepare(`
    SELECT e.encounter_public_id,e.legacy_patient_id,e.status,e.ended_at_utc
    FROM canonical_encounter_admission_links l
    JOIN canonical_encounters e
      ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
    WHERE l.tenant_id=? AND l.legacy_admission_id=? AND l.link_status='active'
      AND e.encounter_type IN ('inpatient','emergency')
    LIMIT 1
  `).bind(input.tenantId, input.encounter.legacyAdmissionId).first<EncounterRow>();
  if (!encounter) throw new Error('Canonical inpatient encounter authority not found');
  if (encounter.legacy_patient_id !== input.encounter.legacyPatientId) {
    throw new Error('Canonical inpatient encounter patient mismatch');
  }
  if (encounter.status !== 'in_progress' || encounter.ended_at_utc != null) {
    throw new Error('Canonical inpatient encounter is already completed');
  }

  const preparedSettlement = await prepareInvoiceSettlementBatch(db, input.invoiceSettlement);
  const statements: CanonicalPreparedStatement[] = [...preparedSettlement.statements];
  const reconciliationStatements: CanonicalPreparedStatement[] = [];
  const operationKey = `ipd-discharge:${input.commandIdempotencyKey}`;

  statements.push(db.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
    ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
  `).bind(
    input.tenantId,
    input.invoiceSettlement.invoice.outboxEventPublicId,
    'canonical_invoice',
    input.invoiceSettlement.invoice.invoicePublicId,
    'canonical.invoice.issued',
    stableCanonicalJson({
      invoicePublicId: input.invoiceSettlement.invoice.invoicePublicId,
      status: 'posted',
      totalMinor: preparedSettlement.result.totalMinor,
    }),
    input.invoiceSettlement.invoice.issuedAtUtc,
    input.invoiceSettlement.invoice.businessDate,
    `${input.commandIdempotencyKey}:invoice`,
  ));

  const refundAllocations: IpdDischargeRefundAllocationResult[] = [];
  if (refund) {
    const sources = await loadAvailableDeposits(
      db,
      input.tenantId,
      input.invoiceSettlement.invoice.legacyPatientId,
      input.invoiceSettlement.invoice.currencyCode,
    );
    const applicationByDeposit = new Map<string, number>();
    for (const application of preparedSettlement.result.depositApplications) {
      applicationByDeposit.set(
        application.depositPublicId,
        (applicationByDeposit.get(application.depositPublicId) ?? 0) + application.amountMinor,
      );
    }
    const postApplicationSources = sources.map((source) => {
      const appliedNow = applicationByDeposit.get(source.deposit_public_id) ?? 0;
      const availableMinor = source.available_minor - appliedNow;
      if (availableMinor < 0) throw new Error('Canonical deposit application snapshot is inconsistent');
      return {
        ...source,
        applied_minor: source.applied_minor + appliedNow,
        available_minor: availableMinor,
      };
    });
    const refundPlan = allocateOldestAvailableDeposits(
      postApplicationSources.map((source) => ({
        depositPublicId: source.deposit_public_id,
        availableMinor: source.available_minor,
        receivedAtUtc: source.received_at_utc,
        status: source.status,
      })),
      refund.amountMinor,
    );
    const sourceById = new Map(postApplicationSources.map((source) => [source.deposit_public_id, source]));

    for (let index = 0; index < refundPlan.length; index += 1) {
      const allocation = refundPlan[index];
      const source = sourceById.get(allocation.depositPublicId);
      if (!source) throw new Error('Canonical refund deposit source not found');
      const refundPublicId = await createDeterministicSourceId(
        'depref',
        input.tenantId,
        'canonical_ipd_discharge_deposit_refund',
        `${refund.operationPublicId}:${allocation.depositPublicId}:${index + 1}`,
      );
      const availableAfter = source.available_minor - allocation.amountMinor;
      const refundedAfter = source.refunded_minor + allocation.amountMinor;
      const evidence = await createSourceEvidenceSha256({
        sourceType: refund.sourceType,
        sourcePublicId: `${refund.sourcePublicId}:${index + 1}`,
        sourceTable: refund.sourceTable,
        operationPublicId: refund.operationPublicId,
        refundReceiptNumber: refund.refundReceiptNumber,
        refundPublicId,
        depositPublicId: source.deposit_public_id,
        amountMinor: allocation.amountMinor,
        availableBeforeMinor: source.available_minor,
        availableAfterMinor: availableAfter,
        completedAtUtc: input.encounter.completedAtUtc,
      });
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
          source.deposit_public_id,
          allocation.amountMinor,
          refund.tenderType,
          refund.methodCode,
          input.encounter.completedAtUtc,
          input.invoiceSettlement.invoice.businessDate,
          source.available_minor,
          availableAfter,
          evidence,
        ),
        db.prepare(`
          UPDATE canonical_deposits
          SET refunded_minor=?,available_minor=?,updated_at_utc=?
          WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
            AND applied_minor=? AND refunded_minor=? AND available_minor=?
        `).bind(
          refundedAfter,
          availableAfter,
          input.encounter.completedAtUtc,
          input.tenantId,
          source.deposit_public_id,
          source.applied_minor,
          source.refunded_minor,
          source.available_minor,
        ),
        prepareFinancialBatchAssertion(db, {
          tenantId: input.tenantId,
          operationKey,
          stepKey: `deposit-refund-${index + 1}`,
          expectedChanges: 1,
        }),
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
          source.deposit_public_id,
          source.applied_minor,
          refundedAfter,
          availableAfter,
          input.tenantId,
          refundPublicId,
        ),
        db.prepare(`
          INSERT INTO canonical_outbox_events (
            tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
            event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
          ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
        `).bind(
          input.tenantId,
          index === 0 ? refund.outboxEventPublicId : await createDeterministicSourceId(
            'outevt',
            input.tenantId,
            'canonical_ipd_discharge_deposit_refund_event',
            `${refund.operationPublicId}:${index + 1}`,
          ),
          'canonical_refund',
          refundPublicId,
          'canonical.deposit.refunded',
          stableCanonicalJson({ amountMinor: allocation.amountMinor, refundPublicId }),
          input.encounter.completedAtUtc,
          input.invoiceSettlement.invoice.businessDate,
          `${input.commandIdempotencyKey}:refund:${index + 1}`,
        ),
        db.prepare(`
          INSERT INTO canonical_outbox_events (
            tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
            event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
          ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
        `).bind(
          input.tenantId,
          await createDeterministicSourceId(
            'custody',
            input.tenantId,
            'canonical_ipd_discharge_refund_custody',
            `${refund.operationPublicId}:${index + 1}`,
          ),
          'canonical_cash_custody',
          refundPublicId,
          'canonical.cash_custody.refund_recorded',
          stableCanonicalJson({ amountMinor: allocation.amountMinor, refundPublicId }),
          input.encounter.completedAtUtc,
          input.invoiceSettlement.invoice.businessDate,
          `${input.commandIdempotencyKey}:refund-cash-custody:${index + 1}`,
        ),
      );
      reconciliationStatements.push(mappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'refund',
        canonicalPublicId: refundPublicId,
        sourceType: refund.sourceType,
        sourcePublicId: `${refund.sourcePublicId}:${index + 1}`,
        sourceTable: refund.sourceTable,
        evidenceSha256: evidence,
      }));
      refundAllocations.push({
        refundPublicId,
        depositPublicId: source.deposit_public_id,
        amountMinor: allocation.amountMinor,
        availableMinor: availableAfter,
      });
    }
  }

  statements.push(
    db.prepare(`
      INSERT INTO canonical_invoice_encounter_links (
        tenant_id,invoice_public_id,encounter_public_id,legacy_admission_id,
        link_type,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,'discharge_invoice',?,?,?)
    `).bind(
      input.tenantId,
      input.invoiceSettlement.invoice.invoicePublicId,
      encounter.encounter_public_id,
      input.encounter.legacyAdmissionId,
      input.encounter.sourceEvidenceSha256,
      input.encounter.completedAtUtc,
      input.encounter.completedAtUtc,
    ),
    db.prepare(`
      UPDATE canonical_encounters
      SET status='completed',ended_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND encounter_public_id=? AND encounter_type IN ('inpatient','emergency')
        AND legacy_patient_id=? AND status='in_progress' AND ended_at_utc IS NULL
    `).bind(
      input.encounter.completedAtUtc,
      input.encounter.sourceEvidenceSha256,
      input.encounter.completedAtUtc,
      input.tenantId,
      encounter.encounter_public_id,
      input.encounter.legacyPatientId,
    ),
    prepareFinancialBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'encounter-completed',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE canonical_bed_stays
      SET status='completed',ended_at_utc=?,source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND encounter_public_id=? AND status='active' AND ended_at_utc IS NULL
    `).bind(
      input.encounter.completedAtUtc,
      input.encounter.sourceEvidenceSha256,
      input.encounter.completedAtUtc,
      input.tenantId,
      encounter.encounter_public_id,
    ),
    db.prepare(`
      INSERT INTO canonical_financial_batch_assertions (
        tenant_id,operation_key,step_key,assertion_value
      ) VALUES (?,?,?,CASE WHEN NOT EXISTS (
        SELECT 1 FROM canonical_bed_stays
        WHERE tenant_id=? AND encounter_public_id=? AND status='active'
      ) THEN 1 ELSE 0 END)
    `).bind(
      input.tenantId,
      operationKey,
      'bed-stays-completed',
      input.tenantId,
      encounter.encounter_public_id,
    ),
  );
  reconciliationStatements.push(
    prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey),
  );

  const result: FinalizeIpdDischargeBillingResult = {
    ...preparedSettlement.result,
    encounterPublicId: encounter.encounter_public_id,
    legacyAdmissionId: input.encounter.legacyAdmissionId,
    refundedMinor: refund?.amountMinor ?? 0,
    refundAllocations,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.ipd.discharge_billing.finalize',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: input.encounter.eventPublicId,
      aggregateType: 'canonical_encounter',
      aggregatePublicId: encounter.encounter_public_id,
      eventType: 'canonical.encounter.completed',
      occurredAtUtc: input.encounter.completedAtUtc,
      businessDate: input.invoiceSettlement.invoice.businessDate,
      payload: {
        encounterPublicId: encounter.encounter_public_id,
        invoicePublicId: input.invoiceSettlement.invoice.invoicePublicId,
        legacyAdmissionId: input.encounter.legacyAdmissionId,
        refundedMinor: refund?.amountMinor ?? 0,
      },
    },
  });
}
