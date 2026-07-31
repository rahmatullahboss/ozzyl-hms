import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CDB_V1_070A_ACTIVE_TENANT_IDS } from './all-tenant-shadow-execution-package';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const CDB_V1_070C_CHECKPOINT =
  'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION-AUTHORIZATION-CONTRACT-READY';
export const CDB_V1_070C_NEXT_CHECKPOINT =
  'CDB-V1-070C-EXACT-RECONCILIATION-AUTHORIZATION-REQUIRED';
export const CDB_V1_070C_BRANCH = 'program/cdb-v1-070c-reconciliation-20260731';
export const CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT =
  'b1ef9992153306d666c6742b7ebb2b92c5195fb9';
export const CDB_V1_070C_PACKAGE_PATH =
  'docs/database/cdb-v1-070c-reconciliation-package.json';

const DESIGN_PATH =
  'docs/superpowers/specs/2026-07-31-cdb-v1-070c-reconciliation-design.md';
const PLAN_PATH =
  'docs/superpowers/plans/2026-07-31-cdb-v1-070c-reconciliation.md';
const HISTORICAL_EXECUTION_PACKAGE_PATH =
  'docs/database/cdb-v1-070-all-tenant-shadow-execution-package.json';
const PACKAGE_CONTRACT_PATH =
  'scripts/canonical/all-tenant-reconciliation-package.ts';
const AUTHORIZATION_CONTRACT_PATH =
  'scripts/canonical/all-tenant-reconciliation-authorization.ts';
const AUTHORIZATION_VALIDATOR_PATH =
  'scripts/canonical/validate-all-tenant-reconciliation-authorization.ts';
const READINESS_CHECKER_PATH =
  'scripts/canonical/check-all-tenant-reconciliation-readiness.ts';
const PACKAGE_PREPARER_PATH =
  'scripts/canonical/prepare-all-tenant-reconciliation-package.ts';
const AUDIT_CONTRACT_PATH =
  'docs/database/audits/2026-07-31-cdb-v1-070c-reconciliation-contract.md';

export interface AllTenantReconciliationMigration {
  name: string;
  sha256: string;
  action: 'record_preapplied_migration_without_ddl';
  maximumLedgerRowsWritten: 1;
}

export interface AllTenantReconciliationArchivalForeignKeyGroup {
  childTable: 'doctor_commission_accruals_old_0391';
  parentTable: 'bills' | 'visits';
  rawViolationCount: number;
  formallyWaivedViolationCount: number;
  effectiveUnwaivedViolationCount: 0;
  disposition: 'formal_waiver';
  removalPhase: 'legacy_retirement_p11';
}

export const CDB_V1_070C_RECONCILIATION_MIGRATIONS: ReadonlyArray<AllTenantReconciliationMigration> = [
  {
    name: '0549_approval_revision_policy.sql',
    sha256: '37ef241634d4c5ee5ab4dd4c1cc4ce880773580fafd31a8a041ea91429b66066',
    action: 'record_preapplied_migration_without_ddl',
    maximumLedgerRowsWritten: 1,
  },
  {
    name: '0551_workforce_roster_integrity.sql',
    sha256: '466c470a5c2c24b73dda9e23f77b2fb095dc35311fc524c2fb478f441072ad41',
    action: 'record_preapplied_migration_without_ddl',
    maximumLedgerRowsWritten: 1,
  },
  {
    name: '0552_attendance_projection_integrity.sql',
    sha256: '6b2619b2983219fe9adb2a48d03ccf960bad58a4c8012d033226ac5ea2dba6e6',
    action: 'record_preapplied_migration_without_ddl',
    maximumLedgerRowsWritten: 1,
  },
  {
    name: '0570_doctor_commission_rule_version_snapshot.sql',
    sha256: '98fe185957d480ae583a213f1133f360b46fa3117237733bca8375e22dbf60c0',
    action: 'record_preapplied_migration_without_ddl',
    maximumLedgerRowsWritten: 1,
  },
];

