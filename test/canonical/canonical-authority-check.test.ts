import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkCanonicalAuthority,
  type AuthorityMatrix,
  type CanonicalAuthorityCheckInput,
  type CanonicalSourceRegistry,
  type LegacyDispositionRegistry,
} from '../../scripts/canonical/check-canonical-authority';

const root = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fixture(overrides: Partial<CanonicalAuthorityCheckInput> = {}): CanonicalAuthorityCheckInput {
  return {
    root,
    matrix: readJson<AuthorityMatrix>('docs/database/canonical-authority-matrix.yaml'),
    canonicalRegistry: readJson<CanonicalSourceRegistry>('docs/database/canonical-source-of-truth.yaml'),
    legacyRegistry: readJson<LegacyDispositionRegistry>('docs/database/legacy-table-disposition.yaml'),
    ...overrides,
  };
}

function issueCodes(input: CanonicalAuthorityCheckInput): string[] {
  return checkCanonicalAuthority(input).issues.map((issue) => issue.code);
}

describe('canonical authority checker', () => {
  it('passes the reviewed repository authority contract', () => {
    const result = checkCanonicalAuthority({ root });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary).toEqual({
      concepts: 46,
      canonicalTables: 121,
      governedLegacyTables: 5,
      implementedCanonicalConcepts: 18,
      partialCanonicalConcepts: 16,
      canonicalGaps: 10,
      externalGovernedConcepts: 2,
    });
  });

  it('fails closed when a canonical table has multiple owners', () => {
    const input = fixture();
    const matrix = clone(input.matrix!);
    const table = matrix.concepts[0].targetAuthority.tables[0];
    const secondOwner = matrix.concepts.find(
      (concept, index) => index > 0 && concept.targetAuthority.status === 'implemented_canonical',
    );
    expect(secondOwner).toBeDefined();
    secondOwner!.targetAuthority.tables.push(table);

    expect(issueCodes({ ...input, matrix })).toContain('AUTH_CANONICAL_TABLE_MULTIPLE_OWNERS');
  });

  it('fails closed when a registered canonical table is unowned', () => {
    const input = fixture();
    const matrix = clone(input.matrix!);
    const removed = matrix.concepts[0].targetAuthority.tables.shift();
    expect(removed).toBeTruthy();

    expect(issueCodes({ ...input, matrix })).toContain('AUTH_CANONICAL_TABLE_UNOWNED');
  });

  it('rejects canonical tables assigned to gap or external concepts', () => {
    const input = fixture();
    const matrix = clone(input.matrix!);
    const gap = matrix.concepts.find((concept) => concept.targetAuthority.status === 'canonical_gap');
    expect(gap).toBeDefined();
    gap!.targetAuthority.tables.push(matrix.concepts[0].targetAuthority.tables[0]);

    expect(issueCodes({ ...input, matrix })).toContain('AUTH_CANONICAL_TABLE_INVALID_OWNER_STATUS');
  });

  it('fails when a governed legacy table is absent from the authority concepts', () => {
    const input = fixture();
    const matrix = clone(input.matrix!);
    const legacyTable = input.legacyRegistry!.tables[0].name;
    for (const concept of matrix.concepts) {
      concept.currentSources = concept.currentSources.filter((source) => source.table !== legacyTable);
    }

    expect(issueCodes({ ...input, matrix })).toContain('AUTH_LEGACY_TABLE_UNREGISTERED');
  });

  it('fails on summary drift and missing repository evidence', () => {
    const input = fixture();
    const matrix = clone(input.matrix!);
    matrix.summary.conceptCount += 1;
    matrix.concepts[0].directWriters.push('src/does-not-exist/canonical-writer.ts');

    const codes = issueCodes({ ...input, matrix });
    expect(codes).toContain('AUTH_SUMMARY_DRIFT');
    expect(codes).toContain('AUTH_EVIDENCE_PATH_MISSING');
  });

  it('rejects any authority reference to a parallel architecture', () => {
    const input = fixture();
    const matrix = clone(input.matrix!);
    matrix.concepts[0].targetAuthority.modules.push('src/lib/financial-reconciliation/payroll-events.ts');

    expect(issueCodes({ ...input, matrix })).toContain('AUTH_REJECTED_ARCHITECTURE_REFERENCE');
  });

  it('keeps the package command mandatory inside canonical:check', () => {
    const packageJson = readJson<{ scripts: Record<string, string> }>('package.json');

    expect(packageJson.scripts['canonical:authority-check']).toBe(
      'tsx scripts/canonical/check-canonical-authority.ts',
    );
    expect(packageJson.scripts['canonical:check']).toContain('canonical:authority-check');
    expect(packageJson.scripts['canonical:check']).toContain('canonical:schema-check');
  });
});
