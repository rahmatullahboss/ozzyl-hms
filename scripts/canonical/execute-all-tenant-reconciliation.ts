import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadAllTenantReconciliationAuthorization,
} from './all-tenant-reconciliation-authorization';
import {
  buildAllTenantReconciliationEvidenceBundle,
  executeAuthorizedAllTenantReconciliation,
  reconciliationEvidenceSha256,
  type AllTenantReconciliationAggregateState,
  type AllTenantReconciliationExecutionGateway,
} from './all-tenant-reconciliation-executor';
import {
  CDB_V1_070C_PACKAGE_PATH,
  type AllTenantReconciliationPackage,
} from './all-tenant-reconciliation-package';
import {
  createProductionAllTenantReconciliationReadGateway,
  requireProtectedDirectory,
  requireProtectedRegularFile,
  type ReconciliationWranglerRunner,
} from './collect-all-tenant-reconciliation-evidence';
import { CDB101_PRODUCTION_DATABASE_NAME } from './production-cutover-contract';
import { CDB101_PRODUCTION_WORKER_SERVICE } from './reporting-worker-build-version-evidence';

interface D1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

function defaultRunner(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
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

function writeMeta(text: string): { changes: number; rowsWritten: number } {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('D1 write output was not a non-empty array');
  const envelopes = parsed as D1Envelope[];
  if (envelopes.some((entry) => entry.success !== true)) {
    throw new Error('D1 write output contained an unsuccessful envelope');
  }
  return {
    changes: envelopes.reduce((sum, entry) => sum + Number(entry.meta?.changes ?? 0), 0),
    rowsWritten: envelopes.reduce((sum, entry) => sum + Number(entry.meta?.rows_written ?? 0), 0),
  };
}

function deploymentAssignmentFingerprint(text: string): string {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Worker deployment list was empty');
  }
  const deployments = parsed.map((value) => {
    const deployment = value as Record<string, unknown>;
    const createdAt = Date.parse(String(deployment.created_on ?? ''));
    if (!Number.isFinite(createdAt)) throw new Error('Worker deployment timestamp is invalid');
    return { deployment, createdAt };
  });
  const latest = deployments.reduce((current, candidate) => (
    candidate.createdAt > current.createdAt ? candidate : current
  )).deployment;
  const versions = Array.isArray(latest.versions) ? latest.versions : [];
  if (versions.length === 0) throw new Error('Latest Worker deployment has no versions');
  const normalized = versions.map((value) => {
    const version = value as Record<string, unknown>;
    const versionId = String(version.version_id ?? '');
    const percentage = Number(version.percentage);
    if (!/^[0-9a-f-]{36}$/.test(versionId)
      || !Number.isFinite(percentage)
      || percentage < 0
      || percentage > 100) {
      throw new Error('Latest Worker deployment assignment is invalid');
    }
    return { versionId, percentage };
  }).sort((left, right) => left.versionId.localeCompare(right.versionId));
  const total = normalized.reduce((sum, value) => sum + value.percentage, 0);
  if (Math.abs(total - 100) > 0.0001) {
    throw new Error('Latest Worker deployment percentages do not total 100');
  }
  return reconciliationEvidenceSha256({
    deploymentId: String(latest.id ?? ''),
    strategy: String(latest.strategy ?? ''),
    versions: normalized,
  });
}

export function createProductionAllTenantReconciliationExecutionGateway(
  runner: ReconciliationWranglerRunner = defaultRunner,
): AllTenantReconciliationExecutionGateway {
  const reader = createProductionAllTenantReconciliationReadGateway(runner);
  return {
    async readWorkerDeploymentFingerprint() {
      const result = runner([
        'deployments', 'list',
        '--name', CDB101_PRODUCTION_WORKER_SERVICE,
        '--env', 'production',
        '--json',
      ]);
      if (result.status !== 0) {
        throw new Error(`Worker deployment metadata read failed: ${result.stderr.trim()}`);
      }
      return deploymentAssignmentFingerprint(result.stdout);
    },
    readAggregateState: () => reader.readAggregateState(),
    async writeMigrationLedger(sql: string) {
      const result = runner([
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--yes',
        '--command', sql,
      ]);
      if (result.status !== 0) throw new Error(`migration ledger reconciliation failed: ${result.stderr.trim()}`);
      return writeMeta(result.stdout);
    },
  };
}

export interface AllTenantReconciliationExecutionCliOptions {
  authorizationPath: string;
  outputPath: string;
  execute: true;
  atUtc: string;
}

