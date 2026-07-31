import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type GovernanceIssueCode =
  | 'GOV_CANONICAL_REAL_MONEY'
  | 'GOV_TENANT_ID_REQUIRED'
  | 'GOV_GENERIC_REFERENCE'
  | 'GOV_DIRECT_LEGACY_WRITE'
  | 'GOV_DESTRUCTIVE_SQL_UNAPPROVED'
  | 'GOV_SCHEMA_REGISTRY_DRIFT'
  | 'GOV_DUPLICATE_MIGRATION_NUMBER'
  | 'GOV_METRIC_CONTRACT_MISSING'
  | 'GOV_LEGACY_ALLOWLIST_INCOMPLETE'
  | 'GOV_FINANCIAL_COMMAND_CONTRACT'
  | 'GOV_REGISTRY_INVALID';

export interface GovernanceIssue {
  code: GovernanceIssueCode;
  path: string;
  subject: string;
  message: string;
}

export interface GovernanceResult {
  ok: boolean;
  issues: GovernanceIssue[];
}

interface CanonicalTableContract {
  name: string;
  tenantOwned: boolean;
  schemaModule: string;
  authority: string;
  nonMoneyRealColumns?: string[];
}

interface MetricContract {
  key: string;
  source: string;
}

interface FinancialCommandContract {
  path: string;
  owner: string;
}

interface CanonicalRegistry {
  version: number;
  governanceStartMigration: number;
  canonicalTables: CanonicalTableContract[];
  metrics: MetricContract[];
  financialCommands: FinancialCommandContract[];
}

interface LegacyTableDisposition {
  name: string;
  owner: string;
  disposition: string;
  writePolicy: 'allowed_until_cutover' | 'forbidden';
  removalPhase: string;
  reason: string;
}

type DirectWriteLifecycleStatus =
  | 'legacy_authority'
  | 'canonical_compatibility'
  | 'protected_fixture';

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

interface DestructiveMigrationApproval {
  filename: string;
  owner: string;
  removalPhase: string;
  reason: string;
}

interface DuplicateMigrationNumberApproval {
  number: number;
  filenames: string[];
  owner: string;
  reason: string;
  recordedAtUtc: string;
}

interface LegacyRegistry {
  version: number;
  tables: LegacyTableDisposition[];
  directWriteAllowlist: DirectWriteAllowance[];
  duplicateMigrationNumbers?: DuplicateMigrationNumberApproval[];
  destructiveMigrations: DestructiveMigrationApproval[];
}

interface MigrationFile {
  filename: string;
  path: string;
  number: number;
  sql: string;
}

interface CanonicalTableSql {
  name: string;
  body: string;
  path: string;
}

const MIGRATION_RE = /^(\d{4})(?:[dD])?_[a-z0-9_]+\.sql$/i;
const MONEY_COLUMN_RE = /(?:^|_)(?:amount|total|subtotal|discount|tax|paid|due|balance|price|cost|debit|credit|payable|receivable|rate|value)(?:_|$)|_minor$/i;
const DESTRUCTIVE_SQL_RE = /\b(?:DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE[\s\S]{0,160}\b(?:DROP\s+COLUMN|RENAME\s+TO|RENAME\s+COLUMN)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function listFiles(root: string, extensions?: Set<string>): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name === 'node_modules' || name === '.git' || name === '.worktrees' || name === '.generated') continue;
      const path = join(directory, name);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else if (!extensions || extensions.has(name.slice(name.lastIndexOf('.')))) output.push(path);
    }
  };
  visit(root);
  return output;
}