export const CDB_V1_070C_ARCHIVAL_FK_GROUPS: ReadonlyArray<AllTenantReconciliationArchivalForeignKeyGroup> = [
  {
    childTable: 'doctor_commission_accruals_old_0391',
    parentTable: 'bills',
    rawViolationCount: 26,
    formallyWaivedViolationCount: 26,
    effectiveUnwaivedViolationCount: 0,
    disposition: 'formal_waiver',
    removalPhase: 'legacy_retirement_p11',
  },
  {
    childTable: 'doctor_commission_accruals_old_0391',
    parentTable: 'visits',
    rawViolationCount: 15,
    formallyWaivedViolationCount: 15,
    effectiveUnwaivedViolationCount: 0,
    disposition: 'formal_waiver',
    removalPhase: 'legacy_retirement_p11',
  },
];

export const CDB_V1_070C_EXTERNAL_BINDING_PATHS = [
  'candidate.branch',
  'candidate.commit',
  'candidate.buildSha',
  'gateA.receiptId',
  'gateA.receiptSha256',
  'gateB.receiptId',
  'gateB.receiptSha256',
  ...CDB_V1_070C_RECONCILIATION_MIGRATIONS.flatMap((_, index) => [
    `reconciliation.entries.${index}.schemaEvidenceId`,
    `reconciliation.entries.${index}.schemaEvidenceSha256`,
    `reconciliation.entries.${index}.ledgerEvidenceId`,
    `reconciliation.entries.${index}.ledgerEvidenceSha256`,
  ]),
  'foreignKeyDisposition.evidenceId',
  'foreignKeyDisposition.evidenceSha256',
  'timing.issuedAtUtc',
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
  'confirmation.ledgerReconciliationToken',
  'confirmation.archivalDispositionToken',
  'confirmation.abortToken',
] as const;

export type AllTenantReconciliationPhase =
  | 'fresh_aggregate_verification'
  | 'atomic_migration_ledger_reconciliation'
  | 'archival_fk_disposition_evidence_refresh'
  | 'reconciliation_evidence_verification';

export interface AllTenantReconciliationCommand {
  id: string;
  phase: AllTenantReconciliationPhase;
  executable: false;
  argvTemplate: string[];
}

export interface AllTenantReconciliationPackageBinding {
  branch: string;
  preparationCommit: string;
  buildSha: string;
}

