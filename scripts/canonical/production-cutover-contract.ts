import { createHash } from 'node:crypto';

export const CDB101_PRODUCTION_DATABASE_NAME = 'hms-super-admin-production-apac';
export const CDB101_PRODUCTION_DATABASE_ID = 'c68a5360-a2c1-44cc-9e71-f21057bea102';
export const CDB101_CANARY_TENANT_ID = '100';
export const CDB101_REPORTING_FLAG_KEY = 'canonical_reporting_v1';

export const CDB101_EXPECTED_MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
] as const;

export const CDB101_REPORTING_IMPORT_TABLES = [
  'canonical_practitioners',
  'canonical_encounters',
  'canonical_encounter_admission_links',
  'canonical_bed_stays',
  'canonical_service_catalog_items',
  'canonical_service_prices',
  'canonical_service_requests',
  'canonical_service_events',
  'canonical_service_participants',
  'canonical_invoices',
  'canonical_invoice_lines',
  'canonical_payment_receipts',
  'canonical_payment_tenders',
  'canonical_payment_allocations',
  'canonical_deposits',
  'canonical_deposit_applications',
  'canonical_credit_notes',
  'canonical_refunds',
  'canonical_payment_reversals',
  'canonical_compensation_accruals',
  'canonical_migration_runs',
  'canonical_processing_issues',
  'canonical_outbox_events',
  'canonical_accounting_posting_jobs',
] as const;

export const CDB101_REQUIRED_SMOKE_SCENARIOS = [
  'canonical_reporting_status',
  'doctor_performing_card_detail',
  'doctor_referring_card_detail',
  'diagnostic_volume_billed_card_detail',
  'collections_receipt_allocation_card_detail',
  'deposit_credit_refund_reversal_contributions',
  'ipd_finance_card_detail',
  'tenant_isolation',
  'role_denial',
  'legacy_routes_unchanged',
  'canary_read_only_sql',
  'latency_and_error_rate',
] as const;

export type ReportingOwnerDecisionAuthority =
  | 'may_initiate_rollback'
  | 'may_accept_or_reject_go';

export type ReportingOwnerModel =
  | 'four_person_strict'
  | 'two_person_constrained'
  | 'single_operator_risk_accepted';

export interface ReportingTwoPersonRiskAcceptance {
  accepted: boolean;
  acceptedByOwnerId: string | null;
  acceptedAtUtc: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
  noTechnicalBackupAccepted: boolean;
  noMonitoringBackupAccepted: boolean;
  automaticAbortOnTechnicalOperatorUnavailable: boolean;
  automaticAbortOnMonitoringOwnerUnavailable: boolean;
  shadowOnlyAccepted: boolean;
  canonicalPromotionProhibited: boolean;
  workerTrafficChangeProhibited: boolean;
}

export interface ReportingSingleOperatorRiskAcceptance {
  accepted: boolean;
  acceptedByOwnerId: string | null;
  acceptedAtUtc: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
  dualRoleAccepted: boolean;
  independentObservationWaived: boolean;
  noTechnicalBackupAccepted: boolean;
  noMonitoringBackupAccepted: boolean;
  automaticAbortOnOperatorUnavailable: boolean;
  shadowOnlyAccepted: boolean;
  canonicalPromotionProhibited: boolean;
  workerTrafficChangeProhibited: boolean;
  postActivationReconciliationRequired: boolean;
}

export interface ReportingOwnerContract {
  assigned: boolean;
  ownerId: string | null;
  backupOwnerId: string | null;
  acknowledgedAtUtc: string | null;
  communicationChannelId: string | null;
  decisionAuthority: ReportingOwnerDecisionAuthority;
}

export interface ReportingForeignKeyDispositionGroup {
  childTable: string;
  parentTable: string;
  violationCount: number;
  remainingViolationCount: number;
  repairedViolationCount: number;
  waivedViolationCount: number;
  disposition: 'repair_required' | 'formal_waiver';
  ownerId: string | null;
  evidenceId: string | null;
  removalPhase: string | null;
}

