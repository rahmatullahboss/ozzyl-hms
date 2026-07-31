import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CUTOVER_STEP_ORDER = [
  'maintenance_mode',
  'bookmark',
  'export',
  'delta_backfill',
  'reconciliation',
  'domain_flags',
  'smoke_tests',
  'go_no_go',
  'reopen',
] as const;

export type CutoverStep = (typeof CUTOVER_STEP_ORDER)[number];
export type CutoverMode = 'rehearsal' | 'production';

export interface CutoverStepEvidence {
  step: CutoverStep;
  status: 'passed' | 'failed';
  durationMs: number;
}

export interface CutoverRehearsalEvidence {
  rehearsalId: string;
  rehearsalNumber: number;
  environment: 'staging_clone';
  productionIdentity: {
    expectedDatabaseId: string;
    observedDatabaseId: string;
    checkedAtUtc: string;
    maxAgeSeconds: number;
    accountMatched: boolean;
    remoteDatabaseMatched: boolean;
    manifestChecksumMatched: boolean;
  };
  cloneIdentity: {
    expectedDatabaseId: string;
    observedDatabaseId: string;
    exactMatch: boolean;
  };
  steps: CutoverStepEvidence[];
  maintenanceMode: {
    entered: boolean;
    mode: 'maintenance' | 'read_only';
    ownerPublicId: string;
  };
  bookmark: {
    bookmarkId: string;
    databaseId: string;
    verified: boolean;
  };
  protectedExport: {
    expectedSha256: string;
    observedSha256: string;
    sourceDatabaseId: string;
    sizeBytes: number;
    verified: boolean;
    encryptedAtRest: boolean;
    accessControlled: boolean;
    retentionOwnerPublicId: string;
  };
  deltaBackfill: {
    completed: boolean;
    expectedCheckpointCount: number;
    completedCheckpointCount: number;
    failedRowCount: number;
    sourceDriftCount: number;
  };
  migrations: {
    expectedManifestChecksum: string;
    observedManifestChecksum: string;
    unknownMigrations: string[];
    pendingMigrations: string[];
  };
  reconciliation: {
    financialVarianceMinorByCurrency: Record<string, number>;
    unexplainedVarianceCount: number;
    unresolvedCriticalExceptionCount: number;
    foreignKeyViolationCount: number;
    unsafeIntegerViolationCount: number;
    tenantIsolationViolationCount: number;
  };
  processing: {
    failedOutboxItemCount: number;
    deadLetterOutboxItemCount: number;
    failedAccountingJobCount: number;
    retryAccountingJobCount: number;
    deadLetterAccountingJobCount: number;
  };
  featureFlags: {
    tenantScoped: boolean;
    globalSwitchPresent: boolean;
    productionFlagsEnabled: boolean;
    domainPlans: Array<{
      tenantId: string;
      domain: string;
      flagKey: string;
      plannedMode: 'shadow' | 'canonical';
    }>;
  };
  smokeTests: {
    planId: string;
    requiredScenarios: string[];
    passedScenarios: string[];
    failedScenarios: string[];
  };
  rollback: {
    rollbackOwnerPublicId: string;
    observationOwnerPublicId: string;
    restoreVerified: boolean;
    reopenVerified: boolean;
    rollbackDurationMs: number;
    reopenDurationMs: number;
  };
  productionMutationAttempted: boolean;
}

export interface CutoverReadinessEvidence {
  schemaVersion: 1;
  mode: CutoverMode;
  generatedAtUtc: string;
  proposedProductionMutation: boolean;
  authorization?: {
    authorized: boolean;
    authorizationPublicId: string;
    domain: string;
    expiresAtUtc: string;
  };
  rehearsals: CutoverRehearsalEvidence[];
}

