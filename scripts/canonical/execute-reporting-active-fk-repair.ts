import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';
import { loadProtectedJsonDocument } from './protected-json-document';

export const CDB101_ACTIVE_FK_REPAIR_CONFIRMATION = 'REPAIR_CDB101_ACTIVE_FK_8' as const;
const STRATEGY_ID = 'clear_invalid_optional_bill_reference_v1' as const;

export interface ReportingActiveFkRepairCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ReportingActiveFkRepairRunner = (
  args: string[],
) => ReportingActiveFkRepairCommandResult;

export interface ReportingActiveFkRepairExecutionCliOptions {
  approvalPath: string;
  diagnosisPath: string;
  planPath: string;
  exportMetadataPath: string;
  outputPath: string;
  confirmation: typeof CDB101_ACTIVE_FK_REPAIR_CONFIRMATION;
}

export interface ExecuteReportingActiveFkRepairOptions {
  approvalPath: string;
  diagnosisPath: string;
  planPath: string;
  exportMetadataPath: string;
  outputPath: string;
  executedAtUtc?: string;
  repositoryRoot?: string;
  runner?: ReportingActiveFkRepairRunner;
}

export interface ReportingActiveFkRepairReceipt {
  schemaVersion: 1;
  repairCompleted: true;
  strategyId: typeof STRATEGY_ID;
  executedAtUtc: string;
  beforeTotalForeignKeyViolationCount: 49;
  afterTotalForeignKeyViolationCount: 41;
  beforeActiveViolationCount: 8;
  afterActiveViolationCount: 0;
  archivalViolationCount: 41;
  businessRowsUpdated: 8;
  mutationReportedRowsWritten: number;
  financialRowsPreserved: true;
  financialAmountsPreserved: true;
  hardDeletePerformed: false;
  guessedRelinkPerformed: false;
  productionMutationPerformed: true;
  mutationCommandPerformed: true;
  verificationQueriesReadOnly: true;
  aggregateOnly: true;
  approvalSha256: string;
  diagnosisSha256: string;
  planSha256: string;
  exportSha256: string;
}

interface ActiveFkAggregate {
  billingOrphans: number;
  incomeOrphans: number;
  archivalToBills: number;
  archivalToVisits: number;
  totalFkViolations: number;
  billingRowCount: number;
  billingAmountTotal: number;
  incomeRowCount: number;
  incomeAmountTotal: number;
}

interface ProtectedDocument {
  value: unknown;
  raw: string;
  sha256: string;
}

interface ActiveRepairApproval {
  approvalId: string;
  ownerId: string;
  approvedAtUtc: string;
  exportSha256: string;
  exportSizeBytes: number;
  timeTravelBookmark: string;
  diagnosisSha256: string;
  planSha256: string;
}

interface ExportMetadata {
  exportFile: string;
  exportSha256: string;
  exportSizeBytes: number;
  timeTravelEvidenceFile: string;
  createdAtUtc: string;
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
  (SELECT COUNT(*)
   FROM billing_deposits AS d
   LEFT JOIN bills AS b ON b.id = d.reference_bill_id
   WHERE d.reference_bill_id IS NOT NULL AND b.id IS NULL) AS billing_orphans,
  (SELECT COUNT(*)
   FROM income AS i
   LEFT JOIN bills AS b ON b.id = i.bill_id
   WHERE i.bill_id IS NOT NULL AND b.id IS NULL) AS income_orphans,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups
   WHERE child_table = 'doctor_commission_accruals_old_0391' AND parent_table = 'bills') AS archival_to_bills,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups
   WHERE child_table = 'doctor_commission_accruals_old_0391' AND parent_table = 'visits') AS archival_to_visits,
  (SELECT COALESCE(SUM(violation_count), 0) FROM fk_groups) AS total_fk_violations,
  (SELECT COUNT(*) FROM billing_deposits) AS billing_row_count,
  (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM billing_deposits) AS billing_amount_total,
  (SELECT COUNT(*) FROM income) AS income_row_count,
  (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM income) AS income_amount_total;
`.trim();

export function buildReportingActiveFkRepairSql(): string {
  return `
