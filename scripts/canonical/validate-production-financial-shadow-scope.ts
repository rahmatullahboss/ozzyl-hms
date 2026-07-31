import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

const FLAG_KEY = 'canonical_financial_dual_write_v1';

export interface ProductionFinancialShadowFlagRow extends Record<string, unknown> {
  tenant_id: unknown;
  tenant_status: unknown;
  flag_count: unknown;
  domain: unknown;
  mode: unknown;
  is_enabled: unknown;
  version: unknown;
  config_json: unknown;
}

export interface ProductionFinancialShadowScopeReceipt {
  schemaVersion: 1;
  evidenceReady: true;
  activationReady: boolean;
  activeTenantIds: string[];
  issueCount: number;
  issues: string[];
  aggregateOnly: true;
  productionMutationPerformed: false;
  rowsWritten: 0;
}

export const PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL = `
WITH
active_tenants AS (
  SELECT CAST(id AS TEXT) AS tenant_id
  FROM tenants WHERE status='active'
),
financial_flags AS (
  SELECT tenant_id,domain,mode,is_enabled,version,config_json
  FROM canonical_feature_flags
  WHERE flag_key='${FLAG_KEY}'
),
scope_tenants AS (
  SELECT tenant_id FROM active_tenants
  UNION
  SELECT tenant_id FROM financial_flags
)
SELECT
  s.tenant_id,
  CASE WHEN a.tenant_id IS NULL THEN 'inactive' ELSE 'active' END AS tenant_status,
  COUNT(f.tenant_id) AS flag_count,
  MAX(f.domain) AS domain,
  MAX(f.mode) AS mode,
  MAX(f.is_enabled) AS is_enabled,
  MAX(f.version) AS version,
  MAX(f.config_json) AS config_json
FROM scope_tenants s
LEFT JOIN active_tenants a ON a.tenant_id=s.tenant_id
LEFT JOIN financial_flags f ON f.tenant_id=s.tenant_id
GROUP BY s.tenant_id,a.tenant_id
ORDER BY CAST(s.tenant_id AS INTEGER),s.tenant_id;
`.trim();

function exactTenantId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error('tenant evidence must contain a positive decimal tenant identity');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('tenant evidence exceeds the safe integer range');
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function exactShadowConfig(configJson: unknown, tenantId: string): boolean {
  if (typeof configJson !== 'string') return false;
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const keys = Object.keys(parsed).sort();
    return keys.length === 2
      && keys[0] === 'tenantScope'
      && keys[1] === 'writePolicy'
      && Array.isArray(parsed.tenantScope)
      && parsed.tenantScope.length === 1
      && parsed.tenantScope[0] === tenantId
      && parsed.writePolicy === 'shadow';
  } catch {
    return false;
  }
}

export function evaluateProductionFinancialShadowScope(
  rows: readonly ProductionFinancialShadowFlagRow[],
): ProductionFinancialShadowScopeReceipt {
  const seen = new Set<string>();
  const activeTenantIds: string[] = [];
  const issues: string[] = [];

  for (const row of rows) {
    const tenantId = exactTenantId(row.tenant_id);
    if (seen.has(tenantId)) throw new Error(`duplicate tenant evidence: ${tenantId}`);
    seen.add(tenantId);
    const tenantStatus = row.tenant_status;
    if (tenantStatus !== 'active' && tenantStatus !== 'inactive') {
      throw new Error(`tenant evidence status is invalid: ${tenantId}`);
    }
    const flagCount = nonNegativeInteger(row.flag_count, `flag_count:${tenantId}`);

    if (tenantStatus === 'inactive') {
      if (flagCount > 0) issues.push(`FINANCIAL_SHADOW_FLAG_ORPHAN:${tenantId}`);
      continue;
    }

    activeTenantIds.push(tenantId);
    if (flagCount === 0) {
      issues.push(`FINANCIAL_SHADOW_FLAG_MISSING:${tenantId}`);
      continue;
    }
    if (flagCount !== 1) issues.push(`FINANCIAL_SHADOW_FLAG_DUPLICATE:${tenantId}`);
    if (
      row.domain !== 'financial'
      || row.mode !== 'shadow'
      || Number(row.is_enabled) !== 1
      || !Number.isSafeInteger(Number(row.version))
      || Number(row.version) <= 0
    ) {
      issues.push(`FINANCIAL_SHADOW_FLAG_NOT_ACTIVE:${tenantId}`);
    }
    if (!exactShadowConfig(row.config_json, tenantId)) {
      issues.push(`FINANCIAL_SHADOW_FLAG_CONFIG_INVALID:${tenantId}`);
    }
  }

  activeTenantIds.sort((left, right) => Number(left) - Number(right) || left.localeCompare(right));
  return {
    schemaVersion: 1,
    evidenceReady: true,
    activationReady: issues.length === 0,
    activeTenantIds,
    issueCount: issues.length,
    issues,
    aggregateOnly: true,
    productionMutationPerformed: false,
    rowsWritten: 0,
  };
}

interface CommandResult { stdout: string; stderr: string; exitCode: number }
type Runner = (args: string[]) => CommandResult;

function runner(root: string): Runner {
  return (args) => {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    if (result.error) throw result.error;
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? 1 };
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

function outputPath(value: string, repositoryRoot: string): string {
  const absolute = resolve(value);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Shadow scope evidence must remain outside the repository');
  }
  const parent = dirname(absolute);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: false, mode: 0o700 });
  const metadata = lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
    throw new Error('Shadow scope evidence parent must use mode 700');
  }
  return absolute;
}

export function validateProductionFinancialShadowScope(input: {
  output: string;
  repositoryRoot?: string;
  execute?: Runner;
}): ProductionFinancialShadowScopeReceipt {
  const root = input.repositoryRoot ?? process.cwd();
  const run = input.execute ?? runner(root);
  const identity = run(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
  if (identity.exitCode !== 0) throw new Error(`production D1 identity check failed: ${identity.stderr.trim()}`);
  const database = jsonDocument(identity.stdout) as { name?: unknown; uuid?: unknown };
  if (database.name !== CDB101_PRODUCTION_DATABASE_NAME || database.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Production D1 identity mismatch');
  }
  const query = run([
    'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
    '--env', 'production', '--remote', '--json', '--command', PRODUCTION_FINANCIAL_SHADOW_SCOPE_SQL,
  ]);
  if (query.exitCode !== 0) throw new Error(`production shadow scope query failed: ${query.stderr.trim()}`);
  const parsed = jsonDocument(query.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('Expected one D1 shadow scope envelope');
  const envelope = parsed[0] as { success?: unknown; results?: unknown[]; meta?: { changed_db?: unknown; rows_written?: unknown } };
  if (envelope.success !== true || !Array.isArray(envelope.results)) throw new Error('Invalid D1 shadow scope response');
  if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error('Shadow scope validator violated the read-only boundary');
  }
  const receipt = evaluateProductionFinancialShadowScope(envelope.results as ProductionFinancialShadowFlagRow[]);
  const output = outputPath(input.output, root);
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(output, 0o600);
  return receipt;
}

function main(): void {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const index = args.indexOf('--output');
    if (index < 0 || !args[index + 1]) throw new Error('--output is required');
    const receipt = validateProductionFinancialShadowScope({ output: args[index + 1] });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.activationReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
