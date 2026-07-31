import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
  CDB101_REPORTING_IMPORT_TABLES,
} from './production-cutover-contract';

const ARCHIVAL_TABLE = 'doctor_commission_accruals_old_0391' as const;
const ACTIVE_TABLE = 'doctor_commission_accruals' as const;
const REMOVAL_PHASE = 'legacy_retirement_p11' as const;

export interface ArchivalFkPrerequisiteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ArchivalFkPrerequisiteRunner = (
  args: string[],
) => ArchivalFkPrerequisiteCommandResult;

export interface CollectReportingArchivalFkWaiverPrerequisitesOptions {
  outputPath: string;
  capturedAtUtc?: string;
  repositoryRoot?: string;
  runner?: ArchivalFkPrerequisiteRunner;
}

export interface ReportingArchivalFkWaiverPrerequisiteCandidate {
  schemaVersion: 1;
  program: 'CDB-101';
  domain: 'reporting';
  capturedAtUtc: string;
  productionDatabase: {
    name: typeof CDB101_PRODUCTION_DATABASE_NAME;
    id: typeof CDB101_PRODUCTION_DATABASE_ID;
  };
  archivalTable: typeof ARCHIVAL_TABLE;
  productionEvidence: {
    archivalRowCount: number;
    archivalLatestCreatedAtUtc: string;
    archivalLatestUpdatedAtUtc: string;
    activeTable: typeof ACTIVE_TABLE;
    activeRowCount: number;
    activeLatestCreatedAtUtc: string;
    triggerCount: 0;
    dependentObjectCount: 0;
    billsViolationCount: 26;
    visitsViolationCount: 15;
    totalArchivalViolationCount: 41;
    changedDb: false;
    rowsWritten: 0;
  };
  repositoryEvidence: {
    runtimeSourceReferenceCount: 0;
    excludedFromCanonicalImport: true;
    excludedFromReporting: true;
  };
  attestations: {
    archivalTableConfirmed: true;
    activeWriterDisabledConfirmed: true;
    excludedFromCanonicalImportConfirmed: true;
    excludedFromReportingConfirmed: true;
    removalPhase: typeof REMOVAL_PHASE;
  };
  formalApproval: {
    approved: false;
    ownerId: null;
    approvedAtUtc: null;
    evidenceId: null;
    evidenceSha256: null;
  };
  aggregateOnly: true;
  productionMutationPerformed: false;
}

export interface ReportingArchivalFkWaiverPrerequisiteReceipt {
  schemaVersion: 1;
  prerequisiteCandidateReady: true;
  archivalViolationCount: 41;
  runtimeSourceReferenceCount: 0;
  triggerCount: 0;
  dependentObjectCount: 0;
  formalApprovalRecorded: false;
  aggregateOnly: true;
  networkRequestPerformed: true;
  productionMutationPerformed: false;
  externalCommandPerformed: true;
}

export interface ReportingArchivalFkWaiverPrerequisiteCliOptions {
  outputPath: string;
  capturedAtUtc?: string;
}

interface AggregateRow {
  archival_row_count?: unknown;
  archival_latest_created_at?: unknown;
  archival_latest_updated_at?: unknown;
  active_row_count?: unknown;
  active_latest_created_at?: unknown;
  trigger_count?: unknown;
  dependent_object_count?: unknown;
  archival_to_bills?: unknown;
  archival_to_visits?: unknown;
}

interface D1Envelope {
  results?: unknown[];
  success?: boolean;
  meta?: {
    changed_db?: unknown;
    rows_written?: unknown;
  };
}

const AGGREGATE_SQL = `
WITH fk_groups AS (
  SELECT "table" AS child_table, parent AS parent_table, COUNT(*) AS violation_count
  FROM pragma_foreign_key_check
  GROUP BY "table", parent
)
SELECT
  (SELECT COUNT(*) FROM ${ARCHIVAL_TABLE}) AS archival_row_count,
  (SELECT MAX(created_at) FROM ${ARCHIVAL_TABLE}) AS archival_latest_created_at,
  (SELECT MAX(updated_at) FROM ${ARCHIVAL_TABLE}) AS archival_latest_updated_at,
  (SELECT COUNT(*) FROM ${ACTIVE_TABLE}) AS active_row_count,
  (SELECT MAX(created_at) FROM ${ACTIVE_TABLE}) AS active_latest_created_at,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = '${ARCHIVAL_TABLE}') AS trigger_count,
  (SELECT COUNT(*) FROM sqlite_master
    WHERE type IN ('view', 'trigger')
      AND sql IS NOT NULL
      AND instr(lower(sql), lower('${ARCHIVAL_TABLE}')) > 0
      AND NOT (type = 'trigger' AND tbl_name = '${ARCHIVAL_TABLE}')) AS dependent_object_count,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups
    WHERE child_table = '${ARCHIVAL_TABLE}' AND parent_table = 'bills') AS archival_to_bills,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups
    WHERE child_table = '${ARCHIVAL_TABLE}' AND parent_table = 'visits') AS archival_to_visits;
`.trim();

