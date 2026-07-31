import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIdentityEpisodeProductionSchemaAuthorizationBindings,
  evaluateIdentityEpisodeProductionSchemaAuthorization,
  loadIdentityEpisodeProductionSchemaAuthorization,
  parseIdentityEpisodeProductionSchemaAuthorizationJson,
  type IdentityEpisodeProductionSchemaAuthorization,
} from '../../scripts/canonical/identity-episode-production-schema-authorization';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const temporaryRoots: string[] = [];
const NOW_UTC = '2026-07-27T08:30:00.000Z';

function protectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb113h3-schema-auth-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

function readyAuthorization(): IdentityEpisodeProductionSchemaAuthorization {
  const bindings = buildIdentityEpisodeProductionSchemaAuthorizationBindings(process.cwd());
  return {
    schemaVersion: 1,
    authorizationId: 'cdb113h3-production-schema-20260727-01',
    operation: 'production_schema_migrations_only',
    database: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      uuid: CDB101_PRODUCTION_DATABASE_ID,
      environment: 'production',
      remote: true,
    },
    timing: {
      issuedAtUtc: '2026-07-27T08:00:00.000Z',
      maintenanceStartUtc: '2026-07-27T08:15:00.000Z',
      maintenanceEndUtc: '2026-07-27T09:15:00.000Z',
      expiresAtUtc: '2026-07-27T09:45:00.000Z',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_production_schema_migration_authorization',
    },
    rollback: {
      ownerId: 'rahmatullah-zisan',
      restoreAuthorityConfirmed: true,
      protectedExportSha256: 'a'.repeat(64),
      timeTravelEvidenceSha256: 'b'.repeat(64),
      restoreOnAnyFailure: true,
      stopOnFirstFailure: true,
    },
    bindings,
    acceptance: {
      migrationLedgerBefore: 487,
      migrationLedgerAfter: 497,
      requiredAuthorityTablesAfter: 4,
      encounterRowsBefore: 234,
      encounterRowsAfter: 234,
      bedStayRowsBefore: 28,
      bedStayRowsAfter: 28,
      activeForeignKeyViolations: 0,
      integrityCheck: 'ok',
      migrationFailureTolerance: 0,
    },
    procedure: {
      migrationOrder: bindings.migrations.map((migration) => migration.name),
      bookmarkBeforeFirstMigration: true,
      backupBeforeFirstMigration: true,
      serialApply: true,
      noConcurrentDeployment: true,
      postMigrationReadOnlyVerification: true,
    },
    permissions: {
      schemaMigration: true,
      productionBackfill: false,
      providerFlagChange: false,
      routeChange: false,
      trafficChange: false,
      deployment: false,
      receptionCutover: false,
      dataMutationOutsideMigration: false,
      localSyncActivation: false,
      legacyReaderRetirement: false,
      legacyWriterRetirement: false,
      remoteDatabaseDeletion: false,
      push: false,
      cdbToMainIntegration: false,
    },
  };
}

function writeProtected(
  value: unknown,
  options: { rootMode?: number; fileMode?: number } = {},
): { root: string; path: string } {
  const root = protectedRoot();
  chmodSync(root, options.rootMode ?? 0o700);
  const path = join(root, 'authorization.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), {
    mode: options.fileMode ?? 0o600,
  });
  chmodSync(path, options.fileMode ?? 0o600);
  return { root, path };
}