CREATE TABLE cdb101_active_fk_snapshot AS
${AGGREGATE_SQL.replace(/;$/, '')};

CREATE TABLE cdb101_active_fk_guard (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO cdb101_active_fk_guard(check_name, ok)
SELECT 'before_state', CASE WHEN
  billing_orphans = 4
  AND income_orphans = 4
  AND archival_to_bills = 26
  AND archival_to_visits = 15
  AND total_fk_violations = 49
THEN 1 ELSE 0 END
FROM cdb101_active_fk_snapshot;

UPDATE billing_deposits
SET reference_bill_id = NULL
WHERE reference_bill_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bills WHERE bills.id = billing_deposits.reference_bill_id
  );

INSERT INTO cdb101_active_fk_guard(check_name, ok)
VALUES ('billing_update_count', CASE WHEN changes() = 4 THEN 1 ELSE 0 END);

UPDATE income
SET bill_id = NULL
WHERE bill_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bills WHERE bills.id = income.bill_id
  );

INSERT INTO cdb101_active_fk_guard(check_name, ok)
VALUES ('income_update_count', CASE WHEN changes() = 4 THEN 1 ELSE 0 END);

INSERT INTO cdb101_active_fk_guard(check_name, ok)
SELECT 'after_state', CASE WHEN
  (SELECT COUNT(*)
   FROM billing_deposits AS d
   LEFT JOIN bills AS b ON b.id = d.reference_bill_id
   WHERE d.reference_bill_id IS NOT NULL AND b.id IS NULL) = 0
  AND (SELECT COUNT(*)
   FROM income AS i
   LEFT JOIN bills AS b ON b.id = i.bill_id
   WHERE i.bill_id IS NOT NULL AND b.id IS NULL) = 0
  AND (SELECT COUNT(*) FROM pragma_foreign_key_check) = 41
  AND (SELECT COUNT(*) FROM billing_deposits) = billing_row_count
  AND (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM billing_deposits) = billing_amount_total
  AND (SELECT COUNT(*) FROM income) = income_row_count
  AND (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM income) = income_amount_total
THEN 1 ELSE 0 END
FROM cdb101_active_fk_snapshot;

DROP TABLE cdb101_active_fk_guard;
DROP TABLE cdb101_active_fk_snapshot;
`.trim();
}

function createRunner(root: string): ReportingActiveFkRepairRunner {
  return (args) => {
    const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256Text(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function absoluteUtc(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an absolute UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_:\-]{2,127}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function timeTravelBookmark(value: unknown): string {
  if (typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Time Travel bookmark is invalid');
  }
  return value;
}

function exactSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be SHA-256`);
  }
  return value;
}

function exactInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
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

function assertCommandSuccess(label: string, result: ReportingActiveFkRepairCommandResult): void {
  if (result.exitCode !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => value.trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(`${label} failed: ${detail || 'unknown command failure'}`);
  }
}

function loadProtected(
  path: string,
  repositoryRoot: string,
  label: string,
  maxBytes = 128 * 1024,
): ProtectedDocument {
  const loaded = loadProtectedJsonDocument(path, repositoryRoot, {
    maxBytes,
    maxDepth: 48,
  });
  if (!loaded.ready) {
    throw new Error(`${label} is unavailable: ${loaded.issues.map((issue) => issue.code).join(',')}`);
  }
  const raw = readFileSync(resolve(path), 'utf8');
  return { value: loaded.value, raw, sha256: sha256Text(raw) };
}

function requireProtectedRegularFile(
  path: string,
  repositoryRoot: string,
  label: string,
): Buffer {
  const absolute = resolve(path);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error(`${label} must remain outside the repository`);
  }
  const file = lstatSync(absolute);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a protected mode-600 regular file`);
  }
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error(`${label} parent directory must use mode 700`);
  }
  return readFileSync(absolute);
}

function parseExactGroups(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} must contain exact active groups`);
  const normalized = value.map((group) => {
    if (!isRecord(group) || group.parentTable !== 'bills') throw new Error(`${label} must contain exact active groups`);
    if (group.childTable === 'billing_deposits'
      && (group.childColumn === 'reference_bill_id')
      && (group.violationCount === 4 || group.expectedViolationCount === 4)) {
      return 'billing_deposits|reference_bill_id';
    }
    if (group.childTable === 'income'
      && group.childColumn === 'bill_id'
      && (group.violationCount === 4 || group.expectedViolationCount === 4)) {
      return 'income|bill_id';
    }
    throw new Error(`${label} must contain exact active groups`);
  }).sort();
  if (normalized[0] !== 'billing_deposits|reference_bill_id' || normalized[1] !== 'income|bill_id') {
    throw new Error(`${label} must contain exact active groups`);
  }
}

