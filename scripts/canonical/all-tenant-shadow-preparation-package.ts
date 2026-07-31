import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CDB_V1_070A_ACTIVE_TENANT_IDS,
  CDB_V1_070A_MIGRATION_NAMES,
} from './all-tenant-shadow-execution-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import {
  CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE,
  CDB101_PRODUCTION_WORKER_ENTRYPOINT,
  CDB101_PRODUCTION_WORKER_ENVIRONMENT,
  CDB101_PRODUCTION_WORKER_ROUTES,
  CDB101_PRODUCTION_WORKER_SERVICE,
} from './reporting-worker-build-version-evidence';

export const CDB_V1_070B_CHECKPOINT =
  'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY';
export const CDB_V1_070B_NEXT_CHECKPOINT =
  'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED';
export const CDB_V1_070B_BRANCH = 'program/cdb-main-continuous-20260725';
export const CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT =
  '917a6a276c0a8864442d29f87d7ec7786eda9d31';
export const CDB_V1_070B_PACKAGE_PATH =
  'docs/database/cdb-v1-070b-all-tenant-shadow-preparation-package.json';

export const CDB_V1_070B_EXTERNAL_BINDING_PATHS = [
  'candidate.branch',
  'candidate.commit',
  'candidate.buildSha',
  'candidate.mainIntegrationEvidenceId',
  'candidate.mainIntegrationEvidenceSha256',
  'productionState.activeTenantEvidenceId',
  'productionState.activeTenantEvidenceSha256',
  'productionState.migrationLedgerEvidenceId',
  'productionState.migrationLedgerEvidenceSha256',
  'productionState.workerMetadataEvidenceId',
  'productionState.workerMetadataEvidenceSha256',
  'productionState.routeEvidenceId',
  'productionState.routeEvidenceSha256',
  'worker.candidateVersionId',
  'worker.previousVersionId',
  'worker.buildManifestSha256',
  'worker.routeFingerprintSha256',
  'backup.bookmarkId',
  'backup.bookmarkSha256',
  'backup.exportEvidenceId',
  'backup.exportSha256',
  'timing.windowStartUtc',
  'timing.windowEndUtc',
  'timing.expiresAtUtc',
  'owners.ownerId',
  'owners.executionOwnerId',
  'owners.rollbackOwnerId',
  'owners.evidenceCustodianId',
  'owners.riskAcceptanceEvidenceId',
  'owners.riskAcceptanceEvidenceSha256',
  'evidenceOutput.receiptId',
  'evidenceOutput.protectedDirectoryEvidenceId',
  'confirmation.readToken',
  'confirmation.versionUploadToken',
  'confirmation.backupCaptureToken',
  'confirmation.abortToken',
] as const;

const DESIGN_PATH =
  'docs/superpowers/specs/2026-07-30-cdb-v1-070b-staged-production-authorization-design.md';
const PLAN_PATH =
  'docs/superpowers/plans/2026-07-30-cdb-v1-070b-shadow-preparation-authorization.md';
const HISTORICAL_EXECUTION_PACKAGE_PATH =
  'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';
const MIGRATION_MANIFEST_PATH = 'src/data/schema-migrations.generated.ts';
const AUTHORIZATION_CONTRACT_PATH =
  'scripts/canonical/all-tenant-shadow-preparation-authorization.ts';
const AUTHORIZATION_VALIDATOR_PATH =
  'scripts/canonical/validate-all-tenant-shadow-preparation-authorization.ts';
const READINESS_CHECKER_PATH =
  'scripts/canonical/check-all-tenant-shadow-preparation-readiness.ts';

export type AllTenantShadowPreparationPhase =
  | 'candidate_build_verification'
  | 'zero_traffic_version_upload'
  | 'aggregate_production_read'
  | 'time_travel_bookmark_capture'
  | 'protected_export_capture'
  | 'preparation_evidence_verification';

export interface AllTenantShadowPreparationPackageBinding {
  branch: string;
  preparationCommit: string;
  buildSha: string;
}

