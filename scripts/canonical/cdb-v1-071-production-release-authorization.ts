import { createHash } from 'node:crypto';
import {
  loadProtectedJsonDocument,
  type ProtectedJsonDocumentIssueCode,
} from './protected-json-document';

export const CDB_V1_071_CANDIDATE_SHA = '6db262686985c01982b2858ce0963c8a1447215a';
export const CDB_V1_071_BUNDLE_SHA256 = '9d87fc4741fa91b065a085b1cc0df915dad1017d32a2c5737d1e932d30769c89';
export const CDB_V1_071_PREVIOUS_WORKER_VERSION_ID = '4f5d8f93-92d4-4fda-8fba-c0a2863f1b71';
export const CDB_V1_071_WORKER_NAME = 'hms-saas-production';
export const CDB_V1_071_DATABASE_NAME = 'hms-super-admin-production-apac';
export const CDB_V1_071_DATABASE_UUID = 'c68a5360-a2c1-44cc-9e71-f21057bea102';

export const CDB_V1_071_ROUTES = [
  'admin.ozzyl.com/*',
  'hms.ozzyl.com/*',
  'app.ozzyl.com/*',
  '*.ozzyl.com/*',
] as const;

export const CDB_V1_071_TENANT_IDS = ['1', '100', '101', '102'] as const;

export const CDB_V1_071_MIGRATION_NAMES = [
  '0541_canonical_local_sync_protocol.sql',
  '0542_canonical_sync_inbox_lifecycle.sql',
  '0543_canonical_sync_outbox_lifecycle.sql',
  '0544_canonical_tenant_patient_links.sql',
  '0545_canonical_practitioner_operational_adoption.sql',
  '0546_canonical_appointment_authority.sql',
  '0547_patient_merge_map_hardening.sql',
  '0548_canonical_encounter_admission_bed_convergence.sql',
  '0550_canonical_credit_note_cash_refund_reversals.sql',
  '0553_mfa_registration_schema_repair.sql',
  '0554_canonical_prescription_medication_intent.sql',
  '0555_canonical_clinical_document_diagnosis.sql',
  '0556_canonical_patient_vital_measurement.sql',
  '0557_canonical_medication_administration.sql',
  '0558_canonical_lab_result_specimen.sql',
  '0559_canonical_radiology_acquisition_report.sql',
  '0560_canonical_emergency_case_triage.sql',
  '0561_compensation_rule_route_identity.sql',
  '0563_practitioner_route_identity.sql',
  '0564_patient_import_route_identity.sql',
  '0565_appointment_route_identity.sql',
  '0566_appointment_schedule_route_identity.sql',
  '0567_encounter_visit_route_identity.sql',
  '0568_service_delivery_route_identity.sql',
  '0569_service_catalog_route_identity.sql',
] as const;

export const CDB_V1_071_BACKFILL_PATHS = [
  'scripts/canonical/backfill-tenant-patient-links.ts',
  'scripts/canonical/backfill-practitioners.ts',
  'scripts/canonical/backfill-appointments.ts',
  'scripts/canonical/backfill-encounter-admission-bed-convergence.ts',
] as const;

export type CdbV1071ConfirmationAction =
  | 'preflight'
  | 'migration'
  | 'backfill'
  | 'upload'
  | 'traffic'
  | 'rollback';

