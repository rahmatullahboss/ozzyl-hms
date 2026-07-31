import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { ProductionCanonicalImportManifest } from './import-production-canonical-bundle';
import { verifyCanonicalImportSecondPassOutput } from './import-production-canonical-bundle';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  validateCanonicalImportBundleSql,
} from './production-cutover-contract';
import {
  CDB101_FINANCIAL_IMPORT_TABLES,
  validateTenantFinancialImportManifest,
} from './tenant-financial-import-contract';
import {
  TENANT_FINANCIAL_RECONCILIATION_SQL,
  buildTenantFinancialSnapshotFromAggregateRow,
  type TenantFinancialAggregateRow,
} from './collect-tenant-financial-reconciliation';
import {
  evaluateTenantFinancialReconciliation,
  type TenantFinancialAggregate,
  type TenantFinancialReconciliationReceipt,
} from './tenant-financial-reconciliation';

const FINANCIAL_FLAG_KEY = 'canonical_financial_dual_write_v1';
const SHADOW_FINANCIAL_FLAG_CONFIG = '{"tenantScope":["100"],"writePolicy":"shadow"}';
const INITIAL_FINANCIAL_FLAG_CONFIG = '{"tenantScope":["100"],"writePolicy":"canonical-only"}';
const MAX_SOURCE_AGE_MS = 15 * 60 * 1000;

export type ProductionTenantFinancialImportOperation = 'initial-import' | 'shadow-repair';

export function expectedFinancialFlagConfigForOperation(
  operation: ProductionTenantFinancialImportOperation,
): string {
  return operation === 'shadow-repair'
    ? SHADOW_FINANCIAL_FLAG_CONFIG
    : INITIAL_FINANCIAL_FLAG_CONFIG;
}

export interface CanonicalTableState {
  tableName: string;
  globalRowCount: number;
  maxId: number;
  tenantRowCount: number;
}

export interface ProductionTenantFinancialImportEvidence {
  schemaVersion: 1;
  operation: ProductionTenantFinancialImportOperation;
  authorizationId: string;
  tenantId: '100';
  operator: 'Rahmatullah Zisan';
  productionDatabaseId: string;
  activeWorkerVersionId: string;
  expectedFlagVersion: number;
  expectedFlagConfigJson: string;
  sourceCapturedAtUtc: string;
  observedAtUtc: string;
  expiresAtUtc: string;
  sourceExportSha256: string;
  sourceExportSizeBytes: number;
  timeTravelEvidenceSha256: string | null;
  bundleSha256: string;
  manifestSha256: string;
  localReconciliationSha256: string;
  deterministicRunId: string;
  secondPassNewRows: 0;
  sourceCanonicalState: CanonicalTableState[];
  targetCanonicalState: CanonicalTableState[];
  sourceLegacyAggregate: TenantFinancialAggregate;
}

export interface PrepareProductionTenantFinancialImportInput {
  evidence: ProductionTenantFinancialImportEvidence;
  manifest: ProductionCanonicalImportManifest;
  bundlePath: string;
  bundleSql: string;
  actualBundleSha256: string;
  actualManifestSha256: string;
  actualSourceExportSha256: string;
  actualLocalReconciliationSha256: string;
  localReconciliation: TenantFinancialReconciliationReceipt;
  atUtc: string;
  approval: string | null;
  execute: boolean;
}

export interface ProductionTenantFinancialImportPlan {
  allowed: boolean;
  issues: string[];
  productionMutationPerformed: false;
}

export interface ProductionTenantFinancialImportCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProductionTenantFinancialImportGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readActiveWorkerVersion(): Promise<string>;
  readFinancialFlag(): Promise<Array<Record<string, unknown>>>;
  readCanonicalTableState(): Promise<CanonicalTableState[]>;
  readLegacyAggregate(): Promise<TenantFinancialAggregate>;
  executeBundle(bundlePath: string): Promise<ProductionTenantFinancialImportCommandResult>;
  readProductionReconciliation(): Promise<TenantFinancialReconciliationReceipt>;
}

export interface ProductionTenantFinancialImportResult {
  allowed: boolean;
  issues: string[];
  productionMutationPerformed: boolean;
  secondPassChanges: number;
  secondPassRowsWritten: number;
  productionReconciliationReady: boolean;
}

