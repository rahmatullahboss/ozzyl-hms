import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const RETIRED_CANONICAL_ONLY_FLAG_KEY = 'canonical_financial_dual_write_v1';
export const RETIRED_CANONICAL_ONLY_CONFIG = '{"tenantScope":["100"],"writePolicy":"canonical-only"}';

export interface EmergencyCanonicalOnlyRollbackEvidence {
  schemaVersion: 1;
  authorizationId: string;
  tenantId: '100';
  operator: 'Rahmatullah Zisan';
  productionDatabaseId: string;
  activeWorkerVersionId: string;
  expectedFlagVersion: number;
  expectedEffectiveAtUtc: string;
  activationLocalTimestamp: string;
  observedAtUtc: string;
  expiresAtUtc: string;
}

export interface EmergencyCanonicalOnlyRollbackInput {
  evidence: EmergencyCanonicalOnlyRollbackEvidence;
  atUtc: string;
  approval: string | null;
  execute: boolean;
}

export interface EmergencyCanonicalOnlyRollbackResult {
  allowed: boolean;
  issues: string[];
  externalCommandCount: number;
  productionMutationPerformed: boolean;
  beforeMode: string | null;
  afterMode: string | null;
  postActivationWriteCount: number;
}

export interface EmergencyCanonicalOnlyRollbackGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readActiveWorkerVersion(): Promise<string>;
  readFlag(): Promise<Array<Record<string, unknown>>>;
  readPostActivationImpact(activationLocalTimestamp: string): Promise<{
    legacyBills: number;
    legacyPayments: number;
    legacyDeposits: number;
    legacyCreditNotes: number;
    canonicalBusinessRows: number;
  }>;
  writeFlag(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

function utcMillis(value: string): number {
  return value.endsWith('Z') ? Date.parse(value) : Number.NaN;
}

function exactTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function validateEmergencyRollbackInput(
  input: EmergencyCanonicalOnlyRollbackInput,
): string[] {
  const issues: string[] = [];
  const evidence = input.evidence;
  const at = utcMillis(input.atUtc);
  const observed = utcMillis(evidence.observedAtUtc);
  const expires = utcMillis(evidence.expiresAtUtc);

  if (evidence.schemaVersion !== 1) issues.push('CDB101_EMERGENCY_ROLLBACK_VERSION_INVALID');
  if (evidence.tenantId !== '100') issues.push('CDB101_EMERGENCY_ROLLBACK_TENANT_INVALID');
  if (evidence.operator !== 'Rahmatullah Zisan') issues.push('CDB101_EMERGENCY_ROLLBACK_OPERATOR_INVALID');
  if (evidence.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID) {
    issues.push('CDB101_EMERGENCY_ROLLBACK_DATABASE_INVALID');
  }
  if (!/^[a-f0-9-]{32,64}$/i.test(evidence.activeWorkerVersionId)) {
    issues.push('CDB101_EMERGENCY_ROLLBACK_WORKER_INVALID');
  }
  if (!Number.isInteger(evidence.expectedFlagVersion) || evidence.expectedFlagVersion < 1) {
    issues.push('CDB101_EMERGENCY_ROLLBACK_FLAG_VERSION_INVALID');
  }
  if (!Number.isFinite(utcMillis(evidence.expectedEffectiveAtUtc))) {
    issues.push('CDB101_EMERGENCY_ROLLBACK_EFFECTIVE_TIME_INVALID');
  }
  if (!exactTimestamp(evidence.activationLocalTimestamp)) {
    issues.push('CDB101_EMERGENCY_ROLLBACK_LOCAL_TIME_INVALID');
  }
  if (
    !Number.isFinite(at)
    || !Number.isFinite(observed)
    || !Number.isFinite(expires)
    || observed > at
    || expires <= at
  ) {
    issues.push('CDB101_EMERGENCY_ROLLBACK_WINDOW_INVALID');
  }
  if (!evidence.authorizationId.trim()) issues.push('CDB101_EMERGENCY_ROLLBACK_AUTHORIZATION_INVALID');
  if (!input.execute) issues.push('CDB101_EMERGENCY_ROLLBACK_EXECUTE_SWITCH_MISSING');
  if (input.approval !== evidence.authorizationId) issues.push('CDB101_EMERGENCY_ROLLBACK_APPROVAL_MISMATCH');
  return [...new Set(issues)];
}

function exactActiveCanonicalOnlyRow(
  row: Record<string, unknown>,
  evidence: EmergencyCanonicalOnlyRollbackEvidence,
): boolean {
  return row.tenant_id === '100'
    && row.flag_key === RETIRED_CANONICAL_ONLY_FLAG_KEY
    && row.domain === 'financial'
    && row.mode === 'canonical'
    && Number(row.is_enabled) === 1
    && Number(row.version) === evidence.expectedFlagVersion
    && row.config_json === RETIRED_CANONICAL_ONLY_CONFIG
    && row.effective_at_utc === evidence.expectedEffectiveAtUtc;
}

function exactDisabledRow(
  row: Record<string, unknown>,
  evidence: EmergencyCanonicalOnlyRollbackEvidence,
): boolean {
  return row.tenant_id === '100'
    && row.flag_key === RETIRED_CANONICAL_ONLY_FLAG_KEY
    && row.domain === 'financial'
    && row.mode === 'disabled'
    && Number(row.is_enabled) === 0
    && Number(row.version) === evidence.expectedFlagVersion + 1
    && row.config_json === RETIRED_CANONICAL_ONLY_CONFIG
    && row.effective_at_utc === evidence.expectedEffectiveAtUtc;
}

export function buildEmergencyCanonicalOnlyDisableSql(
  evidence: EmergencyCanonicalOnlyRollbackEvidence,
): string {
  return `UPDATE canonical_feature_flags
SET mode = 'disabled',
    is_enabled = 0,
    version = version + 1,
    updated_by_public_id = ${sqlString(evidence.operator)},
    updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE tenant_id = '100'
  AND flag_key = '${RETIRED_CANONICAL_ONLY_FLAG_KEY}'
  AND domain = 'financial'
  AND mode = 'canonical'
  AND is_enabled = 1
  AND version = ${evidence.expectedFlagVersion}
  AND config_json = '${RETIRED_CANONICAL_ONLY_CONFIG}'
  AND effective_at_utc = ${sqlString(evidence.expectedEffectiveAtUtc)};`;
}

export async function executeEmergencyCanonicalOnlyRollback(
  input: EmergencyCanonicalOnlyRollbackInput,
  gateway: EmergencyCanonicalOnlyRollbackGateway,
): Promise<EmergencyCanonicalOnlyRollbackResult> {
  const issues = validateEmergencyRollbackInput(input);
  if (issues.length > 0) {
    return {
      allowed: false,
      issues,
      externalCommandCount: 0,
      productionMutationPerformed: false,
      beforeMode: null,
      afterMode: null,
      postActivationWriteCount: 0,
    };
  }

  let externalCommandCount = 0;
  externalCommandCount += 1;
  const database = await gateway.readDatabaseIdentity();
  if (database.uuid !== CDB101_PRODUCTION_DATABASE_ID || database.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Emergency rollback production database identity mismatch');
  }

  externalCommandCount += 1;
  const activeWorkerVersion = await gateway.readActiveWorkerVersion();
  if (activeWorkerVersion !== input.evidence.activeWorkerVersionId) {
    throw new Error('Emergency rollback active Worker version mismatch');
  }

  externalCommandCount += 1;
  const beforeRows = await gateway.readFlag();
  if (beforeRows.length !== 1 || !exactActiveCanonicalOnlyRow(beforeRows[0], input.evidence)) {
    throw new Error('Emergency rollback flag pre-state mismatch');
  }

  externalCommandCount += 1;
  const impact = await gateway.readPostActivationImpact(input.evidence.activationLocalTimestamp);
  const counts = Object.values(impact);
  if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error('Emergency rollback impact evidence is invalid');
  }
  const postActivationWriteCount = counts.reduce((sum, count) => sum + count, 0);
  if (postActivationWriteCount !== 0) {
    throw new Error('Emergency rollback found post-activation financial writes');
  }

  externalCommandCount += 1;
  const write = await gateway.writeFlag(buildEmergencyCanonicalOnlyDisableSql(input.evidence));
  if (write.changes !== 1 || write.rowsWritten < 1) {
    throw new Error('Emergency rollback did not change exactly one flag row');
  }

  externalCommandCount += 1;
  const afterRows = await gateway.readFlag();
  if (afterRows.length !== 1 || !exactDisabledRow(afterRows[0], input.evidence)) {
    throw new Error('Emergency rollback flag post-state mismatch');
  }

  return {
    allowed: true,
    issues: [],
    externalCommandCount,
    productionMutationPerformed: true,
    beforeMode: 'canonical',
    afterMode: 'disabled',
    postActivationWriteCount,
  };
}

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number;
}

