import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';

export type CompensationRuleScopeType = 'service' | 'category' | 'all';
export type CompensationPractitionerRole = 'performing' | 'referring' | 'prescribing' | 'treating' | 'reporting';
export type CompensationAccrualStage = 'performer_reserve' | 'commission' | 'professional_fee';
export type CompensationRateType = 'fixed' | 'basis_points';
export type CompensationWaiverPolicy = 'full_earned' | 'protected_floor' | 'no_doctor_waiver';
export type CompensationCalculationBasis = 'gross' | 'net_after_discount' | 'remaining_after_performer' | 'collected';
export type CompensationDiscountTreatment = 'deduct' | 'ignore';
export type CompensationTaxTreatment = 'include' | 'exclude';
export type CompensationRuleStatus = 'active' | 'inactive' | 'retired';

type EditableCompensationRuleStatus = Exclude<CompensationRuleStatus, 'retired'>;

export interface CompensationRuleDefinitionInput {
  tenantId: string;
  rulePublicId?: string;
  scopeType: CompensationRuleScopeType;
  servicePublicId?: string | null;
  categoryKey?: string | null;
  practitionerPublicId?: string | null;
  practitionerRole: CompensationPractitionerRole;
  accrualStage: CompensationAccrualStage;
  rateType: CompensationRateType;
  rateValue: number;
  waiverPolicy?: CompensationWaiverPolicy;
  protectedRateValue?: number;
  calculationBasis: CompensationCalculationBasis;
  discountTreatment: CompensationDiscountTreatment;
  taxTreatment: CompensationTaxTreatment;
  minimumMinor?: number;
  capMinor?: number | null;
  priority?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status?: EditableCompensationRuleStatus;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  outboxEventPublicId?: string;
}

export type CompensationRuleSnapshotInput = Omit<CompensationRuleDefinitionInput,
  'tenantId' | 'rulePublicId' | 'sourceType' | 'sourcePublicId' | 'sourceTable'
  | 'occurredAtUtc' | 'businessDate' | 'idempotencyKey' | 'outboxEventPublicId'
>;

export interface ReplaceCompensationRuleInput extends CompensationRuleDefinitionInput {
  expectedVersion: number;
  bootstrapCurrent?: CompensationRuleSnapshotInput;
}

export interface RetireCompensationRuleInput {
  tenantId: string;
  rulePublicId: string;
  expectedVersion: number;
  reasonCode: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  outboxEventPublicId?: string;
  bootstrapCurrent?: CompensationRuleSnapshotInput;
}

export interface CompensationRuleReferenceBootstrap {
  practitioners?: Array<{
    practitionerPublicId: string;
    displayName: string;
    practitionerKind?: 'internal' | 'external';
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    sourceEvidenceSha256: string;
  }>;
  services?: Array<{
    servicePublicId: string;
    itemKind: 'laboratory' | 'radiology' | 'consultation' | 'bed' | 'procedure' | 'product' | 'other';
    canonicalCode?: string | null;
    displayName: string;
    unitCode: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    sourceEvidenceSha256: string;
  }>;
}

export interface CompensationRuleCommandExecutionOptions extends CanonicalCommandExecutionOptions {
  referenceBootstrap?: CompensationRuleReferenceBootstrap;
}

export interface CompensationRuleCommandResult {
  rulePublicId: string;
  ruleVersion: number;
  status: CompensationRuleStatus;
}

type CurrentRuleRow = {
  rule_public_id: string;
  rule_version: number;
  scope_type: CompensationRuleScopeType;
  service_public_id: string | null;
  category_key: string | null;
  practitioner_public_id: string | null;
  practitioner_role: CompensationPractitionerRole;
  accrual_stage: CompensationAccrualStage;
  rate_type: CompensationRateType;
  rate_value: number;
  waiver_policy: CompensationWaiverPolicy;
  protected_rate_value: number;
  calculation_basis: CompensationCalculationBasis;
  discount_treatment: CompensationDiscountTreatment;
  tax_treatment: CompensationTaxTreatment;
  minimum_minor: number;
  cap_minor: number | null;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  status: CompensationRuleStatus;
  source_evidence_sha256: string;
};

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type ResolvedDefinition = Required<Omit<CompensationRuleDefinitionInput,
  'rulePublicId' | 'servicePublicId' | 'categoryKey' | 'practitionerPublicId' | 'waiverPolicy'
  | 'protectedRateValue' | 'minimumMinor' | 'capMinor' | 'priority' | 'effectiveTo' | 'status'
