import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import {
  buildAllTenantProviderShadowVerificationSql,
  evaluateAllTenantProviderShadowScope,
  type AllTenantProviderShadowAggregateRow,
  type AllTenantProviderShadowScopeReceipt,
} from './set-production-all-tenant-provider-shadow';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ProviderShadowScopeCommandRunner = (args: string[]) => CommandResult;

function defaultRunner(args: string[]): CommandResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

function jsonDocument(text: string): unknown {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  throw new Error('Wrangler output did not contain JSON');
}

function protectedOutputPath(value: string, repositoryRoot: string): string {
  const absolute = resolve(value);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Provider shadow scope evidence must remain outside the repository');
  }
  if (existsSync(absolute)) throw new Error('Provider shadow scope evidence already exists');
  const parent = dirname(absolute);
  if (!existsSync(parent)) throw new Error('Provider shadow scope evidence parent is missing');
  const metadata = lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
    throw new Error('Provider shadow scope evidence parent must be a non-symlink mode-700 directory');
  }
  return absolute;
}

export function validateProductionAllTenantProviderShadowScope(input: {
  output: string;
  repositoryRoot?: string;
  execute?: ProviderShadowScopeCommandRunner;
}): AllTenantProviderShadowScopeReceipt {
  const root = input.repositoryRoot ?? process.cwd();
  const run = input.execute ?? defaultRunner;

  const identityResult = run([
    'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json',
  ]);
  if (identityResult.exitCode !== 0) {
    throw new Error(`Production D1 identity check failed: ${identityResult.stderr.trim()}`);
  }
  const identity = jsonDocument(identityResult.stdout) as { name?: unknown; uuid?: unknown };
  if (
    identity.name !== CDB101_PRODUCTION_DATABASE_NAME
    || identity.uuid !== CDB101_PRODUCTION_DATABASE_ID
  ) {
    throw new Error('Production D1 identity mismatch');
  }

  const queryResult = run([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command',
    buildAllTenantProviderShadowVerificationSql(),
  ]);
  if (queryResult.exitCode !== 0) {
    throw new Error(`Production provider shadow scope query failed: ${queryResult.stderr.trim()}`);
  }
  const parsed = jsonDocument(queryResult.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Expected one D1 provider shadow scope envelope');
  }
  const envelope = parsed[0] as {
    success?: unknown;
    results?: unknown[];
    meta?: { changed_db?: unknown; rows_written?: unknown };
  };
  if (envelope.success !== true || !Array.isArray(envelope.results)) {
    throw new Error('Invalid D1 provider shadow scope response');
  }
  if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error('Provider shadow scope validator violated the read-only boundary');
  }

  const receipt = evaluateAllTenantProviderShadowScope(
    envelope.results as AllTenantProviderShadowAggregateRow[],
  );
  const output = protectedOutputPath(input.output, root);
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(output, 0o600);
  return receipt;
}

function main(): void {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const outputIndex = args.indexOf('--output');
    if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('--output is required');
    if (args.length !== 2) throw new Error('Only --output is accepted');
    const receipt = validateProductionAllTenantProviderShadowScope({ output: args[outputIndex + 1] });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.activationReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
