import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateIdentityEpisodeReadPromotionReadiness,
  type IdentityEpisodeReadPromotionEvidence,
} from '../../scripts/canonical/check-identity-episode-read-promotion-readiness';

const root = process.cwd();

function evidence(): IdentityEpisodeReadPromotionEvidence {
  return JSON.parse(readFileSync(
    'docs/database/identity-episode-read-promotion-evidence.json',
    'utf8',
  )) as IdentityEpisodeReadPromotionEvidence;
}

function clone(): IdentityEpisodeReadPromotionEvidence {
  return structuredClone(evidence());
}

describe('CDB-113F identity/episode read-promotion readiness', () => {
  it('passes complete local selected-adapter evidence while production remains blocked', () => {
    const result = evaluateIdentityEpisodeReadPromotionReadiness(root);
    expect(result).toEqual({
      localReady: true,
      productionReady: false,
      issues: [],
      checkedProviderCount: 5,
      checkedAdapterCount: 5,
      blockedRetirementGateCount: 5,
    });
  });

  it('fails closed on stale coverage, unknown inventory, or missing second-pass evidence', () => {
    const stale = clone();
    stale.coverage.registrySha256 = '0'.repeat(64);
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, stale).issues)
      .toContain('coverage registry hash is stale');

    const unknown = clone();
    unknown.coverage.unknownProviderAssignments = 1;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, unknown).issues)
      .toContain('coverage unknownProviderAssignments must equal 0');

    const missingSecondPass = clone();
    missingSecondPass.secondPassEvidence = [];
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, missingSecondPass).issues)
      .toContain('second-pass authority evidence is missing');
  });

  it('fails on critical variance, provider error, or latency regression', () => {
    const variance = clone();
    variance.localShadowEvidence.criticalUnexplainedVarianceCount = 1;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, variance).issues)
      .toContain('critical unexplained local variance exists');

    const error = clone();
    error.localShadowEvidence.errorCount = 1;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, error).issues)
      .toContain('local provider errors exist');

    const latency = clone();
    latency.localShadowEvidence.maxObservedElapsedMs = 101;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, latency).issues)
      .toContain('local latency budget evidence failed');
  });

  it('rejects enabled defaults, production claims, owner authorization, and missing rollback', () => {
    const enabled = clone();
    enabled.providers[0].enabledByDefault = true;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, enabled).issues)
      .toContain('provider is enabled by default: patient_identity');

    const production = clone();
    production.claims.productionReady = true;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, production).issues)
      .toContain('production-ready claim is forbidden');

    const owner = clone();
    owner.claims.ownerAuthorizationPresent = true;
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, owner).issues)
      .toContain('owner authorization must remain absent');

    const rollback = clone();
    rollback.rollback.mode = 'canonical';
    rollback.rollback.description = '';
    expect(evaluateIdentityEpisodeReadPromotionReadiness(root, rollback).issues)
      .toContain('rollback must return to legacy while retaining canonical evidence');
  });

  it('keeps all five retirement gates fully blocked', () => {
    const gates = JSON.parse(readFileSync(
      'docs/database/legacy-write-retirement-gates.yaml',
      'utf8',
    )) as { domains: Array<Record<string, unknown>> };
    const ids = [
      'patient_identity',
      'practitioner_identity',
      'appointment_intent',
      'encounter_care_episode',
      'inpatient_admission_bed_occupancy',
    ];
    for (const id of ids) {
      const gate = gates.domains.find((entry) => entry.id === id);
      expect(gate).toBeDefined();
      for (const key of [
        'productionCutoverComplete',
        'canonicalReadPromotionComplete',
        'observationComplete',
        'rollbackEvidenceFresh',
        'ownerAuthorizationPresent',
        'legacyAuthorityRetirementApproved',
        'compatibilityAdapterRetirementApproved',
        'fixtureRetirementApproved',
      ]) expect(gate?.[key]).toBe(false);
    }
  });
});