>> & {
  rulePublicId: string;
  servicePublicId: string | null;
  categoryKey: string | null;
  practitionerPublicId: string | null;
  waiverPolicy: CompensationWaiverPolicy;
  protectedRateValue: number;
  minimumMinor: number;
  capMinor: number | null;
  priority: number;
  effectiveTo: string | null;
  status: EditableCompensationRuleStatus;
  outboxEventPublicId: string;
};

type ResolvedRetire = Omit<RetireCompensationRuleInput, 'outboxEventPublicId'> & {
  outboxEventPublicId: string;
};

const CREATE_COMMAND = 'canonical.compensation-rule.create';
const REPLACE_COMMAND = 'canonical.compensation-rule.replace';
const RETIRE_COMMAND = 'canonical.compensation-rule.retire';

const SCOPE_TYPES = new Set<CompensationRuleScopeType>(['service', 'category', 'all']);
const PRACTITIONER_ROLES = new Set<CompensationPractitionerRole>(['performing', 'referring', 'prescribing', 'treating', 'reporting']);
const ACCRUAL_STAGES = new Set<CompensationAccrualStage>(['performer_reserve', 'commission', 'professional_fee']);
const RATE_TYPES = new Set<CompensationRateType>(['fixed', 'basis_points']);
const WAIVER_POLICIES = new Set<CompensationWaiverPolicy>(['full_earned', 'protected_floor', 'no_doctor_waiver']);
const CALCULATION_BASES = new Set<CompensationCalculationBasis>(['gross', 'net_after_discount', 'remaining_after_performer', 'collected']);
const DISCOUNT_TREATMENTS = new Set<CompensationDiscountTreatment>(['deduct', 'ignore']);
const TAX_TREATMENTS = new Set<CompensationTaxTreatment>(['include', 'exclude']);
const EDITABLE_STATUSES = new Set<EditableCompensationRuleStatus>(['active', 'inactive']);
const PRACTITIONER_KINDS = new Set(['internal', 'external'] as const);
const SERVICE_ITEM_KINDS = new Set([
  'laboratory', 'radiology', 'consultation', 'bed', 'procedure', 'product', 'other',
] as const);

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  return value == null ? null : exact(value, label);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function sha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new RangeError(`${label} must be a 64-character SHA-256 hex digest`);
  return value.toLowerCase();
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function date(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} must be a valid calendar date`);
  }
  return value;
}

async function resolveRulePublicId(input: CompensationRuleDefinitionInput): Promise<string> {
  if (input.rulePublicId != null) return exact(input.rulePublicId, 'rulePublicId');
  return createDeterministicSourceId(
    'comprule',
    exact(input.tenantId, 'tenantId'),
    exact(input.sourceType, 'sourceType'),
    exact(input.sourcePublicId, 'sourcePublicId'),
  );
}

async function resolveOutboxEventPublicId(
  prefix: string,
  tenantId: string,
  idempotencyKey: string,
  supplied?: string,
): Promise<string> {
  if (supplied != null) return exact(supplied, 'outboxEventPublicId');
  return createDeterministicSourceId(prefix, tenantId, 'compensation_rule_event', idempotencyKey);
}

async function validateDefinition(raw: CompensationRuleDefinitionInput): Promise<ResolvedDefinition> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const sourceType = exact(raw.sourceType, 'sourceType');
  const sourcePublicId = exact(raw.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(raw.sourceTable, 'sourceTable');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  const rulePublicId = await resolveRulePublicId(raw);
  const outboxEventPublicId = await resolveOutboxEventPublicId('comprevt', tenantId, idempotencyKey, raw.outboxEventPublicId);
  const servicePublicId = optionalExact(raw.servicePublicId, 'servicePublicId');
  const categoryKey = optionalExact(raw.categoryKey, 'categoryKey');
  const practitionerPublicId = optionalExact(raw.practitionerPublicId, 'practitionerPublicId');

  if (!SCOPE_TYPES.has(raw.scopeType)) throw new TypeError('scopeType is not supported');
  if (raw.scopeType === 'service' && (!servicePublicId || categoryKey != null)) {
    throw new TypeError('service scope requires servicePublicId and forbids categoryKey');
  }
  if (raw.scopeType === 'category' && (!categoryKey || servicePublicId != null)) {
    throw new TypeError('category scope requires categoryKey and forbids servicePublicId');
  }
  if (raw.scopeType === 'all' && (servicePublicId != null || categoryKey != null)) {
    throw new TypeError('all scope forbids servicePublicId and categoryKey');
  }
  if (!PRACTITIONER_ROLES.has(raw.practitionerRole)) throw new TypeError('practitionerRole is not supported');
  if (!ACCRUAL_STAGES.has(raw.accrualStage)) throw new TypeError('accrualStage is not supported');
  if (!RATE_TYPES.has(raw.rateType)) throw new TypeError('rateType is not supported');
  const rateValue = nonNegativeInteger(raw.rateValue, 'rateValue');
  if (raw.rateType === 'basis_points' && rateValue > 10_000) throw new RangeError('basis points rateValue cannot exceed 10000');

  const waiverPolicy = raw.waiverPolicy ?? 'full_earned';
  if (!WAIVER_POLICIES.has(waiverPolicy)) throw new TypeError('waiverPolicy is not supported');
  const protectedRateValue = nonNegativeInteger(raw.protectedRateValue ?? 0, 'protectedRateValue');
  if (raw.rateType === 'basis_points' && protectedRateValue > 10_000) {
    throw new RangeError('basis points protectedRateValue cannot exceed 10000');
  }
  if (protectedRateValue > rateValue) throw new RangeError('protectedRateValue cannot exceed rateValue');
  if (waiverPolicy === 'full_earned' && protectedRateValue !== 0) {
    throw new RangeError('full_earned waiverPolicy requires protectedRateValue zero');
  }
  if (waiverPolicy === 'no_doctor_waiver' && protectedRateValue !== rateValue) {
    throw new RangeError('no_doctor_waiver requires protectedRateValue equal to rateValue');
  }

  if (!CALCULATION_BASES.has(raw.calculationBasis)) throw new TypeError('calculationBasis is not supported');
  if (!DISCOUNT_TREATMENTS.has(raw.discountTreatment)) throw new TypeError('discountTreatment is not supported');
  if (!TAX_TREATMENTS.has(raw.taxTreatment)) throw new TypeError('taxTreatment is not supported');
  const minimumMinor = nonNegativeInteger(raw.minimumMinor ?? 0, 'minimumMinor');
  const capMinor = raw.capMinor == null ? null : nonNegativeInteger(raw.capMinor, 'capMinor');
  if (capMinor != null && capMinor < minimumMinor) throw new RangeError('capMinor cannot be below minimumMinor');
  const priority = nonNegativeInteger(raw.priority ?? 100, 'priority');
  const effectiveFrom = date(raw.effectiveFrom, 'effectiveFrom');
  const effectiveTo = raw.effectiveTo == null ? null : date(raw.effectiveTo, 'effectiveTo');
  if (effectiveTo != null && effectiveTo < effectiveFrom) throw new RangeError('effectiveTo cannot precede effectiveFrom');
  const status = raw.status ?? 'active';
  if (!EDITABLE_STATUSES.has(status)) throw new TypeError('create/replace status must be active or inactive');

  return {
    ...raw,
    tenantId,
    rulePublicId,
    scopeType: raw.scopeType,
    servicePublicId,
    categoryKey,
    practitionerPublicId,
    practitionerRole: raw.practitionerRole,
    accrualStage: raw.accrualStage,
    rateType: raw.rateType,
    rateValue,
    waiverPolicy,
    protectedRateValue,
    calculationBasis: raw.calculationBasis,
    discountTreatment: raw.discountTreatment,
    taxTreatment: raw.taxTreatment,
    minimumMinor,
    capMinor,
    priority,
    effectiveFrom,
    effectiveTo,
    status,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: date(raw.businessDate, 'businessDate'),
    idempotencyKey,
    outboxEventPublicId,
  };
}

async function validateBootstrapSnapshot(input: {
  tenantId: string;
  rulePublicId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  snapshot?: CompensationRuleSnapshotInput;
}): Promise<ResolvedDefinition | null> {
  if (!input.snapshot) return null;
  return validateDefinition({
    ...input.snapshot,
    tenantId: input.tenantId,
    rulePublicId: input.rulePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    idempotencyKey: `${input.idempotencyKey}:bootstrap`,
    outboxEventPublicId: `${input.idempotencyKey}:bootstrap`,
  });
}

async function validateRetire(raw: RetireCompensationRuleInput): Promise<ResolvedRetire> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  return {
    ...raw,
    tenantId,
    rulePublicId: exact(raw.rulePublicId, 'rulePublicId'),
    expectedVersion: nonNegativeInteger(raw.expectedVersion, 'expectedVersion'),
    reasonCode: exact(raw.reasonCode, 'reasonCode'),
    sourceType: exact(raw.sourceType, 'sourceType'),
    sourcePublicId: exact(raw.sourcePublicId, 'sourcePublicId'),
    sourceTable: exact(raw.sourceTable, 'sourceTable'),
    sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: date(raw.businessDate, 'businessDate'),
    idempotencyKey,
    outboxEventPublicId: await resolveOutboxEventPublicId('comprevt', tenantId, idempotencyKey, raw.outboxEventPublicId),
  };
}

function definitionRequest(input: ResolvedDefinition, expectedVersion: number | null) {
  return {
    tenantId: input.tenantId,
    rulePublicId: input.rulePublicId,
    expectedVersion,
    scopeType: input.scopeType,
    servicePublicId: input.servicePublicId,
    categoryKey: input.categoryKey,
    practitionerPublicId: input.practitionerPublicId,
    practitionerRole: input.practitionerRole,
    accrualStage: input.accrualStage,
    rateType: input.rateType,
    rateValue: input.rateValue,
    waiverPolicy: input.waiverPolicy,
    protectedRateValue: input.protectedRateValue,
    calculationBasis: input.calculationBasis,
    discountTreatment: input.discountTreatment,
    taxTreatment: input.taxTreatment,
    minimumMinor: input.minimumMinor,
    capMinor: input.capMinor,
    priority: input.priority,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    status: input.status,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
  };
}

function ruleInsertStatement(
  db: CanonicalBatchDatabase,
  input: ResolvedDefinition,
  version: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      waiver_policy,protected_rate_value,calculation_basis,discount_treatment,tax_treatment,
      minimum_minor,cap_minor,priority,effective_from,effective_to,status,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.rulePublicId,
    version,
    input.scopeType,
    input.servicePublicId,
    input.categoryKey,
    input.practitionerPublicId,
    input.practitionerRole,
    input.accrualStage,
    input.rateType,
    input.rateValue,
    input.waiverPolicy,
    input.protectedRateValue,
    input.calculationBasis,
    input.discountTreatment,
    input.taxTreatment,
    input.minimumMinor,
    input.capMinor,
    input.priority,
    input.effectiveFrom,
    input.effectiveTo,
    input.status,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function retiredRuleInsertStatement(
  db: CanonicalBatchDatabase,
  input: ResolvedRetire,
  current: CurrentRuleRow,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_compensation_rules (
      tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
      practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
      waiver_policy,protected_rate_value,calculation_basis,discount_treatment,tax_treatment,
      minimum_minor,cap_minor,priority,effective_from,effective_to,status,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'retired',?,?,?)
  `).bind(
    input.tenantId,
    input.rulePublicId,
    current.rule_version + 1,
    current.scope_type,
    current.service_public_id,
    current.category_key,
    current.practitioner_public_id,
    current.practitioner_role,
    current.accrual_stage,
    current.rate_type,
    current.rate_value,
    current.waiver_policy,
    current.protected_rate_value,
    current.calculation_basis,
    current.discount_treatment,
    current.tax_treatment,
    current.minimum_minor,
    current.cap_minor,
    current.priority,
    current.effective_from,
    current.effective_to,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.occurredAtUtc,
  );
}

