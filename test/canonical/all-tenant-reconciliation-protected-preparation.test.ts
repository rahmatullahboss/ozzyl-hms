import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectAllTenantReconciliationEvidence,
  createProductionAllTenantReconciliationReadGateway,
  unexpectedArchivalRuntimeReferenceCount,
  type AllTenantReconciliationReadGateway,
} from '../../scripts/canonical/collect-all-tenant-reconciliation-evidence';
import {
  prepareAllTenantReconciliationExecutionAuthorization,
  validateCdbV1070cOwnerApprovalText,
} from '../../scripts/canonical/prepare-all-tenant-reconciliation-execution-authorization';
import type { AllTenantReconciliationAggregateState } from '../../scripts/canonical/all-tenant-reconciliation-executor';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_PACKAGE_PATH,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
  type AllTenantReconciliationPackage,
} from '../../scripts/canonical/all-tenant-reconciliation-package';
import { CDB_V1_070A_MIGRATION_NAMES } from '../../scripts/canonical/all-tenant-shadow-execution-package';

const CANDIDATE = 'e2f6365130946d9ce0cbf4ab1bf3af2ec71e4170';
const roots: string[] = [];

const approvalText = `আমি Rahmatullah Zisan, CDB-V1-070C Schema-Ledger and Archival FK Reconciliation-এর জন্য exact authorization দিচ্ছি।
Candidate main commit ও build SHA ${CANDIDATE}; production D1 hms-super-admin-production-apac, UUID c68a5360-a2c1-44cc-9e71-f21057bea102; tenants 1, 100, 101, 102।
Aggregate-only non-PHI production reads অনুমোদিত।
0549_approval_revision_policy.sql
0551_workforce_roster_integrity.sql
0552_attendance_projection_integrity.sql
0570_doctor_commission_rule_version_snapshot.sql
Expected pending migrations 29 থেকে 25 হবে। Migration SQL execution 0, DDL execution 0 এবং business-table row write 0 থাকতে হবে।
doctor_commission_accruals_old_0391 bills 26 visits 15 মোট 41। Archival rows পরিবর্তন বা delete করা যাবে না।
Production migration SQL, DDL, business-table write, backfill, provider flag change, Worker version upload বা deployment, traffic assignment বা change, route change, Canonical read/write promotion, local-sync activation, Legacy retirement, archival-table mutation বা deletion, destructive action, database deletion, push এবং CDB-to-main integration অনুমোদিত নয়।
Legacy final response authority বজায় থাকবে। automatic abort করতে হবে।
Approval source: user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization`;

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070c-protected-'));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function gateReceiptFixtures(root: string): { gateA: string; gateB: string } {
  const gateA = join(root, 'gate-a-receipt.json');
  const gateB = join(root, 'gate-b-receipt.json');
  writeFileSync(gateA, JSON.stringify({
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-CAPTURE-COMPLETE',
    evidenceOutput: { receiptId: 'cdb-v1-070b-receipt-fixture' },
  }), { mode: 0o600 });
  writeFileSync(gateB, JSON.stringify({
    schemaVersion: 1,
    checkpoint: 'CDB-V1-070-GATE-B-AUTHORIZATION-PACKAGE-PREPARATION',
    candidate: { commit: '8111246d9362b66f380c3248af29ad61b671e4f3' },
  }), { mode: 0o600 });
  chmodSync(gateA, 0o600);
  chmodSync(gateB, 0o600);
  return { gateA, gateB };
}