export type CutoverIssueCode =
  | 'CDB100_EVIDENCE_INVALID'
  | 'CDB100_SCHEMA_VERSION_UNSUPPORTED'
  | 'CDB100_REHEARSAL_COUNT_INSUFFICIENT'
  | 'CDB100_REHEARSAL_ID_DUPLICATE'
  | 'CDB100_REHEARSAL_ORDER_INVALID'
  | 'CDB100_REHEARSAL_STEP_FAILED'
  | 'CDB100_REHEARSAL_DURATION_INVALID'
  | 'CDB100_PRODUCTION_IDENTITY_MISMATCH'
  | 'CDB100_PRODUCTION_IDENTITY_STALE'
  | 'CDB100_PRODUCTION_IDENTITY_UNVERIFIED'
  | 'CDB100_CLONE_IDENTITY_MISMATCH'
  | 'CDB100_MAINTENANCE_MODE_MISSING'
  | 'CDB100_BOOKMARK_MISSING'
  | 'CDB100_BOOKMARK_DATABASE_MISMATCH'
  | 'CDB100_EXPORT_UNVERIFIED'
  | 'CDB100_EXPORT_HASH_MISMATCH'
  | 'CDB100_EXPORT_SOURCE_MISMATCH'
  | 'CDB100_EXPORT_SECURITY_MISSING'
  | 'CDB100_DELTA_BACKFILL_INCOMPLETE'
  | 'CDB100_DELTA_BACKFILL_FAILED_ROWS'
  | 'CDB100_SOURCE_DRIFT'
  | 'CDB100_MANIFEST_CHECKSUM_MISMATCH'
  | 'CDB100_UNKNOWN_MIGRATION'
  | 'CDB100_PENDING_MIGRATION'
  | 'CDB100_FINANCIAL_VARIANCE'
  | 'CDB100_UNEXPLAINED_VARIANCE'
  | 'CDB100_CRITICAL_EXCEPTION'
  | 'CDB100_FOREIGN_KEY_VIOLATION'
  | 'CDB100_UNSAFE_INTEGER'
  | 'CDB100_TENANT_ISOLATION_VIOLATION'
  | 'CDB100_FAILED_OUTBOX_ITEM'
  | 'CDB100_DEAD_LETTER_OUTBOX_ITEM'
  | 'CDB100_FAILED_ACCOUNTING_JOB'
  | 'CDB100_RETRY_ACCOUNTING_JOB'
  | 'CDB100_DEAD_LETTER_ACCOUNTING_JOB'
  | 'CDB100_TENANT_FLAG_SCOPE_MISSING'
  | 'CDB100_GLOBAL_FLAG_PROHIBITED'
  | 'CDB100_DOMAIN_FLAG_PLAN_MISSING'
  | 'CDB100_PRODUCTION_FLAG_ALREADY_ENABLED'
  | 'CDB100_SMOKE_PLAN_MISSING'
  | 'CDB100_SMOKE_COVERAGE_INCOMPLETE'
  | 'CDB100_SMOKE_TEST_FAILED'
  | 'CDB100_ROLLBACK_OWNER_MISSING'
  | 'CDB100_OBSERVATION_OWNER_MISSING'
  | 'CDB100_ROLLBACK_NOT_VERIFIED'
  | 'CDB100_REOPEN_NOT_VERIFIED'
  | 'CDB100_ROLLBACK_DURATION_MISSING'
  | 'CDB100_REOPEN_DURATION_MISSING'
  | 'CDB100_PRODUCTION_MUTATION_ATTEMPTED'
  | 'CDB100_PRODUCTION_AUTHORIZATION_MISSING'
  | 'CDB100_PRODUCTION_AUTHORIZATION_EXPIRED';

export interface CutoverIssue {
  code: CutoverIssueCode;
  severity: 'blocker';
  rehearsalNumber: number | null;
  summary: string;
}