function codes(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((entry) => entry.code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('CDB-113H3 production schema-only authorization contract', () => {
  it('binds the exact ten reviewed migrations and three verified receipts', () => {
    const bindings = buildIdentityEpisodeProductionSchemaAuthorizationBindings(process.cwd());

    expect(bindings.migrations.map((entry) => entry.name)).toEqual([
      '0541_canonical_local_sync_protocol.sql',
      '0542_canonical_sync_inbox_lifecycle.sql',
      '0543_canonical_sync_outbox_lifecycle.sql',
      '0544_canonical_tenant_patient_links.sql',
      '0545_canonical_practitioner_operational_adoption.sql',
      '0546_canonical_appointment_authority.sql',
      '0547_patient_merge_map_hardening.sql',
      '0548_canonical_encounter_admission_bed_convergence.sql',
      '0549_approval_revision_policy.sql',
      '0550_canonical_credit_note_cash_refund_reversals.sql',
    ]);
    expect(bindings.migrations).toHaveLength(10);
    expect(bindings.migrations.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
    expect(bindings.receipts).toEqual({
      h1Path: 'docs/database/migration-runs/production/CDB-113H1-protected-local-clone-migration-rehearsal.md',
      h1Sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      h2Path: 'docs/database/migration-runs/production/CDB-113H2-protected-clone-backfill-reconciliation.md',
      h2Sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      h2APath: 'docs/database/migration-runs/production/CDB-113H2A-main-sync-h2-evidence-revalidation.md',
      h2ASha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('accepts only the exact schema-migration authorization envelope', () => {
    const authorization = readyAuthorization();
    const result = parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(authorization),
      process.cwd(),
      NOW_UTC,
    );

    expect(result).toEqual({
      documentReady: true,
      executionReady: true,
      issues: [],
      authorization,
    });
  });

  it('rejects stale migration order, hashes, or receipt evidence', () => {
    const staleHash = readyAuthorization();
    staleHash.bindings.migrations[0].sha256 = '0'.repeat(64);
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(staleHash), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_BINDING_INVALID');

    const wrongOrder = readyAuthorization();
    wrongOrder.procedure.migrationOrder.reverse();
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(wrongOrder), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_PROCEDURE_INVALID');

    const staleReceipt = readyAuthorization();
    staleReceipt.bindings.receipts.h2ASha256 = '1'.repeat(64);
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(staleReceipt), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_BINDING_INVALID');
  });

  it('rejects any permission broader than schema migration only', () => {
    const authorization = readyAuthorization();
    authorization.permissions.productionBackfill = true;
    authorization.permissions.providerFlagChange = true;

    const result = parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(authorization), process.cwd(), NOW_UTC,
    );

    expect(result.executionReady).toBe(false);
    expect(codes(result)).toContain('CDB113H3_AUTHORIZATION_PERMISSION_INVALID');
  });

  it('rejects wrong database, owner, rollback evidence, acceptance thresholds, or timing', () => {
    const wrongDatabase = readyAuthorization();
    wrongDatabase.database.name = 'not-production';
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(wrongDatabase), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_SCOPE_INVALID');

    const wrongOwner = readyAuthorization();
    wrongOwner.owner.approvalSource = 'generic_continue';
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(wrongOwner), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_OWNER_INVALID');

    const rollback = readyAuthorization();
    rollback.rollback.protectedExportSha256 = 'short';
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(rollback), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_ROLLBACK_INVALID');

    const acceptance = readyAuthorization();
    acceptance.acceptance.encounterRowsAfter = 233;
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(acceptance), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_ACCEPTANCE_INVALID');

    const expired = readyAuthorization();
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(expired), process.cwd(), '2026-07-27T09:46:00.000Z',
    ))).toContain('CDB113H3_AUTHORIZATION_EXPIRED');
  });

  it('rejects unknown, sensitive, unsafe, and duplicate JSON fields', () => {
    const unknown = { ...readyAuthorization(), unexpected: true };
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(unknown), process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_UNKNOWN_FIELD');

    const sensitive = { ...readyAuthorization(), headers: { authorization: 'PRIVATE_VALUE' } };
    const sensitiveResult = parseIdentityEpisodeProductionSchemaAuthorizationJson(
      JSON.stringify(sensitive), process.cwd(), NOW_UTC,
    );
    expect(codes(sensitiveResult)).toContain('CDB113H3_AUTHORIZATION_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('PRIVATE_VALUE');

    const unsafe = JSON.stringify(readyAuthorization()).replace(
      '"database":{',
      '"database":{"__proto__":{"polluted":true},',
    );
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      unsafe, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_UNSAFE_KEY');

    const duplicate = JSON.stringify(readyAuthorization()).replace(
      '"authorizationId":"cdb113h3-production-schema-20260727-01"',
      '"authorizationId":"first","authorizationId":"second"',
    );
    expect(codes(parseIdentityEpisodeProductionSchemaAuthorizationJson(
      duplicate, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_DUPLICATE_KEY');
  });

  it('loads only a protected regular file outside the repository', () => {
    const valid = writeProtected(readyAuthorization());
    expect(loadIdentityEpisodeProductionSchemaAuthorization(
      valid.path, process.cwd(), NOW_UTC,
    ).executionReady).toBe(true);

    const unsafeFile = writeProtected(readyAuthorization(), { fileMode: 0o644 });
    expect(codes(loadIdentityEpisodeProductionSchemaAuthorization(
      unsafeFile.path, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const unsafeDirectory = writeProtected(readyAuthorization(), { rootMode: 0o755 });
    expect(codes(loadIdentityEpisodeProductionSchemaAuthorization(
      unsafeDirectory.path, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const repositoryPath = resolve(process.cwd(), 'docs/database/identity-episode-production-schema-backfill-preparation.json');
    expect(codes(loadIdentityEpisodeProductionSchemaAuthorization(
      repositoryPath, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_FILE_INSIDE_REPOSITORY');
  });

  it('rejects symlinks and hard links and emits an aggregate-only offline receipt', () => {
    const fixture = writeProtected(readyAuthorization());
    const symlinkPath = join(fixture.root, 'linked.json');
    symlinkSync(fixture.path, symlinkPath);
    expect(codes(loadIdentityEpisodeProductionSchemaAuthorization(
      symlinkPath, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const hardLinkPath = join(fixture.root, 'hard-linked.json');
    linkSync(fixture.path, hardLinkPath);
    expect(codes(loadIdentityEpisodeProductionSchemaAuthorization(
      hardLinkPath, process.cwd(), NOW_UTC,
    ))).toContain('CDB113H3_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const validReceiptFixture = writeProtected(readyAuthorization());
    expect(evaluateIdentityEpisodeProductionSchemaAuthorization(
      validReceiptFixture.path, process.cwd(), NOW_UTC,
    )).toEqual({
      schemaVersion: 1,
      documentReady: true,
      executionReady: true,
      migrationCount: 10,
      issueCount: 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
  });
});
