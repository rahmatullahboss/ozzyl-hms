import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const CANONICAL_ONLY_FINANCIAL_FLAG_KEY = 'canonical_financial_dual_write_v1';
export const CANONICAL_ONLY_FINANCIAL_CONFIG = '{"tenantScope":["100"],"writePolicy":"canonical-only"}';

export interface CanonicalOnlyActivationEvidence {
  schemaVersion: 1;
  authorizationId: string;
  tenantId: string;
  operator: string;
  productionDatabaseId: string;
  candidateVersionId: string;
  candidateCommit: string;
  observedAtUtc: string;
  expiresAtUtc: string;
  tenant101LegacySmokePassed: boolean;
  tenant100CanonicalOnlyZeroLegacyWritePassed: boolean;
  safeErrorSmokePassed: boolean;
  rollbackRehearsalPassed: boolean;
}

export type CanonicalOnlyFlagAction = 'enable' | 'disable';

export interface CanonicalOnlyFlagExecutionInput {
  action: CanonicalOnlyFlagAction;
  evidence: CanonicalOnlyActivationEvidence;
  atUtc: string;
  effectiveAtUtc: string;
  confirmationToken: string | null;
  execute: boolean;
}

export interface CanonicalOnlyFlagExecutionResult {
  allowed: boolean;
  issues: string[];
  action: CanonicalOnlyFlagAction;
  externalCommandCount: number;
  productionMutationPerformed: boolean;
}

export interface ExternalCommandResult {
  stdout: string;
  stderr: string;
  status: number;
}

export type ExternalCommandRunner = (args: string[]) => Promise<ExternalCommandResult>;