function mappingInsertStatement(
  db: CanonicalBatchDatabase,
  input: Pick<ResolvedDefinition, 'tenantId' | 'rulePublicId' | 'sourceType' | 'sourcePublicId' | 'sourceTable' | 'sourceEvidenceSha256'>,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,'compensation_rule',?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    input.rulePublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

async function currentRule(
  db: CanonicalBatchDatabase,
  tenantId: string,
  rulePublicId: string,
): Promise<CurrentRuleRow | null> {
  return db.prepare(`
    SELECT rule_public_id,rule_version,scope_type,service_public_id,category_key,
           practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
           waiver_policy,protected_rate_value,calculation_basis,discount_treatment,tax_treatment,
           minimum_minor,cap_minor,priority,effective_from,effective_to,status,source_evidence_sha256
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=?
    ORDER BY rule_version DESC
    LIMIT 1
  `).bind(tenantId, rulePublicId).first<CurrentRuleRow>();
}

async function validateMapping(
  db: CanonicalBatchDatabase,
  input: Pick<ResolvedDefinition, 'tenantId' | 'rulePublicId' | 'sourceType' | 'sourcePublicId'>,
): Promise<boolean> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='compensation_rule' AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.sourceType, input.sourcePublicId).first<MappingRow>();
  if (!mapping) return false;
  if (mapping.mapping_status !== 'mapped' || mapping.canonical_public_id !== input.rulePublicId) {
    throw new Error('compensation rule source mapping belongs to another Canonical rule');
  }
  return true;
}

