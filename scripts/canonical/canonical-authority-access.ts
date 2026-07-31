import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import type {
  AuthorityMatrix,
  AuthorityMatrixConcept,
  CanonicalSourceRegistry,
  LegacyDispositionRegistry,
} from './check-canonical-authority';

export type AccessDetectionMethod = 'raw_sql' | 'drizzle';
export type WriterOperation = 'insert' | 'replace' | 'update' | 'delete';
export type ReaderOperation = 'from' | 'join';
export type WriterLifecycleStatus =
  | 'canonical_authority'
  | 'canonical_compatibility'
  | 'legacy_authority'
  | 'protected_fixture'
  | 'migration_backfill'
  | 'blocked_in_canonical_mode'
  | 'retirement_candidate';
export type ReaderProviderStatus =
  | 'canonical'
  | 'shadow'
  | 'legacy'
  | 'compatibility'
  | 'external';

export interface AuthorityAccessScanPolicy {
  roots: string[];
  extensions: string[];
  excludedDirectories: string[];
  excludedPathFragments: string[];
  rawSqlWriterOperations: string[];
  rawSqlReaderOperations: string[];
  drizzleWriterOperations: string[];
  drizzleReaderOperations: string[];
  commentsExcluded: boolean;
  migrationsExcluded: boolean;
  testsExcluded: boolean;
}

export interface AuthorityWriterAccess {
  path: string;
  table: string;
  operations: WriterOperation[];
  detectionMethods: AccessDetectionMethod[];
  conceptIds: string[];
  domains: string[];
  owner: string;
  lifecycleStatus: WriterLifecycleStatus;
  retirementBlocker: string;
  targetCommand: string;
}

export interface AuthorityReaderAccess {
  path: string;
  table: string;
  operations: ReaderOperation[];
  detectionMethods: AccessDetectionMethod[];
  conceptIds: string[];
  domains: string[];
  owner: string;
  providerStatus: ReaderProviderStatus;
  retirementBlocker: string;
  targetProvider: string;
}

export interface AuthorityAccessSummary {
  governedTableCount: number;
  matrixSourceTableCount: number;
  canonicalTableCount: number;
  legacyDispositionTableCount: number;
  writerCount: number;
  readerCount: number;
  writerStatusCounts: Record<WriterLifecycleStatus, number>;
  readerStatusCounts: Record<ReaderProviderStatus, number>;
  tablesWithWriters: number;
  tablesWithReaders: number;
  tablesWithoutWriters: number;
  tablesWithoutReaders: number;
}

export interface CanonicalAuthorityAccessRegistry {
  version: number;
  program: string;
  scope: string;
  reviewedAt: string;
  branch: string;
  sourceDocuments: string[];
  scanPolicy: AuthorityAccessScanPolicy;
  summary: AuthorityAccessSummary;
  coverage: {
    governedTables: string[];
    tablesWithoutWriters: string[];
    tablesWithoutReaders: string[];
  };
  writers: AuthorityWriterAccess[];
  readers: AuthorityReaderAccess[];
  knownLimitations: string[];
  safety: {
    productionMutationAuthorized: boolean;
    productionMutationPerformed: boolean;
    localSyncExpansionPaused: boolean;
    legacyRetirementAuthorized: boolean;
  };
}

export interface CanonicalAuthorityAccessContext {
  root: string;
  matrix: AuthorityMatrix;
  canonicalRegistry: CanonicalSourceRegistry;
  legacyRegistry: LegacyDispositionRegistry;
  governedTables: string[];
  matrixSourceTables: string[];
  canonicalTables: Set<string>;
  externalTargetTables: Set<string>;
  tableConceptIds: Map<string, string[]>;
  conceptDomains: Map<string, string>;
  concepts: Map<string, AuthorityMatrixConcept>;
}

export interface BuildCanonicalAuthorityAccessRegistryInput {
  root: string;
  reviewedAt?: string;
  matrix?: AuthorityMatrix;
  canonicalRegistry?: CanonicalSourceRegistry;
  legacyRegistry?: LegacyDispositionRegistry;
}

const MATRIX_PATH = 'docs/database/canonical-authority-matrix.yaml';
const CANONICAL_REGISTRY_PATH = 'docs/database/canonical-source-of-truth.yaml';
const LEGACY_REGISTRY_PATH = 'docs/database/legacy-table-disposition.yaml';
export const DEFAULT_ACCESS_REGISTRY_REVIEWED_AT = '2026-07-26T12:46:00+06:00';