export interface AllTenantShadowPreparationCommand {
  id: string;
  phase: AllTenantShadowPreparationPhase;
  executable: false;
  argvTemplate: string[];
}

export interface AllTenantShadowPreparationPackage {
  schemaVersion: 1;
  checkpoint: typeof CDB_V1_070B_CHECKPOINT;
  status: 'prepared_not_authorized';
  preparation: {
    branch: string;
    repositoryCommit: string;
    buildSha: string;
    minimumImplementationCommit: typeof CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT;
  };
  bindings: {
    designPath: typeof DESIGN_PATH;
    designSha256: string;
    planPath: typeof PLAN_PATH;
    planSha256: string;
    historicalExecutionPackagePath: typeof HISTORICAL_EXECUTION_PACKAGE_PATH;
    historicalExecutionPackageSha256: string;
    migrationManifestPath: typeof MIGRATION_MANIFEST_PATH;
    migrationManifestSha256: string;
    authorizationContractPath: typeof AUTHORIZATION_CONTRACT_PATH;
    authorizationContractSha256: string;
    authorizationValidatorPath: typeof AUTHORIZATION_VALIDATOR_PATH;
    authorizationValidatorSha256: string;
    readinessCheckerPath: typeof READINESS_CHECKER_PATH;
    readinessCheckerSha256: string;
  };
  target: {
    platform: 'cloudflare_d1';
    databaseName: typeof CDB101_PRODUCTION_DATABASE_NAME;
    databaseUuid: typeof CDB101_PRODUCTION_DATABASE_ID;
    environment: 'production';
    remote: true;
  };
  worker: {
    serviceName: typeof CDB101_PRODUCTION_WORKER_SERVICE;
    environment: typeof CDB101_PRODUCTION_WORKER_ENVIRONMENT;
    entrypoint: typeof CDB101_PRODUCTION_WORKER_ENTRYPOINT;
    compatibilityDate: typeof CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE;
    routes: string[];
    candidateTrafficPercentage: 0;
    previousTrafficPercentage: 100;
  };
  expectedScope: {
    tenantIds: string[];
    allActiveTenantAggregateRead: true;
    migrationLedgerAggregateRead: true;
    phiReadAllowed: false;
    rowLevelPatientReadAllowed: false;
    migrationManifestCount: 504;
    expectedPendingMigrationCount: 29;
    expectedPendingMigrationNames: string[];
  };
  commands: AllTenantShadowPreparationCommand[];
  acceptance: {
    candidateTrafficPercentage: 0;
    previousTrafficPercentage: 100;
    productionRowsWritten: 0;
    migrationsApplied: 0;
    backfillsExecuted: 0;
    providerFlagsChanged: 0;
    trafficChanged: false;
    finalResponseAuthority: 'legacy';
  };
  permissions: {
    productionReadAuthorized: false;
    workerVersionUploadAuthorized: false;
    trafficChangeAuthorized: false;
    timeTravelBookmarkCaptureAuthorized: false;
    backupExportCaptureAuthorized: false;
    productionMigrationAuthorized: false;
    productionBackfillAuthorized: false;
    providerFlagChangeAuthorized: false;
    canonicalPromotionAuthorized: false;
    localSyncActivationAuthorized: false;
    legacyRetirementAuthorized: false;
    destructiveActionAuthorized: false;
  };
  externalBindings: {
    candidate: {
      branch: null;
      commit: null;
      buildSha: null;
      mainIntegrationEvidenceId: null;
      mainIntegrationEvidenceSha256: null;
    };
    productionState: {
      activeTenantEvidenceId: null;
      activeTenantEvidenceSha256: null;
      migrationLedgerEvidenceId: null;
      migrationLedgerEvidenceSha256: null;
      workerMetadataEvidenceId: null;
      workerMetadataEvidenceSha256: null;
      routeEvidenceId: null;
      routeEvidenceSha256: null;
    };
    worker: {
      candidateVersionId: null;
      previousVersionId: null;
      buildManifestSha256: null;
      routeFingerprintSha256: null;
    };
    backup: {
      bookmarkId: null;
      bookmarkSha256: null;
      exportEvidenceId: null;
      exportSha256: null;
    };
    timing: { windowStartUtc: null; windowEndUtc: null; expiresAtUtc: null };
    owners: {
      ownerId: null;
      executionOwnerId: null;
      rollbackOwnerId: null;
      evidenceCustodianId: null;
      riskAcceptanceEvidenceId: null;
      riskAcceptanceEvidenceSha256: null;
    };
    evidenceOutput: { receiptId: null; protectedDirectoryEvidenceId: null };
    confirmation: {
      readToken: null;
      versionUploadToken: null;
      backupCaptureToken: null;
      abortToken: null;
    };
  };
  safety: {
    networkRequestPerformed: false;
    productionReadPerformed: false;
    productionMutationPerformed: false;
    workerVersionUploadPerformed: false;
    bookmarkCapturePerformed: false;
    backupExportPerformed: false;
    trafficChanged: false;
    pushPerformed: false;
    cdbToMainIntegrationPerformed: false;
  };
  nextCheckpoint: typeof CDB_V1_070B_NEXT_CHECKPOINT;
}

