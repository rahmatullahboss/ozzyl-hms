import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildAllTenantReconciliationPackageForCurrentHead,
  serializeAllTenantReconciliationPackage,
} from '../../scripts/canonical/prepare-all-tenant-reconciliation-package';
import {
  CDB_V1_070C_PACKAGE_PATH,
  evaluateAllTenantReconciliationPackage,
} from '../../scripts/canonical/all-tenant-reconciliation-package';

function stableDocument(value: ReturnType<typeof buildAllTenantReconciliationPackageForCurrentHead>) {
  const clone = structuredClone(value);
  clone.preparation.repositoryCommit = '<CURRENT_HEAD>';
  clone.preparation.buildSha = '<CURRENT_HEAD>';
  return clone;
}

describe('prepare CDB-V1-070C reconciliation package', () => {
  it('builds deterministic repository-bound bytes with every operation still closed', () => {
    const first = buildAllTenantReconciliationPackageForCurrentHead(process.cwd());
    const second = buildAllTenantReconciliationPackageForCurrentHead(process.cwd());
    const bytes = serializeAllTenantReconciliationPackage(first);
    const committed = readFileSync(CDB_V1_070C_PACKAGE_PATH, 'utf8');
    const committedDocument = JSON.parse(committed);
    const evaluation = evaluateAllTenantReconciliationPackage(process.cwd(), first);
    const committedEvaluation = evaluateAllTenantReconciliationPackage(process.cwd(), committedDocument);

    expect(stableDocument(first)).toEqual(stableDocument(second));
    expect(bytes.endsWith('\n')).toBe(true);
    expect(committed.endsWith('\n')).toBe(true);
    expect(committedEvaluation.packageReady).toBe(true);
    expect(evaluation).toMatchObject({
      packageReady: true,
      authorizationReady: false,
      executionReady: false,
      issues: [],
      migrationCount: 4,
      archivalForeignKeyGroupCount: 2,
      commandCount: 4,
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      trafficChanged: false,
    });
    expect(first.commands.every((command) => command.executable === false)).toBe(true);
    expect(Object.values(first.permissions).every((value) => value === false)).toBe(true);
    expect(first.externalBindings.candidate).toEqual({ branch: null, commit: null, buildSha: null });
    expect(first.safety).toMatchObject({
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      migrationSqlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      businessRowsWritten: 0,
      archivalTableMutationPerformed: false,
      trafficChanged: false,
      pushPerformed: false,
      cdbToMainIntegrationPerformed: false,
    });
  });
});
