import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  CDB101_REPORTING_IMPORT_TABLES,
  validateReportingCutoverAuthorization,
  type ReportingCutoverAuthorization,
} from './production-cutover-contract';
import {
  buildProductionCanonicalBundle,
  type ProductionCanonicalBundleReceipt,
} from './build-production-canonical-bundle';
import { parseReportingCutoverAuthorizationJson } from './reporting-cutover-authorization-document';

export interface ReportingNight0ForeignKeyCounts {
  billingDepositsToBills: number;
  incomeToBills: number;
  archivalToBills: number;
  archivalToVisits: number;
}

export interface PrepareReportingNight0Options {
  canonicalSourceDatabase: string;
  legacySourceDatabase: string;
  sourceExportPath: string;
  outputDirectory: string;
  candidateCommit: string;
  authorizationId: string;
  deterministicRunId: string;
  repositoryManifestSha256: string;
  workerDryRunSha256: string;
  repositoryRouteFingerprintSha256: string;
  allowedTables?: readonly string[];
  expectedForeignKeyCounts?: ReportingNight0ForeignKeyCounts;
}

export interface ReportingNight0Receipt {
  schemaVersion: 1;
  preparationReady: boolean;
  decision: 'no_go';
  activeFinancialViolationCount: number;
  archivalViolationCount: number;
  importTableCount: number;
  importRowCount: number;
  authorizationDocumentReady: boolean;
  authorizationExecutionReady: boolean;
  authorizationIssueCount: number;
  aggregateOnly: true;
  networkRequestPerformed: false;
  productionMutationPerformed: false;
  externalCommandPerformed: false;
  activeFkPlanPath: string;
  archivalWaiverPath: string;
  candidateBuildManifestPath: string;
  authorizationDraftPath: string;
  goNoGoPath: string;
  bundlePath: string;
  importManifestPath: string;
}

interface OrphanRow {
  row_id: number | bigint;
  tenant_id: string;
  original_reference: number | bigint;
}

const DEFAULT_COUNTS: ReportingNight0ForeignKeyCounts = {
  billingDepositsToBills: 4,
  incomeToBills: 4,
  archivalToBills: 26,
  archivalToVisits: 15,
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
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
  const repositoryRoot = resolve(process.cwd());
  if (absolute === repositoryRoot || absolute.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error('Night-0 protected output must remain outside the repository');
  }
  try {
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Night-0 output must be a regular directory');
    if ((stat.mode & 0o777) !== 0o700) throw new Error('Night-0 output directory must use mode 700');
    if (readdirSync(absolute).length !== 0) throw new Error('Night-0 output directory must be empty');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(absolute, { mode: 0o700 });
    chmodSync(absolute, 0o700);
  }
  return absolute;
}

function writeProtectedJson(path: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
  return sha256(text);
}

function queryOrphans(database: DatabaseSync, child: string, foreignKey: string): OrphanRow[] {
  const rows = database.prepare(`
    SELECT c.id AS row_id,
           CAST(c.tenant_id AS TEXT) AS tenant_id,
           c.${foreignKey} AS original_reference
    FROM ${child} c
    LEFT JOIN bills p ON p.id = c.${foreignKey}
    WHERE c.${foreignKey} IS NOT NULL
      AND p.id IS NULL
    ORDER BY CAST(c.tenant_id AS TEXT), c.id
  `).all() as unknown as OrphanRow[];
  return rows;
}

function countArchivalOrphans(database: DatabaseSync, parent: 'bills' | 'visits'): number {
  const column = parent === 'bills' ? 'bill_id' : 'visit_id';
  const row = database.prepare(`
    SELECT COUNT(*) AS count
    FROM doctor_commission_accruals_old_0391 c
    LEFT JOIN ${parent} p ON p.id = c.${column}
    WHERE c.${column} IS NOT NULL
      AND p.id IS NULL
  `).get() as { count: number };
  return Number(row.count);
}

function guardedRepairRows(
  rows: OrphanRow[],
  childTable: 'billing_deposits' | 'income',
  foreignKey: 'reference_bill_id' | 'bill_id',
): Array<{ rowKey: string; statement: string; bindings: [string, string, string] }> {
  return rows.map((row) => ({
    rowKey: String(row.row_id),
    statement: `UPDATE ${childTable} SET ${foreignKey} = NULL WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND ${foreignKey} = ?;`,
    bindings: [String(row.row_id), String(row.tenant_id), String(row.original_reference)],
  }));
}

