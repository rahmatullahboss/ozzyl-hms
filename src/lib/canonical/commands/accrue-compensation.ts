import {
  prepareCanonicalBatch,
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
  type PreparedCanonicalBatch,
} from '../command-batch';
import { toUtcIso } from '../time';

export type CompensationRole = 'performing' | 'referring' | 'prescribing' | 'treating' | 'reporting';
export type CompensationAdjustmentType = 'credit' | 'refund' | 'service_cancellation' | 'manual_recovery';

export interface AccrueCompensationInput {
  tenantId: string;
  accrualPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId: string;
  serviceEventPublicId?: string | null;
  practitionerPublicId?: string | null;
  practitionerRole: CompensationRole;
  rulePublicId: string;
  ruleVersion: number;
  discountAllocatedMinor: number;
  taxAllocatedMinor: number;
  performerReserveMinor: number;
  accruedAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface AccrueCompensationResult {
  accrualPublicId: string;
  grossMinor: number;
  eligibleBaseMinor: number;
  earnedMinor: number;
  payableMinor: number;
  status: 'unassigned' | 'accrued';
}

export interface CompensationSettlementAllocationInput {
  allocationPublicId: string;
  accrualPublicId: string;
  amountMinor: number;
  sourceEvidenceSha256: string;
}

export interface SettleCompensationInput {
  tenantId: string;
  settlementPublicId: string;
  settlementNumber: string;
  practitionerPublicId: string;
  currencyCode: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'mobile_wallet' | 'card' | 'other';
  settledAtUtc: string;
  businessDate: string;
  allocations: readonly CompensationSettlementAllocationInput[];
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface SettleCompensationResult {
  settlementPublicId: string;
  totalMinor: number;
  allocationCount: number;
}

export interface AdjustCompensationInput {
  tenantId: string;
  adjustmentPublicId: string;
  accrualPublicId: string;
  adjustmentType: CompensationAdjustmentType;
  amountMinor: number;
  reasonCode: string;
  occurredAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface AdjustCompensationResult {
  adjustmentPublicId: string;
  adjustedMinor: number;
  payableMinor: number;
}

export interface ReverseCompensationSettlementInput {
  tenantId: string;
  reversalPublicId: string;
  settlementPublicId: string;
  settlementAllocationPublicId: string;
  amountMinor: number;
  reasonCode: string;
  reversedAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface ReverseCompensationSettlementResult {
  reversalPublicId: string;
  reversedMinor: number;
  accrualPayableMinor: number;
}

interface RuleRow {
  rule_public_id: string;
  rule_version: number;
  scope_type: string;
  service_public_id: string | null;
  practitioner_public_id: string | null;
  practitioner_role: CompensationRole;
  accrual_stage: 'performer_reserve' | 'commission' | 'professional_fee';
  rate_type: 'fixed' | 'basis_points';
  rate_value: number;
  calculation_basis: 'gross' | 'net_after_discount' | 'remaining_after_performer' | 'collected';
  discount_treatment: 'deduct' | 'ignore';
  tax_treatment: 'include' | 'exclude';
  minimum_minor: number;
  cap_minor: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
}

interface LineRow {
  line_amount_minor: number;
  service_event_public_id: string | null;
  service_public_id: string | null;
  currency_code: string;
  invoice_status: string;
  collected_minor: number;
}

interface AccrualRow {
  accrual_public_id: string;
  practitioner_public_id: string | null;
  currency_code: string;
  earned_minor: number;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  status: string;
}

interface SettlementAllocationRow extends AccrualRow {
  allocation_public_id: string;
  settlement_public_id: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  settlement_total_minor: number;
  settlement_reversed_minor: number;
  settlement_status: string;
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

function safeNonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
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

function currency(value: string): string {
  if (!/^[A-Z]{3}$/.test(value)) throw new RangeError('currencyCode must be three uppercase letters');
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
    sourceEvidenceSha256: string;
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
    input.sourceEvidenceSha256,
  );
}

function calculatedEarned(rule: RuleRow, baseMinor: number): number {
  let earned: bigint;
  if (rule.rate_type === 'fixed') {
    earned = BigInt(rule.rate_value);
  } else {
    earned = (BigInt(baseMinor) * BigInt(rule.rate_value) + 5000n) / 10000n;
  }
  if (earned < BigInt(rule.minimum_minor)) earned = BigInt(rule.minimum_minor);
  if (rule.cap_minor != null && earned > BigInt(rule.cap_minor)) earned = BigInt(rule.cap_minor);
  if (earned <= 0n || earned > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Calculated compensation must be a positive safe integer');
  }
  return Number(earned);
}

function accrualStatus(practitionerPublicId: string | null, settledMinor: number, payableMinor: number): string {
  if (practitionerPublicId == null) return 'unassigned';
  if (payableMinor === 0) return 'settled';
  if (settledMinor > 0) return 'partially_settled';
  return 'accrued';
}

export async function accrueCompensation(
  db: CanonicalBatchDatabase,
  input: AccrueCompensationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<AccrueCompensationResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.accrualPublicId, 'accrualPublicId');
  exact(input.invoicePublicId, 'invoicePublicId');
  exact(input.invoiceLinePublicId, 'invoiceLinePublicId');
  const serviceEventPublicId = optionalExact(input.serviceEventPublicId, 'serviceEventPublicId');
  const practitionerPublicId = optionalExact(input.practitionerPublicId, 'practitionerPublicId');
  exact(input.rulePublicId, 'rulePublicId');
  positive(input.ruleVersion, 'ruleVersion');
  safeNonNegative(input.discountAllocatedMinor, 'discountAllocatedMinor');
  safeNonNegative(input.taxAllocatedMinor, 'taxAllocatedMinor');
  safeNonNegative(input.performerReserveMinor, 'performerReserveMinor');
  utc(input.accruedAtUtc, 'accruedAtUtc');
  businessDate(input.businessDate);
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');

