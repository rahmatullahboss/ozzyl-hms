import type { DoctorCommissionWaiverPolicy } from '../doctor-commission-waiver-policy';
import { toMinorUnits } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
} from './source-mapping';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import {
  createCompensationRule,
  replaceCompensationRule,
  retireCompensationRule,
  type CompensationRuleCommandResult,
  type CompensationRuleDefinitionInput,
  type CompensationRuleReferenceBootstrap,
  type CompensationRuleSnapshotInput,
} from './contracts/manage-compensation-rule';

const DOCTOR_SOURCE_TYPE = 'legacy_doctor';
const DOCTOR_RULE_SOURCE_TYPE = 'legacy_doctor_commission_rule';
const DIAGNOSTIC_RULE_SOURCE_TYPE = 'legacy_diagnostic_performer_rule';
const LAB_SERVICE_SOURCE_TYPE = 'legacy_lab_test';
const BILLING_SERVICE_SOURCE_TYPE = 'legacy_billing_service_item';

type RuleCommandResponse =
  | { status: 'applied'; result: CompensationRuleCommandResult }
  | { status: 'replayed'; result: CompensationRuleCommandResult };

type CurrentRuleVersion = {
  rule_version: number;
  status: string;
};

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

export interface LegacyDoctorReference {
  id: number;
  name: string;
  isActive: boolean;
}

export interface LegacyLabServiceReference {
  id: number;
  code: string | null;
  name: string;
  isActive: boolean;
}

export interface LegacyDiagnosticServiceReference {
  id: number;
  itemCode: string | null;
  itemName: string;
  diagnosticKind: 'lab' | 'radiology';
  isActive: boolean;
}

