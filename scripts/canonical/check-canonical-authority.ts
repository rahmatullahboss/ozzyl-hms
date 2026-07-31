import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AuthorityIssueCode =
  | 'AUTH_MATRIX_INVALID'
  | 'AUTH_POLICY_INVALID'
  | 'AUTH_CONCEPT_INVALID'
  | 'AUTH_CONCEPT_DUPLICATE'
  | 'AUTH_CANONICAL_TABLE_UNOWNED'
  | 'AUTH_CANONICAL_TABLE_MULTIPLE_OWNERS'
  | 'AUTH_CANONICAL_TABLE_INVALID_OWNER_STATUS'
  | 'AUTH_CANONICAL_TABLE_UNKNOWN'
  | 'AUTH_LEGACY_TABLE_UNREGISTERED'
  | 'AUTH_EVIDENCE_PATH_MISSING'
  | 'AUTH_REJECTED_ARCHITECTURE_REFERENCE'
  | 'AUTH_SUMMARY_DRIFT';

export interface AuthorityIssue {
  code: AuthorityIssueCode;
  path: string;
  subject: string;
  message: string;
}

export interface AuthorityCheckSummary {
  concepts: number;
  canonicalTables: number;
  governedLegacyTables: number;
  implementedCanonicalConcepts: number;
  partialCanonicalConcepts: number;
  canonicalGaps: number;
  externalGovernedConcepts: number;
}

export interface AuthorityCheckResult {
  ok: boolean;
  issues: AuthorityIssue[];
  summary: AuthorityCheckSummary;
}

export type AuthorityTargetStatus =
  | 'implemented_canonical'
  | 'partial_canonical'
  | 'canonical_gap'
  | 'external_governed';

export interface AuthorityMatrixSource {
  table: string;
  classification: string;
  disposition: string;
}

export interface AuthorityMatrixConcept {
  id: string;
  domain: string;
  fact: string;
  targetAuthority: {
    status: AuthorityTargetStatus | string;
    tables: string[];
    modules: string[];
    gap?: string;
  };
  currentSources: AuthorityMatrixSource[];
  directWriters: string[];
  readConsumers: string[];
  backfill: { status: string; evidence: string[] };
  reconciliation: { status: string; evidence: string[] };
  cutover: { status: string; blockers: string[]; nextAction: string };
  retirement: { status: string; action: string };
}

export interface AuthorityMatrix {
  version: number;
  program: string;
  scope: string;
  authorityPolicy: {
    oneAuthorityPerFact: boolean;
    canonicalOnlyImplementationRoots: string[];
    rejectedParallelArchitectures: string[];
    productionMutationAuthorized: boolean;
    destructiveRetirementAuthorized: boolean;
    localSyncExpansionPaused: boolean;
  };
  summary: {
    conceptCount: number;
    implementedCanonicalCount: number;
    partialCanonicalCount: number;
    canonicalGapCount: number;
    externalGovernedCount: number;
    canonicalTableCount: number;
    registeredLegacyTableCount: number;
  };
  concepts: AuthorityMatrixConcept[];
}

export interface CanonicalSourceRegistry {
  canonicalTables: Array<{ name: string }>;
}

export interface LegacyDispositionRegistry {
  tables: Array<{ name: string }>;
  directWriteAllowlist?: Array<{ path: string; table: string }>;
}

export interface CanonicalAuthorityCheckInput {
  root: string;
  matrix?: AuthorityMatrix;
  canonicalRegistry?: CanonicalSourceRegistry;
  legacyRegistry?: LegacyDispositionRegistry;
}

const MATRIX_PATH = 'docs/database/canonical-authority-matrix.yaml';
const CANONICAL_REGISTRY_PATH = 'docs/database/canonical-source-of-truth.yaml';
const LEGACY_REGISTRY_PATH = 'docs/database/legacy-table-disposition.yaml';

