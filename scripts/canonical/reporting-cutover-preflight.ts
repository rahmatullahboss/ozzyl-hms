import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MIGRATIONS_R2_KEY } from '../../src/data/schema-migrations.generated';
import {
  assertReadOnlyWranglerArgs,
  inspectProductionIdentity,
  parseProductionConfig,
  type ReadOnlyCommandResult,
} from './inspect-production';
import { validateReportingCutoverAuthorization } from './production-cutover-contract';
import {
  parseReportingCutoverAuthorizationJson,
  parseReportingCutoverAuthorizationValue,
} from './reporting-cutover-authorization-document';

export const EXPECTED_CANONICAL_MIGRATIONS = [
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

export const REQUIRED_REPORTING_TABLES = [
  'canonical_feature_flags',
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
  'canonical_processing_issues',
  'canonical_outbox_events',
  'canonical_accounting_posting_jobs',
] as const;

export interface ReportingPreflightCommandResult extends ReadOnlyCommandResult {}
export type ReportingPreflightCommandRunner = (
  args: string[],
) => Promise<ReportingPreflightCommandResult>;

export interface ReportingCutoverPreflightEvidence {
  schemaVersion: 1;
  generatedAtUtc: string;
  domain: 'reporting';
  productionIdentity: {
    expectedDatabaseId: string;
    observedDatabaseId: string;
    accountMatched: boolean;
    remoteDatabaseMatched: boolean;
    manifestObjectFound: boolean;
    manifestChecksumMatched: boolean;
    inspectedAtUtc: string;
    maxAgeSeconds: number;
  };
  tenants: {
    activeTenantIds: string[];
    plannedTenantIds: string[];
    canaryTenantId: string | null;
  };
  schema: {
    canonicalTableNames: string[];
    appliedCanonicalMigrations: string[];
    unknownCanonicalMigrations: string[];
  };
  processing: {
    unresolvedCriticalExceptionCount: number | null;
    blockedOutboxCount: number | null;
    blockedAccountingCount: number | null;
    foreignKeyViolationCount: number;
  };
  flags: {
    reportingEnabledTenantIds: string[];
    globalSwitchEnabled: boolean;
    activeReportingRoutesSwitched: boolean | null;
  };
  authorization: {
    preparationAuthorized: boolean;
    productionExecutionAuthorized: boolean;
    authorizedDomain: string | null;
    expiresAtUtc: string | null;
  };
  maintenance: {
    windowStartUtc: string | null;
    windowEndUtc: string | null;
  };
  executionPlan: {
    authorizedTenantIds: string[];
    approvedMigrations: string[];
    deploymentAuthorized: boolean;
    deploymentVersion: string | null;
    migrationApplyAuthorized: boolean;
    productionImportAuthorized: boolean;
    productionImportCommandApproved: boolean;
    productionImportCommandId: string | null;
    shadowFlagAuthorized: boolean;
    shadowFlagTenantId: string | null;
    shadowFlagKey: string | null;
    shadowFlagDomain: string | null;
    shadowFlagInitialMode: string | null;
  };
  foreignKeyDisposition: {
    waiverApproved: boolean;
    waivedViolationCount: number;
    waiverEvidencePresent: boolean;
  };
  rollback: {
    rollbackOwnerAssigned: boolean;
    rollbackOwnerId: string | null;
    observationOwnerAssigned: boolean;
    observationOwnerId: string | null;
    maxRollbackDurationMs: number | null;
  };
  smoke: {
    planId: string;
    requiredScenarios: string[];
  };
  productionMutationAttempted: boolean;
}

export type ReportingPreflightIssueGate = 'preparation' | 'night';
export type ReportingPreflightIssueCode =
  | 'CDB101_EVIDENCE_INVALID'
  | 'CDB101_SCHEMA_VERSION_UNSUPPORTED'
  | 'CDB101_DOMAIN_MISMATCH'
  | 'CDB101_PRODUCTION_IDENTITY_MISMATCH'
  | 'CDB101_PRODUCTION_IDENTITY_UNVERIFIED'
  | 'CDB101_PRODUCTION_IDENTITY_STALE'
  | 'CDB101_PRODUCTION_MANIFEST_MISSING'
  | 'CDB101_PRODUCTION_MANIFEST_MISMATCH'
  | 'CDB101_ACTIVE_TENANTS_MISSING'
  | 'CDB101_PLANNED_TENANT_MISSING'
  | 'CDB101_PLANNED_TENANT_INACTIVE'
  | 'CDB101_CANARY_TENANT_MISSING'
  | 'CDB101_CANARY_TENANT_NOT_PLANNED'
  | 'CDB101_PREPARATION_AUTHORIZATION_MISSING'
  | 'CDB101_REPORTING_FLAG_ALREADY_ENABLED'
  | 'CDB101_GLOBAL_SWITCH_PROHIBITED'
  | 'CDB101_ACTIVE_ROUTE_ALREADY_SWITCHED'
  | 'CDB101_ACTIVE_ROUTE_EVIDENCE_UNAVAILABLE'
  | 'CDB101_UNKNOWN_CANONICAL_MIGRATION'
  | 'CDB101_SMOKE_PLAN_MISSING'
  | 'CDB101_ROLLBACK_OWNER_MISSING'
  | 'CDB101_OBSERVATION_OWNER_MISSING'
  | 'CDB101_ROLLBACK_THRESHOLD_INVALID'
  | 'CDB101_PRODUCTION_MUTATION_ATTEMPTED'
  | 'CDB101_CANONICAL_SCHEMA_NOT_APPLIED'
  | 'CDB101_CANONICAL_SCHEMA_INCOMPLETE'
  | 'CDB101_PENDING_CANONICAL_MIGRATIONS'
  | 'CDB101_PROCESSING_EVIDENCE_UNAVAILABLE'
  | 'CDB101_CRITICAL_EXCEPTION'
  | 'CDB101_BLOCKED_OUTBOX'
  | 'CDB101_BLOCKED_ACCOUNTING'
  | 'CDB101_FOREIGN_KEY_VIOLATION'
  | 'CDB101_EXECUTION_AUTHORIZATION_MISSING'
  | 'CDB101_EXECUTION_AUTHORIZATION_DOMAIN_MISMATCH'
  | 'CDB101_EXECUTION_AUTHORIZATION_EXPIRED'
  | 'CDB101_MAINTENANCE_WINDOW_MISSING'
  | 'CDB101_MAINTENANCE_WINDOW_INVALID'
  | 'CDB101_AUTHORIZED_TENANT_SCOPE_MISMATCH'
  | 'CDB101_AUTHORIZED_MIGRATION_SCOPE_MISMATCH'
  | 'CDB101_DEPLOYMENT_AUTHORIZATION_MISSING'
  | 'CDB101_MIGRATION_AUTHORIZATION_MISSING'
  | 'CDB101_PRODUCTION_IMPORT_AUTHORIZATION_MISSING'
  | 'CDB101_PRODUCTION_IMPORT_COMMAND_MISSING'
  | 'CDB101_SHADOW_FLAG_AUTHORIZATION_MISSING'
  | 'CDB101_AUTHORIZATION_CONTRACT_INVALID';

export interface ReportingPreflightIssue {
  code: ReportingPreflightIssueCode;
  gate: ReportingPreflightIssueGate;
  severity: 'blocker';
  summary: string;
}

export interface ReportingCutoverPreflightResult {
  schemaVersion: 1;
  domain: 'reporting';
  preparationReady: boolean;
  nightExecutionReady: boolean;
  issueCount: number;
  issues: ReportingPreflightIssue[];
  activeTenantCount: number;
  plannedTenantCount: number;
  recommendedCanaryTenantId: string | null;
  canonicalTableCount: number;
  requiredReportingTableCount: number;
  missingRequiredReportingTableCount: number;
  appliedCanonicalMigrationCount: number;
  pendingCanonicalMigrationCount: number;
  reportingEnabledTenantCount: number;
  foreignKeyViolationCount: number;
  productionMutationPerformed: false;
  aggregateOnly: true;
}

export interface ReportingDatabaseEvidence {
  activeTenantIds: string[];
  canonicalTableNames: string[];
  appliedCanonicalMigrations: string[];
  unknownCanonicalMigrations: string[];
  reportingEnabledTenantIds: string[];
  globalSwitchEnabled: boolean;
  unresolvedCriticalExceptionCount: number | null;
  blockedOutboxCount: number | null;
  blockedAccountingCount: number | null;
  foreignKeyViolationCount: number;
  changedDb: boolean;
  rowsWritten: number;
}

interface D1Envelope {
  results?: unknown[];
  success?: boolean;
  meta?: {
    changed_db?: boolean;
    rows_written?: number;
  };
}

interface BaseAggregateRow {
  active_tenant_count?: number;
  active_tenant_ids_json?: string;
  canonical_table_names_json?: string;
  applied_canonical_migrations_json?: string;
  global_switch_count?: number;
  fk_violations?: number;
}

interface FlagAggregateRow {
  reporting_enabled_tenant_ids_json?: string;
}

interface ProcessingAggregateRow {
  unresolved_critical?: number;
  blocked_outbox?: number;
  blocked_accounting?: number;
  fk_violations?: number;
}

interface CollectReportingDatabaseEvidenceOptions {
  databaseName: string;
  runner: ReportingPreflightCommandRunner;
}

interface CliAuthorizationFile {
  schemaVersion?: number;
  productionExecutionAuthorized?: boolean;
  authorizedDomain?: string | null;
  authorizedTenantIds?: string[];
  expiresAtUtc?: string | null;
  maintenanceWindowStartUtc?: string | null;
  maintenanceWindowEndUtc?: string | null;
  activeReportingRoutesSwitched?: boolean | null;
  deploymentAuthorized?: boolean;
  deploymentVersion?: string | null;
  deployment?: {
    authorized?: boolean;
    candidateWorkerVersionId?: string | null;
  };
  migrationApplyAuthorized?: boolean;
  approvedMigrations?: string[];
  migrations?: {
    authorized?: boolean;
    approvedMigrations?: string[];
  };
  productionImportAuthorized?: boolean;
  productionImportCommandApproved?: boolean;
  productionImportCommandId?: string | null;
  productionImport?: {
    authorized?: boolean;
    commandApproved?: boolean;
    commandId?: string | null;
  };
  featureFlagPlan?: {
    authorized?: boolean;
    tenantId?: string | null;
    flagKey?: string | null;
    domain?: string | null;
    initialMode?: string | null;
    shadowModeAuthorized?: boolean;
  };
  foreignKeyDisposition?: {
    waiverApproved?: boolean;
    currentViolationCount?: number;
    waivedViolationCount?: number;
    waiverEvidencePresent?: boolean;
    groups?: Array<{
      remainingViolationCount?: number;
      waivedViolationCount?: number;
      disposition?: string;
      ownerId?: string | null;
      evidenceId?: string | null;
    }>;
  };
  rollbackOwnerAssigned?: boolean;
  rollbackOwnerId?: string | null;
  rollbackOwner?: {
    assigned?: boolean;
    ownerId?: string | null;
  };
  observationOwnerAssigned?: boolean;
  observationOwnerId?: string | null;
  observationOwner?: {
    assigned?: boolean;
    ownerId?: string | null;
  };
  maxRollbackDurationMs?: number | null;
  rollbackPolicy?: {
    maxRollbackDurationMs?: number | null;
  };
  smokePlanId?: string;
  requiredSmokeScenarios?: string[];
  smoke?: {
    planId?: string | null;
    requiredScenarios?: string[];
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function deriveForeignKeyWaiverAuthorization(
  disposition: CliAuthorizationFile['foreignKeyDisposition'],
  schemaVersion: number = 1,
): {
  waiverApproved: boolean;
  waivedViolationCount: number;
  waiverEvidencePresent: boolean;
} {
  const groups = disposition?.groups ?? [];
  if (groups.length === 0) {
    if (schemaVersion >= 2) {
      return {
        waiverApproved: false,
        waivedViolationCount: 0,
        waiverEvidencePresent: false,
      };
    }
    return {
      waiverApproved: disposition?.waiverApproved === true,
      waivedViolationCount: disposition?.waivedViolationCount ?? 0,
      waiverEvidencePresent: disposition?.waiverEvidencePresent === true,
    };
  }
  const waivedViolationCount = groups.reduce(
    (sum, group) => sum + (
      safeNonNegativeInteger(group.waivedViolationCount)
        ? group.waivedViolationCount
        : 0
    ),
    0,
  );
  const waivedGroups = groups.filter((group) => (group.waivedViolationCount ?? 0) > 0);
  const waiverEvidencePresent = waivedGroups.length > 0 && waivedGroups.every((group) => (
    group.disposition === 'formal_waiver'
    && safeNonNegativeInteger(group.remainingViolationCount)
    && group.waivedViolationCount === group.remainingViolationCount
    && nonEmpty(group.ownerId)
    && nonEmpty(group.evidenceId)
  ));
  return {
    waiverApproved: waiverEvidencePresent,
    waivedViolationCount,
    waiverEvidencePresent,
  };
}

function uniqueSortedStrings(values: readonly unknown[]): string[] {
  return [...new Set(
    values
      .filter(nonEmpty)
      .map((value) => value.trim()),
  )].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function exactStringSet(left: readonly unknown[], right: readonly unknown[]): boolean {
  const normalizedLeft = uniqueSortedStrings(left);
  const normalizedRight = uniqueSortedStrings(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function addIssue(
  issues: ReportingPreflightIssue[],
  gate: ReportingPreflightIssueGate,
  code: ReportingPreflightIssueCode,
  summary: string,
): void {
  issues.push({ code, gate, severity: 'blocker', summary });
}

function invalidResult(): ReportingCutoverPreflightResult {
  const issues: ReportingPreflightIssue[] = [{
    code: 'CDB101_EVIDENCE_INVALID',
    gate: 'preparation',
    severity: 'blocker',
    summary: 'Reporting cutover evidence is missing required runtime structure or contains invalid values.',
  }];
  return {
    schemaVersion: 1,
    domain: 'reporting',
    preparationReady: false,
    nightExecutionReady: false,
    issueCount: issues.length,
    issues,
    activeTenantCount: 0,
    plannedTenantCount: 0,
    recommendedCanaryTenantId: null,
    canonicalTableCount: 0,
    requiredReportingTableCount: REQUIRED_REPORTING_TABLES.length,
    missingRequiredReportingTableCount: REQUIRED_REPORTING_TABLES.length,
    appliedCanonicalMigrationCount: 0,
    pendingCanonicalMigrationCount: EXPECTED_CANONICAL_MIGRATIONS.length,
    reportingEnabledTenantCount: 0,
    foreignKeyViolationCount: 0,
    productionMutationPerformed: false,
    aggregateOnly: true,
  };
}

function evaluateUnsafe(
  evidence: ReportingCutoverPreflightEvidence,
): ReportingCutoverPreflightResult {
  const issues: ReportingPreflightIssue[] = [];
  if (evidence.schemaVersion !== 1) {
    addIssue(issues, 'preparation', 'CDB101_SCHEMA_VERSION_UNSUPPORTED', 'Unsupported reporting preflight evidence schema version.');
  }
  if (evidence.domain !== 'reporting') {
    addIssue(issues, 'preparation', 'CDB101_DOMAIN_MISMATCH', 'The preparation package must target only the reporting domain.');
  }

  const identity = evidence.productionIdentity;
  if (
    !nonEmpty(identity.expectedDatabaseId)
    || identity.expectedDatabaseId !== identity.observedDatabaseId
    || !identity.remoteDatabaseMatched
  ) {
    addIssue(issues, 'preparation', 'CDB101_PRODUCTION_IDENTITY_MISMATCH', 'The observed production database did not match the exact configured database identity.');
  }
  if (!identity.accountMatched) {
    addIssue(issues, 'preparation', 'CDB101_PRODUCTION_IDENTITY_UNVERIFIED', 'Production account identity was not verified.');
  }
  if (!identity.manifestObjectFound) {
    addIssue(issues, 'night', 'CDB101_PRODUCTION_MANIFEST_MISSING', 'The approved repository migration manifest object is not present in production storage.');
  }
  if (!identity.manifestChecksumMatched) {
    addIssue(issues, 'night', 'CDB101_PRODUCTION_MANIFEST_MISMATCH', 'The production migration manifest does not match the approved repository manifest.');
  }
  const generatedAtMs = Date.parse(evidence.generatedAtUtc);
  const inspectedAtMs = Date.parse(identity.inspectedAtUtc);
  const maxAgeMs = identity.maxAgeSeconds * 1000;
  if (
    !Number.isFinite(generatedAtMs)
    || !Number.isFinite(inspectedAtMs)
    || !safeNonNegativeInteger(identity.maxAgeSeconds)
    || inspectedAtMs > generatedAtMs
    || generatedAtMs - inspectedAtMs > maxAgeMs
  ) {
    addIssue(issues, 'preparation', 'CDB101_PRODUCTION_IDENTITY_STALE', 'Production identity evidence is invalid, future-dated, or stale.');
  }

  const activeTenantIds = uniqueSortedStrings(evidence.tenants.activeTenantIds);
  const plannedTenantIds = uniqueSortedStrings(evidence.tenants.plannedTenantIds);
  if (activeTenantIds.length === 0) {
    addIssue(issues, 'preparation', 'CDB101_ACTIVE_TENANTS_MISSING', 'No active production tenant IDs were found.');
  }
  if (plannedTenantIds.length === 0) {
    addIssue(issues, 'preparation', 'CDB101_PLANNED_TENANT_MISSING', 'At least one tenant must be selected for the reporting wave.');
  }
  if (plannedTenantIds.some((tenantId) => !activeTenantIds.includes(tenantId))) {
    addIssue(issues, 'preparation', 'CDB101_PLANNED_TENANT_INACTIVE', 'A planned reporting tenant is not active in the current production evidence.');
  }
  const canaryTenantId = nonEmpty(evidence.tenants.canaryTenantId)
    ? evidence.tenants.canaryTenantId.trim()
    : null;
  if (!canaryTenantId) {
    addIssue(issues, 'preparation', 'CDB101_CANARY_TENANT_MISSING', 'A single canary tenant must be named for the first reporting wave.');
  } else if (!plannedTenantIds.includes(canaryTenantId)) {
    addIssue(issues, 'preparation', 'CDB101_CANARY_TENANT_NOT_PLANNED', 'The canary tenant must be included in the planned tenant set.');
  }

  if (!evidence.authorization.preparationAuthorized) {
    addIssue(issues, 'preparation', 'CDB101_PREPARATION_AUTHORIZATION_MISSING', 'The owner has not authorized the non-mutating preparation package.');
  }
  if (evidence.flags.reportingEnabledTenantIds.length > 0) {
    addIssue(issues, 'preparation', 'CDB101_REPORTING_FLAG_ALREADY_ENABLED', 'A reporting cutover flag is already enabled before the maintenance-window gate.');
  }
  if (evidence.flags.globalSwitchEnabled) {
    addIssue(issues, 'preparation', 'CDB101_GLOBAL_SWITCH_PROHIBITED', 'A global database switch is enabled or planned; only tenant-scoped domain flags are allowed.');
  }
  if (evidence.flags.activeReportingRoutesSwitched === true) {
    addIssue(issues, 'preparation', 'CDB101_ACTIVE_ROUTE_ALREADY_SWITCHED', 'Active reporting routes were switched before the authorized cutover window.');
  } else if (evidence.flags.activeReportingRoutesSwitched === null) {
    addIssue(issues, 'night', 'CDB101_ACTIVE_ROUTE_EVIDENCE_UNAVAILABLE', 'The deployed production Worker has not yet been verified to leave active reporting routes unchanged.');
  }
  if (evidence.schema.unknownCanonicalMigrations.length > 0) {
    addIssue(issues, 'preparation', 'CDB101_UNKNOWN_CANONICAL_MIGRATION', 'Production contains a canonical migration outside the approved 0505 through 0515 set.');
  }
  if (!nonEmpty(evidence.smoke.planId) || evidence.smoke.requiredScenarios.length === 0) {
    addIssue(issues, 'preparation', 'CDB101_SMOKE_PLAN_MISSING', 'A named non-empty reporting smoke-test plan is required.');
  }

  const executionPlan = evidence.executionPlan;
  if (!exactStringSet(executionPlan.authorizedTenantIds, plannedTenantIds)) {
    addIssue(issues, 'night', 'CDB101_AUTHORIZED_TENANT_SCOPE_MISMATCH', 'Production authorization tenant scope does not exactly match the planned reporting tenant set.');
  }
  if (!exactStringSet(executionPlan.approvedMigrations, EXPECTED_CANONICAL_MIGRATIONS)) {
    addIssue(issues, 'night', 'CDB101_AUTHORIZED_MIGRATION_SCOPE_MISMATCH', 'Production authorization does not approve exactly canonical migrations 0505 through 0515.');
  }
  if (!executionPlan.deploymentAuthorized || !nonEmpty(executionPlan.deploymentVersion)) {
    addIssue(issues, 'night', 'CDB101_DEPLOYMENT_AUTHORIZATION_MISSING', 'The exact reviewed Worker deployment version is not authorized.');
  }
  if (!executionPlan.migrationApplyAuthorized) {
    addIssue(issues, 'night', 'CDB101_MIGRATION_AUTHORIZATION_MISSING', 'Production application of the approved canonical migration set is not authorized.');
  }
  if (!executionPlan.productionImportAuthorized) {
    addIssue(issues, 'night', 'CDB101_PRODUCTION_IMPORT_AUTHORIZATION_MISSING', 'The deterministic production canonical import is not authorized.');
  }
  if (!executionPlan.productionImportCommandApproved || !nonEmpty(executionPlan.productionImportCommandId)) {
    addIssue(issues, 'night', 'CDB101_PRODUCTION_IMPORT_COMMAND_MISSING', 'No exact reviewed production import command identifier is approved.');
  }
  if (
    !executionPlan.shadowFlagAuthorized
    || executionPlan.shadowFlagTenantId !== canaryTenantId
    || executionPlan.shadowFlagKey !== 'canonical_reporting_v1'
    || executionPlan.shadowFlagDomain !== 'reporting'
    || executionPlan.shadowFlagInitialMode !== 'shadow'
  ) {
    addIssue(issues, 'night', 'CDB101_SHADOW_FLAG_AUTHORIZATION_MISSING', 'The exact tenant-scoped canonical reporting shadow flag plan is not authorized.');
  }

  if (
    !evidence.rollback.rollbackOwnerAssigned
    || !nonEmpty(evidence.rollback.rollbackOwnerId)
  ) {
    addIssue(issues, 'night', 'CDB101_ROLLBACK_OWNER_MISSING', 'A named rollback owner must be assigned before the reporting wave executes.');
  }
  if (
    !evidence.rollback.observationOwnerAssigned
    || !nonEmpty(evidence.rollback.observationOwnerId)
  ) {
    addIssue(issues, 'night', 'CDB101_OBSERVATION_OWNER_MISSING', 'A named post-cutover observation owner must be assigned before the reporting wave executes.');
  }
  if (
    evidence.rollback.maxRollbackDurationMs === null
    || !Number.isSafeInteger(evidence.rollback.maxRollbackDurationMs)
    || evidence.rollback.maxRollbackDurationMs <= 0
  ) {
    addIssue(issues, 'night', 'CDB101_ROLLBACK_THRESHOLD_INVALID', 'The maximum accepted rollback duration must be a positive safe integer before execution.');
  }
  if (evidence.productionMutationAttempted) {
    addIssue(issues, 'preparation', 'CDB101_PRODUCTION_MUTATION_ATTEMPTED', 'The preparation phase attempted to mutate production.');
  }

  const canonicalTableNames = uniqueSortedStrings(evidence.schema.canonicalTableNames);
  const requiredTableSet = new Set<string>(REQUIRED_REPORTING_TABLES);
  const missingRequiredTables = REQUIRED_REPORTING_TABLES.filter(
    (tableName) => !canonicalTableNames.includes(tableName),
  );
  if (canonicalTableNames.length === 0) {
    addIssue(issues, 'night', 'CDB101_CANONICAL_SCHEMA_NOT_APPLIED', 'Canonical production schema has not been applied.');
  } else if (missingRequiredTables.length > 0) {
    addIssue(issues, 'night', 'CDB101_CANONICAL_SCHEMA_INCOMPLETE', 'One or more reporting-required canonical tables are missing.');
  }

  const appliedCanonicalMigrations = uniqueSortedStrings(
    evidence.schema.appliedCanonicalMigrations,
  );
  const pendingCanonicalMigrations = EXPECTED_CANONICAL_MIGRATIONS.filter(
    (migration) => !appliedCanonicalMigrations.includes(migration),
  );
  if (pendingCanonicalMigrations.length > 0) {
    addIssue(issues, 'night', 'CDB101_PENDING_CANONICAL_MIGRATIONS', 'Approved canonical migrations remain pending in production.');
  }

  const processing = evidence.processing;
  if (
    processing.unresolvedCriticalExceptionCount === null
    || processing.blockedOutboxCount === null
    || processing.blockedAccountingCount === null
  ) {
    addIssue(issues, 'night', 'CDB101_PROCESSING_EVIDENCE_UNAVAILABLE', 'Canonical critical-issue and queue evidence is unavailable until the schema exists.');
  } else {
    if (!safeNonNegativeInteger(processing.unresolvedCriticalExceptionCount) || processing.unresolvedCriticalExceptionCount > 0) {
      addIssue(issues, 'night', 'CDB101_CRITICAL_EXCEPTION', 'Unresolved critical canonical processing issues remain.');
    }
    if (!safeNonNegativeInteger(processing.blockedOutboxCount) || processing.blockedOutboxCount > 0) {
      addIssue(issues, 'night', 'CDB101_BLOCKED_OUTBOX', 'Retry or dead-letter canonical outbox items remain.');
    }
    if (!safeNonNegativeInteger(processing.blockedAccountingCount) || processing.blockedAccountingCount > 0) {
      addIssue(issues, 'night', 'CDB101_BLOCKED_ACCOUNTING', 'Retry, failed, or dead-letter accounting jobs remain.');
    }
  }
  const foreignKeyDisposition = evidence.foreignKeyDisposition;
  const foreignKeyCountIsValid = safeNonNegativeInteger(processing.foreignKeyViolationCount);
  const exactForeignKeyWaiver = foreignKeyCountIsValid
    && processing.foreignKeyViolationCount > 0
    && foreignKeyDisposition.waiverApproved
    && foreignKeyDisposition.waiverEvidencePresent
    && safeNonNegativeInteger(foreignKeyDisposition.waivedViolationCount)
    && foreignKeyDisposition.waivedViolationCount === processing.foreignKeyViolationCount;
  if (
    !foreignKeyCountIsValid
    || (processing.foreignKeyViolationCount > 0 && !exactForeignKeyWaiver)
  ) {
    addIssue(issues, 'night', 'CDB101_FOREIGN_KEY_VIOLATION', 'Foreign-key violations remain without an exact reviewed waiver matching the current aggregate count.');
  }

  const authorization = evidence.authorization;
  if (!authorization.productionExecutionAuthorized) {
    addIssue(issues, 'night', 'CDB101_EXECUTION_AUTHORIZATION_MISSING', 'Named-domain production execution authorization is absent.');
  }
  if (authorization.authorizedDomain !== 'reporting') {
    addIssue(issues, 'night', 'CDB101_EXECUTION_AUTHORIZATION_DOMAIN_MISMATCH', 'Production authorization does not name the reporting domain.');
  }
  const expiresAtMs = Date.parse(authorization.expiresAtUtc ?? '');
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(generatedAtMs) || expiresAtMs <= generatedAtMs) {
    addIssue(issues, 'night', 'CDB101_EXECUTION_AUTHORIZATION_EXPIRED', 'Production authorization is missing a valid future expiry or has expired.');
  }

  const windowStartMs = Date.parse(evidence.maintenance.windowStartUtc ?? '');
  const windowEndMs = Date.parse(evidence.maintenance.windowEndUtc ?? '');
  if (!evidence.maintenance.windowStartUtc || !evidence.maintenance.windowEndUtc) {
    addIssue(issues, 'night', 'CDB101_MAINTENANCE_WINDOW_MISSING', 'The production maintenance window is not yet named.');
  } else if (
    !Number.isFinite(windowStartMs)
    || !Number.isFinite(windowEndMs)
    || windowStartMs >= windowEndMs
    || (Number.isFinite(expiresAtMs) && windowEndMs > expiresAtMs)
  ) {
    addIssue(issues, 'night', 'CDB101_MAINTENANCE_WINDOW_INVALID', 'The maintenance window is invalid, reversed, or exceeds authorization expiry.');
  }

  issues.sort((left, right) => (
    left.code.localeCompare(right.code)
    || left.gate.localeCompare(right.gate)
  ));
  const preparationReady = !issues.some((item) => item.gate === 'preparation');
  const nightExecutionReady = issues.length === 0;
  const reportingEnabledTenantIds = uniqueSortedStrings(
    evidence.flags.reportingEnabledTenantIds,
  );

  return {
    schemaVersion: 1,
    domain: 'reporting',
    preparationReady,
    nightExecutionReady,
    issueCount: issues.length,
    issues,
    activeTenantCount: activeTenantIds.length,
    plannedTenantCount: plannedTenantIds.length,
    recommendedCanaryTenantId: canaryTenantId,
    canonicalTableCount: canonicalTableNames.length,
    requiredReportingTableCount: requiredTableSet.size,
    missingRequiredReportingTableCount: missingRequiredTables.length,
    appliedCanonicalMigrationCount: appliedCanonicalMigrations.length,
    pendingCanonicalMigrationCount: pendingCanonicalMigrations.length,
    reportingEnabledTenantCount: reportingEnabledTenantIds.length,
    foreignKeyViolationCount: safeNonNegativeInteger(processing.foreignKeyViolationCount)
      ? processing.foreignKeyViolationCount
      : 0,
    productionMutationPerformed: false,
    aggregateOnly: true,
  };
}

export function evaluateReportingCutoverPreflight(
  evidence: ReportingCutoverPreflightEvidence | unknown,
): ReportingCutoverPreflightResult {
  if (
    !evidence
    || typeof evidence !== 'object'
    || !('productionIdentity' in evidence)
    || !('tenants' in evidence)
    || !('schema' in evidence)
    || !('processing' in evidence)
    || !('flags' in evidence)
    || !('authorization' in evidence)
    || !('maintenance' in evidence)
    || !('executionPlan' in evidence)
    || !('foreignKeyDisposition' in evidence)
    || !('rollback' in evidence)
    || !('smoke' in evidence)
  ) {
    return invalidResult();
  }
  try {
    return evaluateUnsafe(evidence as ReportingCutoverPreflightEvidence);
  } catch {
    return invalidResult();
  }
}

export function enforceSchemaV2AuthorizationContract(
  result: ReportingCutoverPreflightResult,
  authorization: unknown,
  atUtc: string,
): ReportingCutoverPreflightResult {
  if (
    !authorization
    || typeof authorization !== 'object'
    || !('schemaVersion' in authorization)
    || ![2, 3, 4].includes((authorization as { schemaVersion?: number }).schemaVersion ?? 0)
  ) {
    return result;
  }
  if (!result.nightExecutionReady) return result;

  const document = parseReportingCutoverAuthorizationValue(authorization);
  let issueCount = Math.max(1, document.issues.length);
  if (document.documentReady && document.authorization) {
    const validation = validateReportingCutoverAuthorization(
      document.authorization,
      atUtc,
    );
    if (validation.executionReady) return result;
    issueCount = Math.max(1, validation.issues.length);
  }

  if (result.issues.some((issue) => issue.code === 'CDB101_AUTHORIZATION_CONTRACT_INVALID')) {
    return { ...result, nightExecutionReady: false };
  }

  const issues: ReportingPreflightIssue[] = [
    ...result.issues,
    {
      code: 'CDB101_AUTHORIZATION_CONTRACT_INVALID',
      gate: 'night',
      severity: 'blocker',
      summary: `Protected production authorization contract has ${issueCount} unresolved issue(s).`,
    },
  ];
  return {
    ...result,
    nightExecutionReady: false,
    issueCount: issues.length,
    issues,
  };
}

function stripSqlLiteralsAndComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function assertSingleReadOnlySelect(sql: string): void {
  const normalized = stripSqlLiteralsAndComments(sql).trim();
  const withoutFinalSemicolon = normalized.endsWith(';')
    ? normalized.slice(0, -1).trim()
    : normalized;
  if (!/^(SELECT|WITH)\b/i.test(withoutFinalSemicolon)) {
    throw new Error('Reporting preflight SQL must be read-only SELECT evidence.');
  }
  if (withoutFinalSemicolon.includes(';')) {
    throw new Error('Reporting preflight SQL must contain exactly one read-only statement.');
  }
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(withoutFinalSemicolon)) {
    throw new Error('Reporting preflight SQL contains a non-read-only token.');
  }
}

export function assertReadOnlyReportingPreflightArgs(args: string[]): void {
  if (args[0] === 'd1' && args[1] === 'execute') {
    if (
      args.length !== 9
      || !nonEmpty(args[2])
      || args[3] !== '--remote'
      || args[4] !== '--env'
      || args[5] !== 'production'
      || args[6] !== '--json'
      || args[7] !== '--command'
      || !nonEmpty(args[8])
    ) {
      throw new Error('Reporting preflight D1 command must target the exact remote production environment.');
    }
    assertSingleReadOnlySelect(args[8]);
    return;
  }
  assertReadOnlyWranglerArgs(args);
}

export function createReportingPreflightRunner(
  root: string,
): ReportingPreflightCommandRunner {
  return async (args) => {
    assertReadOnlyReportingPreflightArgs(args);
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
      },
    });
    if (result.error) throw result.error;
    return {
      stdout: Buffer.isBuffer(result.stdout)
        ? result.stdout
        : Buffer.from(result.stdout ?? ''),
      stderr: Buffer.isBuffer(result.stderr)
        ? result.stderr
        : Buffer.from(result.stderr ?? ''),
      exitCode: result.status ?? 1,
    };
  };
}

function extractJsonDocument(text: string): unknown {
  const candidates: Array<[number, number]> = [];
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push([arrayStart, arrayEnd + 1]);
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push([objectStart, objectEnd + 1]);
  candidates.sort((left, right) => left[0] - right[0]);
  for (const [start, end] of candidates) {
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      // Continue to the next bounded JSON candidate.
    }
  }
  throw new Error('Wrangler output did not contain valid JSON.');
}