export interface CdbV1071ProductionReleaseAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  operation: 'cdb_v1_071_production_release_activation';
  target: {
    workerName: string;
    databaseName: string;
    databaseUuid: string;
    environment: 'production';
    routes: string[];
  };
  timing: {
    issuedAtUtc: string;
    windowStartUtc: string;
    windowEndUtc: string;
    expiresAtUtc: string;
  };
  owner: {
    ownerId: string;
    displayName: string;
    approved: boolean;
    approvalSource: 'user_explicit_cdb_v1_071_production_release_activation_authorization';
    ownerModel: 'single_operator_risk_accepted';
    automaticAbortOnOperatorUnavailable: boolean;
  };
  candidate: {
    branch: 'main';
    commit: string;
    buildSha: string;
    bundleSha256: string;
    previousWorkerVersionId: string;
  };
  tenants: string[];
  migrations: {
    authorized: boolean;
    serial: boolean;
    destructiveAllowed: boolean;
    entries: Array<{ name: string }>;
  };
  backfills: {
    authorized: boolean;
    tenantIds: string[];
    partitionLimit: number;
    secondPassRequired: boolean;
    secondPassNewBusinessRowsExpected: number;
    entries: Array<{ path: string }>;
  };
  deployment: {
    authorized: boolean;
    uploadAtZeroTraffic: boolean;
    previousWorkerRetained: boolean;
    stages: Array<{ candidatePercent: number; previousPercent: number }>;
  };
  rollback: {
    automatic: boolean;
    stopOnFirstFailure: boolean;
    previousWorkerVersionId: string;
    restorePreviousPercent: number;
  };
  permissions: {
    aggregateProductionRead: boolean;
    workerMetadataRead: boolean;
    timeTravelBookmarkCapture: boolean;
    protectedExportCapture: boolean;
    productionSchemaMigration: boolean;
    productionBackfill: boolean;
    workerVersionUpload: boolean;
    trafficChange: boolean;
    providerFlagChange: boolean;
    canonicalReadPromotion: boolean;
    canonicalWritePromotion: boolean;
    localSyncActivation: boolean;
    legacyRetirement: boolean;
    routeChange: boolean;
    destructiveAction: boolean;
    databaseDeletion: boolean;
    archivalMutation: boolean;
    unrelatedProductionWrite: boolean;
  };
  evidence: {
    approvalEvidenceId: string;
    approvalEvidenceSha256: string;
    riskAcceptanceEvidenceId: string;
    riskAcceptanceEvidenceSha256: string;
  };
  confirmation: {
    preflightProof: string;
    migrationProof: string;
    backfillProof: string;
    uploadProof: string;
    trafficProof: string;
    rollbackProof: string;
  };
}

export interface CdbV1071AuthorizationReceipt {
  checkpoint: 'CDB-V1-071-PRODUCTION-RELEASE-AUTHORIZATION';
  authorizationReady: boolean;
  executionReady: boolean;
  issueCount: number;
  issues: string[];
  candidateCommit: typeof CDB_V1_071_CANDIDATE_SHA;
  previousWorkerVersionId: typeof CDB_V1_071_PREVIOUS_WORKER_VERSION_ID;
  tenantCount: 4;
  migrationCount: 25;
  backfillCount: 4;
  trafficStages: readonly [5, 50, 100];
  productionMutationPerformed: false;
  trafficChanged: false;
}

export interface PreparedCdbV1071Authorization {
  authorization: CdbV1071ProductionReleaseAuthorization | null;
  receipt: CdbV1071AuthorizationReceipt;
}

const ROOT_KEYS = [
  'schemaVersion', 'authorizationId', 'operation', 'target', 'timing', 'owner',
  'candidate', 'tenants', 'migrations', 'backfills', 'deployment', 'rollback',
  'permissions', 'evidence', 'confirmation',
] as const;

const REQUIRED_TRUE_PERMISSIONS = [
  'aggregateProductionRead', 'workerMetadataRead', 'timeTravelBookmarkCapture',
  'protectedExportCapture', 'productionSchemaMigration', 'productionBackfill',
  'workerVersionUpload', 'trafficChange',
] as const;