export interface AllTenantReconciliationPackage {
  schemaVersion: 1;
  checkpoint: typeof CDB_V1_070C_CHECKPOINT;
  status: 'prepared_not_authorized';
  preparation: {
    branch: string;
    repositoryCommit: string;
    buildSha: string;
    minimumImplementationCommit: typeof CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT;
  };
  bindings: {
    designPath: typeof DESIGN_PATH;
    designSha256: string;
    planPath: typeof PLAN_PATH;
    planSha256: string;
    historicalExecutionPackagePath: typeof HISTORICAL_EXECUTION_PACKAGE_PATH;
    historicalExecutionPackageSha256: string;
    packageContractPath: typeof PACKAGE_CONTRACT_PATH;
    packageContractSha256: string;
    authorizationContractPath: typeof AUTHORIZATION_CONTRACT_PATH;
    authorizationContractSha256: string;
    authorizationValidatorPath: typeof AUTHORIZATION_VALIDATOR_PATH;
    authorizationValidatorSha256: string;
    readinessCheckerPath: typeof READINESS_CHECKER_PATH;
    readinessCheckerSha256: string;
    packagePreparerPath: typeof PACKAGE_PREPARER_PATH;
    packagePreparerSha256: string;
    auditContractPath: typeof AUDIT_CONTRACT_PATH;
    auditContractSha256: string;
  };
  target: {
    platform: 'cloudflare_d1';
    databaseName: typeof CDB101_PRODUCTION_DATABASE_NAME;
    databaseUuid: typeof CDB101_PRODUCTION_DATABASE_ID;
    environment: 'production';
    remote: true;
  };
  scope: {
    tenantIds: string[];
    phiReadAllowed: false;
    rowLevelPatientReadAllowed: false;
    rawArchivalForeignKeyViolations: 41;
    formallyWaivedArchivalForeignKeyViolations: 41;
    effectiveUnwaivedForeignKeyViolations: 0;
    activeForeignKeyViolations: 0;
    unknownForeignKeyViolations: 0;
  };
  reconciliationMigrations: AllTenantReconciliationMigration[];
  archivalForeignKeyGroups: AllTenantReconciliationArchivalForeignKeyGroup[];
  commands: AllTenantReconciliationCommand[];
  acceptance: {
    pendingMigrationCountBefore: 29;
    pendingMigrationCountAfter: 25;
    migrationLedgerRowsWritten: 4;
    migrationSqlStatementsExecuted: 0;
    ddlStatementsExecuted: 0;
    businessRowsWritten: 0;
    rawArchivalForeignKeyViolations: 41;
    formallyWaivedArchivalForeignKeyViolations: 41;
    effectiveUnwaivedForeignKeyViolations: 0;
    activeForeignKeyViolations: 0;
    unknownForeignKeyViolations: 0;
    trafficChanged: false;
    finalResponseAuthority: 'legacy';
  };
  permissions: {
    productionReadAuthorized: false;
    migrationLedgerReconciliationAuthorized: false;
    archivalFkDispositionEvidenceRefreshAuthorized: false;
    migrationSqlExecutionAuthorized: false;
    productionDdlAuthorized: false;
    businessTableWriteAuthorized: false;
    productionBackfillAuthorized: false;
    providerFlagChangeAuthorized: false;
    workerVersionUploadAuthorized: false;
    deploymentAuthorized: false;
    trafficChangeAuthorized: false;
    routeChangeAuthorized: false;
    canonicalPromotionAuthorized: false;
    localSyncActivationAuthorized: false;
    legacyRetirementAuthorized: false;
    archivalTableMutationAuthorized: false;
    archivalTableDeletionAuthorized: false;
    destructiveActionAuthorized: false;
    remoteDatabaseDeletionAuthorized: false;
  };
  externalBindings: {
    candidate: { branch: null; commit: null; buildSha: null };
    gateA: { receiptId: null; receiptSha256: null };
    gateB: { receiptId: null; receiptSha256: null };
    reconciliation: {
      entries: Array<{
        schemaEvidenceId: null;
        schemaEvidenceSha256: null;
        ledgerEvidenceId: null;
        ledgerEvidenceSha256: null;
      }>;
    };
    foreignKeyDisposition: { evidenceId: null; evidenceSha256: null };
    timing: { issuedAtUtc: null; windowStartUtc: null; windowEndUtc: null; expiresAtUtc: null };
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
      ledgerReconciliationToken: null;
      archivalDispositionToken: null;
      abortToken: null;
    };
  };
  safety: {
    networkRequestPerformed: false;
    productionReadPerformed: false;
    productionMutationPerformed: false;
    migrationLedgerRowsWritten: 0;
    migrationSqlStatementsExecuted: 0;
    ddlStatementsExecuted: 0;
    businessRowsWritten: 0;
    archivalTableMutationPerformed: false;
    trafficChanged: false;
    pushPerformed: false;
    cdbToMainIntegrationPerformed: false;
  };
  nextCheckpoint: typeof CDB_V1_070C_NEXT_CHECKPOINT;
}

