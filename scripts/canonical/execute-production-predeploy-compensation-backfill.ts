import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLegacyLiveInvoiceSourceLineId } from '../../src/lib/canonical/live-invoice-line-identity';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL = 'CDB101_PREDEPLOY_COMPENSATION_BACKFILL_20260722';
const TENANT_ID = '100';
const INVOICE_NO = 'INV-A-2026-000037';
const SOURCE_KEY = 'bill:6917:line:1:doctor_visit:101:doctor:101:rule:2:performing';
const ISSUE_PUBLIC_ID = 'canissue_2CR9CW4BCSBDA5H7XFA5QBVAKK';
const ISSUE_CAUSE_HASH = 'dc137a3ec7e700b200bfa054f1eecf70dabde24c915139cdf7a615fe20c26b7b';

export interface PredeployCompensationState extends Record<string, unknown> {
  legacy_accrual_id: number;
  doctor_id: number;
  patient_id: number;
  bill_id: number;
  source_type: string;
  incentive_type: string;
  gross_amount: number;
  commission_rule_id: number;
  commission_rate_bps: number;
  commission_flat_amount: number;
  commission_amount: number;
  earned_commission_amount: number;
  doctor_waiver_amount: number;
  payable_commission_amount: number;
  paid_amount: number;
  balance_amount: number;
  legacy_status: string;
  accrued_date: string;
  created_by: number | null;
  legacy_created_at: string;
  legacy_updated_at: string;
  commission_base_amount: number;
  performer_reserve_amount: number;
  canonical_source_key: string;
  doctor_name: string;
  doctor_specialty: string | null;
  doctor_department: string | null;
  doctor_registration_number: string | null;
  doctor_user_id: number | null;
  doctor_is_active: number;
  doctor_created_at: string | null;
  doctor_updated_at: string | null;
  rule_service_type: string;
  rule_incentive_type: string;
  rule_lab_test_id: number | null;
  rule_category: string | null;
  rule_rate_type: string;
  rule_rate_value: number;
  rule_effective_from: string | null;
  rule_effective_to: string | null;
  rule_is_active: number;
  rule_created_at: string | null;
  rule_updated_at: string | null;
  invoice_public_id: string;
  invoice_line_public_id: string;
  invoice_line_amount_minor: number;
  invoice_status: string;
  practitioner_public_id: string;
  practitioner_kind: string;
  practitioner_display_name: string;
  practitioner_status: string;
  practitioner_mapping_public_id: string;
  practitioner_mapping_evidence_sha256: string;
  rule_public_id: string;
  rule_version: number;
  canonical_rule_practitioner_public_id: string;
  canonical_rule_role: string;
  canonical_rule_stage: string;
  canonical_rule_rate_type: string;
  canonical_rule_rate_value: number;
  canonical_rule_calculation_basis: string;
  canonical_rule_status: string;
  canonical_rule_evidence_sha256: string;
  rule_mapping_public_id: string;
  rule_mapping_evidence_sha256: string;
  accrual_public_id: string | null;
  accrual_invoice_public_id: string | null;
  accrual_invoice_line_public_id: string | null;
  accrual_practitioner_public_id: string | null;
  accrual_rule_public_id: string | null;
  accrual_rule_version: number | null;
  accrual_gross_minor: number | null;
  accrual_discount_minor: number | null;
  accrual_eligible_base_minor: number | null;
  accrual_earned_minor: number | null;
  accrual_adjusted_minor: number | null;
  accrual_payable_minor: number | null;
  accrual_status: string | null;
  accrual_source_evidence_sha256: string | null;
  accrual_mapping_count: number;
  accrual_mapping_public_id: string | null;
  accrual_mapping_evidence_sha256: string | null;
  issue_public_id: string;
  issue_status: string;
  issue_occurrence_count: number;
  issue_entity_public_id: string;
  issue_source_public_id: string;
  issue_cause_message_hash: string | null;
  issue_first_seen_at_utc: string;
  issue_last_seen_at_utc: string;
  issue_resolved_at_utc: string | null;
  issue_resolution_code: string | null;
}