export const AUTHORITY_ACCESS_SCAN_POLICY: AuthorityAccessScanPolicy = {
  roots: ['src', 'scripts/canonical'],
  extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
  excludedDirectories: [
    '.git',
    '.next',
    '.turbo',
    '.wrangler',
    '.worktrees',
    'build',
    'coverage',
    'dist',
    'node_modules',
  ],
  excludedPathFragments: [
    '.generated.',
    '/generated/',
    'src/data/schema-migrations.generated.ts',
  ],
  rawSqlWriterOperations: ['insert', 'replace', 'update', 'delete'],
  rawSqlReaderOperations: ['from', 'join'],
  drizzleWriterOperations: ['insert', 'update', 'delete'],
  drizzleReaderOperations: ['from', 'leftJoin', 'innerJoin', 'rightJoin', 'fullJoin'],
  commentsExcluded: true,
  migrationsExcluded: true,
  testsExcluded: true,
};

const WRITER_STATUSES: WriterLifecycleStatus[] = [
  'canonical_authority',
  'canonical_compatibility',
  'legacy_authority',
  'protected_fixture',
  'migration_backfill',
  'blocked_in_canonical_mode',
  'retirement_candidate',
];
const READER_STATUSES: ReaderProviderStatus[] = [
  'canonical',
  'shadow',
  'legacy',
  'compatibility',
  'external',
];

function readJson<T>(root: string, relativePath: string): T {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`Required authority document is missing: ${relativePath}`);
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
}

export function normalizeRepositoryPath(value: string): string {
  return normalize(value).split(sep).join('/').replace(/^\.\//, '');
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);
}

function listFiles(root: string, relativeRoot: string): string[] {
  const absoluteRoot = join(root, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const files: string[] = [];
  const excludedDirectories = new Set(AUTHORITY_ACCESS_SCAN_POLICY.excludedDirectories);
  const allowedExtensions = new Set(AUTHORITY_ACCESS_SCAN_POLICY.extensions);

  function walk(directory: string): void {
    for (const entry of readdirSync(directory).sort((a, b) => a.localeCompare(b))) {
      if (excludedDirectories.has(entry)) continue;
      const absolutePath = join(directory, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!stats.isFile() || !allowedExtensions.has(extname(entry))) continue;
      const repositoryPath = normalizeRepositoryPath(relative(root, absolutePath));
      if (AUTHORITY_ACCESS_SCAN_POLICY.excludedPathFragments.some(
        (fragment) => repositoryPath === fragment || repositoryPath.includes(fragment),
      )) continue;
      files.push(repositoryPath);
    }
  }

  walk(absoluteRoot);
  return files;
}

function stripSqlDetectionComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, (match, prefix: string) => `${prefix} `)
    .replace(/--[^\r\n]*/g, ' ');
}

interface OperationMatcher<T extends string> {
  operation: T;
  pattern: RegExp;
}

function combinedAlternation(values: string[]): string {
  return [...values]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeRegExp)
    .join('|');
}

function createRawWriterMatchers(tables: string[]): OperationMatcher<WriterOperation>[] {
  const names = combinedAlternation(tables);
  const tablePattern = `["'\\\`\\[]?(${names})["'\\\`\\]]?(?=\\s|\\(|\\)|,|;|$)`;
  return [
    { operation: 'insert', pattern: new RegExp(`\\bINSERT\\s+(?:OR\\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\\s+)?INTO\\s+${tablePattern}`, 'gi') },
    { operation: 'replace', pattern: new RegExp(`\\bREPLACE\\s+INTO\\s+${tablePattern}`, 'gi') },
    { operation: 'update', pattern: new RegExp(`\\bUPDATE\\s+(?:OR\\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\\s+)?${tablePattern}`, 'gi') },
    { operation: 'delete', pattern: new RegExp(`\\bDELETE\\s+FROM\\s+${tablePattern}`, 'gi') },
  ];
}

function createRawReaderMatchers(tables: string[]): OperationMatcher<ReaderOperation>[] {
  const names = combinedAlternation(tables);
  const tablePattern = `["'\\\`\\[]?(${names})["'\\\`\\]]?(?=\\s|\\(|\\)|,|;|$)`;
  return [
    { operation: 'from', pattern: new RegExp(`\\bFROM\\s+${tablePattern}`, 'gi') },
    { operation: 'join', pattern: new RegExp(`\\b(?:LEFT|RIGHT|FULL|INNER|CROSS)?\\s*JOIN\\s+${tablePattern}`, 'gi') },
  ];
}