export interface AllTenantShadowPreparationPackageEvaluation {
  packageReady: boolean;
  authorizationReady: false;
  executionReady: false;
  issues: string[];
  unresolvedExternalBindings: string[];
  tenantCount: number;
  commandCount: number;
  migrationManifestCount: number;
  expectedPendingMigrationCount: number;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
  workerVersionUploadPerformed: false;
  trafficChanged: false;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(root: string, path: string): string {
  const absolute = join(root, path);
  if (!existsSync(absolute)) throw new Error(`required repository file is missing: ${path}`);
  return sha256(readFileSync(absolute));
}

function gitCommitExists(root: string, commit: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
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

function validGitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function migrationManifestCount(root: string): number {
  const text = readFileSync(join(root, MIGRATION_MANIFEST_PATH), 'utf8');
  return (text.match(/\bfilename:\s*"[^"]+"/g) ?? []).length;
}

function commandContract(): AllTenantShadowPreparationCommand[] {
  const authorization = '{{PROTECTED_PREPARATION_AUTHORIZATION_PATH}}';
  const evidenceDirectory = '{{PROTECTED_EVIDENCE_DIRECTORY}}';
  return [
    {
      id: 'cdbv1070b.candidate-build-verification',
      phase: 'candidate_build_verification',
      executable: false,
      argvTemplate: ['CDB_V1_070B_EXECUTOR', '--phase', 'candidate-build-verification', '--authorization', authorization],
    },
    {
      id: 'cdbv1070b.zero-traffic-version-upload',
      phase: 'zero_traffic_version_upload',
      executable: false,
      argvTemplate: ['CDB_V1_070B_EXECUTOR', '--phase', 'zero-traffic-version-upload', '--authorization', authorization],
    },
    {
      id: 'cdbv1070b.aggregate-production-read',
      phase: 'aggregate_production_read',
      executable: false,
      argvTemplate: ['CDB_V1_070B_EXECUTOR', '--phase', 'aggregate-production-read', '--authorization', authorization],
    },
    {
      id: 'cdbv1070b.time-travel-bookmark-capture',
      phase: 'time_travel_bookmark_capture',
      executable: false,
      argvTemplate: ['CDB_V1_070B_EXECUTOR', '--phase', 'time-travel-bookmark-capture', '--authorization', authorization],
    },
    {
      id: 'cdbv1070b.protected-export-capture',
      phase: 'protected_export_capture',
      executable: false,
      argvTemplate: ['CDB_V1_070B_EXECUTOR', '--phase', 'protected-export-capture', '--authorization', authorization],
    },
    {
      id: 'cdbv1070b.preparation-evidence-verification',
      phase: 'preparation_evidence_verification',
      executable: false,
      argvTemplate: ['CDB_V1_070B_EXECUTOR', '--phase', 'preparation-evidence-verification', '--authorization', authorization, '--evidence-directory', evidenceDirectory],
    },
  ];
}

function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildAllTenantShadowPreparationPackage(
  repositoryRootInput: string,
  binding: AllTenantShadowPreparationPackageBinding,
): AllTenantShadowPreparationPackage {
  const root = resolve(repositoryRootInput);
  if (binding.branch !== CDB_V1_070B_BRANCH) throw new Error('preparation branch mismatch');
  if (!validGitSha(binding.preparationCommit) || !gitCommitExists(root, binding.preparationCommit)) {
    throw new Error('preparationCommit must be an existing 40-character Git commit');
  }
  if (!validGitSha(binding.buildSha)) throw new Error('buildSha must be one 40-character Git SHA');
  if (!isAncestor(root, CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT, binding.preparationCommit)) {
    throw new Error('preparationCommit does not contain the staged preparation design baseline');
  }
  const count = migrationManifestCount(root);
  if (count !== 504) throw new Error(`migration manifest must contain exactly 504 entries, found ${count}`);

  return {
    schemaVersion: 1,
    checkpoint: CDB_V1_070B_CHECKPOINT,
    status: 'prepared_not_authorized',
    preparation: {
      branch: binding.branch,
      repositoryCommit: binding.preparationCommit,
      buildSha: binding.buildSha,
      minimumImplementationCommit: CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT,
    },
    bindings: {
      designPath: DESIGN_PATH,
      designSha256: fileSha256(root, DESIGN_PATH),
      planPath: PLAN_PATH,
      planSha256: fileSha256(root, PLAN_PATH),
      historicalExecutionPackagePath: HISTORICAL_EXECUTION_PACKAGE_PATH,
      historicalExecutionPackageSha256: fileSha256(root, HISTORICAL_EXECUTION_PACKAGE_PATH),
      migrationManifestPath: MIGRATION_MANIFEST_PATH,
      migrationManifestSha256: fileSha256(root, MIGRATION_MANIFEST_PATH),
      authorizationContractPath: AUTHORIZATION_CONTRACT_PATH,
      authorizationContractSha256: fileSha256(root, AUTHORIZATION_CONTRACT_PATH),
      authorizationValidatorPath: AUTHORIZATION_VALIDATOR_PATH,
      authorizationValidatorSha256: fileSha256(root, AUTHORIZATION_VALIDATOR_PATH),
      readinessCheckerPath: READINESS_CHECKER_PATH,
      readinessCheckerSha256: fileSha256(root, READINESS_CHECKER_PATH),
    },
    target: {
      platform: 'cloudflare_d1',
      databaseName: CDB101_PRODUCTION_DATABASE_NAME,
      databaseUuid: CDB101_PRODUCTION_DATABASE_ID,
      environment: 'production',
      remote: true,
    },
    worker: {
      serviceName: CDB101_PRODUCTION_WORKER_SERVICE,
      environment: CDB101_PRODUCTION_WORKER_ENVIRONMENT,
      entrypoint: CDB101_PRODUCTION_WORKER_ENTRYPOINT,
      compatibilityDate: CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE,
      routes: [...CDB101_PRODUCTION_WORKER_ROUTES],
      candidateTrafficPercentage: 0,
      previousTrafficPercentage: 100,
    },
    expectedScope: {
      tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
      allActiveTenantAggregateRead: true,
      migrationLedgerAggregateRead: true,
      phiReadAllowed: false,
      rowLevelPatientReadAllowed: false,
      migrationManifestCount: 504,
      expectedPendingMigrationCount: CDB_V1_070A_MIGRATION_NAMES.length,
      expectedPendingMigrationNames: [...CDB_V1_070A_MIGRATION_NAMES],
    },
    commands: commandContract(),
    acceptance: {
      candidateTrafficPercentage: 0,
      previousTrafficPercentage: 100,
      productionRowsWritten: 0,
      migrationsApplied: 0,
      backfillsExecuted: 0,
      providerFlagsChanged: 0,
      trafficChanged: false,
      finalResponseAuthority: 'legacy',
    },
    permissions: {
      productionReadAuthorized: false,
      workerVersionUploadAuthorized: false,
      trafficChangeAuthorized: false,
      timeTravelBookmarkCaptureAuthorized: false,
      backupExportCaptureAuthorized: false,
      productionMigrationAuthorized: false,
      productionBackfillAuthorized: false,
      providerFlagChangeAuthorized: false,
      canonicalPromotionAuthorized: false,
      localSyncActivationAuthorized: false,
      legacyRetirementAuthorized: false,
      destructiveActionAuthorized: false,
    },
    externalBindings: {
      candidate: {
        branch: null,
        commit: null,
        buildSha: null,
        mainIntegrationEvidenceId: null,
        mainIntegrationEvidenceSha256: null,
      },
      productionState: {
        activeTenantEvidenceId: null,
        activeTenantEvidenceSha256: null,
        migrationLedgerEvidenceId: null,
        migrationLedgerEvidenceSha256: null,
        workerMetadataEvidenceId: null,
        workerMetadataEvidenceSha256: null,
        routeEvidenceId: null,
        routeEvidenceSha256: null,
      },
      worker: {
        candidateVersionId: null,
        previousVersionId: null,
        buildManifestSha256: null,
        routeFingerprintSha256: null,
      },
      backup: {
        bookmarkId: null,
        bookmarkSha256: null,
        exportEvidenceId: null,
        exportSha256: null,
      },
      timing: { windowStartUtc: null, windowEndUtc: null, expiresAtUtc: null },
      owners: {
        ownerId: null,
        executionOwnerId: null,
        rollbackOwnerId: null,
        evidenceCustodianId: null,
        riskAcceptanceEvidenceId: null,
        riskAcceptanceEvidenceSha256: null,
      },
      evidenceOutput: { receiptId: null, protectedDirectoryEvidenceId: null },
      confirmation: {
        readToken: null,
        versionUploadToken: null,
        backupCaptureToken: null,
        abortToken: null,
      },
    },
    safety: {
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      workerVersionUploadPerformed: false,
      bookmarkCapturePerformed: false,
      backupExportPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    },
    nextCheckpoint: CDB_V1_070B_NEXT_CHECKPOINT,
  };
}

export function evaluateAllTenantShadowPreparationPackage(
  repositoryRootInput: string,
  document: AllTenantShadowPreparationPackage,
): AllTenantShadowPreparationPackageEvaluation {
  const root = resolve(repositoryRootInput);
  const issues: string[] = [];
  const expectedCommands = commandContract();

  if (document.schemaVersion !== 1
    || document.checkpoint !== CDB_V1_070B_CHECKPOINT
    || document.status !== 'prepared_not_authorized'
    || document.nextCheckpoint !== CDB_V1_070B_NEXT_CHECKPOINT) {
    issues.push('package identity mismatch');
  }
  if (document.preparation.branch !== CDB_V1_070B_BRANCH) issues.push('preparation branch mismatch');
  if (!validGitSha(document.preparation.repositoryCommit)) issues.push('preparation commit invalid');
  if (!validGitSha(document.preparation.buildSha)) issues.push('build SHA invalid');
  if (document.preparation.minimumImplementationCommit !== CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT) {
    issues.push('minimum implementation commit mismatch');
  }
  if (!gitCommitExists(root, document.preparation.repositoryCommit)) issues.push('preparation commit missing');
  if (!isAncestor(root, CDB_V1_070B_MINIMUM_IMPLEMENTATION_COMMIT, document.preparation.repositoryCommit)) {
    issues.push('minimum staged preparation implementation missing');
  }

  if (document.target.databaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || document.target.databaseUuid !== CDB101_PRODUCTION_DATABASE_ID
    || document.target.platform !== 'cloudflare_d1'
    || document.target.environment !== 'production'
    || document.target.remote !== true) {
    issues.push('production target mismatch');
  }
  if (document.worker.serviceName !== CDB101_PRODUCTION_WORKER_SERVICE
    || document.worker.environment !== CDB101_PRODUCTION_WORKER_ENVIRONMENT
    || document.worker.entrypoint !== CDB101_PRODUCTION_WORKER_ENTRYPOINT
    || document.worker.compatibilityDate !== CDB101_PRODUCTION_WORKER_COMPATIBILITY_DATE) {
    issues.push('Worker identity mismatch');
  }
  if (!sameArray(document.worker.routes, CDB101_PRODUCTION_WORKER_ROUTES)) {
    issues.push('Worker route scope mismatch');
  }
  if (document.worker.candidateTrafficPercentage !== 0 || document.worker.previousTrafficPercentage !== 100) {
    issues.push('Worker traffic contract mismatch');
  }
  if (!sameArray(document.expectedScope.tenantIds, CDB_V1_070A_ACTIVE_TENANT_IDS)) {
    issues.push('tenant scope mismatch');
  }
  if (!document.expectedScope.allActiveTenantAggregateRead
    || !document.expectedScope.migrationLedgerAggregateRead
    || document.expectedScope.phiReadAllowed
    || document.expectedScope.rowLevelPatientReadAllowed) {
    issues.push('aggregate read scope mismatch');
  }
  if (document.expectedScope.migrationManifestCount !== 504
    || document.expectedScope.expectedPendingMigrationCount !== CDB_V1_070A_MIGRATION_NAMES.length
    || !sameArray(document.expectedScope.expectedPendingMigrationNames, CDB_V1_070A_MIGRATION_NAMES)) {
    issues.push('migration scope mismatch');
  }

  for (const expected of expectedCommands) {
    const actual = document.commands.find((entry) => entry.phase === expected.phase);
    if (!actual
      || actual.id !== expected.id
      || actual.executable !== false
      || !sameArray(actual.argvTemplate, expected.argvTemplate)) {
      issues.push(`command contract mismatch: ${expected.phase}`);
    }
  }
  if (document.commands.length !== expectedCommands.length) issues.push('command count mismatch');

  for (const [key, value] of Object.entries(document.permissions)) {
    if (value !== false) issues.push(`prepared package cannot authorize ${key}`);
  }
  for (const path of CDB_V1_070B_EXTERNAL_BINDING_PATHS) {
    if (getPath(document.externalBindings, path) !== null) {
      issues.push(`committed package must not embed external binding ${path}`);
    }
  }
  if (Object.values(document.safety).some(Boolean)) issues.push('prepared package safety flags must remain false');

  const expectedBindings: Array<[string, string, string]> = [
    ['design', document.bindings.designPath, document.bindings.designSha256],
    ['plan', document.bindings.planPath, document.bindings.planSha256],
    ['historical execution package', document.bindings.historicalExecutionPackagePath, document.bindings.historicalExecutionPackageSha256],
    ['migration manifest', document.bindings.migrationManifestPath, document.bindings.migrationManifestSha256],
    ['authorization contract', document.bindings.authorizationContractPath, document.bindings.authorizationContractSha256],
    ['authorization validator', document.bindings.authorizationValidatorPath, document.bindings.authorizationValidatorSha256],
    ['readiness checker', document.bindings.readinessCheckerPath, document.bindings.readinessCheckerSha256],
  ];
  for (const [label, path, expectedHash] of expectedBindings) {
    try {
      if (fileSha256(root, path) !== expectedHash) issues.push(`${label} hash mismatch`);
    } catch {
      issues.push(`${label} is missing`);
    }
  }
  if (document.bindings.historicalExecutionPackageSha256
    !== '40d5a069e9080f3465d6f367950522e6515c5ff712525073ccde5732536a57c3') {
    issues.push('historical execution package binding mismatch');
  }
  const manifestCount = migrationManifestCount(root);
  if (manifestCount !== 504) issues.push('migration manifest count mismatch');

  return {
    packageReady: issues.length === 0,
    authorizationReady: false,
    executionReady: false,
    issues,
    unresolvedExternalBindings: [...CDB_V1_070B_EXTERNAL_BINDING_PATHS],
    tenantCount: document.expectedScope.tenantIds.length,
    commandCount: document.commands.length,
    migrationManifestCount: manifestCount,
    expectedPendingMigrationCount: document.expectedScope.expectedPendingMigrationCount,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
    workerVersionUploadPerformed: false,
    trafficChanged: false,
  };
}
