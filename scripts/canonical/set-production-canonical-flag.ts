import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  buildReportingShadowFlagSql,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from './production-cutover-contract';
import { prepareProtectedReportingCutoverAuthorization } from './reporting-cutover-authorization-document';
import {
  bindReportingForeignKeyEvidenceToAuthorization,
  prepareProtectedReportingForeignKeyDispositionEvidence,
} from './reporting-fk-disposition-evidence';
import {
  bindReportingMaintenanceRecoveryEvidenceToAuthorization,
  prepareProtectedReportingMaintenanceRecoveryEvidence,
} from './reporting-maintenance-recovery-evidence';
import {
  bindReportingWorkerBuildVersionEvidenceToAuthorization,
  prepareProtectedReportingWorkerBuildVersionEvidence,
} from './reporting-worker-build-version-evidence';
import { prepareProtectedReportingProcessingEvidenceForAuthorization } from './reporting-processing-evidence';

export type ReportingFlagCurrentState = 'absent' | 'disabled' | 'legacy' | 'shadow' | 'canonical' | 'unknown';

export interface ProductionReportingFlagExecutionInput {
  authorization: ReportingCutoverAuthorization;
  atUtc: string;
  currentState: ReportingFlagCurrentState;
  effectiveAtUtc: string;
  updatedBy: string;
  observedDatabaseId?: string | null;
  execute: boolean;
  confirmationToken: string | null;
}

export interface ProductionReportingFlagExecutionPlan {
  allowed: boolean;
  issues: string[];
  sql: string;
  command: string[];
  productionMutationPerformed: false;
}

export interface ReportingShadowActivationReceipt {
  allowed: true;
  commandId: string;
  tenantId: '100';
  mode: 'shadow';
  dualRunStartedAtUtc: string;
  legacyRoutesActive: true;
  canonicalShadowActive: true;
  canonicalReadsServingUsers: false;
  monitoringShouldStart: true;
  productionMutationPerformed: true;
}

export function buildReportingShadowActivationReceipt(input: {
  commandId: string;
  activatedAtUtc: string;
}): ReportingShadowActivationReceipt {
  if (!input.commandId.trim()) throw new Error('Shadow activation command ID is required');
  if (!input.activatedAtUtc.endsWith('Z') || !Number.isFinite(Date.parse(input.activatedAtUtc))) {
    throw new Error('Shadow activation time must be an absolute UTC timestamp');
  }
  return {
    allowed: true,
    commandId: input.commandId,
    tenantId: '100',
    mode: 'shadow',
    dualRunStartedAtUtc: input.activatedAtUtc,
    legacyRoutesActive: true,
    canonicalShadowActive: true,
    canonicalReadsServingUsers: false,
    monitoringShouldStart: true,
    productionMutationPerformed: true,
  };
}

export function prepareProductionReportingFlagExecution(
  input: ProductionReportingFlagExecutionInput,
): ProductionReportingFlagExecutionPlan {
  const authorizationResult = validateReportingCutoverAuthorization(
    input.authorization,
    input.atUtc,
  );
  const issues = authorizationResult.issues.map((issue) => issue.code);
  const checkedAt = Date.parse(input.atUtc);
  const effectiveAt = Date.parse(input.authorization.featureFlagPlan.effectiveAtUtc ?? '');
  if (Number.isFinite(checkedAt) && Number.isFinite(effectiveAt) && checkedAt < effectiveAt) {
    issues.push('CDB101_FEATURE_FLAG_EFFECTIVE_TIME_NOT_REACHED');
  }
  if (!['absent', 'disabled'].includes(input.currentState)) {
    issues.push('CDB101_FEATURE_FLAG_PREVIOUS_STATE_UNSAFE');
  }
  if (
    input.effectiveAtUtc !== input.authorization.featureFlagPlan.effectiveAtUtc
    || input.updatedBy !== input.authorization.featureFlagPlan.updatedByPublicId
  ) {
    issues.push('CDB101_FEATURE_FLAG_EXECUTION_SCOPE_MISMATCH');
  }
  if (input.observedDatabaseId !== undefined && input.observedDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_OBSERVED_DATABASE_IDENTITY_MISMATCH');
  }
  if (input.execute && input.observedDatabaseId === undefined) {
    issues.push('CDB101_OBSERVED_DATABASE_IDENTITY_MISSING');
  }
  let sql = '';
  try {
    sql = buildReportingShadowFlagSql({
      tenantId: input.authorization.featureFlagPlan.tenantId ?? '',
      expectedPreviousState: 'absent_or_disabled',
      effectiveAtUtc: input.effectiveAtUtc,
      updatedBy: input.updatedBy,
    });
  } catch {
    issues.push('CDB101_FEATURE_FLAG_SQL_BUILD_FAILED');
  }
  if (!input.execute) issues.push('CDB101_EXECUTE_SWITCH_MISSING');
  if (
    !input.authorization.featureFlagPlan.commandId
    || input.confirmationToken !== input.authorization.featureFlagPlan.commandId
  ) {
    issues.push('CDB101_CONFIRMATION_TOKEN_MISMATCH');
  }
  return {
    allowed: issues.length === 0,
    issues: [...new Set(issues)],
    sql,
    command: [
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--json', '--command', sql, '--yes',
    ],
    productionMutationPerformed: false,
  };
}

