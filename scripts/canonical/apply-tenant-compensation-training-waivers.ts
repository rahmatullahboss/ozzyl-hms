import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const TRAINING_PERIOD_RESOLUTION_CODE = 'TRAINING_PERIOD_LEGACY_COMPENSATION_NOT_IMPORTED';
export const APPROVED_TENANT_ID = '102';
export const APPROVED_AUTHORIZATION_ID = 'tenant102-training-period-compensation-waiver-owner-approved-20260719';
export const APPROVED_BY_PUBLIC_ID = 'rahmatullah-zisan';

export const EXPECTED_TENANT_102_TRAINING_ISSUES = {
  COMPENSATION_RULE_UNRESOLVED: 43,
  COMPENSATION_INVOICE_LINE_UNRESOLVED: 25,
  COMPENSATION_PAID_SETTLEMENT_UNRESOLVED: 25,
  COMPENSATION_AMOUNT_MISMATCH: 16,
  COMPENSATION_SETTLEMENT_ACCRUAL_UNRESOLVED: 6,
  COMPENSATION_AMOUNT_UNRESOLVED: 2,
  COMPENSATION_TERMINAL_SOURCE_UNRESOLVED: 2,
  COMPENSATION_RULE_MISMATCH: 1,
} as const;

const EXPECTED_ISSUE_COUNT = Object.values(EXPECTED_TENANT_102_TRAINING_ISSUES)
  .reduce((sum, count) => sum + count, 0);
export const EXPECTED_DEPENDENT_SETTLEMENT_ALLOCATION_COUNT = 35;
const EXPECTED_REJECTED_MAPPING_COUNT = EXPECTED_ISSUE_COUNT + EXPECTED_DEPENDENT_SETTLEMENT_ALLOCATION_COUNT;
const EXPECTED_CODES = Object.keys(EXPECTED_TENANT_102_TRAINING_ISSUES);

const LEGACY_COMPENSATION_TABLES = [
  'doctor_commission_rules',
  'diagnostic_performer_payout_rules',
  'doctor_commission_accruals',
  'diagnostic_performer_reserves',
  'doctor_commission_settlements',
  'doctor_commission_settlement_items',
] as const;

const CANONICAL_COMPENSATION_TABLES = [
  'canonical_compensation_rules',
  'canonical_compensation_accruals',
  'canonical_compensation_adjustments',
  'canonical_compensation_settlements',
  'canonical_compensation_settlement_allocations',
] as const;

interface TrainingPeriodWaiverReadinessInput {
  tenantId: string;
  issueCounts: Record<string, number>;
  issueCount: number;
  distinctMappingCount: number;
  ambiguousMappingCount: number;
  canonicalIdCount: number;
  waivedIssueCount: number;
  rejectedMappingCount: number;
  dependentSettlementAllocationCount: number;
  remainingOpenIssueCount: number;
  remainingAmbiguousCompensationMappingCount: number;
  legacyRowsBefore: number;
  legacyRowsAfter: number;
  canonicalRowsBefore: number;
  canonicalRowsAfter: number;
  integrityOk: boolean;
}