function utcMillis(value: string): number {
  return value.endsWith('Z') ? Date.parse(value) : Number.NaN;
}

function sha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function exactAggregate(left: TenantFinancialAggregate, right: TenantFinancialAggregate): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => right[key as keyof TenantFinancialAggregate] === value);
}

function normalizeState(rows: readonly CanonicalTableState[]): CanonicalTableState[] {
  return [...rows].sort((left, right) => left.tableName.localeCompare(right.tableName));
}

function validState(rows: readonly CanonicalTableState[]): boolean {
  const expected = [...CDB101_FINANCIAL_IMPORT_TABLES].sort();
  const normalized = normalizeState(rows);
  return normalized.length === expected.length
    && normalized.every((row, index) => (
      row.tableName === expected[index]
      && safeInteger(row.globalRowCount)
      && safeInteger(row.maxId)
      && safeInteger(row.tenantRowCount)
      && row.tenantRowCount <= row.globalRowCount
    ));
}

function exactState(left: readonly CanonicalTableState[], right: readonly CanonicalTableState[]): boolean {
  const a = normalizeState(left);
  const b = normalizeState(right);
  return a.length === b.length && a.every((row, index) => (
    row.tableName === b[index].tableName
    && row.globalRowCount === b[index].globalRowCount
    && row.maxId === b[index].maxId
    && row.tenantRowCount === b[index].tenantRowCount
  ));
}

function validReconciliation(receipt: TenantFinancialReconciliationReceipt): boolean {
  return receipt.schemaVersion === 1
    && receipt.tenantId === '100'
    && receipt.evidenceReady === true
    && receipt.activationReady === true
    && receipt.issues.length === 0
    && Object.values(receipt.variance).every((value) => value === 0)
    && Object.values(receipt.controls).every((value) => value === 0)
    && receipt.aggregateOnly === true
    && receipt.productionMutationPerformed === false;
}