function createActiveFkPlan(
  billingRows: OrphanRow[],
  incomeRows: OrphanRow[],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    tenantScope: 'all-observed-active-financial-rows',
    approved: false,
    approvalRequired: true,
    strategy: 'clear_orphan_reference_preserve_row',
    hardDelete: false,
    automaticParentRemap: false,
    observedViolationCount: billingRows.length + incomeRows.length,
    expectedRemainingViolationCountAfterExecution: 0,
    groups: [
      {
        childTable: 'billing_deposits',
        parentTable: 'bills',
        foreignKeyColumn: 'reference_bill_id',
        observedViolationCount: billingRows.length,
        replacementSelection: 'no_exact_replacement_selected',
        rows: guardedRepairRows(billingRows, 'billing_deposits', 'reference_bill_id'),
      },
      {
        childTable: 'income',
        parentTable: 'bills',
        foreignKeyColumn: 'bill_id',
        observedViolationCount: incomeRows.length,
        replacementSelection: 'no_exact_replacement_selected',
        rows: guardedRepairRows(incomeRows, 'income', 'bill_id'),
      },
    ],
  };
}

function createArchivalWaiver(
  toBills: number,
  toVisits: number,
  allowedTables: readonly string[],
): Record<string, unknown> {
  const importExcluded = !allowedTables.includes('doctor_commission_accruals_old_0391');
  return {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    approved: false,
    approvalRequired: true,
    childTable: 'doctor_commission_accruals_old_0391',
    archivalNameConfirmed: true,
    noRuntimeWriterAttested: false,
    canonicalReportingExcludedAttested: false,
    importExcluded,
    observedViolationCount: toBills + toVisits,
    removalPhase: 'legacy_retirement_p11',
    groups: [
      { parentTable: 'bills', violationCount: toBills },
      { parentTable: 'visits', violationCount: toVisits },
    ],
  };
}

function exactCounts(
  observed: ReportingNight0ForeignKeyCounts,
  expected: ReportingNight0ForeignKeyCounts,
): boolean {
  return (Object.keys(expected) as Array<keyof ReportingNight0ForeignKeyCounts>)
    .every((key) => observed[key] === expected[key]);
}

function candidateManifest(
  options: PrepareReportingNight0Options,
  bundle: ProductionCanonicalBundleReceipt,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    candidateCommit: options.candidateCommit,
    repositoryManifestSha256: options.repositoryManifestSha256,
    workerDryRunSha256: options.workerDryRunSha256,
    repositoryRouteFingerprintSha256: options.repositoryRouteFingerprintSha256,
    import: {
      bundleSha256: bundle.bundleSha256,
      manifestSha256: bundle.manifestSha256,
      sourceExportSha256: bundle.sourceExportSha256,
      deterministicRunId: bundle.deterministicRunId,
      tenantId: '100',
      tableCount: bundle.tableCount,
      rowCount: bundle.rowCount,
      rowCountSummary: bundle.rowCountSummary,
    },
    productionMutationPerformed: false,
  };
}

function authorizationDraft(
  options: PrepareReportingNight0Options,
  bundle: ProductionCanonicalBundleReceipt,
  candidateBuildManifestSha256: string,
  allowedTables: readonly string[],
): ReportingCutoverAuthorization {
  const template = JSON.parse(readFileSync(
    resolve(process.cwd(), 'docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json'),
    'utf8',
  )) as ReportingCutoverAuthorization;
  template.authorizationId = options.authorizationId;
  template.productionExecutionAuthorized = false;
  template.deployment.authorized = false;
  template.deployment.candidateCommit = options.candidateCommit;
  template.deployment.candidateWorkerVersionId = null;
  template.deployment.previousWorkerVersionId = null;
  template.deployment.buildManifestSha256 = candidateBuildManifestSha256;
  template.deployment.routeFingerprintSha256 = null;
  template.deployment.activeRoutesUnchangedEvidenceId = null;
  template.migrations.authorized = false;
  template.migrations.repositoryManifestSha256 = options.repositoryManifestSha256;
  template.migrations.commandId = null;
  template.productionImport.authorized = false;
  template.productionImport.commandApproved = false;
  template.productionImport.commandId = null;
  template.productionImport.bundleSha256 = bundle.bundleSha256;
  template.productionImport.manifestSha256 = bundle.manifestSha256;
  template.productionImport.sourceExportSha256 = bundle.sourceExportSha256;
  template.productionImport.allowedTables = [...allowedTables];
  template.productionImport.deterministicRunId = options.deterministicRunId;
  template.featureFlagPlan.authorized = false;
  template.featureFlagPlan.commandId = null;
  template.featureFlagPlan.effectiveAtUtc = null;
  template.featureFlagPlan.updatedByPublicId = null;
  template.exportEvidence.captured = false;
  template.foreignKeyDisposition.evidenceId = null;
  template.foreignKeyDisposition.evidenceSha256 = null;
  return template;
}

