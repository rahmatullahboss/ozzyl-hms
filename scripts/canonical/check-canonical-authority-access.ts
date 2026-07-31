import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTHORITY_ACCESS_SCAN_POLICY,
  buildCanonicalAuthorityAccessRegistry,
  loadCanonicalAuthorityAccessContext,
  normalizeRepositoryPath,
  type AuthorityAccessSummary,
  type AuthorityReaderAccess,
  type AuthorityWriterAccess,
  type CanonicalAuthorityAccessRegistry,
  type ReaderProviderStatus,
  type WriterLifecycleStatus,
} from './canonical-authority-access';

export type CanonicalAuthorityAccessIssueCode =
  | 'ACCESS_REGISTRY_INVALID'
  | 'ACCESS_POLICY_INVALID'
  | 'ACCESS_ENTRY_DUPLICATE'
  | 'ACCESS_ENTRY_INVALID'
  | 'ACCESS_WRITER_STATUS_INVALID'
  | 'ACCESS_READER_STATUS_INVALID'
  | 'ACCESS_TABLE_UNKNOWN'
  | 'ACCESS_CONCEPT_UNKNOWN'
  | 'ACCESS_PATH_MISSING'
  | 'ACCESS_REJECTED_ARCHITECTURE_REFERENCE'
  | 'ACCESS_WRITER_UNREGISTERED'
  | 'ACCESS_READER_UNREGISTERED'
  | 'ACCESS_WRITER_STALE'
  | 'ACCESS_READER_STALE'
  | 'ACCESS_ENTRY_DRIFT'
  | 'ACCESS_SUMMARY_DRIFT'
  | 'ACCESS_PACKAGE_COMMAND_MISSING';

export interface CanonicalAuthorityAccessIssue {
  code: CanonicalAuthorityAccessIssueCode;
  subject: string;
  message: string;
}

export interface CanonicalAuthorityAccessCheckResult {
  ok: boolean;
  issues: CanonicalAuthorityAccessIssue[];
  summary: AuthorityAccessSummary | null;
}

export interface CanonicalAuthorityAccessCheckInput {
  root: string;
  registry?: CanonicalAuthorityAccessRegistry;
  discovered?: CanonicalAuthorityAccessRegistry;
}

const REGISTRY_PATH = 'docs/database/canonical-authority-access-registry.yaml';
const WRITER_STATUSES = new Set<WriterLifecycleStatus>([
  'canonical_authority',
  'canonical_compatibility',
  'legacy_authority',
  'protected_fixture',
  'migration_backfill',
  'blocked_in_canonical_mode',
  'retirement_candidate',
]);
const READER_STATUSES = new Set<ReaderProviderStatus>([
  'canonical',
  'shadow',
  'legacy',
  'compatibility',
  'external',
]);

function addIssue(
  issues: CanonicalAuthorityAccessIssue[],
  issue: CanonicalAuthorityAccessIssue,
): void {
  const key = `${issue.code}\u0000${issue.subject}\u0000${issue.message}`;
  if (!issues.some((candidate) => `${candidate.code}\u0000${candidate.subject}\u0000${candidate.message}` === key)) {
    issues.push(issue);
  }
}