export interface AllTenantReconciliationPackageEvaluation {
  packageReady: boolean;
  authorizationReady: false;
  executionReady: false;
  issues: string[];
  unresolvedExternalBindings: string[];
  migrationCount: number;
  archivalForeignKeyGroupCount: number;
  commandCount: number;
  networkRequestPerformed: false;
  productionReadPerformed: false;
  productionMutationPerformed: false;
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
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function validGitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commandContract(): AllTenantReconciliationCommand[] {
  const authorization = '{{PROTECTED_RECONCILIATION_AUTHORIZATION_PATH}}';
  const evidenceDirectory = '{{PROTECTED_EVIDENCE_DIRECTORY}}';
  return [
    {
      id: 'cdbv1070c.fresh-aggregate-verification',
      phase: 'fresh_aggregate_verification',
      executable: false,
      argvTemplate: ['CDB_V1_070C_EXECUTOR', '--phase', 'fresh-aggregate-verification', '--authorization', authorization],
    },
    {
      id: 'cdbv1070c.atomic-migration-ledger-reconciliation',
      phase: 'atomic_migration_ledger_reconciliation',
      executable: false,
      argvTemplate: ['CDB_V1_070C_EXECUTOR', '--phase', 'atomic-migration-ledger-reconciliation', '--authorization', authorization],
    },
    {
      id: 'cdbv1070c.archival-fk-disposition-evidence-refresh',
      phase: 'archival_fk_disposition_evidence_refresh',
      executable: false,
      argvTemplate: ['CDB_V1_070C_EXECUTOR', '--phase', 'archival-fk-disposition-evidence-refresh', '--authorization', authorization],
    },
    {
      id: 'cdbv1070c.reconciliation-evidence-verification',
      phase: 'reconciliation_evidence_verification',
      executable: false,
      argvTemplate: [
        'CDB_V1_070C_EXECUTOR', '--phase', 'reconciliation-evidence-verification',
        '--authorization', authorization, '--evidence-directory', evidenceDirectory,
      ],
    },
  ];
}

function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function expectedBindings(root: string): AllTenantReconciliationPackage['bindings'] {
  return {
    designPath: DESIGN_PATH,
    designSha256: fileSha256(root, DESIGN_PATH),
    planPath: PLAN_PATH,
    planSha256: fileSha256(root, PLAN_PATH),
    historicalExecutionPackagePath: HISTORICAL_EXECUTION_PACKAGE_PATH,
    historicalExecutionPackageSha256: fileSha256(root, HISTORICAL_EXECUTION_PACKAGE_PATH),
    packageContractPath: PACKAGE_CONTRACT_PATH,
    packageContractSha256: fileSha256(root, PACKAGE_CONTRACT_PATH),
    authorizationContractPath: AUTHORIZATION_CONTRACT_PATH,
    authorizationContractSha256: fileSha256(root, AUTHORIZATION_CONTRACT_PATH),
    authorizationValidatorPath: AUTHORIZATION_VALIDATOR_PATH,
    authorizationValidatorSha256: fileSha256(root, AUTHORIZATION_VALIDATOR_PATH),
    readinessCheckerPath: READINESS_CHECKER_PATH,
    readinessCheckerSha256: fileSha256(root, READINESS_CHECKER_PATH),
    packagePreparerPath: PACKAGE_PREPARER_PATH,
    packagePreparerSha256: fileSha256(root, PACKAGE_PREPARER_PATH),
    auditContractPath: AUDIT_CONTRACT_PATH,
    auditContractSha256: fileSha256(root, AUDIT_CONTRACT_PATH),
  };
}

export function buildAllTenantReconciliationPackage(
  repositoryRootInput: string,
  binding: AllTenantReconciliationPackageBinding,
): AllTenantReconciliationPackage {
  const root = resolve(repositoryRootInput);
  if (binding.branch !== CDB_V1_070C_BRANCH) throw new Error('preparation branch mismatch');
  if (!validGitSha(binding.preparationCommit) || !gitCommitExists(root, binding.preparationCommit)) {
    throw new Error('preparationCommit must be an existing 40-character Git commit');
  }
  if (!validGitSha(binding.buildSha)) throw new Error('buildSha must be one 40-character Git SHA');
  if (!isAncestor(root, CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT, binding.preparationCommit)) {
    throw new Error('preparationCommit does not contain the Gate C design baseline');
  }
  for (const migration of CDB_V1_070C_RECONCILIATION_MIGRATIONS) {
    if (fileSha256(root, `migrations/${migration.name}`) !== migration.sha256) {
      throw new Error(`reconciliation migration hash mismatch: ${migration.name}`);
    }
  }

  return {
    schemaVersion: 1,
    checkpoint: CDB_V1_070C_CHECKPOINT,
    status: 'prepared_not_authorized',
    preparation: {
      branch: binding.branch,
      repositoryCommit: binding.preparationCommit,
      buildSha: binding.buildSha,
      minimumImplementationCommit: CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT,
    },
    bindings: expectedBindings(root),
    target: {
      platform: 'cloudflare_d1',
      databaseName: CDB101_PRODUCTION_DATABASE_NAME,
      databaseUuid: CDB101_PRODUCTION_DATABASE_ID,
      environment: 'production',
      remote: true,
    },
    scope: {
      tenantIds: [...CDB_V1_070A_ACTIVE_TENANT_IDS],
      phiReadAllowed: false,
      rowLevelPatientReadAllowed: false,
      rawArchivalForeignKeyViolations: 41,
      formallyWaivedArchivalForeignKeyViolations: 41,
      effectiveUnwaivedForeignKeyViolations: 0,
      activeForeignKeyViolations: 0,
      unknownForeignKeyViolations: 0,
    },
    reconciliationMigrations: CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => ({ ...entry })),
    archivalForeignKeyGroups: CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((entry) => ({ ...entry })),
    commands: commandContract(),
    acceptance: {
      pendingMigrationCountBefore: 29,
      pendingMigrationCountAfter: 25,
      migrationLedgerRowsWritten: 4,
      migrationSqlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      businessRowsWritten: 0,
      rawArchivalForeignKeyViolations: 41,
      formallyWaivedArchivalForeignKeyViolations: 41,
      effectiveUnwaivedForeignKeyViolations: 0,
      activeForeignKeyViolations: 0,
      unknownForeignKeyViolations: 0,
      trafficChanged: false,
      finalResponseAuthority: 'legacy',
    },
    permissions: {
      productionReadAuthorized: false,
      migrationLedgerReconciliationAuthorized: false,
      archivalFkDispositionEvidenceRefreshAuthorized: false,
      migrationSqlExecutionAuthorized: false,
      productionDdlAuthorized: false,
      businessTableWriteAuthorized: false,
      productionBackfillAuthorized: false,
      providerFlagChangeAuthorized: false,
      workerVersionUploadAuthorized: false,
      deploymentAuthorized: false,
      trafficChangeAuthorized: false,
      routeChangeAuthorized: false,
      canonicalPromotionAuthorized: false,
      localSyncActivationAuthorized: false,
      legacyRetirementAuthorized: false,
      archivalTableMutationAuthorized: false,
      archivalTableDeletionAuthorized: false,
      destructiveActionAuthorized: false,
      remoteDatabaseDeletionAuthorized: false,
    },
    externalBindings: {
      candidate: { branch: null, commit: null, buildSha: null },
      gateA: { receiptId: null, receiptSha256: null },
      gateB: { receiptId: null, receiptSha256: null },
      reconciliation: {
        entries: CDB_V1_070C_RECONCILIATION_MIGRATIONS.map(() => ({
          schemaEvidenceId: null,
          schemaEvidenceSha256: null,
          ledgerEvidenceId: null,
          ledgerEvidenceSha256: null,
        })),
      },
      foreignKeyDisposition: { evidenceId: null, evidenceSha256: null },
      timing: { issuedAtUtc: null, windowStartUtc: null, windowEndUtc: null, expiresAtUtc: null },
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
        ledgerReconciliationToken: null,
        archivalDispositionToken: null,
        abortToken: null,
      },
    },
    safety: {
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      migrationSqlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      businessRowsWritten: 0,
      archivalTableMutationPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    },
    nextCheckpoint: CDB_V1_070C_NEXT_CHECKPOINT,
  };
}

