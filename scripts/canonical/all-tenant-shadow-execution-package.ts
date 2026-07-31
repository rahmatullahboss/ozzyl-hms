import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CDB_V1_060_CONSUMER_IDS,
  CDB_V1_060_PROVIDER_KEYS,
  CDB_V1_060_SOURCE_TABLES,
} from './production-authorization-package';

export const CDB_V1_070A_CHECKPOINT =
  'CDB-V1-070A-ALL-TENANT-SHADOW-EXECUTION-AUTHORIZATION-CONTRACT-READY';
export const CDB_V1_070A_NEXT_CHECKPOINT =
  'CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION-EXACT-AUTHORIZATION-REQUIRED';
export const CDB_V1_070A_BRANCH = 'program/cdb-main-continuous-20260725';
export const CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT =
  '8be5525013a8231b9cccb55957b137fbb385ea34';

export const CDB_V1_070A_ACTIVE_TENANT_IDS = ['1', '100', '101', '102'] as const;

export const CDB_V1_070A_MIGRATION_NAMES = [
  '0541_canonical_local_sync_protocol.sql',
  '0542_canonical_sync_inbox_lifecycle.sql',
  '0543_canonical_sync_outbox_lifecycle.sql',
  '0544_canonical_tenant_patient_links.sql',
  '0545_canonical_practitioner_operational_adoption.sql',
  '0546_canonical_appointment_authority.sql',
  '0547_patient_merge_map_hardening.sql',
  '0548_canonical_encounter_admission_bed_convergence.sql',
  '0549_approval_revision_policy.sql',
  '0550_canonical_credit_note_cash_refund_reversals.sql',
  '0551_workforce_roster_integrity.sql',
  '0552_attendance_projection_integrity.sql',
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
  '0570_doctor_commission_rule_version_snapshot.sql',
] as const;

export const CDB_V1_070A_TABLE_REBUILD_MIGRATION_NAMES = [
  '0548_canonical_encounter_admission_bed_convergence.sql',
  '0549_approval_revision_policy.sql',
] as const;

type CdbV1070aMigrationName = (typeof CDB_V1_070A_MIGRATION_NAMES)[number];

function migrationClass(name: CdbV1070aMigrationName): 'additive' | 'data_preserving_table_rebuild' {
  return (CDB_V1_070A_TABLE_REBUILD_MIGRATION_NAMES as readonly string[]).includes(name)
    ? 'data_preserving_table_rebuild'
    : 'additive';
}

export const CDB_V1_070A_BACKFILL_PATHS = [
  'scripts/canonical/backfill-tenant-patient-links.ts',
  'scripts/canonical/backfill-practitioners.ts',
  'scripts/canonical/backfill-appointments.ts',
  'scripts/canonical/backfill-encounter-admission-bed-convergence.ts',
] as const;

export const CDB_V1_070A_PROVIDER_KEYS = [...CDB_V1_060_PROVIDER_KEYS] as const;
export const CDB_V1_070A_CONSUMER_IDS = [...CDB_V1_060_CONSUMER_IDS] as const;
export const CDB_V1_070A_SOURCE_TABLES = [...CDB_V1_060_SOURCE_TABLES] as const;

export const CDB_V1_070A_EXTERNAL_BINDING_PATHS = [
  'productionDatabase.name',
  'productionDatabase.id',
  'activeTenantEvidence.evidenceId',
  'activeTenantEvidence.evidenceSha256',
  'activeTenantEvidence.capturedAtUtc',
  'activeTenantEvidence.tenantIds',
  'candidate.branch',
  'candidate.commit',
  'candidate.buildSha',
  'deployment.workerVersionId',
  'deployment.previousWorkerVersionId',
  'deployment.buildManifestSha256',
  'deployment.routeFingerprintSha256',
  'productionSnapshot.bookmarkId',
  'productionSnapshot.sha256',
  'backupExport.evidenceId',
  'backupExport.sha256',
  'timing.windowStartUtc',
  'timing.windowEndUtc',
  'timing.expiresAtUtc',
  'owners.ownerId',
  'owners.executionOwnerId',
  'owners.rollbackOwnerId',
  'owners.observationOwnerId',
  'owners.riskAcceptanceEvidenceId',
  'owners.riskAcceptanceEvidenceSha256',
  'observation.durationMinutes',
  'observation.maxP95LatencyMs',
  'observation.maxErrorRate',
  'confirmation.deployToken',
  'confirmation.migrationToken',
  'confirmation.backfillToken',
  'confirmation.shadowActivationToken',
  'confirmation.rollbackToken',
] as const;