function utcMillis(value: string): number {
  if (!value.endsWith('Z')) return Number.NaN;
  return Date.parse(value);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCanonicalOnlyFlagSql(input: {
  action: CanonicalOnlyFlagAction;
  evidence: CanonicalOnlyActivationEvidence;
  effectiveAtUtc: string;
}): string {
  const operator = sqlString(input.evidence.operator);
  if (input.action === 'disable') {
    return `UPDATE canonical_feature_flags
SET mode = 'disabled', is_enabled = 0, version = version + 1,
    updated_by_public_id = ${operator}, updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE tenant_id = '100'
  AND flag_key = '${CANONICAL_ONLY_FINANCIAL_FLAG_KEY}'
  AND domain = 'financial'
  AND mode = 'canonical'
  AND is_enabled = 1
  AND config_json = '${CANONICAL_ONLY_FINANCIAL_CONFIG}';`;
  }

  return `INSERT INTO canonical_feature_flags (
  tenant_id,flag_key,domain,mode,is_enabled,version,config_json,
  effective_at_utc,expires_at_utc,updated_by_public_id,updated_at_utc
) VALUES ('100','${CANONICAL_ONLY_FINANCIAL_FLAG_KEY}','financial','canonical',1,1,
  '${CANONICAL_ONLY_FINANCIAL_CONFIG}',${sqlString(input.effectiveAtUtc)},NULL,${operator},
  strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(tenant_id,flag_key) DO UPDATE SET
  domain = 'financial', mode = 'canonical', is_enabled = 1,
  version = canonical_feature_flags.version + 1,
  config_json = '${CANONICAL_ONLY_FINANCIAL_CONFIG}',
  effective_at_utc = excluded.effective_at_utc, expires_at_utc = NULL,
  updated_by_public_id = excluded.updated_by_public_id,
  updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE canonical_feature_flags.tenant_id = '100'
  AND canonical_feature_flags.flag_key = '${CANONICAL_ONLY_FINANCIAL_FLAG_KEY}'
  AND (canonical_feature_flags.is_enabled = 0 OR canonical_feature_flags.mode = 'disabled');`;
}

function validateExecutionInput(input: CanonicalOnlyFlagExecutionInput): string[] {
  const evidence = input.evidence;
  const issues: string[] = [];
  const at = utcMillis(input.atUtc);
  const observed = utcMillis(evidence.observedAtUtc);
  const expires = utcMillis(evidence.expiresAtUtc);
  const effective = utcMillis(input.effectiveAtUtc);

  if (evidence.schemaVersion !== 1) issues.push('CDB101_CANONICAL_ONLY_EVIDENCE_VERSION_INVALID');
  if (evidence.tenantId !== '100') issues.push('CDB101_CANONICAL_ONLY_TENANT_INVALID');
  if (evidence.operator !== 'Rahmatullah Zisan') issues.push('CDB101_CANONICAL_ONLY_OPERATOR_INVALID');
  if (evidence.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_CANONICAL_ONLY_DATABASE_INVALID');
  }
  if (!/^[a-f0-9]{40}$/.test(evidence.candidateCommit)) {
    issues.push('CDB101_CANONICAL_ONLY_CANDIDATE_COMMIT_INVALID');
  }
  if (!/^(?:[a-f0-9]{32,64}|[a-f0-9]{8}-[a-f0-9-]{27,})$/i.test(evidence.candidateVersionId)) {
    issues.push('CDB101_CANONICAL_ONLY_CANDIDATE_VERSION_MISSING');
  }
  if (
    !Number.isFinite(at)
    || !Number.isFinite(observed)
    || !Number.isFinite(expires)
    || !Number.isFinite(effective)
    || observed > at
    || expires <= at
    || effective > at
  ) {
    issues.push('CDB101_CANONICAL_ONLY_AUTHORIZATION_WINDOW_INVALID');
  }
  if (!evidence.tenant101LegacySmokePassed) issues.push('CDB101_CANONICAL_ONLY_TENANT101_SMOKE_MISSING');
  if (!evidence.tenant100CanonicalOnlyZeroLegacyWritePassed) {
    issues.push('CDB101_CANONICAL_ONLY_ZERO_LEGACY_WRITE_SMOKE_MISSING');
  }
  if (!evidence.safeErrorSmokePassed) issues.push('CDB101_CANONICAL_ONLY_SAFE_ERROR_SMOKE_MISSING');
  if (!evidence.rollbackRehearsalPassed) issues.push('CDB101_CANONICAL_ONLY_ROLLBACK_REHEARSAL_MISSING');
  if (!input.execute) issues.push('CDB101_CANONICAL_ONLY_EXECUTE_SWITCH_MISSING');
  if (!evidence.authorizationId || input.confirmationToken !== evidence.authorizationId) {
    issues.push('CDB101_CANONICAL_ONLY_CONFIRMATION_MISMATCH');
  }
  return [...new Set(issues)];
}

interface D1Envelope {
  results?: Array<Record<string, unknown>>;
  meta?: { changes?: unknown; rows_written?: unknown; changed_db?: unknown };
}

function parseJsonSuffix<T>(text: string, opening: '{' | '['): T {
  const start = text.indexOf(opening);
  if (start < 0) throw new Error('Wrangler output did not contain JSON');
  return JSON.parse(text.slice(start)) as T;
}

function parseD1Envelopes(text: string): D1Envelope[] {
  const value = parseJsonSuffix<unknown>(text, '[');
  if (!Array.isArray(value)) throw new Error('D1 output was not an array');
  return value as D1Envelope[];
}

function rowsFromOutput(text: string): Array<Record<string, unknown>> {
  return parseD1Envelopes(text).flatMap((envelope) => envelope.results ?? []);
}

function assertOneChangedRow(text: string): void {
  const envelopes = parseD1Envelopes(text);
  const changes = envelopes.reduce((sum, envelope) => sum + Number(envelope.meta?.changes ?? 0), 0);
  const rowsWritten = envelopes.reduce((sum, envelope) => sum + Number(envelope.meta?.rows_written ?? 0), 0);
  if (changes !== 1 || rowsWritten < 1) throw new Error('Canonical-only flag write did not change exactly one row');
}

function exactCanonicalRow(row: Record<string, unknown>): boolean {
  return row.tenant_id === '100'
    && row.flag_key === CANONICAL_ONLY_FINANCIAL_FLAG_KEY
    && row.domain === 'financial'
    && row.mode === 'canonical'
    && Number(row.is_enabled) === 1
    && row.config_json === CANONICAL_ONLY_FINANCIAL_CONFIG;
}

const READ_FLAG_SQL = `SELECT tenant_id,flag_key,domain,mode,is_enabled,version,config_json
FROM canonical_feature_flags
WHERE tenant_id = '100' AND flag_key = '${CANONICAL_ONLY_FINANCIAL_FLAG_KEY}'
LIMIT 2;`;

async function defaultRunner(args: string[]): Promise<ExternalCommandResult> {
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

export async function executeCanonicalOnlyFlagChange(
  input: CanonicalOnlyFlagExecutionInput,
  runner: ExternalCommandRunner = defaultRunner,
): Promise<CanonicalOnlyFlagExecutionResult> {
  const issues = validateExecutionInput(input);
  if (issues.length > 0) {
    return {
      allowed: false,
      issues,
      action: input.action,
      externalCommandCount: 0,
      productionMutationPerformed: false,
    };
  }

  let externalCommandCount = 0;
  const run = async (args: string[]): Promise<ExternalCommandResult> => {
    externalCommandCount += 1;
    const result = await runner(args);
    if (result.status !== 0) throw new Error('Wrangler production command failed');
    return result;
  };

  const info = await run(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json']);
  const database = parseJsonSuffix<{ uuid?: unknown; name?: unknown }>(info.stdout, '{');
  if (database.uuid !== CDB101_PRODUCTION_DATABASE_ID || database.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production database identity verification failed');
  }

  const before = await run([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command', READ_FLAG_SQL, '--yes',
  ]);
  const beforeRows = rowsFromOutput(before.stdout);
  if (beforeRows.length > 1) throw new Error('Canonical-only flag lookup returned multiple rows');
  if (input.action === 'enable') {
    const safe = beforeRows.length === 0
      || (Number(beforeRows[0].is_enabled) === 0 || beforeRows[0].mode === 'disabled');
    if (!safe) throw new Error('Canonical-only flag previous state is unsafe');
  } else if (beforeRows.length !== 1 || !exactCanonicalRow(beforeRows[0])) {
    throw new Error('Canonical-only rollback target does not match the exact active flag');
  }

  const sql = buildCanonicalOnlyFlagSql({
    action: input.action,
    evidence: input.evidence,
    effectiveAtUtc: input.effectiveAtUtc,
  });
  const write = await run([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command', sql, '--yes',
  ]);
  assertOneChangedRow(write.stdout);

  const after = await run([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command', READ_FLAG_SQL, '--yes',
  ]);
  const afterRows = rowsFromOutput(after.stdout);
  const verified = input.action === 'enable'
    ? afterRows.length === 1 && exactCanonicalRow(afterRows[0])
    : afterRows.length === 1
      && afterRows[0].tenant_id === '100'
      && afterRows[0].flag_key === CANONICAL_ONLY_FINANCIAL_FLAG_KEY
      && afterRows[0].mode === 'disabled'
      && Number(afterRows[0].is_enabled) === 0;
  if (!verified) throw new Error('Canonical-only flag post-write verification failed');

  return {
    allowed: true,
    issues: [],
    action: input.action,
    externalCommandCount,
    productionMutationPerformed: true,
  };
}

interface CliOptions {
  action: CanonicalOnlyFlagAction;
  evidencePath: string;
  effectiveAtUtc: string;
  confirmationToken: string;
  execute: boolean;
}

function parseArgs(args: string[]): CliOptions {
  let action: CanonicalOnlyFlagAction | null = null;
  let evidencePath = '';
  let effectiveAtUtc = '';
  let confirmationToken = '';
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (arg === '--action' && (value === 'enable' || value === 'disable')) action = value;
    else if (arg === '--evidence') evidencePath = value;
    else if (arg === '--effective-at-utc') effectiveAtUtc = value;
    else if (arg === '--confirm') confirmationToken = value;
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  if (!action || !evidencePath || !effectiveAtUtc || !confirmationToken) {
    throw new Error('--action, --evidence, --effective-at-utc, and --confirm are required');
  }
  return { action, evidencePath, effectiveAtUtc, confirmationToken, execute };
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const evidence = JSON.parse(readFileSync(options.evidencePath, 'utf8')) as CanonicalOnlyActivationEvidence;
    const result = await executeCanonicalOnlyFlagChange({
      action: options.action,
      evidence,
      atUtc: new Date().toISOString(),
      effectiveAtUtc: options.effectiveAtUtc,
      confirmationToken: options.confirmationToken,
      execute: options.execute,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.allowed) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