const REQUIRED_FALSE_PERMISSIONS = [
  'providerFlagChange', 'canonicalReadPromotion', 'canonicalWritePromotion',
  'localSyncActivation', 'legacyRetirement', 'routeChange', 'destructiveAction',
  'databaseDeletion', 'archivalMutation', 'unrelatedProductionWrite',
] as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildCdbV1071ConfirmationProof(
  authorizationId: string,
  action: CdbV1071ConfirmationAction,
): string {
  return `cdbv1071:${action}:${sha256([
    authorizationId,
    action,
    CDB_V1_071_CANDIDATE_SHA,
    CDB_V1_071_BUNDLE_SHA256,
    CDB_V1_071_PREVIOUS_WORKER_VERSION_ID,
  ].join('|'))}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactArray(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function normalizedUtc(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) return null;
  return time;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function exactSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function push(issues: string[], condition: boolean, code: string): void {
  if (!condition) issues.push(code);
}

export function validateCdbV1071Authorization(
  value: unknown,
  atUtc: string = new Date().toISOString(),
): CdbV1071AuthorizationReceipt {
  const issues: string[] = [];
  const root = isRecord(value) ? value : null;
  push(issues, Boolean(root), 'CDBV1071_AUTHORIZATION_SCHEMA_INVALID');
  push(issues, exactKeys(root, ROOT_KEYS), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');

  const document = root as unknown as CdbV1071ProductionReleaseAuthorization;
  if (root) {
    push(issues, document.schemaVersion === 1, 'CDBV1071_AUTHORIZATION_SCHEMA_INVALID');
    push(issues, nonEmpty(document.authorizationId), 'CDBV1071_AUTHORIZATION_SCHEMA_INVALID');
    push(issues, document.operation === 'cdb_v1_071_production_release_activation', 'CDBV1071_AUTHORIZATION_SCOPE_INVALID');

    push(issues, exactKeys(document.target, ['workerName', 'databaseName', 'databaseUuid', 'environment', 'routes']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, document.target?.workerName === CDB_V1_071_WORKER_NAME, 'CDBV1071_AUTHORIZATION_TARGET_INVALID');
    push(issues, document.target?.databaseName === CDB_V1_071_DATABASE_NAME, 'CDBV1071_AUTHORIZATION_TARGET_INVALID');
    push(issues, document.target?.databaseUuid === CDB_V1_071_DATABASE_UUID, 'CDBV1071_AUTHORIZATION_TARGET_INVALID');
    push(issues, document.target?.environment === 'production', 'CDBV1071_AUTHORIZATION_TARGET_INVALID');
    push(issues, exactArray(document.target?.routes, CDB_V1_071_ROUTES), 'CDBV1071_AUTHORIZATION_ROUTE_INVALID');

    push(issues, exactKeys(document.owner, ['ownerId', 'displayName', 'approved', 'approvalSource', 'ownerModel', 'automaticAbortOnOperatorUnavailable']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, nonEmpty(document.owner?.ownerId) && document.owner?.displayName === 'Rahmatullah Zisan', 'CDBV1071_AUTHORIZATION_OWNER_INVALID');
    push(issues, document.owner?.approved === true, 'CDBV1071_AUTHORIZATION_OWNER_INVALID');
    push(issues, document.owner?.approvalSource === 'user_explicit_cdb_v1_071_production_release_activation_authorization', 'CDBV1071_AUTHORIZATION_OWNER_INVALID');
    push(issues, document.owner?.ownerModel === 'single_operator_risk_accepted', 'CDBV1071_AUTHORIZATION_OWNER_INVALID');
    push(issues, document.owner?.automaticAbortOnOperatorUnavailable === true, 'CDBV1071_AUTHORIZATION_OWNER_INVALID');

    push(issues, exactKeys(document.candidate, ['branch', 'commit', 'buildSha', 'bundleSha256', 'previousWorkerVersionId']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, document.candidate?.branch === 'main', 'CDBV1071_AUTHORIZATION_BINDING_INVALID');
    push(issues, document.candidate?.commit === CDB_V1_071_CANDIDATE_SHA, 'CDBV1071_AUTHORIZATION_BINDING_INVALID');
    push(issues, document.candidate?.buildSha === CDB_V1_071_CANDIDATE_SHA, 'CDBV1071_AUTHORIZATION_BINDING_INVALID');
    push(issues, document.candidate?.bundleSha256 === CDB_V1_071_BUNDLE_SHA256, 'CDBV1071_AUTHORIZATION_BINDING_INVALID');
    push(issues, document.candidate?.previousWorkerVersionId === CDB_V1_071_PREVIOUS_WORKER_VERSION_ID, 'CDBV1071_AUTHORIZATION_BINDING_INVALID');

    push(issues, exactArray(document.tenants, CDB_V1_071_TENANT_IDS), 'CDBV1071_AUTHORIZATION_TENANT_INVALID');

    push(issues, exactKeys(document.migrations, ['authorized', 'serial', 'destructiveAllowed', 'entries']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, document.migrations?.authorized === true && document.migrations?.serial === true && document.migrations?.destructiveAllowed === false, 'CDBV1071_AUTHORIZATION_MIGRATION_INVALID');
    push(issues, Array.isArray(document.migrations?.entries)
      && document.migrations.entries.length === CDB_V1_071_MIGRATION_NAMES.length
      && document.migrations.entries.every((entry, index) => exactKeys(entry, ['name']) && entry.name === CDB_V1_071_MIGRATION_NAMES[index]), 'CDBV1071_AUTHORIZATION_MIGRATION_INVALID');

    push(issues, exactKeys(document.backfills, ['authorized', 'tenantIds', 'partitionLimit', 'secondPassRequired', 'secondPassNewBusinessRowsExpected', 'entries']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, document.backfills?.authorized === true
      && exactArray(document.backfills?.tenantIds, CDB_V1_071_TENANT_IDS)
      && document.backfills?.partitionLimit === 100
      && document.backfills?.secondPassRequired === true
      && document.backfills?.secondPassNewBusinessRowsExpected === 0, 'CDBV1071_AUTHORIZATION_BACKFILL_INVALID');
    push(issues, Array.isArray(document.backfills?.entries)
      && document.backfills.entries.length === CDB_V1_071_BACKFILL_PATHS.length
      && document.backfills.entries.every((entry, index) => exactKeys(entry, ['path']) && entry.path === CDB_V1_071_BACKFILL_PATHS[index]), 'CDBV1071_AUTHORIZATION_BACKFILL_INVALID');

    push(issues, exactKeys(document.deployment, ['authorized', 'uploadAtZeroTraffic', 'previousWorkerRetained', 'stages']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    const expectedStages = [[5, 95], [50, 50], [100, 0]];
    push(issues, document.deployment?.authorized === true
      && document.deployment?.uploadAtZeroTraffic === true
      && document.deployment?.previousWorkerRetained === true
      && Array.isArray(document.deployment?.stages)
      && document.deployment.stages.length === expectedStages.length
      && document.deployment.stages.every((stage, index) => exactKeys(stage, ['candidatePercent', 'previousPercent'])
        && stage.candidatePercent === expectedStages[index][0]
        && stage.previousPercent === expectedStages[index][1]), 'CDBV1071_AUTHORIZATION_DEPLOYMENT_INVALID');

    push(issues, exactKeys(document.rollback, ['automatic', 'stopOnFirstFailure', 'previousWorkerVersionId', 'restorePreviousPercent']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, document.rollback?.automatic === true
      && document.rollback?.stopOnFirstFailure === true
      && document.rollback?.previousWorkerVersionId === CDB_V1_071_PREVIOUS_WORKER_VERSION_ID
      && document.rollback?.restorePreviousPercent === 100, 'CDBV1071_AUTHORIZATION_ROLLBACK_INVALID');

    const permissionKeys = [...REQUIRED_TRUE_PERMISSIONS, ...REQUIRED_FALSE_PERMISSIONS];
    push(issues, exactKeys(document.permissions, permissionKeys), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, REQUIRED_TRUE_PERMISSIONS.every((key) => document.permissions?.[key] === true)
      && REQUIRED_FALSE_PERMISSIONS.every((key) => document.permissions?.[key] === false), 'CDBV1071_AUTHORIZATION_PERMISSION_INVALID');

    push(issues, exactKeys(document.evidence, ['approvalEvidenceId', 'approvalEvidenceSha256', 'riskAcceptanceEvidenceId', 'riskAcceptanceEvidenceSha256']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    push(issues, nonEmpty(document.evidence?.approvalEvidenceId)
      && exactSha256(document.evidence?.approvalEvidenceSha256)
      && nonEmpty(document.evidence?.riskAcceptanceEvidenceId)
      && exactSha256(document.evidence?.riskAcceptanceEvidenceSha256), 'CDBV1071_AUTHORIZATION_EVIDENCE_INVALID');

    push(issues, exactKeys(document.confirmation, ['preflightProof', 'migrationProof', 'backfillProof', 'uploadProof', 'trafficProof', 'rollbackProof']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    const confirmation = document.confirmation;
    push(issues, Boolean(confirmation)
      && confirmation.preflightProof === buildCdbV1071ConfirmationProof(document.authorizationId, 'preflight')
      && confirmation.migrationProof === buildCdbV1071ConfirmationProof(document.authorizationId, 'migration')
      && confirmation.backfillProof === buildCdbV1071ConfirmationProof(document.authorizationId, 'backfill')
      && confirmation.uploadProof === buildCdbV1071ConfirmationProof(document.authorizationId, 'upload')
      && confirmation.trafficProof === buildCdbV1071ConfirmationProof(document.authorizationId, 'traffic')
      && confirmation.rollbackProof === buildCdbV1071ConfirmationProof(document.authorizationId, 'rollback'), 'CDBV1071_AUTHORIZATION_CONFIRMATION_INVALID');

    push(issues, exactKeys(document.timing, ['issuedAtUtc', 'windowStartUtc', 'windowEndUtc', 'expiresAtUtc']), 'CDBV1071_AUTHORIZATION_UNKNOWN_FIELD');
    const issued = normalizedUtc(document.timing?.issuedAtUtc);
    const start = normalizedUtc(document.timing?.windowStartUtc);
    const end = normalizedUtc(document.timing?.windowEndUtc);
    const expires = normalizedUtc(document.timing?.expiresAtUtc);
    const at = normalizedUtc(atUtc);
    push(issues, issued !== null && start !== null && end !== null && expires !== null && at !== null
      && issued <= start && start <= at && at <= end && end === expires && end - start <= 4 * 60 * 60 * 1000,
    at !== null && expires !== null && at > expires
      ? 'CDBV1071_AUTHORIZATION_EXPIRED'
      : 'CDBV1071_AUTHORIZATION_TIMING_INVALID');
  }

  const uniqueIssues = [...new Set(issues)];
  const ready = uniqueIssues.length === 0;
  return {
    checkpoint: 'CDB-V1-071-PRODUCTION-RELEASE-AUTHORIZATION',
    authorizationReady: ready,
    executionReady: ready,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    candidateCommit: CDB_V1_071_CANDIDATE_SHA,
    previousWorkerVersionId: CDB_V1_071_PREVIOUS_WORKER_VERSION_ID,
    tenantCount: 4,
    migrationCount: 25,
    backfillCount: 4,
    trafficStages: [5, 50, 100],
    productionMutationPerformed: false,
    trafficChanged: false,
  };
}

function mapProtectedIssue(code: ProtectedJsonDocumentIssueCode): string {
  const suffix: Record<ProtectedJsonDocumentIssueCode, string> = {
    INVALID_JSON: 'INVALID_JSON',
    DUPLICATE_KEY: 'DUPLICATE_KEY',
    UNSAFE_KEY: 'UNSAFE_KEY',
    TOO_LARGE: 'TOO_LARGE',
    TOO_DEEP: 'TOO_DEEP',
    FILE_UNAVAILABLE: 'FILE_UNAVAILABLE',
    FILE_INSIDE_REPOSITORY: 'FILE_INSIDE_REPOSITORY',
    FILE_PROTECTION_INVALID: 'FILE_PROTECTION_INVALID',
  };
  return `CDBV1071_AUTHORIZATION_${suffix[code]}`;
}

export function prepareProtectedCdbV1071Authorization(
  authorizationPath: string,
  repositoryRoot: string,
  atUtc: string = new Date().toISOString(),
): PreparedCdbV1071Authorization {
  const loaded = loadProtectedJsonDocument(authorizationPath, repositoryRoot, {
    maxBytes: 128 * 1024,
    maxDepth: 16,
  });
  if (!loaded.ready) {
    const issues = loaded.issues.map((issue) => mapProtectedIssue(issue.code));
    return {
      authorization: null,
      receipt: {
        ...validateCdbV1071Authorization(null, atUtc),
        authorizationReady: false,
        executionReady: false,
        issueCount: issues.length,
        issues,
      },
    };
  }
  const receipt = validateCdbV1071Authorization(loaded.value, atUtc);
  return {
    authorization: receipt.executionReady
      ? loaded.value as CdbV1071ProductionReleaseAuthorization
      : null,
    receipt,
  };
}