export interface ReportingCutoverAuthorization {
  schemaVersion: 2 | 3 | 4;
  ownerModel?: 'two_person_constrained' | 'single_operator_risk_accepted';
  twoPersonRiskAcceptance?: ReportingTwoPersonRiskAcceptance;
  singleOperatorRiskAcceptance?: ReportingSingleOperatorRiskAcceptance;
  authorizationId: string | null;
  productionExecutionAuthorized: boolean;
  authorizedDomain: string | null;
  authorizedTenantIds: string[];
  issuedAtUtc: string | null;
  expiresAtUtc: string | null;
  maintenanceWindowStartUtc: string | null;
  maintenanceWindowEndUtc: string | null;
  productionDatabase: {
    name: string | null;
    id: string | null;
  };
  authorizationApproval: {
    ownerId: string | null;
    approvedAtUtc: string | null;
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  deployment: {
    authorized: boolean;
    candidateCommit: string | null;
    candidateWorkerVersionId: string | null;
    previousWorkerVersionId: string | null;
    buildManifestSha256: string | null;
    routeFingerprintSha256: string | null;
    activeRoutesUnchangedEvidenceId: string | null;
  };
  migrations: {
    authorized: boolean;
    approvedMigrations: string[];
    repositoryManifestSha256: string | null;
    commandId: string | null;
  };
  productionImport: {
    authorized: boolean;
    commandApproved: boolean;
    commandId: string | null;
    runnerVersion: string | null;
    bundleSha256: string | null;
    manifestSha256: string | null;
    sourceExportSha256: string | null;
    tenantIds: string[];
    allowedTables: string[];
    deterministicRunId: string | null;
    secondPassRequired: boolean;
  };
  featureFlagPlan: {
    authorized: boolean;
    commandId: string | null;
    tenantId: string | null;
    flagKey: string | null;
    domain: string | null;
    initialMode: string | null;
    expectedPreviousState: string | null;
    effectiveAtUtc: string | null;
    updatedByPublicId: string | null;
    canonicalModeAuthorized: boolean;
  };
  rollbackOwner: ReportingOwnerContract;
  observationOwner: ReportingOwnerContract;
  rollbackPolicy: {
    maxRollbackDurationMs: number | null;
    maxReopenDurationMs: number | null;
    observationGracePeriodMs: number | null;
  };
  exportEvidence: {
    captured: boolean;
    exportSha256: string | null;
    exportSizeBytes: number | null;
    timeTravelBookmarkId: string | null;
    metadataEvidenceId: string | null;
    directoryMode: string | null;
    fileMode: string | null;
  };
  maintenanceRecoveryEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  workerBuildVersionEvidence: {
    evidenceId: string | null;
    evidenceSha256: string | null;
  };
  foreignKeyDisposition: {
    evidenceId: string | null;
    evidenceSha256: string | null;
    groups: ReportingForeignKeyDispositionGroup[];
  };
  smoke: {
    planId: string | null;
    requiredScenarios: string[];
    maxP95LatencyMs: number | null;
    maxErrorRate: number | null;
  };
}

export type ReportingCutoverAuthorizationIssueCode =
  | 'CDB101_AUTHORIZATION_SCHEMA_UNSUPPORTED'
  | 'CDB101_AUTHORIZATION_ID_MISSING'
  | 'CDB101_OWNER_APPROVAL_EVIDENCE_MISSING'
  | 'CDB101_EXECUTION_AUTHORIZATION_MISSING'
  | 'CDB101_AUTHORIZED_DOMAIN_MISMATCH'
  | 'CDB101_AUTHORIZED_TENANT_SCOPE_MISMATCH'
  | 'CDB101_PRODUCTION_DATABASE_IDENTITY_MISMATCH'
  | 'CDB101_AUTHORIZATION_ISSUED_AT_INVALID'
  | 'CDB101_EXECUTION_AUTHORIZATION_EXPIRED'
  | 'CDB101_MAINTENANCE_WINDOW_INVALID'
  | 'CDB101_AUTHORIZATION_EXPIRY_INVALID'
  | 'CDB101_DEPLOYMENT_AUTHORIZATION_MISSING'
  | 'CDB101_DEPLOYMENT_VERSION_INVALID'
  | 'CDB101_DEPLOYMENT_COMMIT_INVALID'
  | 'CDB101_DEPLOYMENT_HASH_INVALID'
  | 'CDB101_ACTIVE_ROUTE_EVIDENCE_MISSING'
  | 'CDB101_MIGRATION_AUTHORIZATION_MISSING'
  | 'CDB101_MIGRATION_SCOPE_MISMATCH'
  | 'CDB101_MIGRATION_MANIFEST_HASH_INVALID'
  | 'CDB101_MIGRATION_COMMAND_ID_MISMATCH'
  | 'CDB101_PRODUCTION_IMPORT_AUTHORIZATION_MISSING'
  | 'CDB101_PRODUCTION_IMPORT_COMMAND_MISSING'
  | 'CDB101_PRODUCTION_IMPORT_SCOPE_INVALID'
  | 'CDB101_PRODUCTION_IMPORT_HASH_INVALID'
  | 'CDB101_PRODUCTION_IMPORT_COMMAND_ID_MISMATCH'
  | 'CDB101_SHADOW_FLAG_AUTHORIZATION_MISSING'
  | 'CDB101_SHADOW_FLAG_SCOPE_INVALID'
  | 'CDB101_FEATURE_FLAG_COMMAND_ID_MISMATCH'
  | 'CDB101_ROLLBACK_OWNER_MISSING'
  | 'CDB101_OBSERVATION_OWNER_MISSING'
  | 'CDB101_OWNER_IDENTITY_COLLISION'
  | 'CDB101_OWNER_MODEL_INVALID'
  | 'CDB101_TWO_PERSON_RISK_ACCEPTANCE_INVALID'
  | 'CDB101_TWO_PERSON_OWNER_CONTRACT_INVALID'
  | 'CDB101_TWO_PERSON_BACKUP_PROHIBITED'
  | 'CDB101_TWO_PERSON_SCOPE_PROHIBITED'
  | 'CDB101_SINGLE_OPERATOR_RISK_ACCEPTANCE_INVALID'
  | 'CDB101_SINGLE_OPERATOR_OWNER_CONTRACT_INVALID'
  | 'CDB101_SINGLE_OPERATOR_BACKUP_PROHIBITED'
  | 'CDB101_SINGLE_OPERATOR_SCOPE_PROHIBITED'
  | 'CDB101_OWNER_AUTHORITY_INVALID'
  | 'CDB101_OWNER_ACKNOWLEDGEMENT_INVALID'
  | 'CDB101_ROLLBACK_THRESHOLD_INVALID'
  | 'CDB101_EXPORT_EVIDENCE_MISSING'
  | 'CDB101_TIME_TRAVEL_BOOKMARK_MISSING'
  | 'CDB101_MAINTENANCE_RECOVERY_EVIDENCE_INVALID'
  | 'CDB101_RECOVERY_EXPORT_IMPORT_HASH_MISMATCH'
  | 'CDB101_WORKER_BUILD_VERSION_EVIDENCE_INVALID'
  | 'CDB101_FOREIGN_KEY_DISPOSITION_INVALID'
  | 'CDB101_SMOKE_PLAN_INCOMPLETE';

export interface ReportingCutoverAuthorizationIssue {
  code: ReportingCutoverAuthorizationIssueCode;
  summary: string;
}

export interface ReportingCutoverAuthorizationResult {
  executionReady: boolean;
  issues: ReportingCutoverAuthorizationIssue[];
  expectedCommandIds: {
    migration: string;
    productionImport: string;
    featureFlag: string;
  };
}

export interface ReportingForeignKeyAggregateGroup {
  childTable: string;
  parentTable: string;
  violationCount: number;
}

export type ReportingForeignKeyClassification =
  | 'active_financial_repair_required'
  | 'archival_formal_waiver_candidate'
  | 'unknown_requires_review';

export interface ClassifiedReportingForeignKeyGroup extends ReportingForeignKeyAggregateGroup {
  classification: ReportingForeignKeyClassification;
  recommendedDisposition: 'repair_required' | 'formal_waiver_candidate' | 'manual_review';
  rationale: string;
}

export interface ReportingForeignKeyClassificationResult {
  totalViolationCount: number;
  groups: ClassifiedReportingForeignKeyGroup[];
  unknownGroups: ClassifiedReportingForeignKeyGroup[];
}

export interface CanonicalImportSqlValidationResult {
  valid: boolean;
  statementCount: number;
  referencedTables: string[];
  issues: string[];
}

export interface ReportingShadowFlagSqlInput {
  tenantId: string;
  expectedPreviousState: 'absent_or_disabled';
  effectiveAtUtc: string;
  updatedBy: string;
}

export interface RollbackTimingInput {
  rollbackTriggeredAtUtc: string;
  rollbackCompletedAtUtc: string;
  reopenStartedAtUtc: string;
  writesReopenedAtUtc: string;
}

export interface RollbackTimingResult {
  rollbackDurationMs: number;
  reopenDurationMs: number;
}

export interface ReportingCutoverResolutionItem {
  blockerNumber: number;
  blockerCode: string;
  ownerRole: string;
  action: string;
  requiredEvidence: string[];
  requiresProductionMutation: boolean;
  currentStatus: 'implemented_locally' | 'blocked_pending_authorization' | 'blocked_pending_external_evidence';
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactStringArray(values: readonly string[], expected: readonly string[]): boolean {
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

function exactStringSet(values: readonly string[], expected: readonly string[]): boolean {
  const left = [...new Set(values)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseUtc(value: unknown): number | null {
  if (!nonEmpty(value) || !value.endsWith('Z')) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function shortHash(prefix: string, value: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
    .slice(0, 20);
  return `${prefix}-${digest}`;
}

function normalizedForeignKeyDispositionGroups(
  groups: ReportingForeignKeyDispositionGroup[],
): ReportingForeignKeyDispositionGroup[] {
  return [...groups].sort((left, right) => (
    `${left.childTable}->${left.parentTable}`.localeCompare(`${right.childTable}->${right.parentTable}`)
  ));
}

function ownerModelCommandScope(input: ReportingCutoverAuthorization): unknown {
  return {
    schemaVersion: input.schemaVersion,
    ownerModel: input.schemaVersion === 2 ? 'four_person_strict' : input.ownerModel,
    twoPersonRiskAcceptance: input.schemaVersion === 3 ? input.twoPersonRiskAcceptance : null,
    singleOperatorRiskAcceptance: input.schemaVersion === 4 ? input.singleOperatorRiskAcceptance : null,
  };
}

function maintenanceRecoveryCommandScope(input: ReportingCutoverAuthorization): unknown {
  return {
    ownerModel: ownerModelCommandScope(input),
    evidence: input.maintenanceRecoveryEvidence,
    issuedAtUtc: input.issuedAtUtc,
    expiresAtUtc: input.expiresAtUtc,
    maintenanceWindowStartUtc: input.maintenanceWindowStartUtc,
    maintenanceWindowEndUtc: input.maintenanceWindowEndUtc,
    authorizationApproval: input.authorizationApproval,
    rollbackOwner: input.rollbackOwner,
    observationOwner: input.observationOwner,
    rollbackPolicy: input.rollbackPolicy,
    exportEvidence: input.exportEvidence,
    productionImportSourceExportSha256: input.productionImport.sourceExportSha256,
  };
}

function workerBuildVersionCommandScope(input: ReportingCutoverAuthorization): unknown {
  return {
    evidence: input.workerBuildVersionEvidence,
    authorized: input.deployment.authorized,
    candidateCommit: input.deployment.candidateCommit,
    candidateWorkerVersionId: input.deployment.candidateWorkerVersionId,
    previousWorkerVersionId: input.deployment.previousWorkerVersionId,
    buildManifestSha256: input.deployment.buildManifestSha256,
    routeFingerprintSha256: input.deployment.routeFingerprintSha256,
    activeRoutesUnchangedEvidenceId: input.deployment.activeRoutesUnchangedEvidenceId,
    migrationRepositoryManifestSha256: input.migrations.repositoryManifestSha256,
  };
}

export function buildMigrationCommandId(input: ReportingCutoverAuthorization): string {
  return shortHash('cdb101-migrations', {
    authorizationId: input.authorizationId,
    maintenanceRecovery: maintenanceRecoveryCommandScope(input),
    workerBuildVersion: workerBuildVersionCommandScope(input),
    approvalOwnerId: input.authorizationApproval.ownerId,
    approvalApprovedAtUtc: input.authorizationApproval.approvedAtUtc,
    approvalEvidenceId: input.authorizationApproval.evidenceId,
    approvalEvidenceSha256: input.authorizationApproval.evidenceSha256,
    databaseId: input.productionDatabase.id,
    domain: input.authorizedDomain,
    tenantIds: input.authorizedTenantIds,
    candidateCommit: input.deployment.candidateCommit,
    candidateWorkerVersionId: input.deployment.candidateWorkerVersionId,
    previousWorkerVersionId: input.deployment.previousWorkerVersionId,
    rollbackOwnerId: input.rollbackOwner.ownerId,
    observationOwnerId: input.observationOwner.ownerId,
    maxRollbackDurationMs: input.rollbackPolicy.maxRollbackDurationMs,
    maxReopenDurationMs: input.rollbackPolicy.maxReopenDurationMs,
    repositoryManifestSha256: input.migrations.repositoryManifestSha256,
    approvedMigrations: input.migrations.approvedMigrations,
    foreignKeyEvidenceId: input.foreignKeyDisposition.evidenceId,
    foreignKeyEvidenceSha256: input.foreignKeyDisposition.evidenceSha256,
    foreignKeyDispositionGroups: normalizedForeignKeyDispositionGroups(input.foreignKeyDisposition.groups),
    windowStartUtc: input.maintenanceWindowStartUtc,
    windowEndUtc: input.maintenanceWindowEndUtc,
    expiresAtUtc: input.expiresAtUtc,
  });
}

export function buildCanonicalImportCommandId(input: ReportingCutoverAuthorization): string {
  return shortHash('cdb101-import', {
    authorizationId: input.authorizationId,
    maintenanceRecovery: maintenanceRecoveryCommandScope(input),
    workerBuildVersion: workerBuildVersionCommandScope(input),
    approvalOwnerId: input.authorizationApproval.ownerId,
    approvalApprovedAtUtc: input.authorizationApproval.approvedAtUtc,
    approvalEvidenceId: input.authorizationApproval.evidenceId,
    approvalEvidenceSha256: input.authorizationApproval.evidenceSha256,
    databaseId: input.productionDatabase.id,
    tenantIds: input.productionImport.tenantIds,
    runnerVersion: input.productionImport.runnerVersion,
    bundleSha256: input.productionImport.bundleSha256,
    manifestSha256: input.productionImport.manifestSha256,
    sourceExportSha256: input.productionImport.sourceExportSha256,
    allowedTables: [...input.productionImport.allowedTables].sort(),
    deterministicRunId: input.productionImport.deterministicRunId,
    secondPassRequired: input.productionImport.secondPassRequired,
    candidateCommit: input.deployment.candidateCommit,
    candidateWorkerVersionId: input.deployment.candidateWorkerVersionId,
    previousWorkerVersionId: input.deployment.previousWorkerVersionId,
    rollbackOwnerId: input.rollbackOwner.ownerId,
    observationOwnerId: input.observationOwner.ownerId,
    maxRollbackDurationMs: input.rollbackPolicy.maxRollbackDurationMs,
    maxReopenDurationMs: input.rollbackPolicy.maxReopenDurationMs,
    foreignKeyEvidenceId: input.foreignKeyDisposition.evidenceId,
    foreignKeyEvidenceSha256: input.foreignKeyDisposition.evidenceSha256,
    foreignKeyDispositionGroups: normalizedForeignKeyDispositionGroups(input.foreignKeyDisposition.groups),
    windowStartUtc: input.maintenanceWindowStartUtc,
    windowEndUtc: input.maintenanceWindowEndUtc,
    expiresAtUtc: input.expiresAtUtc,
  });
}

export function buildFeatureFlagCommandId(input: ReportingCutoverAuthorization): string {
  return shortHash('cdb101-flag', {
    authorizationId: input.authorizationId,
    maintenanceRecovery: maintenanceRecoveryCommandScope(input),
    workerBuildVersion: workerBuildVersionCommandScope(input),
    approvalOwnerId: input.authorizationApproval.ownerId,
    approvalApprovedAtUtc: input.authorizationApproval.approvedAtUtc,
    approvalEvidenceId: input.authorizationApproval.evidenceId,
    approvalEvidenceSha256: input.authorizationApproval.evidenceSha256,
    databaseId: input.productionDatabase.id,
    candidateCommit: input.deployment.candidateCommit,
    candidateWorkerVersionId: input.deployment.candidateWorkerVersionId,
    previousWorkerVersionId: input.deployment.previousWorkerVersionId,
    rollbackOwnerId: input.rollbackOwner.ownerId,
    observationOwnerId: input.observationOwner.ownerId,
    maxRollbackDurationMs: input.rollbackPolicy.maxRollbackDurationMs,
    maxReopenDurationMs: input.rollbackPolicy.maxReopenDurationMs,
    tenantId: input.featureFlagPlan.tenantId,
    flagKey: input.featureFlagPlan.flagKey,
    domain: input.featureFlagPlan.domain,
    initialMode: input.featureFlagPlan.initialMode,
    expectedPreviousState: input.featureFlagPlan.expectedPreviousState,
    effectiveAtUtc: input.featureFlagPlan.effectiveAtUtc,
    updatedByPublicId: input.featureFlagPlan.updatedByPublicId,
    foreignKeyEvidenceId: input.foreignKeyDisposition.evidenceId,
    foreignKeyEvidenceSha256: input.foreignKeyDisposition.evidenceSha256,
    foreignKeyDispositionGroups: normalizedForeignKeyDispositionGroups(input.foreignKeyDisposition.groups),
    windowStartUtc: input.maintenanceWindowStartUtc,
    windowEndUtc: input.maintenanceWindowEndUtc,
    expiresAtUtc: input.expiresAtUtc,
  });
}

function addIssue(
  issues: ReportingCutoverAuthorizationIssue[],
  code: ReportingCutoverAuthorizationIssueCode,
  summary: string,
): void {
  if (!issues.some((issue) => issue.code === code)) issues.push({ code, summary });
}

function validateOwner(
  owner: ReportingOwnerContract,
  kind: 'rollback' | 'observation',
  issuedMs: number | null,
  windowStartMs: number | null,
  issues: ReportingCutoverAuthorizationIssue[],
): void {
  const missingCode = kind === 'rollback'
    ? 'CDB101_ROLLBACK_OWNER_MISSING'
    : 'CDB101_OBSERVATION_OWNER_MISSING';
  if (
    owner.assigned !== true
    || !nonEmpty(owner.ownerId)
    || !nonEmpty(owner.backupOwnerId)
    || !nonEmpty(owner.communicationChannelId)
  ) {
    addIssue(issues, missingCode, `A complete ${kind} owner contract is required.`);
  }
  const expectedAuthority = kind === 'rollback'
    ? 'may_initiate_rollback'
    : 'may_accept_or_reject_go';
  if (owner.decisionAuthority !== expectedAuthority) {
    addIssue(
      issues,
      'CDB101_OWNER_AUTHORITY_INVALID',
      `${kind} owner decision authority does not match the required contract.`,
    );
  }
  const acknowledgedMs = parseUtc(owner.acknowledgedAtUtc);
  if (
    acknowledgedMs === null
    || (issuedMs !== null && acknowledgedMs < issuedMs)
    || (windowStartMs !== null && acknowledgedMs > windowStartMs)
  ) {
    addIssue(
      issues,
      'CDB101_OWNER_ACKNOWLEDGEMENT_INVALID',
      'Owner acknowledgement must be a valid UTC time between authorization issue and maintenance start.',
    );
  }
}

function validateTwoPersonOwner(
  owner: ReportingOwnerContract,
  kind: 'rollback' | 'observation',
  issuedMs: number | null,
  windowStartMs: number | null,
  issues: ReportingCutoverAuthorizationIssue[],
): void {
  const expectedAuthority = kind === 'rollback'
    ? 'may_initiate_rollback'
    : 'may_accept_or_reject_go';
  if (
    owner.assigned !== true
    || !nonEmpty(owner.ownerId)
    || !nonEmpty(owner.communicationChannelId)
    || owner.decisionAuthority !== expectedAuthority
  ) {
    addIssue(
      issues,
      'CDB101_TWO_PERSON_OWNER_CONTRACT_INVALID',
      `A complete constrained ${kind} primary-owner contract is required.`,
    );
  }
  if (nonEmpty(owner.backupOwnerId)) {
    addIssue(
      issues,
      'CDB101_TWO_PERSON_BACKUP_PROHIBITED',
      'The constrained model does not permit backup owner identities.',
    );
  }
  const acknowledgedMs = parseUtc(owner.acknowledgedAtUtc);
  if (
    acknowledgedMs === null
    || (issuedMs !== null && acknowledgedMs < issuedMs)
    || (windowStartMs !== null && acknowledgedMs > windowStartMs)
  ) {
    addIssue(
      issues,
      'CDB101_OWNER_ACKNOWLEDGEMENT_INVALID',
      'Owner acknowledgement must be a valid UTC time between authorization issue and maintenance start.',
    );
  }
}

function validateTwoPersonRiskAcceptance(
  input: ReportingCutoverAuthorization,
  issuedMs: number | null,
  windowStartMs: number | null,
  issues: ReportingCutoverAuthorizationIssue[],
): void {
  const risk = input.twoPersonRiskAcceptance;
  const acceptedMs = parseUtc(risk?.acceptedAtUtc);
  if (
    input.ownerModel !== 'two_person_constrained'
    || !risk
    || risk.accepted !== true
    || !nonEmpty(risk.acceptedByOwnerId)
    || risk.acceptedByOwnerId !== input.rollbackOwner.ownerId
    || acceptedMs === null
    || (issuedMs !== null && acceptedMs < issuedMs)
    || (windowStartMs !== null && acceptedMs > windowStartMs)
    || !nonEmpty(risk.evidenceId)
    || !isSha256(risk.evidenceSha256)
    || risk.noTechnicalBackupAccepted !== true
    || risk.noMonitoringBackupAccepted !== true
    || risk.automaticAbortOnTechnicalOperatorUnavailable !== true
    || risk.automaticAbortOnMonitoringOwnerUnavailable !== true
    || risk.shadowOnlyAccepted !== true
    || risk.canonicalPromotionProhibited !== true
    || risk.workerTrafficChangeProhibited !== true
  ) {
    addIssue(
      issues,
      'CDB101_TWO_PERSON_RISK_ACCEPTANCE_INVALID',
      'The constrained owner model requires exact acknowledged risk-acceptance evidence and all fail-closed safeguards.',
    );
  }
  if (
    risk?.shadowOnlyAccepted !== true
    || risk?.canonicalPromotionProhibited !== true
    || risk?.workerTrafficChangeProhibited !== true
  ) {
    addIssue(
      issues,
      'CDB101_TWO_PERSON_SCOPE_PROHIBITED',
      'Constrained authorization must prohibit Worker traffic changes and canonical promotion and remain shadow-only.',
    );
  }
}

function validateSingleOperatorOwner(
  owner: ReportingOwnerContract,
  kind: 'rollback' | 'observation',
  issuedMs: number | null,
  windowStartMs: number | null,
  issues: ReportingCutoverAuthorizationIssue[],
): void {
  const expectedAuthority = kind === 'rollback'
    ? 'may_initiate_rollback'
    : 'may_accept_or_reject_go';
  if (
    owner.assigned !== true
    || !nonEmpty(owner.ownerId)
    || !nonEmpty(owner.communicationChannelId)
    || owner.decisionAuthority !== expectedAuthority
  ) {
    addIssue(
      issues,
      'CDB101_SINGLE_OPERATOR_OWNER_CONTRACT_INVALID',
      `A complete single-operator ${kind} role contract is required.`,
    );
  }
  if (nonEmpty(owner.backupOwnerId)) {
    addIssue(
      issues,
      'CDB101_SINGLE_OPERATOR_BACKUP_PROHIBITED',
      'The single-operator model does not permit backup owner identities.',
    );
  }
  const acknowledgedMs = parseUtc(owner.acknowledgedAtUtc);
  if (
    acknowledgedMs === null
    || (issuedMs !== null && acknowledgedMs < issuedMs)
    || (windowStartMs !== null && acknowledgedMs > windowStartMs)
  ) {
    addIssue(
      issues,
      'CDB101_OWNER_ACKNOWLEDGEMENT_INVALID',
      'Owner acknowledgement must be a valid UTC time between authorization issue and maintenance start.',
    );
  }
}

function validateSingleOperatorRiskAcceptance(
  input: ReportingCutoverAuthorization,
  issuedMs: number | null,
  windowStartMs: number | null,
  issues: ReportingCutoverAuthorizationIssue[],
): void {
  const risk = input.singleOperatorRiskAcceptance;
  const acceptedMs = parseUtc(risk?.acceptedAtUtc);
  if (
    input.ownerModel !== 'single_operator_risk_accepted'
    || !risk
    || risk.accepted !== true
    || !nonEmpty(risk.acceptedByOwnerId)
    || risk.acceptedByOwnerId !== input.rollbackOwner.ownerId
    || risk.acceptedByOwnerId !== input.observationOwner.ownerId
    || acceptedMs === null
    || (issuedMs !== null && acceptedMs < issuedMs)
    || (windowStartMs !== null && acceptedMs > windowStartMs)
    || !nonEmpty(risk.evidenceId)
    || !isSha256(risk.evidenceSha256)
    || risk.dualRoleAccepted !== true
    || risk.independentObservationWaived !== true
    || risk.noTechnicalBackupAccepted !== true
    || risk.noMonitoringBackupAccepted !== true
    || risk.automaticAbortOnOperatorUnavailable !== true
    || risk.shadowOnlyAccepted !== true
    || risk.canonicalPromotionProhibited !== true
    || risk.workerTrafficChangeProhibited !== true
    || risk.postActivationReconciliationRequired !== true
  ) {
    addIssue(
      issues,
      'CDB101_SINGLE_OPERATOR_RISK_ACCEPTANCE_INVALID',
      'The single-operator model requires exact risk acceptance and every fail-closed safeguard.',
    );
  }
  if (
    risk?.shadowOnlyAccepted !== true
    || risk?.canonicalPromotionProhibited !== true
    || risk?.workerTrafficChangeProhibited !== true
    || risk?.postActivationReconciliationRequired !== true
  ) {
    addIssue(
      issues,
      'CDB101_SINGLE_OPERATOR_SCOPE_PROHIBITED',
      'Single-operator authorization must remain shadow-only, prohibit traffic changes and promotion, and require reconciliation.',
    );
  }
}

const EXPECTED_FK_GROUPS: ReportingForeignKeyAggregateGroup[] = [
  { childTable: 'billing_deposits', parentTable: 'bills', violationCount: 4 },
  { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'bills', violationCount: 26 },
  { childTable: 'doctor_commission_accruals_old_0391', parentTable: 'visits', violationCount: 15 },
  { childTable: 'income', parentTable: 'bills', violationCount: 4 },
];

function fkKey(group: ReportingForeignKeyAggregateGroup): string {
  return `${group.childTable}->${group.parentTable}`;
}

export function classifyProductionForeignKeyViolations(
  groups: ReportingForeignKeyAggregateGroup[],
): ReportingForeignKeyClassificationResult {
  const classified = groups.map<ClassifiedReportingForeignKeyGroup>((group) => {
    if (
      (group.childTable === 'billing_deposits' && group.parentTable === 'bills')
      || (group.childTable === 'income' && group.parentTable === 'bills')
    ) {
      return {
        ...group,
        classification: 'active_financial_repair_required',
        recommendedDisposition: 'repair_required',
        rationale: 'The child table is active financial source data; reporting GO requires an approved repair, not a waiver.',
      };
    }
    if (
      group.childTable === 'doctor_commission_accruals_old_0391'
      && (group.parentTable === 'bills' || group.parentTable === 'visits')
    ) {
      return {
        ...group,
        classification: 'archival_formal_waiver_candidate',
        recommendedDisposition: 'formal_waiver_candidate',
        rationale: 'The child table is an explicitly versioned archival table; waiver is possible only with retired-source and exclusion evidence.',
      };
    }
    return {
      ...group,
      classification: 'unknown_requires_review',
      recommendedDisposition: 'manual_review',
      rationale: 'This aggregate group is outside the reviewed CDB-101 production FK classification.',
    };
  });
  return {
    totalViolationCount: classified.reduce((sum, group) => sum + group.violationCount, 0),
    groups: classified,
    unknownGroups: classified.filter((group) => group.classification === 'unknown_requires_review'),
  };
}

export function validateObservedForeignKeyDisposition(
  observedGroups: ReportingForeignKeyAggregateGroup[],
  dispositionGroups: ReportingForeignKeyDispositionGroup[],
): string[] {
  const issues: string[] = [];
  const observedByKey = new Map(observedGroups.map((group) => [fkKey(group), group]));
  const dispositionByKey = new Map(dispositionGroups.map((group) => [fkKey(group), group]));
  for (const observed of observedGroups) {
    const disposition = dispositionByKey.get(fkKey(observed));
    if (!disposition) {
      issues.push('CDB101_OBSERVED_FOREIGN_KEY_GROUP_UNKNOWN');
      continue;
    }
    if (observed.violationCount !== disposition.remainingViolationCount) {
      issues.push('CDB101_OBSERVED_FOREIGN_KEY_COUNT_MISMATCH');
    }
  }
  for (const disposition of dispositionGroups) {
    const observed = observedByKey.get(fkKey(disposition));
    if (disposition.remainingViolationCount === 0 && observed?.violationCount) {
      issues.push('CDB101_OBSERVED_FOREIGN_KEY_COUNT_MISMATCH');
    }
    if (disposition.remainingViolationCount > 0 && observed?.violationCount !== disposition.remainingViolationCount) {
      issues.push('CDB101_OBSERVED_FOREIGN_KEY_COUNT_MISMATCH');
    }
  }
  return [...new Set(issues)];
}

function validateForeignKeyDisposition(
  groups: ReportingForeignKeyDispositionGroup[],
): boolean {
  if (groups.length !== EXPECTED_FK_GROUPS.length) return false;
  const expectedByKey = new Map(EXPECTED_FK_GROUPS.map((group) => [fkKey(group), group]));
  for (const group of groups) {
    const expected = expectedByKey.get(fkKey(group));
    if (!expected || expected.violationCount !== group.violationCount) return false;
    if (
      !Number.isSafeInteger(group.remainingViolationCount)
      || group.remainingViolationCount < 0
      || !Number.isSafeInteger(group.repairedViolationCount)
      || group.repairedViolationCount < 0
      || !Number.isSafeInteger(group.waivedViolationCount)
      || group.waivedViolationCount < 0
      || group.remainingViolationCount + group.repairedViolationCount !== group.violationCount
      || group.waivedViolationCount > group.remainingViolationCount
    ) return false;
    if (!nonEmpty(group.ownerId) || !nonEmpty(group.evidenceId) || !nonEmpty(group.removalPhase)) return false;
    const activeFinancial = group.childTable === 'billing_deposits' || group.childTable === 'income';
    if (
      activeFinancial
      && (
        group.disposition !== 'repair_required'
        || group.remainingViolationCount !== 0
        || group.repairedViolationCount !== group.violationCount
        || group.waivedViolationCount !== 0
      )
    ) return false;
    if (!activeFinancial && group.disposition === 'repair_required' && (
      group.remainingViolationCount !== 0
      || group.repairedViolationCount !== group.violationCount
      || group.waivedViolationCount !== 0
    )) return false;
    if (!activeFinancial && group.disposition === 'formal_waiver' && (
      group.remainingViolationCount !== group.violationCount
      || group.repairedViolationCount !== 0
      || group.waivedViolationCount !== group.violationCount
    )) return false;
  }
  return true;
}

export function validateReportingCutoverAuthorization(
  input: ReportingCutoverAuthorization,
  atUtc: string = new Date().toISOString(),
): ReportingCutoverAuthorizationResult {
  const issues: ReportingCutoverAuthorizationIssue[] = [];
  const expectedCommandIds = {
    migration: buildMigrationCommandId(input),
    productionImport: buildCanonicalImportCommandId(input),
    featureFlag: buildFeatureFlagCommandId(input),
  };

  if (input.schemaVersion !== 2 && input.schemaVersion !== 3 && input.schemaVersion !== 4) {
    addIssue(issues, 'CDB101_AUTHORIZATION_SCHEMA_UNSUPPORTED', 'Authorization schemaVersion must be 2, 3, or 4.');
  }
  if (
    (input.schemaVersion === 2 && input.ownerModel !== undefined)
    || (input.schemaVersion === 3 && input.ownerModel !== 'two_person_constrained')
    || (input.schemaVersion === 4 && input.ownerModel !== 'single_operator_risk_accepted')
  ) {
    addIssue(issues, 'CDB101_OWNER_MODEL_INVALID', 'Owner model must match the selected authorization schema.');
  }
  if (!nonEmpty(input.authorizationId)) {
    addIssue(issues, 'CDB101_AUTHORIZATION_ID_MISSING', 'A unique authorization ID is required.');
  }
  if (input.productionExecutionAuthorized !== true) {
    addIssue(issues, 'CDB101_EXECUTION_AUTHORIZATION_MISSING', 'Production execution is not authorized.');
  }
  if (input.authorizedDomain !== 'reporting') {
    addIssue(issues, 'CDB101_AUTHORIZED_DOMAIN_MISMATCH', 'The authorization must target only reporting.');
  }
  if (!exactStringSet(input.authorizedTenantIds, [CDB101_CANARY_TENANT_ID])) {
    addIssue(issues, 'CDB101_AUTHORIZED_TENANT_SCOPE_MISMATCH', 'The first wave must target only tenant 100.');
  }
  if (
    input.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID
  ) {
    addIssue(
      issues,
      'CDB101_PRODUCTION_DATABASE_IDENTITY_MISMATCH',
      'The authorization must bind the exact production database name and UUID.',
    );
  }

  const nowMs = parseUtc(atUtc);
  const issuedMs = parseUtc(input.issuedAtUtc);
  const approvedMs = parseUtc(input.authorizationApproval.approvedAtUtc);
  const expiresMs = parseUtc(input.expiresAtUtc);
  const startMs = parseUtc(input.maintenanceWindowStartUtc);
  const endMs = parseUtc(input.maintenanceWindowEndUtc);
  if (
    !nonEmpty(input.authorizationApproval.ownerId)
    || !nonEmpty(input.authorizationApproval.evidenceId)
    || !isSha256(input.authorizationApproval.evidenceSha256)
    || approvedMs === null
    || (issuedMs !== null && approvedMs < issuedMs)
    || (startMs !== null && approvedMs > startMs)
  ) {
    addIssue(
      issues,
      'CDB101_OWNER_APPROVAL_EVIDENCE_MISSING',
      'Owner approval identity, timestamp, evidence ID, and SHA-256 are required before maintenance start.',
    );
  }
  if (issuedMs === null || (startMs !== null && issuedMs > startMs)) {
    addIssue(issues, 'CDB101_AUTHORIZATION_ISSUED_AT_INVALID', 'Authorization issuance must precede maintenance start.');
  }
  if (nowMs === null || expiresMs === null || expiresMs <= nowMs) {
    addIssue(issues, 'CDB101_EXECUTION_AUTHORIZATION_EXPIRED', 'Authorization is missing, invalid, or expired.');
  }
  if (startMs === null || endMs === null || endMs <= startMs || (nowMs !== null && (nowMs < startMs || nowMs > endMs))) {
    addIssue(issues, 'CDB101_MAINTENANCE_WINDOW_INVALID', 'Current time must be inside a valid maintenance window.');
  }
  const grace = input.rollbackPolicy.observationGracePeriodMs;
  if (
    expiresMs !== null
    && endMs !== null
    && (!positiveInteger(grace) || expiresMs !== endMs + grace)
  ) {
    addIssue(
      issues,
      'CDB101_AUTHORIZATION_EXPIRY_INVALID',
      'Authorization expiry must equal maintenance end plus the approved observation grace period.',
    );
  }

  if (!input.deployment.authorized) {
    addIssue(issues, 'CDB101_DEPLOYMENT_AUTHORIZATION_MISSING', 'The exact Worker deployment must be authorized.');
  }
  if (!isCommit(input.deployment.candidateCommit)) {
    addIssue(issues, 'CDB101_DEPLOYMENT_COMMIT_INVALID', 'Candidate commit must be an exact 40-character Git SHA.');
  }
  if (
    !isUuid(input.deployment.candidateWorkerVersionId)
    || !isUuid(input.deployment.previousWorkerVersionId)
    || input.deployment.candidateWorkerVersionId === input.deployment.previousWorkerVersionId
  ) {
    addIssue(issues, 'CDB101_DEPLOYMENT_VERSION_INVALID', 'Candidate and previous Worker version IDs must be distinct UUIDs.');
  }
  if (!isSha256(input.deployment.buildManifestSha256) || !isSha256(input.deployment.routeFingerprintSha256)) {
    addIssue(issues, 'CDB101_DEPLOYMENT_HASH_INVALID', 'Deployment build and route fingerprints must be SHA-256 values.');
  }
  if (!nonEmpty(input.deployment.activeRoutesUnchangedEvidenceId)) {
    addIssue(issues, 'CDB101_ACTIVE_ROUTE_EVIDENCE_MISSING', 'Legacy active-route evidence is required.');
  }
  if (
    !nonEmpty(input.workerBuildVersionEvidence.evidenceId)
    || !isSha256(input.workerBuildVersionEvidence.evidenceSha256)
  ) {
    addIssue(
      issues,
      'CDB101_WORKER_BUILD_VERSION_EVIDENCE_INVALID',
      'Validated Worker build/version evidence ID and SHA-256 are required.',
    );
  }

  if (!input.migrations.authorized) {
    addIssue(issues, 'CDB101_MIGRATION_AUTHORIZATION_MISSING', 'Migration application is not authorized.');
  }
  if (!exactStringArray(input.migrations.approvedMigrations, CDB101_EXPECTED_MIGRATIONS)) {
    addIssue(issues, 'CDB101_MIGRATION_SCOPE_MISMATCH', 'Approved migrations must exactly equal ordered 0505 through 0515.');
  }
  if (!isSha256(input.migrations.repositoryManifestSha256)) {
    addIssue(issues, 'CDB101_MIGRATION_MANIFEST_HASH_INVALID', 'Repository migration manifest SHA-256 is required.');
  }
  if (input.migrations.commandId !== expectedCommandIds.migration) {
    addIssue(issues, 'CDB101_MIGRATION_COMMAND_ID_MISMATCH', 'Migration command ID does not match the protected scope.');
  }

  if (!input.productionImport.authorized) {
    addIssue(issues, 'CDB101_PRODUCTION_IMPORT_AUTHORIZATION_MISSING', 'Production canonical import is not authorized.');
  }
  if (!input.productionImport.commandApproved || !nonEmpty(input.productionImport.runnerVersion) || !nonEmpty(input.productionImport.deterministicRunId)) {
    addIssue(issues, 'CDB101_PRODUCTION_IMPORT_COMMAND_MISSING', 'A reviewed importer version and deterministic run ID are required.');
  }
  if (
    !exactStringSet(input.productionImport.tenantIds, [CDB101_CANARY_TENANT_ID])
    || !exactStringSet(input.productionImport.allowedTables, CDB101_REPORTING_IMPORT_TABLES)
    || input.productionImport.allowedTables.length !== CDB101_REPORTING_IMPORT_TABLES.length
    || input.productionImport.secondPassRequired !== true
  ) {
    addIssue(issues, 'CDB101_PRODUCTION_IMPORT_SCOPE_INVALID', 'Importer scope must be tenant 100, canonical tables only, with a required second pass.');
  }
  if (
    !isSha256(input.productionImport.bundleSha256)
    || !isSha256(input.productionImport.manifestSha256)
    || !isSha256(input.productionImport.sourceExportSha256)
  ) {
    addIssue(issues, 'CDB101_PRODUCTION_IMPORT_HASH_INVALID', 'Import bundle, manifest, and source export SHA-256 values are required.');
  }
  if (input.productionImport.commandId !== expectedCommandIds.productionImport) {
    addIssue(issues, 'CDB101_PRODUCTION_IMPORT_COMMAND_ID_MISMATCH', 'Import command ID does not match the protected scope.');
  }

  if (!input.featureFlagPlan.authorized) {
    addIssue(issues, 'CDB101_SHADOW_FLAG_AUTHORIZATION_MISSING', 'Tenant 100 shadow flag enablement is not authorized.');
  }
  if (
    input.featureFlagPlan.tenantId !== CDB101_CANARY_TENANT_ID
    || input.featureFlagPlan.flagKey !== CDB101_REPORTING_FLAG_KEY
    || input.featureFlagPlan.domain !== 'reporting'
    || input.featureFlagPlan.initialMode !== 'shadow'
    || input.featureFlagPlan.expectedPreviousState !== 'absent_or_disabled'
    || parseUtc(input.featureFlagPlan.effectiveAtUtc) === null
    || (startMs !== null && (parseUtc(input.featureFlagPlan.effectiveAtUtc) ?? 0) < startMs)
    || (endMs !== null && (parseUtc(input.featureFlagPlan.effectiveAtUtc) ?? Number.POSITIVE_INFINITY) > endMs)
    || !nonEmpty(input.featureFlagPlan.updatedByPublicId)
    || input.featureFlagPlan.canonicalModeAuthorized !== false
  ) {
    addIssue(issues, 'CDB101_SHADOW_FLAG_SCOPE_INVALID', 'Initial flag scope must be tenant 100 reporting shadow only.');
  }
  if (input.featureFlagPlan.commandId !== expectedCommandIds.featureFlag) {
    addIssue(issues, 'CDB101_FEATURE_FLAG_COMMAND_ID_MISMATCH', 'Feature flag command ID does not match the protected scope.');
  }

  if (input.schemaVersion === 4) {
    validateSingleOperatorOwner(input.rollbackOwner, 'rollback', issuedMs, startMs, issues);
    validateSingleOperatorOwner(input.observationOwner, 'observation', issuedMs, startMs, issues);
    validateSingleOperatorRiskAcceptance(input, issuedMs, startMs, issues);
    if (
      !nonEmpty(input.rollbackOwner.ownerId)
      || input.rollbackOwner.ownerId !== input.observationOwner.ownerId
      || input.rollbackOwner.communicationChannelId !== input.observationOwner.communicationChannelId
    ) {
      addIssue(
        issues,
        'CDB101_SINGLE_OPERATOR_OWNER_CONTRACT_INVALID',
        'Single-operator cutover requires one exact identity to hold both roles in one incident channel.',
      );
    }
  } else if (input.schemaVersion === 3) {
    validateTwoPersonOwner(input.rollbackOwner, 'rollback', issuedMs, startMs, issues);
    validateTwoPersonOwner(input.observationOwner, 'observation', issuedMs, startMs, issues);
    validateTwoPersonRiskAcceptance(input, issuedMs, startMs, issues);
    if (
      !nonEmpty(input.rollbackOwner.ownerId)
      || !nonEmpty(input.observationOwner.ownerId)
      || input.rollbackOwner.ownerId === input.observationOwner.ownerId
      || input.rollbackOwner.communicationChannelId !== input.observationOwner.communicationChannelId
    ) {
      addIssue(
        issues,
        'CDB101_TWO_PERSON_OWNER_CONTRACT_INVALID',
        'Constrained cutover requires two distinct primary owners sharing one incident channel.',
      );
    }
  } else {
    validateOwner(input.rollbackOwner, 'rollback', issuedMs, startMs, issues);
    validateOwner(input.observationOwner, 'observation', issuedMs, startMs, issues);
    const operationalOwnerIds = [
      input.rollbackOwner.ownerId,
      input.rollbackOwner.backupOwnerId,
      input.observationOwner.ownerId,
      input.observationOwner.backupOwnerId,
    ].filter(nonEmpty);
    if (operationalOwnerIds.length !== 4 || new Set(operationalOwnerIds).size !== operationalOwnerIds.length) {
      addIssue(issues, 'CDB101_OWNER_IDENTITY_COLLISION', 'Rollback and observation primary and backup identities must all be distinct.');
    }
  }
  if (
    !positiveInteger(input.rollbackPolicy.maxRollbackDurationMs)
    || !positiveInteger(input.rollbackPolicy.maxReopenDurationMs)
    || !positiveInteger(input.rollbackPolicy.observationGracePeriodMs)
  ) {
    addIssue(issues, 'CDB101_ROLLBACK_THRESHOLD_INVALID', 'Rollback, reopen, and observation thresholds must be positive integers.');
  }

  if (
    !input.exportEvidence.captured
    || !isSha256(input.exportEvidence.exportSha256)
    || !positiveInteger(input.exportEvidence.exportSizeBytes)
    || !nonEmpty(input.exportEvidence.metadataEvidenceId)
    || input.exportEvidence.directoryMode !== '700'
    || input.exportEvidence.fileMode !== '600'
  ) {
    addIssue(issues, 'CDB101_EXPORT_EVIDENCE_MISSING', 'Protected export hash, size, metadata, and file modes are required.');
  }
  if (!nonEmpty(input.exportEvidence.timeTravelBookmarkId)) {
    addIssue(issues, 'CDB101_TIME_TRAVEL_BOOKMARK_MISSING', 'A Time Travel bookmark identifier is required.');
  }
  if (
    !nonEmpty(input.maintenanceRecoveryEvidence.evidenceId)
    || !isSha256(input.maintenanceRecoveryEvidence.evidenceSha256)
  ) {
    addIssue(
      issues,
      'CDB101_MAINTENANCE_RECOVERY_EVIDENCE_INVALID',
      'Validated maintenance, owner, and recovery evidence ID and SHA-256 are required.',
    );
  }
  if (
    isSha256(input.exportEvidence.exportSha256)
    && isSha256(input.productionImport.sourceExportSha256)
    && input.exportEvidence.exportSha256 !== input.productionImport.sourceExportSha256
  ) {
    addIssue(
      issues,
      'CDB101_RECOVERY_EXPORT_IMPORT_HASH_MISMATCH',
      'The canonical import source export must equal the protected recovery export.',
    );
  }

  if (
    !nonEmpty(input.foreignKeyDisposition.evidenceId)
    || !isSha256(input.foreignKeyDisposition.evidenceSha256)
    || !validateForeignKeyDisposition(input.foreignKeyDisposition.groups)
  ) {
    addIssue(issues, 'CDB101_FOREIGN_KEY_DISPOSITION_INVALID', 'Every known FK group needs an exact repair or reviewed archival waiver disposition bound to one validated evidence pack.');
  }

  if (
    !nonEmpty(input.smoke.planId)
    || !exactStringSet(input.smoke.requiredScenarios, CDB101_REQUIRED_SMOKE_SCENARIOS)
    || !positiveInteger(input.smoke.maxP95LatencyMs)
    || typeof input.smoke.maxErrorRate !== 'number'
    || input.smoke.maxErrorRate < 0
    || input.smoke.maxErrorRate > 1
  ) {
    addIssue(issues, 'CDB101_SMOKE_PLAN_INCOMPLETE', 'The complete tenant-100 reporting shadow smoke plan and thresholds are required.');
  }

  return { executionReady: issues.length === 0, issues, expectedCommandIds };
}

export function validatePendingCanonicalMigrations(pendingMigrations: string[]): string[] {
  const issues: string[] = [];
  if (!exactStringSet(pendingMigrations, CDB101_EXPECTED_MIGRATIONS)) {
    issues.push('CDB101_PENDING_MIGRATION_SCOPE_MISMATCH');
  }
  if (
    exactStringSet(pendingMigrations, CDB101_EXPECTED_MIGRATIONS)
    && !exactStringArray(pendingMigrations, CDB101_EXPECTED_MIGRATIONS)
  ) {
    issues.push('CDB101_PENDING_MIGRATION_ORDER_MISMATCH');
  }
  return issues;
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (quote === ']' && char === ']') quote = null;
      else if (quote !== ']' && char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '[') quote = ']';
    else if (char === ';') {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function splitTopLevelCsv(value: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(value.slice(start).trim());
  return items;
}

function maskSqlStringLiterals(value: string): string {
  let result = '';
  let quote: "'" | '"' | '`' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      result += ' ';
      if (char === quote) {
        if (next === quote) {
          result += ' ';
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      result += ' ';
    } else {
      result += char;
    }
  }
  return result;
}

interface ParsedSingleRowInsert {
  table: string;
  columns: string;
  values: string;
}

function readParenthesizedSql(
  value: string,
  start: number,
): { content: string; end: number } | null {
  if (value[start] !== '(') return null;
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return { content: value.slice(start + 1, index), end: index + 1 };
      }
      if (depth < 0) return null;
    }
  }
  return null;
}

function parseSingleRowInsert(value: string): ParsedSingleRowInsert | null {
  const prefix = /^INSERT\s+(?:OR\s+(?:IGNORE|ABORT|FAIL|ROLLBACK)\s+)?INTO\s+([^\s(]+)\s*/i.exec(value);
  if (!prefix) return null;
  let cursor = prefix[0].length;
  const columns = readParenthesizedSql(value, cursor);
  if (!columns) return null;
  cursor = columns.end;
  while (/\s/.test(value[cursor] ?? '')) cursor += 1;
  const valuesKeyword = /^VALUES\b/i.exec(value.slice(cursor));
  if (!valuesKeyword) return null;
  cursor += valuesKeyword[0].length;
  while (/\s/.test(value[cursor] ?? '')) cursor += 1;
  const values = readParenthesizedSql(value, cursor);
  if (!values) return null;
  cursor = values.end;
  while (/\s/.test(value[cursor] ?? '')) cursor += 1;
  if (value[cursor] === ';') cursor += 1;
  while (/\s/.test(value[cursor] ?? '')) cursor += 1;
  if (cursor !== value.length) return null;
  return {
    table: unquoteIdentifier(prefix[1]),
    columns: columns.content,
    values: values.content,
  };
}

export function validateCanonicalImportBundleSql(
  sql: string,
  allowedTables: string[],
): CanonicalImportSqlValidationResult {
  const issues: string[] = [];
  const referencedTables = new Set<string>();
  const allowed = new Set(allowedTables);
  if (allowedTables.length === 0 || allowedTables.some((table) => !/^canonical_[a-z0-9_]+$/.test(table))) {
    issues.push('Allowed tables must be a non-empty canonical-only list.');
  }
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) issues.push('Import bundle has no SQL statements.');
  for (const statement of statements) {
    const normalized = statement.trim();
    const masked = maskSqlStringLiterals(normalized);
    if (/--|\/\*/.test(masked)) {
      issues.push('SQL comments are prohibited in a production canonical bundle.');
      continue;
    }
    if (
      /\b(?:SELECT|WITH|PRAGMA|CREATE|ALTER|DROP|ATTACH|DETACH|VACUUM|DELETE|REPLACE)\b/i.test(masked)
      || /\bON\s+CONFLICT\b/i.test(masked)
    ) {
      issues.push('Production canonical bundle statements must be offline-generated INSERT VALUES or tenant-scoped UPDATE DML without UPSERT clauses.');
      continue;
    }

    const insert = parseSingleRowInsert(normalized);
    const update = /^UPDATE\s+([^\s]+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?);?$/i.exec(normalized);
    if (!insert && !update) {
      issues.push('Only one-row INSERT VALUES or tenant-scoped UPDATE statements are allowed.');
      continue;
    }
    const table = insert?.table ?? unquoteIdentifier(update![1]);
    referencedTables.add(table);
    if (!/^canonical_[a-z0-9_]+$/.test(table) || !allowed.has(table)) {
      issues.push(`Write target is not allowlisted canonical table: ${table}`);
      continue;
    }

    if (insert) {
      const columns = splitTopLevelCsv(insert.columns).map((column) => unquoteIdentifier(column).toLowerCase());
      const values = splitTopLevelCsv(insert.values);
      const tenantIndex = columns.indexOf('tenant_id');
      if (columns.length !== values.length || tenantIndex < 0 || values[tenantIndex] !== "'100'") {
        issues.push('Every INSERT must bind tenant_id to the exact literal tenant 100.');
      }
    } else if (update) {
      const setClause = update[2];
      const whereClause = update[3];
      if (/\btenant_id\s*=/i.test(maskSqlStringLiterals(setClause))) {
        issues.push('UPDATE statements may not reassign tenant_id.');
      }
      if (!/\btenant_id\s*=\s*'100'(?:\s|$|;|\))/i.test(whereClause)) {
        issues.push('Every UPDATE must include an exact tenant_id = tenant 100 predicate.');
      }
    }
  }
  return {
    valid: issues.length === 0,
    statementCount: statements.length,
    referencedTables: [...referencedTables].sort(),
    issues,
  };
}

function quoteSql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildReportingShadowFlagSql(input: ReportingShadowFlagSqlInput): string {
  if (input.tenantId !== CDB101_CANARY_TENANT_ID) {
    throw new Error('CDB-101 shadow writer is restricted to tenant 100.');
  }
  if (input.expectedPreviousState !== 'absent_or_disabled') {
    throw new Error('Expected previous state must be absent_or_disabled.');
  }
  if (parseUtc(input.effectiveAtUtc) === null) throw new Error('effectiveAtUtc must be a UTC timestamp.');
  if (!nonEmpty(input.updatedBy)) throw new Error('updatedBy is required.');
  const tenant = quoteSql(input.tenantId);
  const effective = quoteSql(input.effectiveAtUtc);
  const updatedBy = quoteSql(input.updatedBy);
  return `INSERT INTO canonical_feature_flags (
  tenant_id, flag_key, domain, mode, is_enabled, version,
  effective_at_utc, updated_by_public_id, created_at_utc, updated_at_utc
)
SELECT ${tenant}, '${CDB101_REPORTING_FLAG_KEY}', 'reporting', 'shadow', 1, 1,
       ${effective}, ${updatedBy}, ${effective}, ${effective}
WHERE NOT EXISTS (
  SELECT 1
  FROM canonical_feature_flags
  WHERE tenant_id = ${tenant}
    AND flag_key = '${CDB101_REPORTING_FLAG_KEY}'
    AND NOT (is_enabled = 0 OR mode = 'disabled')
)
ON CONFLICT(tenant_id, flag_key) DO UPDATE SET
  domain = 'reporting',
  mode = 'shadow',
  is_enabled = 1,
  version = canonical_feature_flags.version + 1,
  effective_at_utc = excluded.effective_at_utc,
  expires_at_utc = NULL,
  updated_by_public_id = excluded.updated_by_public_id,
  updated_at_utc = excluded.updated_at_utc
WHERE canonical_feature_flags.tenant_id = ${tenant}
  AND canonical_feature_flags.flag_key = '${CDB101_REPORTING_FLAG_KEY}'
  AND (canonical_feature_flags.is_enabled = 0 OR canonical_feature_flags.mode = 'disabled');`;
}

export function measureRollbackAndReopenTiming(input: RollbackTimingInput): RollbackTimingResult {
  const triggered = parseUtc(input.rollbackTriggeredAtUtc);
  const completed = parseUtc(input.rollbackCompletedAtUtc);
  const reopenStarted = parseUtc(input.reopenStartedAtUtc);
  const reopened = parseUtc(input.writesReopenedAtUtc);
  if (
    triggered === null
    || completed === null
    || reopenStarted === null
    || reopened === null
    || completed < triggered
    || reopenStarted < completed
    || reopened < reopenStarted
  ) {
    throw new Error('Rollback and reopen timestamps must be valid monotonic UTC times.');
  }
  return {
    rollbackDurationMs: completed - triggered,
    reopenDurationMs: reopened - reopenStarted,
  };
}

export function buildReportingCutoverResolutionPlan(): ReportingCutoverResolutionItem[] {
  return [
    {
      blockerNumber: 1,
      blockerCode: 'CDB101_ACTIVE_ROUTE_EVIDENCE_UNAVAILABLE',
      ownerRole: 'deployment reviewer',
      action: 'Capture the active Worker deployment list and version metadata, then record authenticated legacy reporting route fingerprints before any candidate deployment.',
      requiredEvidence: ['deployment-list.json', 'active-worker-version.json', 'legacy-route-fingerprint.json'],
      requiresProductionMutation: false,
      currentStatus: 'implemented_locally',
    },
    {
      blockerNumber: 2,
      blockerCode: 'CDB101_CANONICAL_SCHEMA_NOT_APPLIED',
      ownerRole: 'migration operator',
      action: 'Apply the additive canonical schema only through the guarded migration wrapper after exact pending-list, identity, window, command-ID, export, and owner gates pass.',
      requiredEvidence: ['authorized-migration-command-id', 'post-apply-schema-inventory.json'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 3,
      blockerCode: 'CDB101_DEPLOYMENT_AUTHORIZATION_MISSING',
      ownerRole: 'release owner',
      action: 'Authorize one exact candidate commit and Worker version together with the previous version, build hash, route fingerprint, and rollback target.',
      requiredEvidence: ['signed-deployment-authorization', 'protected-worker-build-version-evidence.json'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_external_evidence',
    },
    {
      blockerNumber: 4,
      blockerCode: 'CDB101_EXECUTION_AUTHORIZATION_MISSING',
      ownerRole: 'program owner',
      action: 'Issue one explicit reporting-domain authorization naming tenant 100, all command IDs, owners, window, expiry, FK disposition, smoke plan, and rollback thresholds.',
      requiredEvidence: ['authorization-v2.json', 'owner-approval-record'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 5,
      blockerCode: 'CDB101_EXECUTION_AUTHORIZATION_EXPIRED',
      ownerRole: 'program owner',
      action: 'Set an absolute UTC expiry exactly equal to maintenance end plus the approved observation grace period and validate it at every mutating gate.',
      requiredEvidence: ['validated-expiry-result.json'],
      requiresProductionMutation: false,
      currentStatus: 'implemented_locally',
    },
    {
      blockerNumber: 6,
      blockerCode: 'CDB101_FOREIGN_KEY_VIOLATION',
      ownerRole: 'data integrity owner',
      action: 'Repair the eight active financial violations and either repair or formally waive the forty-one archival old_0391 violations with exact group evidence and removal phase.',
      requiredEvidence: ['fk-group-classification.json', 'repair-results.json', 'archival-waiver-records.json'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 7,
      blockerCode: 'CDB101_MAINTENANCE_WINDOW_MISSING',
      ownerRole: 'operations lead',
      action: 'Assign an exact UTC start and end, maintenance mechanism, drain criteria, public notice owner, and abort threshold before any mutation is attempted.',
      requiredEvidence: ['maintenance-window-record', 'maintenance-entry-checklist'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_external_evidence',
    },
    {
      blockerNumber: 8,
      blockerCode: 'CDB101_MIGRATION_AUTHORIZATION_MISSING',
      ownerRole: 'program owner',
      action: 'Authorize the deterministic migration command ID bound to the exact production UUID, commit, manifest hash, and ordered migration set 0505 through 0515.',
      requiredEvidence: ['migration-command-id', 'migration-scope-validation.json'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 9,
      blockerCode: 'CDB101_OBSERVATION_OWNER_MISSING',
      ownerRole: 'operations lead',
      action: 'Assign a distinct observation owner and backup who acknowledge the window and hold authority to accept or reject GO after smoke and parity review.',
      requiredEvidence: ['observation-owner-contract'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_external_evidence',
    },
    {
      blockerNumber: 10,
      blockerCode: 'CDB101_PENDING_CANONICAL_MIGRATIONS',
      ownerRole: 'migration operator',
      action: 'Use read-only migration listing to prove the pending set is exact, then apply it through Wrangler only inside the authorized window and record all eleven applied filenames.',
      requiredEvidence: ['pre-apply-pending-list.json', 'wrangler-apply-output.json', 'post-apply-pending-list.json'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 11,
      blockerCode: 'CDB101_PROCESSING_EVIDENCE_UNAVAILABLE',
      ownerRole: 'canonical observer',
      action: 'After migration, import, and the required second pass, capture the exact protected seven-check aggregate pack and pass canonical:validate-reporting-processing-evidence with shadowFlagReady true before the shadow flag wrapper starts any child process.',
      requiredEvidence: ['protected-processing-evidence.json', 'aggregate-processing-receipt.json'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_external_evidence',
    },
    {
      blockerNumber: 12,
      blockerCode: 'CDB101_PRODUCTION_IMPORT_AUTHORIZATION_MISSING',
      ownerRole: 'canonical migration owner',
      action: 'Authorize a reviewed DML-only production bundle and importer version bound to tenant 100, source export hash, bundle hash, manifest hash, table allowlist, and second-pass proof.',
      requiredEvidence: ['import-bundle.sql', 'import-manifest.json', 'import-authorization-record'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 13,
      blockerCode: 'CDB101_PRODUCTION_IMPORT_COMMAND_MISSING',
      ownerRole: 'canonical migration owner',
      action: 'Generate and approve the deterministic importer command ID; the existing clone importer must remain prohibited from production targeting.',
      requiredEvidence: ['production-import-command-id', 'importer-review-record'],
      requiresProductionMutation: false,
      currentStatus: 'implemented_locally',
    },
    {
      blockerNumber: 14,
      blockerCode: 'CDB101_PRODUCTION_MANIFEST_MISMATCH',
      ownerRole: 'release owner',
      action: 'Rebuild the migration manifest on the exact candidate commit and verify the repository SHA-256 equals the deployed production manifest object SHA-256.',
      requiredEvidence: ['repository-manifest-sha256', 'production-manifest-sha256'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_external_evidence',
    },
    {
      blockerNumber: 15,
      blockerCode: 'CDB101_PRODUCTION_MANIFEST_MISSING',
      ownerRole: 'release owner',
      action: 'Upload the approved migration manifest only as part of the separately authorized deployment process, then verify object existence and checksum read-only.',
      requiredEvidence: ['manifest-object-metadata.json'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
    {
      blockerNumber: 16,
      blockerCode: 'CDB101_ROLLBACK_OWNER_MISSING',
      ownerRole: 'operations lead',
      action: 'Assign a rollback owner and backup with explicit authority, communication channel, acknowledgement time, previous Worker version, bookmark, and duration thresholds.',
      requiredEvidence: ['rollback-owner-contract'],
      requiresProductionMutation: false,
      currentStatus: 'blocked_pending_external_evidence',
    },
    {
      blockerNumber: 17,
      blockerCode: 'CDB101_SHADOW_FLAG_AUTHORIZATION_MISSING',
      ownerRole: 'program owner',
      action: 'Authorize only the deterministic tenant-100 reporting shadow command ID after reconciliation, leaving canonical promotion and every other tenant unauthorized.',
      requiredEvidence: ['feature-flag-command-id', 'flag-read-before.json', 'flag-read-after.json'],
      requiresProductionMutation: true,
      currentStatus: 'blocked_pending_authorization',
    },
  ];
}