const allowedTargetStatuses = new Set<AuthorityTargetStatus>([
  'implemented_canonical',
  'partial_canonical',
  'canonical_gap',
  'external_governed',
]);
const allowedSourceClassifications = new Set([
  'operational_authority',
  'duplicate_authority',
  'projection_cache',
  'compatibility_surface',
  'audit_history',
  'workflow_document',
  'domain_extension',
  'external_platform_authority',
  'retirement_candidate',
]);
const allowedBackfillStatuses = new Set([
  'complete',
  'implemented_local_verified',
  'partial',
  'not_started',
  'not_required',
  'historical_evidence_only',
]);
const allowedReconciliationStatuses = new Set([
  'verified_local',
  'implemented_local_verified',
  'verified_production_snapshot',
  'partial',
  'not_started',
  'not_required',
]);
const allowedCutoverStatuses = new Set([
  'blocked',
  'blocked_external_gate',
  'blocked_local_ready_provider_disabled',
  'local_ready',
  'shadow_only',
  'not_applicable',
  'not_started',
]);
const allowedRetirementStatuses = new Set([
  'blocked',
  'compatibility_then_archive',
  'retain_domain_extension',
  'retain_external_authority',
  'not_applicable',
]);
const requiredImplementationRoots = [
  'src/lib/canonical/**',
  'src/db/schema/canonical/**',
  'scripts/canonical/**',
  'test/canonical/**',
];

