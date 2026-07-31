import {
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_EPISODE_OBSERVATION_PROVIDERS,
  evaluateIdentityEpisodeObservationAuthorization,
  loadIdentityEpisodeObservationAuthorization,
  parseIdentityEpisodeObservationAuthorizationJson,
  type IdentityEpisodeObservationAuthorization,
} from '../../scripts/canonical/identity-episode-production-observation-authorization';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const temporaryRoots: string[] = [];
const NOW_UTC = '2026-07-27T01:30:00.000Z';

function makeProtectedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cdb113g-observation-auth-'));
  chmodSync(root, 0o700);
  temporaryRoots.push(root);
  return root;
}

function readyAuthorization(): IdentityEpisodeObservationAuthorization {
  return {
    schemaVersion: 1,
    authorizationId: 'cdb113g-readonly-observation-20260727-01',
    operation: 'read_only_controlled_probe',
    database: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      uuid: CDB101_PRODUCTION_DATABASE_ID,
      environment: 'production',
      remote: true,
    },
    tenantId: CDB101_CANARY_TENANT_ID,
    providers: structuredClone(IDENTITY_EPISODE_OBSERVATION_PROVIDERS),
    timing: {
      issuedAtUtc: '2026-07-27T01:00:00.000Z',
      observationStartUtc: '2026-07-27T01:05:00.000Z',
      observationEndUtc: '2026-07-27T02:05:00.000Z',
      expiresAtUtc: '2026-07-27T02:35:00.000Z',
    },
    thresholds: {
      measuredIterations: 5,
      p95DurationMs: 250,
      maxDurationMs: 500,
      acceptedExceptionIds: [],
    },
    commits: {
      implementation: '561a34a1b',
      metadata: '3427268c8',
      mainSync: 'f4004195a',
      design: '89cbc4ad3',
    },
    owner: {
      ownerId: 'rahmatullah-zisan',
      displayName: 'Rahmatullah Zisan',
      approved: true,
      approvalSource: 'user_explicit_production_readonly_observation_authorization',
    },
    permissions: {
      providerFlagChange: false,
      routeChange: false,
      trafficChange: false,
      deployment: false,
      migration: false,
      backfill: false,
      dataMutation: false,
      localSyncActivation: false,
      legacyReaderRetirement: false,
      legacyWriterRetirement: false,
      push: false,
      cdbToMainIntegration: false,
      canonicalPromotion: false,
    },
  };
}

function writeProtectedAuthorization(
  value: unknown,
  options: { rootMode?: number; fileMode?: number } = {},
): { root: string; path: string } {
  const root = makeProtectedRoot();
  chmodSync(root, options.rootMode ?? 0o700);
  const path = join(root, 'authorization.json');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), {
    mode: options.fileMode ?? 0o600,
  });
  chmodSync(path, options.fileMode ?? 0o600);
  return { root, path };
}