interface WranglerResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runWrangler(args: string[]): WranglerResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

function parseDatabaseId(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('D1 info output did not contain JSON');
  const parsed = JSON.parse(text.slice(start)) as { uuid?: unknown; name?: unknown };
  if (parsed.name !== CDB101_PRODUCTION_DATABASE_NAME || typeof parsed.uuid !== 'string') {
    throw new Error('D1 info did not match the exact production database name');
  }
  return parsed.uuid;
}

interface D1Envelope {
  results?: Array<{
    tenant_id?: unknown;
    flag_key?: unknown;
    domain?: unknown;
    mode?: unknown;
    is_enabled?: unknown;
  }>;
  meta?: { changed_db?: unknown; changes?: unknown; rows_written?: unknown };
}

function parseEnvelope(text: string): D1Envelope[] {
  const start = text.indexOf('[');
  if (start < 0) throw new Error('D1 execute output did not contain a JSON array');
  const parsed = JSON.parse(text.slice(start)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('D1 execute output was not an array');
  return parsed as D1Envelope[];
}

function currentStateFromOutput(text: string): ReportingFlagCurrentState {
  const rows = parseEnvelope(text).flatMap((envelope) => envelope.results ?? []);
  if (rows.length === 0) return 'absent';
  if (rows.length !== 1) return 'unknown';
  const row = rows[0];
  if (row.tenant_id !== '100' || row.flag_key !== 'canonical_reporting_v1' || row.domain !== 'reporting') {
    return 'unknown';
  }
  if (Number(row.is_enabled) === 0 || row.mode === 'disabled') return 'disabled';
  if (row.mode === 'legacy') return 'legacy';
  if (row.mode === 'shadow') return 'shadow';
  if (row.mode === 'canonical') return 'canonical';
  return 'unknown';
}

export function verifySingleReportingFlagWriteOutput(text: string): void {
  const envelopes = parseEnvelope(text);
  const changes = envelopes.reduce(
    (sum, envelope) => sum + Number(envelope.meta?.changes ?? Number.NaN),
    0,
  );
  const rowsWritten = envelopes.reduce(
    (sum, envelope) => sum + Number(envelope.meta?.rows_written ?? 0),
    0,
  );
  if (
    changes !== 1
    || rowsWritten < 1
    || !envelopes.some((envelope) => envelope.meta?.changed_db === true)
  ) {
    throw new Error('Feature flag write did not change exactly one row.');
  }
}

function verifyShadowOutput(text: string): void {
  const rows = parseEnvelope(text).flatMap((envelope) => envelope.results ?? []);
  if (
    rows.length !== 1
    || rows[0].tenant_id !== '100'
    || rows[0].flag_key !== 'canonical_reporting_v1'
    || rows[0].domain !== 'reporting'
    || rows[0].mode !== 'shadow'
    || Number(rows[0].is_enabled) !== 1
  ) {
    throw new Error('Post-write reporting flag verification failed');
  }
  for (const envelope of parseEnvelope(text)) {
    if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
      throw new Error('Post-write verification query was not read-only');
    }
  }
}

const READ_FLAG_SQL = "SELECT tenant_id, flag_key, domain, mode, is_enabled, version FROM canonical_feature_flags WHERE tenant_id = '100' AND flag_key = 'canonical_reporting_v1' LIMIT 2;";

export interface ProductionReportingFlagCliOptions {
  authorizationPath: string;
  fkEvidencePath: string;
  maintenanceRecoveryEvidencePath: string;
  workerBuildVersionEvidencePath: string;
  processingEvidencePath: string;
  effectiveAtUtc: string;
  updatedBy: string;
  execute: boolean;
}