function parseStringArray(value: unknown, label: string): string[] {
  if (Array.isArray(value)) return uniqueSortedStrings(value);
  if (!nonEmpty(value)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} was not a JSON array.`);
  return uniqueSortedStrings(parsed);
}

function assertSuccessfulReadOnlyQuery(
  result: ReportingPreflightCommandResult,
  label: string,
): { envelope: D1Envelope; row: Record<string, unknown> } {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  const decoded = extractJsonDocument(result.stdout.toString('utf8'));
  if (!Array.isArray(decoded) || decoded.length !== 1) {
    throw new Error(`${label} did not return exactly one D1 query envelope.`);
  }
  const envelope = decoded[0] as D1Envelope;
  if (!envelope.success || !Array.isArray(envelope.results) || envelope.results.length !== 1) {
    throw new Error(`${label} did not return exactly one successful aggregate row.`);
  }
  if (envelope.meta?.changed_db !== false || (envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error(`${label} violated the production read-only boundary.`);
  }
  return {
    envelope,
    row: envelope.results[0] as Record<string, unknown>,
  };
}

const BASE_AGGREGATE_SQL = `
SELECT
  (SELECT COUNT(*) FROM tenants WHERE status='active') AS active_tenant_count,
  (SELECT COALESCE(json_group_array(CAST(id AS TEXT)),'[]')
     FROM (SELECT id FROM tenants WHERE status='active' ORDER BY id)) AS active_tenant_ids_json,
  (SELECT COALESCE(json_group_array(name),'[]')
     FROM (SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'canonical_%' ORDER BY name)) AS canonical_table_names_json,
  (SELECT COALESCE(json_group_array(name),'[]')
     FROM (SELECT name FROM d1_migrations WHERE instr(name,'_canonical_')>0 ORDER BY name)) AS applied_canonical_migrations_json,
  (SELECT COUNT(*)
     FROM settings
     WHERE key IN ('new_database','new_database=true')
       AND lower(trim(value)) IN ('1','true','on','enabled')) AS global_switch_count,
  (SELECT COUNT(*) FROM pragma_foreign_key_check) AS fk_violations;
`.trim();

const FLAG_AGGREGATE_SQL = `
SELECT COALESCE(json_group_array(tenant_id),'[]') AS reporting_enabled_tenant_ids_json
FROM (
  SELECT DISTINCT tenant_id
  FROM canonical_feature_flags
  WHERE flag_key='canonical_reporting_v1'
    AND is_enabled=1
    AND mode IN ('shadow','canonical')
  ORDER BY tenant_id
);
`.trim();

const PROCESSING_AGGREGATE_SQL = `
SELECT
  (SELECT COUNT(*)
     FROM canonical_processing_issues
     WHERE severity='critical' AND status NOT IN ('resolved','waived')) AS unresolved_critical,
  (SELECT COUNT(*)
     FROM canonical_outbox_events
     WHERE status IN ('retry','dead_letter')) AS blocked_outbox,
  (SELECT COUNT(*)
     FROM canonical_accounting_posting_jobs
     WHERE status IN ('retry','dead_letter')) AS blocked_accounting,
  (SELECT COUNT(*) FROM pragma_foreign_key_check) AS fk_violations;
`.trim();

export async function collectReportingDatabaseEvidence(
  options: CollectReportingDatabaseEvidenceOptions,
): Promise<ReportingDatabaseEvidence> {
  const baseResult = await options.runner([
    'd1',
    'execute',
    options.databaseName,
    '--remote',
    '--env',
    'production',
    '--json',
    '--command',
    BASE_AGGREGATE_SQL,
  ]);
  const base = assertSuccessfulReadOnlyQuery(baseResult, 'reporting base preflight');
  const baseRow = base.row as BaseAggregateRow;
  const activeTenantIds = parseStringArray(baseRow.active_tenant_ids_json, 'active tenant IDs');
  const canonicalTableNames = parseStringArray(baseRow.canonical_table_names_json, 'canonical table names');
  const appliedCanonicalMigrations = parseStringArray(
    baseRow.applied_canonical_migrations_json,
    'applied canonical migrations',
  );
  let reportingEnabledTenantIds: string[] = [];
  const unknownCanonicalMigrations = appliedCanonicalMigrations.filter(
    (migration) => !EXPECTED_CANONICAL_MIGRATIONS.includes(
      migration as (typeof EXPECTED_CANONICAL_MIGRATIONS)[number],
    ),
  );

  let unresolvedCriticalExceptionCount: number | null = null;
  let blockedOutboxCount: number | null = null;
  let blockedAccountingCount: number | null = null;
  let foreignKeyViolationCount = Number(baseRow.fk_violations ?? 0);
  let changedDb = base.envelope.meta?.changed_db ?? false;
  let rowsWritten = base.envelope.meta?.rows_written ?? 0;

  if (canonicalTableNames.includes('canonical_feature_flags')) {
    const flagResult = await options.runner([
      'd1',
      'execute',
      options.databaseName,
      '--remote',
      '--env',
      'production',
      '--json',
      '--command',
      FLAG_AGGREGATE_SQL,
    ]);
    const flags = assertSuccessfulReadOnlyQuery(
      flagResult,
      'reporting feature-flag preflight',
    );
    const flagRow = flags.row as FlagAggregateRow;
    reportingEnabledTenantIds = parseStringArray(
      flagRow.reporting_enabled_tenant_ids_json,
      'reporting enabled tenant IDs',
    );
    changedDb = changedDb || (flags.envelope.meta?.changed_db ?? false);
    rowsWritten += flags.envelope.meta?.rows_written ?? 0;
  }

  const processingTablesPresent = [
    'canonical_processing_issues',
    'canonical_outbox_events',
    'canonical_accounting_posting_jobs',
  ].every((tableName) => canonicalTableNames.includes(tableName));
  if (processingTablesPresent) {
    const processingResult = await options.runner([
      'd1',
      'execute',
      options.databaseName,
      '--remote',
      '--env',
      'production',
      '--json',
      '--command',
      PROCESSING_AGGREGATE_SQL,
    ]);
    const processing = assertSuccessfulReadOnlyQuery(
      processingResult,
      'reporting processing preflight',
    );
    const processingRow = processing.row as ProcessingAggregateRow;
    unresolvedCriticalExceptionCount = Number(processingRow.unresolved_critical ?? 0);
    blockedOutboxCount = Number(processingRow.blocked_outbox ?? 0);
    blockedAccountingCount = Number(processingRow.blocked_accounting ?? 0);
    foreignKeyViolationCount = Number(processingRow.fk_violations ?? 0);
    changedDb = changedDb || (processing.envelope.meta?.changed_db ?? false);
    rowsWritten += processing.envelope.meta?.rows_written ?? 0;
  }

  const counts = [
    activeTenantIds.length,
    Number(baseRow.active_tenant_count ?? activeTenantIds.length),
    Number(baseRow.global_switch_count ?? 0),
    foreignKeyViolationCount,
    rowsWritten,
    ...(unresolvedCriticalExceptionCount === null ? [] : [unresolvedCriticalExceptionCount]),
    ...(blockedOutboxCount === null ? [] : [blockedOutboxCount]),
    ...(blockedAccountingCount === null ? [] : [blockedAccountingCount]),
  ];
  if (counts.some((count) => !safeNonNegativeInteger(count))) {
    throw new Error('Reporting preflight returned an invalid aggregate count.');
  }
  if (Number(baseRow.active_tenant_count ?? activeTenantIds.length) !== activeTenantIds.length) {
    throw new Error('Reporting preflight active tenant count did not match the ID set.');
  }
  if (changedDb || rowsWritten !== 0) {
    throw new Error('Reporting preflight changed the production database.');
  }

  return {
    activeTenantIds,
    canonicalTableNames,
    appliedCanonicalMigrations,
    unknownCanonicalMigrations,
    reportingEnabledTenantIds,
    globalSwitchEnabled: Number(baseRow.global_switch_count ?? 0) > 0,
    unresolvedCriticalExceptionCount,
    blockedOutboxCount,
    blockedAccountingCount,
    foreignKeyViolationCount,
    changedDb,
    rowsWritten,
  };
}

function argumentValue(args: string[], name: string): string | null {
  const direct = args.find((token) => token.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value.`);
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseTenantIds(value: string | null): string[] {
  if (!value) return [];
  return uniqueSortedStrings(value.split(','));
}

