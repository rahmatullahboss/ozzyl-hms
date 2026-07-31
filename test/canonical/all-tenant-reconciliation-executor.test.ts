import { describe, expect, it } from 'vitest';
import {
  buildAllTenantReconciliationEvidenceBundle,
  buildAtomicMigrationLedgerReconciliationSql,
  executeAuthorizedAllTenantReconciliation,
  type AllTenantReconciliationAggregateState,
  type AllTenantReconciliationExecutionGateway,
} from '../../scripts/canonical/all-tenant-reconciliation-executor';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
} from '../../scripts/canonical/all-tenant-reconciliation-package';
import { CDB_V1_070A_MIGRATION_NAMES } from '../../scripts/canonical/all-tenant-shadow-execution-package';
import { reconciliationAuthorization } from './all-tenant-reconciliation-test-fixture';

const CANDIDATE = 'e2f6365130946d9ce0cbf4ab1bf3af2ec71e4170';

function readyState(after = false): AllTenantReconciliationAggregateState {
  const targets = new Set(CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => entry.name));
  return {
    database: {
      name: 'hms-super-admin-production-apac',
      uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
    },
    pendingMigrationNames: CDB_V1_070A_MIGRATION_NAMES.filter((name) => !after || !targets.has(name)),
    targetLedgerEntriesPresent: after ? [...targets] : [],
    postSchemaExact: Object.fromEntries(
      CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => [entry.name, true]),
    ) as Record<(typeof CDB_V1_070C_RECONCILIATION_MIGRATIONS)[number]['name'], boolean>,
    foreignKeyGroups: CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((group) => ({
      childTable: group.childTable,
      parentTable: group.parentTable,
      violationCount: group.rawViolationCount,
    })),
    archivalDisposition: {
      archivalRowCount: 41,
      archivalLatestUpdatedAtUtc: '2026-01-01T00:00:00.000Z',
      activeRowCount: 100,
      activeLatestCreatedAtUtc: '2026-07-01T00:00:00.000Z',
      triggerCount: 0,
      dependentObjectCount: 0,
      runtimeSourceReferenceCount: 0,
      excludedFromCanonicalImport: true,
      excludedFromReporting: true,
    },
  };
}

function bindAuthorizationToState(state: AllTenantReconciliationAggregateState) {
  const authorization = reconciliationAuthorization();
  authorization.repository.candidateCommit = CANDIDATE;
  authorization.repository.buildSha = CANDIDATE;
  const bundle = buildAllTenantReconciliationEvidenceBundle(state, CANDIDATE);
  authorization.reconciliation.entries = authorization.reconciliation.entries.map((entry) => {
    const evidence = bundle.entries.find((item) => item.name === entry.name);
    if (!evidence) throw new Error('missing evidence fixture');
    return {
      ...entry,
      schemaEvidenceId: evidence.schema.evidenceId,
      schemaEvidenceSha256: evidence.schema.sha256,
      ledgerEvidenceId: evidence.ledger.evidenceId,
      ledgerEvidenceSha256: evidence.ledger.sha256,
    };
  });
  authorization.foreignKeyDisposition.evidenceId = bundle.foreignKeyDisposition.evidenceId;
  authorization.foreignKeyDisposition.evidenceSha256 = bundle.foreignKeyDisposition.sha256;
  return authorization;
}

class MemoryGateway implements AllTenantReconciliationExecutionGateway {
  public writes: string[] = [];
  private readCount = 0;
  private deploymentReadCount = 0;

  constructor(
    private readonly before: AllTenantReconciliationAggregateState,
    private readonly after: AllTenantReconciliationAggregateState,
    private readonly writeResult = { changes: 4, rowsWritten: 4 },
    private readonly deploymentFingerprintBefore = 'deployment-fingerprint',
    private readonly deploymentFingerprintAfter = deploymentFingerprintBefore,
  ) {}

  async readWorkerDeploymentFingerprint(): Promise<string> {
    this.deploymentReadCount += 1;
    return this.deploymentReadCount <= 2
      ? this.deploymentFingerprintBefore
      : this.deploymentFingerprintAfter;
  }