const PLAN_PATH = 'docs/superpowers/plans/2026-07-30-cdb-v1-070-all-tenant-shadow-rollout.md';
const AUDIT_PATH = 'docs/database/audits/2026-07-30-all-tenant-shadow-execution-authorization-contract.md';
const MIGRATION_MANIFEST_PATH = 'src/data/schema-migrations.generated.ts';
const SHADOW_CONTRACT_PATH = 'scripts/canonical/set-production-all-tenant-provider-shadow.ts';
const SCOPE_VALIDATOR_PATH = 'scripts/canonical/validate-production-all-tenant-provider-shadow-scope.ts';
const AUTHORIZATION_CONTRACT_PATH = 'scripts/canonical/all-tenant-shadow-execution-authorization.ts';
const AUTHORIZATION_VALIDATOR_PATH = 'scripts/canonical/validate-all-tenant-shadow-execution-authorization.ts';
const READINESS_CHECKER_PATH = 'scripts/canonical/check-all-tenant-shadow-execution-readiness.ts';
const PROTECTED_CLONE_RESULT_PATH = 'docs/database/cdb-v1-050-protected-clone-rehearsal-result.json';
const HISTORICAL_PACKAGE_PATH = 'docs/database/cdb-v1-060-production-authorization-package.json';

export type AllTenantShadowExecutionPhase =
  | 'candidate_preflight'
  | 'backup_verification'
  | 'legacy_default_deployment'
  | 'migration'
  | 'backfill'
  | 'reconciliation'
  | 'shadow_activation'
  | 'scope_verification'
  | 'observation'
  | 'rollback';

export interface AllTenantShadowExecutionPackageBinding {
  branch: string;
  preparationCommit: string;
  buildSha: string;
}

export interface AllTenantShadowExecutionCommand {
  id: string;
  phase: AllTenantShadowExecutionPhase;
  executable: false;
  argvTemplate: string[];
}