function readRegistry(root: string, issues: CanonicalAuthorityAccessIssue[]): CanonicalAuthorityAccessRegistry | null {
  const absolutePath = join(root, REGISTRY_PATH);
  if (!existsSync(absolutePath)) {
    addIssue(issues, {
      code: 'ACCESS_REGISTRY_INVALID',
      subject: REGISTRY_PATH,
      message: 'Authority access registry is missing.',
    });
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as CanonicalAuthorityAccessRegistry;
  } catch (error) {
    addIssue(issues, {
      code: 'ACCESS_REGISTRY_INVALID',
      subject: REGISTRY_PATH,
      message: `Authority access registry must be JSON-compatible YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

function isSortedUnique(values: string[]): boolean {
  if (new Set(values).size !== values.length) return false;
  return values.every((value, index) => index === 0 || values[index - 1].localeCompare(value) <= 0);
}

function writerKey(entry: Pick<AuthorityWriterAccess, 'path' | 'table'>): string {
  return `${entry.path}\u0000${entry.table}`;
}

function readerKey(entry: Pick<AuthorityReaderAccess, 'path' | 'table'>): string {
  return `${entry.path}\u0000${entry.table}`;
}

function validateIdentityAndPolicy(
  registry: CanonicalAuthorityAccessRegistry,
  issues: CanonicalAuthorityAccessIssue[],
): void {
  if (registry.version !== 1
    || registry.program !== 'hms-canonical-data-architecture'
    || registry.scope !== 'full_hms_governed_table_writer_reader_access'
    || registry.branch !== 'program/cdb-main-continuous-20260725'
    || typeof registry.reviewedAt !== 'string'
    || registry.reviewedAt.length < 10) {
    addIssue(issues, {
      code: 'ACCESS_REGISTRY_INVALID',
      subject: 'registry identity',
      message: 'Registry version, program, scope, branch, or reviewedAt is invalid.',
    });
  }

  if (JSON.stringify(registry.scanPolicy) !== JSON.stringify(AUTHORITY_ACCESS_SCAN_POLICY)
    || registry.safety?.productionMutationAuthorized !== false
    || registry.safety?.productionMutationPerformed !== false
    || registry.safety?.localSyncExpansionPaused !== true
    || registry.safety?.legacyRetirementAuthorized !== false) {
    addIssue(issues, {
      code: 'ACCESS_POLICY_INVALID',
      subject: 'scanPolicy/safety',
      message: 'Registry scan and safety policy differs from the reviewed fail-closed contract.',
    });
  }
}

function rejectedPrefixes(registry: CanonicalAuthorityAccessRegistry): string[] {
  const matrixPath = registry.sourceDocuments.find((entry) => entry.endsWith('canonical-authority-matrix.yaml'));
  return matrixPath ? ['src/lib/financial-reconciliation'] : ['src/lib/financial-reconciliation'];
}

function validateEntryCommon(
  root: string,
  entry: AuthorityWriterAccess | AuthorityReaderAccess,
  knownTables: Set<string>,
  knownConcepts: Set<string>,
  rejected: string[],
  issues: CanonicalAuthorityAccessIssue[],
): void {
  const subject = `${entry.path}:${entry.table}`;
  if (!entry.path || !entry.table
    || !Array.isArray(entry.operations) || entry.operations.length === 0
    || !Array.isArray(entry.detectionMethods) || entry.detectionMethods.length === 0
    || !Array.isArray(entry.conceptIds) || entry.conceptIds.length === 0
    || !Array.isArray(entry.domains) || entry.domains.length === 0
    || !entry.owner) {
    addIssue(issues, {
      code: 'ACCESS_ENTRY_INVALID',
      subject,
      message: 'Access entry requires path, table, operations, detection methods, concepts, domains, and owner.',
    });
  }

  for (const values of [entry.operations, entry.detectionMethods, entry.conceptIds, entry.domains]) {
    if (!isSortedUnique(values)) {
      addIssue(issues, {
        code: 'ACCESS_ENTRY_INVALID',
        subject,
        message: 'Access entry arrays must be sorted and unique.',
      });
    }
  }

  if (!knownTables.has(entry.table)) {
    addIssue(issues, {
      code: 'ACCESS_TABLE_UNKNOWN',
      subject,
      message: 'Access entry references a table outside the governed authority set.',
    });
  }
  for (const conceptId of entry.conceptIds) {
    if (!knownConcepts.has(conceptId)) {
      addIssue(issues, {
        code: 'ACCESS_CONCEPT_UNKNOWN',
        subject: `${subject}:${conceptId}`,
        message: 'Access entry references an unknown authority concept.',
      });
    }
  }

  const repositoryPath = normalizeRepositoryPath(entry.path);
  if (!existsSync(join(root, repositoryPath))) {
    addIssue(issues, {
      code: 'ACCESS_PATH_MISSING',
      subject,
      message: 'Registered access path does not exist in the repository.',
    });
  }
  if (rejected.some((prefix) => repositoryPath === prefix || repositoryPath.startsWith(`${prefix}/`))) {
    addIssue(issues, {
      code: 'ACCESS_REJECTED_ARCHITECTURE_REFERENCE',
      subject,
      message: 'Rejected parallel architecture cannot be registered as an authority access path.',
    });
  }
}

function validateEntries(
  root: string,
  registry: CanonicalAuthorityAccessRegistry,
  knownTables: Set<string>,
  knownConcepts: Set<string>,
  issues: CanonicalAuthorityAccessIssue[],
): void {
  const rejected = rejectedPrefixes(registry);
  const writerKeys = new Set<string>();
  const readerKeys = new Set<string>();

  for (const entry of registry.writers ?? []) {
    const key = writerKey(entry);
    if (writerKeys.has(key)) {
      addIssue(issues, {
        code: 'ACCESS_ENTRY_DUPLICATE',
        subject: key,
        message: 'Writer path/table key must be unique.',
      });
    }
    writerKeys.add(key);
    validateEntryCommon(root, entry, knownTables, knownConcepts, rejected, issues);
    if (!WRITER_STATUSES.has(entry.lifecycleStatus)) {
      addIssue(issues, {
        code: 'ACCESS_WRITER_STATUS_INVALID',
        subject: key,
        message: 'Writer lifecycle status is not allowed.',
      });
    }
  }

  for (const entry of registry.readers ?? []) {
    const key = readerKey(entry);
    if (readerKeys.has(key)) {
      addIssue(issues, {
        code: 'ACCESS_ENTRY_DUPLICATE',
        subject: key,
        message: 'Reader path/table key must be unique.',
      });
    }
    readerKeys.add(key);
    validateEntryCommon(root, entry, knownTables, knownConcepts, rejected, issues);
    if (!READER_STATUSES.has(entry.providerStatus)) {
      addIssue(issues, {
        code: 'ACCESS_READER_STATUS_INVALID',
        subject: key,
        message: 'Reader provider status is not allowed.',
      });
    }
  }
}

function compareAccess<T extends AuthorityWriterAccess | AuthorityReaderAccess>(
  access: 'writer' | 'reader',
  reviewed: T[],
  discovered: T[],
  issues: CanonicalAuthorityAccessIssue[],
): void {
  const keyOf = access === 'writer'
    ? (entry: T) => writerKey(entry as AuthorityWriterAccess)
    : (entry: T) => readerKey(entry as AuthorityReaderAccess);
  const reviewedMap = new Map(reviewed.map((entry) => [keyOf(entry), entry]));
  const discoveredMap = new Map(discovered.map((entry) => [keyOf(entry), entry]));
  const unregisteredCode = access === 'writer' ? 'ACCESS_WRITER_UNREGISTERED' : 'ACCESS_READER_UNREGISTERED';
  const staleCode = access === 'writer' ? 'ACCESS_WRITER_STALE' : 'ACCESS_READER_STALE';

  for (const [key, actual] of discoveredMap) {
    const registered = reviewedMap.get(key);
    if (!registered) {
      addIssue(issues, {
        code: unregisteredCode,
        subject: key,
        message: `Discovered ${access} is absent from the reviewed registry.`,
      });
      continue;
    }
    if (JSON.stringify(registered) !== JSON.stringify(actual)) {
      addIssue(issues, {
        code: 'ACCESS_ENTRY_DRIFT',
        subject: key,
        message: `Registered ${access} metadata differs from deterministic discovery.`,
      });
    }
  }

  for (const key of reviewedMap.keys()) {
    if (!discoveredMap.has(key)) {
      addIssue(issues, {
        code: staleCode,
        subject: key,
        message: `Registered ${access} is no longer discovered in the repository.`,
      });
    }
  }
}

function validateSummary(
  registry: CanonicalAuthorityAccessRegistry,
  discovered: CanonicalAuthorityAccessRegistry,
  issues: CanonicalAuthorityAccessIssue[],
): void {
  if (JSON.stringify(registry.summary) !== JSON.stringify(discovered.summary)
    || JSON.stringify(registry.coverage) !== JSON.stringify(discovered.coverage)) {
    addIssue(issues, {
      code: 'ACCESS_SUMMARY_DRIFT',
      subject: 'summary/coverage',
      message: 'Registry summary or table coverage differs from deterministic discovery.',
    });
  }
}

function validatePackageCommands(root: string, issues: CanonicalAuthorityAccessIssue[]): void {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const valid = scripts['canonical:access-registry-generate']
      === 'tsx scripts/canonical/generate-canonical-authority-access-registry.ts'
    && scripts['canonical:access-check']
      === 'tsx scripts/canonical/check-canonical-authority-access.ts'
    && scripts['canonical:check']?.includes('canonical:access-check');
  if (!valid) {
    addIssue(issues, {
      code: 'ACCESS_PACKAGE_COMMAND_MISSING',
      subject: 'package.json',
      message: 'Generation/check commands and mandatory canonical:check integration are required.',
    });
  }
}

export function checkCanonicalAuthorityAccess(
  input: CanonicalAuthorityAccessCheckInput,
): CanonicalAuthorityAccessCheckResult {
  const root = resolve(input.root);
  const issues: CanonicalAuthorityAccessIssue[] = [];
  const registry = input.registry ?? readRegistry(root, issues);
  if (!registry || !Array.isArray(registry.writers) || !Array.isArray(registry.readers)) {
    return { ok: false, issues, summary: registry?.summary ?? null };
  }

  const context = loadCanonicalAuthorityAccessContext({ root });
  const discovered = input.discovered
    ?? buildCanonicalAuthorityAccessRegistry({ root, reviewedAt: registry.reviewedAt });
  const knownTables = new Set(context.governedTables);
  const knownConcepts = new Set(context.concepts.keys());

  validateIdentityAndPolicy(registry, issues);
  validateEntries(root, registry, knownTables, knownConcepts, issues);
  compareAccess('writer', registry.writers, discovered.writers, issues);
  compareAccess('reader', registry.readers, discovered.readers, issues);
  validateSummary(registry, discovered, issues);
  validatePackageCommands(root, issues);

  issues.sort((a, b) => a.code.localeCompare(b.code)
    || a.subject.localeCompare(b.subject)
    || a.message.localeCompare(b.message));
  return { ok: issues.length === 0, issues, summary: registry.summary };
}

export function assertCanonicalAuthorityAccess(input: CanonicalAuthorityAccessCheckInput): void {
  const result = checkCanonicalAuthorityAccess(input);
  if (!result.ok) {
    throw new Error(result.issues
      .map((issue) => `${issue.code} [${issue.subject}] ${issue.message}`)
      .join('\n'));
  }
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const result = checkCanonicalAuthorityAccess({ root });
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`${issue.code} [${issue.subject}] ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  const summary = result.summary;
  console.log(
    `Canonical authority access governance passed: ${summary?.governedTableCount ?? 0} governed tables, `
      + `${summary?.writerCount ?? 0} writers, ${summary?.readerCount ?? 0} readers, 0 issues.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
