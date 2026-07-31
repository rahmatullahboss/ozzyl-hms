import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAllTenantReconciliationAuthorizationPlan,
  buildAllTenantReconciliationConfirmationTokens,
  buildAllTenantReconciliationRepositoryBinding,
  loadAllTenantReconciliationAuthorization,
  parseAllTenantReconciliationAuthorizationJson,
  type AllTenantReconciliationAuthorization,
} from '../../scripts/canonical/all-tenant-reconciliation-authorization';
import {
  CDB_V1_070C_ARCHIVAL_FK_GROUPS,
  CDB_V1_070C_BRANCH,
  CDB_V1_070C_RECONCILIATION_MIGRATIONS,
  buildAllTenantReconciliationPackage,
} from '../../scripts/canonical/all-tenant-reconciliation-package';

const roots: string[] = [];
const NOW_UTC = '2026-07-31T00:30:00.000Z';

function head(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

function packageDocument() {
  const commit = head();
  return buildAllTenantReconciliationPackage(process.cwd(), {
    branch: CDB_V1_070C_BRANCH,
    preparationCommit: commit,
    buildSha: commit,
  });
}

function readyAuthorization(): AllTenantReconciliationAuthorization {
  const packageValue = packageDocument();
  const commit = head();
  const repository = buildAllTenantReconciliationRepositoryBinding(
    process.cwd(),
    packageValue,
    commit,
    commit,
    'gate-a-preparation-receipt-8111246d9',
    '1'.repeat(64),
    'gate-b-preparation-receipt-8111246d9',
    '2'.repeat(64),
  );
  const authorization: AllTenantReconciliationAuthorization = {
    schemaVersion: 1,
    authorizationId: 'cdb-v1-070c-reconciliation-20260731-01',
    operation: 'all_tenant_schema_ledger_archival_fk_reconciliation',
    target: {
      platform: 'cloudflare_d1',
      databaseName: 'hms-super-admin-production-apac',
      databaseUuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
      environment: 'production',
      remote: true,
    },
    timing: {
      issuedAtUtc: '2026-07-31T00:00:00.000Z',
      windowStartUtc: '2026-07-31T00:15:00.000Z',
      windowEndUtc: '2026-07-31T01:45:00.000Z',
      expiresAtUtc: '2026-07-31T02:00:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization',
      ownerModel: 'single_operator_risk_accepted',
      executionOwnerId: 'rahmatullah-zisan',
      rollbackOwnerId: 'rahmatullah-zisan',
      evidenceCustodianId: 'rahmatullah-zisan',
      riskAcceptanceEvidenceId: 'risk-cdb-v1-070c-20260731-01',
      riskAcceptanceEvidenceSha256: '3'.repeat(64),
      automaticAbortOnOperatorUnavailable: true,
    },
    repository,
    scope: {
      tenantIds: ['1', '100', '101', '102'],
      phiReadAllowed: false,
      rowLevelPatientReadAllowed: false,
    },
    reconciliation: {
      expectedPendingMigrationCountBefore: 29,
      expectedPendingMigrationCountAfter: 25,
      expectedLedgerRowsWritten: 4,
      atomic: true,
      entries: CDB_V1_070C_RECONCILIATION_MIGRATIONS.map((migration, index) => ({
        ...migration,
        schemaEvidenceId: `schema-evidence-${index + 1}`,
        schemaEvidenceSha256: '4567'[index].repeat(64),
        ledgerEvidenceId: `ledger-evidence-${index + 1}`,
        ledgerEvidenceSha256: '89ab'[index].repeat(64),
        ledgerEntryInitiallyAbsent: true,
        postSchemaExact: true,
        maximumLedgerRowsWritten: 1,
      })),
    },
    foreignKeyDisposition: {
      evidenceId: 'archival-fk-disposition-20260731-01',
      evidenceSha256: 'c'.repeat(64),
      rawArchivalViolationCount: 41,
      formallyWaivedViolationCount: 41,
      effectiveUnwaivedViolationCount: 0,
      activeViolationCount: 0,
      unknownViolationCount: 0,
      groups: CDB_V1_070C_ARCHIVAL_FK_GROUPS.map((group) => ({ ...group })),
      archivalTableConfirmed: true,
      activeWriterDisabledConfirmed: true,
      excludedFromCanonicalImportConfirmed: true,
      excludedFromReportingConfirmed: true,
      removalPhase: 'legacy_retirement_p11',
      archivalTableMutationAllowed: false,
      archivalTableDeletionAllowed: false,
    },
    evidenceOutput: {
      receiptId: 'cdb-v1-070c-reconciliation-receipt-20260731-01',
      protectedDirectoryEvidenceId: 'protected-cdb-v1-070c-20260731-01',
      retentionDays: 30,
    },
    procedure: {
      verifyCandidateAndPackage: true,
      captureFreshAggregateSchemaEvidence: true,
      captureFreshMigrationLedgerEvidence: true,
      stopIfAnyLedgerEntryExists: true,
      verifyExactPostSchemaBeforeWrite: true,
      reconcileExactlyFourLedgerRowsAtomically: true,
      executeNoMigrationSqlOrDdl: true,
      writeNoBusinessRows: true,
      refreshProtectedArchivalFkDispositionEvidence: true,
      verifyZeroActiveAndUnknownFkViolations: true,
      preserveRawArchivalRows: true,
      preserveLegacyAuthority: true,
      verifyTrafficUnchanged: true,
      stopOnFirstFailure: true,
    },
    permissions: {
      productionRead: true,
      migrationLedgerReconciliation: true,
      archivalFkDispositionEvidenceRefresh: true,
      migrationSqlExecution: false,
      productionDdl: false,
      businessTableWrite: false,
      productionBackfill: false,
      providerFlagChange: false,
      workerVersionUpload: false,
      deployment: false,
      trafficChange: false,
      routeChange: false,
      canonicalReadPromotion: false,
      canonicalWritePromotion: false,
      localSyncActivation: false,
      legacyRetirement: false,
      archivalTableMutation: false,
      archivalTableDeletion: false,
      destructiveAction: false,
      remoteDatabaseDeletion: false,
      push: false,
      cdbToMainIntegration: false,
    },
    confirmation: {
      readToken: '',
      ledgerReconciliationToken: '',
      archivalDispositionToken: '',
      abortToken: '',
    },
  };
  authorization.confirmation = buildAllTenantReconciliationConfirmationTokens(authorization);
  return authorization;
}

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-070c-auth-'));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function writeProtected(value: unknown, fileMode = 0o600): { root: string; path: string } {
  const root = protectedRoot();
  const path = join(root, 'authorization.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: fileMode });
  chmodSync(path, fileMode);
  return { root, path };
}

function codes(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((issue) => issue.code);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-070C reconciliation authorization', () => {
  it('accepts the exact protected authorization and builds a non-executing plan', () => {
    const packageValue = packageDocument();
    const authorization = readyAuthorization();
    const result = parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(authorization),
      process.cwd(),
      packageValue,
      NOW_UTC,
    );

    expect(result).toEqual({
      documentReady: true,
      authorizationReady: true,
      issues: [],
      authorization,
    });
    expect(buildAllTenantReconciliationAuthorizationPlan(result)).toMatchObject({
      checkpoint: 'CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION',
      migrationLedgerEntryCount: 4,
      rawArchivalForeignKeyViolations: 41,
      effectiveUnwaivedForeignKeyViolations: 0,
      finalResponseAuthority: 'legacy',
      networkRequestPerformed: false,
      productionReadPerformed: false,
      productionMutationPerformed: false,
      migrationLedgerRowsWritten: 0,
      trafficChanged: false,
    });
  });

  it('rejects generic approval and broad production authority', () => {
    const packageValue = packageDocument();
    const generic = readyAuthorization() as AllTenantReconciliationAuthorization & {
      owner: AllTenantReconciliationAuthorization['owner'] & { approvalSource: string };
    };
    generic.owner.approvalSource = 'generic_continue';
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(generic), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_OWNER_INVALID');

    const broad = readyAuthorization();
    broad.permissions.productionDdl = true;
    broad.permissions.productionBackfill = true;
    broad.permissions.providerFlagChange = true;
    broad.permissions.trafficChange = true;
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(broad), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_PERMISSION_INVALID');
  });

  it('rejects candidate, migration evidence, ledger state, FK disposition and token drift', () => {
    const packageValue = packageDocument();

    const candidate = readyAuthorization();
    candidate.repository.candidateCommit = '0'.repeat(40);
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(candidate), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_BINDING_INVALID');

    const migration = readyAuthorization();
    migration.reconciliation.entries[0].sha256 = 'd'.repeat(64);
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(migration), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_RECONCILIATION_INVALID');

    const ledger = readyAuthorization();
    ledger.reconciliation.entries[0].ledgerEntryInitiallyAbsent = false;
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(ledger), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_RECONCILIATION_INVALID');

    const fk = readyAuthorization();
    fk.foreignKeyDisposition.groups[0].rawViolationCount = 25;
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(fk), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_FK_DISPOSITION_INVALID');

    const token = readyAuthorization();
    token.confirmation.abortToken = 'e'.repeat(64);
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(token), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_CONFIRMATION_INVALID');
  });

  it('rejects expired, unknown, sensitive, duplicate and unsafe documents', () => {
    const packageValue = packageDocument();
    const expired = readyAuthorization();
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(expired), process.cwd(), packageValue, '2026-07-31T03:00:00.000Z',
    ))).toContain('CDBV1070C_AUTHORIZATION_EXPIRED');

    const unknown = { ...readyAuthorization(), extra: true };
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(unknown), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_UNKNOWN_FIELD');

    const sensitive = { ...readyAuthorization(), token: 'secret' };
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      JSON.stringify(sensitive), process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_SENSITIVE_FIELD');

    const text = JSON.stringify(readyAuthorization());
    const duplicate = text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      duplicate, process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_DUPLICATE_KEY');

    const unsafe = text.replace('"authorizationId"', '"__proto__"');
    expect(codes(parseAllTenantReconciliationAuthorizationJson(
      unsafe, process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_UNSAFE_KEY');
  });

  it('requires a protected external regular file with no links', () => {
    const packageValue = packageDocument();
    const protectedFile = writeProtected(readyAuthorization());
    expect(loadAllTenantReconciliationAuthorization(
      protectedFile.path, process.cwd(), packageValue, NOW_UTC,
    ).authorizationReady).toBe(true);

    const weak = writeProtected(readyAuthorization(), 0o644);
    expect(codes(loadAllTenantReconciliationAuthorization(
      weak.path, process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const symlinkRoot = protectedRoot();
    const target = join(symlinkRoot, 'target.json');
    writeFileSync(target, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    chmodSync(target, 0o600);
    const symlink = join(symlinkRoot, 'authorization.json');
    symlinkSync(target, symlink);
    expect(codes(loadAllTenantReconciliationAuthorization(
      symlink, process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const hardRoot = protectedRoot();
    const hardTarget = join(hardRoot, 'target.json');
    writeFileSync(hardTarget, JSON.stringify(readyAuthorization()), { mode: 0o600 });
    chmodSync(hardTarget, 0o600);
    const hard = join(hardRoot, 'authorization.json');
    linkSync(hardTarget, hard);
    expect(codes(loadAllTenantReconciliationAuthorization(
      hard, process.cwd(), packageValue, NOW_UTC,
    ))).toContain('CDBV1070C_AUTHORIZATION_FILE_PROTECTION_INVALID');
  });
});