function issueCodes(result: { issues: Array<{ code: string }> }): string[] {
  return result.issues.map((issue) => issue.code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('CDB-113G protected identity/episode observation authorization', () => {
  it('parses and validates the exact read-only production observation scope', () => {
    const authorization = readyAuthorization();
    const parsed = parseIdentityEpisodeObservationAuthorizationJson(JSON.stringify(authorization), NOW_UTC);

    expect(parsed).toEqual({
      documentReady: true,
      executionReady: true,
      issues: [],
      authorization,
    });
  });

  it('loads only a mode-600 regular file from a mode-700 directory outside the repository', () => {
    const fixture = writeProtectedAuthorization(readyAuthorization());
    const loaded = loadIdentityEpisodeObservationAuthorization(
      fixture.path,
      process.cwd(),
      NOW_UTC,
    );

    expect(loaded.documentReady).toBe(true);
    expect(loaded.executionReady).toBe(true);
    expect(loaded.authorization).toEqual(readyAuthorization());
    expect(readFileSync(fixture.path, 'utf8')).not.toContain('PRIVATE_VALUE');
  });

  it('rejects wrong database, tenant, provider, consumer, or flag scope', () => {
    const wrongDatabase = readyAuthorization();
    wrongDatabase.database.name = 'not-production';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(wrongDatabase), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_SCOPE_INVALID');

    const wrongTenant = readyAuthorization() as unknown as Record<string, unknown>;
    wrongTenant.tenantId = '101';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(wrongTenant), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_SCOPE_INVALID');

    const wrongProvider = readyAuthorization();
    wrongProvider.providers[0].provider = 'practitioner';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(wrongProvider), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_SCOPE_INVALID');

    const wrongConsumer = readyAuthorization();
    wrongConsumer.providers[0].consumerId = 'wrong-consumer';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(wrongConsumer), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_SCOPE_INVALID');

    const wrongFlag = readyAuthorization();
    wrongFlag.providers[0].flagKey = 'wrong-flag';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(wrongFlag), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_SCOPE_INVALID');
  });

  it('rejects any permission that broadens the read-only authorization', () => {
    const authorization = readyAuthorization();
    authorization.permissions.providerFlagChange = true;

    const result = parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(authorization),
      NOW_UTC,
    );

    expect(issueCodes(result)).toContain('CDB113G_AUTHORIZATION_PERMISSION_INVALID');
    expect(result.executionReady).toBe(false);
  });

  it('rejects unknown, unsafe, sensitive, and duplicate JSON keys without echoing values', () => {
    const unknown = { ...readyAuthorization(), unexpected: true };
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(unknown), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_UNKNOWN_FIELD');

    const sensitive = {
      ...readyAuthorization(),
      headers: { authorization: 'PRIVATE_VALUE' },
    };
    const sensitiveResult = parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(sensitive),
      NOW_UTC,
    );
    expect(issueCodes(sensitiveResult)).toContain('CDB113G_AUTHORIZATION_SENSITIVE_FIELD');
    expect(JSON.stringify(sensitiveResult)).not.toContain('PRIVATE_VALUE');

    const unsafe = JSON.stringify(readyAuthorization()).replace(
      '"database":{',
      '"database":{"__proto__":{"polluted":true},',
    );
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      unsafe, NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_UNSAFE_KEY');

    const duplicate = JSON.stringify(readyAuthorization()).replace(
      '"authorizationId":"cdb113g-readonly-observation-20260727-01"',
      '"authorizationId":"first","authorizationId":"second"',
    );
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      duplicate, NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_DUPLICATE_KEY');
  });

  it('rejects invalid chronology, expiry, commit binding, and accepted exceptions', () => {
    const chronology = readyAuthorization();
    chronology.timing.observationStartUtc = '2026-07-27T00:59:00.000Z';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(chronology), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_TIMING_INVALID');

    const expired = readyAuthorization();
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(expired), '2026-07-27T02:36:00.000Z',
    ))).toContain('CDB113G_AUTHORIZATION_EXPIRED');

    const staleCommit = readyAuthorization();
    staleCommit.commits.metadata = '000000000';
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(staleCommit), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_COMMIT_INVALID');

    const exceptions = readyAuthorization();
    exceptions.thresholds.acceptedExceptionIds = ['EXCEPTION-1'] as [];
    expect(issueCodes(parseIdentityEpisodeObservationAuthorizationJson(
      JSON.stringify(exceptions), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_THRESHOLD_INVALID');
  });

  it('rejects unsafe file and directory permissions and repository-contained authorization', () => {
    const unsafeFile = writeProtectedAuthorization(readyAuthorization(), { fileMode: 0o644 });
    expect(issueCodes(loadIdentityEpisodeObservationAuthorization(
      unsafeFile.path, process.cwd(), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const unsafeDirectory = writeProtectedAuthorization(readyAuthorization(), { rootMode: 0o755 });
    expect(issueCodes(loadIdentityEpisodeObservationAuthorization(
      unsafeDirectory.path, process.cwd(), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const repositoryTemplate = resolve(
      process.cwd(),
      'docs/database/migration-runs/production/CDB-113G-identity-episode-observation-authorization-template.json',
    );
    expect(issueCodes(loadIdentityEpisodeObservationAuthorization(
      repositoryTemplate, process.cwd(), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_FILE_INSIDE_REPOSITORY');
  });

  it('rejects symlinks and hard links and sanitizes missing-file errors', () => {
    const fixture = writeProtectedAuthorization(readyAuthorization());
    const symlinkPath = join(fixture.root, 'linked.json');
    symlinkSync(fixture.path, symlinkPath);
    expect(issueCodes(loadIdentityEpisodeObservationAuthorization(
      symlinkPath, process.cwd(), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const hardLinkPath = join(fixture.root, 'hard-linked.json');
    linkSync(fixture.path, hardLinkPath);
    expect(issueCodes(loadIdentityEpisodeObservationAuthorization(
      hardLinkPath, process.cwd(), NOW_UTC,
    ))).toContain('CDB113G_AUTHORIZATION_FILE_PROTECTION_INVALID');

    const missingPath = join(fixture.root, 'PRIVATE_FILE_NAME.json');
    const missing = loadIdentityEpisodeObservationAuthorization(
      missingPath, process.cwd(), NOW_UTC,
    );
    expect(issueCodes(missing)).toContain('CDB113G_AUTHORIZATION_FILE_UNAVAILABLE');
    expect(JSON.stringify(missing)).not.toContain(fixture.root);
    expect(JSON.stringify(missing)).not.toContain('PRIVATE_FILE_NAME');
  });

  it('emits an aggregate-only offline authorization receipt', () => {
    const fixture = writeProtectedAuthorization(readyAuthorization());
    const receipt = evaluateIdentityEpisodeObservationAuthorization(
      fixture.path,
      process.cwd(),
      NOW_UTC,
    );

    expect(receipt).toEqual({
      schemaVersion: 1,
      documentReady: true,
      executionReady: true,
      providerCount: 5,
      issueCount: 0,
      aggregateOnly: true,
      networkRequestPerformed: false,
      productionMutationPerformed: false,
    });
    expect(JSON.stringify(receipt)).not.toContain('rahmatullah-zisan');
    expect(JSON.stringify(receipt)).not.toContain(CDB101_PRODUCTION_DATABASE_ID);
    expect(JSON.stringify(receipt)).not.toContain(fixture.root);
  });
});