type CommandRunner = (args: string[]) => Promise<CommandResult>;

function extractJson(text: string): unknown {
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
      // Continue to the next bounded candidate.
    }
  }
  throw new Error('Wrangler output did not contain valid JSON');
}

function d1Rows(text: string): Array<Record<string, unknown>> {
  const envelopes = extractJson(text) as Array<{
    results?: Array<Record<string, unknown>>;
    success?: boolean;
    meta?: { changed_db?: unknown; rows_written?: unknown };
  }>;
  if (!Array.isArray(envelopes) || envelopes.length !== 1 || envelopes[0].success !== true) {
    throw new Error('Unexpected D1 response envelope');
  }
  return envelopes[0].results ?? [];
}

function d1WriteMeta(text: string): { changes: number; rowsWritten: number } {
  const envelopes = extractJson(text) as Array<{
    success?: boolean;
    meta?: { changes?: unknown; rows_written?: unknown };
  }>;
  if (!Array.isArray(envelopes) || envelopes.length !== 1 || envelopes[0].success !== true) {
    throw new Error('Unexpected D1 write response envelope');
  }
  return {
    changes: Number(envelopes[0].meta?.changes ?? 0),
    rowsWritten: Number(envelopes[0].meta?.rows_written ?? 0),
  };
}

async function defaultRunner(args: string[]): Promise<CommandResult> {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

function assertCommand(result: CommandResult, label: string): string {
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

const READ_FLAG_SQL = `SELECT tenant_id,flag_key,domain,mode,is_enabled,version,config_json,effective_at_utc
FROM canonical_feature_flags
WHERE tenant_id='100' AND flag_key='${RETIRED_CANONICAL_ONLY_FLAG_KEY}'
LIMIT 2;`;

function impactSql(activationLocalTimestamp: string): string {
  const timestamp = sqlString(activationLocalTimestamp);
  return `SELECT
  (SELECT COUNT(*) FROM bills WHERE CAST(tenant_id AS TEXT)='100'
    AND datetime(created_at)>=datetime(${timestamp})) AS legacy_bills,
  (SELECT COUNT(*) FROM payments WHERE CAST(tenant_id AS TEXT)='100'
    AND datetime(date)>=datetime(${timestamp})) AS legacy_payments,
  (SELECT COUNT(*) FROM billing_deposits WHERE CAST(tenant_id AS TEXT)='100'
    AND datetime(created_at)>=datetime(${timestamp})) AS legacy_deposits,
  (SELECT COUNT(*) FROM billing_credit_notes WHERE CAST(tenant_id AS TEXT)='100'
    AND datetime(created_at)>=datetime(${timestamp})) AS legacy_credit_notes,
  ((SELECT COUNT(*) FROM canonical_invoices WHERE tenant_id='100')
   +(SELECT COUNT(*) FROM canonical_payment_receipts WHERE tenant_id='100')
   +(SELECT COUNT(*) FROM canonical_deposits WHERE tenant_id='100')
   +(SELECT COUNT(*) FROM canonical_credit_notes WHERE tenant_id='100')
   +(SELECT COUNT(*) FROM canonical_refunds WHERE tenant_id='100')
   +(SELECT COUNT(*) FROM canonical_compensation_accruals WHERE tenant_id='100'))
    AS canonical_business_rows;`;
}

export function createEmergencyRollbackGateway(
  runner: CommandRunner = defaultRunner,
): EmergencyCanonicalOnlyRollbackGateway {
  const run = async (args: string[], label: string): Promise<string> => (
    assertCommand(await runner(args), label)
  );
  const d1Query = async (sql: string, label: string): Promise<Array<Record<string, unknown>>> => (
    d1Rows(await run([
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--remote', '--env', 'production', '--json', '--command', sql,
    ], label))
  );

  return {
    async readDatabaseIdentity() {
      const value = extractJson(await run([
        'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json',
      ], 'production database identity')) as { uuid?: unknown; name?: unknown };
      return { uuid: value.uuid, name: value.name };
    },
    async readActiveWorkerVersion() {
      const deployments = extractJson(await run([
        'deployments', 'list', '--env', 'production', '--json',
      ], 'production deployments')) as Array<{
        created_on?: string;
        versions?: Array<{ version_id?: string; percentage?: number }>;
      }>;
      if (!Array.isArray(deployments) || deployments.length === 0) {
        throw new Error('Production deployments were unavailable');
      }
      const latest = [...deployments].sort((left, right) => (
        String(right.created_on ?? '').localeCompare(String(left.created_on ?? ''))
      ))[0];
      const active = latest.versions?.find((version) => Number(version.percentage) === 100);
      if (!active?.version_id) throw new Error('Production active Worker version was unavailable');
      return active.version_id;
    },
    readFlag() {
      return d1Query(READ_FLAG_SQL, 'financial flag read');
    },
    async readPostActivationImpact(activationLocalTimestamp) {
      const rows = await d1Query(impactSql(activationLocalTimestamp), 'post-activation impact read');
      if (rows.length !== 1) throw new Error('Post-activation impact query did not return one row');
      const row = rows[0];
      return {
        legacyBills: Number(row.legacy_bills ?? 0),
        legacyPayments: Number(row.legacy_payments ?? 0),
        legacyDeposits: Number(row.legacy_deposits ?? 0),
        legacyCreditNotes: Number(row.legacy_credit_notes ?? 0),
        canonicalBusinessRows: Number(row.canonical_business_rows ?? 0),
      };
    },
    async writeFlag(sql) {
      return d1WriteMeta(await run([
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--remote', '--env', 'production', '--json', '--yes', '--command', sql,
      ], 'canonical-only emergency flag disable'));
    },
  };
}

interface CliOptions {
  authorizationId: string;
  approval: string;
  activeWorkerVersionId: string;
  expectedFlagVersion: number;
  expectedEffectiveAtUtc: string;
  activationLocalTimestamp: string;
  observedAtUtc: string;
  expiresAtUtc: string;
  execute: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`${key} is required`);
    return value;
  };
  return {
    authorizationId: required('--authorization-id'),
    approval: required('--approval'),
    activeWorkerVersionId: required('--active-worker-version'),
    expectedFlagVersion: Number(required('--expected-flag-version')),
    expectedEffectiveAtUtc: required('--expected-effective-at-utc'),
    activationLocalTimestamp: required('--activation-local-timestamp'),
    observedAtUtc: required('--observed-at-utc'),
    expiresAtUtc: required('--expires-at-utc'),
    execute,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await executeEmergencyCanonicalOnlyRollback({
    evidence: {
      schemaVersion: 1,
      authorizationId: options.authorizationId,
      tenantId: '100',
      operator: 'Rahmatullah Zisan',
      productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
      activeWorkerVersionId: options.activeWorkerVersionId,
      expectedFlagVersion: options.expectedFlagVersion,
      expectedEffectiveAtUtc: options.expectedEffectiveAtUtc,
      activationLocalTimestamp: options.activationLocalTimestamp,
      observedAtUtc: options.observedAtUtc,
      expiresAtUtc: options.expiresAtUtc,
    },
    atUtc: new Date().toISOString(),
    approval: options.approval,
    execute: options.execute,
  }, createEmergencyRollbackGateway());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.allowed) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