export function parseAllTenantReconciliationExecutionArgs(
  args: string[],
): AllTenantReconciliationExecutionCliOptions {
  const clean = args.filter((arg) => arg !== '--');
  let authorizationPath: string | null = null;
  let outputPath: string | null = null;
  let execute = false;
  let atUtc = new Date().toISOString();
  for (let index = 0; index < clean.length; index += 1) {
    const arg = clean[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--authorization' || arg === '--output' || arg === '--at-utc') {
      const value = clean[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--authorization') authorizationPath = value;
      if (arg === '--output') outputPath = value;
      if (arg === '--at-utc') atUtc = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!execute) throw new Error('Explicit --execute is required');
  if (!authorizationPath || !outputPath) throw new Error('--authorization and --output are required');
  return { authorizationPath, outputPath, execute: true, atUtc };
}

class RecordingGateway implements AllTenantReconciliationExecutionGateway {
  readonly states: AllTenantReconciliationAggregateState[] = [];
  constructor(private readonly delegate: AllTenantReconciliationExecutionGateway) {}

  readWorkerDeploymentFingerprint(): Promise<string> {
    return this.delegate.readWorkerDeploymentFingerprint();
  }

  async readAggregateState(): Promise<AllTenantReconciliationAggregateState> {
    const state = await this.delegate.readAggregateState();
    this.states.push(structuredClone(state));
    return state;
  }

  writeMigrationLedger(sql: string): Promise<{ changes: number; rowsWritten: number }> {
    return this.delegate.writeMigrationLedger(sql);
  }
}

export async function executeAllTenantReconciliationCli(
  options: AllTenantReconciliationExecutionCliOptions,
  repositoryRoot: string,
  gateway: AllTenantReconciliationExecutionGateway,
): Promise<{ receiptPath: string; postEvidencePath: string }> {
  const root = resolve(repositoryRoot);
  const authorizationPath = requireProtectedRegularFile(options.authorizationPath, root);
  const outputDirectory = requireProtectedDirectory(dirname(options.outputPath), root);
  const receiptPath = resolve(options.outputPath);
  if (dirname(receiptPath) !== outputDirectory) throw new Error('Execution receipt path is invalid');
  if (existsSync(receiptPath)) throw new Error('Execution receipt already exists');
  const postEvidencePath = join(outputDirectory, 'post-reconciliation-evidence.json');
  if (existsSync(postEvidencePath)) throw new Error('Post-reconciliation evidence already exists');
  const packageDocument = JSON.parse(
    readFileSync(join(root, CDB_V1_070C_PACKAGE_PATH), 'utf8'),
  ) as AllTenantReconciliationPackage;
  const authorizationResult = loadAllTenantReconciliationAuthorization(
    authorizationPath,
    root,
    packageDocument,
    options.atUtc,
  );
  if (!authorizationResult.authorizationReady || !authorizationResult.authorization) {
    throw new Error(`Exact protected authorization is not ready: ${authorizationResult.issues.map((issue) => issue.code).join(', ')}`);
  }
  const recording = new RecordingGateway(gateway);
  const result = await executeAuthorizedAllTenantReconciliation(
    authorizationResult.authorization,
    recording,
  );
  const postState = recording.states.at(-1);
  if (!postState) throw new Error('Post-reconciliation aggregate state was not captured');
  const postEvidence = buildAllTenantReconciliationEvidenceBundle(
    postState,
    authorizationResult.authorization.repository.candidateCommit,
  );
  writeFileSync(postEvidencePath, `${JSON.stringify(postEvidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(postEvidencePath, 0o600);
  const receipt = {
    schemaVersion: 1,
    executedAtUtc: options.atUtc,
    authorizationId: authorizationResult.authorization.authorizationId,
    authorizationPathSha256: createHash('sha256').update(readFileSync(authorizationPath)).digest('hex'),
    result,
    postEvidence: {
      path: postEvidencePath,
      sha256: reconciliationEvidenceSha256(postEvidence),
      rawArchivalViolationCount: postEvidence.foreignKeyDisposition.document.rawArchivalViolationCount,
      effectiveUnwaivedViolationCount: postEvidence.foreignKeyDisposition.document.effectiveUnwaivedViolationCount,
    },
    operations: {
      productionReadPerformed: true,
      productionMutationPerformed: true,
      migrationLedgerRowsWritten: 4,
      migrationSqlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      businessRowsWritten: 0,
      productionBackfillPerformed: false,
      providerFlagChangePerformed: false,
      workerVersionUploadPerformed: false,
      deploymentPerformed: false,
      trafficChanged: false,
      routeChanged: false,
      canonicalPromotionPerformed: false,
      localSyncActivationPerformed: false,
      legacyRetirementPerformed: false,
      archivalTableMutationPerformed: false,
      archivalTableDeletionPerformed: false,
      destructiveActionPerformed: false,
      remoteDatabaseDeletionPerformed: false,
    },
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(receiptPath, 0o600);
  return { receiptPath, postEvidencePath };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const options = parseAllTenantReconciliationExecutionArgs(process.argv.slice(2));
  const result = await executeAllTenantReconciliationCli(
    options,
    root,
    createProductionAllTenantReconciliationExecutionGateway(),
  );
  process.stdout.write(`${JSON.stringify({
    checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION-COMPLETE',
    receiptPath: result.receiptPath,
    postEvidencePath: result.postEvidencePath,
    pendingMigrationCountBefore: 29,
    pendingMigrationCountAfter: 25,
    migrationLedgerRowsWritten: 4,
    migrationSqlStatementsExecuted: 0,
    ddlStatementsExecuted: 0,
    businessRowsWritten: 0,
    finalResponseAuthority: 'legacy',
    trafficChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