function parseDiagnosis(document: ProtectedDocument): string {
  const input = document.value;
  if (!isRecord(input)
    || input.schemaVersion !== 1
    || input.program !== 'CDB-101'
    || input.domain !== 'reporting'
    || input.sourceQueryId !== 'cdb101_active_fk_diagnosis_v1'
    || input.totalActiveViolationCount !== 8
    || input.preserveFinancialRowsRequired !== true
    || input.hardDeleteAllowed !== false
    || input.guessedRelinkAllowed !== false
    || input.recommendedStrategyId !== STRATEGY_ID
    || input.changedDb !== false
    || input.rowsWritten !== 0
    || input.productionMutationPerformed !== false
    || !isRecord(input.productionDatabase)
    || input.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Protected active FK diagnosis is invalid');
  }
  parseExactGroups(input.groups, 'Diagnosis');
  return absoluteUtc(input.capturedAtUtc, 'Diagnosis capture time');
}

function parsePlan(document: ProtectedDocument, diagnosisCapturedAtUtc: string): {
  generatedAtUtc: string;
  repairOwnerId: string;
} {
  const input = document.value;
  if (!isRecord(input)
    || input.schemaVersion !== 1
    || input.program !== 'CDB-101'
    || input.domain !== 'reporting'
    || input.stage !== 'active_fk_repair_preparation'
    || input.status !== 'review_required'
    || input.strategyId !== STRATEGY_ID
    || input.expectedTotalActiveViolationCount !== 8
    || input.executionCommandIncluded !== false
    || input.executionAuthorized !== false
    || input.decision !== 'no_go_until_separately_authorized_and_verified'
    || input.aggregateOnly !== true
    || input.productionMutationPerformed !== false
    || !isRecord(input.productionDatabase)
    || input.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Protected active FK repair plan is invalid');
  }
  parseExactGroups(input.expectedGroups, 'Repair plan');
  const generatedAtUtc = absoluteUtc(input.generatedAtUtc, 'Repair plan generation time');
  if (input.diagnosisCapturedAtUtc !== diagnosisCapturedAtUtc) {
    throw new Error('Repair plan diagnosis binding is invalid');
  }
  return {
    generatedAtUtc,
    repairOwnerId: safeIdentifier(input.repairOwnerId, 'Repair owner ID'),
  };
}

function parseApproval(
  document: ProtectedDocument,
  diagnosisSha256: string,
  planSha256: string,
): ActiveRepairApproval {
  const input = document.value;
  if (!isRecord(input)
    || input.schemaVersion !== 1
    || input.program !== 'CDB-101'
    || input.domain !== 'reporting'
    || input.scope !== 'active_fk_repair_only'
    || input.approved !== true
    || input.strategyId !== STRATEGY_ID
    || input.preserveFinancialRows !== true
    || input.hardDeleteAllowed !== false
    || input.guessedRelinkAllowed !== false
    || input.source !== 'user_explicit_production_authorization'
    || !isRecord(input.productionDatabase)
    || input.productionDatabase.name !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabase.id !== CDB101_PRODUCTION_DATABASE_ID
    || !isRecord(input.expectedBefore)
    || input.expectedBefore.billingDepositsToBills !== 4
    || input.expectedBefore.incomeToBills !== 4
    || input.expectedBefore.total !== 49
    || !isRecord(input.expectedAfter)
    || input.expectedAfter.billingDepositsToBills !== 0
    || input.expectedAfter.incomeToBills !== 0
    || input.expectedAfter.total !== 41) {
    throw new Error('Protected active FK repair approval is invalid');
  }
  parseExactGroups(input.groups, 'Approval');
  if (input.diagnosisSha256 !== diagnosisSha256 || input.planSha256 !== planSha256) {
    throw new Error('Active FK repair approval evidence binding is invalid');
  }
  return {
    approvalId: safeIdentifier(input.approvalId, 'Approval ID'),
    ownerId: safeIdentifier(input.ownerId, 'Approval owner ID'),
    approvedAtUtc: absoluteUtc(input.approvedAtUtc, 'Approval time'),
    exportSha256: exactSha256(input.exportSha256, 'Approved export hash'),
    exportSizeBytes: exactInteger(input.exportSizeBytes, 'Approved export size'),
    timeTravelBookmark: timeTravelBookmark(input.timeTravelBookmark),
    diagnosisSha256,
    planSha256,
  };
}