function referenceBootstrapRequest(bootstrap: CompensationRuleReferenceBootstrap | undefined) {
  if (!bootstrap) return null;
  return {
    practitioners: [...(bootstrap.practitioners ?? [])]
      .sort((a, b) => a.practitionerPublicId.localeCompare(b.practitionerPublicId)),
    services: [...(bootstrap.services ?? [])]
      .sort((a, b) => a.servicePublicId.localeCompare(b.servicePublicId)),
  };
}

function genericMappingInsertStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'practitioner' | 'service_catalog_item';
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

async function checkedReferenceMapping(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'practitioner' | 'service_catalog_item';
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
  },
): Promise<boolean> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
  ).first<MappingRow>();
  if (!mapping) return false;
  if (mapping.mapping_status !== 'mapped' || mapping.canonical_public_id !== input.canonicalPublicId) {
    throw new Error(`${input.entityType} source mapping belongs to another Canonical identity`);
  }
  return true;
}

async function prepareReferenceStatements(
  db: CanonicalBatchDatabase,
  definitions: ResolvedDefinition[],
  bootstrap: CompensationRuleReferenceBootstrap | undefined,
): Promise<CanonicalPreparedStatement[]> {
  const tenantId = definitions[0]?.tenantId;
  if (!tenantId) return [];
  if (definitions.some((definition) => definition.tenantId !== tenantId)) {
    throw new Error('compensation rule reference definitions must share one tenant');
  }

  const requiredPractitioners = new Set(
    definitions.map((definition) => definition.practitionerPublicId).filter((value): value is string => value != null),
  );
  const requiredServices = new Set(
    definitions.map((definition) => definition.servicePublicId).filter((value): value is string => value != null),
  );
  const practitionerBootstraps = new Map<string, NonNullable<CompensationRuleReferenceBootstrap['practitioners']>[number]>();
  const serviceBootstraps = new Map<string, NonNullable<CompensationRuleReferenceBootstrap['services']>[number]>();

  for (const entry of bootstrap?.practitioners ?? []) {
    const publicId = exact(entry.practitionerPublicId, 'referenceBootstrap.practitionerPublicId');
    if (practitionerBootstraps.has(publicId)) throw new Error(`duplicate practitioner bootstrap: ${publicId}`);
    practitionerBootstraps.set(publicId, entry);
  }
  for (const entry of bootstrap?.services ?? []) {
    const publicId = exact(entry.servicePublicId, 'referenceBootstrap.servicePublicId');
    if (serviceBootstraps.has(publicId)) throw new Error(`duplicate service bootstrap: ${publicId}`);
    serviceBootstraps.set(publicId, entry);
  }
  for (const publicId of practitionerBootstraps.keys()) {
    if (!requiredPractitioners.has(publicId)) throw new Error(`unused practitioner bootstrap: ${publicId}`);
  }
  for (const publicId of serviceBootstraps.keys()) {
    if (!requiredServices.has(publicId)) throw new Error(`unused service bootstrap: ${publicId}`);
  }

  const statements: CanonicalPreparedStatement[] = [];
  for (const practitionerPublicId of requiredPractitioners) {
    const row = await db.prepare(`
      SELECT status FROM canonical_practitioners
      WHERE tenant_id=? AND practitioner_public_id=?
      LIMIT 1
    `).bind(tenantId, practitionerPublicId).first<{ status: string }>();
    const entry = practitionerBootstraps.get(practitionerPublicId);
    if (row && row.status !== 'active') throw new Error('Canonical practitioner is not active');
    if (!row && !entry) throw new Error('Canonical practitioner does not exist in the rule tenant');
    if (!entry) continue;

    const practitionerKind = entry.practitionerKind ?? 'internal';
    if (!PRACTITIONER_KINDS.has(practitionerKind)) throw new TypeError('reference practitionerKind is not supported');
    const displayName = exact(entry.displayName, 'reference practitioner displayName');
    const sourceType = exact(entry.sourceType, 'reference practitioner sourceType');
    const sourcePublicId = exact(entry.sourcePublicId, 'reference practitioner sourcePublicId');
    const sourceTable = exact(entry.sourceTable, 'reference practitioner sourceTable');
    const evidenceSha256 = sha256(entry.sourceEvidenceSha256, 'reference practitioner sourceEvidenceSha256');
    const mappingExists = await checkedReferenceMapping(db, {
      tenantId,
      entityType: 'practitioner',
      canonicalPublicId: practitionerPublicId,
      sourceType,
      sourcePublicId,
    });
    if (!row) {
      statements.push(db.prepare(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES (?,?,?,?, 'active')
      `).bind(tenantId, practitionerPublicId, practitionerKind, displayName));
    }
    if (!mappingExists) statements.push(genericMappingInsertStatement(db, {
      tenantId,
      entityType: 'practitioner',
      canonicalPublicId: practitionerPublicId,
      sourceType,
      sourcePublicId,
      sourceTable,
      evidenceSha256,
    }));
  }

  for (const servicePublicId of requiredServices) {
    const row = await db.prepare(`
      SELECT status FROM canonical_service_catalog_items
      WHERE tenant_id=? AND service_public_id=?
      LIMIT 1
    `).bind(tenantId, servicePublicId).first<{ status: string }>();
    const entry = serviceBootstraps.get(servicePublicId);
    if (row && row.status !== 'active') throw new Error('Canonical service is not active');
    if (!row && !entry) throw new Error('Canonical service does not exist in the rule tenant');
    if (!entry) continue;

    if (!SERVICE_ITEM_KINDS.has(entry.itemKind)) throw new TypeError('reference service itemKind is not supported');
    const canonicalCode = optionalExact(entry.canonicalCode, 'reference service canonicalCode');
    const displayName = exact(entry.displayName, 'reference service displayName');
    const unitCode = exact(entry.unitCode, 'reference service unitCode');
    const sourceType = exact(entry.sourceType, 'reference service sourceType');
    const sourcePublicId = exact(entry.sourcePublicId, 'reference service sourcePublicId');
    const sourceTable = exact(entry.sourceTable, 'reference service sourceTable');
    const evidenceSha256 = sha256(entry.sourceEvidenceSha256, 'reference service sourceEvidenceSha256');
    const mappingExists = await checkedReferenceMapping(db, {
      tenantId,
      entityType: 'service_catalog_item',
      canonicalPublicId: servicePublicId,
      sourceType,
      sourcePublicId,
    });
    if (!row) {
      statements.push(db.prepare(`
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,'active',?)
      `).bind(
        tenantId,
        servicePublicId,
        entry.itemKind,
        canonicalCode,
        displayName,
        unitCode,
        evidenceSha256,
      ));
    }
    if (!mappingExists) statements.push(genericMappingInsertStatement(db, {
      tenantId,
      entityType: 'service_catalog_item',
      canonicalPublicId: servicePublicId,
      sourceType,
      sourcePublicId,
      sourceTable,
      evidenceSha256,
    }));
  }

  return statements;
}

async function runDefinitionCommand(
  db: CanonicalBatchDatabase,
  input: ResolvedDefinition,
  commandName: typeof CREATE_COMMAND | typeof REPLACE_COMMAND,
  eventType: 'created' | 'replaced',
  expectedVersion: number | null,
  bootstrapCurrent: ResolvedDefinition | null,
  execution: CompensationRuleCommandExecutionOptions,
): Promise<CanonicalCommandResult<CompensationRuleCommandResult>> {
  const request = {
    ...definitionRequest(input, expectedVersion),
    bootstrapCurrent: bootstrapCurrent ? definitionRequest(bootstrapCurrent, 0) : null,
    referenceBootstrap: referenceBootstrapRequest(execution.referenceBootstrap),
  };
  const replay = await readCanonicalCommandReplay<CompensationRuleCommandResult>(db, {
    tenantId: input.tenantId,
    commandName,
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const current = await currentRule(db, input.tenantId, input.rulePublicId);
  let nextVersion: number;
  const statements = await prepareReferenceStatements(
    db,
    bootstrapCurrent ? [bootstrapCurrent, input] : [input],
    execution.referenceBootstrap,
  );
  if (expectedVersion == null) {
    if (bootstrapCurrent) throw new Error('createCompensationRule does not accept bootstrapCurrent');
    if (current) throw new Error('Canonical compensation rule already exists; use replaceCompensationRule');
    nextVersion = 1;
  } else if (current) {
    if (bootstrapCurrent) throw new Error('bootstrapCurrent is allowed only when Canonical history is absent');
    if (current.rule_version !== expectedVersion) {
      throw new Error(`expectedVersion ${expectedVersion} does not match current version ${current.rule_version}`);
    }
    if (current.status === 'retired') throw new Error('retired compensation rule cannot be replaced');
    nextVersion = current.rule_version + 1;
  } else {
    if (expectedVersion !== 0 || !bootstrapCurrent) {
      throw new Error('Canonical compensation rule does not exist; expectedVersion 0 requires bootstrapCurrent');
    }
    if (bootstrapCurrent.rulePublicId !== input.rulePublicId) throw new Error('bootstrapCurrent rulePublicId mismatch');
    if (bootstrapCurrent.sourceType !== input.sourceType || bootstrapCurrent.sourcePublicId !== input.sourcePublicId) {
      throw new Error('bootstrapCurrent source identity mismatch');
    }
    statements.push(ruleInsertStatement(db, bootstrapCurrent, 1));
    nextVersion = 2;
  }

  const mappingExists = await validateMapping(db, input);
  const result: CompensationRuleCommandResult = {
    rulePublicId: input.rulePublicId,
    ruleVersion: nextVersion,
    status: input.status,
  };
  statements.push(ruleInsertStatement(db, input, nextVersion));
  if (!mappingExists) statements.push(mappingInsertStatement(db, input));

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName,
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_compensation_rule',
      aggregatePublicId: input.rulePublicId,
      eventType: `canonical.compensation-rule.${eventType}`,
      eventVersion: nextVersion,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        rulePublicId: input.rulePublicId,
        ruleVersion: nextVersion,
        status: input.status,
        scopeType: input.scopeType,
        practitionerRole: input.practitionerRole,
        accrualStage: input.accrualStage,
        rateType: input.rateType,
        rateValue: input.rateValue,
      },
    },
  });
}

export async function createCompensationRule(
  db: CanonicalBatchDatabase,
  rawInput: CompensationRuleDefinitionInput,
  execution: CompensationRuleCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CompensationRuleCommandResult>> {
  const input = await validateDefinition(rawInput);
  return runDefinitionCommand(db, input, CREATE_COMMAND, 'created', null, null, execution);
}

export async function replaceCompensationRule(
  db: CanonicalBatchDatabase,
  rawInput: ReplaceCompensationRuleInput,
  execution: CompensationRuleCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CompensationRuleCommandResult>> {
  const expectedVersion = nonNegativeInteger(rawInput.expectedVersion, 'expectedVersion');
  const input = await validateDefinition(rawInput);
  const bootstrapCurrent = await validateBootstrapSnapshot({
    tenantId: input.tenantId,
    rulePublicId: input.rulePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
    snapshot: rawInput.bootstrapCurrent,
  });
  return runDefinitionCommand(
    db,
    input,
    REPLACE_COMMAND,
    'replaced',
    expectedVersion,
    bootstrapCurrent,
    execution,
  );
}

export async function retireCompensationRule(
  db: CanonicalBatchDatabase,
  rawInput: RetireCompensationRuleInput,
  execution: CompensationRuleCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CompensationRuleCommandResult>> {
  const input = await validateRetire(rawInput);
  const bootstrapCurrent = await validateBootstrapSnapshot({
    tenantId: input.tenantId,
    rulePublicId: input.rulePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
    snapshot: rawInput.bootstrapCurrent,
  });
  const request = {
    tenantId: input.tenantId,
    rulePublicId: input.rulePublicId,
    expectedVersion: input.expectedVersion,
    reasonCode: input.reasonCode,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    bootstrapCurrent: bootstrapCurrent ? definitionRequest(bootstrapCurrent, 0) : null,
    referenceBootstrap: referenceBootstrapRequest(execution.referenceBootstrap),
  };
  const replay = await readCanonicalCommandReplay<CompensationRuleCommandResult>(db, {
    tenantId: input.tenantId,
    commandName: RETIRE_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const existing = await currentRule(db, input.tenantId, input.rulePublicId);
  let current: CurrentRuleRow;
  const statements = await prepareReferenceStatements(
    db,
    bootstrapCurrent ? [bootstrapCurrent] : [],
    execution.referenceBootstrap,
  );
  if (existing) {
    if (bootstrapCurrent) throw new Error('bootstrapCurrent is allowed only when Canonical history is absent');
    if (existing.rule_version !== input.expectedVersion) {
      throw new Error(`expectedVersion ${input.expectedVersion} does not match current version ${existing.rule_version}`);
    }
    if (existing.status === 'retired') throw new Error('Canonical compensation rule is already retired');
    current = existing;
  } else {
    if (input.expectedVersion !== 0 || !bootstrapCurrent) {
      throw new Error('Canonical compensation rule does not exist; expectedVersion 0 requires bootstrapCurrent');
    }
    if (bootstrapCurrent.rulePublicId !== input.rulePublicId) throw new Error('bootstrapCurrent rulePublicId mismatch');
    if (bootstrapCurrent.sourceType !== input.sourceType || bootstrapCurrent.sourcePublicId !== input.sourcePublicId) {
      throw new Error('bootstrapCurrent source identity mismatch');
    }
    statements.push(ruleInsertStatement(db, bootstrapCurrent, 1));
    current = {
      rule_public_id: bootstrapCurrent.rulePublicId,
      rule_version: 1,
      scope_type: bootstrapCurrent.scopeType,
      service_public_id: bootstrapCurrent.servicePublicId,
      category_key: bootstrapCurrent.categoryKey,
      practitioner_public_id: bootstrapCurrent.practitionerPublicId,
      practitioner_role: bootstrapCurrent.practitionerRole,
      accrual_stage: bootstrapCurrent.accrualStage,
      rate_type: bootstrapCurrent.rateType,
      rate_value: bootstrapCurrent.rateValue,
      waiver_policy: bootstrapCurrent.waiverPolicy,
      protected_rate_value: bootstrapCurrent.protectedRateValue,
      calculation_basis: bootstrapCurrent.calculationBasis,
      discount_treatment: bootstrapCurrent.discountTreatment,
      tax_treatment: bootstrapCurrent.taxTreatment,
      minimum_minor: bootstrapCurrent.minimumMinor,
      cap_minor: bootstrapCurrent.capMinor,
      priority: bootstrapCurrent.priority,
      effective_from: bootstrapCurrent.effectiveFrom,
      effective_to: bootstrapCurrent.effectiveTo,
      status: bootstrapCurrent.status,
      source_evidence_sha256: bootstrapCurrent.sourceEvidenceSha256,
    };
  }

  const mappingExists = await validateMapping(db, input);
  const nextVersion = current.rule_version + 1;
  const result: CompensationRuleCommandResult = {
    rulePublicId: input.rulePublicId,
    ruleVersion: nextVersion,
    status: 'retired',
  };
  statements.push(retiredRuleInsertStatement(db, input, current));
  if (!mappingExists) statements.push(mappingInsertStatement(db, input));

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: RETIRE_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_compensation_rule',
      aggregatePublicId: input.rulePublicId,
      eventType: 'canonical.compensation-rule.retired',
      eventVersion: nextVersion,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        rulePublicId: input.rulePublicId,
        ruleVersion: nextVersion,
        status: 'retired',
        reasonCode: input.reasonCode,
      },
    },
  });
}