  const request = { ...input, practitionerPublicId, serviceEventPublicId };
  const replay = await readCanonicalCommandReplay<AccrueCompensationResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.accrue',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const line = await db.prepare(`
    SELECT l.line_amount_minor,l.service_event_public_id,e.service_public_id,
           i.currency_code,i.status invoice_status,
           COALESCE((
             SELECT SUM(a.remaining_minor)
             FROM canonical_payment_allocations a
             WHERE a.tenant_id=l.tenant_id
               AND a.invoice_public_id=l.invoice_public_id
               AND a.invoice_line_public_id=l.line_public_id
               AND a.status IN ('active','partially_reversed')
           ),0) collected_minor
    FROM canonical_invoice_lines l
    JOIN canonical_invoices i
      ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
    LEFT JOIN canonical_service_events e
      ON e.tenant_id=l.tenant_id AND e.event_public_id=l.service_event_public_id
    WHERE l.tenant_id=? AND l.invoice_public_id=? AND l.line_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.invoicePublicId, input.invoiceLinePublicId).first<LineRow>();
  if (!line) throw new Error('Canonical invoice line not found');
  if (line.invoice_status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (line.line_amount_minor < 0) throw new Error('Compensation requires a positive service line');
  if (serviceEventPublicId !== line.service_event_public_id) throw new Error('Service event does not match canonical invoice line');
  if (input.discountAllocatedMinor > line.line_amount_minor) throw new RangeError('Discount allocation exceeds service line gross');
  if (input.performerReserveMinor > line.line_amount_minor) throw new RangeError('Performer reserve exceeds service line gross');

  const rule = await db.prepare(`
    SELECT rule_public_id,rule_version,scope_type,service_public_id,practitioner_public_id,
           practitioner_role,accrual_stage,rate_type,rate_value,calculation_basis,discount_treatment,
           tax_treatment,minimum_minor,cap_minor,effective_from,effective_to,status
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=? AND rule_version=?
    LIMIT 1
  `).bind(input.tenantId, input.rulePublicId, input.ruleVersion).first<RuleRow>();
  if (!rule) throw new Error('Canonical compensation rule not found');
  if (rule.status !== 'active') throw new Error('Canonical compensation rule is not active');
  if (rule.practitioner_role !== input.practitionerRole) throw new Error('Compensation rule practitioner role mismatch');
  if (rule.practitioner_public_id != null && rule.practitioner_public_id !== practitionerPublicId) {
    throw new Error('Compensation rule practitioner beneficiary mismatch');
  }
  if (input.businessDate < rule.effective_from || (rule.effective_to != null && input.businessDate > rule.effective_to)) {
    throw new Error('Compensation rule is not effective on business date');
  }
  if (rule.scope_type === 'service' && rule.service_public_id !== line.service_public_id) {
    throw new Error('Compensation rule service scope mismatch');
  }

  if (practitionerPublicId != null) {
    const practitioner = await db.prepare(`
      SELECT 1 present FROM canonical_practitioners
      WHERE tenant_id=? AND practitioner_public_id=? AND status='active'
      LIMIT 1
    `).bind(input.tenantId, practitionerPublicId).first<{ present: number }>();
    if (!practitioner) throw new Error('Canonical practitioner not found');
  }

  const grossMinor = line.line_amount_minor;
  let eligibleBaseMinor = rule.calculation_basis === 'collected' ? line.collected_minor : grossMinor;
  if (rule.calculation_basis !== 'collected' && rule.discount_treatment === 'deduct') {
    eligibleBaseMinor -= input.discountAllocatedMinor;
  }
  if (rule.calculation_basis === 'remaining_after_performer') eligibleBaseMinor -= input.performerReserveMinor;
  if (rule.tax_treatment === 'include') eligibleBaseMinor += input.taxAllocatedMinor;
  if (!Number.isSafeInteger(eligibleBaseMinor) || eligibleBaseMinor < 0) {
    throw new RangeError('Compensation eligible base is invalid');
  }
  const earnedMinor = calculatedEarned(rule, eligibleBaseMinor);
  const status = practitionerPublicId == null ? 'unassigned' : 'accrued';
  const result: AccrueCompensationResult = {
    accrualPublicId: input.accrualPublicId,
    grossMinor,
    eligibleBaseMinor,
    earnedMinor,
    payableMinor: earnedMinor,
    status,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.accrue',
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_compensation_accruals (
          tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
          service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
          rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
          gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
          earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
          business_date,payable_projection_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?, ?,1,?)
      `).bind(
        input.tenantId,
        input.accrualPublicId,
        input.invoicePublicId,
        input.invoiceLinePublicId,
        serviceEventPublicId,
        practitionerPublicId,
        input.practitionerRole,
        rule.accrual_stage,
        rule.rule_public_id,
        rule.rule_version,
        rule.calculation_basis,
        rule.rate_type,
        rule.rate_value,
        line.currency_code,
        grossMinor,
        input.discountAllocatedMinor,
        input.taxAllocatedMinor,
        input.performerReserveMinor,
        eligibleBaseMinor,
        earnedMinor,
        earnedMinor,
        status,
        input.accruedAtUtc,
        input.businessDate,
        input.sourceEvidenceSha256,
      ),
      mappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'compensation_accrual',
        canonicalPublicId: input.accrualPublicId,
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        sourceTable: input.sourceTable,
        sourceEvidenceSha256: input.sourceEvidenceSha256,
      }),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'compensation_accrual',
      aggregatePublicId: input.accrualPublicId,
      eventType: 'canonical.compensation.accrued',
      payload: {
        accrualPublicId: input.accrualPublicId,
        invoiceLinePublicId: input.invoiceLinePublicId,
        practitionerPublicId,
        practitionerRole: input.practitionerRole,
        earnedMinor,
        currencyCode: line.currency_code,
      },
      occurredAtUtc: input.accruedAtUtc,
      businessDate: input.businessDate,
    },
  });
}

export async function settleCompensation(
  db: CanonicalBatchDatabase,
  input: SettleCompensationInput,
): Promise<CanonicalCommandResult<SettleCompensationResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.settlementPublicId, 'settlementPublicId');
  exact(input.settlementNumber, 'settlementNumber');
  exact(input.practitionerPublicId, 'practitionerPublicId');
  currency(input.currencyCode);
  utc(input.settledAtUtc, 'settledAtUtc');
  businessDate(input.businessDate);
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  if (input.allocations.length === 0) throw new RangeError('Compensation settlement requires allocations');

  const request = input;
  const replay = await readCanonicalCommandReplay<SettleCompensationResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.settle',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const allocationIds = new Set<string>();
  const accrualIds = new Set<string>();
  const rows: Array<{ input: CompensationSettlementAllocationInput; row: AccrualRow }> = [];
  let total = 0n;
  for (const allocation of input.allocations) {
    exact(allocation.allocationPublicId, 'allocationPublicId');
    exact(allocation.accrualPublicId, 'accrualPublicId');
    positive(allocation.amountMinor, 'allocation.amountMinor');
    digest(allocation.sourceEvidenceSha256, 'allocation.sourceEvidenceSha256');
    if (allocationIds.has(allocation.allocationPublicId)) throw new RangeError('duplicate allocationPublicId');
    if (accrualIds.has(allocation.accrualPublicId)) throw new RangeError('duplicate accrual allocation');
    allocationIds.add(allocation.allocationPublicId);
    accrualIds.add(allocation.accrualPublicId);
    const row = await db.prepare(`
      SELECT accrual_public_id,practitioner_public_id,currency_code,earned_minor,
             adjusted_minor,settled_minor,payable_minor,status
      FROM canonical_compensation_accruals
      WHERE tenant_id=? AND accrual_public_id=? LIMIT 1
    `).bind(input.tenantId, allocation.accrualPublicId).first<AccrualRow>();
    if (!row) throw new Error('Canonical compensation accrual not found');
    if (row.practitioner_public_id !== input.practitionerPublicId) throw new Error('Compensation accrual practitioner mismatch');
    if (row.currency_code !== input.currencyCode) throw new Error('Compensation accrual currency mismatch');
    if (row.status === 'unassigned' || row.status === 'reversed') throw new Error('Compensation accrual is not payable');
    if (allocation.amountMinor > row.payable_minor) throw new RangeError('Settlement allocation exceeds accrual payable balance');
    total += BigInt(allocation.amountMinor);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('settlement total exceeds safe integer range');
    rows.push({ input: allocation, row });
  }
  const totalMinor = Number(total);
  const result: SettleCompensationResult = {
    settlementPublicId: input.settlementPublicId,
    totalMinor,
    allocationCount: rows.length,
  };

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_compensation_settlements (
        tenant_id,settlement_public_id,settlement_number,practitioner_public_id,
        currency_code,payment_method,total_minor,allocated_minor,reversed_minor,
        net_paid_minor,status,settled_at_utc,business_date,settlement_projection_guard,
        source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?, ?,0,?,'posted',?,?,1,?)
    `).bind(
      input.tenantId,
      input.settlementPublicId,
      input.settlementNumber,
      input.practitionerPublicId,
      input.currencyCode,
      input.paymentMethod,
      totalMinor,
      totalMinor,
      totalMinor,
      input.settledAtUtc,
      input.businessDate,
      input.sourceEvidenceSha256,
    ),
  ];