export function prepareProductionTenantFinancialImport(
  input: PrepareProductionTenantFinancialImportInput,
): ProductionTenantFinancialImportPlan {
  const issues: string[] = [];
  const evidence = input.evidence;
  const at = utcMillis(input.atUtc);
  const captured = utcMillis(evidence.sourceCapturedAtUtc);
  const observed = utcMillis(evidence.observedAtUtc);
  const expires = utcMillis(evidence.expiresAtUtc);

  if (evidence.schemaVersion !== 1) issues.push('CDB101_FINANCIAL_IMPORT_EVIDENCE_VERSION_INVALID');
  if (evidence.operation !== 'initial-import' && evidence.operation !== 'shadow-repair') {
    issues.push('CDB101_FINANCIAL_IMPORT_OPERATION_INVALID');
  }
  if (evidence.tenantId !== '100') issues.push('CDB101_FINANCIAL_IMPORT_TENANT_INVALID');
  if (evidence.operator !== 'Rahmatullah Zisan') issues.push('CDB101_FINANCIAL_IMPORT_OPERATOR_INVALID');
  if (evidence.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_FINANCIAL_IMPORT_DATABASE_INVALID');
  }
  if (!/^[a-f0-9-]{32,64}$/i.test(evidence.activeWorkerVersionId)) {
    issues.push('CDB101_FINANCIAL_IMPORT_WORKER_INVALID');
  }
  if (!Number.isInteger(evidence.expectedFlagVersion) || evidence.expectedFlagVersion < 1) {
    issues.push('CDB101_FINANCIAL_IMPORT_FLAG_VERSION_INVALID');
  }
  if (!evidence.expectedFlagConfigJson.trim()) issues.push('CDB101_FINANCIAL_IMPORT_FLAG_CONFIG_INVALID');
  if (
    !Number.isFinite(at)
    || !Number.isFinite(captured)
    || !Number.isFinite(observed)
    || !Number.isFinite(expires)
    || captured > observed
    || observed > at
    || expires <= at
  ) {
    issues.push('CDB101_FINANCIAL_IMPORT_WINDOW_INVALID');
  }
  if (Number.isFinite(at) && Number.isFinite(captured) && (at - captured < 0 || at - captured > MAX_SOURCE_AGE_MS)) {
    issues.push('CDB101_FINANCIAL_IMPORT_SOURCE_STALE');
  }
  if (!safeInteger(evidence.sourceExportSizeBytes) || evidence.sourceExportSizeBytes === 0) {
    issues.push('CDB101_FINANCIAL_IMPORT_SOURCE_SIZE_INVALID');
  }
  for (const [value, code] of [
    [evidence.sourceExportSha256, 'CDB101_FINANCIAL_IMPORT_SOURCE_HASH_INVALID'],
    [evidence.bundleSha256, 'CDB101_FINANCIAL_IMPORT_BUNDLE_HASH_INVALID'],
    [evidence.manifestSha256, 'CDB101_FINANCIAL_IMPORT_MANIFEST_HASH_INVALID'],
    [evidence.localReconciliationSha256, 'CDB101_FINANCIAL_IMPORT_RECONCILIATION_HASH_INVALID'],
  ] as const) {
    if (!sha256(value)) issues.push(code);
  }
  if (
    evidence.operation === 'initial-import'
      ? !evidence.timeTravelEvidenceSha256 || !sha256(evidence.timeTravelEvidenceSha256)
      : evidence.timeTravelEvidenceSha256 !== null && !sha256(evidence.timeTravelEvidenceSha256)
  ) {
    issues.push('CDB101_FINANCIAL_IMPORT_TIME_TRAVEL_HASH_INVALID');
  }
  if (!validState(evidence.sourceCanonicalState) || !validState(evidence.targetCanonicalState)) {
    issues.push('CDB101_FINANCIAL_IMPORT_CANONICAL_STATE_INVALID');
  }
  if (evidence.secondPassNewRows !== 0) issues.push('CDB101_FINANCIAL_IMPORT_SECOND_PASS_NOT_ZERO');
  if (!validReconciliation(input.localReconciliation)) {
    issues.push('CDB101_FINANCIAL_IMPORT_LOCAL_RECONCILIATION_INVALID');
  }

  const manifestResult = validateTenantFinancialImportManifest(input.manifest);
  issues.push(...manifestResult.issues);
  const sqlResult = validateCanonicalImportBundleSql(
    input.bundleSql,
    [...CDB101_FINANCIAL_IMPORT_TABLES],
  );
  if (!sqlResult.valid) issues.push('CDB101_FINANCIAL_IMPORT_BUNDLE_SQL_INVALID');
  if (!input.bundlePath.endsWith('.sql')) issues.push('CDB101_FINANCIAL_IMPORT_BUNDLE_PATH_INVALID');
  if (input.manifest.authorizationId !== evidence.authorizationId) {
    issues.push('CDB101_FINANCIAL_IMPORT_AUTHORIZATION_SCOPE_MISMATCH');
  }
  if (input.manifest.deterministicRunId !== evidence.deterministicRunId) {
    issues.push('CDB101_FINANCIAL_IMPORT_RUN_ID_MISMATCH');
  }
  if (input.actualBundleSha256 !== evidence.bundleSha256 || input.actualBundleSha256 !== input.manifest.bundleSha256) {
    issues.push('CDB101_FINANCIAL_IMPORT_BUNDLE_HASH_MISMATCH');
  }
  if (input.actualManifestSha256 !== evidence.manifestSha256) {
    issues.push('CDB101_FINANCIAL_IMPORT_MANIFEST_HASH_MISMATCH');
  }
  if (
    input.actualSourceExportSha256 !== evidence.sourceExportSha256
    || input.actualSourceExportSha256 !== input.manifest.sourceExportSha256
  ) {
    issues.push('CDB101_FINANCIAL_IMPORT_SOURCE_HASH_MISMATCH');
  }
  if (input.actualLocalReconciliationSha256 !== evidence.localReconciliationSha256) {
    issues.push('CDB101_FINANCIAL_IMPORT_RECONCILIATION_HASH_MISMATCH');
  }
  if (validState(evidence.targetCanonicalState)) {
    for (const row of evidence.targetCanonicalState) {
      if (input.manifest.rowCountSummary[row.tableName] !== row.tenantRowCount) {
        issues.push('CDB101_FINANCIAL_IMPORT_TARGET_COUNT_MISMATCH');
        break;
      }
    }
  }
  if (!input.execute) issues.push('CDB101_FINANCIAL_IMPORT_EXECUTE_SWITCH_MISSING');
  if (input.approval !== evidence.authorizationId) issues.push('CDB101_FINANCIAL_IMPORT_APPROVAL_MISMATCH');

  return {
    allowed: issues.length === 0,
    issues: [...new Set(issues)],
    productionMutationPerformed: false,
  };
}