function createDrizzleWriterMatchers(variables: string[]): OperationMatcher<WriterOperation>[] {
  const names = combinedAlternation(variables);
  return [
    { operation: 'insert', pattern: new RegExp(`\\.insert\\s*\\(\\s*(${names})\\b`, 'g') },
    { operation: 'update', pattern: new RegExp(`\\.update\\s*\\(\\s*(${names})\\b`, 'g') },
    { operation: 'delete', pattern: new RegExp(`\\.delete\\s*\\(\\s*(${names})\\b`, 'g') },
  ];
}

function createDrizzleReaderMatchers(variables: string[]): OperationMatcher<ReaderOperation>[] {
  const names = combinedAlternation(variables);
  return [
    { operation: 'from', pattern: new RegExp(`\\.from\\s*\\(\\s*(${names})\\b`, 'g') },
    { operation: 'join', pattern: new RegExp(`\\.(?:leftJoin|rightJoin|fullJoin|innerJoin)\\s*\\(\\s*(${names})\\b`, 'g') },
  ];
}

function loadSchemaVariableMap(root: string, governedTableSet: Set<string>): Map<string, string[]> {
  const variableTables = new Map<string, Set<string>>();
  const schemaFiles = listFiles(root, 'src/db/schema');
  const declarationPattern = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:sqliteTable|sqliteView|pgTable|pgView|mysqlTable|mysqlView)\s*\(\s*["'`]([^"'`]+)["'`]/gs;

  for (const repositoryPath of schemaFiles) {
    const text = readFileSync(join(root, repositoryPath), 'utf8');
    for (const match of text.matchAll(declarationPattern)) {
      const variable = match[1];
      const table = match[2];
      if (!governedTableSet.has(table)) continue;
      const tables = variableTables.get(variable) ?? new Set<string>();
      tables.add(table);
      variableTables.set(variable, tables);
    }
  }

  return new Map(
    [...variableTables.entries()].map(([variable, tables]) => [variable, uniqueSorted(tables)]),
  );
}

function addMapping(map: Map<string, Set<string>>, table: string, conceptId: string): void {
  const values = map.get(table) ?? new Set<string>();
  values.add(conceptId);
  map.set(table, values);
}

export function loadCanonicalAuthorityAccessContext(
  input: BuildCanonicalAuthorityAccessRegistryInput,
): CanonicalAuthorityAccessContext {
  const root = resolve(input.root);
  const matrix = input.matrix ?? readJson<AuthorityMatrix>(root, MATRIX_PATH);
  const canonicalRegistry = input.canonicalRegistry
    ?? readJson<CanonicalSourceRegistry>(root, CANONICAL_REGISTRY_PATH);
  const legacyRegistry = input.legacyRegistry
    ?? readJson<LegacyDispositionRegistry>(root, LEGACY_REGISTRY_PATH);

  const matrixSourceTables = uniqueSorted(
    matrix.concepts.flatMap((concept) => concept.currentSources.map((source) => source.table)),
  );
  const canonicalTables = new Set(canonicalRegistry.canonicalTables.map((table) => table.name));
  const governedTables = uniqueSorted([
    ...matrixSourceTables,
    ...canonicalTables,
    ...legacyRegistry.tables.map((table) => table.name),
  ]);
  const tableConceptMap = new Map<string, Set<string>>();
  const conceptDomains = new Map<string, string>();
  const concepts = new Map<string, AuthorityMatrixConcept>();
  const externalTargetTables = new Set<string>();

  for (const concept of matrix.concepts) {
    conceptDomains.set(concept.id, concept.domain);
    concepts.set(concept.id, concept);
    for (const table of concept.currentSources.map((source) => source.table)) {
      addMapping(tableConceptMap, table, concept.id);
    }
    for (const table of concept.targetAuthority.tables) {
      addMapping(tableConceptMap, table, concept.id);
      if (concept.targetAuthority.status === 'external_governed') externalTargetTables.add(table);
    }
  }

  const tableConceptIds = new Map(
    [...tableConceptMap.entries()].map(([table, values]) => [table, uniqueSorted(values)]),
  );

  return {
    root,
    matrix,
    canonicalRegistry,
    legacyRegistry,
    governedTables,
    matrixSourceTables,
    canonicalTables,
    externalTargetTables,
    tableConceptIds,
    conceptDomains,
    concepts,
  };
}

interface MutableAccess {
  path: string;
  table: string;
  operations: Set<string>;
  detectionMethods: Set<AccessDetectionMethod>;
}

function accessKey(path: string, table: string): string {
  return `${path}\u0000${table}`;
}

function mergeAccess(
  map: Map<string, MutableAccess>,
  path: string,
  table: string,
  operations: string[],
  detectionMethod: AccessDetectionMethod,
): void {
  if (operations.length === 0) return;
  const key = accessKey(path, table);
  const entry = map.get(key) ?? {
    path,
    table,
    operations: new Set<string>(),
    detectionMethods: new Set<AccessDetectionMethod>(),
  };
  for (const operation of operations) entry.operations.add(operation);
  entry.detectionMethods.add(detectionMethod);
  map.set(key, entry);
}

function isCanonicalCodePath(repositoryPath: string): boolean {
  return repositoryPath.startsWith('src/lib/canonical/')
    || repositoryPath.startsWith('src/db/schema/canonical/')
    || repositoryPath.startsWith('scripts/canonical/')
    || /(?:^|\/)canonical(?:[A-Z_.-]|\/)/.test(repositoryPath);
}

function isShadowCodePath(repositoryPath: string): boolean {
  return /(?:^|[/_.-])shadow(?:[/_.-]|$)/i.test(repositoryPath)
    || repositoryPath.includes('parity');
}

function isFixtureCodePath(repositoryPath: string): boolean {
  return /(?:^|[/_.-])(?:seed|init|fixture|demo|smoke)(?:[/_.-]|$)/i.test(repositoryPath);
}

function classifyWriter(
  path: string,
  table: string,
  canonicalTables: Set<string>,
): WriterLifecycleStatus {
  if (path.startsWith('scripts/canonical/')) return 'migration_backfill';
  if (canonicalTables.has(table)) return 'canonical_authority';
  if (isFixtureCodePath(path)) return 'protected_fixture';
  if (isCanonicalCodePath(path)) return 'canonical_compatibility';
  return 'legacy_authority';
}

function writerBlocker(status: WriterLifecycleStatus): string {
  switch (status) {
    case 'canonical_authority': return 'NONE';
    case 'canonical_compatibility': return 'COMPATIBILITY_WRITE_REQUIRES_READ_PROMOTION_OBSERVATION_AND_APPROVAL';
    case 'legacy_authority': return 'CANONICAL_WRITE_CUTOVER_INCOMPLETE';
    case 'protected_fixture': return 'FIXTURE_SCOPE_REVIEW_REQUIRED';
    case 'migration_backfill': return 'MIGRATION_TOOL_RETAIN_UNTIL_PROGRAM_CLOSE';
    case 'blocked_in_canonical_mode': return 'CANONICAL_MODE_BLOCK_REQUIRED';
    case 'retirement_candidate': return 'RETIREMENT_APPROVAL_AND_ZERO_RUNTIME_USE_REQUIRED';
  }
}

function writerTarget(status: WriterLifecycleStatus, conceptIds: string[]): string {
  const concepts = conceptIds.join(',');
  switch (status) {
    case 'canonical_authority': return `retain as registered canonical authority for ${concepts}`;
    case 'canonical_compatibility': return `move authority to canonical command for ${concepts}; retain only atomic compatibility projection`;
    case 'legacy_authority': return `replace with canonical command boundary for ${concepts}`;
    case 'protected_fixture': return `isolate fixture path from production runtime and review removal for ${concepts}`;
    case 'migration_backfill': return `retain as explicit idempotent migration/backfill tool for ${concepts}`;
    case 'blocked_in_canonical_mode': return `enforce fail-closed canonical-mode block for ${concepts}`;
    case 'retirement_candidate': return `remove after zero-use proof and authorised retirement for ${concepts}`;
  }
}

function classifyReader(
  path: string,
  table: string,
  canonicalTables: Set<string>,
  externalTargetTables: Set<string>,
): ReaderProviderStatus {
  if (canonicalTables.has(table)) return 'canonical';
  if (externalTargetTables.has(table)) return 'external';
  if (isShadowCodePath(path)) return 'shadow';
  if (isCanonicalCodePath(path)) return 'compatibility';
  return 'legacy';
}

function readerBlocker(status: ReaderProviderStatus): string {
  switch (status) {
    case 'canonical': return 'NONE';
    case 'external': return 'NONE';
    case 'shadow': return 'SHADOW_PARITY_AND_OBSERVATION_INCOMPLETE';
    case 'compatibility': return 'COMPATIBILITY_READER_REQUIRED_UNTIL_LEGACY_RETIREMENT';
    case 'legacy': return 'CANONICAL_READ_PROVIDER_NOT_PROMOTED';
  }
}

function readerTarget(status: ReaderProviderStatus, conceptIds: string[]): string {
  const concepts = conceptIds.join(',');
  switch (status) {
    case 'canonical': return `registered canonical provider for ${concepts}`;
    case 'external': return `retain explicitly governed external provider for ${concepts}`;
    case 'shadow': return `complete parity and promote canonical provider for ${concepts}`;
    case 'compatibility': return `promote canonical provider and retire compatibility read for ${concepts}`;
    case 'legacy': return `implement and promote canonical provider for ${concepts}`;
  }
}

function statusCounts<T extends string>(statuses: readonly T[], values: T[]): Record<T, number> {
  return Object.fromEntries(
    statuses.map((status) => [status, values.filter((value) => value === status).length]),
  ) as Record<T, number>;
}

function domainsForConcepts(conceptIds: string[], conceptDomains: Map<string, string>): string[] {
  return uniqueSorted(conceptIds.map((conceptId) => conceptDomains.get(conceptId) ?? 'unassigned'));
}

function ownerForDomains(domains: string[]): string {
  return domains.length > 0 ? domains.join('+') : 'canonical_program_governance';
}

export function buildCanonicalAuthorityAccessRegistry(
  input: BuildCanonicalAuthorityAccessRegistryInput,
): CanonicalAuthorityAccessRegistry {
  const context = loadCanonicalAuthorityAccessContext(input);
  const governedTableSet = new Set(context.governedTables);
  const sourceFiles = uniqueSorted(
    AUTHORITY_ACCESS_SCAN_POLICY.roots.flatMap((scanRoot) => listFiles(context.root, scanRoot)),
  );
  const schemaVariables = loadSchemaVariableMap(context.root, governedTableSet);
  const writerMap = new Map<string, MutableAccess>();
  const readerMap = new Map<string, MutableAccess>();
  const tableByLowerName = new Map(context.governedTables.map((table) => [table.toLowerCase(), table]));
  const rawWriterMatchers = createRawWriterMatchers(context.governedTables);
  const rawReaderMatchers = createRawReaderMatchers(context.governedTables);
  const schemaVariableNames = [...schemaVariables.keys()];
  const drizzleWriterMatchers = createDrizzleWriterMatchers(schemaVariableNames);
  const drizzleReaderMatchers = createDrizzleReaderMatchers(schemaVariableNames);

  for (const repositoryPath of sourceFiles) {
    const rawText = readFileSync(join(context.root, repositoryPath), 'utf8');
    const text = stripSqlDetectionComments(rawText);

    for (const matcher of rawWriterMatchers) {
      for (const match of text.matchAll(matcher.pattern)) {
        const table = tableByLowerName.get(match[1].toLowerCase());
        if (table) mergeAccess(writerMap, repositoryPath, table, [matcher.operation], 'raw_sql');
      }
    }
    for (const matcher of rawReaderMatchers) {
      for (const match of text.matchAll(matcher.pattern)) {
        const table = tableByLowerName.get(match[1].toLowerCase());
        if (table) mergeAccess(readerMap, repositoryPath, table, [matcher.operation], 'raw_sql');
      }
    }
    for (const matcher of drizzleWriterMatchers) {
      for (const match of text.matchAll(matcher.pattern)) {
        for (const table of schemaVariables.get(match[1]) ?? []) {
          mergeAccess(writerMap, repositoryPath, table, [matcher.operation], 'drizzle');
        }
      }
    }
    for (const matcher of drizzleReaderMatchers) {
      for (const match of text.matchAll(matcher.pattern)) {
        for (const table of schemaVariables.get(match[1]) ?? []) {
          mergeAccess(readerMap, repositoryPath, table, [matcher.operation], 'drizzle');
        }
      }
    }
  }

  const writers: AuthorityWriterAccess[] = [...writerMap.values()].map((entry) => {
    const conceptIds = context.tableConceptIds.get(entry.table) ?? [];
    const domains = domainsForConcepts(conceptIds, context.conceptDomains);
    const lifecycleStatus = classifyWriter(entry.path, entry.table, context.canonicalTables);
    return {
      path: entry.path,
      table: entry.table,
      operations: uniqueSorted(entry.operations) as WriterOperation[],
      detectionMethods: uniqueSorted(entry.detectionMethods) as AccessDetectionMethod[],
      conceptIds,
      domains,
      owner: ownerForDomains(domains),
      lifecycleStatus,
      retirementBlocker: writerBlocker(lifecycleStatus),
      targetCommand: writerTarget(lifecycleStatus, conceptIds),
    };
  }).sort((a, b) => a.table.localeCompare(b.table) || a.path.localeCompare(b.path));

  const readers: AuthorityReaderAccess[] = [...readerMap.values()].map((entry) => {
    const conceptIds = context.tableConceptIds.get(entry.table) ?? [];
    const domains = domainsForConcepts(conceptIds, context.conceptDomains);
    const providerStatus = classifyReader(
      entry.path,
      entry.table,
      context.canonicalTables,
      context.externalTargetTables,
    );
    return {
      path: entry.path,
      table: entry.table,
      operations: uniqueSorted(entry.operations) as ReaderOperation[],
      detectionMethods: uniqueSorted(entry.detectionMethods) as AccessDetectionMethod[],
      conceptIds,
      domains,
      owner: ownerForDomains(domains),
      providerStatus,
      retirementBlocker: readerBlocker(providerStatus),
      targetProvider: readerTarget(providerStatus, conceptIds),
    };
  }).sort((a, b) => a.table.localeCompare(b.table) || a.path.localeCompare(b.path));

  const tablesWithWriters = new Set(writers.map((entry) => entry.table));
  const tablesWithReaders = new Set(readers.map((entry) => entry.table));
  const tablesWithoutWriters = context.governedTables.filter((table) => !tablesWithWriters.has(table));
  const tablesWithoutReaders = context.governedTables.filter((table) => !tablesWithReaders.has(table));

  const summary: AuthorityAccessSummary = {
    governedTableCount: context.governedTables.length,
    matrixSourceTableCount: context.matrixSourceTables.length,
    canonicalTableCount: context.canonicalTables.size,
    legacyDispositionTableCount: context.legacyRegistry.tables.length,
    writerCount: writers.length,
    readerCount: readers.length,
    writerStatusCounts: statusCounts(WRITER_STATUSES, writers.map((entry) => entry.lifecycleStatus)),
    readerStatusCounts: statusCounts(READER_STATUSES, readers.map((entry) => entry.providerStatus)),
    tablesWithWriters: tablesWithWriters.size,
    tablesWithReaders: tablesWithReaders.size,
    tablesWithoutWriters: tablesWithoutWriters.length,
    tablesWithoutReaders: tablesWithoutReaders.length,
  };

  return {
    version: 1,
    program: 'hms-canonical-data-architecture',
    scope: 'full_hms_governed_table_writer_reader_access',
    reviewedAt: input.reviewedAt ?? DEFAULT_ACCESS_REGISTRY_REVIEWED_AT,
    branch: 'program/cdb-main-continuous-20260725',
    sourceDocuments: [MATRIX_PATH, CANONICAL_REGISTRY_PATH, LEGACY_REGISTRY_PATH],
    scanPolicy: AUTHORITY_ACCESS_SCAN_POLICY,
    summary,
    coverage: {
      governedTables: context.governedTables,
      tablesWithoutWriters,
      tablesWithoutReaders,
    },
    writers,
    readers,
    knownLimitations: [
      'Static discovery cannot prove dynamic table names assembled without a literal governed table token.',
      'Aliased Drizzle imports may require future import-aware analysis when the local variable differs from the exported schema variable.',
      'External libraries, database triggers, remote workers, and stored SQL outside the scan roots require separate runtime and schema evidence.',
      'A clean static registry is necessary but never sufficient for production cutover or destructive retirement.',
      'Migration SQL under migrations/** is immutable historical evidence and is intentionally excluded from active writer discovery.',
      'Tests are intentionally excluded; protected fixtures callable from src/** remain discovered and classified.',
    ],
    safety: {
      productionMutationAuthorized: false,
      productionMutationPerformed: false,
      localSyncExpansionPaused: true,
      legacyRetirementAuthorized: false,
    },
  };
}