export interface LegacyDoctorCommissionRuleSnapshot {
  doctorId: number;
  serviceType: 'lab_test' | 'consultation_fee' | 'referral' | 'procedure' | 'ipd_round';
  labTestId: number | null;
  category: string | null;
  rateType: 'percent' | 'flat';
  rateValue: number;
  waiverPolicy: DoctorCommissionWaiverPolicy;
  protectedRateBps: number;
  protectedFlatAmount: number;
  incentiveType: 'performer' | 'prescriber' | 'referrer';
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface LegacyDiagnosticPerformerRuleSnapshot {
  serviceItemId: number;
  diagnosticKind: 'lab' | 'radiology';
  rateType: 'percent' | 'flat';
  rateValue: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

interface RuleContext {
  tenantId: string;
  rulePublicId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  snapshot: CompensationRuleSnapshotInput;
  references: CompensationRuleReferenceBootstrap;
}

export interface CompensationRuleRouteExecution {
  authoritativeStatements: readonly CanonicalPreparedStatement[];
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
}

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
  return value;
}

function normalizedCategory(value: string | null): string | null {
  return normalizeIdentityText(value);
}

function canonicalRole(
  incentiveType: LegacyDoctorCommissionRuleSnapshot['incentiveType'],
): 'performing' | 'prescribing' | 'referring' {
  if (incentiveType === 'performer') return 'performing';
  if (incentiveType === 'prescriber') return 'prescribing';
  return 'referring';
}

function canonicalRate(
  rateType: 'percent' | 'flat',
  rateValue: number,
): { rateType: 'basis_points' | 'fixed'; rateValue: number } {
  if (rateType === 'percent') {
    const basisPoints = nonNegativeInteger(rateValue, 'percentage rateValue');
    if (basisPoints > 10_000) throw new RangeError('percentage rateValue cannot exceed 10000 basis points');
    return { rateType: 'basis_points', rateValue: basisPoints };
  }
  const minor = Number(toMinorUnits(String(rateValue)));
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError('flat rateValue is outside the exact minor-unit range');
  return { rateType: 'fixed', rateValue: minor };
}

function canonicalProtectedRate(
  snapshot: LegacyDoctorCommissionRuleSnapshot,
  rate: { rateType: 'basis_points' | 'fixed'; rateValue: number },
): number {
  if (snapshot.waiverPolicy === 'full_earned') return 0;
  if (snapshot.waiverPolicy === 'no_doctor_waiver') return rate.rateValue;
  if (snapshot.rateType === 'percent') {
    const value = nonNegativeInteger(snapshot.protectedRateBps, 'protectedRateBps');
    if (value > rate.rateValue) throw new RangeError('protectedRateBps cannot exceed the commission rate');
    return value;
  }
  const value = Number(toMinorUnits(String(snapshot.protectedFlatAmount)));
  if (!Number.isSafeInteger(value) || value < 0 || value > rate.rateValue) {
    throw new RangeError('protectedFlatAmount cannot exceed the commission rate');
  }
  return value;
}

async function mappedPublicId(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'practitioner' | 'service_catalog_item';
    sourceType: string;
    sourcePublicId: string;
  },
): Promise<string | null> {
  const row = await db.prepare(`
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
  if (!row) return null;
  if (row.mapping_status !== 'mapped' || !row.canonical_public_id) {
    throw new Error(`${input.entityType} source mapping is not an exact mapped identity`);
  }
  return row.canonical_public_id;
}

async function currentRuleVersion(
  db: CanonicalBatchDatabase,
  tenantId: string,
  rulePublicId: string,
): Promise<CurrentRuleVersion | null> {
  return db.prepare(`
    SELECT rule_version,status
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=?
    ORDER BY rule_version DESC
    LIMIT 1
  `).bind(tenantId, rulePublicId).first<CurrentRuleVersion>();
}

function mergeReferences(...values: CompensationRuleReferenceBootstrap[]): CompensationRuleReferenceBootstrap {
  const practitioners = new Map<string, NonNullable<CompensationRuleReferenceBootstrap['practitioners']>[number]>();
  const services = new Map<string, NonNullable<CompensationRuleReferenceBootstrap['services']>[number]>();
  for (const value of values) {
    for (const entry of value.practitioners ?? []) practitioners.set(entry.practitionerPublicId, entry);
    for (const entry of value.services ?? []) services.set(entry.servicePublicId, entry);
  }
  return {
    practitioners: [...practitioners.values()],
    services: [...services.values()],
  };
}

function commandInput(
  context: RuleContext,
  execution: CompensationRuleRouteExecution,
): CompensationRuleDefinitionInput {
  return {
    ...context.snapshot,
    tenantId: context.tenantId,
    rulePublicId: context.rulePublicId,
    sourceType: context.sourceType,
    sourcePublicId: context.sourcePublicId,
    sourceTable: context.sourceTable,
    sourceEvidenceSha256: context.snapshot.sourceEvidenceSha256,
    occurredAtUtc: execution.occurredAtUtc,
    businessDate: execution.businessDate,
    idempotencyKey: execution.idempotencyKey,
  };
}

export async function buildDoctorCommissionRuleContext(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourcePublicId: string;
    rule: LegacyDoctorCommissionRuleSnapshot;
    doctor: LegacyDoctorReference;
    labService?: LegacyLabServiceReference | null;
  },
): Promise<RuleContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const doctorId = positiveInteger(input.rule.doctorId, 'doctorId');
  if (input.doctor.id !== doctorId) throw new Error('doctor reference does not match the rule doctorId');
  if (!input.doctor.isActive && input.rule.isActive) throw new Error('active compensation rule requires an active doctor');

  const practitionerSourceId = String(doctorId);
  const practitionerPublicId = await mappedPublicId(db, {
    tenantId,
    entityType: 'practitioner',
    sourceType: DOCTOR_SOURCE_TYPE,
    sourcePublicId: practitionerSourceId,
  }) ?? await createDeterministicSourceId('prc', tenantId, DOCTOR_SOURCE_TYPE, practitionerSourceId);
  const practitionerEvidence = await createSourceEvidenceSha256({
    sourceType: DOCTOR_SOURCE_TYPE,
    sourcePublicId: practitionerSourceId,
    displayName: normalizeIdentityText(input.doctor.name),
    active: input.doctor.isActive,
  });

  let scopeType: 'service' | 'category' | 'all' = 'all';
  let servicePublicId: string | null = null;
  let categoryKey: string | null = null;
  const services: NonNullable<CompensationRuleReferenceBootstrap['services']> = [];
  if (input.rule.labTestId != null) {
    const labTestId = positiveInteger(input.rule.labTestId, 'labTestId');
    if (!input.labService || input.labService.id !== labTestId) {
      throw new Error('lab service reference does not match the rule labTestId');
    }
    const labSourceId = String(labTestId);
    servicePublicId = await mappedPublicId(db, {
      tenantId,
      entityType: 'service_catalog_item',
      sourceType: LAB_SERVICE_SOURCE_TYPE,
      sourcePublicId: labSourceId,
    }) ?? await createDeterministicSourceId('svc', tenantId, LAB_SERVICE_SOURCE_TYPE, labSourceId);
    const serviceEvidence = await createSourceEvidenceSha256({
      sourceType: LAB_SERVICE_SOURCE_TYPE,
      sourcePublicId: labSourceId,
      code: normalizeIdentityText(input.labService.code),
      name: normalizeIdentityText(input.labService.name),
      active: input.labService.isActive,
    });
    services.push({
      servicePublicId,
      itemKind: 'laboratory',
      canonicalCode: null,
      displayName: exact(input.labService.name, 'lab service name'),
      unitCode: 'service',
      sourceType: LAB_SERVICE_SOURCE_TYPE,
      sourcePublicId: labSourceId,
      sourceTable: 'lab_test_catalog',
      sourceEvidenceSha256: serviceEvidence,
    });
    scopeType = 'service';
  } else {
    categoryKey = normalizedCategory(input.rule.category);
    if (categoryKey) scopeType = 'category';
  }

  const rate = canonicalRate(input.rule.rateType, input.rule.rateValue);
  const protectedRateValue = canonicalProtectedRate(input.rule, rate);
  const practitionerRole = canonicalRole(input.rule.incentiveType);
  const calculationBasis = (
    input.rule.serviceType !== 'consultation_fee'
    && (practitionerRole === 'referring' || practitionerRole === 'prescribing')
  ) ? 'remaining_after_performer' : 'net_after_discount';
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: DOCTOR_RULE_SOURCE_TYPE,
    sourcePublicId,
    doctorId,
    serviceType: input.rule.serviceType,
    labTestId: input.rule.labTestId,
    category: categoryKey,
    incentiveType: input.rule.incentiveType,
    rateType: input.rule.rateType,
    rateValue: input.rule.rateValue,
    waiverPolicy: input.rule.waiverPolicy,
    protectedRateValue,
    effectiveFrom: input.rule.effectiveFrom,
    effectiveTo: input.rule.effectiveTo,
    active: input.rule.isActive,
  });
  const rulePublicId = await createDeterministicSourceId(
    'comprule',
    tenantId,
    DOCTOR_RULE_SOURCE_TYPE,
    sourcePublicId,
  );

  return {
    tenantId,
    rulePublicId,
    sourceType: DOCTOR_RULE_SOURCE_TYPE,
    sourcePublicId,
    sourceTable: 'doctor_commission_rules',
    snapshot: {
      scopeType,
      servicePublicId,
      categoryKey,
      practitionerPublicId,
      practitionerRole,
      accrualStage: 'commission',
      rateType: rate.rateType,
      rateValue: rate.rateValue,
      waiverPolicy: input.rule.waiverPolicy,
      protectedRateValue,
      calculationBasis,
      discountTreatment: 'deduct',
      taxTreatment: 'exclude',
      minimumMinor: 0,
      capMinor: null,
      priority: 20,
      effectiveFrom: input.rule.effectiveFrom,
      effectiveTo: input.rule.effectiveTo,
      status: input.rule.isActive ? 'active' : 'inactive',
      sourceEvidenceSha256,
    },
    references: {
      practitioners: [{
        practitionerPublicId,
        displayName: exact(input.doctor.name, 'doctor name'),
        practitionerKind: 'internal',
        sourceType: DOCTOR_SOURCE_TYPE,
        sourcePublicId: practitionerSourceId,
        sourceTable: 'doctors',
        sourceEvidenceSha256: practitionerEvidence,
      }],
      services,
    },
  };
}

export async function buildDiagnosticPerformerRuleContext(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    rule: LegacyDiagnosticPerformerRuleSnapshot;
    service: LegacyDiagnosticServiceReference;
  },
): Promise<RuleContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const serviceItemId = positiveInteger(input.rule.serviceItemId, 'serviceItemId');
  if (input.service.id !== serviceItemId) throw new Error('diagnostic service reference does not match serviceItemId');
  const sourcePublicId = String(serviceItemId);
  const servicePublicId = await mappedPublicId(db, {
    tenantId,
    entityType: 'service_catalog_item',
    sourceType: BILLING_SERVICE_SOURCE_TYPE,
    sourcePublicId,
  }) ?? await createDeterministicSourceId('svc', tenantId, BILLING_SERVICE_SOURCE_TYPE, sourcePublicId);
  const serviceEvidence = await createSourceEvidenceSha256({
    sourceType: BILLING_SERVICE_SOURCE_TYPE,
    sourcePublicId,
    code: normalizeIdentityText(input.service.itemCode),
    name: normalizeIdentityText(input.service.itemName),
    diagnosticKind: input.service.diagnosticKind,
    active: input.service.isActive,
  });
  const rate = canonicalRate(input.rule.rateType, input.rule.rateValue);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: DIAGNOSTIC_RULE_SOURCE_TYPE,
    sourcePublicId,
    diagnosticKind: input.rule.diagnosticKind,
    rateType: input.rule.rateType,
    rateValue: input.rule.rateValue,
    effectiveFrom: input.rule.effectiveFrom,
    effectiveTo: input.rule.effectiveTo,
    active: input.rule.isActive,
  });
  const rulePublicId = await createDeterministicSourceId(
    'comprule',
    tenantId,
    DIAGNOSTIC_RULE_SOURCE_TYPE,
    sourcePublicId,
  );

  return {
    tenantId,
    rulePublicId,
    sourceType: DIAGNOSTIC_RULE_SOURCE_TYPE,
    sourcePublicId,
    sourceTable: 'diagnostic_performer_payout_rules',
    snapshot: {
      scopeType: 'service',
      servicePublicId,
      categoryKey: null,
      practitionerPublicId: null,
      practitionerRole: 'performing',
      accrualStage: 'performer_reserve',
      rateType: rate.rateType,
      rateValue: rate.rateValue,
      waiverPolicy: 'full_earned',
      protectedRateValue: 0,
      calculationBasis: 'net_after_discount',
      discountTreatment: 'deduct',
      taxTreatment: 'exclude',
      minimumMinor: 0,
      capMinor: null,
      priority: 10,
      effectiveFrom: input.rule.effectiveFrom,
      effectiveTo: input.rule.effectiveTo,
      status: input.rule.isActive ? 'active' : 'inactive',
      sourceEvidenceSha256,
    },
    references: {
      practitioners: [],
      services: [{
        servicePublicId,
        itemKind: input.service.diagnosticKind === 'lab' ? 'laboratory' : 'radiology',
        canonicalCode: null,
        displayName: exact(input.service.itemName, 'diagnostic service itemName'),
        unitCode: 'service',
        sourceType: BILLING_SERVICE_SOURCE_TYPE,
        sourcePublicId,
        sourceTable: 'billing_service_items',
        sourceEvidenceSha256: serviceEvidence,
      }],
    },
  };
}

export async function createRouteCompensationRule(
  db: CanonicalBatchDatabase,
  context: RuleContext,
  execution: CompensationRuleRouteExecution,
): Promise<RuleCommandResponse> {
  return createCompensationRule(db, commandInput(context, execution), {
    authoritativeStatements: execution.authoritativeStatements,
    referenceBootstrap: context.references,
  });
}

export async function replaceRouteCompensationRule(
  db: CanonicalBatchDatabase,
  currentContext: RuleContext,
  nextContext: RuleContext,
  execution: CompensationRuleRouteExecution,
): Promise<RuleCommandResponse> {
  if (
    currentContext.tenantId !== nextContext.tenantId
    || currentContext.rulePublicId !== nextContext.rulePublicId
    || currentContext.sourceType !== nextContext.sourceType
    || currentContext.sourcePublicId !== nextContext.sourcePublicId
  ) {
    throw new Error('replacement compensation rule identity changed');
  }
  const current = await currentRuleVersion(db, nextContext.tenantId, nextContext.rulePublicId);
  return replaceCompensationRule(db, {
    ...commandInput(nextContext, execution),
    expectedVersion: current?.rule_version ?? 0,
    bootstrapCurrent: current ? undefined : currentContext.snapshot,
  }, {
    authoritativeStatements: execution.authoritativeStatements,
    referenceBootstrap: current
      ? nextContext.references
      : mergeReferences(currentContext.references, nextContext.references),
  });
}

export async function retireRouteCompensationRule(
  db: CanonicalBatchDatabase,
  currentContext: RuleContext,
  execution: CompensationRuleRouteExecution & { reasonCode: string },
): Promise<RuleCommandResponse> {
  const current = await currentRuleVersion(db, currentContext.tenantId, currentContext.rulePublicId);
  return retireCompensationRule(db, {
    tenantId: currentContext.tenantId,
    rulePublicId: currentContext.rulePublicId,
    expectedVersion: current?.rule_version ?? 0,
    reasonCode: exact(execution.reasonCode, 'reasonCode'),
    sourceType: currentContext.sourceType,
    sourcePublicId: currentContext.sourcePublicId,
    sourceTable: currentContext.sourceTable,
    sourceEvidenceSha256: currentContext.snapshot.sourceEvidenceSha256,
    occurredAtUtc: execution.occurredAtUtc,
    businessDate: execution.businessDate,
    idempotencyKey: execution.idempotencyKey,
    bootstrapCurrent: current ? undefined : currentContext.snapshot,
  }, {
    authoritativeStatements: execution.authoritativeStatements,
    referenceBootstrap: current ? undefined : currentContext.references,
  });
}