function normalizePath(value: string): string {
  return normalize(value).split(sep).join('/').replace(/^\.\//, '');
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function addIssue(issues: AuthorityIssue[], issue: AuthorityIssue): void {
  const key = `${issue.code}\u0000${issue.path}\u0000${issue.subject}\u0000${issue.message}`;
  const duplicate = issues.some(
    (candidate) => `${candidate.code}\u0000${candidate.path}\u0000${candidate.subject}\u0000${candidate.message}` === key,
  );
  if (!duplicate) issues.push(issue);
}

function readJsonDocument<T>(root: string, relativePath: string, issues: AuthorityIssue[]): T | null {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    addIssue(issues, {
      code: 'AUTH_MATRIX_INVALID',
      path: relativePath,
      subject: relativePath,
      message: 'Required authority registry document is missing.',
    });
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
  } catch (error) {
    addIssue(issues, {
      code: 'AUTH_MATRIX_INVALID',
      path: relativePath,
      subject: relativePath,
      message: `Authority registry must be JSON-compatible YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

function emptySummary(): AuthorityCheckSummary {
  return {
    concepts: 0,
    canonicalTables: 0,
    governedLegacyTables: 0,
    implementedCanonicalConcepts: 0,
    partialCanonicalConcepts: 0,
    canonicalGaps: 0,
    externalGovernedConcepts: 0,
  };
}

function calculateSummary(
  matrix: AuthorityMatrix,
  canonicalRegistry: CanonicalSourceRegistry,
  legacyRegistry: LegacyDispositionRegistry,
): AuthorityCheckSummary {
  return {
    concepts: matrix.concepts.length,
    canonicalTables: canonicalRegistry.canonicalTables.length,
    governedLegacyTables: legacyRegistry.tables.length,
    implementedCanonicalConcepts: matrix.concepts.filter(
      (concept) => concept.targetAuthority.status === 'implemented_canonical',
    ).length,
    partialCanonicalConcepts: matrix.concepts.filter(
      (concept) => concept.targetAuthority.status === 'partial_canonical',
    ).length,
    canonicalGaps: matrix.concepts.filter(
      (concept) => concept.targetAuthority.status === 'canonical_gap',
    ).length,
    externalGovernedConcepts: matrix.concepts.filter(
      (concept) => concept.targetAuthority.status === 'external_governed',
    ).length,
  };
}

function validatePolicy(matrix: AuthorityMatrix, issues: AuthorityIssue[]): void {
  const policy = matrix.authorityPolicy;
  const valid = policy
    && policy.oneAuthorityPerFact === true
    && policy.productionMutationAuthorized === false
    && policy.destructiveRetirementAuthorized === false
    && policy.localSyncExpansionPaused === true
    && Array.isArray(policy.canonicalOnlyImplementationRoots)
    && requiredImplementationRoots.every((entry) => policy.canonicalOnlyImplementationRoots.includes(entry))
    && Array.isArray(policy.rejectedParallelArchitectures)
    && policy.rejectedParallelArchitectures.includes('src/lib/financial-reconciliation/**');
  if (!valid) {
    addIssue(issues, {
      code: 'AUTH_POLICY_INVALID',
      path: MATRIX_PATH,
      subject: 'authorityPolicy',
      message: 'Authority policy must enforce one authority, canonical implementation roots, local-sync pause, and no production/destructive authorization.',
    });
  }
}

function validateConcepts(matrix: AuthorityMatrix, issues: AuthorityIssue[]): void {
  const ids = new Set<string>();
  for (const concept of matrix.concepts) {
    if (ids.has(concept.id)) {
      addIssue(issues, {
        code: 'AUTH_CONCEPT_DUPLICATE',
        path: MATRIX_PATH,
        subject: concept.id,
        message: 'Business concept IDs must be unique.',
      });
    }
    ids.add(concept.id);

    const validStatus = allowedTargetStatuses.has(concept.targetAuthority?.status as AuthorityTargetStatus);
    const validSources = Array.isArray(concept.currentSources)
      && concept.currentSources.length > 0
      && concept.currentSources.every(
        (source) => nonEmpty(source.table)
          && allowedSourceClassifications.has(source.classification)
          && nonEmpty(source.disposition),
      );
    const valid = /^[a-z0-9_]+$/.test(concept.id)
      && nonEmpty(concept.domain)
      && nonEmpty(concept.fact)
      && validStatus
      && Array.isArray(concept.targetAuthority?.tables)
      && Array.isArray(concept.targetAuthority?.modules)
      && validSources
      && Array.isArray(concept.directWriters)
      && Array.isArray(concept.readConsumers)
      && allowedBackfillStatuses.has(concept.backfill?.status)
      && Array.isArray(concept.backfill?.evidence)
      && allowedReconciliationStatuses.has(concept.reconciliation?.status)
      && Array.isArray(concept.reconciliation?.evidence)
      && allowedCutoverStatuses.has(concept.cutover?.status)
      && Array.isArray(concept.cutover?.blockers)
      && nonEmpty(concept.cutover?.nextAction)
      && allowedRetirementStatuses.has(concept.retirement?.status)
      && nonEmpty(concept.retirement?.action);

    if (!valid) {
      addIssue(issues, {
        code: 'AUTH_CONCEPT_INVALID',
        path: MATRIX_PATH,
        subject: concept.id || '<unnamed concept>',
        message: 'Concept requires valid identity, target, source, evidence, cutover, and retirement metadata.',
      });
    }

    if (concept.targetAuthority.status === 'canonical_gap') {
      if (concept.targetAuthority.tables.length > 0 || !nonEmpty(concept.targetAuthority.gap)) {
        addIssue(issues, {
          code: 'AUTH_CONCEPT_INVALID',
          path: MATRIX_PATH,
          subject: concept.id,
          message: 'Canonical gaps require zero target tables and a concrete gap explanation.',
        });
      }
    } else if (concept.targetAuthority.tables.length === 0) {
      addIssue(issues, {
        code: 'AUTH_CONCEPT_INVALID',
        path: MATRIX_PATH,
        subject: concept.id,
        message: 'Non-gap concepts require at least one target authority table.',
      });
    }
  }
}

function validateOwnership(
  matrix: AuthorityMatrix,
  canonicalRegistry: CanonicalSourceRegistry,
  issues: AuthorityIssue[],
): void {
  const registered = new Set(canonicalRegistry.canonicalTables.map((table) => table.name));
  const owners = new Map<string, string[]>();

  for (const concept of matrix.concepts) {
    const isCanonicalOwner = concept.targetAuthority.status === 'implemented_canonical'
      || concept.targetAuthority.status === 'partial_canonical';
    if (!isCanonicalOwner) {
      for (const table of concept.targetAuthority.tables) {
        if (registered.has(table)) {
          addIssue(issues, {
            code: 'AUTH_CANONICAL_TABLE_INVALID_OWNER_STATUS',
            path: MATRIX_PATH,
            subject: `${concept.id}:${table}`,
            message: 'Registered canonical tables may only be owned by implemented_canonical or partial_canonical concepts.',
          });
        }
      }
      continue;
    }
    for (const table of concept.targetAuthority.tables) {
      const names = owners.get(table) ?? [];
      names.push(concept.id);
      owners.set(table, names);
      if (!registered.has(table)) {
        addIssue(issues, {
          code: 'AUTH_CANONICAL_TABLE_UNKNOWN',
          path: MATRIX_PATH,
          subject: table,
          message: 'Authority matrix owns a canonical table absent from canonical-source-of-truth.yaml.',
        });
      }
    }
  }

  for (const table of registered) {
    const tableOwners = owners.get(table) ?? [];
    if (tableOwners.length === 0) {
      addIssue(issues, {
        code: 'AUTH_CANONICAL_TABLE_UNOWNED',
        path: MATRIX_PATH,
        subject: table,
        message: 'Registered canonical table has no owning business concept.',
      });
    } else if (tableOwners.length > 1) {
      addIssue(issues, {
        code: 'AUTH_CANONICAL_TABLE_MULTIPLE_OWNERS',
        path: MATRIX_PATH,
        subject: table,
        message: `Registered canonical table has multiple owners: ${tableOwners.sort().join(', ')}.`,
      });
    }
  }
}

function validateLegacyCoverage(
  matrix: AuthorityMatrix,
  legacyRegistry: LegacyDispositionRegistry,
  issues: AuthorityIssue[],
): void {
  const registeredSources = new Set(
    matrix.concepts.flatMap((concept) => concept.currentSources.map((source) => source.table)),
  );
  for (const table of legacyRegistry.tables) {
    if (!registeredSources.has(table.name)) {
      addIssue(issues, {
        code: 'AUTH_LEGACY_TABLE_UNREGISTERED',
        path: MATRIX_PATH,
        subject: table.name,
        message: 'Governed legacy table is not assigned to any authority concept.',
      });
    }
  }
}

function rejectedPrefixes(matrix: AuthorityMatrix): string[] {
  return matrix.authorityPolicy.rejectedParallelArchitectures
    .filter((entry) => entry.includes('/') && !entry.startsWith('program/'))
    .map((entry) => normalizePath(entry.replace(/\/\*\*$/, '').replace(/\*$/, '')));
}

function conceptEvidencePaths(concept: AuthorityMatrixConcept): string[] {
  return [
    ...concept.targetAuthority.modules,
    ...concept.directWriters,
    ...concept.readConsumers,
    ...concept.backfill.evidence,
    ...concept.reconciliation.evidence,
  ];
}

function validateEvidencePaths(root: string, matrix: AuthorityMatrix, issues: AuthorityIssue[]): void {
  const rejected = rejectedPrefixes(matrix);
  for (const concept of matrix.concepts) {
    for (const rawPath of conceptEvidencePaths(concept)) {
      if (!nonEmpty(rawPath)) continue;
      const relativePath = normalizePath(rawPath);
      if (rejected.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) {
        addIssue(issues, {
          code: 'AUTH_REJECTED_ARCHITECTURE_REFERENCE',
          path: MATRIX_PATH,
          subject: `${concept.id}:${relativePath}`,
          message: 'Authority concepts must not appoint a rejected parallel architecture as evidence or implementation.',
        });
      }
      if (!existsSync(join(root, relativePath))) {
        addIssue(issues, {
          code: 'AUTH_EVIDENCE_PATH_MISSING',
          path: MATRIX_PATH,
          subject: `${concept.id}:${relativePath}`,
          message: 'Registered authority evidence path does not exist in the repository.',
        });
      }
    }
  }
}

function validateSummary(
  matrix: AuthorityMatrix,
  summary: AuthorityCheckSummary,
  issues: AuthorityIssue[],
): void {
  const expected = {
    conceptCount: summary.concepts,
    implementedCanonicalCount: summary.implementedCanonicalConcepts,
    partialCanonicalCount: summary.partialCanonicalConcepts,
    canonicalGapCount: summary.canonicalGaps,
    externalGovernedCount: summary.externalGovernedConcepts,
    canonicalTableCount: summary.canonicalTables,
    registeredLegacyTableCount: summary.governedLegacyTables,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (matrix.summary?.[key as keyof typeof matrix.summary] !== value) {
      addIssue(issues, {
        code: 'AUTH_SUMMARY_DRIFT',
        path: MATRIX_PATH,
        subject: key,
        message: `Summary value must be ${value}.`,
      });
    }
  }
}

export function checkCanonicalAuthority(input: CanonicalAuthorityCheckInput): AuthorityCheckResult {
  const root = resolve(input.root);
  const issues: AuthorityIssue[] = [];
  const matrix = input.matrix
    ?? readJsonDocument<AuthorityMatrix>(root, MATRIX_PATH, issues);
  const canonicalRegistry = input.canonicalRegistry
    ?? readJsonDocument<CanonicalSourceRegistry>(root, CANONICAL_REGISTRY_PATH, issues);
  const legacyRegistry = input.legacyRegistry
    ?? readJsonDocument<LegacyDispositionRegistry>(root, LEGACY_REGISTRY_PATH, issues);

  if (!matrix || !canonicalRegistry || !legacyRegistry
    || !Array.isArray(matrix.concepts)
    || !Array.isArray(canonicalRegistry.canonicalTables)
    || !Array.isArray(legacyRegistry.tables)) {
    if (matrix && !Array.isArray(matrix.concepts)) {
      addIssue(issues, {
        code: 'AUTH_MATRIX_INVALID',
        path: MATRIX_PATH,
        subject: 'concepts',
        message: 'Authority matrix concepts must be an array.',
      });
    }
    return { ok: false, issues, summary: emptySummary() };
  }

  const summary = calculateSummary(matrix, canonicalRegistry, legacyRegistry);
  if (matrix.version !== 1
    || matrix.program !== 'hms-canonical-data-architecture'
    || matrix.scope !== 'full_hms_business_fact_authority_and_legacy_cutover') {
    addIssue(issues, {
      code: 'AUTH_MATRIX_INVALID',
      path: MATRIX_PATH,
      subject: 'matrix identity',
      message: 'Authority matrix version, program, and scope do not match the reviewed contract.',
    });
  }

  validatePolicy(matrix, issues);
  validateConcepts(matrix, issues);
  validateOwnership(matrix, canonicalRegistry, issues);
  validateLegacyCoverage(matrix, legacyRegistry, issues);
  validateEvidencePaths(root, matrix, issues);
  validateSummary(matrix, summary, issues);

  issues.sort(
    (a, b) => a.code.localeCompare(b.code)
      || a.path.localeCompare(b.path)
      || a.subject.localeCompare(b.subject)
      || a.message.localeCompare(b.message),
  );
  return { ok: issues.length === 0, issues, summary };
}

export function assertCanonicalAuthority(input: CanonicalAuthorityCheckInput): void {
  const result = checkCanonicalAuthority(input);
  if (!result.ok) {
    const details = result.issues
      .map((issue) => `${issue.code} ${issue.path} [${issue.subject}] ${issue.message}`)
      .join('\n');
    throw new Error(`Canonical authority governance failed with ${result.issues.length} issue(s):\n${details}`);
  }
}

function main(): void {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const result = checkCanonicalAuthority({ root });
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`${issue.code} ${issue.path} [${issue.subject}] ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Canonical authority governance passed: ${result.summary.concepts} concepts, `
      + `${result.summary.canonicalTables} canonical tables, `
      + `${result.summary.governedLegacyTables} governed legacy tables, 0 issues.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