export function evaluateAllTenantReconciliationPackage(
  repositoryRootInput: string,
  document: AllTenantReconciliationPackage,
): AllTenantReconciliationPackageEvaluation {
  const root = resolve(repositoryRootInput);
  const issues: string[] = [];
  if (document.schemaVersion !== 1
    || document.checkpoint !== CDB_V1_070C_CHECKPOINT
    || document.status !== 'prepared_not_authorized'
    || document.nextCheckpoint !== CDB_V1_070C_NEXT_CHECKPOINT) {
    issues.push('package identity mismatch');
  }
  if (document.preparation.branch !== CDB_V1_070C_BRANCH) issues.push('preparation branch mismatch');
  if (!validGitSha(document.preparation.repositoryCommit)
    || !gitCommitExists(root, document.preparation.repositoryCommit)
    || !isAncestor(root, CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT, document.preparation.repositoryCommit)) {
    issues.push('preparation commit invalid');
  }
  if (!validGitSha(document.preparation.buildSha)) issues.push('build SHA invalid');
  if (document.preparation.minimumImplementationCommit !== CDB_V1_070C_MINIMUM_IMPLEMENTATION_COMMIT) {
    issues.push('minimum implementation commit mismatch');
  }
  if (document.target.platform !== 'cloudflare_d1'
    || document.target.databaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || document.target.databaseUuid !== CDB101_PRODUCTION_DATABASE_ID
    || document.target.environment !== 'production'
    || document.target.remote !== true) {
    issues.push('production target mismatch');
  }
  if (!sameJson(document.scope.tenantIds, CDB_V1_070A_ACTIVE_TENANT_IDS)) issues.push('tenant scope mismatch');
  if (document.scope.phiReadAllowed !== false
    || document.scope.rowLevelPatientReadAllowed !== false
    || document.scope.rawArchivalForeignKeyViolations !== 41
    || document.scope.formallyWaivedArchivalForeignKeyViolations !== 41
    || document.scope.effectiveUnwaivedForeignKeyViolations !== 0
    || document.scope.activeForeignKeyViolations !== 0
    || document.scope.unknownForeignKeyViolations !== 0) {
    issues.push('scope safety mismatch');
  }
  if (!sameJson(document.reconciliationMigrations, CDB_V1_070C_RECONCILIATION_MIGRATIONS)) {
    issues.push('reconciliation migration contract mismatch');
  }
  for (const migration of CDB_V1_070C_RECONCILIATION_MIGRATIONS) {
    if (!existsSync(join(root, 'migrations', migration.name))
      || fileSha256(root, `migrations/${migration.name}`) !== migration.sha256) {
      if (!issues.includes('reconciliation migration contract mismatch')) {
        issues.push('reconciliation migration contract mismatch');
      }
    }
  }
  if (!sameJson(document.archivalForeignKeyGroups, CDB_V1_070C_ARCHIVAL_FK_GROUPS)) {
    issues.push('archival FK contract mismatch');
  }
  if (!sameJson(document.commands, commandContract())) issues.push('command contract mismatch');
  if (Object.values(document.permissions).some((value) => value !== false)) {
    issues.push('package permission boundary mismatch');
  }
  try {
    if (!sameJson(document.bindings, expectedBindings(root))) issues.push('repository file hash mismatch');
  } catch {
    issues.push('repository file hash mismatch');
  }
  if (document.acceptance.pendingMigrationCountBefore !== 29
    || document.acceptance.pendingMigrationCountAfter !== 25
    || document.acceptance.migrationLedgerRowsWritten !== 4
    || document.acceptance.migrationSqlStatementsExecuted !== 0
    || document.acceptance.ddlStatementsExecuted !== 0
    || document.acceptance.businessRowsWritten !== 0
    || document.acceptance.rawArchivalForeignKeyViolations !== 41
    || document.acceptance.formallyWaivedArchivalForeignKeyViolations !== 41
    || document.acceptance.effectiveUnwaivedForeignKeyViolations !== 0
    || document.acceptance.activeForeignKeyViolations !== 0
    || document.acceptance.unknownForeignKeyViolations !== 0
    || document.acceptance.trafficChanged !== false
    || document.acceptance.finalResponseAuthority !== 'legacy') {
    issues.push('acceptance contract mismatch');
  }
  const unresolvedExternalBindings = CDB_V1_070C_EXTERNAL_BINDING_PATHS
    .filter((path) => getPath(document.externalBindings, path) === null);
  if (unresolvedExternalBindings.length !== CDB_V1_070C_EXTERNAL_BINDING_PATHS.length) {
    issues.push('external binding placeholder mismatch');
  }
  if (Object.values(document.safety).some((value) => value !== false && value !== 0)) {
    issues.push('package safety receipt mismatch');
  }
  return {
    packageReady: issues.length === 0,
    authorizationReady: false,
    executionReady: false,
    issues,
    unresolvedExternalBindings,
    migrationCount: document.reconciliationMigrations.length,
    archivalForeignKeyGroupCount: document.archivalForeignKeyGroups.length,
    commandCount: document.commands.length,
    networkRequestPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
    trafficChanged: false,
  };
}
