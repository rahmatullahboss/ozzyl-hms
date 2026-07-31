import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CDB101_PRODUCTION_DATABASE_NAME } from './production-cutover-contract';
import {
  executeTenant100StrictToShadow,
  FINANCIAL_SHADOW_FLAG_KEY,
  type Tenant100FinancialShadowGateway,
} from './set-production-all-tenant-financial-shadow';

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number;
}

export type FinancialShadowCommandRunner = (args: string[]) => CommandResult;

function defaultRunner(args: string[]): CommandResult {
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

function run(runner: FinancialShadowCommandRunner, args: string[], label: string): CommandResult {
  const result = runner(args);
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  return result;
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

interface D1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

function d1Envelopes(text: string): D1Envelope[] {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('D1 output was not a non-empty array');
  const envelopes = parsed as D1Envelope[];
  if (envelopes.some((envelope) => envelope.success !== true)) {
    throw new Error('D1 output contained an unsuccessful envelope');
  }
  return envelopes;
}

const READ_FLAG_SQL = `SELECT tenant_id,flag_key,domain,mode,is_enabled,version,config_json,effective_at_utc,expires_at_utc,updated_by_public_id,updated_at_utc
FROM canonical_feature_flags
WHERE tenant_id='100' AND flag_key='${FINANCIAL_SHADOW_FLAG_KEY}'
LIMIT 2;`;

export function createProductionFinancialShadowGateway(
  runner: FinancialShadowCommandRunner = defaultRunner,
): Tenant100FinancialShadowGateway {
  return {
    async readFlag() {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--command', READ_FLAG_SQL,
      ], 'tenant 100 financial flag read');
      return d1Envelopes(result.stdout).flatMap((envelope) => envelope.results ?? []);
    },
    async writeFlag(sql: string) {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--command', sql, '--yes',
      ], 'tenant 100 financial strict-to-shadow transition');
      const envelopes = d1Envelopes(result.stdout);
      return {
        changes: envelopes.reduce((sum, envelope) => sum + Number(envelope.meta?.changes ?? 0), 0),
        rowsWritten: envelopes.reduce((sum, envelope) => sum + Number(envelope.meta?.rows_written ?? 0), 0),
      };
    },
  };
}

function outsideRepository(path: string, repositoryRoot: string): string {
  const absolute = resolve(path);
  const root = resolve(repositoryRoot);
  if (absolute === root || absolute.startsWith(`${root}${sep}`)) {
    throw new Error('Financial shadow receipts must remain outside the repository');
  }
  return absolute;
}

function requireProtectedDirectory(path: string, repositoryRoot: string): string {
  const absolute = outsideRepository(path, repositoryRoot);
  if (!existsSync(absolute)) throw new Error(`Protected directory missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    throw new Error(`Protected directory must be a non-symlink mode-700 directory: ${absolute}`);
  }
  return absolute;
}

interface CliOptions {
  operator: string;
  expectedVersion: number;
  effectiveAtUtc: string;
  approval: string;
  outputPath: string;
  execute: boolean;
}

export function parseProductionFinancialShadowArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const allowed = new Set(['--operator', '--expected-version', '--effective-at-utc', '--approval', '--output']);
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (arg === '--execute') {
      if (execute) throw new Error('Duplicate argument: --execute');
      execute = true;
      continue;
    }
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (values.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
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
  const expectedVersion = Number(required('--expected-version'));
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('--expected-version must be a positive integer');
  }
  return {
    operator: required('--operator'),
    expectedVersion,
    effectiveAtUtc: required('--effective-at-utc'),
    approval: required('--approval'),
    outputPath: required('--output'),
    execute,
  };
}

async function main(): Promise<void> {
  const options = parseProductionFinancialShadowArgs(process.argv.slice(2));
  const root = process.cwd();
  const outputPath = outsideRepository(options.outputPath, root);
  requireProtectedDirectory(dirname(outputPath), root);
  if (existsSync(outputPath)) throw new Error('Financial shadow receipt already exists');

  const executedAtUtc = new Date().toISOString();
  const result = await executeTenant100StrictToShadow({
    operator: options.operator,
    effectiveAtUtc: options.effectiveAtUtc,
    expectedVersion: options.expectedVersion,
    approval: options.approval,
    execute: options.execute,
  }, createProductionFinancialShadowGateway());

  const receipt = {
    schemaVersion: 1,
    executedAtUtc,
    operator: options.operator,
    effectiveAtUtc: options.effectiveAtUtc,
    result,
  };
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(outputPath, 0o600);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