export interface AllTenantShadowExecutionPackage {
  schemaVersion: 1;
  checkpoint: typeof CDB_V1_070A_CHECKPOINT;
  status: 'prepared_not_authorized';
  preparation: {
    branch: string;
    repositoryCommit: string;
    buildSha: string;
    minimumImplementationCommit: typeof CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT;
  };
  bindings: {
    planPath: typeof PLAN_PATH;
    planSha256: string;
    auditPath: typeof AUDIT_PATH;
    auditSha256: string;
    migrationManifestPath: typeof MIGRATION_MANIFEST_PATH;
    migrationManifestSha256: string;
    migrationManifestCount: 504;
    shadowContractPath: typeof SHADOW_CONTRACT_PATH;
    shadowContractSha256: string;
    scopeValidatorPath: typeof SCOPE_VALIDATOR_PATH;
    scopeValidatorSha256: string;
    authorizationContractPath: typeof AUTHORIZATION_CONTRACT_PATH;
    authorizationContractSha256: string;
    authorizationValidatorPath: typeof AUTHORIZATION_VALIDATOR_PATH;
    authorizationValidatorSha256: string;
    readinessCheckerPath: typeof READINESS_CHECKER_PATH;
    readinessCheckerSha256: string;
    protectedCloneResultPath: typeof PROTECTED_CLONE_RESULT_PATH;
    protectedCloneResultSha256: string;
    historicalPackagePath: typeof HISTORICAL_PACKAGE_PATH;
    historicalPackageSha256: string;
  };
  scope: {
    tenantIds: string[];
    tenantSelection: 'all_active_tenants_exact_preflight';
    domains: ['finance', 'identity_episode', 'practitioner_compensation'];
    providerKeys: string[];
    consumerIds: string[];
    sourceTables: string[];
    mode: 'legacy_primary_shadow';
    expectedProviderFlagRowCount: number;
    maxTenantCount: 100;
  };
  migrations: Array<{
    name: string;
    path: string;
    sha256: string;
    migrationClass: 'additive' | 'data_preserving_table_rebuild';
    dataPreserving: true;
    requiresExclusiveSchemaReview: boolean;
  }>;
  backfills: Array<{
    id: string;
    path: string;
    sha256: string;
    maxSourceRecordsPerPass: 100;
    secondPassRequired: true;
    secondPassNewBusinessRowsExpected: 0;
  }>;
  commands: AllTenantShadowExecutionCommand[];
  acceptance: {
    integrityCheck: 'ok';
    maximumUnexplainedVarianceCount: 0;
    maximumProviderErrorCount: 0;
    maximumMappingAmbiguityCount: 0;
    maximumCrossTenantReferenceCount: 0;
    maximumForeignKeyViolationCount: 0;
    maximumSecondPassNewBusinessRows: 0;
    maximumMissingProviderFlagRowCount: 0;
    maximumNonShadowProviderFlagRowCount: 0;
    minimumObservationMinutes: 4320;
    requiredResponseAuthority: 'legacy';
  };
  abortConditions: string[];
  rollback: {
    immediateProviderDisable: true;
    immediateWorkerRollback: true;
    keepLegacyRoutesActive: true;
    finalResponseAuthority: 'legacy';
  };
  exclusions: {
    canonicalReadPromotion: true;
    canonicalWritePromotion: true;
    compatibilityWriteRetirement: true;
    legacyReaderRetirement: true;
    legacyWriterRetirement: true;
    destructiveMigrations: true;
    localSyncActivation: true;
  };
  permissions: {
    productionReadAuthorized: false;
    deploymentAuthorized: false;
    trafficChangeAuthorized: false;
    productionMigrationAuthorized: false;
    productionBackfillAuthorized: false;
    providerShadowActivationAuthorized: false;
    canonicalReadPromotionAuthorized: false;
    canonicalWritePromotionAuthorized: false;
    localSyncActivationAuthorized: false;
    legacyRetirementAuthorized: false;
    destructiveActionAuthorized: false;
  };
  externalBindings: {
    productionDatabase: { name: null; id: null };
    activeTenantEvidence: {
      evidenceId: null;
      evidenceSha256: null;
      capturedAtUtc: null;
      tenantIds: null;
    };
    candidate: { branch: null; commit: null; buildSha: null };
    deployment: {
      workerVersionId: null;
      previousWorkerVersionId: null;
      buildManifestSha256: null;
      routeFingerprintSha256: null;
    };
    productionSnapshot: { bookmarkId: null; sha256: null };
    backupExport: { evidenceId: null; sha256: null };
    timing: { windowStartUtc: null; windowEndUtc: null; expiresAtUtc: null };
    owners: {
      ownerId: null;
      executionOwnerId: null;
      rollbackOwnerId: null;
      observationOwnerId: null;
      riskAcceptanceEvidenceId: null;
      riskAcceptanceEvidenceSha256: null;
    };
    observation: { durationMinutes: null; maxP95LatencyMs: null; maxErrorRate: null };
    confirmation: {
      deployToken: null;
      migrationToken: null;
      backfillToken: null;
      shadowActivationToken: null;
      rollbackToken: null;
    };
  };
  safety: {
    networkRequestPerformed: false;
    productionReadPerformed: false;
    productionMutationPerformed: false;
    deploymentPerformed: false;
    trafficChanged: false;
    pushPerformed: false;
    cdbToMainIntegrationPerformed: false;
  };
  nextCheckpoint: typeof CDB_V1_070A_NEXT_CHECKPOINT;
}

export interface AllTenantShadowExecutionPackageEvaluation {
  packageReady: boolean;
  executionReady: false;
  issues: string[];
  unresolvedExternalBindings: string[];
  tenantCount: number;
  migrationCount: number;
  backfillCount: number;
  providerCount: number;
  expectedProviderFlagRowCount: number;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(root: string, path: string): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) throw new Error(`required repository file is missing: ${path}`);
  return sha256(readFileSync(absolute));
}

