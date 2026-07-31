import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCanonicalAuthorityAccessRegistry,
  type CanonicalAuthorityAccessRegistry,
} from '../../scripts/canonical/canonical-authority-access';
import {
  checkCanonicalAuthorityAccess,
  type CanonicalAuthorityAccessCheckInput,
} from '../../scripts/canonical/check-canonical-authority-access';

const root = process.cwd();
const registryPath = path.join(root, 'docs/database/canonical-authority-access-registry.yaml');

let reviewed: CanonicalAuthorityAccessRegistry;
let discovered: CanonicalAuthorityAccessRegistry;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function issueCodes(input: CanonicalAuthorityAccessCheckInput): string[] {
  return checkCanonicalAuthorityAccess(input).issues.map((issue) => issue.code);
}

beforeAll(() => {
  reviewed = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as CanonicalAuthorityAccessRegistry;
  discovered = buildCanonicalAuthorityAccessRegistry({ root, reviewedAt: reviewed.reviewedAt });
});

describe('canonical authority writer and reader access registry', () => {
  it('matches the reviewed repository discovery exactly', () => {
    const result = checkCanonicalAuthorityAccess({ root, registry: reviewed, discovered });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary).toEqual(reviewed.summary);
    expect(reviewed.summary.governedTableCount).toBeGreaterThanOrEqual(180);
    expect(reviewed.summary.writerCount).toBeGreaterThan(100);
    expect(reviewed.summary.readerCount).toBeGreaterThan(200);
  });

  it('fails closed for an unregistered discovered writer', () => {
    const registry = clone(reviewed);
    registry.writers.shift();

    expect(issueCodes({ root, registry, discovered })).toContain('ACCESS_WRITER_UNREGISTERED');
  });

  it('fails closed for an unregistered discovered reader', () => {
    const registry = clone(reviewed);
    registry.readers.shift();

    expect(issueCodes({ root, registry, discovered })).toContain('ACCESS_READER_UNREGISTERED');
  });

  it('fails closed for stale and duplicate registry entries', () => {
    const registry = clone(reviewed);
    const stale = clone(registry.readers[0]);
    stale.path = 'package.json';
    registry.readers.push(stale, clone(registry.readers[0]));

    const codes = issueCodes({ root, registry, discovered });
    expect(codes).toContain('ACCESS_READER_STALE');
    expect(codes).toContain('ACCESS_ENTRY_DUPLICATE');
  });

  it('rejects invalid lifecycle and provider classifications', () => {
    const registry = clone(reviewed);
    registry.writers[0].lifecycleStatus = 'unknown_status' as never;
    registry.readers[0].providerStatus = 'unknown_provider' as never;

    const codes = issueCodes({ root, registry, discovered });
    expect(codes).toContain('ACCESS_WRITER_STATUS_INVALID');
    expect(codes).toContain('ACCESS_READER_STATUS_INVALID');
  });

  it('rejects unknown tables, concepts, and missing paths', () => {
    const registry = clone(reviewed);
    registry.writers[0].table = 'unknown_authority_table';
    registry.readers[0].conceptIds = ['unknown_authority_concept'];
    registry.readers[1].path = 'src/does-not-exist/authority-reader.ts';

    const codes = issueCodes({ root, registry, discovered });
    expect(codes).toContain('ACCESS_TABLE_UNKNOWN');
    expect(codes).toContain('ACCESS_CONCEPT_UNKNOWN');
    expect(codes).toContain('ACCESS_PATH_MISSING');
  });

  it('fails on summary drift and rejected architecture references', () => {
    const registry = clone(reviewed);
    registry.summary.writerCount += 1;
    registry.readers[0].path = 'src/lib/financial-reconciliation/payroll-events.ts';

    const codes = issueCodes({ root, registry, discovered });
    expect(codes).toContain('ACCESS_SUMMARY_DRIFT');
    expect(codes).toContain('ACCESS_REJECTED_ARCHITECTURE_REFERENCE');
  });

  it('keeps explicit generation and checking commands mandatory', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['canonical:access-registry-generate']).toBe(
      'tsx scripts/canonical/generate-canonical-authority-access-registry.ts',
    );
    expect(packageJson.scripts['canonical:access-check']).toBe(
      'tsx scripts/canonical/check-canonical-authority-access.ts',
    );
    expect(packageJson.scripts['canonical:check']).toContain('canonical:access-check');
  });
});