function createRunner(root: string): ArchivalFkPrerequisiteRunner {
  return (args) => {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
      },
    });
    if (result.error) throw result.error;
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.status ?? 1,
    };
  };
}

function extractJsonDocument(text: string): unknown {
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
      // Try the next bounded JSON candidate.
    }
  }
  throw new Error('Wrangler output did not contain valid JSON');
}

function assertCommandSuccess(label: string, result: ArchivalFkPrerequisiteCommandResult): void {
  if (result.exitCode !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
}

function exactNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function exactInteger(value: unknown, expected: number, label: string): number {
  const parsed = exactNonNegativeInteger(value, label);
  if (parsed !== expected) throw new Error(`${label} must equal ${expected}`);
  return parsed;
}

function parseAbsoluteUtc(value: string, label: string): string {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an absolute UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function parseSqliteUtc(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is missing`);
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const utc = normalized.endsWith('Z') ? normalized : `${normalized}Z`;
  if (!Number.isFinite(Date.parse(utc))) throw new Error(`${label} is invalid`);
  return new Date(utc).toISOString();
}

function collectIdentity(runner: ArchivalFkPrerequisiteRunner): void {
  const result = runner(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
  assertCommandSuccess('production D1 identity check', result);
  const parsed = extractJsonDocument(result.stdout) as { name?: unknown; uuid?: unknown };
  if (parsed.name !== CDB101_PRODUCTION_DATABASE_NAME || parsed.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Production D1 identity did not match the exact configured database');
  }
}

function collectAggregate(runner: ArchivalFkPrerequisiteRunner): AggregateRow {
  const result = runner([
    'd1',
    'execute',
    CDB101_PRODUCTION_DATABASE_NAME,
    '--remote',
    '--env',
    'production',
    '--json',
    '--command',
    AGGREGATE_SQL,
  ]);
  assertCommandSuccess('archival FK prerequisite query', result);
  const parsed = extractJsonDocument(result.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Archival FK prerequisite query did not return exactly one D1 envelope');
  }
  const envelope = parsed[0] as D1Envelope;
  if (envelope.success !== true || !Array.isArray(envelope.results) || envelope.results.length !== 1) {
    throw new Error('Archival FK prerequisite query did not return one successful aggregate row');
  }
  if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error('Archival FK prerequisite query violated the production read-only boundary');
  }
  return envelope.results[0] as AggregateRow;
}

function runtimeSourceReferenceCount(repositoryRoot: string): number {
  const sourceRoot = join(repositoryRoot, 'src');
  if (!existsSync(sourceRoot)) return 0;
  let count = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile() || !['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(entry.name))) continue;
      if (readFileSync(absolute, 'utf8').includes(ARCHIVAL_TABLE)) count += 1;
    }
  };
  visit(sourceRoot);
  return count;
}

function prepareOutputPath(outputPath: string, repositoryRoot: string): string {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Archival FK waiver prerequisite output must remain outside the repository');
  }
  const parentPath = dirname(absolute);
  if (!existsSync(parentPath)) mkdirSync(parentPath, { recursive: false, mode: 0o700 });
  const parent = lstatSync(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Archival FK waiver prerequisite parent directory must use mode 700');
  }
  return absolute;
}

export function collectReportingArchivalFkWaiverPrerequisites(
  options: CollectReportingArchivalFkWaiverPrerequisitesOptions,
): {
  candidate: ReportingArchivalFkWaiverPrerequisiteCandidate;
  receipt: ReportingArchivalFkWaiverPrerequisiteReceipt;
} {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const runner = options.runner ?? createRunner(repositoryRoot);
  collectIdentity(runner);
  const row = collectAggregate(runner);

  const archivalRowCount = exactNonNegativeInteger(row.archival_row_count, 'archival row count');
  const activeRowCount = exactNonNegativeInteger(row.active_row_count, 'active row count');
  if (archivalRowCount === 0 || activeRowCount === 0) throw new Error('Archival and active commission tables must both contain rows');

  const archivalLatestCreatedAtUtc = parseSqliteUtc(
    row.archival_latest_created_at,
    'archival latest created_at',
  );
  const archivalLatestUpdatedAtUtc = parseSqliteUtc(
    row.archival_latest_updated_at,
    'archival latest updated_at',
  );
  const activeLatestCreatedAtUtc = parseSqliteUtc(
    row.active_latest_created_at,
    'active latest created_at',
  );
  if (Date.parse(archivalLatestUpdatedAtUtc) >= Date.parse(activeLatestCreatedAtUtc)) {
    throw new Error('Archival table is not retired because its latest write is not older than the active table');
  }

  const triggerCount = exactInteger(row.trigger_count, 0, 'archival trigger count');
  const dependentObjectCount = exactNonNegativeInteger(row.dependent_object_count, 'dependent object count');
  if (dependentObjectCount !== 0) throw new Error('Archival table has a dependent object');
  exactInteger(row.archival_to_bills, 26, 'archival bills FK violation count');
  exactInteger(row.archival_to_visits, 15, 'archival visits FK violation count');

  const sourceReferenceCount = runtimeSourceReferenceCount(repositoryRoot);
  if (sourceReferenceCount !== 0) throw new Error('Archival table has a runtime source reference');
  if ((CDB101_REPORTING_IMPORT_TABLES as readonly string[]).includes(ARCHIVAL_TABLE)) {
    throw new Error('Archival table is unexpectedly included in the canonical import scope');
  }

  const capturedAtUtc = parseAbsoluteUtc(
    options.capturedAtUtc ?? new Date().toISOString(),
    'Prerequisite capture time',
  );
  const candidate: ReportingArchivalFkWaiverPrerequisiteCandidate = {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    capturedAtUtc,
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    archivalTable: ARCHIVAL_TABLE,
    productionEvidence: {
      archivalRowCount,
      archivalLatestCreatedAtUtc,
      archivalLatestUpdatedAtUtc,
      activeTable: ACTIVE_TABLE,
      activeRowCount,
      activeLatestCreatedAtUtc,
      triggerCount,
      dependentObjectCount: 0,
      billsViolationCount: 26,
      visitsViolationCount: 15,
      totalArchivalViolationCount: 41,
      changedDb: false,
      rowsWritten: 0,
    },
    repositoryEvidence: {
      runtimeSourceReferenceCount: 0,
      excludedFromCanonicalImport: true,
      excludedFromReporting: true,
    },
    attestations: {
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: REMOVAL_PHASE,
    },
    formalApproval: {
      approved: false,
      ownerId: null,
      approvedAtUtc: null,
      evidenceId: null,
      evidenceSha256: null,
    },
    aggregateOnly: true,
    productionMutationPerformed: false,
  };

  const output = prepareOutputPath(options.outputPath, repositoryRoot);
  writeFileSync(output, `${JSON.stringify(candidate, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(output, 0o600);

  return {
    candidate,
    receipt: {
      schemaVersion: 1,
      prerequisiteCandidateReady: true,
      archivalViolationCount: 41,
      runtimeSourceReferenceCount: 0,
      triggerCount: 0,
      dependentObjectCount: 0,
      formalApprovalRecorded: false,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      externalCommandPerformed: true,
    },
  };
}

export function parseReportingArchivalFkWaiverPrerequisiteArgs(
  args: string[],
): ReportingArchivalFkWaiverPrerequisiteCliOptions {
  const allowed = new Set(['--output', '--captured-at-utc']);
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg in values) throw new Error(`Duplicate argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values[arg] = value;
    index += 1;
  }
  if (!values['--output']) throw new Error('--output is required');
  return {
    outputPath: values['--output'],
    capturedAtUtc: values['--captured-at-utc'],
  };
}

function main(): void {
  try {
    const options = parseReportingArchivalFkWaiverPrerequisiteArgs(process.argv.slice(2));
    const { receipt } = collectReportingArchivalFkWaiverPrerequisites(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 archival FK prerequisite collection failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
