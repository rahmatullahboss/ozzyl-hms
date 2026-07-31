import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_BRANCH,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
  buildAllTenantReconciliationPackage,
  evaluateAllTenantReconciliationPackage,
} from '../../scripts/canonical/all-tenant-reconciliation-package';

function head(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function readyPackage() {
  const commit = head();
  return buildAllTenantReconciliationPackage(process.cwd(), {
    branch: CDB_V1_070C_BRANCH,
    preparationCommit: commit,
    buildSha: commit,
  });
}

describe('CDB-V1-070C reconciliation package', () => {
  it('builds an immutable non-executing package for the exact four ledger entries and two archival FK groups', () => {
    const document = readyPackage();
    const result = evaluateAllTenantReconciliationPackage(process.cwd(), document);

    expect(document).toMatchObject({
      schemaVersion: 1,
      checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION-AUTHORIZATION-CONTRACT-READY',
      status: 'prepared_not_authorized',
      target: {
        databaseName: 'hms-super-admin-production-apac',
        databaseUuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
        environment: 'production',
        remote: true,
      },
      scope: {
        tenantIds: ['1', '100', '101', '102'],
        rawArchivalForeignKeyViolations: 41,
        formallyWaivedArchivalForeignKeyViolations: 41,
        effectiveUnwaivedForeignKeyViolations: 0,
        activeForeignKeyViolations: 0,
        unknownForeignKeyViolations: 0,
      },
      acceptance: {
        migrationLedgerRowsWritten: 4,
        migrationSqlStatementsExecuted: 0,
        ddlStatementsExecuted: 0,
        businessRowsWritten: 0,
        rawArchivalForeignKeyViolations: 41,
        formallyWaivedArchivalForeignKeyViolations: 41,
        effectiveUnwaivedForeignKeyViolations: 0,
        trafficChanged: false,
        finalResponseAuthority: 'legacy',
      },
      safety: {
        networkRequestPerformed: false,
        productionReadPerformed: false,
        productionMutationPerformed: false,
        migrationLedgerRowsWritten: 0,
        trafficChanged: false,
      },
    });
    expect(document.reconciliationMigrations).toEqual(CDB_V1_070C_RECONCILIATION_MIGRATIONS);
    expect(document.archivalForeignKeyGroups).toEqual(CDB_V1_070C_ARCHIVAL_FK_GROUPS);
    expect(document.commands).toHaveLength(4);
    expect(document.commands.every((command) => command.executable === false)).toBe(true);
    expect(Object.values(document.permissions).every((value) => value === false)).toBe(true);
    expect(result).toMatchObject({
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
    expect(result.unresolvedExternalBindings.length).toBeGreaterThan(20);
  });

  it('rejects target, tenant, migration, FK, permission and file-hash drift', () => {
    const target = readyPackage();
    target.target.databaseUuid = '00000000-0000-4000-8000-000000000000';
    expect(evaluateAllTenantReconciliationPackage(process.cwd(), target).issues)
      .toContain('production target mismatch');

    const tenant = readyPackage();
    tenant.scope.tenantIds = ['100'];
    expect(evaluateAllTenantReconciliationPackage(process.cwd(), tenant).issues)
      .toContain('tenant scope mismatch');

    const migration = readyPackage();
    migration.reconciliationMigrations[0].sha256 = '0'.repeat(64);
    expect(evaluateAllTenantReconciliationPackage(process.cwd(), migration).issues)
      .toContain('reconciliation migration contract mismatch');

    const fk = readyPackage();
    fk.archivalForeignKeyGroups[0].rawViolationCount = 25;
    expect(evaluateAllTenantReconciliationPackage(process.cwd(), fk).issues)
      .toContain('archival FK contract mismatch');

    const permission = readyPackage();
    permission.permissions.productionDdlAuthorized = true;
    expect(evaluateAllTenantReconciliationPackage(process.cwd(), permission).issues)
      .toContain('package permission boundary mismatch');

    const binding = readyPackage();
    binding.bindings.designSha256 = 'f'.repeat(64);
    expect(evaluateAllTenantReconciliationPackage(process.cwd(), binding).issues)
      .toContain('repository file hash mismatch');
  });
});
