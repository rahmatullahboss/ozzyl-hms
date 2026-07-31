import { describe, expect, it } from 'vitest';
import {
  IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL,
  evaluateIdentityEpisodeProductionObservation,
  type IdentityEpisodeObservationAggregateRow,
  type IdentityEpisodeProductionObservationInput,
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

function rows(overrides: Partial<Record<IdentityEpisodeObservationAggregateRow['provider'], Partial<IdentityEpisodeObservationAggregateRow>>> = {}): IdentityEpisodeObservationAggregateRow[] {
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

function input(
  rowSets: IdentityEpisodeObservationAggregateRow[][] = Array.from({ length: 5 }, () => rows()),
  durationsMs = [80, 90, 100, 110, 120],
): IdentityEpisodeProductionObservationInput {
  return {
    authorization: authorization(),
    observedAtUtc: '2026-07-27T01:40:00.000Z',
    iterations: rowSets.map((iterationRows, index) => ({
      rows: iterationRows,
      durationMs: durationsMs[index],
      changedDb: false,
      rowsWritten: 0,
    })),
  };
}

describe('CDB-113G identity/episode production observation evaluator', () => {
  it('accepts five stable aggregate-only provider iterations while keeping promotion blocked', () => {
    const result = evaluateIdentityEpisodeProductionObservation(input());

    expect(result).toEqual({
      schemaVersion: 1,
      evidenceReady: true,
      observationReady: true,
      promotionReady: false,
      providerCount: 5,
      measuredIterationCount: 5,
      mappingBlockerCount: 0,
      totalMissingMappingCount: 0,
      p95DurationMs: 120,
      maxDurationMs: 120,
      issues: [],
      mappingBlockers: [],
      aggregateOnly: true,
      productionMutationPerformed: false,
      rowsWritten: 0,
    });
  });

  it('records missing mappings as remediation blockers without invalidating read-only evidence', () => {
    const result = evaluateIdentityEpisodeProductionObservation(input(
      Array.from({ length: 5 }, () => rows({
        appointment: { source_count: 10, mapped_source_count: 7, missing_mapping_count: 3 },
      })),
    ));

    expect(result.evidenceReady).toBe(true);
    expect(result.observationReady).toBe(true);
    expect(result.promotionReady).toBe(false);
    expect(result.mappingBlockerCount).toBe(1);
    expect(result.totalMissingMappingCount).toBe(3);
    expect(result.mappingBlockers).toEqual([
      { provider: 'appointment', missingMappingCount: 3 },
    ]);
  });

  it.each([
    ['duplicate_active_mapping_count', 'CDB113G_DUPLICATE_MAPPING'],
    ['invalid_canonical_target_count', 'CDB113G_INVALID_CANONICAL_TARGET'],
    ['cross_tenant_relationship_count', 'CDB113G_CROSS_TENANT_RELATIONSHIP'],
    ['unresolved_critical_issue_count', 'CDB113G_UNRESOLVED_CRITICAL_ISSUE'],
    ['enabled_flag_count', 'CDB113G_PROVIDER_FLAG_ENABLED'],
    ['canonical_mode_flag_count', 'CDB113G_CANONICAL_MODE_PRESENT'],
  ] as const)('fails observation readiness for %s', (field, code) => {
    const rowSets = Array.from({ length: 5 }, () => rows({
      patient_identity: { [field]: 1 },
    }));
    const result = evaluateIdentityEpisodeProductionObservation(input(rowSets));

    expect(result.evidenceReady).toBe(true);
    expect(result.observationReady).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain(code);
  });

  it('fails evidence on changed database, rows written, or inconsistent measured counts', () => {
    const changed = input();
    changed.iterations[0].changedDb = true;
    expect(evaluateIdentityEpisodeProductionObservation(changed).issues.map((entry) => entry.code))
      .toContain('CDB113G_READ_ONLY_BOUNDARY_VIOLATED');

    const written = input();
    written.iterations[0].rowsWritten = 1;
    expect(evaluateIdentityEpisodeProductionObservation(written).issues.map((entry) => entry.code))
      .toContain('CDB113G_READ_ONLY_BOUNDARY_VIOLATED');

    const unstable = input();
    unstable.iterations[4].rows[0].source_count = 11;
    expect(evaluateIdentityEpisodeProductionObservation(unstable).issues.map((entry) => entry.code))
      .toContain('CDB113G_AGGREGATE_DRIFT');
  });

  it('fails closed for missing, duplicate, unknown, or malformed provider rows', () => {
    const missing = input();
    missing.iterations[0].rows.pop();
    expect(evaluateIdentityEpisodeProductionObservation(missing).issues.map((entry) => entry.code))
      .toContain('CDB113G_PROVIDER_RESULT_INVALID');

    const duplicate = input();
    duplicate.iterations[0].rows[4] = structuredClone(duplicate.iterations[0].rows[0]);
    expect(evaluateIdentityEpisodeProductionObservation(duplicate).issues.map((entry) => entry.code))
      .toContain('CDB113G_PROVIDER_RESULT_INVALID');

    const unknown = input();
    (unknown.iterations[0].rows[0] as { provider: string }).provider = 'unknown';
    expect(evaluateIdentityEpisodeProductionObservation(unknown).issues.map((entry) => entry.code))
      .toContain('CDB113G_PROVIDER_RESULT_INVALID');

    const malformed = input();
    malformed.iterations[0].rows[0].source_count = -1;
    expect(evaluateIdentityEpisodeProductionObservation(malformed).issues.map((entry) => entry.code))
      .toContain('CDB113G_PROVIDER_RESULT_INVALID');
  });

  it('fails latency readiness using nearest-rank p95 and maximum thresholds', () => {
    const result = evaluateIdentityEpisodeProductionObservation(input(
      undefined,
      [100, 120, 150, 251, 501],
    ));

    expect(result.p95DurationMs).toBe(501);
    expect(result.maxDurationMs).toBe(501);
    expect(result.observationReady).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain('CDB113G_LATENCY_THRESHOLD_EXCEEDED');
  });

  it('rejects an incorrect iteration count or observation chronology', () => {
    const count = input();
    count.iterations.pop();
    expect(evaluateIdentityEpisodeProductionObservation(count).issues.map((entry) => entry.code))
      .toContain('CDB113G_ITERATION_COUNT_INVALID');

    const chronology = input();
    chronology.observedAtUtc = '2026-07-27T02:06:00.000Z';
    expect(evaluateIdentityEpisodeProductionObservation(chronology).issues.map((entry) => entry.code))
      .toContain('CDB113G_OBSERVATION_TIMING_INVALID');
  });

  it('rejects recursively sensitive or unexpected evidence keys without echoing their values', () => {
    const sensitive = input() as unknown as Record<string, unknown>;
    sensitive.headers = { authorization: 'PRIVATE_VALUE' };
    const result = evaluateIdentityEpisodeProductionObservation(
      sensitive as unknown as IdentityEpisodeProductionObservationInput,
    );

    expect(result.issues.map((entry) => entry.code)).toContain('CDB113G_SENSITIVE_EVIDENCE_REJECTED');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_VALUE');
  });

  it('defines one aggregate-only read statement without mutation or sensitive projections', () => {
    const normalized = IDENTITY_EPISODE_PRODUCTION_OBSERVATION_SQL.toLowerCase();
    expect(normalized.trimStart()).toMatch(/^with\b/);
    expect(normalized).toContain("'patient_identity' as provider");
    expect(normalized).toContain("'practitioner' as provider");
    expect(normalized).toContain("'appointment' as provider");
    expect(normalized).toContain("'encounter' as provider");
    expect(normalized).toContain("'admission_bed' as provider");
    expect(normalized).not.toMatch(/\b(insert|update|delete|replace|alter|drop|create|pragma)\b/);
    expect(normalized).not.toMatch(/\b(name|mobile|phone|email|address|diagnosis|notes|amount|price)\b/);
  });
});