export function evaluateTrainingPeriodWaiverReadiness(
  input: TrainingPeriodWaiverReadinessInput,
): { queueCleared: boolean; canonicalCompensationAuthorityReady: false; issues: string[] } {
  const issues: string[] = [];
  if (input.tenantId !== APPROVED_TENANT_ID) issues.push('TRAINING_WAIVER_TENANT_SCOPE_INVALID');

  const actualKeys = Object.keys(input.issueCounts).filter((key) => Number(input.issueCounts[key] ?? 0) !== 0).sort();
  const expectedKeys = [...EXPECTED_CODES].sort();
  const countsMatch = actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index])
    && expectedKeys.every((key) => input.issueCounts[key] === EXPECTED_TENANT_102_TRAINING_ISSUES[
      key as keyof typeof EXPECTED_TENANT_102_TRAINING_ISSUES
    ]);
  if (!countsMatch || input.issueCount !== EXPECTED_ISSUE_COUNT) {
    issues.push('TRAINING_WAIVER_ISSUE_COUNTS_MISMATCH');
  }
  if (input.distinctMappingCount !== EXPECTED_ISSUE_COUNT) {
    issues.push('TRAINING_WAIVER_MAPPING_CARDINALITY_INVALID');
  }
  if (input.ambiguousMappingCount !== EXPECTED_ISSUE_COUNT) {
    issues.push('TRAINING_WAIVER_MAPPING_NOT_AMBIGUOUS');
  }
  if (input.canonicalIdCount !== 0) issues.push('TRAINING_WAIVER_CANONICAL_ID_PRESENT');
  if (input.waivedIssueCount !== EXPECTED_ISSUE_COUNT) issues.push('TRAINING_WAIVER_ISSUES_NOT_WAIVED');
  if (input.dependentSettlementAllocationCount !== EXPECTED_DEPENDENT_SETTLEMENT_ALLOCATION_COUNT) {
    issues.push('TRAINING_WAIVER_DEPENDENT_ALLOCATIONS_MISMATCH');
  }
  if (input.rejectedMappingCount !== EXPECTED_REJECTED_MAPPING_COUNT) {
    issues.push('TRAINING_WAIVER_MAPPINGS_NOT_REJECTED');
  }
  if (input.remainingOpenIssueCount !== 0) issues.push('TRAINING_WAIVER_OPEN_ISSUES_REMAIN');
  if (input.remainingAmbiguousCompensationMappingCount !== 0) {
    issues.push('TRAINING_WAIVER_COMPENSATION_AMBIGUITY_REMAINS');
  }
  if (input.legacyRowsBefore !== input.legacyRowsAfter) issues.push('TRAINING_WAIVER_LEGACY_MUTATED');
  if (input.canonicalRowsBefore !== input.canonicalRowsAfter) {
    issues.push('TRAINING_WAIVER_CANONICAL_ROWS_MUTATED');
  }
  if (!input.integrityOk) issues.push('TRAINING_WAIVER_INTEGRITY_FAILED');

  return {
    queueCleared: issues.length === 0,
    canonicalCompensationAuthorityReady: false,
    issues,
  };
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function requireProtectedRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${label} must be one protected regular file`);
  }
  if ((stat.mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 600`);
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error(`${label} parent directory must use mode 700`);
  }
}

function prepareOutputDirectory(path: string): string {
  const absolute = resolve(path);
  const repository = resolve(process.cwd());
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Training waiver output must remain outside the repository');
  }
  try {
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Output must be a regular directory');
    if ((stat.mode & 0o777) !== 0o700) throw new Error('Output directory must use mode 700');
    if (readdirSync(absolute).length !== 0) throw new Error('Output directory must be empty');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(absolute, { recursive: true, mode: 0o700 });
    chmodSync(absolute, 0o700);
  }
  return absolute;
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
  ).get(table));
}

