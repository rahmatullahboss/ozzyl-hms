import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CDB_V1_050_BRANCH,
  CDB_V1_050_CONSUMER_IDS,
  CDB_V1_050_PROVIDER_KEYS,
  CDB_V1_050_SOURCE_TABLES,
  buildProtectedCloneRepositoryBinding,
} from './protected-clone-rehearsal-authorization';

const READINESS_PATH = 'docs/database/cdb-v1-050-protected-clone-rehearsal-readiness.json';
const INTEGRATED_MAIN_BRANCH = 'main';

interface ReadinessDocument {
  version: number;
  checkpoint: string;
  status: string;
  branch: string;
  authorizationIntent: {
    ownerStatementPresent: boolean;
    exactAuthorizationDocumentPresent: boolean;
    sufficientForExecution: boolean;
  };
  contract: {
    module: string;
    validator: string;
    package: string;
    authorizationFileMustBeOutsideRepository: boolean;
    authorizationFileMode: string;
    authorizationDirectoryMode: string;
    symlinkAllowed: boolean;
    hardLinkAllowed: boolean;
    maximumAuthorizationBytes: number;
    maximumRecords: number;
    maximumTenants: number;
    maximumMigrations: number;
    maximumBackfills: number;
    providerCount: number;
    consumerCount: number;
    sourceTableCount: number;
    migrationManifestCount: number;
    aggregateOnlyOutput: boolean;
  };
  allowedPermissions: Record<string, boolean>;
  execution: Record<string, boolean>;
  nextCheckpoint: string;
}

function main(): void {
  const root = process.cwd();
  const document = JSON.parse(readFileSync(resolve(root, READINESS_PATH), 'utf8')) as ReadinessDocument;
  const repository = buildProtectedCloneRepositoryBinding(root);
  const issues: string[] = [];

  if (document.version !== 1) issues.push('version');
  if (document.checkpoint !== 'CDB-V1-050A-PROTECTED-CLONE-REHEARSAL-AUTHORIZATION-CONTRACT-READY') issues.push('checkpoint');
  if (document.status !== 'contract_ready_exact_external_bindings_absent') issues.push('status');
  if (document.branch !== CDB_V1_050_BRANCH || repository.branch !== INTEGRATED_MAIN_BRANCH) issues.push('branch');
  if (!document.authorizationIntent.ownerStatementPresent) issues.push('owner-intent');
  if (document.authorizationIntent.exactAuthorizationDocumentPresent) issues.push('authorization-document');
  if (document.authorizationIntent.sufficientForExecution) issues.push('authorization-sufficiency');
  if (document.contract.module !== 'scripts/canonical/protected-clone-rehearsal-authorization.ts') issues.push('module');
  if (document.contract.validator !== 'scripts/canonical/validate-protected-clone-rehearsal-authorization.ts') issues.push('validator');
  if (document.contract.package !== 'docs/database/cdb-v1-040c-protected-clone-comparison-package.json') issues.push('package');
  if (!document.contract.authorizationFileMustBeOutsideRepository) issues.push('external-file');
  if (document.contract.authorizationFileMode !== '0600') issues.push('file-mode');
  if (document.contract.authorizationDirectoryMode !== '0700') issues.push('directory-mode');
  if (document.contract.symlinkAllowed || document.contract.hardLinkAllowed) issues.push('link-policy');
  if (document.contract.maximumAuthorizationBytes !== 262144) issues.push('max-bytes');
  if (document.contract.maximumRecords !== 100 || document.contract.maximumTenants !== 10) issues.push('scope-limits');
  if (document.contract.maximumMigrations !== 50 || document.contract.maximumBackfills !== 30) issues.push('execution-limits');
  if (document.contract.providerCount !== CDB_V1_050_PROVIDER_KEYS.length) issues.push('provider-count');
  if (document.contract.consumerCount !== CDB_V1_050_CONSUMER_IDS.length) issues.push('consumer-count');
  if (document.contract.sourceTableCount !== CDB_V1_050_SOURCE_TABLES.length) issues.push('source-table-count');
  if (document.contract.migrationManifestCount !== repository.migrationCount) issues.push('migration-count');
  if (!document.contract.aggregateOnlyOutput) issues.push('aggregate-output');

  for (const key of [
    'protectedCloneRead',
    'protectedCloneSchemaMigration',
    'protectedCloneBackfill',
    'providerPromotionRehearsal',
    'rollbackRehearsal',
  ]) {
    if (document.allowedPermissions[key] !== true) issues.push(`permission-${key}`);
  }
  for (const [key, value] of Object.entries(document.allowedPermissions)) {
    if (![
      'protectedCloneRead',
      'protectedCloneSchemaMigration',
      'protectedCloneBackfill',
      'providerPromotionRehearsal',
      'rollbackRehearsal',
    ].includes(key) && value !== false) issues.push(`forbidden-permission-${key}`);
  }
  if (Object.values(document.execution).some(Boolean)) issues.push('execution-state');
  if (document.nextCheckpoint !== 'CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-EXACT-AUTHORIZATION-REQUIRED') issues.push('next-checkpoint');

  const output = {
    contractReady: issues.length === 0,
    executionReady: false,
    issueCount: issues.length,
    issues,
    providerCount: CDB_V1_050_PROVIDER_KEYS.length,
    consumerCount: CDB_V1_050_CONSUMER_IDS.length,
    sourceTableCount: CDB_V1_050_SOURCE_TABLES.length,
    migrationManifestCount: repository.migrationCount,
    networkRequestPerformed: false,
    protectedCloneMutationPerformed: false,
    productionReadPerformed: false,
    productionMutationPerformed: false,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length > 0) process.exitCode = 1;
}

main();