function parseExportMetadata(
  document: ProtectedDocument,
  repositoryRoot: string,
  approval: ActiveRepairApproval,
): ExportMetadata {
  const input = document.value;
  if (!isRecord(input)
    || input.productionDatabaseName !== CDB101_PRODUCTION_DATABASE_NAME
    || input.productionDatabaseId !== CDB101_PRODUCTION_DATABASE_ID
    || typeof input.exportFile !== 'string'
    || typeof input.timeTravelEvidenceFile !== 'string') {
    throw new Error('Protected production export metadata is invalid');
  }
  const exportSha256 = exactSha256(input.exportSha256, 'Export metadata hash');
  const exportSizeBytes = exactInteger(input.exportSizeBytes, 'Export metadata size');
  if (exportSha256 !== approval.exportSha256 || exportSizeBytes !== approval.exportSizeBytes) {
    throw new Error('Export metadata does not match active FK repair approval');
  }
  const exportBytes = requireProtectedRegularFile(input.exportFile, repositoryRoot, 'Production export');
  if (exportBytes.length !== exportSizeBytes) throw new Error('Production export size does not match protected metadata');
  if (sha256Text(exportBytes) !== exportSha256) throw new Error('Production export hash does not match protected metadata');

  const timeTravelBytes = requireProtectedRegularFile(
    input.timeTravelEvidenceFile,
    repositoryRoot,
    'Time Travel evidence',
  );
  const timeTravel = extractJsonDocument(timeTravelBytes.toString('utf8'));
  if (!isRecord(timeTravel) || timeTravel.bookmark !== approval.timeTravelBookmark) {
    throw new Error('Time Travel bookmark does not match active FK repair approval');
  }
  absoluteUtc(input.timeTravelTimestampUtc, 'Time Travel timestamp');
  return {
    exportFile: input.exportFile,
    exportSha256,
    exportSizeBytes,
    timeTravelEvidenceFile: input.timeTravelEvidenceFile,
    createdAtUtc: absoluteUtc(input.createdAtUtc, 'Export capture time'),
  };
}

function createOutputPath(outputPath: string, repositoryRoot: string): string {
  const absolute = resolve(outputPath);
  const repository = resolve(repositoryRoot);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Active FK repair receipt must remain outside the repository');
  }
  if (existsSync(absolute)) throw new Error('Refusing to overwrite active FK repair receipt');
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('Active FK repair receipt parent directory must use mode 700');
  }
  return absolute;
}

function createAggregate(row: unknown): ActiveFkAggregate {
  if (!isRecord(row)) throw new Error('Active FK aggregate row is invalid');
  return {
    billingOrphans: exactInteger(row.billing_orphans, 'billing_deposits orphan count'),
    incomeOrphans: exactInteger(row.income_orphans, 'income orphan count'),
    archivalToBills: exactInteger(row.archival_to_bills, 'archival bills violation count'),
    archivalToVisits: exactInteger(row.archival_to_visits, 'archival visits violation count'),
    totalFkViolations: exactInteger(row.total_fk_violations, 'total FK violation count'),
    billingRowCount: exactInteger(row.billing_row_count, 'billing_deposits row count'),
    billingAmountTotal: Number(row.billing_amount_total),
    incomeRowCount: exactInteger(row.income_row_count, 'income row count'),
    incomeAmountTotal: Number(row.income_amount_total),
  };
}

