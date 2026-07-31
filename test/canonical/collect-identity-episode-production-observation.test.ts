import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES,
  IDENTITY_EPISODE_PRODUCTION_SCHEMA_SQL,
  collectIdentityEpisodeProductionObservation,
  parseIdentityEpisodeProductionObservationArgs,
  type IdentityEpisodeObservationCommandResult,
  type IdentityEpisodeObservationRunner,
} from '../../scripts/canonical/collect-identity-episode-production-observation';
import {
  IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL,
  type IdentityEpisodeObservationAggregateRow,
} from '../../scripts/canonical/identity-episode-production-observation';
import {
  IDENTITY_EPISODE_OBSERVATION_PROVIDERS,
  type IdentityEpisodeObservationAuthorization,
} from '../../scripts/canonical/identity-episode-production-observation-authorization';
import {
  CDB101_CANARY_TENANT_ID,
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const roots: string[] = [];
const NOW_UTC = '2026-07-27T01:30:00.000Z';

function protectedRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function authorization(): IdentityEpisodeObservationAuthorization {
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

function aggregateRows(overrides: Partial<Record<IdentityEpisodeObservationAggregateRow['provider'], Partial<IdentityEpisodeObservationAggregateRow>>> = {}): IdentityEpisodeObservationAggregateRow[] {
  return IDENTITY_EPISODE_OBSERVATION_PROVIDERS.map(({ provider }) => ({
    provider,
    source_count: 10,
    mapped_source_count: 10,
    missing_mapping_count: 0,
    duplicate_active_mapping_count: 0,
    invalid_canonical_target_count: 0,
    cross_tenant_relationship_count: 0,
    unresolved_critical_issue_count: 0,
    enabled_flag_count: 0,
    canonical_mode_flag_count: 0,
    ...overrides[provider],
  }));
}

function writeAuthorization(value: unknown = authorization()): string {
  const root = protectedRoot('cdb113g-collector-auth-');
  const path = join(root, 'authorization.json');
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function outputPath(): string {
  return join(protectedRoot('cdb113g-collector-output-'), 'evidence.json');
}

function commandResult(stdout: unknown, exitCode = 0): IdentityEpisodeObservationCommandResult {
  return {
    stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
    stderr: '',
    exitCode,
  };
}

function successfulRunner(
  options: {
    rows?: IdentityEpisodeObservationAggregateRow[];
    durations?: number[];
    info?: unknown;
    presentTables?: string[];
  } = {},
): { runner: IdentityEpisodeObservationRunner; calls: string[][] } {
  const calls: string[][] = [];
  const durations = options.durations ?? [50, 80, 90, 100, 110, 120];
  let executeIndex = 0;
  const runner: IdentityEpisodeObservationRunner = (args) => {
    calls.push([...args]);
    if (args[0] === 'd1' && args[1] === 'info') {
      return commandResult(options.info ?? {
        name: CDB101_PRODUCTION_DATABASE_NAME,
        uuid: CDB101_PRODUCTION_DATABASE_ID,
      });
    }
    if (args.at(-1) === IDENTITY_EPISODE_PRODUCTION_SCHEMA_SQL) {
      return commandResult([{
        success: true,
        results: (options.presentTables ?? IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES)
          .map((table_name) => ({ table_name })),
        meta: { changed_db: false, rows_written: 0, duration: 10 },
      }]);
    }
    const duration = durations[executeIndex++] ?? 100;
    return commandResult([{
      success: true,
      results: structuredClone(options.rows ?? aggregateRows()),
      meta: { changed_db: false, rows_written: 0, duration },
    }]);
  };
  return { runner, calls };
}

function collectWith(
  runner: IdentityEpisodeObservationRunner,
  options: Partial<Parameters<typeof collectIdentityEpisodeProductionObservation>[0]> = {},
) {
  return collectIdentityEpisodeProductionObservation({
    authorizationPath: writeAuthorization(),
    outputPath: outputPath(),
    repositoryRoot: process.cwd(),
    nowUtc: NOW_UTC,
    runner,
    commitVerifier: () => true,
    ...options,
  });
}

describe('CDB-113G production read-only observation collector', () => {
  it('runs exact production identity plus one warm-up and five measured read-only queries', () => {
    const fixture = successfulRunner();
    const result = collectWith(fixture.runner);

    expect(fixture.calls).toHaveLength(8);
    expect(fixture.calls[0]).toEqual([
      'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--json',
    ]);
    expect(fixture.calls[1]).toEqual([
      'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
      '--env', 'production', '--remote', '--json',
      '--command', IDENTITY_EPISODE_PRODUCTION_SCHEMA_SQL,
    ]);
    for (const args of fixture.calls.slice(2)) {
      expect(args).toEqual([
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json',
        '--command', IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL,
      ]);
      expect(args).not.toContain('--yes');
      expect(args).not.toContain('--file');
    }

    expect(result.receipt).toEqual({
      schemaVersion: 1,
      schemaReady: true,
      schemaBlockerCount: 0,
      evidenceReady: true,
      observationReady: true,
      promotionReady: false,
      providerCount: 5,
      measuredIterationCount: 5,
      issueCount: 0,
      mappingBlockerCount: 0,
      totalMissingMappingCount: 0,
      p95DurationMs: 120,
      maxDurationMs: 120,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      rowsWritten: 0,
    });
  });

  it('records missing production schema as a read-only blocker without running aggregate queries', () => {
    const missingTables = [
      'canonical_tenant_patient_links',
      'canonical_appointments',
      'canonical_admissions',
      'canonical_beds',
    ];
    const fixture = successfulRunner({
      presentTables: IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES
        .filter((table) => !missingTables.includes(table)),
    });
    const evidencePath = outputPath();
    const result = collectIdentityEpisodeProductionObservation({
      authorizationPath: writeAuthorization(),
      outputPath: evidencePath,
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner: fixture.runner,
      commitVerifier: () => true,
    });

    expect(fixture.calls).toHaveLength(2);
    expect(result.receipt).toEqual({
      schemaVersion: 1,
      schemaReady: false,
      schemaBlockerCount: 4,
      evidenceReady: true,
      observationReady: false,
      promotionReady: false,
      providerCount: 0,
      measuredIterationCount: 0,
      issueCount: 1,
      mappingBlockerCount: 0,
      totalMissingMappingCount: 0,
      p95DurationMs: 0,
      maxDurationMs: 0,
      aggregateOnly: true,
      networkRequestPerformed: true,
      productionMutationPerformed: false,
      rowsWritten: 0,
    });
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as {
      schema: { requiredTableCount: number; presentTableCount: number; missingTables: string[] };
    };
    expect(evidence.schema).toEqual({
      requiredTableCount: IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES.length,
      presentTableCount: IDENTITY_EPISODE_PRODUCTION_REQUIRED_TABLES.length - 4,
      missingTables,
    });
  });

  it('writes one aggregate-only protected evidence file outside the repository', () => {
    const fixture = successfulRunner();
    const authorizationPath = writeAuthorization();
    const evidencePath = outputPath();
    const result = collectIdentityEpisodeProductionObservation({
      authorizationPath,
      outputPath: evidencePath,
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner: fixture.runner,
      commitVerifier: () => true,
    });

    expect(result.receipt.evidenceReady).toBe(true);
    expect(statSync(evidencePath).mode & 0o777).toBe(0o600);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      aggregateOnly: true,
      productionMutationPerformed: false,
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(authorization().authorizationId);
    expect(serialized).not.toContain(CDB101_PRODUCTION_DATABASE_ID);
    expect(serialized).not.toContain(authorizationPath);
    expect(serialized).not.toContain(evidencePath);
    expect(serialized).not.toContain('Rahmatullah Zisan');
    expect(serialized).not.toContain('rawOutput');
    expect(serialized).not.toContain('PRIVATE_VALUE');
  });

  it('keeps missing mappings as blockers while preserving read-only evidence', () => {
    const fixture = successfulRunner({
      rows: aggregateRows({
        encounter: { source_count: 10, mapped_source_count: 6, missing_mapping_count: 4 },
      }),
    });
    const result = collectWith(fixture.runner);

    expect(result.receipt).toMatchObject({
      evidenceReady: true,
      observationReady: true,
      promotionReady: false,
      mappingBlockerCount: 1,
      totalMissingMappingCount: 4,
    });
  });

  it('rejects invalid authorization and unsafe output before any network command', () => {
    let calls = 0;
    const runner: IdentityEpisodeObservationRunner = () => {
      calls += 1;
      return commandResult({});
    };
    const invalid = authorization();
    invalid.permissions.deployment = true;
    expect(() => collectIdentityEpisodeProductionObservation({
      authorizationPath: writeAuthorization(invalid),
      outputPath: outputPath(),
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner,
      commitVerifier: () => true,
    })).toThrow('observation authorization is not execution-ready');
    expect(calls).toBe(0);

    const repositoryOutput = resolve(process.cwd(), 'PRIVATE_EVIDENCE.json');
    expect(() => collectIdentityEpisodeProductionObservation({
      authorizationPath: writeAuthorization(),
      outputPath: repositoryOutput,
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner,
      commitVerifier: () => true,
    })).toThrow('observation evidence output is not protected');
    expect(calls).toBe(0);
  });

  it('rejects stale repository commit binding before network access', () => {
    let calls = 0;
    expect(() => collectIdentityEpisodeProductionObservation({
      authorizationPath: writeAuthorization(),
      outputPath: outputPath(),
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner: () => {
        calls += 1;
        return commandResult({});
      },
      commitVerifier: () => false,
    })).toThrow('observation commit binding is not present');
    expect(calls).toBe(0);
  });

  it('rejects wrong production identity before any aggregate query', () => {
    const fixture = successfulRunner({
      info: { name: 'wrong', uuid: 'wrong' },
    });
    expect(() => collectWith(fixture.runner)).toThrow('production D1 identity mismatch');
    expect(fixture.calls).toHaveLength(1);
  });

  it('rejects command failure or malformed Wrangler JSON without exposing stderr', () => {
    const failedCalls: string[][] = [];
    const failedRunner: IdentityEpisodeObservationRunner = (args) => {
      failedCalls.push(args);
      if (args[1] === 'info') return commandResult({
        name: CDB101_PRODUCTION_DATABASE_NAME,
        uuid: CDB101_PRODUCTION_DATABASE_ID,
      });
      return { stdout: '', stderr: 'PRIVATE_ERROR', exitCode: 1 };
    };
    expect(() => collectWith(failedRunner)).toThrow('production observation command failed');
    expect(() => collectWith(failedRunner)).not.toThrow('PRIVATE_ERROR');

    const malformedCalls: string[][] = [];
    const malformedRunner: IdentityEpisodeObservationRunner = (args) => {
      malformedCalls.push(args);
      if (args[1] === 'info') return commandResult({
        name: CDB101_PRODUCTION_DATABASE_NAME,
        uuid: CDB101_PRODUCTION_DATABASE_ID,
      });
      return commandResult('not-json');
    };
    expect(() => collectWith(malformedRunner)).toThrow('production observation output is invalid');
  });

  it('rejects changed database, rows written, or invalid aggregate envelopes', () => {
    const mutationRunner = successfulRunner();
    let executeCount = 0;
    const mutate: IdentityEpisodeObservationRunner = (args) => {
      if (args[1] === 'info') return mutationRunner.runner(args);
      executeCount += 1;
      return commandResult([{
        success: true,
        results: aggregateRows(),
        meta: { changed_db: executeCount === 1, rows_written: executeCount === 1 ? 1 : 0, duration: 50 },
      }]);
    };
    expect(() => collectWith(mutate)).toThrow('production observation violated read-only boundary');

    const invalidRows = successfulRunner({ rows: aggregateRows().slice(0, 4) });
    expect(() => collectWith(invalidRows.runner)).toThrow('production observation aggregate is invalid');
  });

  it('rejects unsafe output parent permissions and existing evidence files', () => {
    const fixture = successfulRunner();
    const unsafeRoot = protectedRoot('cdb113g-unsafe-output-');
    chmodSync(unsafeRoot, 0o755);
    expect(() => collectIdentityEpisodeProductionObservation({
      authorizationPath: writeAuthorization(),
      outputPath: join(unsafeRoot, 'evidence.json'),
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner: fixture.runner,
      commitVerifier: () => true,
    })).toThrow('observation evidence output is not protected');

    const existingPath = outputPath();
    writeFileSync(existingPath, '{}', { mode: 0o600 });
    expect(() => collectIdentityEpisodeProductionObservation({
      authorizationPath: writeAuthorization(),
      outputPath: existingPath,
      repositoryRoot: process.cwd(),
      nowUtc: NOW_UTC,
      runner: fixture.runner,
      commitVerifier: () => true,
    })).toThrow('observation evidence output already exists');
  });

  it('parses only exact CLI arguments', () => {
    expect(parseIdentityEpisodeProductionObservationArgs([
      '--authorization', '/protected/auth.json',
      '--output', '/protected/evidence.json',
    ])).toEqual({
      authorizationPath: '/protected/auth.json',
      outputPath: '/protected/evidence.json',
    });
    expect(() => parseIdentityEpisodeProductionObservationArgs([
      '--authorization', '/protected/auth.json',
    ])).toThrow('required CLI arguments are missing');
    expect(() => parseIdentityEpisodeProductionObservationArgs([
      '--authorization', '/protected/auth.json',
      '--output', '/protected/evidence.json',
      '--yes', 'true',
    ])).toThrow('unsupported CLI argument');
  });
});