function tenantRowCount(database: DatabaseSync, table: string, tenantId: string): number {
  if (!tableExists(database, table)) throw new Error(`Missing required table: ${table}`);
  const row = database.prepare(`SELECT COUNT(*) count FROM "${table}" WHERE CAST(tenant_id AS TEXT)=?`)
    .get(tenantId) as { count?: unknown } | undefined;
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid row count for ${table}`);
  return count;
}

function sumTenantRows(database: DatabaseSync, tables: readonly string[], tenantId: string): number {
  return tables.reduce((sum, table) => sum + tenantRowCount(database, table, tenantId), 0);
}

function integrityOk(database: DatabaseSync): boolean {
  const row = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown> | undefined;
  return row != null && Object.values(row).some((value) => value === 'ok');
}

interface TargetRow {
  issueId: number;
  mappingId: number;
  issueCode: string;
  mappingStatus: string;
  canonicalPublicId: string | null;
}

function readTargets(database: DatabaseSync, tenantId: string): TargetRow[] {
  const placeholders = EXPECTED_CODES.map(() => '?').join(',');
  return database.prepare(`
    SELECT
      i.id issue_id,
      m.id mapping_id,
      i.issue_code,
      m.mapping_status,
      m.canonical_public_id
    FROM canonical_processing_issues i
    JOIN canonical_source_mappings m
      ON m.tenant_id=i.tenant_id
      AND m.entity_type=i.entity_type
      AND m.source_type=i.source_type
      AND m.source_public_id=i.source_public_id
    WHERE i.tenant_id=?
      AND i.issue_type='compensation_backfill'
      AND i.status='open'
      AND i.severity='error'
      AND i.issue_code IN (${placeholders})
    ORDER BY i.id
  `).all(tenantId, ...EXPECTED_CODES).map((row) => {
    const value = row as Record<string, unknown>;
    return {
      issueId: Number(value.issue_id),
      mappingId: Number(value.mapping_id),
      issueCode: String(value.issue_code),
      mappingStatus: String(value.mapping_status),
      canonicalPublicId: value.canonical_public_id == null ? null : String(value.canonical_public_id),
    };
  });
}

interface DependentMappingRow {
  mappingId: number;
  mappingStatus: string;
  canonicalPublicId: string | null;
}

function readDependentSettlementAllocationMappings(
  database: DatabaseSync,
  tenantId: string,
): DependentMappingRow[] {
  const placeholders = EXPECTED_CODES.map(() => '?').join(',');
  return database.prepare(`
    SELECT DISTINCT
      m.id mapping_id,
      m.mapping_status,
      m.canonical_public_id
    FROM canonical_processing_issues i
    JOIN doctor_commission_settlement_items item
      ON CAST(item.tenant_id AS TEXT)=i.tenant_id
      AND CAST(item.settlement_id AS TEXT)=i.source_public_id
    JOIN canonical_source_mappings m
      ON m.tenant_id=i.tenant_id
      AND m.entity_type='compensation_settlement_allocation'
      AND m.source_type='legacy_doctor_commission_settlement_item'
      AND m.source_public_id=CAST(item.id AS TEXT)
    WHERE i.tenant_id=?
      AND i.issue_type='compensation_backfill'
      AND i.status='open'
      AND i.severity='error'
      AND i.entity_type='compensation_settlement'
      AND i.issue_code IN (${placeholders})
    ORDER BY m.id
  `).all(tenantId, ...EXPECTED_CODES).map((row) => {
    const value = row as Record<string, unknown>;
    return {
      mappingId: Number(value.mapping_id),
      mappingStatus: String(value.mapping_status),
      canonicalPublicId: value.canonical_public_id == null ? null : String(value.canonical_public_id),
    };
  });
}

function issueCounts(rows: TargetRow[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) result[row.issueCode] = (result[row.issueCode] ?? 0) + 1;
  return result;
}

function scalarCount(database: DatabaseSync, sql: string, params: unknown[]): number {
  const row = database.prepare(sql).get(...params) as { count?: unknown } | undefined;
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid aggregate count');
  return count;
}

interface SourceReceipt {
  tenantId?: unknown;
  openCompensationErrors?: unknown;
  targetResolutionReady?: unknown;
  productionMutationPerformed?: unknown;
}

export interface ApplyTrainingPeriodWaiverOptions {
  sourceDatabasePath: string;
  sourceReceiptPath: string;
  expectedSourceReceiptSha256: string;
  outputDirectory: string;
  authorizationId: string;
  approvedByPublicId: string;
  nowUtc: string;
}

export interface TrainingPeriodWaiverReceipt {
  schemaVersion: 1;
  tenantId: '102';
  authorizationId: string;
  approvedByPublicId: string;
  resolutionCode: typeof TRAINING_PERIOD_RESOLUTION_CODE;
  sourceDatabaseSha256: string;
  sourceReceiptSha256: string;
  outputDatabaseSha256: string;
  issueCounts: Record<string, number>;
  waivedIssueCount: number;
  directRejectedMappingCount: number;
  dependentRejectedSettlementAllocationCount: number;
  rejectedMappingCount: number;
  remainingOpenIssueCount: number;
  remainingAmbiguousCompensationMappingCount: number;
  legacyRowsMutated: number;
  canonicalCompensationRowsMutated: number;
  pendingReviewQueueCleared: boolean;
  canonicalCompensationAuthorityReady: false;
  legacyCompensationAuthorityRetained: true;
  issues: string[];
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
}

export function applyTenantCompensationTrainingWaivers(
  options: ApplyTrainingPeriodWaiverOptions,
): TrainingPeriodWaiverReceipt {
  if (options.authorizationId !== APPROVED_AUTHORIZATION_ID) {
    throw new Error('Training waiver authorization ID is invalid');
  }
  if (options.approvedByPublicId !== APPROVED_BY_PUBLIC_ID) {
    throw new Error('Training waiver approver is invalid');
  }
  if (!options.nowUtc.endsWith('Z') || !Number.isFinite(Date.parse(options.nowUtc))) {
    throw new Error('nowUtc must be a valid UTC timestamp');
  }
  if (!/^[a-f0-9]{64}$/.test(options.expectedSourceReceiptSha256)) {
    throw new Error('Expected source receipt SHA-256 is invalid');
  }

  const sourceDatabasePath = resolve(options.sourceDatabasePath);
  const sourceReceiptPath = resolve(options.sourceReceiptPath);
  requireProtectedRegularFile(sourceDatabasePath, 'Source database');
  requireProtectedRegularFile(sourceReceiptPath, 'Source receipt');
  const sourceReceiptSha256 = sha256File(sourceReceiptPath);
  if (sourceReceiptSha256 !== options.expectedSourceReceiptSha256) {
    throw new Error('Source receipt SHA-256 mismatch');
  }
  const sourceReceipt = JSON.parse(readFileSync(sourceReceiptPath, 'utf8')) as SourceReceipt;
  if (String(sourceReceipt.tenantId ?? '') !== APPROVED_TENANT_ID
    || Number(sourceReceipt.openCompensationErrors ?? -1) !== EXPECTED_ISSUE_COUNT
    || sourceReceipt.targetResolutionReady !== true
    || sourceReceipt.productionMutationPerformed !== false) {
    throw new Error('Source receipt is not the approved Tenant-102 rehearsal state');
  }

  const outputDirectory = prepareOutputDirectory(options.outputDirectory);
  const outputDatabasePath = resolve(outputDirectory, 'tenant-example-training-waiver.sqlite');
  const outputReceiptPath = resolve(outputDirectory, 'tenant-example-training-waiver-receipt.json');
  copyFileSync(sourceDatabasePath, outputDatabasePath);
  chmodSync(outputDatabasePath, 0o600);

  const database = new DatabaseSync(outputDatabasePath);
  database.exec('PRAGMA foreign_keys=ON');
  let readiness: ReturnType<typeof evaluateTrainingPeriodWaiverReadiness>;
  let counts: Record<string, number> = {};
  let waivedIssueCount = 0;
  let directRejectedMappingCount = 0;
  let dependentRejectedSettlementAllocationCount = 0;
  let rejectedMappingCount = 0;
  let remainingOpenIssueCount = 0;
  let remainingAmbiguousCompensationMappingCount = 0;
  let legacyRowsBefore = 0;
  let legacyRowsAfter = 0;
  let canonicalRowsBefore = 0;
  let canonicalRowsAfter = 0;

  try {
    if (!integrityOk(database)) throw new Error('Source work database integrity check failed');
    const targets = readTargets(database, APPROVED_TENANT_ID);
    const dependentMappings = readDependentSettlementAllocationMappings(database, APPROVED_TENANT_ID);
    counts = issueCounts(targets);
    const distinctMappings = new Set(targets.map((row) => row.mappingId));
    const ambiguousMappingCount = targets.filter((row) => row.mappingStatus === 'ambiguous').length;
    const canonicalIdCount = targets.filter((row) => row.canonicalPublicId != null).length;
    const dependentAmbiguousCount = dependentMappings.filter((row) => row.mappingStatus === 'ambiguous').length;
    const dependentCanonicalIdCount = dependentMappings.filter((row) => row.canonicalPublicId != null).length;
    const preflightIssues: string[] = [];
    if (targets.length !== EXPECTED_ISSUE_COUNT) preflightIssues.push('TRAINING_WAIVER_ISSUE_COUNTS_MISMATCH');
    for (const code of EXPECTED_CODES) {
      if ((counts[code] ?? 0) !== EXPECTED_TENANT_102_TRAINING_ISSUES[
        code as keyof typeof EXPECTED_TENANT_102_TRAINING_ISSUES
      ]) preflightIssues.push('TRAINING_WAIVER_ISSUE_COUNTS_MISMATCH');
    }
    if (distinctMappings.size !== EXPECTED_ISSUE_COUNT) {
      preflightIssues.push('TRAINING_WAIVER_MAPPING_CARDINALITY_INVALID');
    }
    if (ambiguousMappingCount !== EXPECTED_ISSUE_COUNT) {
      preflightIssues.push('TRAINING_WAIVER_MAPPING_NOT_AMBIGUOUS');
    }
    if (canonicalIdCount !== 0) preflightIssues.push('TRAINING_WAIVER_CANONICAL_ID_PRESENT');
    if (dependentMappings.length !== EXPECTED_DEPENDENT_SETTLEMENT_ALLOCATION_COUNT
      || dependentAmbiguousCount !== EXPECTED_DEPENDENT_SETTLEMENT_ALLOCATION_COUNT) {
      preflightIssues.push('TRAINING_WAIVER_DEPENDENT_ALLOCATIONS_MISMATCH');
    }
    if (dependentCanonicalIdCount !== 0) preflightIssues.push('TRAINING_WAIVER_CANONICAL_ID_PRESENT');
    if (preflightIssues.length > 0) throw new Error([...new Set(preflightIssues)].join(', '));

    legacyRowsBefore = sumTenantRows(database, LEGACY_COMPENSATION_TABLES, APPROVED_TENANT_ID);
    canonicalRowsBefore = sumTenantRows(database, CANONICAL_COMPENSATION_TABLES, APPROVED_TENANT_ID);

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('CREATE TEMP TABLE tenant_example_training_waiver_targets(issue_id INTEGER PRIMARY KEY, mapping_id INTEGER UNIQUE NOT NULL)');
      database.exec('CREATE TEMP TABLE tenant_example_training_waiver_dependent_mappings(mapping_id INTEGER PRIMARY KEY)');
      const insertTarget = database.prepare(
        'INSERT INTO tenant_example_training_waiver_targets(issue_id,mapping_id) VALUES(?,?)',
      );
      for (const target of targets) insertTarget.run(target.issueId, target.mappingId);
      const insertDependent = database.prepare(
        'INSERT INTO tenant_example_training_waiver_dependent_mappings(mapping_id) VALUES(?)',
      );
      for (const target of dependentMappings) insertDependent.run(target.mappingId);

      const mappingResult = database.prepare(`
        UPDATE canonical_source_mappings
        SET mapping_status='rejected',
            mapping_version=mapping_version+1,
            updated_at_utc=?
        WHERE id IN (
          SELECT mapping_id FROM tenant_example_training_waiver_targets
          UNION
          SELECT mapping_id FROM tenant_example_training_waiver_dependent_mappings
        )
          AND tenant_id=?
          AND mapping_status='ambiguous'
          AND canonical_public_id IS NULL
      `).run(options.nowUtc, APPROVED_TENANT_ID);
      if (Number(mappingResult.changes) !== EXPECTED_REJECTED_MAPPING_COUNT) {
        throw new Error('Training waiver mapping update count mismatch');
      }

      const issueResult = database.prepare(`
        UPDATE canonical_processing_issues
        SET severity='warning',
            status='waived',
            resolved_at_utc=?,
            resolved_by_public_id=?,
            resolution_code=?,
            updated_at_utc=?
        WHERE id IN (SELECT issue_id FROM tenant_example_training_waiver_targets)
          AND tenant_id=?
          AND issue_type='compensation_backfill'
          AND status='open'
          AND severity='error'
      `).run(
        options.nowUtc,
        options.approvedByPublicId,
        TRAINING_PERIOD_RESOLUTION_CODE,
        options.nowUtc,
        APPROVED_TENANT_ID,
      );
      if (Number(issueResult.changes) !== EXPECTED_ISSUE_COUNT) {
        throw new Error('Training waiver issue update count mismatch');
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    const codePlaceholders = EXPECTED_CODES.map(() => '?').join(',');
    waivedIssueCount = scalarCount(database, `
      SELECT COUNT(*) count
      FROM canonical_processing_issues
      WHERE tenant_id=?
        AND issue_type='compensation_backfill'
        AND status='waived'
        AND severity='warning'
        AND resolution_code=?
        AND issue_code IN (${codePlaceholders})
    `, [APPROVED_TENANT_ID, TRAINING_PERIOD_RESOLUTION_CODE, ...EXPECTED_CODES]);
    directRejectedMappingCount = scalarCount(database, `
      SELECT COUNT(*) count
      FROM canonical_source_mappings m
      WHERE m.tenant_id=?
        AND m.mapping_status='rejected'
        AND m.canonical_public_id IS NULL
        AND EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=m.tenant_id
            AND i.entity_type=m.entity_type
            AND i.source_type=m.source_type
            AND i.source_public_id=m.source_public_id
            AND i.status='waived'
            AND i.resolution_code=?
        )
    `, [APPROVED_TENANT_ID, TRAINING_PERIOD_RESOLUTION_CODE]);
    dependentRejectedSettlementAllocationCount = scalarCount(database, `
      SELECT COUNT(*) count
      FROM canonical_source_mappings m
      JOIN doctor_commission_settlement_items item
        ON CAST(item.tenant_id AS TEXT)=m.tenant_id
        AND m.source_public_id=CAST(item.id AS TEXT)
      WHERE m.tenant_id=?
        AND m.entity_type='compensation_settlement_allocation'
        AND m.source_type='legacy_doctor_commission_settlement_item'
        AND m.mapping_status='rejected'
        AND m.canonical_public_id IS NULL
        AND EXISTS (
          SELECT 1 FROM canonical_processing_issues i
          WHERE i.tenant_id=m.tenant_id
            AND i.entity_type='compensation_settlement'
            AND i.source_type='legacy_doctor_commission_settlement'
            AND i.source_public_id=CAST(item.settlement_id AS TEXT)
            AND i.status='waived'
            AND i.resolution_code=?
        )
    `, [APPROVED_TENANT_ID, TRAINING_PERIOD_RESOLUTION_CODE]);
    rejectedMappingCount = directRejectedMappingCount + dependentRejectedSettlementAllocationCount;
    remainingOpenIssueCount = scalarCount(database, `
      SELECT COUNT(*) count
      FROM canonical_processing_issues
      WHERE tenant_id=?
        AND issue_type='compensation_backfill'
        AND status='open'
        AND issue_code IN (${codePlaceholders})
    `, [APPROVED_TENANT_ID, ...EXPECTED_CODES]);
    remainingAmbiguousCompensationMappingCount = scalarCount(database, `
      SELECT COUNT(*) count
      FROM canonical_source_mappings
      WHERE tenant_id=?
        AND entity_type IN (
          'compensation_accrual',
          'compensation_settlement',
          'compensation_settlement_allocation'
        )
        AND mapping_status='ambiguous'
    `, [APPROVED_TENANT_ID]);
    legacyRowsAfter = sumTenantRows(database, LEGACY_COMPENSATION_TABLES, APPROVED_TENANT_ID);
    canonicalRowsAfter = sumTenantRows(database, CANONICAL_COMPENSATION_TABLES, APPROVED_TENANT_ID);

    readiness = evaluateTrainingPeriodWaiverReadiness({
      tenantId: APPROVED_TENANT_ID,
      issueCounts: counts,
      issueCount: EXPECTED_ISSUE_COUNT,
      distinctMappingCount: EXPECTED_ISSUE_COUNT,
      ambiguousMappingCount: EXPECTED_ISSUE_COUNT,
      canonicalIdCount: 0,
      waivedIssueCount,
      rejectedMappingCount,
      dependentSettlementAllocationCount: dependentRejectedSettlementAllocationCount,
      remainingOpenIssueCount,
      remainingAmbiguousCompensationMappingCount,
      legacyRowsBefore,
      legacyRowsAfter,
      canonicalRowsBefore,
      canonicalRowsAfter,
      integrityOk: integrityOk(database),
    });
  } finally {
    database.close();
  }

  const receipt: TrainingPeriodWaiverReceipt = {
    schemaVersion: 1,
    tenantId: APPROVED_TENANT_ID,
    authorizationId: options.authorizationId,
    approvedByPublicId: options.approvedByPublicId,
    resolutionCode: TRAINING_PERIOD_RESOLUTION_CODE,
    sourceDatabaseSha256: sha256File(sourceDatabasePath),
    sourceReceiptSha256,
    outputDatabaseSha256: sha256File(outputDatabasePath),
    issueCounts: counts,
    waivedIssueCount,
    directRejectedMappingCount,
    dependentRejectedSettlementAllocationCount,
    rejectedMappingCount,
    remainingOpenIssueCount,
    remainingAmbiguousCompensationMappingCount,
    legacyRowsMutated: Math.abs(legacyRowsAfter - legacyRowsBefore),
    canonicalCompensationRowsMutated: Math.abs(canonicalRowsAfter - canonicalRowsBefore),
    pendingReviewQueueCleared: readiness.queueCleared,
    canonicalCompensationAuthorityReady: false,
    legacyCompensationAuthorityRetained: true,
    issues: readiness.issues,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
  };
  writeFileSync(outputReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(outputReceiptPath, 0o600);
  return receipt;
}

function parseArgs(args: string[]): ApplyTrainingPeriodWaiverOptions {
  const values = new Map<string, string>();
  const allowed = new Set([
    '--source-database',
    '--source-receipt',
    '--source-receipt-sha256',
    '--output-directory',
    '--authorization-id',
    '--approved-by',
    '--now-utc',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') continue;
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  for (const key of allowed) if (!values.get(key)) throw new Error(`${key} is required`);
  return {
    sourceDatabasePath: values.get('--source-database')!,
    sourceReceiptPath: values.get('--source-receipt')!,
    expectedSourceReceiptSha256: values.get('--source-receipt-sha256')!,
    outputDirectory: values.get('--output-directory')!,
    authorizationId: values.get('--authorization-id')!,
    approvedByPublicId: values.get('--approved-by')!,
    nowUtc: values.get('--now-utc')!,
  };
}

function main(): void {
  try {
    const receipt = applyTenantCompensationTrainingWaivers(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (!receipt.pendingReviewQueueCleared) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