export function parseProductionReportingFlagArgs(
  args: string[],
): ProductionReportingFlagCliOptions {
  let authorizationPath = '';
  let fkEvidencePath = '';
  let maintenanceRecoveryEvidencePath = '';
  let workerBuildVersionEvidencePath = '';
  let processingEvidencePath = '';
  let effectiveAtUtc = '';
  let updatedBy = '';
  let execute = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--execute') {
      if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
      seen.add(arg);
      execute = true;
      continue;
    }
    if (![
      '--authorization',
      '--fk-evidence',
      '--maintenance-recovery-evidence',
      '--worker-build-version-evidence',
      '--processing-evidence',
      '--effective-at-utc',
      '--updated-by',
    ].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--authorization') authorizationPath = value;
    if (arg === '--fk-evidence') fkEvidencePath = value;
    if (arg === '--maintenance-recovery-evidence') maintenanceRecoveryEvidencePath = value;
    if (arg === '--worker-build-version-evidence') workerBuildVersionEvidencePath = value;
    if (arg === '--processing-evidence') processingEvidencePath = value;
    if (arg === '--effective-at-utc') effectiveAtUtc = value;
    if (arg === '--updated-by') updatedBy = value;
    seen.add(arg);
    index += 1;
  }
  if (
    !authorizationPath
    || !fkEvidencePath
    || !maintenanceRecoveryEvidencePath
    || !workerBuildVersionEvidencePath
    || !processingEvidencePath
    || !effectiveAtUtc
    || !updatedBy
  ) {
    throw new Error('--authorization, --fk-evidence, --maintenance-recovery-evidence, --worker-build-version-evidence, --processing-evidence, --effective-at-utc, and --updated-by are required');
  }
  return {
    authorizationPath,
    fkEvidencePath,
    maintenanceRecoveryEvidencePath,
    workerBuildVersionEvidencePath,
    processingEvidencePath,
    effectiveAtUtc,
    updatedBy,
    execute,
  };
}

function main(): void {
  try {
    const options = parseProductionReportingFlagArgs(process.argv.slice(2));
    const authorizationCheckedAtUtc = new Date().toISOString();
    const authorizationPreflight = prepareProtectedReportingCutoverAuthorization(
      options.authorizationPath,
      process.cwd(),
      authorizationCheckedAtUtc,
    );
    if (!authorizationPreflight.receipt.executionReady || !authorizationPreflight.authorization) {
      process.stdout.write(`${JSON.stringify(authorizationPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const authorization = authorizationPreflight.authorization;
    const fkEvidencePreflight = bindReportingForeignKeyEvidenceToAuthorization(
      prepareProtectedReportingForeignKeyDispositionEvidence(
        options.fkEvidencePath,
        process.cwd(),
        authorizationCheckedAtUtc,
      ),
      authorization,
    );
    if (!fkEvidencePreflight.receipt.evidenceReady) {
      process.stdout.write(`${JSON.stringify(fkEvidencePreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const maintenanceRecoveryPreflight = bindReportingMaintenanceRecoveryEvidenceToAuthorization(
      prepareProtectedReportingMaintenanceRecoveryEvidence(
        options.maintenanceRecoveryEvidencePath,
        process.cwd(),
        authorizationCheckedAtUtc,
      ),
      authorization,
    );
    if (!maintenanceRecoveryPreflight.receipt.evidenceReady) {
      process.stdout.write(`${JSON.stringify(maintenanceRecoveryPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const workerBuildVersionPreflight = bindReportingWorkerBuildVersionEvidenceToAuthorization(
      prepareProtectedReportingWorkerBuildVersionEvidence(
        options.workerBuildVersionEvidencePath,
        process.cwd(),
        authorizationCheckedAtUtc,
      ),
      authorization,
    );
    if (!workerBuildVersionPreflight.receipt.evidenceReady) {
      process.stdout.write(`${JSON.stringify(workerBuildVersionPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const processingPreflight = prepareProtectedReportingProcessingEvidenceForAuthorization(
      options.processingEvidencePath,
      process.cwd(),
      authorization,
      authorizationCheckedAtUtc,
    );
    if (!processingPreflight.receipt.shadowFlagReady) {
      process.stdout.write(`${JSON.stringify(processingPreflight.receipt, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    const info = runWrangler(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
    if (info.status !== 0) throw new Error(info.stderr || info.stdout || 'D1 info failed');
    const observedDatabaseId = parseDatabaseId(info.stdout);

    const before = runWrangler([
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--json', '--command', READ_FLAG_SQL,
    ]);
    if (before.status !== 0) throw new Error(before.stderr || before.stdout || 'Feature flag read failed');
    const currentState = currentStateFromOutput(before.stdout);

    const plan = prepareProductionReportingFlagExecution({
      authorization,
      atUtc: new Date().toISOString(),
      currentState,
      effectiveAtUtc: options.effectiveAtUtc,
      updatedBy: options.updatedBy,
      observedDatabaseId,
      execute: options.execute,
      confirmationToken: process.env.CDB101_PRODUCTION_CONFIRMATION ?? null,
    });
    if (!plan.allowed) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }

    const written = runWrangler(plan.command);
    if (written.status !== 0) throw new Error(written.stderr || written.stdout || 'Feature flag write failed');
    verifySingleReportingFlagWriteOutput(written.stdout);
    const after = runWrangler([
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--json', '--command', READ_FLAG_SQL,
    ]);
    if (after.status !== 0) throw new Error(after.stderr || after.stdout || 'Feature flag verification failed');
    verifyShadowOutput(after.stdout);
    const activationReceipt = buildReportingShadowActivationReceipt({
      commandId: authorization.featureFlagPlan.commandId!,
      activatedAtUtc: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(activationReceipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 production feature flag wrapper failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