function exactExpectedFlag(
  row: Record<string, unknown>,
  evidence: ProductionTenantFinancialImportEvidence,
): boolean {
  const exactState = evidence.operation === 'shadow-repair'
    ? row.mode === 'shadow' && Number(row.is_enabled) === 1
    : row.mode === 'disabled' && Number(row.is_enabled) === 0;
  return row.tenant_id === '100'
    && row.flag_key === FINANCIAL_FLAG_KEY
    && row.domain === 'financial'
    && exactState
    && Number(row.version) === evidence.expectedFlagVersion
    && row.config_json === evidence.expectedFlagConfigJson;
}

export async function executeProductionTenantFinancialImport(
  input: PrepareProductionTenantFinancialImportInput,
  gateway: ProductionTenantFinancialImportGateway,
): Promise<ProductionTenantFinancialImportResult> {
  const plan = prepareProductionTenantFinancialImport(input);
  if (!plan.allowed) {
    return {
      allowed: false,
      issues: plan.issues,
      productionMutationPerformed: false,
      secondPassChanges: 0,
      secondPassRowsWritten: 0,
      productionReconciliationReady: false,
    };
  }

  const database = await gateway.readDatabaseIdentity();
  if (database.uuid !== CDB101_PRODUCTION_DATABASE_ID || database.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production financial import database identity mismatch');
  }
  const worker = await gateway.readActiveWorkerVersion();
  if (worker !== input.evidence.activeWorkerVersionId) {
    throw new Error('Production financial import active Worker version mismatch');
  }
  const flags = await gateway.readFinancialFlag();
  if (flags.length !== 1 || !exactExpectedFlag(flags[0], input.evidence)) {
    throw new Error('Production financial import financial flag pre-state mismatch');
  }
  const preState = await gateway.readCanonicalTableState();
  if (!exactState(preState, input.evidence.sourceCanonicalState)) {
    throw new Error('Production financial import canonical table state drift');
  }
  const liveLegacy = await gateway.readLegacyAggregate();
  if (!exactAggregate(liveLegacy, input.evidence.sourceLegacyAggregate)) {
    throw new Error('Production financial import legacy aggregate drift');
  }

  const firstPass = await gateway.executeBundle(input.bundlePath);
  if (firstPass.exitCode !== 0) {
    throw new Error(`Production financial import first pass failed: ${firstPass.stderr.trim()}`);
  }
  d1Envelopes(firstPass.stdout);
  const secondPass = await gateway.executeBundle(input.bundlePath);
  if (secondPass.exitCode !== 0) {
    throw new Error(`Production financial import second pass failed: ${secondPass.stderr.trim()}`);
  }
  const proof = verifyCanonicalImportSecondPassOutput(secondPass.stdout);

  const postState = await gateway.readCanonicalTableState();
  if (!exactState(postState, input.evidence.targetCanonicalState)) {
    throw new Error('Production financial import post-import canonical table state mismatch');
  }
  const productionReconciliation = await gateway.readProductionReconciliation();
  if (!validReconciliation(productionReconciliation)) {
    throw new Error('production financial reconciliation failed');
  }

  return {
    allowed: true,
    issues: [],
    productionMutationPerformed: true,
    secondPassChanges: proof.changes,
    secondPassRowsWritten: proof.rowsWritten,
    productionReconciliationReady: true,
  };
}

function quoteIdentifier(value: string): string {
  if (!CDB101_FINANCIAL_IMPORT_TABLES.includes(value as never)) throw new Error('Unexpected canonical table');
  return `"${value}"`;
}

