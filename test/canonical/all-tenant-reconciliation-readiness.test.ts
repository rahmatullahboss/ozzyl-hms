import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkAllTenantReconciliationReadiness,
  parseAllTenantReconciliationReadinessArgs,
  resolveAllTenantReconciliationRepositoryState,
} from '../../scripts/canonical/check-all-tenant-reconciliation-readiness';
import { loadAllTenantReconciliationAuthorization } from '../../scripts/canonical/all-tenant-reconciliation-authorization';
import {
  reconciliationAuthorization,
  reconciliationPackage,
} from './all-tenant-reconciliation-test-fixture';

const roots: string[] = [];
const NOW_UTC = '2026-07-31T00:30:00.000Z';

function protectedAuthorization(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070c-readiness-'));
  roots.push(root);
  chmodSync(root, 0o700);
  const path = join(root, 'authorization.json');
  writeFileSync(path, JSON.stringify(reconciliationAuthorization()), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-070C reconciliation readiness', () => {
  it('reports package ready but execution closed when exact authorization is absent', () => {
    const packageValue = reconciliationPackage();
    const repositoryState = resolveAllTenantReconciliationRepositoryState(
      process.cwd(),
      packageValue.preparation.repositoryCommit,
    );
    const result = checkAllTenantReconciliationReadiness(
      process.cwd(),
      packageValue,
      repositoryState,
      null,
    );

    expect(result).toMatchObject({
      packageReady: true,
      authorizationPresent: false,
      authorizationReady: false,
      executionReady: false,
      issueCount: 0,
      migrationCount: 4,
      archivalForeignKeyGroupCount: 2,
      commandCount: 4,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      trafficChanged: false,
    });
    expect(result.unresolvedExternalBindingCount).toBeGreaterThan(20);
  });

  it('reports bounded execution ready only with the exact protected authorization', () => {
    const packageValue = reconciliationPackage();
    const authorizationPath = protectedAuthorization();
    const authorizationResult = loadAllTenantReconciliationAuthorization(
      authorizationPath,
      process.cwd(),
      packageValue,
      NOW_UTC,
    );
    const repositoryState = resolveAllTenantReconciliationRepositoryState(
      process.cwd(),
      packageValue.preparation.repositoryCommit,
    );
    const result = checkAllTenantReconciliationReadiness(
      process.cwd(),
      packageValue,
      repositoryState,
      authorizationResult,
    );

    expect(result).toMatchObject({
      packageReady: true,
      authorizationPresent: true,
      authorizationReady: true,
      executionReady: true,
      issueCount: 0,
      authorizationIssues: [],
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      trafficChanged: false,
    });
  });

  it('fails closed on package or repository drift and rejects unknown CLI arguments', () => {
    const packageValue = reconciliationPackage();
    packageValue.scope.tenantIds = ['100'];
    const repositoryState = resolveAllTenantReconciliationRepositoryState(
      process.cwd(),
      packageValue.preparation.repositoryCommit,
    );
    const result = checkAllTenantReconciliationReadiness(
      process.cwd(),
      packageValue,
      repositoryState,
      null,
    );
    expect(result.packageReady).toBe(false);
    expect(result.executionReady).toBe(false);
    expect(result.issues).toContain('tenant scope mismatch');

    expect(() => parseAllTenantReconciliationReadinessArgs(['--unknown']))
      .toThrow('Unknown argument: --unknown');
  });
});