export interface PredeployCompensationGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readState(): Promise<PredeployCompensationState>;
  writeRepair(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

export interface PredeployCompensationExpectedState {
  invoicePublicId: string;
  invoiceLinePublicId: string;
  practitionerPublicId: string;
  practitionerEvidenceSha256: string;
  rulePublicId: string;
  ruleEvidenceSha256: string;
  accrualPublicId: string;
  accrualEvidenceSha256: string;
  accruedAtUtc: string;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function localTimestampToUtc(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return toUtcIso(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}+06:00`);
}

function validateImmutableSource(row: PredeployCompensationState): void {
  const exact = (
    Number(row.legacy_accrual_id) === 2637
    && Number(row.doctor_id) === 101
    && Number(row.patient_id) === 1995
    && Number(row.bill_id) === 6917
    && row.source_type === 'consultation_fee'
    && row.incentive_type === 'performer'
    && Number(row.gross_amount) === 500
    && Number(row.commission_rule_id) === 2
    && Number(row.commission_rate_bps) === 10000
    && Number(row.commission_flat_amount) === 0
    && Number(row.commission_amount) === 400
    && Number(row.earned_commission_amount) === 400
    && Number(row.doctor_waiver_amount) === 0
    && Number(row.payable_commission_amount) === 400
    && Number(row.paid_amount) === 0
    && Number(row.balance_amount) === 400
    && row.legacy_status === 'accrued'
    && row.accrued_date === '2026-07-22'
    && Number(row.created_by) === 103
    && row.legacy_created_at === '2026-07-22 17:07:56'
    && row.legacy_updated_at === '2026-07-22 17:07:56'
    && Number(row.commission_base_amount) === 400
    && Number(row.performer_reserve_amount) === 0
    && row.canonical_source_key === SOURCE_KEY
    && row.doctor_name === 'Dr. Aminul Islam'
    && row.doctor_specialty === 'General Medicine'
    && row.doctor_department === null
    && row.doctor_registration_number === 'A-52341'
    && Number(row.doctor_user_id) === 118
    && Number(row.doctor_is_active) === 1
    && row.doctor_created_at === '2026-03-12 08:47:51'
    && row.doctor_updated_at === '2026-07-03 17:57:05'
    && row.rule_service_type === 'consultation_fee'
    && row.rule_incentive_type === 'performer'
    && row.rule_lab_test_id === null
    && row.rule_category === null
    && row.rule_rate_type === 'percent'
    && Number(row.rule_rate_value) === 10000
    && row.rule_effective_from === '2026-05-08'
    && row.rule_effective_to === null
    && Number(row.rule_is_active) === 1
    && row.rule_created_at === '2026-05-08 23:28:51'
    && row.rule_updated_at === '2026-05-08 23:28:51'
    && Number(row.invoice_line_amount_minor) === 50000
    && row.invoice_status === 'posted'
    && row.practitioner_kind === 'internal'
    && row.practitioner_display_name === 'Dr. Aminul Islam'
    && row.practitioner_status === 'active'
    && Number(row.rule_version) === 1
    && row.canonical_rule_role === 'performing'
    && row.canonical_rule_stage === 'commission'
    && row.canonical_rule_rate_type === 'basis_points'
    && Number(row.canonical_rule_rate_value) === 10000
    && row.canonical_rule_calculation_basis === 'net_after_discount'
    && row.canonical_rule_status === 'active'
    && row.issue_public_id === ISSUE_PUBLIC_ID
    && Number(row.issue_occurrence_count) === 1
    && row.issue_entity_public_id === 'doctor-compensation.accrue'
    && row.issue_source_public_id === 'doctor-compensation.accrue'
    && row.issue_cause_message_hash === ISSUE_CAUSE_HASH
    && row.issue_first_seen_at_utc === '2026-07-22T11:07:56.900Z'
    && row.issue_last_seen_at_utc === '2026-07-22T11:07:56.900Z'
  );
  if (!exact) throw new Error('Pre-deploy compensation source state changed');
}

export async function buildPredeployCompensationExpectedState(
  row: PredeployCompensationState,
): Promise<PredeployCompensationExpectedState> {
  validateImmutableSource(row);
  const invoicePublicId = await createDeterministicSourceId('inv', TENANT_ID, 'legacy_live_bill', INVOICE_NO);
  const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
    lineNumber: 1,
    itemCategory: 'doctor_visit',
    referenceId: 101,
  });
  const invoiceLinePublicId = await createDeterministicSourceId(
    'invline',
    TENANT_ID,
    'legacy_live_bill_line',
    `${INVOICE_NO}:${sourceLineId}`,
  );
  const practitionerPublicId = await createDeterministicSourceId('prc', TENANT_ID, 'legacy_doctor', '101');
  const rulePublicId = await createDeterministicSourceId('comprule', TENANT_ID, 'legacy_doctor_commission_rule', '2');
  const accrualPublicId = await createDeterministicSourceId(
    'compacc',
    TENANT_ID,
    'legacy_doctor_commission_accrual',
    SOURCE_KEY,
  );
  const practitionerEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_doctor',
    sourcePublicId: '101',
    displayName: normalizeIdentityText(row.doctor_name),
    specialty: normalizeIdentityText(row.doctor_specialty),
    department: normalizeIdentityText(row.doctor_department),
    registrationNumber: normalizeRegistrationNumber(row.doctor_registration_number),
    userId: row.doctor_user_id,
    isActive: true,
  });
  const ruleEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_doctor_commission_rule',
    sourcePublicId: '2',
    doctorId: 101,
    serviceType: 'consultation_fee',
    labTestId: null,
    category: null,
    incentiveType: 'performer',
    rateType: 'percent',
    rateValue: 10000,
    effectiveFrom: '2026-05-08',
    effectiveTo: null,
    isActive: 1,
    createdAt: '2026-05-08 23:28:51',
    updatedAt: '2026-05-08 23:28:51',
  });
  const accrualEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_doctor_commission_accrual',
    sourcePublicId: SOURCE_KEY,
    doctorId: 101,
    billId: 6917,
    legacySourceType: 'consultation_fee',
    incentiveType: 'performer',
    grossAmountMajor: 500,
    commissionRuleId: 2,
    commissionRateBps: 10000,
    commissionFlatAmountMajor: 0,
    commissionAmountMajor: 400,
    earnedAmountMajor: 400,
    waiverAmountMajor: 0,
    payableAmountMajor: 400,
    accruedDate: '2026-07-22',
    commissionBaseAmountMajor: 400,
    performerReserveAmountMajor: 0,
  });
  return {
    invoicePublicId,
    invoiceLinePublicId,
    practitionerPublicId,
    practitionerEvidenceSha256,
    rulePublicId,
    ruleEvidenceSha256,
    accrualPublicId,
    accrualEvidenceSha256,
    accruedAtUtc: localTimestampToUtc(row.legacy_created_at),
  };
}

function legacySourcePredicate(expected: PredeployCompensationExpectedState): string {
  return `CAST(a.tenant_id AS TEXT)='100' AND a.id=2637 AND a.doctor_id=101
  AND a.patient_id=1995 AND a.bill_id=6917 AND a.source_type='consultation_fee'
  AND a.incentive_type='performer' AND a.gross_amount=500 AND a.commission_rule_id=2
  AND a.commission_rate_bps=10000 AND a.commission_flat_amount=0
  AND a.commission_amount=400 AND a.earned_commission_amount=400
  AND a.doctor_waiver_amount=0 AND a.payable_commission_amount=400
  AND a.paid_amount=0 AND a.balance_amount=400 AND a.status='accrued'
  AND a.accrued_date='2026-07-22' AND a.created_by=103
  AND a.created_at='2026-07-22 17:07:56' AND a.updated_at='2026-07-22 17:07:56'
  AND a.commission_base_amount=400 AND a.performer_reserve_amount=0
  AND a.canonical_source_key=${sqlString(SOURCE_KEY)}
  AND EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.tenant_id='100'
    AND ci.invoice_public_id=${sqlString(expected.invoicePublicId)}
    AND ci.invoice_number='INV-A-2026-000037' AND ci.status='posted')
  AND EXISTS (SELECT 1 FROM canonical_invoice_lines cil WHERE cil.tenant_id='100'
    AND cil.invoice_public_id=${sqlString(expected.invoicePublicId)}
    AND cil.line_public_id=${sqlString(expected.invoiceLinePublicId)}
    AND cil.adjustment_code='LEGACY_DOCTOR_VISIT' AND cil.line_amount_minor=50000)
  AND EXISTS (SELECT 1 FROM canonical_practitioners cp WHERE cp.tenant_id='100'
    AND cp.practitioner_public_id=${sqlString(expected.practitionerPublicId)}
    AND cp.practitioner_kind='internal' AND cp.display_name='Dr. Aminul Islam' AND cp.status='active')
  AND EXISTS (SELECT 1 FROM canonical_source_mappings pm WHERE pm.tenant_id='100'
    AND pm.entity_type='practitioner' AND pm.source_type='legacy_doctor' AND pm.source_public_id='101'
    AND pm.canonical_public_id=${sqlString(expected.practitionerPublicId)}
    AND pm.mapping_status='mapped' AND pm.evidence_sha256=${sqlString(expected.practitionerEvidenceSha256)})
  AND EXISTS (SELECT 1 FROM canonical_compensation_rules cr WHERE cr.tenant_id='100'
    AND cr.rule_public_id=${sqlString(expected.rulePublicId)} AND cr.rule_version=1
    AND cr.practitioner_public_id=${sqlString(expected.practitionerPublicId)}
    AND cr.practitioner_role='performing' AND cr.accrual_stage='commission'
    AND cr.rate_type='basis_points' AND cr.rate_value=10000
    AND cr.calculation_basis='net_after_discount' AND cr.status='active'
    AND cr.source_evidence_sha256=${sqlString(expected.ruleEvidenceSha256)})
  AND EXISTS (SELECT 1 FROM canonical_source_mappings rm WHERE rm.tenant_id='100'
    AND rm.entity_type='compensation_rule' AND rm.source_type='legacy_doctor_commission_rule'
    AND rm.source_public_id='2' AND rm.canonical_public_id=${sqlString(expected.rulePublicId)}
    AND rm.mapping_status='mapped' AND rm.evidence_sha256=${sqlString(expected.ruleEvidenceSha256)})`;
}

export async function buildPredeployCompensationRepairSql(
  row: PredeployCompensationState,
  nowUtc: string = new Date().toISOString(),
): Promise<string> {
  const expected = await buildPredeployCompensationExpectedState(row);
  const normalizedNow = toUtcIso(nowUtc);
  const predicate = legacySourcePredicate(expected);
  return `INSERT INTO canonical_compensation_accruals (
  tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,service_event_public_id,
  practitioner_public_id,practitioner_role,accrual_stage,rule_public_id,rule_version,
  calculation_basis,rate_type,rate_value,currency_code,gross_minor,discount_minor,tax_minor,
  performer_reserve_minor,eligible_base_minor,earned_minor,adjusted_minor,settled_minor,
  payable_minor,status,accrued_at_utc,business_date,payable_projection_guard,
  source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100',${sqlString(expected.accrualPublicId)},${sqlString(expected.invoicePublicId)},
       ${sqlString(expected.invoiceLinePublicId)},NULL,${sqlString(expected.practitionerPublicId)},
       'performing','commission',${sqlString(expected.rulePublicId)},1,
       'net_after_discount','basis_points',10000,'BDT',50000,10000,0,0,40000,40000,0,0,
       40000,'accrued',${sqlString(expected.accruedAtUtc)},'2026-07-22',1,
       ${sqlString(expected.accrualEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
FROM doctor_commission_accruals a
WHERE ${predicate}
  AND NOT EXISTS (SELECT 1 FROM canonical_compensation_accruals ca
    WHERE ca.tenant_id='100' AND ca.accrual_public_id=${sqlString(expected.accrualPublicId)});
INSERT INTO canonical_source_mappings (
  tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
  mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
)
SELECT '100','compensation_accrual',${sqlString(expected.accrualPublicId)},
       'legacy_doctor_commission_accrual',${sqlString(SOURCE_KEY)},'doctor_commission_accruals',
       'mapped',1,${sqlString(expected.accrualEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
FROM doctor_commission_accruals a
WHERE ${predicate}
  AND EXISTS (SELECT 1 FROM canonical_compensation_accruals ca
    WHERE ca.tenant_id='100' AND ca.accrual_public_id=${sqlString(expected.accrualPublicId)})
  AND NOT EXISTS (SELECT 1 FROM canonical_source_mappings m
    WHERE m.tenant_id='100' AND m.entity_type='compensation_accrual'
      AND m.source_type='legacy_doctor_commission_accrual' AND m.source_public_id=${sqlString(SOURCE_KEY)});
UPDATE canonical_processing_issues
SET status='resolved',resolved_at_utc=${sqlString(normalizedNow)},
    resolved_by_public_id='system:targeted-canonical-backfill',
    resolution_code='TARGETED_CANONICAL_BACKFILL',updated_at_utc=${sqlString(normalizedNow)}
WHERE tenant_id='100' AND issue_public_id=${sqlString(ISSUE_PUBLIC_ID)}
  AND issue_type='financial_shadow_write' AND issue_code='CANONICAL_SHADOW_WRITE_FAILED'
  AND entity_type='financial_boundary' AND entity_public_id='doctor-compensation.accrue'
  AND source_type='runtime_shadow_write' AND source_public_id='doctor-compensation.accrue'
  AND severity='error' AND status='open' AND occurrence_count=1
  AND first_seen_at_utc='2026-07-22T11:07:56.900Z'
  AND last_seen_at_utc='2026-07-22T11:07:56.900Z'
  AND json_extract(details_json,'$.boundary')='doctor-compensation.accrue'
  AND json_extract(details_json,'$.causeMessageHash')=${sqlString(ISSUE_CAUSE_HASH)}
  AND EXISTS (SELECT 1 FROM canonical_compensation_accruals ca
    WHERE ca.tenant_id='100' AND ca.accrual_public_id=${sqlString(expected.accrualPublicId)}
      AND ca.source_evidence_sha256=${sqlString(expected.accrualEvidenceSha256)})
  AND EXISTS (SELECT 1 FROM canonical_source_mappings m
    WHERE m.tenant_id='100' AND m.entity_type='compensation_accrual'
      AND m.source_type='legacy_doctor_commission_accrual' AND m.source_public_id=${sqlString(SOURCE_KEY)}
      AND m.canonical_public_id=${sqlString(expected.accrualPublicId)}
      AND m.evidence_sha256=${sqlString(expected.accrualEvidenceSha256)});`;
}

function canonicalStateCount(row: PredeployCompensationState): number {
  return [row.accrual_public_id, row.accrual_mapping_public_id].filter(Boolean).length
    + Number(row.accrual_mapping_count ?? 0)
    + (row.issue_status === 'resolved' ? 1 : 0);
}

function validateDependencies(
  row: PredeployCompensationState,
  expected: PredeployCompensationExpectedState,
): void {
  const exact = (
    row.invoice_public_id === expected.invoicePublicId
    && row.invoice_line_public_id === expected.invoiceLinePublicId
    && row.practitioner_public_id === expected.practitionerPublicId
    && row.practitioner_mapping_public_id === expected.practitionerPublicId
    && row.practitioner_mapping_evidence_sha256 === expected.practitionerEvidenceSha256
    && row.rule_public_id === expected.rulePublicId
    && row.canonical_rule_practitioner_public_id === expected.practitionerPublicId
    && row.canonical_rule_evidence_sha256 === expected.ruleEvidenceSha256
    && row.rule_mapping_public_id === expected.rulePublicId
    && row.rule_mapping_evidence_sha256 === expected.ruleEvidenceSha256
  );
  if (!exact) throw new Error('Pre-deploy compensation canonical dependency state changed');
}

function validateCompleteState(
  row: PredeployCompensationState,
  expected: PredeployCompensationExpectedState,
): void {
  validateDependencies(row, expected);
  const exact = (
    row.accrual_public_id === expected.accrualPublicId
    && row.accrual_invoice_public_id === expected.invoicePublicId
    && row.accrual_invoice_line_public_id === expected.invoiceLinePublicId
    && row.accrual_practitioner_public_id === expected.practitionerPublicId
    && row.accrual_rule_public_id === expected.rulePublicId
    && Number(row.accrual_rule_version) === 1
    && Number(row.accrual_gross_minor) === 50000
    && Number(row.accrual_discount_minor) === 10000
    && Number(row.accrual_eligible_base_minor) === 40000
    && Number(row.accrual_earned_minor) === 40000
    && Number(row.accrual_adjusted_minor) === 0
    && Number(row.accrual_payable_minor) === 40000
    && row.accrual_status === 'accrued'
    && row.accrual_source_evidence_sha256 === expected.accrualEvidenceSha256
    && Number(row.accrual_mapping_count) === 1
    && row.accrual_mapping_public_id === expected.accrualPublicId
    && row.accrual_mapping_evidence_sha256 === expected.accrualEvidenceSha256
    && row.issue_status === 'resolved'
    && Boolean(row.issue_resolved_at_utc)
    && row.issue_resolution_code === 'TARGETED_CANONICAL_BACKFILL'
  );
  if (!exact) throw new Error('Pre-deploy compensation canonical post-state verification failed');
}

export async function executePredeployCompensationBackfill(
  input: { approval: string; execute: boolean },
  gateway: PredeployCompensationGateway,
): Promise<{
  repaired: true;
  execution: 'created' | 'verified_existing';
  canonicalRowsCreated: 2;
  issuesResolved: 1;
  sourceKey: typeof SOURCE_KEY;
  writeMeta: { changes: number; rowsWritten: number } | null;
}> {
  if (!input.execute) throw new Error('Explicit execute switch is required');
  if (input.approval !== PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL) {
    throw new Error('Pre-deploy compensation backfill approval mismatch');
  }
  const identity = await gateway.readDatabaseIdentity();
  if (identity.uuid !== CDB101_PRODUCTION_DATABASE_ID || identity.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production database identity mismatch');
  }
  const before = await gateway.readState();
  validateImmutableSource(before);
  const expected = await buildPredeployCompensationExpectedState(before);
  validateDependencies(before, expected);
  const currentCount = canonicalStateCount(before);
  if (currentCount > 0) {
    try {
      validateCompleteState(before, expected);
    } catch (cause) {
      throw new Error('Pre-deploy compensation has partial canonical state', { cause });
    }
    return {
      repaired: true,
      execution: 'verified_existing',
      canonicalRowsCreated: 2,
      issuesResolved: 1,
      sourceKey: SOURCE_KEY,
      writeMeta: null,
    };
  }
  if (before.issue_status !== 'open' || before.issue_resolved_at_utc !== null || before.issue_resolution_code !== null) {
    throw new Error('Pre-deploy compensation shadow issue state changed');
  }
  const writeMeta = await gateway.writeRepair(await buildPredeployCompensationRepairSql(before));
  const after = await gateway.readState();
  validateImmutableSource(after);
  validateCompleteState(after, expected);
  return {
    repaired: true,
    execution: 'created',
    canonicalRowsCreated: 2,
    issuesResolved: 1,
    sourceKey: SOURCE_KEY,
    writeMeta,
  };
}

export const PREDEPLOY_COMPENSATION_READ_SQL = `
SELECT
  a.id AS legacy_accrual_id,a.doctor_id,a.patient_id,a.bill_id,a.source_type,a.incentive_type,
  a.gross_amount,a.commission_rule_id,a.commission_rate_bps,a.commission_flat_amount,
  a.commission_amount,a.earned_commission_amount,a.doctor_waiver_amount,
  a.payable_commission_amount,a.paid_amount,a.balance_amount,a.status AS legacy_status,
  a.accrued_date,a.created_by,a.created_at AS legacy_created_at,a.updated_at AS legacy_updated_at,
  a.commission_base_amount,a.performer_reserve_amount,a.canonical_source_key,
  d.name AS doctor_name,d.specialty AS doctor_specialty,d.department AS doctor_department,
  d.bmdc_reg_no AS doctor_registration_number,d.user_id AS doctor_user_id,
  d.is_active AS doctor_is_active,d.created_at AS doctor_created_at,d.updated_at AS doctor_updated_at,
  r.service_type AS rule_service_type,r.incentive_type AS rule_incentive_type,
  r.lab_test_id AS rule_lab_test_id,r.category AS rule_category,r.rate_type AS rule_rate_type,
  r.rate_value AS rule_rate_value,r.effective_from AS rule_effective_from,
  r.effective_to AS rule_effective_to,r.is_active AS rule_is_active,
  r.created_at AS rule_created_at,r.updated_at AS rule_updated_at,
  ci.invoice_public_id,cil.line_public_id AS invoice_line_public_id,
  cil.line_amount_minor AS invoice_line_amount_minor,ci.status AS invoice_status,
  cp.practitioner_public_id,cp.practitioner_kind,cp.display_name AS practitioner_display_name,
  cp.status AS practitioner_status,pm.canonical_public_id AS practitioner_mapping_public_id,
  pm.evidence_sha256 AS practitioner_mapping_evidence_sha256,
  cr.rule_public_id,cr.rule_version,cr.practitioner_public_id AS canonical_rule_practitioner_public_id,
  cr.practitioner_role AS canonical_rule_role,cr.accrual_stage AS canonical_rule_stage,
  cr.rate_type AS canonical_rule_rate_type,cr.rate_value AS canonical_rule_rate_value,
  cr.calculation_basis AS canonical_rule_calculation_basis,cr.status AS canonical_rule_status,
  cr.source_evidence_sha256 AS canonical_rule_evidence_sha256,
  rm.canonical_public_id AS rule_mapping_public_id,rm.evidence_sha256 AS rule_mapping_evidence_sha256,
  ca.accrual_public_id,ca.invoice_public_id AS accrual_invoice_public_id,
  ca.invoice_line_public_id AS accrual_invoice_line_public_id,
  ca.practitioner_public_id AS accrual_practitioner_public_id,
  ca.rule_public_id AS accrual_rule_public_id,ca.rule_version AS accrual_rule_version,
  ca.gross_minor AS accrual_gross_minor,ca.discount_minor AS accrual_discount_minor,
  ca.eligible_base_minor AS accrual_eligible_base_minor,ca.earned_minor AS accrual_earned_minor,
  ca.adjusted_minor AS accrual_adjusted_minor,ca.payable_minor AS accrual_payable_minor,
  ca.status AS accrual_status,ca.source_evidence_sha256 AS accrual_source_evidence_sha256,
  (SELECT COUNT(*) FROM canonical_source_mappings am2 WHERE am2.tenant_id='100'
    AND am2.entity_type='compensation_accrual' AND am2.source_type='legacy_doctor_commission_accrual'
    AND am2.source_public_id=a.canonical_source_key AND am2.mapping_status='mapped') AS accrual_mapping_count,
  am.canonical_public_id AS accrual_mapping_public_id,
  am.evidence_sha256 AS accrual_mapping_evidence_sha256,
  pi.issue_public_id,pi.status AS issue_status,pi.occurrence_count AS issue_occurrence_count,
  pi.entity_public_id AS issue_entity_public_id,pi.source_public_id AS issue_source_public_id,
  json_extract(pi.details_json,'$.causeMessageHash') AS issue_cause_message_hash,
  pi.first_seen_at_utc AS issue_first_seen_at_utc,pi.last_seen_at_utc AS issue_last_seen_at_utc,
  pi.resolved_at_utc AS issue_resolved_at_utc,pi.resolution_code AS issue_resolution_code
FROM doctor_commission_accruals a
JOIN doctors d ON CAST(d.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND d.id=a.doctor_id
JOIN doctor_commission_rules r ON CAST(r.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT) AND r.id=a.commission_rule_id
JOIN canonical_invoices ci ON ci.tenant_id='100' AND ci.invoice_number='INV-A-2026-000037'
JOIN canonical_invoice_lines cil ON cil.tenant_id=ci.tenant_id AND cil.invoice_public_id=ci.invoice_public_id
  AND cil.adjustment_code='LEGACY_DOCTOR_VISIT'
JOIN canonical_source_mappings pm ON pm.tenant_id='100' AND pm.entity_type='practitioner'
  AND pm.source_type='legacy_doctor' AND pm.source_public_id='101' AND pm.mapping_status='mapped'
JOIN canonical_practitioners cp ON cp.tenant_id=pm.tenant_id AND cp.practitioner_public_id=pm.canonical_public_id
JOIN canonical_source_mappings rm ON rm.tenant_id='100' AND rm.entity_type='compensation_rule'
  AND rm.source_type='legacy_doctor_commission_rule' AND rm.source_public_id='2' AND rm.mapping_status='mapped'
JOIN canonical_compensation_rules cr ON cr.tenant_id=rm.tenant_id AND cr.rule_public_id=rm.canonical_public_id
  AND cr.rule_version=1
LEFT JOIN canonical_compensation_accruals ca ON ca.tenant_id='100'
  AND ca.invoice_public_id=ci.invoice_public_id AND ca.invoice_line_public_id=cil.line_public_id
  AND ca.practitioner_public_id=cp.practitioner_public_id AND ca.rule_public_id=cr.rule_public_id
  AND ca.rule_version=cr.rule_version AND ca.practitioner_role='performing'
LEFT JOIN canonical_source_mappings am ON am.tenant_id='100' AND am.entity_type='compensation_accrual'
  AND am.source_type='legacy_doctor_commission_accrual' AND am.source_public_id=a.canonical_source_key
  AND am.mapping_status='mapped'
JOIN canonical_processing_issues pi ON pi.tenant_id='100'
  AND pi.issue_public_id='canissue_2CR9CW4BCSBDA5H7XFA5QBVAKK'
WHERE CAST(a.tenant_id AS TEXT)='100' AND a.id=2637;
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

export function createProductionGateway(runner: Runner = defaultRunner): PredeployCompensationGateway {
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
        '--env', 'production', '--remote', '--json', '--command', PREDEPLOY_COMPENSATION_READ_SQL,
      ], 'pre-deploy compensation read');
      const rows = envelopes(result.stdout).flatMap((row) => row.results ?? []);
      if (rows.length !== 1) throw new Error('Pre-deploy compensation source query did not return exactly one row');
      return rows[0] as PredeployCompensationState;
    },
    async writeRepair(sql: string) {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--yes', '--command', sql,
      ], 'pre-deploy compensation write');
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
    throw new Error('Pre-deploy compensation receipt must remain outside repository');
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
  if (existsSync(output)) throw new Error('Pre-deploy compensation receipt already exists');
  const result = await executePredeployCompensationBackfill({
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