function readJsonYaml<T>(root: string, relativePath: string, issues: GovernanceIssue[]): T | null {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    issues.push({
      code: 'GOV_REGISTRY_INVALID',
      path: relativePath,
      subject: relativePath,
      message: 'Required governance registry is missing.',
    });
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    issues.push({
      code: 'GOV_REGISTRY_INVALID',
      path: relativePath,
      subject: relativePath,
      message: `Registry must be JSON-compatible YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

function addIssue(issues: GovernanceIssue[], issue: GovernanceIssue): void {
  const key = `${issue.code}\u0000${issue.path}\u0000${issue.subject}\u0000${issue.message}`;
  if (!issues.some((candidate) => `${candidate.code}\u0000${candidate.path}\u0000${candidate.subject}\u0000${candidate.message}` === key)) {
    issues.push(issue);
  }
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function listGovernedMigrations(root: string, start: number): MigrationFile[] {
  const directory = join(root, 'migrations');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((filename) => MIGRATION_RE.test(filename))
    .map((filename) => {
      const match = MIGRATION_RE.exec(filename)!;
      return {
        filename,
        path: normalizePath(relative(root, join(directory, filename))),
        number: Number(match[1]),
        sql: readFileSync(join(directory, filename), 'utf8'),
      };
    })
    .filter((migration) => migration.number >= start)
    .sort((a, b) => a.number - b.number || a.filename.localeCompare(b.filename));
}

function findClosingParenthesis(sql: string, openingIndex: number): number {
  let depth = 1;
  let quote: "'" | '"' | '`' | null = null;
  for (let index = openingIndex + 1; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractCanonicalTables(migrations: MigrationFile[]): CanonicalTableSql[] {
  const tables: CanonicalTableSql[] = [];
  const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z0-9_]+)["`]?\s*\(/gi;
  for (const migration of migrations) {
    const sql = stripSqlComments(migration.sql);
    let match: RegExpExecArray | null;
    while ((match = createTable.exec(sql)) !== null) {
      const name = match[1];
      const openingIndex = createTable.lastIndex - 1;
      const closingIndex = findClosingParenthesis(sql, openingIndex);
      if (closingIndex < 0) continue;
      if (name.startsWith('canonical_')) {
        tables.push({ name, body: sql.slice(openingIndex + 1, closingIndex), path: migration.path });
      }
      createTable.lastIndex = closingIndex + 1;
    }
  }
  return tables;
}

function validateRegistryShapes(
  canonical: CanonicalRegistry | null,
  legacy: LegacyRegistry | null,
  issues: GovernanceIssue[],
): void {
  if (canonical) {
    if (!Number.isInteger(canonical.version) || !Number.isInteger(canonical.governanceStartMigration)) {
      addIssue(issues, {
        code: 'GOV_REGISTRY_INVALID',
        path: 'docs/database/canonical-source-of-truth.yaml',
        subject: 'canonical registry',
        message: 'version and governanceStartMigration must be integers.',
      });
    }
    if (!Array.isArray(canonical.canonicalTables) || !Array.isArray(canonical.metrics) || !Array.isArray(canonical.financialCommands)) {
      addIssue(issues, {
        code: 'GOV_REGISTRY_INVALID',
        path: 'docs/database/canonical-source-of-truth.yaml',
        subject: 'canonical registry',
        message: 'canonicalTables, metrics, and financialCommands must be arrays.',
      });
    } else {
      const tableNames = new Set<string>();
      for (const table of canonical.canonicalTables) {
        const duplicate = nonEmpty(table.name) && tableNames.has(table.name.toLowerCase());
        if (
          !nonEmpty(table.name)
          || typeof table.tenantOwned !== 'boolean'
          || !nonEmpty(table.schemaModule)
          || !nonEmpty(table.authority)
          || duplicate
        ) {
          addIssue(issues, {
            code: 'GOV_REGISTRY_INVALID',
            path: 'docs/database/canonical-source-of-truth.yaml',
            subject: table.name || '<unnamed canonical table>',
            message: 'Canonical table contracts require a unique name, boolean tenantOwned, schemaModule, and authority.',
          });
        }
        if (nonEmpty(table.name)) tableNames.add(table.name.toLowerCase());
      }
    }
  }
  if (
    legacy
    && (
      !Array.isArray(legacy.tables)
      || !Array.isArray(legacy.directWriteAllowlist)
      || (legacy.duplicateMigrationNumbers != null && !Array.isArray(legacy.duplicateMigrationNumbers))
      || !Array.isArray(legacy.destructiveMigrations)
    )
  ) {
    addIssue(issues, {
      code: 'GOV_REGISTRY_INVALID',
      path: 'docs/database/legacy-table-disposition.yaml',
      subject: 'legacy registry',
      message: 'tables, directWriteAllowlist, duplicateMigrationNumbers, and destructiveMigrations must be arrays when present.',
    });
  }
}

function checkLegacyEntries(root: string, legacy: LegacyRegistry, issues: GovernanceIssue[]): void {
  const required = ['owner', 'removalPhase', 'reason'] as const;
  const validDispositions = new Set(['active_legacy', 'shadowed', 'backfilled', 'reconciled', 'read_only', 'compatibility_view', 'archived', 'removed']);
  const validWritePolicies = new Set(['allowed_until_cutover', 'forbidden']);
  const tableNames = new Set<string>();
  for (const table of legacy.tables ?? []) {
    if (nonEmpty(table.name)) tableNames.add(table.name.toLowerCase());
    if (
      !nonEmpty(table.name)
      || !nonEmpty(table.disposition)
      || !validDispositions.has(table.disposition)
      || !nonEmpty(table.writePolicy)
      || !validWritePolicies.has(table.writePolicy)
      || required.some((key) => !nonEmpty(table[key]))
    ) {
      addIssue(issues, {
        code: 'GOV_LEGACY_ALLOWLIST_INCOMPLETE',
        path: 'docs/database/legacy-table-disposition.yaml',
        subject: table.name || '<unnamed legacy table>',
        message: 'Legacy table entries require name, owner, valid disposition/writePolicy, removalPhase, and reason.',
      });
    }
  }
  const allowanceKeys = new Set<string>();
  const validLifecycleStatuses = new Set<DirectWriteLifecycleStatus>([
    'legacy_authority',
    'canonical_compatibility',
    'protected_fixture',
  ]);
  const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  for (const allowance of legacy.directWriteAllowlist ?? []) {
    const normalizedPath = nonEmpty(allowance.path) ? normalizePath(allowance.path) : '';
    const allowanceKey = `${normalizedPath}\u0000${nonEmpty(allowance.table) ? allowance.table.toLowerCase() : ''}`;
    const invalid =
      !nonEmpty(allowance.path)
      || !nonEmpty(allowance.table)
      || allowance.path.includes('*')
      || allowance.table.includes('*')
      || !existsSync(join(root, allowance.path))
      || !tableNames.has(allowance.table.toLowerCase())
      || allowanceKeys.has(allowanceKey)
      || required.some((key) => !nonEmpty(allowance[key]))
      || !nonEmpty(allowance.lifecycleStatus)
      || !validLifecycleStatuses.has(allowance.lifecycleStatus)
      || !nonEmpty(allowance.retirementBlocker)
      || !nonEmpty(allowance.retirementTask)
      || !nonEmpty(allowance.reviewedAtUtc)
      || !utcTimestampPattern.test(allowance.reviewedAtUtc);
    if (invalid) {
      addIssue(issues, {
        code: 'GOV_LEGACY_ALLOWLIST_INCOMPLETE',
        path: 'docs/database/legacy-table-disposition.yaml',
        subject: `${allowance.path || '<path>'}:${allowance.table || '<table>'}`,
        message: 'Direct-write allowances require exact path/table scope, owner, removalPhase, reason, lifecycleStatus, retirementBlocker, retirementTask, reviewedAtUtc, and no duplicate or wildcard scope.',
      });
    }
    allowanceKeys.add(allowanceKey);
  }
  const duplicateApprovalNumbers = new Set<number>();
  for (const approval of legacy.duplicateMigrationNumbers ?? []) {
    const filenames = Array.isArray(approval.filenames) ? approval.filenames : [];
    const uniqueFilenames = new Set(filenames);
    const invalid =
      !Number.isInteger(approval.number)
      || approval.number < 0
      || filenames.length < 2
      || uniqueFilenames.size !== filenames.length
      || filenames.some((filename) => {
        if (!nonEmpty(filename)) return true;
        const match = MIGRATION_RE.exec(filename);
        return !match || Number(match[1]) !== approval.number;
      })
      || !nonEmpty(approval.owner)
      || !nonEmpty(approval.reason)
      || !nonEmpty(approval.recordedAtUtc)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(approval.recordedAtUtc)
      || duplicateApprovalNumbers.has(approval.number);
    if (invalid) {
      addIssue(issues, {
        code: 'GOV_LEGACY_ALLOWLIST_INCOMPLETE',
        path: 'docs/database/legacy-table-disposition.yaml',
        subject: Number.isInteger(approval.number) ? String(approval.number).padStart(4, '0') : '<invalid migration number>',
        message: 'Duplicate migration-number approvals require one unique number, at least two exact matching filenames, owner, reason, and a UTC evidence timestamp.',
      });
    }
    if (Number.isInteger(approval.number)) duplicateApprovalNumbers.add(approval.number);
  }
  for (const approval of legacy.destructiveMigrations ?? []) {
    if (!nonEmpty(approval.filename) || required.some((key) => !nonEmpty(approval[key]))) {
      addIssue(issues, {
        code: 'GOV_LEGACY_ALLOWLIST_INCOMPLETE',
        path: 'docs/database/legacy-table-disposition.yaml',
        subject: approval.filename || '<unnamed destructive migration>',
        message: 'Destructive migration approvals require filename, owner, removalPhase, and reason.',
      });
    }
  }
}

function checkCanonicalTables(
  root: string,
  registry: CanonicalRegistry,
  tables: CanonicalTableSql[],
  issues: GovernanceIssue[],
): void {
  const registered = new Map((registry.canonicalTables ?? []).map((table) => [table.name, table]));
  const created = new Map(tables.map((table) => [table.name, table]));
  const canonicalBarrelPath = 'src/db/schema/canonical/index.ts';
  const rootBarrelPath = 'src/db/schema/index.ts';
  const canonicalBarrel = existsSync(join(root, canonicalBarrelPath)) ? readFileSync(join(root, canonicalBarrelPath), 'utf8') : '';
  const rootBarrel = existsSync(join(root, rootBarrelPath)) ? readFileSync(join(root, rootBarrelPath), 'utf8') : '';
  const scannedSchemaModules = new Set<string>();
  const approvedNonMoneyRealColumnsByModule = new Map<string, Set<string>>();
  for (const contract of registry.canonicalTables ?? []) {
    const approved = approvedNonMoneyRealColumnsByModule.get(contract.schemaModule) ?? new Set<string>();
    for (const column of contract.nonMoneyRealColumns ?? []) approved.add(column);
    approvedNonMoneyRealColumnsByModule.set(contract.schemaModule, approved);
  }

  if (!/export\s+\*\s+from\s+['"]\.\/canonical['"]/.test(rootBarrel)) {
    addIssue(issues, {
      code: 'GOV_SCHEMA_REGISTRY_DRIFT',
      path: rootBarrelPath,
      subject: 'canonical schema barrel',
      message: 'Root schema barrel must export ./canonical.',
    });
  }

  for (const table of tables) {
    const contract = registered.get(table.name);
    if (!contract) {
      addIssue(issues, {
        code: 'GOV_SCHEMA_REGISTRY_DRIFT',
        path: table.path,
        subject: table.name,
        message: 'Canonical migration table is absent from canonical-source-of-truth.yaml.',
      });
      continue;
    }
    if (contract.tenantOwned && !/\btenant_id\s+TEXT\s+NOT\s+NULL\b/i.test(table.body)) {
      addIssue(issues, {
        code: 'GOV_TENANT_ID_REQUIRED',
        path: table.path,
        subject: table.name,
        message: 'Tenant-owned canonical table must declare tenant_id TEXT NOT NULL.',
      });
    }

    const approvedNonMoneyRealColumns = new Set(contract.nonMoneyRealColumns ?? []);
    const realColumn = /(?:^|,)\s*["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+REAL\b/gi;
    for (const match of table.body.matchAll(realColumn)) {
      if (MONEY_COLUMN_RE.test(match[1]) && !approvedNonMoneyRealColumns.has(match[1])) {
        addIssue(issues, {
          code: 'GOV_CANONICAL_REAL_MONEY',
          path: table.path,
          subject: `${table.name}.${match[1]}`,
          message: 'Canonical money-like columns must use integer minor units, not REAL.',
        });
      }
    }
    if (/\breference_id\b/i.test(table.body)) {
      addIssue(issues, {
        code: 'GOV_GENERIC_REFERENCE',
        path: table.path,
        subject: table.name,
        message: 'Generic reference_id columns are forbidden; use typed source/entity relationships.',
      });
    }
  }

  for (const contract of registry.canonicalTables ?? []) {
    const migrationTable = created.get(contract.name);
    if (!migrationTable) {
      addIssue(issues, {
        code: 'GOV_SCHEMA_REGISTRY_DRIFT',
        path: 'docs/database/canonical-source-of-truth.yaml',
        subject: contract.name,
        message: 'Registered canonical table is not created by a governed migration.',
      });
    }
    if (!nonEmpty(contract.authority) || !nonEmpty(contract.schemaModule)) {
      addIssue(issues, {
        code: 'GOV_REGISTRY_INVALID',
        path: 'docs/database/canonical-source-of-truth.yaml',
        subject: contract.name,
        message: 'Canonical table contracts require authority and schemaModule.',
      });
      continue;
    }
    const modulePath = join(root, contract.schemaModule);
    const moduleText = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';
    const moduleBase = basename(contract.schemaModule, '.ts');
    if (!scannedSchemaModules.has(contract.schemaModule)) {
      scannedSchemaModules.add(contract.schemaModule);
      const approvedNonMoneyRealColumns = approvedNonMoneyRealColumnsByModule.get(contract.schemaModule) ?? new Set<string>();
      const realDeclaration = /\breal\s*\(\s*['"]([^'"]+)['"]/gi;
      for (const match of moduleText.matchAll(realDeclaration)) {
        if (MONEY_COLUMN_RE.test(match[1]) && !approvedNonMoneyRealColumns.has(match[1])) {
          addIssue(issues, {
            code: 'GOV_CANONICAL_REAL_MONEY',
            path: contract.schemaModule,
            subject: match[1],
            message: 'Canonical Drizzle money-like columns must use integer minor units, not real().',
          });
        }
      }
      if (/\b(?:text|integer|real)\s*\(\s*['"]reference_id['"]/i.test(moduleText)) {
        addIssue(issues, {
          code: 'GOV_GENERIC_REFERENCE',
          path: contract.schemaModule,
          subject: 'reference_id',
          message: 'Generic reference_id declarations are forbidden in canonical schema modules.',
        });
      }
    }
    if (!moduleText.includes(`'${contract.name}'`) && !moduleText.includes(`"${contract.name}"`)) {
      addIssue(issues, {
        code: 'GOV_SCHEMA_REGISTRY_DRIFT',
        path: contract.schemaModule,
        subject: contract.name,
        message: 'Canonical schema module does not declare the registered table.',
      });
    }
    const exportPattern = new RegExp(`export\\s+\\*\\s+from\\s+['"]\\./${moduleBase}['"]`);
    if (!exportPattern.test(canonicalBarrel)) {
      addIssue(issues, {
        code: 'GOV_SCHEMA_REGISTRY_DRIFT',
        path: canonicalBarrelPath,
        subject: contract.schemaModule,
        message: 'Canonical schema module is not exported by the canonical barrel.',
      });
    }
  }
}

function checkMigrations(
  migrations: MigrationFile[],
  legacy: LegacyRegistry,
  issues: GovernanceIssue[],
): void {
  const byNumber = new Map<number, MigrationFile[]>();
  for (const migration of migrations) {
    const list = byNumber.get(migration.number) ?? [];
    list.push(migration);
    byNumber.set(migration.number, list);
  }
  const approvedDuplicates = new Map<number, string>();
  for (const approval of legacy.duplicateMigrationNumbers ?? []) {
    if (
      Number.isInteger(approval.number)
      && Array.isArray(approval.filenames)
      && approval.filenames.length >= 2
      && new Set(approval.filenames).size === approval.filenames.length
      && approval.filenames.every((filename) => {
        const match = nonEmpty(filename) ? MIGRATION_RE.exec(filename) : null;
        return match != null && Number(match[1]) === approval.number;
      })
      && nonEmpty(approval.owner)
      && nonEmpty(approval.reason)
      && nonEmpty(approval.recordedAtUtc)
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(approval.recordedAtUtc)
    ) {
      approvedDuplicates.set(approval.number, [...approval.filenames].sort().join('\u0000'));
    }
  }
  for (const [number, files] of byNumber) {
    if (files.length > 1) {
      const actual = files.map((file) => file.filename).sort().join('\u0000');
      if (approvedDuplicates.get(number) === actual) continue;
      addIssue(issues, {
        code: 'GOV_DUPLICATE_MIGRATION_NUMBER',
        path: 'migrations',
        subject: String(number).padStart(4, '0'),
        message: `Governed migration number is duplicated: ${files.map((file) => file.filename).join(', ')}.`,
      });
    }
  }

  const approvals = new Set(
    (legacy.destructiveMigrations ?? [])
      .filter((entry) => nonEmpty(entry.filename) && nonEmpty(entry.owner) && nonEmpty(entry.removalPhase) && nonEmpty(entry.reason))
      .map((entry) => entry.filename),
  );
  for (const migration of migrations) {
    if (DESTRUCTIVE_SQL_RE.test(stripSqlComments(migration.sql)) && !approvals.has(migration.filename)) {
      addIssue(issues, {
        code: 'GOV_DESTRUCTIVE_SQL_UNAPPROVED',
        path: migration.path,
        subject: migration.filename,
        message: 'Destructive governed migration requires an explicit owner/removal-phase approval.',
      });
    }
  }
}

function checkLegacyWrites(root: string, legacy: LegacyRegistry, issues: GovernanceIssue[]): void {
  const registeredTables = (legacy.tables ?? []).filter((table) => nonEmpty(table.name));
  if (registeredTables.length === 0) return;
  const validLifecycleStatuses = new Set<DirectWriteLifecycleStatus>([
    'legacy_authority',
    'canonical_compatibility',
    'protected_fixture',
  ]);
  const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
  const validAllowances = (legacy.directWriteAllowlist ?? []).filter(
    (entry) => nonEmpty(entry.path)
      && nonEmpty(entry.table)
      && nonEmpty(entry.owner)
      && nonEmpty(entry.removalPhase)
      && nonEmpty(entry.reason)
      && nonEmpty(entry.lifecycleStatus)
      && validLifecycleStatuses.has(entry.lifecycleStatus)
      && nonEmpty(entry.retirementBlocker)
      && nonEmpty(entry.retirementTask)
      && nonEmpty(entry.reviewedAtUtc)
      && utcTimestampPattern.test(entry.reviewedAtUtc),
  );
  const allowances = new Set(
    validAllowances.map((entry) => `${normalizePath(entry.path)}\u0000${entry.table.toLowerCase()}`),
  );
  const usedAllowances = new Set<string>();
  for (const path of listFiles(join(root, 'src'), new Set(['.ts', '.tsx', '.js', '.mjs']))) {
    const rel = normalizePath(relative(root, path));
    const text = readFileSync(path, 'utf8');
    for (const table of registeredTables) {
      const escapedTable = table.name.replace(/[.*+?^${}()|[\]\\]/g, (character) => `\\${character}`);
      const writePattern = new RegExp(
        '\\b(?:INSERT\\s+INTO|REPLACE\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+[\\"\'`]?'
          + escapedTable
          + '\\b',
        'i',
      );
      if (writePattern.test(text)) {
        const allowanceKey = `${rel}\u0000${table.name.toLowerCase()}`;
        if (allowances.has(allowanceKey)) {
          usedAllowances.add(allowanceKey);
        } else {
          addIssue(issues, {
            code: 'GOV_DIRECT_LEGACY_WRITE',
            path: rel,
            subject: table.name,
            message: 'Active code writes to a registered legacy table without an exact path-and-table allowance.',
          });
        }
      }
    }
  }
  for (const allowance of validAllowances) {
    const allowanceKey = `${normalizePath(allowance.path)}\u0000${allowance.table.toLowerCase()}`;
    if (!usedAllowances.has(allowanceKey)) {
      addIssue(issues, {
        code: 'GOV_LEGACY_ALLOWLIST_INCOMPLETE',
        path: 'docs/database/legacy-table-disposition.yaml',
        subject: `${allowance.path}:${allowance.table}`,
        message: 'Direct-write allowance is stale because the exact path no longer writes the registered legacy table.',
      });
    }
  }
}

function checkMetricsAndCommands(root: string, registry: CanonicalRegistry, issues: GovernanceIssue[]): void {
  const metricContracts = new Set((registry.metrics ?? []).filter((entry) => nonEmpty(entry.key) && nonEmpty(entry.source)).map((entry) => entry.key));
  const metricPattern = /canonicalMetric\s*\(\s*['"]([^'"]+)['"]|CANONICAL_METRIC:\s*([A-Za-z0-9_.:-]+)/g;
  for (const path of listFiles(join(root, 'src'), new Set(['.ts', '.tsx', '.js', '.mjs']))) {
    const rel = normalizePath(relative(root, path));
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(metricPattern)) {
      const key = match[1] ?? match[2];
      if (!metricContracts.has(key)) {
        addIssue(issues, {
          code: 'GOV_METRIC_CONTRACT_MISSING',
          path: rel,
          subject: key,
          message: 'Canonical metric usage is missing from the metric contract registry.',
        });
      }
    }
  }

  for (const command of registry.financialCommands ?? []) {
    const path = join(root, command.path);
    const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (
      !nonEmpty(command.path)
      || !nonEmpty(command.owner)
      || !content.includes('runCanonicalBatch')
      || !content.includes('idempotencyKey')
      || !content.includes('event')
    ) {
      addIssue(issues, {
        code: 'GOV_FINANCIAL_COMMAND_CONTRACT',
        path: command.path || 'docs/database/canonical-source-of-truth.yaml',
        subject: command.path || '<unnamed financial command>',
        message: 'Registered financial commands require owner, runCanonicalBatch, idempotencyKey, and event evidence.',
      });
    }
  }
}

export function checkSchemaGovernance(input: { root: string }): GovernanceResult {
  const root = resolve(input.root);
  const issues: GovernanceIssue[] = [];
  const canonical = readJsonYaml<CanonicalRegistry>(root, 'docs/database/canonical-source-of-truth.yaml', issues);
  const legacy = readJsonYaml<LegacyRegistry>(root, 'docs/database/legacy-table-disposition.yaml', issues);
  validateRegistryShapes(canonical, legacy, issues);

  if (canonical && legacy && Array.isArray(canonical.canonicalTables) && Array.isArray(legacy.tables)) {
    checkLegacyEntries(root, legacy, issues);
    const migrations = listGovernedMigrations(root, canonical.governanceStartMigration);
    const tables = extractCanonicalTables(migrations);
    checkMigrations(migrations, legacy, issues);
    checkCanonicalTables(root, canonical, tables, issues);
    checkLegacyWrites(root, legacy, issues);
    checkMetricsAndCommands(root, canonical, issues);
  }

  issues.sort((a, b) => a.code.localeCompare(b.code) || a.path.localeCompare(b.path) || a.subject.localeCompare(b.subject) || a.message.localeCompare(b.message));
  return { ok: issues.length === 0, issues };
}

export function assertSchemaGovernance(input: { root: string }): void {
  const result = checkSchemaGovernance(input);
  if (!result.ok) {
    const summary = result.issues.map((issue) => `${issue.code} ${issue.path} [${issue.subject}] ${issue.message}`).join('\n');
    throw new Error(`Canonical schema governance failed with ${result.issues.length} issue(s):\n${summary}`);
  }
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const result = checkSchemaGovernance({ root });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`${issue.code} ${issue.path} [${issue.subject}] ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('Canonical schema governance passed with 0 issues.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