function readyState(): AllTenantReconciliationAggregateState {
  return {
    database: {
      name: 'hms-super-admin-production-apac',
      uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
    },
    pendingMigrationNames: [...CDB_V1_070A_MIGRATION_NAMES],
    targetLedgerEntriesPresent: [],
    postSchemaExact: Object.fromEntries(
      CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((entry) => [entry.name, true]),
    ),
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

class ReadGateway implements AllTenantReconciliationReadGateway {
  public reads = 0;
  async readAggregateState(): Promise<AllTenantReconciliationAggregateState> {
    this.reads += 1;
    return readyState();
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-070C protected preparation', () => {
  it('writes deterministic aggregate-only evidence as mode-600 files in a mode-700 external directory', async () => {
    const outputDirectory = protectedRoot();
    const gateway = new ReadGateway();
    expect(unexpectedArchivalRuntimeReferenceCount(process.cwd())).toBe(0);
    const result = await collectAllTenantReconciliationEvidence({
      repositoryRoot: process.cwd(),
      outputDirectory,
      candidateCommit: CANDIDATE,
      capturedAtUtc: '2026-07-31T03:00:00.000Z',
    }, gateway);

    expect(gateway.reads).toBe(1);
    expect(result.manifestPath).toBe(join(outputDirectory, 'preauthorization-evidence-manifest.json'));
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      candidateCommit: CANDIDATE,
      capturedAtUtc: '2026-07-31T03:00:00.000Z',
      aggregateOnly: true,
      productionReadPerformed: true,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      trafficChanged: false,
    });
    expect(result.manifest.entries).toHaveLength(4);
    expect(lstatSync(outputDirectory).mode & 0o777).toBe(0o700);
    for (const file of result.files) {
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      expect(lstatSync(file).nlink).toBe(1);
      expect(lstatSync(file).isSymbolicLink()).toBe(false);
    }
  });

  it('parses exact Wrangler aggregate reads and enforces the read-only boundary', async () => {
    const envelope = (results: Array<Record<string, unknown>>, changedDb = false) => JSON.stringify([{
      success: true,
      results,
      meta: { changed_db: changedDb, rows_written: 0 },
    }]);
    const outputs = [
      JSON.stringify({
        name: 'hms-super-admin-production-apac',
        uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      }),
      envelope(CDB_V1_070A_MIGRATION_NAMES.map((name) => ({ name }))),
      envelope([]),
      envelope([{ all_schema_exact: 1 }]),
      envelope(CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((group) => ({
        child_table: group.childTable,
        parent_table: group.parentTable,
        violation_count: group.rawViolationCount,
      }))),
      envelope([{
        archival_row_count: 1358,
        archival_latest_updated_at: '2026-07-06 04:37:28',
        active_row_count: 3206,
        active_latest_created_at: '2026-07-30 21:46:07',
        trigger_count: 0,
        dependent_object_count: 0,
      }]),
    ];
    const calls: string[][] = [];
    const gateway = createProductionAllTenantReconciliationReadGateway((args) => {
      calls.push(args);
      const stdout = outputs.shift();
      if (!stdout) throw new Error('unexpected runner call');
      return { status: 0, stderr: '', stdout };
    }, process.cwd());

    const state = await gateway.readAggregateState();

    expect(outputs).toHaveLength(0);
    expect(calls).toHaveLength(6);
    expect(state).toMatchObject({
      database: {
        name: 'hms-super-admin-production-apac',
        uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      },
      targetLedgerEntriesPresent: [],
      archivalDisposition: {
        archivalRowCount: 1358,
        activeRowCount: 3206,
        triggerCount: 0,
        dependentObjectCount: 0,
        runtimeSourceReferenceCount: 0,
        excludedFromCanonicalImport: true,
        excludedFromReporting: true,
      },
    });
    expect(state.pendingMigrationNames).toEqual(CDB_V1_070A_MIGRATION_NAMES);
    expect(Object.values(state.postSchemaExact).every(Boolean)).toBe(true);

    const badOutputs = [
      JSON.stringify({
        name: 'hms-super-admin-production-apac',
        uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      }),
      envelope(CDB_V1_070A_MIGRATION_NAMES.map((name) => ({ name })), true),
    ];
    const badGateway = createProductionAllTenantReconciliationReadGateway(() => ({
      status: 0,
      stderr: '',
      stdout: badOutputs.shift() ?? '',
    }), process.cwd());
    await expect(badGateway.readAggregateState()).rejects.toThrow(/read-only boundary/i);
  });

  it('prepares an exact protected authorization bound to fresh evidence and validates it', async () => {
    const outputDirectory = protectedRoot();
    const approvalPath = join(outputDirectory, 'owner-authorization.txt');
    writeFileSync(approvalPath, approvalText, { mode: 0o600 });
    chmodSync(approvalPath, 0o600);
    const evidence = await collectAllTenantReconciliationEvidence({
      repositoryRoot: process.cwd(),
      outputDirectory,
      candidateCommit: CANDIDATE,
      capturedAtUtc: '2026-07-31T03:00:00.000Z',
    }, new ReadGateway());
    const authorizationPath = join(outputDirectory, 'authorization.json');
    const receipts = gateReceiptFixtures(outputDirectory);
    const packageDocument = JSON.parse(
      readFileSync(CDB_V1_070C_PACKAGE_PATH, 'utf8'),
    ) as AllTenantReconciliationPackage;

    const prepared = prepareAllTenantReconciliationExecutionAuthorization({
      repositoryRoot: process.cwd(),
      packageDocument,
      evidenceManifestPath: evidence.manifestPath,
      gateAReceiptPath: receipts.gateA,
      gateBReceiptPath: receipts.gateB,
      ownerApprovalEvidencePath: approvalPath,
      outputPath: authorizationPath,
      candidateCommit: CANDIDATE,
      atUtc: '2026-07-31T03:05:00.000Z',
    });

    expect(prepared.validation.authorizationReady).toBe(true);
    expect(prepared.authorization.repository.candidateCommit).toBe(CANDIDATE);
    expect(prepared.authorization.owner.approvalSource)
      .toBe('user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization');
    expect(prepared.authorization.reconciliation.entries).toHaveLength(4);
    expect(prepared.authorization.foreignKeyDisposition).toMatchObject({
      rawArchivalViolationCount: 41,
      formallyWaivedViolationCount: 41,
      effectiveUnwaivedViolationCount: 0,
      activeViolationCount: 0,
      unknownViolationCount: 0,
    });
    expect(lstatSync(authorizationPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(authorizationPath).nlink).toBe(1);
  });

  it('rejects stale aggregate evidence before authorization generation', async () => {
    const outputDirectory = protectedRoot();
    const approvalPath = join(outputDirectory, 'owner-authorization.txt');
    writeFileSync(approvalPath, approvalText, { mode: 0o600 });
    chmodSync(approvalPath, 0o600);
    const evidence = await collectAllTenantReconciliationEvidence({
      repositoryRoot: process.cwd(),
      outputDirectory,
      candidateCommit: CANDIDATE,
      capturedAtUtc: '2026-07-31T02:00:00.000Z',
    }, new ReadGateway());
    const receipts = gateReceiptFixtures(outputDirectory);
    const packageDocument = JSON.parse(
      readFileSync(CDB_V1_070C_PACKAGE_PATH, 'utf8'),
    ) as AllTenantReconciliationPackage;

    expect(() => prepareAllTenantReconciliationExecutionAuthorization({
      repositoryRoot: process.cwd(),
      packageDocument,
      evidenceManifestPath: evidence.manifestPath,
      gateAReceiptPath: receipts.gateA,
      gateBReceiptPath: receipts.gateB,
      ownerApprovalEvidencePath: approvalPath,
      outputPath: join(outputDirectory, 'authorization.json'),
      candidateCommit: CANDIDATE,
      atUtc: '2026-07-31T03:05:00.000Z',
    })).toThrow(/fresh/i);
  });

  it('rejects incomplete approval evidence and unsafe protected paths', async () => {
    expect(() => validateCdbV1070cOwnerApprovalText('continue'))
      .toThrow(/exact owner authorization/i);

    const root = protectedRoot();
    const target = join(root, 'target');
    const linked = join(root, 'linked');
    writeFileSync(target, 'x', { mode: 0o600 });
    symlinkSync(target, linked);
    await expect(collectAllTenantReconciliationEvidence({
      repositoryRoot: process.cwd(),
      outputDirectory: linked,
      candidateCommit: CANDIDATE,
      capturedAtUtc: '2026-07-31T03:00:00.000Z',
    }, new ReadGateway())).rejects.toThrow(/protected directory/i);
  });
});