  async readAggregateState(): Promise<AllTenantReconciliationAggregateState> {
    this.readCount += 1;
    return this.readCount === 1 ? structuredClone(this.before) : structuredClone(this.after);
  }

  async writeMigrationLedger(sql: string): Promise<{ changes: number; rowsWritten: number }> {
    this.writes.push(sql);
    return this.writeResult;
  }
}

describe('CDB-V1-070C production reconciliation executor', () => {
  it('builds deterministic aggregate-only evidence bound to the candidate', () => {
    const first = buildAllTenantReconciliationEvidenceBundle(readyState(false), CANDIDATE);
    const second = buildAllTenantReconciliationEvidenceBundle(readyState(false), CANDIDATE);

    expect(first).toEqual(second);
    expect(first.entries).toHaveLength(4);
    expect(first.entries.every((entry) => entry.schema.document.postSchemaExact === true)).toBe(true);
    expect(first.entries.every((entry) => entry.ledger.document.ledgerEntryInitiallyAbsent === true)).toBe(true);
    expect(first.foreignKeyDisposition.document).toMatchObject({
      rawArchivalViolationCount: 41,
      formallyWaivedViolationCount: 41,
      effectiveUnwaivedViolationCount: 0,
      activeViolationCount: 0,
      unknownViolationCount: 0,
    });
  });

  it('builds one atomic statement that can only insert the exact four ledger rows', () => {
    const sql = buildAtomicMigrationLedgerReconciliationSql();
    const upper = sql.toUpperCase();

    expect(upper.match(/INSERT\s+INTO\s+D1_MIGRATIONS/g)).toHaveLength(1);
    expect(upper).not.toMatch(/\b(ALTER|CREATE|DROP|UPDATE|DELETE|REPLACE|PRAGMA)\b/);
    expect(upper).not.toContain('BEGIN');
    expect(upper).not.toContain('COMMIT');
    for (const migration of CDB_V1_070C_RECONCILIATION_MIGRATIONS) {
      expect(sql).toContain(`'${migration.name}'`);
    }
    expect(sql).toContain('doctor_commission_accruals_old_0391');
    expect(sql).toContain('approval_revision');
    expect(sql).toContain('rule_version');
  });

  it('executes exactly one write and verifies the 29 to 25 transition', async () => {
    const before = readyState(false);
    const after = readyState(true);
    const authorization = bindAuthorizationToState(before);
    const gateway = new MemoryGateway(before, after);

    const receipt = await executeAuthorizedAllTenantReconciliation(authorization, gateway);

    expect(gateway.writes).toHaveLength(1);
    expect(receipt).toMatchObject({
      reconciled: true,
      pendingMigrationCountBefore: 29,
      pendingMigrationCountAfter: 25,
      migrationLedgerRowsWritten: 4,
      migrationSqlStatementsExecuted: 0,
      ddlStatementsExecuted: 0,
      businessRowsWritten: 0,
      rawArchivalForeignKeyViolationsBefore: 41,
      rawArchivalForeignKeyViolationsAfter: 41,
      effectiveUnwaivedForeignKeyViolationsAfter: 0,
      finalResponseAuthority: 'legacy',
      trafficChanged: false,
    });
  });

  it('accepts Cloudflare D1 when either successful write counter reports the exact four rows', async () => {
    const before = readyState(false);
    const after = readyState(true);
    const authorization = bindAuthorizationToState(before);

    const changesOnly = new MemoryGateway(before, after, { changes: 4, rowsWritten: 0 });
    await expect(executeAuthorizedAllTenantReconciliation(authorization, changesOnly))
      .resolves.toMatchObject({ reconciled: true, migrationLedgerRowsWritten: 4 });
    expect(changesOnly.writes).toHaveLength(1);

    const rowsOnly = new MemoryGateway(before, after, { changes: 0, rowsWritten: 4 });
    await expect(executeAuthorizedAllTenantReconciliation(authorization, rowsOnly))
      .resolves.toMatchObject({ reconciled: true, migrationLedgerRowsWritten: 4 });
    expect(rowsOnly.writes).toHaveLength(1);
  });

  it('aborts before write on target, ledger, schema, FK, evidence or write-count drift', async () => {
    const base = readyState(false);
    const authorization = bindAuthorizationToState(base);

    const target = readyState(false);
    target.database.uuid = '00000000-0000-4000-8000-000000000000';
    const targetGateway = new MemoryGateway(target, readyState(true));
    await expect(executeAuthorizedAllTenantReconciliation(authorization, targetGateway))
      .rejects.toThrow(/identity/i);
    expect(targetGateway.writes).toHaveLength(0);

    const ledger = readyState(false);
    ledger.targetLedgerEntriesPresent = [CDB_V1_070C_RECONCILIATION_MIGRATIONS[0].name];
    const ledgerGateway = new MemoryGateway(ledger, readyState(true));
    await expect(executeAuthorizedAllTenantReconciliation(authorization, ledgerGateway))
      .rejects.toThrow(/ledger/i);
    expect(ledgerGateway.writes).toHaveLength(0);

    const schema = readyState(false);
    schema.postSchemaExact[CDB_V1_070C_RECONCILIATION_MIGRATIONS[1].name] = false;
    const schemaGateway = new MemoryGateway(schema, readyState(true));
    await expect(executeAuthorizedAllTenantReconciliation(authorization, schemaGateway))
      .rejects.toThrow(/schema/i);
    expect(schemaGateway.writes).toHaveLength(0);

    const fk = readyState(false);
    fk.foreignKeyGroups[0].violationCount = 25;
    const fkGateway = new MemoryGateway(fk, readyState(true));
    await expect(executeAuthorizedAllTenantReconciliation(authorization, fkGateway))
      .rejects.toThrow(/foreign key/i);
    expect(fkGateway.writes).toHaveLength(0);

    const archival = readyState(false);
    archival.archivalDisposition.triggerCount = 1;
    const archivalGateway = new MemoryGateway(archival, readyState(true));
    await expect(executeAuthorizedAllTenantReconciliation(authorization, archivalGateway))
      .rejects.toThrow(/archival disposition/i);
    expect(archivalGateway.writes).toHaveLength(0);

    const evidence = bindAuthorizationToState(base);
    evidence.reconciliation.entries[0].schemaEvidenceSha256 = '0'.repeat(64);
    const evidenceGateway = new MemoryGateway(base, readyState(true));
    await expect(executeAuthorizedAllTenantReconciliation(evidence, evidenceGateway))
      .rejects.toThrow(/evidence/i);
    expect(evidenceGateway.writes).toHaveLength(0);

    const writeGateway = new MemoryGateway(base, readyState(true), { changes: 3, rowsWritten: 3 });
    await expect(executeAuthorizedAllTenantReconciliation(authorization, writeGateway))
      .rejects.toThrow(/exactly four/i);
  });

  it('fails after write when post-state is not exact and never performs a second write', async () => {
    const before = readyState(false);
    const badAfter = readyState(true);
    badAfter.pendingMigrationNames.push(CDB_V1_070C_RECONCILIATION_MIGRATIONS[0].name);
    const authorization = bindAuthorizationToState(before);
    const gateway = new MemoryGateway(before, badAfter);

    await expect(executeAuthorizedAllTenantReconciliation(authorization, gateway))
      .rejects.toThrow(/post-state/i);
    expect(gateway.writes).toHaveLength(1);
  });

  it('fails closed when Worker deployment assignment changes during reconciliation', async () => {
    const before = readyState(false);
    const authorization = bindAuthorizationToState(before);
    const gateway = new MemoryGateway(
      before,
      readyState(true),
      { changes: 4, rowsWritten: 4 },
      'deployment-before',
      'deployment-after',
    );

    await expect(executeAuthorizedAllTenantReconciliation(authorization, gateway))
      .rejects.toThrow(/worker deployment/i);
    expect(gateway.writes).toHaveLength(1);
  });
});
