import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import type { ReportingActiveFkDiagnosis } from './reporting-active-fk-repair-plan';

export interface ActiveFkDiagnosisCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ActiveFkDiagnosisRunner = (args: string[]) => ActiveFkDiagnosisCommandResult;

export interface CollectReportingActiveFkDiagnosisOptions {
  outputPath: string;
  capturedAtUtc?: string;
  repositoryRoot?: string;
  runner?: ActiveFkDiagnosisRunner;
}

export interface ReportingActiveFkDiagnosisReceipt {
  schemaVersion: 1;
  diagnosisReady: true;
  activeGroupCount: 2;
  activeViolationCount: 8;
  archivalViolationCount: 41;
  totalForeignKeyViolationCount: 49;
  deterministicReplacementCandidateCount: 0;
  ambiguousReplacementCandidateCount: 0;
  unmatchedActiveViolationCount: 8;
  nullableReferenceCount: 2;
  aggregateOnly: true;
  networkRequestPerformed: true;
  productionMutationPerformed: false;
  externalCommandPerformed: true;
}

export interface ReportingActiveFkDiagnosisCliOptions {
  outputPath: string;
  capturedAtUtc?: string;
}

interface DiagnosisAggregateRow {
  billing_deposit_orphans?: unknown;
  billing_deposit_nullable?: unknown;
  billing_deposit_deterministic_candidates?: unknown;
  billing_deposit_ambiguous_candidates?: unknown;
  billing_deposit_unmatched?: unknown;
  income_orphans?: unknown;
  income_nullable?: unknown;
  income_deterministic_candidates?: unknown;
  income_ambiguous_candidates?: unknown;
  income_unmatched?: unknown;
  archival_violations?: unknown;
  total_fk_violations?: unknown;
}

interface D1Envelope {
  results?: unknown[];
  success?: boolean;
  meta?: {
    changed_db?: unknown;
    rows_written?: unknown;
  };
}

const DIAGNOSIS_SQL = `
WITH
billing_deposit_orphans AS (
  SELECT d.id, d.tenant_id, d.patient_id, d.created_at, d.remarks
  FROM billing_deposits d
  LEFT JOIN bills missing ON missing.id = d.reference_bill_id
  WHERE d.reference_bill_id IS NOT NULL AND missing.id IS NULL
),
billing_deposit_candidates AS (
  SELECT d.id,
    (
      SELECT COUNT(DISTINCT b.id)
      FROM bills b
      WHERE CAST(b.tenant_id AS TEXT) = CAST(d.tenant_id AS TEXT)
        AND (
          (b.patient_id = d.patient_id AND date(b.created_at) = date(d.created_at))
          OR (
            b.invoice_no IS NOT NULL
            AND length(trim(b.invoice_no)) > 0
            AND instr(lower(COALESCE(d.remarks, '')), lower(b.invoice_no)) > 0
          )
        )
    ) AS candidate_count
  FROM billing_deposit_orphans d
),
income_orphans AS (
  SELECT i.id, i.tenant_id, i.date, i.amount, i.description
  FROM income i
  LEFT JOIN bills missing ON missing.id = i.bill_id
  WHERE i.bill_id IS NOT NULL AND missing.id IS NULL
),
income_candidates AS (
  SELECT i.id,
    (
      SELECT COUNT(DISTINCT b.id)
      FROM bills b
      WHERE CAST(b.tenant_id AS TEXT) = CAST(i.tenant_id AS TEXT)
        AND (
          (date(b.created_at) = date(i.date)
            AND ABS(COALESCE(b.paid_amount, b.paid, 0) - ABS(i.amount)) < 0.000001)
          OR (
            b.invoice_no IS NOT NULL
            AND length(trim(b.invoice_no)) > 0
            AND instr(lower(COALESCE(i.description, '')), lower(b.invoice_no)) > 0
          )
        )
    ) AS candidate_count
  FROM income_orphans i
),
fk_groups AS (
  SELECT "table" AS child_table, parent AS parent_table, COUNT(*) AS violation_count
  FROM pragma_foreign_key_check
  GROUP BY "table", parent
)
SELECT
  (SELECT COUNT(*) FROM billing_deposit_orphans) AS billing_deposit_orphans,
  (SELECT COUNT(*) FROM pragma_table_info('billing_deposits')
    WHERE name = 'reference_bill_id' AND "notnull" = 0) AS billing_deposit_nullable,
  (SELECT COUNT(*) FROM billing_deposit_candidates WHERE candidate_count = 1)
    AS billing_deposit_deterministic_candidates,
  (SELECT COUNT(*) FROM billing_deposit_candidates WHERE candidate_count > 1)
    AS billing_deposit_ambiguous_candidates,
  (SELECT COUNT(*) FROM billing_deposit_candidates WHERE candidate_count = 0)
    AS billing_deposit_unmatched,
  (SELECT COUNT(*) FROM income_orphans) AS income_orphans,
  (SELECT COUNT(*) FROM pragma_table_info('income')
    WHERE name = 'bill_id' AND "notnull" = 0) AS income_nullable,
  (SELECT COUNT(*) FROM income_candidates WHERE candidate_count = 1)
    AS income_deterministic_candidates,
  (SELECT COUNT(*) FROM income_candidates WHERE candidate_count > 1)
    AS income_ambiguous_candidates,
  (SELECT COUNT(*) FROM income_candidates WHERE candidate_count = 0)
    AS income_unmatched,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups
    WHERE child_table = 'doctor_commission_accruals_old_0391') AS archival_violations,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups) AS total_fk_violations;
`.trim();

function createRunner(root: string): ActiveFkDiagnosisRunner {
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
      // Continue to the next bounded JSON candidate.
    }
  }
  throw new Error('Wrangler output did not contain valid JSON');
}

