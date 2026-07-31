import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type DirectWriteLifecycleStatus =
  | 'legacy_authority'
  | 'canonical_compatibility'
  | 'protected_fixture';

interface LegacyTableEntry {
  name: string;
}

interface DirectWriteAllowance {
  path: string;
  table: string;
  owner: string;
  removalPhase: string;
  reason: string;
  lifecycleStatus: DirectWriteLifecycleStatus;
  retirementBlocker: string;
  retirementTask: string;
  reviewedAtUtc: string;
}

interface LegacyRegistry {
  tables: LegacyTableEntry[];
  directWriteAllowlist: DirectWriteAllowance[];
}

export interface LegacyWriteRetirementReport {
  tableCount: number;
  allowanceCount: number;
  byTable: Record<string, number>;
  byOwner: Record<string, number>;
  byLifecycleStatus: Record<string, number>;
  byRemovalPhase: Record<string, number>;
  retirementTasks: Record<string, number>;
  paths: string[];
}

const LIFECYCLE_STATUSES = new Set<DirectWriteLifecycleStatus>([
  'legacy_authority',
  'canonical_compatibility',
  'protected_fixture',
]);
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortedCounts(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function parseRegistry(root: string): LegacyRegistry {
  const path = join(root, 'docs/database/legacy-table-disposition.yaml');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read legacy write retirement registry: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid direct-write retirement evidence: registry must be an object.');
  }
  const registry = parsed as Partial<LegacyRegistry>;
  if (!Array.isArray(registry.tables) || !Array.isArray(registry.directWriteAllowlist)) {
    throw new Error('Invalid direct-write retirement evidence: tables and directWriteAllowlist must be arrays.');
  }

  const tableNames = new Set<string>();
  for (const table of registry.tables) {
    if (!table || typeof table !== 'object' || !nonEmpty((table as LegacyTableEntry).name)) {
      throw new Error('Invalid direct-write retirement evidence: every table requires a name.');
    }
    tableNames.add((table as LegacyTableEntry).name.toLowerCase());
  }

  const scopes = new Set<string>();
  for (const allowance of registry.directWriteAllowlist) {
    const scope = `${allowance?.path ?? ''}\u0000${allowance?.table?.toLowerCase?.() ?? ''}`;
    const invalid = !allowance
      || typeof allowance !== 'object'
      || !nonEmpty(allowance.path)
      || !nonEmpty(allowance.table)
      || !tableNames.has(allowance.table.toLowerCase())
      || !nonEmpty(allowance.owner)
      || !nonEmpty(allowance.removalPhase)
      || !nonEmpty(allowance.reason)
      || !nonEmpty(allowance.lifecycleStatus)
      || !LIFECYCLE_STATUSES.has(allowance.lifecycleStatus)
      || !nonEmpty(allowance.retirementBlocker)
      || !nonEmpty(allowance.retirementTask)
      || !nonEmpty(allowance.reviewedAtUtc)
      || !UTC_TIMESTAMP_PATTERN.test(allowance.reviewedAtUtc)
      || scopes.has(scope);
    if (invalid) {
      throw new Error(`Invalid direct-write retirement evidence for ${allowance?.path ?? '<path>'}:${allowance?.table ?? '<table>'}.`);
    }
    scopes.add(scope);
  }

  return registry as LegacyRegistry;
}

export function buildLegacyWriteRetirementReport(root: string): LegacyWriteRetirementReport {
  const registry = parseRegistry(resolve(root));
  const allowances = registry.directWriteAllowlist;
  return {
    tableCount: registry.tables.length,
    allowanceCount: allowances.length,
    byTable: sortedCounts(allowances.map((entry) => entry.table)),
    byOwner: sortedCounts(allowances.map((entry) => entry.owner)),
    byLifecycleStatus: sortedCounts(allowances.map((entry) => entry.lifecycleStatus)),
    byRemovalPhase: sortedCounts(allowances.map((entry) => entry.removalPhase)),
    retirementTasks: sortedCounts(allowances.map((entry) => entry.retirementTask)),
    paths: [...new Set(allowances.map((entry) => entry.path))].sort((left, right) => left.localeCompare(right)),
  };
}

function main(): void {
  const root = resolve(process.argv[2] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(buildLegacyWriteRetirementReport(root), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
