import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLegacyWriteRetirementReport } from '../../scripts/canonical/legacy-write-retirement-report';

const roots: string[] = [];

function writeRegistry(root: string, registry: unknown): void {
  const directory = join(root, 'docs/database');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'legacy-table-disposition.yaml'),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8',
  );
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hms-legacy-retirement-'));
  roots.push(root);
  return root;
}

function allowance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: 'src/routes/tenant/billing.ts',
    table: 'bills',
    owner: 'billing-platform',
    removalPhase: 'P05',
    reason: 'Legacy billing write remains active before cutover.',
    lifecycleStatus: 'legacy_authority',
    retirementBlocker: 'Canonical billing cutover and observation are incomplete.',
    retirementTask: 'CDB-105B',
    reviewedAtUtc: '2026-07-24T22:28:40Z',
    ...overrides,
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('legacy write retirement report', () => {
  it('builds a deterministic aggregate from classified direct-write allowances', () => {
    const root = createRoot();
    writeRegistry(root, {
      version: 1,
      tables: [
        {
          name: 'payments',
          owner: 'finance-platform',
          disposition: 'active_legacy',
          writePolicy: 'allowed_until_cutover',
          removalPhase: 'P06',
          reason: 'Legacy payments remain active before cutover.',
        },
        {
          name: 'bills',
          owner: 'billing-platform',
          disposition: 'active_legacy',
          writePolicy: 'allowed_until_cutover',
          removalPhase: 'P05',
          reason: 'Legacy bills remain active before cutover.',
        },
      ],
      directWriteAllowlist: [
        allowance({
          path: 'src/lib/canonical/settlement-finalization.ts',
          table: 'payments',
          owner: 'finance-platform',
          removalPhase: 'P06',
          lifecycleStatus: 'canonical_compatibility',
        }),
        allowance(),
        allowance({
          path: 'src/lib/canonical/tenant-100-financial-smoke-fixture.ts',
          lifecycleStatus: 'protected_fixture',
        }),
      ],
      duplicateMigrationNumbers: [],
      destructiveMigrations: [],
    });

    expect(buildLegacyWriteRetirementReport(root)).toEqual({
      tableCount: 2,
      allowanceCount: 3,
      byTable: { bills: 2, payments: 1 },
      byOwner: { 'billing-platform': 2, 'finance-platform': 1 },
      byLifecycleStatus: {
        canonical_compatibility: 1,
        legacy_authority: 1,
        protected_fixture: 1,
      },
      byRemovalPhase: { P05: 2, P06: 1 },
      retirementTasks: { 'CDB-105B': 3 },
      paths: [
        'src/lib/canonical/settlement-finalization.ts',
        'src/lib/canonical/tenant-100-financial-smoke-fixture.ts',
        'src/routes/tenant/billing.ts',
      ],
    });
  });

  it('rejects missing lifecycle evidence and duplicate exact scopes', () => {
    const root = createRoot();
    const duplicate = allowance({ retirementBlocker: '' });
    writeRegistry(root, {
      version: 1,
      tables: [
        {
          name: 'bills',
          owner: 'billing-platform',
          disposition: 'active_legacy',
          writePolicy: 'allowed_until_cutover',
          removalPhase: 'P05',
          reason: 'Legacy bills remain active before cutover.',
        },
      ],
      directWriteAllowlist: [duplicate, duplicate],
      duplicateMigrationNumbers: [],
      destructiveMigrations: [],
    });

    expect(() => buildLegacyWriteRetirementReport(root)).toThrow(
      /invalid direct-write retirement evidence/i,
    );
  });
});