  for (const item of rows) {
    const settledAfter = item.row.settled_minor + item.input.amountMinor;
    const payableAfter = item.row.payable_minor - item.input.amountMinor;
    const statusAfter = accrualStatus(item.row.practitioner_public_id, settledAfter, payableAfter);
    statements.push(
      db.prepare(`
        INSERT INTO canonical_compensation_settlement_allocations (
          tenant_id,allocation_public_id,settlement_public_id,accrual_public_id,
          amount_minor,reversed_minor,remaining_minor,accrual_settled_before_minor,
          accrual_settled_after_minor,accrual_payable_before_minor,accrual_payable_after_minor,
          status,allocated_at_utc,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,0,?,?,?,?,?,'active',?,1,?)
      `).bind(
        input.tenantId,
        item.input.allocationPublicId,
        input.settlementPublicId,
        item.input.accrualPublicId,
        item.input.amountMinor,
        item.input.amountMinor,
        item.row.settled_minor,
        settledAfter,
        item.row.payable_minor,
        payableAfter,
        input.settledAtUtc,
        item.input.sourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_compensation_accruals
        SET settled_minor=?,payable_minor=?,status=?,updated_at_utc=?
        WHERE tenant_id=? AND accrual_public_id=?
          AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
      `).bind(
        settledAfter,
        payableAfter,
        statusAfter,
        input.settledAtUtc,
        input.tenantId,
        item.input.accrualPublicId,
        item.row.adjusted_minor,
        item.row.settled_minor,
        item.row.payable_minor,
        item.row.status,
      ),
      db.prepare(`
        UPDATE canonical_compensation_settlement_allocations
        SET balance_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_compensation_accruals
          WHERE tenant_id=? AND accrual_public_id=?
            AND settled_minor=? AND payable_minor=? AND status=?
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND allocation_public_id=?
      `).bind(
        input.tenantId,
        item.input.accrualPublicId,
        settledAfter,
        payableAfter,
        statusAfter,
        input.tenantId,
        item.input.allocationPublicId,
      ),
    );
  }
  statements.push(
    db.prepare(`
      UPDATE canonical_compensation_settlements
      SET settlement_projection_guard=CASE WHEN allocated_minor=COALESCE((
        SELECT SUM(amount_minor)
        FROM canonical_compensation_settlement_allocations
        WHERE tenant_id=? AND settlement_public_id=?
      ),0) THEN 1 ELSE 0 END
      WHERE tenant_id=? AND settlement_public_id=?
    `).bind(input.tenantId, input.settlementPublicId, input.tenantId, input.settlementPublicId),
    mappingStatement(db, {
      tenantId: input.tenantId,
      entityType: 'compensation_settlement',
      canonicalPublicId: input.settlementPublicId,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    }),
  );

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.settle',
    idempotencyKey: input.idempotencyKey,
    request,
    statements,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'compensation_settlement',
      aggregatePublicId: input.settlementPublicId,
      eventType: 'canonical.compensation.settled',
      payload: {
        settlementPublicId: input.settlementPublicId,
        practitionerPublicId: input.practitionerPublicId,
        totalMinor,
        currencyCode: input.currencyCode,
        allocationCount: rows.length,
      },
      occurredAtUtc: input.settledAtUtc,
      businessDate: input.businessDate,
    },
  });
}

type ResolvedCompensationAdjustment =
  | { replay: CanonicalCommandResult<AdjustCompensationResult>; batch: null }
  | { replay: null; batch: CanonicalBatch<AdjustCompensationResult> };

async function resolveCompensationAdjustment(
  db: CanonicalBatchDatabase,
  input: AdjustCompensationInput,
  execution: CanonicalCommandExecutionOptions,
): Promise<ResolvedCompensationAdjustment> {
  exact(input.tenantId, 'tenantId');
  exact(input.adjustmentPublicId, 'adjustmentPublicId');
  exact(input.accrualPublicId, 'accrualPublicId');
  positive(input.amountMinor, 'amountMinor');
  exact(input.reasonCode, 'reasonCode');
  utc(input.occurredAtUtc, 'occurredAtUtc');
  businessDate(input.businessDate);
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');

  const request = input;
  const replay = await readCanonicalCommandReplay<AdjustCompensationResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.adjust',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return { replay, batch: null };

  const row = await db.prepare(`
    SELECT accrual_public_id,practitioner_public_id,currency_code,earned_minor,
           adjusted_minor,settled_minor,payable_minor,status
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND accrual_public_id=? LIMIT 1
  `).bind(input.tenantId, input.accrualPublicId).first<AccrualRow>();
  if (!row) throw new Error('Canonical compensation accrual not found');
  if (input.amountMinor > row.payable_minor) {
    if (row.settled_minor > 0) throw new Error('Explicit settlement reversal is required before reducing paid compensation');
    throw new RangeError('Compensation adjustment exceeds payable balance');
  }
  const adjustedAfter = row.adjusted_minor + input.amountMinor;
  const payableAfter = row.payable_minor - input.amountMinor;
  const statusAfter = payableAfter === 0 && row.settled_minor === 0
    ? 'reversed'
    : accrualStatus(row.practitioner_public_id, row.settled_minor, payableAfter);
  const result: AdjustCompensationResult = {
    adjustmentPublicId: input.adjustmentPublicId,
    adjustedMinor: adjustedAfter,
    payableMinor: payableAfter,
  };

  return {
    replay: null,
    batch: {
      tenantId: input.tenantId,
      commandName: 'canonical.compensation.adjust',
      idempotencyKey: input.idempotencyKey,
      request,
      authoritativeStatements: execution.authoritativeStatements,
      statements: [
        db.prepare(`
          INSERT INTO canonical_compensation_adjustments (
            tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
            settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
            accrual_adjusted_before_minor,accrual_adjusted_after_minor,
            accrual_settled_before_minor,accrual_settled_after_minor,
            accrual_payable_before_minor,accrual_payable_after_minor,
            occurred_at_utc,business_date,balance_guard,source_evidence_sha256
          ) VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,1,?)
        `).bind(
          input.tenantId,
          input.adjustmentPublicId,
          input.accrualPublicId,
          input.adjustmentType,
          input.reasonCode,
          input.amountMinor,
          row.adjusted_minor,
          adjustedAfter,
          row.settled_minor,
          row.settled_minor,
          row.payable_minor,
          payableAfter,
          input.occurredAtUtc,
          input.businessDate,
          input.sourceEvidenceSha256,
        ),
        db.prepare(`
          UPDATE canonical_compensation_accruals
          SET adjusted_minor=?,payable_minor=?,status=?,updated_at_utc=?
          WHERE tenant_id=? AND accrual_public_id=?
            AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
        `).bind(
          adjustedAfter,
          payableAfter,
          statusAfter,
          input.occurredAtUtc,
          input.tenantId,
          input.accrualPublicId,
          row.adjusted_minor,
          row.settled_minor,
          row.payable_minor,
          row.status,
        ),
        db.prepare(`
          UPDATE canonical_compensation_adjustments
          SET balance_guard=CASE WHEN EXISTS (
            SELECT 1 FROM canonical_compensation_accruals
            WHERE tenant_id=? AND accrual_public_id=?
              AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
          ) THEN 1 ELSE 0 END
          WHERE tenant_id=? AND adjustment_public_id=?
        `).bind(
          input.tenantId,
          input.accrualPublicId,
          adjustedAfter,
          row.settled_minor,
          payableAfter,
          statusAfter,
          input.tenantId,
          input.adjustmentPublicId,
        ),
        mappingStatement(db, {
          tenantId: input.tenantId,
          entityType: 'compensation_adjustment',
          canonicalPublicId: input.adjustmentPublicId,
          sourceType: input.sourceType,
          sourcePublicId: input.sourcePublicId,
          sourceTable: input.sourceTable,
          sourceEvidenceSha256: input.sourceEvidenceSha256,
        }),
      ],
      result,
      event: {
        eventPublicId: input.outboxEventPublicId,
        aggregateType: 'compensation_accrual',
        aggregatePublicId: input.accrualPublicId,
        eventType: 'canonical.compensation.adjusted',
        payload: {
          adjustmentPublicId: input.adjustmentPublicId,
          accrualPublicId: input.accrualPublicId,
          adjustmentType: input.adjustmentType,
          amountMinor: input.amountMinor,
          payableMinor: payableAfter,
        },
        occurredAtUtc: input.occurredAtUtc,
        businessDate: input.businessDate,
      },
    },
  };
}

export async function prepareCompensationAdjustment(
  db: CanonicalBatchDatabase,
  input: AdjustCompensationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<PreparedCanonicalBatch<AdjustCompensationResult>> {
  const resolved = await resolveCompensationAdjustment(db, input, execution);
  if (resolved.replay) {
    return { status: 'replayed', result: resolved.replay.result, statements: [] };
  }
  return prepareCanonicalBatch(db, resolved.batch);
}

export async function adjustCompensation(
  db: CanonicalBatchDatabase,
  input: AdjustCompensationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<AdjustCompensationResult>> {
  const resolved = await resolveCompensationAdjustment(db, input, execution);
  if (resolved.replay) return resolved.replay;
  return runCanonicalBatch(db, resolved.batch);
}

export async function reverseCompensationSettlement(
  db: CanonicalBatchDatabase,
  input: ReverseCompensationSettlementInput,
): Promise<CanonicalCommandResult<ReverseCompensationSettlementResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.reversalPublicId, 'reversalPublicId');
  exact(input.settlementPublicId, 'settlementPublicId');
  exact(input.settlementAllocationPublicId, 'settlementAllocationPublicId');
  positive(input.amountMinor, 'amountMinor');
  exact(input.reasonCode, 'reasonCode');
  utc(input.reversedAtUtc, 'reversedAtUtc');
  businessDate(input.businessDate);
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');

  const request = input;
  const replay = await readCanonicalCommandReplay<ReverseCompensationSettlementResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.settlement.reverse',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const row = await db.prepare(`
    SELECT a.allocation_public_id,a.settlement_public_id,a.accrual_public_id,a.amount_minor,
           a.reversed_minor,a.remaining_minor,
           c.practitioner_public_id,c.currency_code,c.earned_minor,c.adjusted_minor,
           c.settled_minor,c.payable_minor,c.status,
           s.total_minor settlement_total_minor,s.reversed_minor settlement_reversed_minor,
           s.status settlement_status
    FROM canonical_compensation_settlement_allocations a
    JOIN canonical_compensation_accruals c
      ON c.tenant_id=a.tenant_id AND c.accrual_public_id=a.accrual_public_id
    JOIN canonical_compensation_settlements s
      ON s.tenant_id=a.tenant_id AND s.settlement_public_id=a.settlement_public_id
    WHERE a.tenant_id=? AND a.settlement_public_id=? AND a.allocation_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.settlementPublicId,
    input.settlementAllocationPublicId,
  ).first<SettlementAllocationRow>();
  if (!row) throw new Error('Canonical compensation settlement allocation not found');
  if (input.amountMinor > row.remaining_minor) throw new RangeError('Settlement reversal exceeds remaining allocation');
  if (input.amountMinor > row.settled_minor) throw new RangeError('Settlement reversal exceeds accrual settled balance');

  const allocationReversedAfter = row.reversed_minor + input.amountMinor;
  const allocationRemainingAfter = row.remaining_minor - input.amountMinor;
  const allocationStatusAfter = allocationRemainingAfter === 0 ? 'reversed' : 'partially_reversed';
  const settlementReversedAfter = row.settlement_reversed_minor + input.amountMinor;
  const settlementNetAfter = row.settlement_total_minor - settlementReversedAfter;
  const settlementStatusAfter = settlementNetAfter === 0 ? 'reversed' : 'partially_reversed';
  const settledAfter = row.settled_minor - input.amountMinor;
  const payableAfter = row.payable_minor + input.amountMinor;
  const accrualStatusAfter = accrualStatus(row.practitioner_public_id, settledAfter, payableAfter);
  const result: ReverseCompensationSettlementResult = {
    reversalPublicId: input.reversalPublicId,
    reversedMinor: input.amountMinor,
    accrualPayableMinor: payableAfter,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.compensation.settlement.reverse',
    idempotencyKey: input.idempotencyKey,
    request,
    statements: [
      db.prepare(`
        INSERT INTO canonical_compensation_adjustments (
          tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
          settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
          accrual_adjusted_before_minor,accrual_adjusted_after_minor,
          accrual_settled_before_minor,accrual_settled_after_minor,
          accrual_payable_before_minor,accrual_payable_after_minor,
          occurred_at_utc,business_date,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,'settlement_reversal',?,?,?,?,?,?,?,?,?,?,1,?)
      `).bind(
        input.tenantId,
        input.reversalPublicId,
        row.accrual_public_id,
        row.settlement_public_id,
        row.allocation_public_id,
        input.reasonCode,
        input.amountMinor,
        row.adjusted_minor,
        row.adjusted_minor,
        row.settled_minor,
        settledAfter,
        row.payable_minor,
        payableAfter,
        input.reversedAtUtc,
        input.businessDate,
        input.sourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_compensation_settlement_allocations
        SET reversed_minor=?,remaining_minor=?,status=?,reversed_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND allocation_public_id=?
          AND reversed_minor=? AND remaining_minor=? AND status IN ('active','partially_reversed')
      `).bind(
        allocationReversedAfter,
        allocationRemainingAfter,
        allocationStatusAfter,
        input.reversedAtUtc,
        input.reversedAtUtc,
        input.tenantId,
        row.allocation_public_id,
        row.reversed_minor,
        row.remaining_minor,
      ),
      db.prepare(`
        UPDATE canonical_compensation_settlements
        SET reversed_minor=?,net_paid_minor=?,status=?,reversed_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND settlement_public_id=?
          AND reversed_minor=? AND status IN ('posted','partially_reversed')
      `).bind(
        settlementReversedAfter,
        settlementNetAfter,
        settlementStatusAfter,
        input.reversedAtUtc,
        input.reversedAtUtc,
        input.tenantId,
        row.settlement_public_id,
        row.settlement_reversed_minor,
      ),
      db.prepare(`
        UPDATE canonical_compensation_accruals
        SET settled_minor=?,payable_minor=?,status=?,updated_at_utc=?
        WHERE tenant_id=? AND accrual_public_id=?
          AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
      `).bind(
        settledAfter,
        payableAfter,
        accrualStatusAfter,
        input.reversedAtUtc,
        input.tenantId,
        row.accrual_public_id,
        row.adjusted_minor,
        row.settled_minor,
        row.payable_minor,
        row.status,
      ),
      db.prepare(`
        UPDATE canonical_compensation_adjustments
        SET balance_guard=CASE WHEN
          EXISTS (SELECT 1 FROM canonical_compensation_accruals
            WHERE tenant_id=? AND accrual_public_id=?
              AND settled_minor=? AND payable_minor=? AND status=?)
          AND EXISTS (SELECT 1 FROM canonical_compensation_settlement_allocations
            WHERE tenant_id=? AND allocation_public_id=?
              AND reversed_minor=? AND remaining_minor=? AND status=?)
          AND EXISTS (SELECT 1 FROM canonical_compensation_settlements
            WHERE tenant_id=? AND settlement_public_id=?
              AND reversed_minor=? AND net_paid_minor=? AND status=?)
        THEN 1 ELSE 0 END
        WHERE tenant_id=? AND adjustment_public_id=?
      `).bind(
        input.tenantId,
        row.accrual_public_id,
        settledAfter,
        payableAfter,
        accrualStatusAfter,
        input.tenantId,
        row.allocation_public_id,
        allocationReversedAfter,
        allocationRemainingAfter,
        allocationStatusAfter,
        input.tenantId,
        row.settlement_public_id,
        settlementReversedAfter,
        settlementNetAfter,
        settlementStatusAfter,
        input.tenantId,
        input.reversalPublicId,
      ),
      mappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'compensation_adjustment',
        canonicalPublicId: input.reversalPublicId,
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        sourceTable: input.sourceTable,
        sourceEvidenceSha256: input.sourceEvidenceSha256,
      }),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'compensation_settlement',
      aggregatePublicId: input.settlementPublicId,
      eventType: 'canonical.compensation.settlement_reversed',
      payload: {
        reversalPublicId: input.reversalPublicId,
        settlementPublicId: input.settlementPublicId,
        settlementAllocationPublicId: input.settlementAllocationPublicId,
        amountMinor: input.amountMinor,
        accrualPublicId: row.accrual_public_id,
        accrualPayableMinor: payableAfter,
      },
      occurredAtUtc: input.reversedAtUtc,
      businessDate: input.businessDate,
    },
  });
}