function parseAbsoluteUtc(value: string, label: string): string {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an absolute UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function exactInteger(value: unknown, expected: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed !== expected) {
    throw new Error(`${label} must equal ${expected}`);
  }
  return parsed;
}

function assertCommandSuccess(label: string, result: ActiveFkDiagnosisCommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim()}`);
  }
}

function collectIdentity(runner: ActiveFkDiagnosisRunner): void {
  const result = runner(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
  assertCommandSuccess('production D1 identity check', result);
  const parsed = extractJsonDocument(result.stdout) as { name?: unknown; uuid?: unknown };
  if (parsed.name !== CDB101_PRODUCTION_DATABASE_NAME || parsed.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Production D1 identity did not match the exact configured database');
  }
}

function collectAggregate(runner: ActiveFkDiagnosisRunner): DiagnosisAggregateRow {
  const result = runner([
    'd1',
    'execute',
    CDB101_PRODUCTION_DATABASE_NAME,
    '--remote',
    '--env',
    'production',
    '--json',
    '--command',
    DIAGNOSIS_SQL,
  ]);
  assertCommandSuccess('active FK diagnosis query', result);
  const parsed = extractJsonDocument(result.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Active FK diagnosis did not return exactly one D1 envelope');
  }
  const envelope = parsed[0] as D1Envelope;
  if (envelope.success !== true || !Array.isArray(envelope.results) || envelope.results.length !== 1) {
    throw new Error('Active FK diagnosis did not return one successful aggregate row');
  }
  if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error('Active FK diagnosis violated the production read-only boundary');
  }
  return envelope.results[0] as DiagnosisAggregateRow;
}

function prepareOutputPath(outputPath: string, repositoryRoot: string): string {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Active FK diagnosis output must remain outside the repository');
  }
  const parentPath = dirname(absolute);
  if (!existsSync(parentPath)) mkdirSync(parentPath, { recursive: false, mode: 0o700 });
  const parent = lstatSync(parentPath);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Active FK diagnosis parent directory must use mode 700');
  }
  return absolute;
}

export function collectReportingActiveFkDiagnosis(
  options: CollectReportingActiveFkDiagnosisOptions,
): { diagnosis: ReportingActiveFkDiagnosis; receipt: ReportingActiveFkDiagnosisReceipt } {
  const root = options.repositoryRoot ?? process.cwd();
  const runner = options.runner ?? createRunner(root);
  collectIdentity(runner);
  const row = collectAggregate(runner);

  exactInteger(row.billing_deposit_orphans, 4, 'billing_deposits orphan count');
  exactInteger(row.billing_deposit_nullable, 1, 'billing_deposits nullable reference proof');
  exactInteger(row.billing_deposit_deterministic_candidates, 0, 'billing_deposits deterministic candidate count');
  exactInteger(row.billing_deposit_ambiguous_candidates, 0, 'billing_deposits ambiguous candidate count');
  exactInteger(row.billing_deposit_unmatched, 4, 'billing_deposits unmatched count');
  exactInteger(row.income_orphans, 4, 'income orphan count');
  exactInteger(row.income_nullable, 1, 'income nullable reference proof');
  exactInteger(row.income_deterministic_candidates, 0, 'income deterministic candidate count');
  exactInteger(row.income_ambiguous_candidates, 0, 'income ambiguous candidate count');
  exactInteger(row.income_unmatched, 4, 'income unmatched count');
  exactInteger(row.archival_violations, 41, 'archival FK violation count');
  exactInteger(row.total_fk_violations, 49, 'total FK violation count');

  const capturedAtUtc = parseAbsoluteUtc(
    options.capturedAtUtc ?? new Date().toISOString(),
    'Diagnosis capture time',
  );
  const diagnosis: ReportingActiveFkDiagnosis = {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    sourceQueryId: 'cdb101_active_fk_diagnosis_v1',
    capturedAtUtc,
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    groups: [
      {
        childTable: 'billing_deposits',
        parentTable: 'bills',
        childColumn: 'reference_bill_id',
        violationCount: 4,
        nullable: true,
        deterministicReplacementCandidateCount: 0,
      },
      {
        childTable: 'income',
        parentTable: 'bills',
        childColumn: 'bill_id',
        violationCount: 4,
        nullable: true,
        deterministicReplacementCandidateCount: 0,
      },
    ],
    totalActiveViolationCount: 8,
    preserveFinancialRowsRequired: true,
    hardDeleteAllowed: false,
    guessedRelinkAllowed: false,
    recommendedStrategyId: 'clear_invalid_optional_bill_reference_v1',
    changedDb: false,
    rowsWritten: 0,
    productionMutationPerformed: false,
  };
  const output = prepareOutputPath(options.outputPath, root);
  writeFileSync(output, `${JSON.stringify(diagnosis, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(output, 0o600);

  return {
    diagnosis,
    receipt: {
      schemaVersion: 1,
      diagnosisReady: true,
      activeGroupCount: 2,
      activeViolationCount: 8,
      archivalViolationCount: 41,
      totalForeignKeyViolationCount: 49,
      deterministicReplacementCandidateCount: 0,
      ambiguousReplacementCandidateCount: 0,
      unmatchedActiveViolationCount: 8,
      nullableReferenceCount: 2,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      externalCommandPerformed: true,
    },
  };
}

export function parseReportingActiveFkDiagnosisArgs(
  args: string[],
): ReportingActiveFkDiagnosisCliOptions {
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
    const options = parseReportingActiveFkDiagnosisArgs(process.argv.slice(2));
    const { receipt } = collectReportingActiveFkDiagnosis(options);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 active FK diagnosis collection failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