function collectCanonicalState(database: DatabaseSync): CanonicalTableState[] {
  return CDB101_FINANCIAL_IMPORT_TABLES.map((tableName) => {
    const row = database.prepare(`
      SELECT COUNT(*) global_row_count, COALESCE(MAX(id),0) max_id,
             COALESCE(SUM(CASE WHEN tenant_id='100' THEN 1 ELSE 0 END),0) tenant_row_count
      FROM ${quoteIdentifier(tableName)}
    `).get() as Record<string, unknown>;
    return {
      tableName,
      globalRowCount: Number(row.global_row_count),
      maxId: Number(row.max_id),
      tenantRowCount: Number(row.tenant_row_count),
    };
  });
}

function financialSnapshot(database: DatabaseSync, cutoffUtc: string) {
  const row = database.prepare(TENANT_FINANCIAL_RECONCILIATION_SQL).get() as TenantFinancialAggregateRow | undefined;
  if (!row) throw new Error('Financial aggregate row was unavailable');
  return buildTenantFinancialSnapshotFromAggregateRow(row, cutoffUtc, 0);
}

export interface ProtectedFinancialBundleReplay {
  sourceCanonicalState: CanonicalTableState[];
  targetCanonicalState: CanonicalTableState[];
  sourceLegacyAggregate: TenantFinancialAggregate;
  targetCanonicalAggregate: TenantFinancialAggregate;
  reconciliation: TenantFinancialReconciliationReceipt;
}

export function replayProtectedFinancialBundle(input: {
  sourceExportPath: string;
  bundleSql: string;
  cutoffUtc: string;
  protectedParentDirectory: string;
}): ProtectedFinancialBundleReplay {
  const replayDirectory = mkdtempSync(join(input.protectedParentDirectory, '.financial-import-replay-'));
  chmodSync(replayDirectory, 0o700);
  const databasePath = join(replayDirectory, 'replay.sqlite');
  const materialize = spawnSync('sqlite3', [databasePath], {
    input: readFileSync(input.sourceExportPath),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (materialize.error) {
    rmSync(replayDirectory, { recursive: true, force: true });
    throw materialize.error;
  }
  if (materialize.status !== 0) {
    rmSync(replayDirectory, { recursive: true, force: true });
    throw new Error(`Protected source export replay failed: ${(materialize.stderr ?? '').trim()}`);
  }
  chmodSync(databasePath, 0o600);
  const database = new DatabaseSync(databasePath);
  try {
    const sourceCanonicalState = collectCanonicalState(database);
    const sourceSnapshot = financialSnapshot(database, input.cutoffUtc);
    database.exec(input.bundleSql);
    const targetCanonicalState = collectCanonicalState(database);
    const targetSnapshot = financialSnapshot(database, input.cutoffUtc);
    return {
      sourceCanonicalState,
      targetCanonicalState,
      sourceLegacyAggregate: sourceSnapshot.legacy,
      targetCanonicalAggregate: targetSnapshot.canonical,
      reconciliation: evaluateTenantFinancialReconciliation(targetSnapshot),
    };
  } finally {
    database.close();
    rmSync(replayDirectory, { recursive: true, force: true });
  }
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function outsideRepository(path: string, repositoryRoot: string): string {
  const absolute = resolve(path);
  const root = resolve(repositoryRoot);
  if (absolute === root || absolute.startsWith(`${root}${sep}`)) {
    throw new Error('Protected financial import material must remain outside the repository');
  }
  return absolute;
}

function requireProtectedDirectory(path: string, repositoryRoot: string): string {
  const absolute = outsideRepository(path, repositoryRoot);
  if (!existsSync(absolute)) throw new Error(`Protected directory missing: ${absolute}`);
  const directory = lstatSync(absolute);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700) {
    throw new Error(`Protected directory must be mode 700: ${absolute}`);
  }
  return absolute;
}

function requireProtectedFile(path: string, repositoryRoot: string): string {
  const absolute = outsideRepository(path, repositoryRoot);
  if (!existsSync(absolute)) throw new Error(`Protected file missing: ${absolute}`);
  const file = lstatSync(absolute);
  requireProtectedDirectory(dirname(absolute), repositoryRoot);
  if (
    !file.isFile()
    || file.isSymbolicLink()
    || file.nlink !== 1
    || (file.mode & 0o777) !== 0o600
  ) {
    throw new Error(`Protected file must be regular, single-link, mode 600: ${absolute}`);
  }
  return absolute;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number;
}

type CommandRunner = (args: string[]) => Promise<CommandResult>;

async function defaultRunner(args: string[]): Promise<CommandResult> {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
}

function extractJson(text: string): unknown {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try { return JSON.parse(text.slice(arrayStart, arrayEnd + 1)); } catch { /* continue */ }
  }
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  throw new Error('Wrangler output did not contain JSON');
}

function d1Envelopes(text: string): Array<{ results?: Array<Record<string, unknown>>; meta?: Record<string, unknown>; success?: boolean }> {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) throw new Error('D1 output was not an array');
  const envelopes = parsed as Array<{
    results?: Array<Record<string, unknown>>;
    meta?: Record<string, unknown>;
    success?: boolean;
  }>;
  if (envelopes.length === 0 || envelopes.some((envelope) => envelope.success !== true)) {
    throw new Error('D1 output contained an unsuccessful envelope');
  }
  return envelopes;
}