function collectAggregate(runner: ReportingActiveFkRepairRunner): ActiveFkAggregate {
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
  assertCommandSuccess('active FK aggregate query', result);
  const parsed = extractJsonDocument(result.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('Active FK aggregate query did not return one D1 envelope');
  }
  const envelope = parsed[0] as D1Envelope;
  if (envelope.success !== true || !Array.isArray(envelope.results) || envelope.results.length !== 1) {
    throw new Error('Active FK aggregate query did not return one successful row');
  }
  if (envelope.meta?.changed_db !== false || Number(envelope.meta?.rows_written ?? 0) !== 0) {
    throw new Error('Active FK aggregate query violated the read-only boundary');
  }
  return createAggregate(envelope.results[0]);
}

function assertBeforeState(before: ActiveFkAggregate): void {
  if (before.billingOrphans !== 4
    || before.incomeOrphans !== 4
    || before.archivalToBills !== 26
    || before.archivalToVisits !== 15
    || before.totalFkViolations !== 49) {
    throw new Error('Active FK before-state drift prevents repair');
  }
}

function assertAfterState(before: ActiveFkAggregate, after: ActiveFkAggregate): void {
  if (after.billingOrphans !== 0
    || after.incomeOrphans !== 0
    || after.archivalToBills !== 26
    || after.archivalToVisits !== 15
    || after.totalFkViolations !== 41
    || after.billingRowCount !== before.billingRowCount
    || after.billingAmountTotal !== before.billingAmountTotal
    || after.incomeRowCount !== before.incomeRowCount
    || after.incomeAmountTotal !== before.incomeAmountTotal) {
    throw new Error('Active FK after-state verification failed');
  }
}

function verifyProductionIdentity(runner: ReportingActiveFkRepairRunner): void {
  const result = runner(['d1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json']);
  assertCommandSuccess('production D1 identity check', result);
  const parsed = extractJsonDocument(result.stdout);
  if (!isRecord(parsed)
    || parsed.name !== CDB101_PRODUCTION_DATABASE_NAME
    || parsed.uuid !== CDB101_PRODUCTION_DATABASE_ID) {
    throw new Error('Production D1 identity did not match the active FK repair scope');
  }
}

function executeMutation(runner: ReportingActiveFkRepairRunner): number {
  const result = runner([
    'd1',
    'execute',
    CDB101_PRODUCTION_DATABASE_NAME,
    '--remote',
    '--env',
    'production',
    '--json',
    '--command',
    buildReportingActiveFkRepairSql(),
  ]);
  assertCommandSuccess('active FK guarded repair transaction', result);
  const parsed = extractJsonDocument(result.stdout);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Active FK guarded repair transaction did not return D1 evidence');
  }
  let reportedRowsWritten = 0;
  let changed = false;
  for (const item of parsed) {
    const envelope = item as D1Envelope;
    if (envelope.success !== true) throw new Error('Active FK guarded repair transaction was not successful');
    const rowsWritten = Number(envelope.meta?.rows_written ?? 0);
    if (Number.isFinite(rowsWritten) && rowsWritten > 0) reportedRowsWritten += rowsWritten;
    if (envelope.meta?.changed_db === true) changed = true;
  }
  if (!changed) throw new Error('Active FK guarded repair transaction did not report a database change');
  return reportedRowsWritten;
}