function exactGitSha(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${label} must be one lowercase 40-character Git SHA`);
  return value;
}

function gitCommitExists(root: string, commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function migrationManifestCount(root: string): number {
  const text = readFileSync(join(root, MIGRATION_MANIFEST_PATH), 'utf8');
  return (text.match(/\bfilename:\s*"[^"]+"/g) ?? []).length;
}

function backfillId(path: string): string {
  return path.replace('scripts/canonical/', '').replace(/\.ts$/, '').replaceAll('-', '_');
}

function commands(): AllTenantShadowExecutionCommand[] {
  const authorization = '{{PROTECTED_AUTHORIZATION_PATH}}';
  const evidenceDirectory = '{{PROTECTED_EVIDENCE_DIRECTORY}}';
  return [
    {
      id: 'cdbv1070.candidate-preflight',
      phase: 'candidate_preflight',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'candidate-preflight', '--authorization', authorization],
    },
    {
      id: 'cdbv1070.backup-verification',
      phase: 'backup_verification',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'backup-verification', '--authorization', authorization, '--evidence-dir', evidenceDirectory],
    },
    {
      id: 'cdbv1070.legacy-default-deployment',
      phase: 'legacy_default_deployment',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'legacy-default-deployment', '--authorization', authorization],
    },
    {
      id: 'cdbv1070.migration',
      phase: 'migration',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'migration', '--authorization', authorization, '--migration-count', '29'],
    },
    {
      id: 'cdbv1070.backfill',
      phase: 'backfill',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'backfill', '--authorization', authorization, '--tenant-count', '4', '--backfill-count', '4', '--second-pass'],
    },
    {
      id: 'cdbv1070.reconciliation',
      phase: 'reconciliation',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'reconciliation', '--authorization', authorization, '--require-zero-variance'],
    },
    {
      id: 'cdbv1070.shadow-activation',
      phase: 'shadow_activation',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'shadow-activation', '--authorization', authorization, '--tenant-count', '4', '--provider-count', '9', '--response-authority', 'legacy'],
    },
    {
      id: 'cdbv1070.scope-verification',
      phase: 'scope_verification',
      executable: false,
      argvTemplate: ['pnpm', 'canonical:production-all-tenant-provider-shadow-scope', '--', '--output', '{{PROTECTED_SCOPE_RECEIPT_PATH}}'],
    },
    {
      id: 'cdbv1070.observation',
      phase: 'observation',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'observation', '--authorization', authorization, '--evidence-dir', evidenceDirectory],
    },
    {
      id: 'cdbv1070.rollback',
      phase: 'rollback',
      executable: false,
      argvTemplate: ['CDB_V1_070_EXECUTOR', '--phase', 'rollback', '--authorization', authorization, '--response-authority', 'legacy'],
    },
  ];
}

export function buildAllTenantShadowExecutionPackage(
  rootInput: string,
  binding: AllTenantShadowExecutionPackageBinding,
): AllTenantShadowExecutionPackage {
  const root = resolve(rootInput);
  if (binding.branch !== CDB_V1_070A_BRANCH) {
    throw new Error(`branch must equal ${CDB_V1_070A_BRANCH}`);
  }
  exactGitSha(binding.preparationCommit, 'preparationCommit');
  exactGitSha(binding.buildSha, 'buildSha');
  if (!gitCommitExists(root, binding.preparationCommit)) {
    throw new Error('preparationCommit does not exist in the repository');
  }
  if (!isAncestor(root, CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT, binding.preparationCommit)) {
    throw new Error('preparationCommit does not contain the all-tenant shadow implementation');
  }
  const manifestCount = migrationManifestCount(root);
  if (manifestCount !== 504) {
    throw new Error(`migration manifest must contain 504 entries, received ${manifestCount}`);
  }

  return {
    schemaVersion: 1,
    checkpoint: CDB_V1_070A_CHECKPOINT,
    status: 'prepared_not_authorized',
    preparation: {
      branch: binding.branch,
      repositoryCommit: binding.preparationCommit,
      buildSha: binding.buildSha,
      minimumImplementationCommit: CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT,
    },
    bindings: {
      planPath: PLAN_PATH,
      planSha256: fileSha256(root, PLAN_PATH),
      auditPath: AUDIT_PATH,
      auditSha256: fileSha256(root, AUDIT_PATH),
      migrationManifestPath: MIGRATION_MANIFEST_PATH,
      migrationManifestSha256: fileSha256(root, MIGRATION_MANIFEST_PATH),
      migrationManifestCount: 504,
      shadowContractPath: SHADOW_CONTRACT_PATH,
      shadowContractSha256: fileSha256(root, SHADOW_CONTRACT_PATH),
      scopeValidatorPath: SCOPE_VALIDATOR_PATH,
      scopeValidatorSha256: fileSha256(root, SCOPE_VALIDATOR_PATH),
      authorizationContractPath: AUTHORIZATION_CONTRACT_PATH,
      authorizationContractSha256: fileSha256(root, AUTHORIZATION_CONTRACT_PATH),
      authorizationValidatorPath: AUTHORIZATION_VALIDATOR_PATH,
      authorizationValidatorSha256: fileSha256(root, AUTHORIZATION_VALIDATOR_PATH),
      readinessCheckerPath: READINESS_CHECKER_PATH,
      readinessCheckerSha256: fileSha256(root, READINESS_CHECKER_PATH),
      protectedCloneResultPath: PROTECTED_CLONE_RESULT_PATH,
      protectedCloneResultSha256: fileSha256(root, PROTECTED_CLONE_RESULT_PATH),
      historicalPackagePath: HISTORICAL_PACKAGE_PATH,
      historicalPackageSha256: fileSha256(root, HISTORICAL_PACKAGE_PATH),
    },
    scope: {
      tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
      tenantSelection: 'all_active_tenants_exact_preflight',
      domains: ['finance', 'identity_episode', 'practitioner_compensation'],
      providerKeys: [...CDB_V1_070A_PROVIDER_KEYS],
      consumerIds: [...CDB_V1_070A_CONSUMER_IDS],
      sourceTables: [...CDB_V1_070A_SOURCE_TABLES],
      mode: 'legacy_primary_shadow',
      expectedProviderFlagRowCount:
        CDB_V1_070A_ACTIVE_TENANT_IDS.length * CDB_V1_070A_PROVIDER_KEYS.length,
      maxTenantCount: 100,
    },
    migrations: CDB_V1_070A_MIGRATION_NAMES.map((name) => {
      const classification = migrationClass(name);
      return {
        name,
        path: `migrations/${name}`,
        sha256: fileSha256(root, `migrations/${name}`),
        migrationClass: classification,
        dataPreserving: true as const,
        requiresExclusiveSchemaReview: classification === 'data_preserving_table_rebuild',
      };
    }),
    backfills: CDB_V1_070A_BACKFILL_PATHS.map((path) => ({
      id: backfillId(path),
      path,
      sha256: fileSha256(root, path),
      maxSourceRecordsPerPass: 100,
      secondPassRequired: true,
      secondPassNewBusinessRowsExpected: 0,
    })),
    commands: commands(),
    acceptance: {
      integrityCheck: 'ok',
      maximumUnexplainedVarianceCount: 0,
      maximumProviderErrorCount: 0,
      maximumMappingAmbiguityCount: 0,
      maximumCrossTenantReferenceCount: 0,
      maximumForeignKeyViolationCount: 0,
      maximumSecondPassNewBusinessRows: 0,
      maximumMissingProviderFlagRowCount: 0,
      maximumNonShadowProviderFlagRowCount: 0,
      minimumObservationMinutes: 4320,
      requiredResponseAuthority: 'legacy',
    },
    abortConditions: [
      'candidate commit or build differs from the protected authorization',
      'production database, active-tenant evidence, snapshot or backup differs from authorization',
      'candidate does not contain the minimum all-tenant shadow implementation commit',
      'pending migration set or migration safety classification differs from the exact twenty-nine approved migrations, including the two data-preserving table rebuilds',
      'backfill scope exceeds the exact four tenants, approved scripts or row bounds',
      'second pass creates any unexplained new business row',
      'mapping ambiguity, cross-tenant reference or foreign-key violation is observed',
      'unexplained variance, provider error, latency breach or error-rate breach is observed',
      'provider scope verification does not return all thirty-six exact shadow rows',
      'Legacy response authority, provider-disable rollback or Worker rollback is unavailable',
    ],
    rollback: {
      immediateProviderDisable: true,
      immediateWorkerRollback: true,
      keepLegacyRoutesActive: true,
      finalResponseAuthority: 'legacy',
    },
    exclusions: {
      canonicalReadPromotion: true,
      canonicalWritePromotion: true,
      compatibilityWriteRetirement: true,
      legacyReaderRetirement: true,
      legacyWriterRetirement: true,
      destructiveMigrations: true,
      localSyncActivation: true,
    },
    permissions: {
      productionReadAuthorized: false,
      deploymentAuthorized: false,
      trafficChangeAuthorized: false,
      productionMigrationAuthorized: false,
      productionBackfillAuthorized: false,
      providerShadowActivationAuthorized: false,
      canonicalReadPromotionAuthorized: false,
      canonicalWritePromotionAuthorized: false,
      localSyncActivationAuthorized: false,
      legacyRetirementAuthorized: false,
      destructiveActionAuthorized: false,
    },
    externalBindings: {
      productionDatabase: { name: null, id: null },
      activeTenantEvidence: {
        evidenceId: null,
        evidenceSha256: null,
        capturedAtUtc: null,
        tenantIds: null,
      },
      candidate: { branch: null, commit: null, buildSha: null },
      deployment: {
        workerVersionId: null,
        previousWorkerVersionId: null,
        buildManifestSha256: null,
        routeFingerprintSha256: null,
      },
      productionSnapshot: { bookmarkId: null, sha256: null },
      backupExport: { evidenceId: null, sha256: null },
      timing: { windowStartUtc: null, windowEndUtc: null, expiresAtUtc: null },
      owners: {
        ownerId: null,
        executionOwnerId: null,
        rollbackOwnerId: null,
        observationOwnerId: null,
        riskAcceptanceEvidenceId: null,
        riskAcceptanceEvidenceSha256: null,
      },
      observation: { durationMinutes: null, maxP95LatencyMs: null, maxErrorRate: null },
      confirmation: {
        deployToken: null,
        migrationToken: null,
        backfillToken: null,
        shadowActivationToken: null,
        rollbackToken: null,
      },
    },
    safety: {
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      deploymentPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    },
    nextCheckpoint: CDB_V1_070A_NEXT_CHECKPOINT,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return array(value).filter((entry): entry is string => typeof entry === 'string');
}

function nested(root: Record<string, unknown> | null, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    const currentObject = object(current);
    if (!currentObject) return undefined;
    current = currentObject[key];
  }
  return current;
}

function exactArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function unsafeCommandToken(value: string): boolean {
  return /(?:&&|\|\||[;|<>`]|\$\()/.test(value);
}