function canonicalStateSql(): string {
  return CDB101_FINANCIAL_IMPORT_TABLES.map((tableName) => `
    SELECT '${tableName}' table_name, COUNT(*) global_row_count, COALESCE(MAX(id),0) max_id,
           COALESCE(SUM(CASE WHEN tenant_id='100' THEN 1 ELSE 0 END),0) tenant_row_count
    FROM ${quoteIdentifier(tableName)};
  `).join('\n');
}

export function createProductionTenantFinancialImportGateway(
  bundlePath: string,
  runner: CommandRunner = defaultRunner,
): ProductionTenantFinancialImportGateway {
  const run = async (args: string[], label: string): Promise<CommandResult> => {
    const result = await runner(args);
    if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
    return result;
  };
  const d1 = async (sql: string, label: string) => run([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command', sql,
  ], label);

  return {
    async readDatabaseIdentity() {
      const parsed = extractJson((await run([
        'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json',
      ], 'production database identity')).stdout) as { uuid?: unknown; name?: unknown };
      return { uuid: parsed.uuid, name: parsed.name };
    },
    async readActiveWorkerVersion() {
      const parsed = extractJson((await run(['deployments', 'list', '--env', 'production', '--json'], 'production deployments')).stdout) as Array<{
        created_on?: string;
        versions?: Array<{ version_id?: string; percentage?: number }>;
      }>;
      const latest = [...parsed].sort((left, right) => String(right.created_on ?? '').localeCompare(String(left.created_on ?? '')))[0];
      const active = latest?.versions?.find((version) => Number(version.percentage) === 100);
      if (!active?.version_id) throw new Error('Active production Worker version unavailable');
      return active.version_id;
    },
    async readFinancialFlag() {
      const envelopes = d1Envelopes((await d1(`
        SELECT tenant_id,flag_key,domain,mode,is_enabled,version,config_json
        FROM canonical_feature_flags
        WHERE tenant_id='100' AND flag_key='${FINANCIAL_FLAG_KEY}' LIMIT 2;
      `, 'financial flag read')).stdout);
      return envelopes.flatMap((envelope) => envelope.results ?? []);
    },
    async readCanonicalTableState() {
      const envelopes = d1Envelopes((await d1(canonicalStateSql(), 'canonical state read')).stdout);
      return envelopes.flatMap((envelope) => envelope.results ?? []).map((row) => ({
        tableName: String(row.table_name),
        globalRowCount: Number(row.global_row_count),
        maxId: Number(row.max_id),
        tenantRowCount: Number(row.tenant_row_count),
      }));
    },
    async readLegacyAggregate() {
      const envelopes = d1Envelopes((await d1(TENANT_FINANCIAL_RECONCILIATION_SQL, 'legacy aggregate read')).stdout);
      const rows = envelopes.flatMap((envelope) => envelope.results ?? []);
      if (rows.length !== 1) throw new Error('Legacy aggregate query did not return one row');
      return buildTenantFinancialSnapshotFromAggregateRow(
        rows[0] as unknown as TenantFinancialAggregateRow,
        new Date().toISOString(),
        0,
      ).legacy;
    },
    async executeBundle(requestedBundlePath) {
      if (resolve(requestedBundlePath) !== resolve(bundlePath)) {
        throw new Error('Production financial import bundle path mismatch');
      }
      const result = await runner([
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--file', requestedBundlePath, '--yes',
      ]);
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    async readProductionReconciliation() {
      const envelopes = d1Envelopes((await d1(TENANT_FINANCIAL_RECONCILIATION_SQL, 'production reconciliation read')).stdout);
      const rows = envelopes.flatMap((envelope) => envelope.results ?? []);
      if (rows.length !== 1) throw new Error('Production reconciliation query did not return one row');
      const snapshot = buildTenantFinancialSnapshotFromAggregateRow(
        rows[0] as unknown as TenantFinancialAggregateRow,
        new Date().toISOString(),
        0,
      );
      return evaluateTenantFinancialReconciliation(snapshot);
    },
  };
}

interface CliOptions {
  operation: ProductionTenantFinancialImportOperation;
  authorizationId: string;
  approval: string;
  activeWorkerVersionId: string;
  expectedFlagVersion: number;
  sourceExportPath: string;
  exportMetadataPath: string;
  timeTravelEvidencePath: string | null;
  bundlePath: string;
  manifestPath: string;
  localReconciliationPath: string;
  observedAtUtc: string;
  expiresAtUtc: string;
  outputPath: string;
  execute: boolean;
}

export function parseProductionTenantFinancialImportArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--execute') { execute = true; continue; }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  const required = (key: string) => {
    const value = values.get(key);
    if (!value) throw new Error(`${key} is required`);
    return value;
  };
  const operation = values.get('--operation') ?? 'initial-import';
  if (operation !== 'initial-import' && operation !== 'shadow-repair') {
    throw new Error('--operation must be initial-import or shadow-repair');
  }
  const timeTravelEvidencePath = values.get('--time-travel-evidence') ?? null;
  if (operation === 'initial-import' && !timeTravelEvidencePath) {
    throw new Error('--time-travel-evidence is required');
  }
  return {
    operation,
    authorizationId: required('--authorization-id'),
    approval: required('--approval'),
    activeWorkerVersionId: required('--active-worker-version'),
    expectedFlagVersion: Number(required('--expected-flag-version')),
    sourceExportPath: required('--source-export'),
    exportMetadataPath: required('--export-metadata'),
    timeTravelEvidencePath,
    bundlePath: required('--bundle'),
    manifestPath: required('--manifest'),
    localReconciliationPath: required('--local-reconciliation'),
    observedAtUtc: required('--observed-at-utc'),
    expiresAtUtc: required('--expires-at-utc'),
    outputPath: required('--output'),
    execute,
  };
}

