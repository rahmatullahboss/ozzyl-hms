import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  matrix: path.join(root, 'docs/database/canonical-authority-matrix.yaml'),
  report: path.join(root, 'docs/database/audits/2026-07-26-full-hms-canonical-authority-audit.md'),
  plan: path.join(root, 'docs/superpowers/plans/2026-07-26-full-hms-canonical-cutover-completion.md'),
  sourceOfTruth: path.join(root, 'docs/database/canonical-source-of-truth.yaml'),
  legacyDisposition: path.join(root, 'docs/database/legacy-table-disposition.yaml'),
};

const allowedTargetStatuses = new Set([
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

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function readJson<T>(file: string): T {
  return JSON.parse(read(file)) as T;
}

type MatrixSource = {
  table: string;
  classification: string;
  disposition: string;
};

type MatrixConcept = {
  id: string;
  domain: string;
  fact: string;
  targetAuthority: {
    status: string;
    tables: string[];
    modules: string[];
    gap?: string;
  };
  currentSources: MatrixSource[];
  directWriters: string[];
  readConsumers: string[];
  backfill: { status: string; evidence: string[] };
  reconciliation: { status: string; evidence: string[] };
  cutover: { status: string; blockers: string[]; nextAction: string };
  retirement: { status: string; action: string };
};

type AuthorityMatrix = {
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
  concepts: MatrixConcept[];
};

type CanonicalSourceOfTruth = {
  canonicalTables: Array<{ name: string }>;
};

type LegacyDisposition = {
  tables: Array<{ name: string }>;
};

describe('full HMS canonical authority matrix', () => {
  it('keeps the matrix, audit, and cutover plan present and substantial', () => {
    expect(fs.existsSync(files.matrix)).toBe(true);
    expect(fs.existsSync(files.report)).toBe(true);
    expect(fs.existsSync(files.plan)).toBe(true);
    expect(read(files.matrix).length).toBeGreaterThan(20_000);
    expect(read(files.report).length).toBeGreaterThan(8_000);
    expect(read(files.plan).length).toBeGreaterThan(5_000);
  });

  it('declares one canonical program and rejects the parallel finance architecture', () => {
    const matrix = readJson<AuthorityMatrix>(files.matrix);
    expect(matrix.version).toBe(1);
    expect(matrix.program).toBe('hms-canonical-data-architecture');
    expect(matrix.scope).toBe('full_hms_business_fact_authority_and_legacy_cutover');
    expect(matrix.authorityPolicy.oneAuthorityPerFact).toBe(true);
    expect(matrix.authorityPolicy.canonicalOnlyImplementationRoots).toEqual([
      'src/lib/canonical/**',
      'src/db/schema/canonical/**',
      'scripts/canonical/**',
      'test/canonical/**',
    ]);
    expect(matrix.authorityPolicy.rejectedParallelArchitectures).toContain(
      'src/lib/financial-reconciliation/**',
    );
    expect(matrix.authorityPolicy.productionMutationAuthorized).toBe(false);
    expect(matrix.authorityPolicy.destructiveRetirementAuthorized).toBe(false);
    expect(matrix.authorityPolicy.localSyncExpansionPaused).toBe(true);
  });

  it('registers unique business concepts with complete cutover metadata', () => {
    const matrix = readJson<AuthorityMatrix>(files.matrix);
    expect(matrix.concepts.length).toBeGreaterThanOrEqual(40);
    const ids = matrix.concepts.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const concept of matrix.concepts) {
      expect(concept.id).toMatch(/^[a-z0-9_]+$/);
      expect(concept.domain.length).toBeGreaterThan(1);
      expect(concept.fact.length).toBeGreaterThan(3);
      expect(allowedTargetStatuses.has(concept.targetAuthority.status), concept.id).toBe(true);
      if (concept.targetAuthority.status === 'canonical_gap') {
        expect(concept.targetAuthority.tables, concept.id).toEqual([]);
        expect(concept.targetAuthority.gap?.length ?? 0, concept.id).toBeGreaterThan(10);
      } else {
        expect(concept.targetAuthority.tables.length, concept.id).toBeGreaterThan(0);
      }
      expect(concept.currentSources.length, concept.id).toBeGreaterThan(0);
      for (const source of concept.currentSources) {
        expect(source.table.length, concept.id).toBeGreaterThan(1);
        expect(allowedSourceClassifications.has(source.classification), `${concept.id}:${source.table}`).toBe(true);
        expect(source.disposition.length, `${concept.id}:${source.table}`).toBeGreaterThan(3);
      }
      expect(allowedBackfillStatuses.has(concept.backfill.status), concept.id).toBe(true);
      expect(allowedReconciliationStatuses.has(concept.reconciliation.status), concept.id).toBe(true);
      expect(allowedCutoverStatuses.has(concept.cutover.status), concept.id).toBe(true);
      expect(concept.cutover.nextAction.length, concept.id).toBeGreaterThan(10);
      expect(allowedRetirementStatuses.has(concept.retirement.status), concept.id).toBe(true);
      expect(concept.retirement.action.length, concept.id).toBeGreaterThan(10);
    }
  });

  it('assigns every registered canonical table to exactly one owning concept', () => {
    const matrix = readJson<AuthorityMatrix>(files.matrix);
    const sourceOfTruth = readJson<CanonicalSourceOfTruth>(files.sourceOfTruth);
    const expected = sourceOfTruth.canonicalTables.map((table) => table.name).sort();
    const owned = matrix.concepts
      .filter((concept) =>
        concept.targetAuthority.status === 'implemented_canonical'
        || concept.targetAuthority.status === 'partial_canonical')
      .flatMap((concept) => concept.targetAuthority.tables);
    const ownershipCounts = new Map<string, number>();
    for (const table of owned) ownershipCounts.set(table, (ownershipCounts.get(table) ?? 0) + 1);

    expect([...new Set(owned)].sort()).toEqual(expected);
    for (const table of expected) expect(ownershipCounts.get(table), table).toBe(1);
    expect(matrix.summary.canonicalTableCount).toBe(expected.length);
  });

  it('covers every governed legacy table and exposes material canonical gaps', () => {
    const matrix = readJson<AuthorityMatrix>(files.matrix);
    const legacy = readJson<LegacyDisposition>(files.legacyDisposition);
    const registeredSources = new Set(
      matrix.concepts.flatMap((concept) => concept.currentSources.map((source) => source.table)),
    );
    for (const table of legacy.tables) expect(registeredSources.has(table.name), table.name).toBe(true);

    const counts = {
      implemented: matrix.concepts.filter((c) => c.targetAuthority.status === 'implemented_canonical').length,
      partial: matrix.concepts.filter((c) => c.targetAuthority.status === 'partial_canonical').length,
      gap: matrix.concepts.filter((c) => c.targetAuthority.status === 'canonical_gap').length,
      external: matrix.concepts.filter((c) => c.targetAuthority.status === 'external_governed').length,
    };
    expect(counts.implemented).toBeGreaterThanOrEqual(15);
    expect(counts.gap).toBeGreaterThanOrEqual(10);
    expect(matrix.summary.conceptCount).toBe(matrix.concepts.length);
    expect(matrix.summary.implementedCanonicalCount).toBe(counts.implemented);
    expect(matrix.summary.partialCanonicalCount).toBe(counts.partial);
    expect(matrix.summary.canonicalGapCount).toBe(counts.gap);
    expect(matrix.summary.externalGovernedCount).toBe(counts.external);
    expect(matrix.summary.registeredLegacyTableCount).toBe(legacy.tables.length);
  });

  it('references real repository code paths and never appoints the rejected finance tree', () => {
    const matrix = readJson<AuthorityMatrix>(files.matrix);
    const paths = matrix.concepts.flatMap((concept) => [
      ...concept.targetAuthority.modules,
      ...concept.directWriters,
      ...concept.readConsumers,
      ...concept.backfill.evidence,
      ...concept.reconciliation.evidence,
    ]);
    for (const relativePath of paths) {
      expect(relativePath).not.toContain('src/lib/financial-reconciliation');
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(true);
    }
  });
});