function checkHashBinding(
  issues: string[],
  root: string,
  bindings: Record<string, unknown> | null,
  pathKey: string,
  hashKey: string,
  expectedPath: string,
  label: string,
): void {
  if (bindings?.[pathKey] !== expectedPath) {
    issues.push(`${label} path mismatch`);
    return;
  }
  if (bindings?.[hashKey] !== fileSha256(root, expectedPath)) {
    issues.push(`${label} hash mismatch`);
  }
}

function unresolvedExternalBindings(
  issues: string[],
  packageObject: Record<string, unknown>,
): string[] {
  const bindings = object(packageObject.externalBindings);
  const unresolved: string[] = [];
  for (const path of CDB_V1_070A_EXTERNAL_BINDING_PATHS) {
    const value = nested(bindings, ...path.split('.'));
    if (value == null) unresolved.push(path);
    else issues.push(`committed package must not embed external binding ${path}`);
  }
  return unresolved;
}

export function evaluateAllTenantShadowExecutionPackage(
  rootInput: string,
  value: unknown,
): AllTenantShadowExecutionPackageEvaluation {
  const root = resolve(rootInput);
  const issues: string[] = [];
  const packageObject = object(value);
  if (!packageObject) {
    return {
      packageReady: false,
      executionReady: false,
      issues: ['package must be one JSON object'],
      unresolvedExternalBindings: [...CDB_V1_070A_EXTERNAL_BINDING_PATHS],
      tenantCount: 0,
      migrationCount: 0,
      backfillCount: 0,
      providerCount: 0,
      expectedProviderFlagRowCount: 0,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
    };
  }

  if (packageObject.schemaVersion !== 1) issues.push('schemaVersion must equal 1');
  if (packageObject.checkpoint !== CDB_V1_070A_CHECKPOINT) issues.push('checkpoint mismatch');
  if (packageObject.status !== 'prepared_not_authorized') issues.push('status mismatch');
  if (packageObject.nextCheckpoint !== CDB_V1_070A_NEXT_CHECKPOINT) issues.push('next checkpoint mismatch');

  const preparation = object(packageObject.preparation);
  const preparationCommit = typeof preparation?.repositoryCommit === 'string'
    ? preparation.repositoryCommit
    : '';
  if (preparation?.branch !== CDB_V1_070A_BRANCH) issues.push('preparation branch mismatch');
  if (!/^[0-9a-f]{40}$/.test(preparationCommit) || !gitCommitExists(root, preparationCommit)) {
    issues.push('preparation commit is invalid');
  } else if (!isAncestor(root, CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT, preparationCommit)) {
    issues.push('preparation commit lacks minimum implementation');
  }
  if (typeof preparation?.buildSha !== 'string' || !/^[0-9a-f]{40}$/.test(preparation.buildSha)) {
    issues.push('preparation build SHA is invalid');
  }
  if (preparation?.minimumImplementationCommit !== CDB_V1_070A_MINIMUM_IMPLEMENTATION_COMMIT) {
    issues.push('minimum implementation commit mismatch');
  }

  const bindings = object(packageObject.bindings);
  checkHashBinding(issues, root, bindings, 'planPath', 'planSha256', PLAN_PATH, 'plan');
  checkHashBinding(issues, root, bindings, 'auditPath', 'auditSha256', AUDIT_PATH, 'audit');
  checkHashBinding(
    issues,
    root,
    bindings,
    'migrationManifestPath',
    'migrationManifestSha256',
    MIGRATION_MANIFEST_PATH,
    'migration manifest',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'shadowContractPath',
    'shadowContractSha256',
    SHADOW_CONTRACT_PATH,
    'shadow contract',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'scopeValidatorPath',
    'scopeValidatorSha256',
    SCOPE_VALIDATOR_PATH,
    'scope validator',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'authorizationContractPath',
    'authorizationContractSha256',
    AUTHORIZATION_CONTRACT_PATH,
    'authorization contract',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'authorizationValidatorPath',
    'authorizationValidatorSha256',
    AUTHORIZATION_VALIDATOR_PATH,
    'authorization validator',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'readinessCheckerPath',
    'readinessCheckerSha256',
    READINESS_CHECKER_PATH,
    'readiness checker',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'protectedCloneResultPath',
    'protectedCloneResultSha256',
    PROTECTED_CLONE_RESULT_PATH,
    'protected-clone result',
  );
  checkHashBinding(
    issues,
    root,
    bindings,
    'historicalPackagePath',
    'historicalPackageSha256',
    HISTORICAL_PACKAGE_PATH,
    'historical package',
  );
  if (bindings?.migrationManifestCount !== 504 || migrationManifestCount(root) !== 504) {
    issues.push('migration manifest count must equal 504');
  }

  const scope = object(packageObject.scope);
  const tenantIds = stringArray(scope?.tenantIds);
  const providerKeys = stringArray(scope?.providerKeys);
  const consumerIds = stringArray(scope?.consumerIds);
  const sourceTables = stringArray(scope?.sourceTables);
  if (!exactArray(tenantIds, CDB_V1_070A_ACTIVE_TENANT_IDS)) issues.push('tenant scope mismatch');
  if (scope?.tenantSelection !== 'all_active_tenants_exact_preflight') issues.push('tenant-selection contract mismatch');
  if (!exactArray(stringArray(scope?.domains), ['finance', 'identity_episode', 'practitioner_compensation'])) {
    issues.push('domain scope mismatch');
  }
  if (!exactArray(providerKeys, CDB_V1_070A_PROVIDER_KEYS)) issues.push('provider scope mismatch');
  if (!exactArray(consumerIds, CDB_V1_070A_CONSUMER_IDS)) issues.push('consumer scope mismatch');
  if (!exactArray(sourceTables, CDB_V1_070A_SOURCE_TABLES)) issues.push('source-table scope mismatch');
  if (scope?.mode !== 'legacy_primary_shadow' || scope?.maxTenantCount !== 100) {
    issues.push('shadow mode contract mismatch');
  }
  const expectedFlagRows = CDB_V1_070A_ACTIVE_TENANT_IDS.length * CDB_V1_070A_PROVIDER_KEYS.length;
  if (scope?.expectedProviderFlagRowCount !== expectedFlagRows) {
    issues.push('expected provider-flag row count mismatch');
  }

  const migrations = array(packageObject.migrations).map(object);
  if (migrations.length !== CDB_V1_070A_MIGRATION_NAMES.length) issues.push('migration count mismatch');
  for (let index = 0; index < CDB_V1_070A_MIGRATION_NAMES.length; index += 1) {
    const name = CDB_V1_070A_MIGRATION_NAMES[index];
    const entry = migrations[index];
    const path = `migrations/${name}`;
    const classification = migrationClass(name);
    if (
      entry?.name !== name
      || entry?.path !== path
      || entry?.migrationClass !== classification
      || entry?.dataPreserving !== true
      || entry?.requiresExclusiveSchemaReview !== (classification === 'data_preserving_table_rebuild')
    ) {
      issues.push(`migration contract mismatch: ${name}`);
      continue;
    }
    if (entry.sha256 !== fileSha256(root, path)) issues.push(`migration hash mismatch: ${name}`);
  }

  const backfills = array(packageObject.backfills).map(object);
  if (backfills.length !== CDB_V1_070A_BACKFILL_PATHS.length) issues.push('backfill count mismatch');
  for (let index = 0; index < CDB_V1_070A_BACKFILL_PATHS.length; index += 1) {
    const path = CDB_V1_070A_BACKFILL_PATHS[index];
    const entry = backfills[index];
    if (
      entry?.id !== backfillId(path)
      || entry?.path !== path
      || entry?.maxSourceRecordsPerPass !== 100
      || entry?.secondPassRequired !== true
      || entry?.secondPassNewBusinessRowsExpected !== 0
    ) {
      issues.push(`backfill contract mismatch: ${path}`);
      continue;
    }
    if (entry.sha256 !== fileSha256(root, path)) issues.push(`backfill hash mismatch: ${path}`);
  }

  const expectedCommands = commands();
  const commandEntries = array(packageObject.commands).map(object);
  if (commandEntries.length !== expectedCommands.length) issues.push('command count mismatch');
  for (let index = 0; index < expectedCommands.length; index += 1) {
    const expected = expectedCommands[index];
    const entry = commandEntries[index];
    const tokens = stringArray(entry?.argvTemplate);
    if (
      entry?.id !== expected.id
      || entry?.phase !== expected.phase
      || entry?.executable !== false
      || !exactArray(tokens, expected.argvTemplate)
    ) {
      issues.push(`command contract mismatch: ${expected.phase}`);
    }
    if (tokens.some(unsafeCommandToken)) issues.push(`unsafe command token in ${expected.phase}`);
  }

  const acceptance = object(packageObject.acceptance);
  const exactAcceptance: Record<string, unknown> = {
    integrityCheck: 'ok',
    maximumUnexplainedVarianceCount: 0,
    maximumProviderErrorCount: 0,
    maximumMappingAmbiguityCount: 0,
    maximumCrossTenantReferenceCount: 0,
    maximumForeignKeyViolationCount: 0,
    maximumSecondPassNewBusinessRows: 0,
    maximumMissingProviderFlagRowCount: 0,
    maximumNonShadowProviderFlagRowCount: 0,
    minimumObservationMinutes: 4320,
    requiredResponseAuthority: 'legacy',
  };
  for (const [key, expected] of Object.entries(exactAcceptance)) {
    if (acceptance?.[key] !== expected) issues.push(`acceptance contract mismatch: ${key}`);
  }

  const permissions = object(packageObject.permissions);
  for (const key of [
    'productionReadAuthorized',
    'deploymentAuthorized',
    'trafficChangeAuthorized',
    'productionMigrationAuthorized',
    'productionBackfillAuthorized',
    'providerShadowActivationAuthorized',
    'canonicalReadPromotionAuthorized',
    'canonicalWritePromotionAuthorized',
    'localSyncActivationAuthorized',
    'legacyRetirementAuthorized',
    'destructiveActionAuthorized',
  ]) {
    if (permissions?.[key] !== false) issues.push(`prepared package cannot authorize ${key}`);
  }

  const exclusions = object(packageObject.exclusions);
  for (const key of [
    'canonicalReadPromotion',
    'canonicalWritePromotion',
    'compatibilityWriteRetirement',
    'legacyReaderRetirement',
    'legacyWriterRetirement',
    'destructiveMigrations',
    'localSyncActivation',
  ]) {
    if (exclusions?.[key] !== true) issues.push(`exclusion must remain true: ${key}`);
  }

  const rollback = object(packageObject.rollback);
  if (
    rollback?.immediateProviderDisable !== true
    || rollback?.immediateWorkerRollback !== true
    || rollback?.keepLegacyRoutesActive !== true
    || rollback?.finalResponseAuthority !== 'legacy'
  ) {
    issues.push('rollback contract mismatch');
  }
  const abortConditions = stringArray(packageObject.abortConditions);
  if (abortConditions.length !== 10 || abortConditions.some((entry) => entry.trim() === '')) {
    issues.push('abort conditions are incomplete');
  }

  const safety = object(packageObject.safety);
  for (const key of [
    'networkRequestPerformed',
    'productionReadPerformed',
    'productionMutationPerformed',
    'deploymentPerformed',
    'trafficChanged',
    'pushPerformed',
    'cdbToMainIntegrationPerformed',
  ]) {
    if (safety?.[key] !== false) issues.push(`safety flag must be false: ${key}`);
  }

  const unresolved = unresolvedExternalBindings(issues, packageObject);
  if (!exactArray(unresolved, CDB_V1_070A_EXTERNAL_BINDING_PATHS)) {
    issues.push('external binding gap list mismatch');
  }

  return {
    packageReady: issues.length === 0,
    executionReady: false,
    issues: [...new Set(issues)],
    unresolvedExternalBindings: unresolved,
    tenantCount: tenantIds.length,
    migrationCount: migrations.length,
    backfillCount: backfills.length,
    providerCount: providerKeys.length,
    expectedProviderFlagRowCount:
      typeof scope?.expectedProviderFlagRowCount === 'number'
        ? scope.expectedProviderFlagRowCount
        : 0,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
}