async function main(): Promise<void> {
  const options = parseProductionTenantFinancialImportArgs(process.argv.slice(2));
  const root = process.cwd();
  const sourceExportPath = requireProtectedFile(options.sourceExportPath, root);
  const exportMetadataPath = requireProtectedFile(options.exportMetadataPath, root);
  const timeTravelEvidencePath = options.timeTravelEvidencePath
    ? requireProtectedFile(options.timeTravelEvidencePath, root)
    : null;
  const bundlePath = requireProtectedFile(options.bundlePath, root);
  const manifestPath = requireProtectedFile(options.manifestPath, root);
  const localReconciliationPath = requireProtectedFile(options.localReconciliationPath, root);
  const outputPath = resolve(options.outputPath);
  requireProtectedDirectory(dirname(outputPath), root);
  if (existsSync(outputPath)) throw new Error('Financial import output already exists');

  const metadata = JSON.parse(readFileSync(exportMetadataPath, 'utf8')) as {
    productionDatabaseName?: string;
    productionDatabaseId?: string;
    exportSha256?: string;
    exportSizeBytes?: number;
    timeTravelEvidenceFile?: string;
    timeTravelEvidenceSha256?: string;
    createdAtUtc?: string;
  };
  const timeTravelMetadataValid = timeTravelEvidencePath === null
    ? options.operation === 'shadow-repair'
    : resolve(String(metadata.timeTravelEvidenceFile ?? '')) === timeTravelEvidencePath
      && metadata.timeTravelEvidenceSha256 === fileHash(timeTravelEvidencePath);
  if (
    metadata.productionDatabaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || metadata.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID
    || metadata.exportSha256 !== fileHash(sourceExportPath)
    || metadata.exportSizeBytes !== statSync(sourceExportPath).size
    || !timeTravelMetadataValid
    || typeof metadata.createdAtUtc !== 'string'
  ) {
    throw new Error('Protected export metadata verification failed');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProductionCanonicalImportManifest;
  const localDocument = JSON.parse(readFileSync(localReconciliationPath, 'utf8')) as {
    snapshot?: {
      legacy?: TenantFinancialAggregate;
      canonical?: TenantFinancialAggregate;
    };
    reconciliation?: TenantFinancialReconciliationReceipt;
  };
  if (!localDocument.snapshot?.legacy || !localDocument.snapshot.canonical || !localDocument.reconciliation) {
    throw new Error('Local reconciliation document is incomplete');
  }

  const bundleSql = readFileSync(bundlePath, 'utf8');
  const replay = replayProtectedFinancialBundle({
    sourceExportPath,
    bundleSql,
    cutoffUtc: localDocument.reconciliation.cutoffUtc,
    protectedParentDirectory: dirname(outputPath),
  });
  if (!exactAggregate(replay.sourceLegacyAggregate, localDocument.snapshot.legacy)) {
    throw new Error('Local reconciliation legacy aggregate does not match exact export replay');
  }
  if (!exactAggregate(replay.targetCanonicalAggregate, localDocument.snapshot.canonical)) {
    throw new Error('Local reconciliation canonical aggregate does not match exact bundle replay');
  }
  if (!validReconciliation(replay.reconciliation) || !validReconciliation(localDocument.reconciliation)) {
    throw new Error('Exact local bundle replay reconciliation failed');
  }

  const evidence: ProductionTenantFinancialImportEvidence = {
    schemaVersion: 1,
    operation: options.operation,
    authorizationId: options.authorizationId,
    tenantId: '100',
    operator: 'Rahmatullah Zisan',
    productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
    activeWorkerVersionId: options.activeWorkerVersionId,
    expectedFlagVersion: options.expectedFlagVersion,
    expectedFlagConfigJson: expectedFinancialFlagConfigForOperation(options.operation),
    sourceCapturedAtUtc: metadata.createdAtUtc,
    observedAtUtc: options.observedAtUtc,
    expiresAtUtc: options.expiresAtUtc,
    sourceExportSha256: fileHash(sourceExportPath),
    sourceExportSizeBytes: statSync(sourceExportPath).size,
    timeTravelEvidenceSha256: timeTravelEvidencePath ? fileHash(timeTravelEvidencePath) : null,
    bundleSha256: fileHash(bundlePath),
    manifestSha256: fileHash(manifestPath),
    localReconciliationSha256: fileHash(localReconciliationPath),
    deterministicRunId: manifest.deterministicRunId,
    secondPassNewRows: 0,
    sourceCanonicalState: replay.sourceCanonicalState,
    targetCanonicalState: replay.targetCanonicalState,
    sourceLegacyAggregate: replay.sourceLegacyAggregate,
  };
  const input: PrepareProductionTenantFinancialImportInput = {
    evidence,
    manifest,
    bundlePath,
    bundleSql,
    actualBundleSha256: evidence.bundleSha256,
    actualManifestSha256: evidence.manifestSha256,
    actualSourceExportSha256: evidence.sourceExportSha256,
    actualLocalReconciliationSha256: evidence.localReconciliationSha256,
    localReconciliation: localDocument.reconciliation,
    atUtc: new Date().toISOString(),
    approval: options.approval,
    execute: options.execute,
  };
  const result = await executeProductionTenantFinancialImport(
    input,
    createProductionTenantFinancialImportGateway(bundlePath),
  );
  const receipt = { ...result, evidence: { ...evidence, sourceCanonicalState: undefined, targetCanonicalState: undefined, sourceLegacyAggregate: undefined } };
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(outputPath, 0o600);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.allowed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