export interface CutoverReadinessResult {
  schemaVersion: 1;
  decision: 'go' | 'no_go';
  rehearsalReady: boolean;
  eligibleForProductionCutover: boolean;
  validatedRehearsalCount: number;
  issueCount: number;
  issues: CutoverIssue[];
  totalDurationMs: number;
  maxRollbackDurationMs: number;
  maxReopenDurationMs: number;
  productionMutationPerformed: false;
  aggregateOnly: true;
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function issue(
  issues: CutoverIssue[],
  code: CutoverIssueCode,
  summary: string,
  rehearsalNumber: number | null = null,
): void {
  issues.push({ code, severity: 'blocker', rehearsalNumber, summary });
}

function sameStepOrder(steps: CutoverStepEvidence[]): boolean {
  return steps.length === CUTOVER_STEP_ORDER.length
    && steps.every((entry, index) => entry.step === CUTOVER_STEP_ORDER[index]);
}

function validateIdentity(
  evidence: CutoverReadinessEvidence,
  rehearsal: CutoverRehearsalEvidence,
  issues: CutoverIssue[],
): void {
  const number = rehearsal.rehearsalNumber;
  const production = rehearsal.productionIdentity;
  if (
    production.expectedDatabaseId !== production.observedDatabaseId
    || !production.remoteDatabaseMatched
  ) {
    issue(
      issues,
      'CDB100_PRODUCTION_IDENTITY_MISMATCH',
      'Production database identity was not confirmed exactly.',
      number,
    );
  }
  if (!production.accountMatched || !production.manifestChecksumMatched) {
    issue(
      issues,
      'CDB100_PRODUCTION_IDENTITY_UNVERIFIED',
      'Production account or migration manifest identity was not verified.',
      number,
    );
  }

  const generatedAt = Date.parse(evidence.generatedAtUtc);
  const checkedAt = Date.parse(production.checkedAtUtc);
  const maxAgeMs = production.maxAgeSeconds * 1000;
  if (
    !Number.isFinite(generatedAt)
    || !Number.isFinite(checkedAt)
    || !isSafeNonNegativeInteger(production.maxAgeSeconds)
    || checkedAt > generatedAt
    || generatedAt - checkedAt > maxAgeMs
  ) {
    issue(
      issues,
      'CDB100_PRODUCTION_IDENTITY_STALE',
      'Production identity inspection is missing, invalid, future-dated, or stale.',
      number,
    );
  }

  if (
    rehearsal.cloneIdentity.expectedDatabaseId
      !== rehearsal.cloneIdentity.observedDatabaseId
    || !rehearsal.cloneIdentity.exactMatch
  ) {
    issue(
      issues,
      'CDB100_CLONE_IDENTITY_MISMATCH',
      'The rehearsal target did not match the exact approved clone identity.',
      number,
    );
  }
}

function validateRunbookSequence(
  rehearsal: CutoverRehearsalEvidence,
  issues: CutoverIssue[],
): number {
  const number = rehearsal.rehearsalNumber;
  if (!sameStepOrder(rehearsal.steps)) {
    issue(
      issues,
      'CDB100_REHEARSAL_ORDER_INVALID',
      'The cutover steps were missing or were not executed in the approved order.',
      number,
    );
  }

  let duration = 0;
  for (const step of rehearsal.steps) {
    if (step.status !== 'passed') {
      issue(
        issues,
        'CDB100_REHEARSAL_STEP_FAILED',
        'At least one cutover rehearsal step did not pass.',
        number,
      );
    }
    if (!isPositiveDuration(step.durationMs)) {
      issue(
        issues,
        'CDB100_REHEARSAL_DURATION_INVALID',
        'Every rehearsal step requires a measured positive safe-integer duration.',
        number,
      );
      continue;
    }
    duration += step.durationMs;
    if (!Number.isSafeInteger(duration)) {
      issue(
        issues,
        'CDB100_REHEARSAL_DURATION_INVALID',
        'The aggregate rehearsal duration exceeded safe-integer bounds.',
        number,
      );
      return 0;
    }
  }
  return duration;
}

function validateBackupAndBackfill(
  rehearsal: CutoverRehearsalEvidence,
  issues: CutoverIssue[],
): void {
  const number = rehearsal.rehearsalNumber;
  if (
    !rehearsal.maintenanceMode.entered
    || !isNonEmpty(rehearsal.maintenanceMode.ownerPublicId)
  ) {
    issue(
      issues,
      'CDB100_MAINTENANCE_MODE_MISSING',
      'Maintenance or read-only mode and its accountable owner are required.',
      number,
    );
  }

  if (!rehearsal.bookmark.verified || !isNonEmpty(rehearsal.bookmark.bookmarkId)) {
    issue(
      issues,
      'CDB100_BOOKMARK_MISSING',
      'A verified rollback bookmark is required before cutover work.',
      number,
    );
  }
  if (rehearsal.bookmark.databaseId !== rehearsal.cloneIdentity.observedDatabaseId) {
    issue(
      issues,
      'CDB100_BOOKMARK_DATABASE_MISMATCH',
      'The bookmark does not belong to the exact rehearsal clone.',
      number,
    );
  }

  const protectedExport = rehearsal.protectedExport;
  if (
    !protectedExport.verified
    || !isNonEmpty(protectedExport.expectedSha256)
    || !isNonEmpty(protectedExport.observedSha256)
    || !isSafeNonNegativeInteger(protectedExport.sizeBytes)
    || protectedExport.sizeBytes === 0
  ) {
    issue(
      issues,
      'CDB100_EXPORT_UNVERIFIED',
      'A non-empty verified protected export is required.',
      number,
    );
  }
  if (protectedExport.expectedSha256 !== protectedExport.observedSha256) {
    issue(
      issues,
      'CDB100_EXPORT_HASH_MISMATCH',
      'The protected export hash did not match the expected evidence.',
      number,
    );
  }
  if (
    protectedExport.sourceDatabaseId
      !== rehearsal.productionIdentity.observedDatabaseId
  ) {
    issue(
      issues,
      'CDB100_EXPORT_SOURCE_MISMATCH',
      'The protected export source did not match the verified production database.',
      number,
    );
  }
  if (
    !protectedExport.encryptedAtRest
    || !protectedExport.accessControlled
    || !isNonEmpty(protectedExport.retentionOwnerPublicId)
  ) {
    issue(
      issues,
      'CDB100_EXPORT_SECURITY_MISSING',
      'Protected export encryption, access control, and retention ownership are required.',
      number,
    );
  }

  const delta = rehearsal.deltaBackfill;
  if (
    !delta.completed
    || !isSafeNonNegativeInteger(delta.expectedCheckpointCount)
    || !isSafeNonNegativeInteger(delta.completedCheckpointCount)
    || delta.expectedCheckpointCount === 0
    || delta.completedCheckpointCount !== delta.expectedCheckpointCount
  ) {
    issue(
      issues,
      'CDB100_DELTA_BACKFILL_INCOMPLETE',
      'All expected delta-backfill checkpoints must complete.',
      number,
    );
  }
  if (!isSafeNonNegativeInteger(delta.failedRowCount) || delta.failedRowCount > 0) {
    issue(
      issues,
      'CDB100_DELTA_BACKFILL_FAILED_ROWS',
      'Delta backfill contains failed or invalid row counts.',
      number,
    );
  }
  if (!isSafeNonNegativeInteger(delta.sourceDriftCount) || delta.sourceDriftCount > 0) {
    issue(
      issues,
      'CDB100_SOURCE_DRIFT',
      'Source evidence drift remains unresolved.',
      number,
    );
  }
}

function validateMigrationsAndReconciliation(
  rehearsal: CutoverRehearsalEvidence,
  issues: CutoverIssue[],
): void {
  const number = rehearsal.rehearsalNumber;
  if (
    !isNonEmpty(rehearsal.migrations.expectedManifestChecksum)
    || rehearsal.migrations.expectedManifestChecksum
      !== rehearsal.migrations.observedManifestChecksum
  ) {
    issue(
      issues,
      'CDB100_MANIFEST_CHECKSUM_MISMATCH',
      'The observed migration manifest did not match the approved manifest.',
      number,
    );
  }
  if (rehearsal.migrations.unknownMigrations.length > 0) {
    issue(
      issues,
      'CDB100_UNKNOWN_MIGRATION',
      'Unknown migrations exist outside the approved manifest.',
      number,
    );
  }
  if (rehearsal.migrations.pendingMigrations.length > 0) {
    issue(
      issues,
      'CDB100_PENDING_MIGRATION',
      'Approved migrations remain pending on the rehearsal clone.',
      number,
    );
  }

  const reconciliation = rehearsal.reconciliation;
  let hasFinancialVariance = false;
  for (const amount of Object.values(
    reconciliation.financialVarianceMinorByCurrency,
  )) {
    if (!Number.isSafeInteger(amount)) {
      issue(
        issues,
        'CDB100_UNSAFE_INTEGER',
        'A financial reconciliation amount exceeded safe-integer bounds.',
        number,
      );
      continue;
    }
    if (amount !== 0) hasFinancialVariance = true;
  }
  if (hasFinancialVariance) {
    issue(
      issues,
      'CDB100_FINANCIAL_VARIANCE',
      'Financial reconciliation contains a non-zero variance.',
      number,
    );
  }
  if (
    !isSafeNonNegativeInteger(reconciliation.unexplainedVarianceCount)
    || reconciliation.unexplainedVarianceCount > 0
  ) {
    issue(
      issues,
      'CDB100_UNEXPLAINED_VARIANCE',
      'Unexplained reconciliation variance remains.',
      number,
    );
  }
  if (
    !isSafeNonNegativeInteger(reconciliation.unresolvedCriticalExceptionCount)
    || reconciliation.unresolvedCriticalExceptionCount > 0
  ) {
    issue(
      issues,
      'CDB100_CRITICAL_EXCEPTION',
      'Unresolved critical canonical exceptions remain.',
      number,
    );
  }
  if (
    !isSafeNonNegativeInteger(reconciliation.foreignKeyViolationCount)
    || reconciliation.foreignKeyViolationCount > 0
  ) {
    issue(
      issues,
      'CDB100_FOREIGN_KEY_VIOLATION',
      'Foreign-key violations remain.',
      number,
    );
  }
  if (
    !isSafeNonNegativeInteger(reconciliation.unsafeIntegerViolationCount)
    || reconciliation.unsafeIntegerViolationCount > 0
  ) {
    issue(
      issues,
      'CDB100_UNSAFE_INTEGER',
      'Unsafe integer evidence remains.',
      number,
    );
  }
  if (
    !isSafeNonNegativeInteger(reconciliation.tenantIsolationViolationCount)
    || reconciliation.tenantIsolationViolationCount > 0
  ) {
    issue(
      issues,
      'CDB100_TENANT_ISOLATION_VIOLATION',
      'Tenant-isolation violations remain.',
      number,
    );
  }
}

function validateProcessingAndFlags(
  rehearsal: CutoverRehearsalEvidence,
  issues: CutoverIssue[],
): void {
  const number = rehearsal.rehearsalNumber;
  const processing = rehearsal.processing;
  const countChecks: Array<[
    number,
    CutoverIssueCode,
    string,
  ]> = [
    [
      processing.failedOutboxItemCount,
      'CDB100_FAILED_OUTBOX_ITEM',
      'Failed canonical outbox items remain.',
    ],
    [
      processing.deadLetterOutboxItemCount,
      'CDB100_DEAD_LETTER_OUTBOX_ITEM',
      'Dead-letter canonical outbox items remain.',
    ],
    [
      processing.failedAccountingJobCount,
      'CDB100_FAILED_ACCOUNTING_JOB',
      'Failed accounting posting jobs remain.',
    ],
    [
      processing.retryAccountingJobCount,
      'CDB100_RETRY_ACCOUNTING_JOB',
      'Retrying accounting posting jobs remain.',
    ],
    [
      processing.deadLetterAccountingJobCount,
      'CDB100_DEAD_LETTER_ACCOUNTING_JOB',
      'Dead-letter accounting posting jobs remain.',
    ],
  ];
  for (const [count, code, summary] of countChecks) {
    if (!isSafeNonNegativeInteger(count) || count > 0) {
      issue(issues, code, summary, number);
    }
  }

  const flags = rehearsal.featureFlags;
  if (!flags.tenantScoped) {
    issue(
      issues,
      'CDB100_TENANT_FLAG_SCOPE_MISSING',
      'Feature-flag plans must be tenant scoped.',
      number,
    );
  }
  if (flags.globalSwitchPresent) {
    issue(
      issues,
      'CDB100_GLOBAL_FLAG_PROHIBITED',
      'A single global canonical cutover switch is prohibited.',
      number,
    );
  }
  if (flags.domainPlans.length === 0 || flags.domainPlans.some((plan) => (
    !isNonEmpty(plan.tenantId)
    || !isNonEmpty(plan.domain)
    || !isNonEmpty(plan.flagKey)
  ))) {
    issue(
      issues,
      'CDB100_DOMAIN_FLAG_PLAN_MISSING',
      'At least one complete tenant/domain flag plan is required.',
      number,
    );
  }
  if (flags.productionFlagsEnabled) {
    issue(
      issues,
      'CDB100_PRODUCTION_FLAG_ALREADY_ENABLED',
      'Production canonical flags were enabled before authorization.',
      number,
    );
  }
}

function validateSmokeRollbackAndMutation(
  evidence: CutoverReadinessEvidence,
  rehearsal: CutoverRehearsalEvidence,
  issues: CutoverIssue[],
): void {
  const number = rehearsal.rehearsalNumber;
  const smoke = rehearsal.smokeTests;
  if (!isNonEmpty(smoke.planId) || smoke.requiredScenarios.length === 0) {
    issue(
      issues,
      'CDB100_SMOKE_PLAN_MISSING',
      'A named non-empty domain smoke-test plan is required.',
      number,
    );
  }
  const passed = new Set(smoke.passedScenarios);
  if (smoke.requiredScenarios.some((scenario) => !passed.has(scenario))) {
    issue(
      issues,
      'CDB100_SMOKE_COVERAGE_INCOMPLETE',
      'Required smoke-test scenarios were not all completed successfully.',
      number,
    );
  }
  if (smoke.failedScenarios.length > 0) {
    issue(
      issues,
      'CDB100_SMOKE_TEST_FAILED',
      'At least one domain smoke test failed.',
      number,
    );
  }

  const rollback = rehearsal.rollback;
  if (!isNonEmpty(rollback.rollbackOwnerPublicId)) {
    issue(
      issues,
      'CDB100_ROLLBACK_OWNER_MISSING',
      'A named rollback owner is required.',
      number,
    );
  }
  if (!isNonEmpty(rollback.observationOwnerPublicId)) {
    issue(
      issues,
      'CDB100_OBSERVATION_OWNER_MISSING',
      'A named post-cutover observation owner is required.',
      number,
    );
  }
  if (!rollback.restoreVerified) {
    issue(
      issues,
      'CDB100_ROLLBACK_NOT_VERIFIED',
      'Rollback or restore was not verified.',
      number,
    );
  }
  if (!rollback.reopenVerified) {
    issue(
      issues,
      'CDB100_REOPEN_NOT_VERIFIED',
      'Reopen behavior was not verified.',
      number,
    );
  }
  if (!isPositiveDuration(rollback.rollbackDurationMs)) {
    issue(
      issues,
      'CDB100_ROLLBACK_DURATION_MISSING',
      'Rollback duration must be measured as a positive safe integer.',
      number,
    );
  }
  if (!isPositiveDuration(rollback.reopenDurationMs)) {
    issue(
      issues,
      'CDB100_REOPEN_DURATION_MISSING',
      'Reopen duration must be measured as a positive safe integer.',
      number,
    );
  }

  if (evidence.mode === 'rehearsal' && rehearsal.productionMutationAttempted) {
    issue(
      issues,
      'CDB100_PRODUCTION_MUTATION_ATTEMPTED',
      'A rehearsal attempted to mutate production.',
      number,
    );
  }
}

function validateAuthorization(
  evidence: CutoverReadinessEvidence,
  issues: CutoverIssue[],
): void {
  if (evidence.mode !== 'production' && !evidence.proposedProductionMutation) return;

  const authorization = evidence.authorization;
  if (
    !authorization?.authorized
    || !isNonEmpty(authorization.authorizationPublicId)
    || !isNonEmpty(authorization.domain)
  ) {
    issue(
      issues,
      'CDB100_PRODUCTION_AUTHORIZATION_MISSING',
      'Explicit named domain production authorization is required.',
    );
  }

  const generatedAt = Date.parse(evidence.generatedAtUtc);
  const expiresAt = Date.parse(authorization?.expiresAtUtc ?? '');
  if (
    !Number.isFinite(generatedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= generatedAt
  ) {
    issue(
      issues,
      'CDB100_PRODUCTION_AUTHORIZATION_EXPIRED',
      'Production authorization is missing a valid future expiry or has expired.',
    );
  }
}

function invalidEvidenceResult(): CutoverReadinessResult {
  const issues: CutoverIssue[] = [{
    code: 'CDB100_EVIDENCE_INVALID',
    severity: 'blocker',
    rehearsalNumber: null,
    summary: 'Cutover evidence was missing required runtime structure or contained invalid values.',
  }];
  return {
    schemaVersion: 1,
    decision: 'no_go',
    rehearsalReady: false,
    eligibleForProductionCutover: false,
    validatedRehearsalCount: 0,
    issueCount: issues.length,
    issues,
    totalDurationMs: 0,
    maxRollbackDurationMs: 0,
    maxReopenDurationMs: 0,
    productionMutationPerformed: false,
    aggregateOnly: true,
  };
}

function evaluateCutoverReadinessUnsafe(
  evidence: CutoverReadinessEvidence,
): CutoverReadinessResult {
  const issues: CutoverIssue[] = [];
  if (evidence.schemaVersion !== 1) {
    issue(
      issues,
      'CDB100_SCHEMA_VERSION_UNSUPPORTED',
      'Unsupported cutover evidence schema version.',
    );
  }

  const rehearsalIds = new Set(evidence.rehearsals.map((item) => item.rehearsalId));
  const rehearsalNumbers = new Set(
    evidence.rehearsals.map((item) => item.rehearsalNumber),
  );
  if (
    evidence.rehearsals.length < 2
    || rehearsalIds.size < 2
    || rehearsalNumbers.size < 2
  ) {
    issue(
      issues,
      'CDB100_REHEARSAL_COUNT_INSUFFICIENT',
      'At least two distinct complete staging-clone rehearsals are required.',
    );
  }
  if (rehearsalIds.size !== evidence.rehearsals.length) {
    issue(
      issues,
      'CDB100_REHEARSAL_ID_DUPLICATE',
      'Rehearsal identifiers must be unique.',
    );
  }

  let totalDurationMs = 0;
  let maxRollbackDurationMs = 0;
  let maxReopenDurationMs = 0;
  for (const rehearsal of evidence.rehearsals) {
    validateIdentity(evidence, rehearsal, issues);
    const duration = validateRunbookSequence(rehearsal, issues);
    validateBackupAndBackfill(rehearsal, issues);
    validateMigrationsAndReconciliation(rehearsal, issues);
    validateProcessingAndFlags(rehearsal, issues);
    validateSmokeRollbackAndMutation(evidence, rehearsal, issues);

    if (Number.isSafeInteger(totalDurationMs + duration)) {
      totalDurationMs += duration;
    } else {
      issue(
        issues,
        'CDB100_REHEARSAL_DURATION_INVALID',
        'Combined rehearsal duration exceeded safe-integer bounds.',
        rehearsal.rehearsalNumber,
      );
    }
    if (isPositiveDuration(rehearsal.rollback.rollbackDurationMs)) {
      maxRollbackDurationMs = Math.max(
        maxRollbackDurationMs,
        rehearsal.rollback.rollbackDurationMs,
      );
    }
    if (isPositiveDuration(rehearsal.rollback.reopenDurationMs)) {
      maxReopenDurationMs = Math.max(
        maxReopenDurationMs,
        rehearsal.rollback.reopenDurationMs,
      );
    }
  }

  const rehearsalReady = issues.length === 0;
  validateAuthorization(evidence, issues);
  issues.sort((left, right) => (
    left.code.localeCompare(right.code)
    || (left.rehearsalNumber ?? 0) - (right.rehearsalNumber ?? 0)
  ));

  const decision = issues.length === 0 ? 'go' : 'no_go';
  return {
    schemaVersion: 1,
    decision,
    rehearsalReady,
    eligibleForProductionCutover:
      evidence.mode === 'production'
      && evidence.proposedProductionMutation
      && decision === 'go',
    validatedRehearsalCount: evidence.rehearsals.length,
    issueCount: issues.length,
    issues,
    totalDurationMs,
    maxRollbackDurationMs,
    maxReopenDurationMs,
    productionMutationPerformed: false,
    aggregateOnly: true,
  };
}

export function evaluateCutoverReadiness(
  evidence: CutoverReadinessEvidence | unknown,
): CutoverReadinessResult {
  if (
    !evidence
    || typeof evidence !== 'object'
    || !Array.isArray((evidence as Partial<CutoverReadinessEvidence>).rehearsals)
  ) {
    return invalidEvidenceResult();
  }

  try {
    return evaluateCutoverReadinessUnsafe(evidence as CutoverReadinessEvidence);
  } catch {
    return invalidEvidenceResult();
  }
}

function parseEvidencePath(args: string[]): string {
  const index = args.indexOf('--evidence');
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('-')) {
    throw new Error('Usage: cutover-check.ts --evidence <aggregate-evidence.json>');
  }
  return resolve(args[index + 1]);
}

function main(): void {
  const evidencePath = parseEvidencePath(process.argv.slice(2));
  const evidence = JSON.parse(
    readFileSync(evidencePath, 'utf8'),
  ) as CutoverReadinessEvidence;
  const result = evaluateCutoverReadiness(evidence);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision !== 'go') process.exitCode = 2;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Canonical cutover check failed: ${message}\n`);
    process.exitCode = 1;
  }
}