function loadAuthorizationFile(path: string | null): CliAuthorizationFile {
  if (!path) return {};
  const document = parseReportingCutoverAuthorizationJson(
    readFileSync(resolve(path), 'utf8'),
  );
  if (!document.documentReady || !document.authorization) {
    throw new Error('Authorization file failed strict schema-v2 document validation.');
  }
  return document.authorization as CliAuthorizationFile;
}

function parseEnvironment(args: string[]): 'production' {
  const environment = argumentValue(args, '--env') ?? 'production';
  if (environment !== 'production') {
    throw new Error(`Reporting preflight is production-only; refusing environment: ${environment}`);
  }
  return 'production';
}

interface ProductionPreflightIdentity {
  databaseId: string;
  accountMatched: boolean;
  remoteDatabaseMatched: boolean;
  manifestObjectFound: boolean;
  manifestChecksumMatched: boolean;
  checkedAtUtc: string;
}

function assertCommandSuccess(
  label: string,
  result: ReportingPreflightCommandResult,
): void {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.toString('utf8').trim()}`);
  }
}

async function collectProductionPreflightIdentity(
  configText: string,
  manifestKey: string,
  runner: ReportingPreflightCommandRunner,
): Promise<ProductionPreflightIdentity> {
  try {
    const identity = await inspectProductionIdentity({
      configText,
      manifestKey,
      runner,
    });
    return {
      databaseId: identity.databaseId,
      accountMatched: identity.accountMatched,
      remoteDatabaseMatched: identity.remoteDatabaseMatched,
      manifestObjectFound: identity.manifestObjectFound,
      manifestChecksumMatched: identity.manifestChecksumMatched,
      checkedAtUtc: identity.checkedAtUtc,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/specified key does not exist|manifest object.*(missing|not found)/i.test(message)) {
      throw error;
    }
  }

  const config = parseProductionConfig(configText, manifestKey);
  const whoamiResult = await runner(['whoami', '--json']);
  assertCommandSuccess('wrangler whoami', whoamiResult);
  const whoami = extractJsonDocument(whoamiResult.stdout.toString('utf8')) as {
    loggedIn?: boolean;
    accounts?: Array<{ id?: string }>;
  };
  const accountMatched = whoami.loggedIn === true
    && (whoami.accounts?.some((account) => account.id === config.accountId) ?? false);

  const listResult = await runner(['d1', 'list', '--json']);
  assertCommandSuccess('wrangler d1 list', listResult);
  const databases = extractJsonDocument(listResult.stdout.toString('utf8')) as Array<{
    uuid?: string;
    name?: string;
  }>;
  if (!Array.isArray(databases)) {
    throw new Error('Wrangler D1 list response was not an array.');
  }
  const remoteDatabaseMatched = databases.some((database) => (
    database.uuid === config.databaseId && database.name === config.databaseName
  ));

  const infoResult = await runner([
    'd1',
    'info',
    config.databaseName,
    '--json',
  ]);
  assertCommandSuccess('wrangler d1 info', infoResult);
  const info = extractJsonDocument(infoResult.stdout.toString('utf8')) as {
    uuid?: string;
    name?: string;
  };
  if (info.uuid !== config.databaseId || info.name !== config.databaseName) {
    throw new Error('Wrangler D1 info did not confirm the configured production identity.');
  }

  return {
    databaseId: config.databaseId,
    accountMatched,
    remoteDatabaseMatched,
    manifestObjectFound: false,
    manifestChecksumMatched: false,
    checkedAtUtc: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  parseEnvironment(args);
  const plannedTenantIds = parseTenantIds(argumentValue(args, '--planned-tenants'));
  const canaryTenantId = argumentValue(args, '--canary-tenant');
  const authorizationFile = loadAuthorizationFile(
    argumentValue(args, '--authorization-file'),
  );
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const configText = readFileSync(join(root, 'wrangler.toml'), 'utf8');
  const config = parseProductionConfig(configText, MIGRATIONS_R2_KEY);
  const runner = createReportingPreflightRunner(root);
  const identity = await collectProductionPreflightIdentity(
    configText,
    MIGRATIONS_R2_KEY,
    runner,
  );
  const database = await collectReportingDatabaseEvidence({
    databaseName: config.databaseName,
    runner,
  });
  const generatedAtUtc = new Date().toISOString();
  const foreignKeyWaiver = deriveForeignKeyWaiverAuthorization(
    authorizationFile.foreignKeyDisposition,
    authorizationFile.schemaVersion ?? 1,
  );
  const evidence: ReportingCutoverPreflightEvidence = {
    schemaVersion: 1,
    generatedAtUtc,
    domain: 'reporting',
    productionIdentity: {
      expectedDatabaseId: config.databaseId,
      observedDatabaseId: identity.databaseId,
      accountMatched: identity.accountMatched,
      remoteDatabaseMatched: identity.remoteDatabaseMatched,
      manifestObjectFound: identity.manifestObjectFound,
      manifestChecksumMatched: identity.manifestChecksumMatched,
      inspectedAtUtc: identity.checkedAtUtc,
      maxAgeSeconds: 3600,
    },
    tenants: {
      activeTenantIds: database.activeTenantIds,
      plannedTenantIds,
      canaryTenantId,
    },
    schema: {
      canonicalTableNames: database.canonicalTableNames,
      appliedCanonicalMigrations: database.appliedCanonicalMigrations,
      unknownCanonicalMigrations: database.unknownCanonicalMigrations,
    },
    processing: {
      unresolvedCriticalExceptionCount: database.unresolvedCriticalExceptionCount,
      blockedOutboxCount: database.blockedOutboxCount,
      blockedAccountingCount: database.blockedAccountingCount,
      foreignKeyViolationCount: database.foreignKeyViolationCount,
    },
    flags: {
      reportingEnabledTenantIds: database.reportingEnabledTenantIds,
      globalSwitchEnabled: database.globalSwitchEnabled,
      activeReportingRoutesSwitched:
        typeof authorizationFile.activeReportingRoutesSwitched === 'boolean'
          ? authorizationFile.activeReportingRoutesSwitched
          : null,
    },
    authorization: {
      preparationAuthorized: hasFlag(args, '--preparation-authorized'),
      productionExecutionAuthorized:
        authorizationFile.productionExecutionAuthorized === true,
      authorizedDomain: authorizationFile.authorizedDomain ?? null,
      expiresAtUtc: authorizationFile.expiresAtUtc ?? null,
    },
    maintenance: {
      windowStartUtc: authorizationFile.maintenanceWindowStartUtc ?? null,
      windowEndUtc: authorizationFile.maintenanceWindowEndUtc ?? null,
    },
    executionPlan: {
      authorizedTenantIds: uniqueSortedStrings(
        authorizationFile.authorizedTenantIds ?? [],
      ),
      approvedMigrations: uniqueSortedStrings(
        authorizationFile.migrations?.approvedMigrations
        ?? authorizationFile.approvedMigrations
        ?? [],
      ),
      deploymentAuthorized:
        authorizationFile.deployment?.authorized
        ?? (authorizationFile.deploymentAuthorized === true),
      deploymentVersion:
        authorizationFile.deployment?.candidateWorkerVersionId
        ?? authorizationFile.deploymentVersion
        ?? null,
      migrationApplyAuthorized:
        authorizationFile.migrations?.authorized
        ?? (authorizationFile.migrationApplyAuthorized === true),
      productionImportAuthorized:
        authorizationFile.productionImport?.authorized
        ?? (authorizationFile.productionImportAuthorized === true),
      productionImportCommandApproved:
        authorizationFile.productionImport?.commandApproved
        ?? (authorizationFile.productionImportCommandApproved === true),
      productionImportCommandId:
        authorizationFile.productionImport?.commandId
        ?? authorizationFile.productionImportCommandId
        ?? null,
      shadowFlagAuthorized:
        authorizationFile.featureFlagPlan?.authorized
        ?? (authorizationFile.featureFlagPlan?.shadowModeAuthorized === true),
      shadowFlagTenantId: authorizationFile.featureFlagPlan?.tenantId ?? null,
      shadowFlagKey: authorizationFile.featureFlagPlan?.flagKey ?? null,
      shadowFlagDomain: authorizationFile.featureFlagPlan?.domain ?? null,
      shadowFlagInitialMode:
        authorizationFile.featureFlagPlan?.initialMode ?? null,
    },
    foreignKeyDisposition: foreignKeyWaiver,
    rollback: {
      rollbackOwnerAssigned:
        authorizationFile.rollbackOwner?.assigned
        ?? (authorizationFile.rollbackOwnerAssigned === true),
      rollbackOwnerId:
        authorizationFile.rollbackOwner?.ownerId
        ?? authorizationFile.rollbackOwnerId
        ?? null,
      observationOwnerAssigned:
        authorizationFile.observationOwner?.assigned
        ?? (authorizationFile.observationOwnerAssigned === true),
      observationOwnerId:
        authorizationFile.observationOwner?.ownerId
        ?? authorizationFile.observationOwnerId
        ?? null,
      maxRollbackDurationMs:
        authorizationFile.rollbackPolicy?.maxRollbackDurationMs
        ?? authorizationFile.maxRollbackDurationMs
        ?? Number(argumentValue(args, '--max-rollback-ms') ?? 0),
    },
    smoke: {
      planId:
        authorizationFile.smoke?.planId
        ?? authorizationFile.smokePlanId
        ?? argumentValue(args, '--smoke-plan-id')
        ?? '',
      requiredScenarios:
        authorizationFile.smoke?.requiredScenarios
        ?? authorizationFile.requiredSmokeScenarios
        ?? parseTenantIds(argumentValue(args, '--smoke-scenarios')),
    },
    productionMutationAttempted: false,
  };
  const result = enforceSchemaV2AuthorizationContract(
    evaluateReportingCutoverPreflight(evidence),
    authorizationFile,
    generatedAtUtc,
  );
  const report = {
    ...result,
    productionDatabaseId: config.databaseId,
    activeTenantIds: database.activeTenantIds,
    plannedTenantIds,
    changedDb: database.changedDb,
    rowsWritten: database.rowsWritten,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!result.preparationReady) process.exitCode = 2;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Reporting cutover preflight failed: ${message}\n`);
    process.exitCode = 1;
  });
}