function withHiddenPaths(
  receipt: Omit<ReportingNight0Receipt,
    | 'activeFkPlanPath'
    | 'archivalWaiverPath'
    | 'candidateBuildManifestPath'
    | 'authorizationDraftPath'
    | 'goNoGoPath'
    | 'bundlePath'
    | 'importManifestPath'>,
  paths: Pick<ReportingNight0Receipt,
    | 'activeFkPlanPath'
    | 'archivalWaiverPath'
    | 'candidateBuildManifestPath'
    | 'authorizationDraftPath'
    | 'goNoGoPath'
    | 'bundlePath'
    | 'importManifestPath'>,
): ReportingNight0Receipt {
  const result = { ...receipt } as ReportingNight0Receipt;
  for (const [key, value] of Object.entries(paths)) {
    Object.defineProperty(result, key, { value, enumerable: false, writable: false });
  }
  return result;
}

export function prepareReportingNight0(options: PrepareReportingNight0Options): ReportingNight0Receipt {
  if (!/^[0-9a-f]{40}$/.test(options.candidateCommit)) throw new Error('candidateCommit must be a full commit hash');
  for (const [label, value] of Object.entries({
    repositoryManifestSha256: options.repositoryManifestSha256,
    workerDryRunSha256: options.workerDryRunSha256,
    repositoryRouteFingerprintSha256: options.repositoryRouteFingerprintSha256,
  })) {
    if (!isSha256(value)) throw new Error(`${label} must be SHA-256`);
  }
  const canonicalSource = resolve(options.canonicalSourceDatabase);
  const legacySource = resolve(options.legacySourceDatabase);
  const sourceExport = resolve(options.sourceExportPath);
  requireProtectedRegularFile(canonicalSource, 'Canonical source database');
  requireProtectedRegularFile(legacySource, 'Legacy source database');
  requireProtectedRegularFile(sourceExport, 'Source export');
  const allowedTables = [...(options.allowedTables ?? CDB101_REPORTING_IMPORT_TABLES)];
  const legacy = new DatabaseSync(legacySource, { readOnly: true });
  let billingRows: OrphanRow[];
  let incomeRows: OrphanRow[];
  let archivalToBills: number;
  let archivalToVisits: number;
  try {
    billingRows = queryOrphans(legacy, 'billing_deposits', 'reference_bill_id');
    incomeRows = queryOrphans(legacy, 'income', 'bill_id');
    archivalToBills = countArchivalOrphans(legacy, 'bills');
    archivalToVisits = countArchivalOrphans(legacy, 'visits');
  } finally {
    legacy.close();
  }
  const observedCounts: ReportingNight0ForeignKeyCounts = {
    billingDepositsToBills: billingRows.length,
    incomeToBills: incomeRows.length,
    archivalToBills,
    archivalToVisits,
  };
  if (!exactCounts(observedCounts, options.expectedForeignKeyCounts ?? DEFAULT_COUNTS)) {
    throw new Error(`Foreign key count drift: ${JSON.stringify(observedCounts)}`);
  }

  const outputDirectory = prepareOutputDirectory(options.outputDirectory);
  const importDirectory = resolve(outputDirectory, 'import');
  const bundle = buildProductionCanonicalBundle({
    sourceDatabase: canonicalSource,
    sourceExportPath: sourceExport,
    outputDirectory: importDirectory,
    authorizationId: options.authorizationId,
    deterministicRunId: options.deterministicRunId,
    allowedTables,
  });

  const activeFkPlanPath = resolve(outputDirectory, 'active-fk-repair-plan.json');
  const archivalWaiverPath = resolve(outputDirectory, 'archival-fk-waiver-candidate.json');
  writeProtectedJson(activeFkPlanPath, createActiveFkPlan(billingRows, incomeRows));
  writeProtectedJson(archivalWaiverPath, createArchivalWaiver(archivalToBills, archivalToVisits, allowedTables));

  const buildManifest = candidateManifest(options, bundle);
  const candidateBuildManifestPath = resolve(outputDirectory, 'candidate-build-manifest.json');
  const candidateBuildManifestSha256 = writeProtectedJson(candidateBuildManifestPath, buildManifest);
  const authorization = authorizationDraft(
    options,
    bundle,
    candidateBuildManifestSha256,
    allowedTables,
  );
  const authorizationDraftPath = resolve(outputDirectory, 'reporting-authorization-candidate.json');
  writeProtectedJson(authorizationDraftPath, authorization);
  const parsedAuthorization = parseReportingCutoverAuthorizationJson(readFileSync(authorizationDraftPath, 'utf8'));
  if (!parsedAuthorization.documentReady || !parsedAuthorization.authorization) {
    throw new Error('Generated authorization candidate is not structurally valid');
  }
  const semantic = validateReportingCutoverAuthorization(
    parsedAuthorization.authorization,
    new Date().toISOString(),
  );
  if (semantic.executionReady) throw new Error('Night-0 authorization candidate must remain fail-closed');

  const goNoGo = {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    decision: 'no_go',
    preparationReady: true,
    prepared: {
      latestMainIntegrated: true,
      candidateCommitFrozen: true,
      canonicalMigrationRangeRebased: true,
      canonicalImportBundleReady: true,
      activeFinancialRepairPlanReady: true,
      archivalWaiverCandidateReady: true,
      authorizationCandidateDocumentReady: true,
    },
    blockers: {
      ownerApprovalPresent: false,
      maintenanceWindowApproved: false,
      candidateWorkerVersionPresent: false,
      authenticatedRouteEvidencePresent: false,
      freshExportAndBookmarkPresent: false,
      activeFinancialRepairExecuted: false,
      archivalWaiverApproved: false,
      migrationsApplied: false,
      tenantImportExecuted: false,
      processingEvidenceReady: false,
      shadowFlagEnabled: false,
      smokeObservationAccepted: false,
    },
    activeFinancialViolationCount: billingRows.length + incomeRows.length,
    archivalViolationCount: archivalToBills + archivalToVisits,
    importTableCount: bundle.tableCount,
    importRowCount: bundle.rowCount,
    authorizationIssueCount: semantic.issues.length,
    productionMutationPerformed: false,
  };
  const goNoGoPath = resolve(outputDirectory, 'night0-go-no-go.json');
  writeProtectedJson(goNoGoPath, goNoGo);

  return withHiddenPaths({
    schemaVersion: 1,
    preparationReady: true,
    decision: 'no_go',
    activeFinancialViolationCount: billingRows.length + incomeRows.length,
    archivalViolationCount: archivalToBills + archivalToVisits,
    importTableCount: bundle.tableCount,
    importRowCount: bundle.rowCount,
    authorizationDocumentReady: true,
    authorizationExecutionReady: semantic.executionReady,
    authorizationIssueCount: semantic.issues.length,
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  }, {
    activeFkPlanPath,
    archivalWaiverPath,
    candidateBuildManifestPath,
    authorizationDraftPath,
    goNoGoPath,
    bundlePath: bundle.bundlePath,
    importManifestPath: bundle.manifestPath,
  });
}

export function parseReportingNight0Args(args: string[]): PrepareReportingNight0Options {
  const allowed = new Set([
    '--canonical-source-database',
    '--legacy-source-database',
    '--source-export',
    '--output-directory',
    '--candidate-commit',
    '--authorization-id',
    '--deterministic-run-id',
    '--repository-manifest-sha256',
    '--worker-dry-run-sha256',
    '--repository-route-fingerprint-sha256',
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
  for (const key of allowed) if (!values[key]) throw new Error(`${key} is required`);
  return {
    canonicalSourceDatabase: values['--canonical-source-database'],
    legacySourceDatabase: values['--legacy-source-database'],
    sourceExportPath: values['--source-export'],
    outputDirectory: values['--output-directory'],
    candidateCommit: values['--candidate-commit'],
    authorizationId: values['--authorization-id'],
    deterministicRunId: values['--deterministic-run-id'],
    repositoryManifestSha256: values['--repository-manifest-sha256'],
    workerDryRunSha256: values['--worker-dry-run-sha256'],
    repositoryRouteFingerprintSha256: values['--repository-route-fingerprint-sha256'],
  };
}

function main(): void {
  try {
    const receipt = prepareReportingNight0(parseReportingNight0Args(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CDB-101 Night-0 preparation failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