export function executeReportingActiveFkRepair(
  options: ExecuteReportingActiveFkRepairOptions,
): ReportingActiveFkRepairReceipt {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const approvalDocument = loadProtected(options.approvalPath, repositoryRoot, 'Active FK repair approval');
  const diagnosisDocument = loadProtected(options.diagnosisPath, repositoryRoot, 'Active FK diagnosis');
  const planDocument = loadProtected(options.planPath, repositoryRoot, 'Active FK repair plan');
  const exportMetadataDocument = loadProtected(
    options.exportMetadataPath,
    repositoryRoot,
    'Production export metadata',
  );
  const outputPath = createOutputPath(options.outputPath, repositoryRoot);

  const diagnosisCapturedAtUtc = parseDiagnosis(diagnosisDocument);
  const plan = parsePlan(planDocument, diagnosisCapturedAtUtc);
  const approval = parseApproval(
    approvalDocument,
    diagnosisDocument.sha256,
    planDocument.sha256,
  );
  const exportMetadata = parseExportMetadata(
    exportMetadataDocument,
    repositoryRoot,
    approval,
  );
  if (plan.repairOwnerId !== approval.ownerId) {
    throw new Error('Active FK repair owner binding is invalid');
  }
  const approvalMs = Date.parse(approval.approvedAtUtc);
  if (approvalMs < Date.parse(diagnosisCapturedAtUtc)
    || approvalMs < Date.parse(plan.generatedAtUtc)
    || approvalMs < Date.parse(exportMetadata.createdAtUtc)) {
    throw new Error('Active FK repair approval must follow diagnosis, plan, and export capture');
  }
  const executedAtUtc = absoluteUtc(
    options.executedAtUtc ?? new Date().toISOString(),
    'Execution time',
  );
  if (Date.parse(executedAtUtc) < approvalMs) {
    throw new Error('Active FK repair execution cannot precede approval');
  }

  const runner = options.runner ?? createRunner(repositoryRoot);
  verifyProductionIdentity(runner);
  const before = collectAggregate(runner);
  assertBeforeState(before);
  const mutationReportedRowsWritten = executeMutation(runner);
  const after = collectAggregate(runner);
  assertAfterState(before, after);

  const receipt: ReportingActiveFkRepairReceipt = {
    schemaVersion: 1,
    repairCompleted: true,
    strategyId: STRATEGY_ID,
    executedAtUtc,
    beforeTotalForeignKeyViolationCount: 49,
    afterTotalForeignKeyViolationCount: 41,
    beforeActiveViolationCount: 8,
    afterActiveViolationCount: 0,
    archivalViolationCount: 41,
    businessRowsUpdated: 8,
    mutationReportedRowsWritten,
    financialRowsPreserved: true,
    financialAmountsPreserved: true,
    hardDeletePerformed: false,
    guessedRelinkPerformed: false,
    productionMutationPerformed: true,
    mutationCommandPerformed: true,
    verificationQueriesReadOnly: true,
    aggregateOnly: true,
    approvalSha256: approvalDocument.sha256,
    diagnosisSha256: diagnosisDocument.sha256,
    planSha256: planDocument.sha256,
    exportSha256: approval.exportSha256,
  };
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600);
  return receipt;
}

export function parseReportingActiveFkRepairExecutionArgs(
  args: string[],
): ReportingActiveFkRepairExecutionCliOptions {
  const allowed = new Set([
    '--approval',
    '--diagnosis',
    '--plan',
    '--export-metadata',
    '--output',
    '--confirm',
  ]);
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
  for (const required of ['--approval', '--diagnosis', '--plan', '--export-metadata', '--output', '--confirm']) {
    if (!values[required]) throw new Error(`${required} is required`);
  }
  if (values['--confirm'] !== CDB101_ACTIVE_FK_REPAIR_CONFIRMATION) {
    throw new Error(`Active FK repair confirmation must be ${CDB101_ACTIVE_FK_REPAIR_CONFIRMATION}`);
  }
  return {
    approvalPath: values['--approval'],
    diagnosisPath: values['--diagnosis'],
    planPath: values['--plan'],
    exportMetadataPath: values['--export-metadata'],
    outputPath: values['--output'],
    confirmation: CDB101_ACTIVE_FK_REPAIR_CONFIRMATION,
  };
}

function main(): void {
  try {
    const options = parseReportingActiveFkRepairExecutionArgs(process.argv.slice(2));
    const receipt = executeReportingActiveFkRepair(options);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      repairCompleted: receipt.repairCompleted,
      beforeTotalForeignKeyViolationCount: receipt.beforeTotalForeignKeyViolationCount,
      afterTotalForeignKeyViolationCount: receipt.afterTotalForeignKeyViolationCount,
      businessRowsUpdated: receipt.businessRowsUpdated,
      financialRowsPreserved: receipt.financialRowsPreserved,
      productionMutationPerformed: receipt.productionMutationPerformed,
      aggregateOnly: receipt.aggregateOnly,
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 active FK repair execution failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
