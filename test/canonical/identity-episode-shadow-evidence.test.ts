import { describe, expect, it } from 'vitest';
import {
  createIdentityEpisodeShadowEvidence,
  type IdentityEpisodeShadowEvidenceInput,
} from '../../src/lib/canonical/identity-episode-shadow-evidence';

function input(overrides: Partial<IdentityEpisodeShadowEvidenceInput> = {}): IdentityEpisodeShadowEvidenceInput {
  return {
    provider: 'patient_identity',
    consumerId: 'cdb113f_patient_detail',
    tenantId: 'tenant-a',
    sourceType: 'legacy_patient',
    sourcePublicId: '101',
    mode: 'shadow',
    comparisons: [
      { varianceClass: 'MAPPING_MISSING', matches: true, critical: true, evidenceHash: 'a'.repeat(64) },
      { varianceClass: 'PATIENT_LINK_MISMATCH', matches: true, critical: true, evidenceHash: 'b'.repeat(64) },
    ],
    elapsedMs: 12,
    errorCount: 0,
    latencyBudgetMs: 50,
    observedAtUtc: '2026-07-27T00:00:00.000Z',
    acceptedExceptionIds: [],
    ...overrides,
  };
}

describe('CDB-113F identity/episode shadow evidence', () => {
  it('creates deterministic aggregate-only parity receipts', () => {
    const first = createIdentityEpisodeShadowEvidence(input());
    const second = createIdentityEpisodeShadowEvidence(input());

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      checkpoint: 'CDB-113F',
      provider: 'patient_identity',
      consumerId: 'cdb113f_patient_detail',
      mode: 'shadow',
      comparisonCount: 2,
      parity: true,
      varianceClasses: [],
      varianceIds: [],
      elapsedMs: 12,
      errorCount: 0,
      rollbackMode: 'legacy',
      criticalUnexplainedVarianceCount: 0,
    });
    expect(first.stableConsumerKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('tenant-a');
    expect(JSON.stringify(first)).not.toContain('legacy_patient');
    expect(JSON.stringify(first)).not.toContain('"101"');
  });

  it('creates stable variance IDs and separates accepted exceptions', () => {
    const receipt = createIdentityEpisodeShadowEvidence(input({
      comparisons: [
        { varianceClass: 'MAPPING_AMBIGUOUS', matches: false, critical: true, evidenceHash: 'c'.repeat(64) },
        { varianceClass: 'STATUS_MISMATCH', matches: false, critical: false, evidenceHash: 'd'.repeat(64), acceptedExceptionId: 'CDB113F-EX-001' },
      ],
      acceptedExceptionIds: ['CDB113F-EX-001'],
    }));

    expect(receipt.parity).toBe(false);
    expect(receipt.varianceClasses).toEqual(['MAPPING_AMBIGUOUS', 'STATUS_MISMATCH']);
    expect(receipt.varianceIds).toHaveLength(2);
    expect(receipt.varianceIds.every((value) => /^[a-f0-9]{64}$/.test(value))).toBe(true);
    expect(receipt.acceptedExceptionIds).toEqual(['CDB113F-EX-001']);
    expect(receipt.criticalUnexplainedVarianceCount).toBe(1);
  });

  it('classifies latency and provider errors independently', () => {
    const receipt = createIdentityEpisodeShadowEvidence(input({
      elapsedMs: 51,
      latencyBudgetMs: 50,
      errorCount: 1,
    }));
    expect(receipt.varianceClasses).toEqual(['LATENCY_BUDGET_EXCEEDED', 'PROVIDER_ERROR']);
    expect(receipt.varianceIds).toHaveLength(2);
    expect(receipt.parity).toBe(false);
    expect(receipt.criticalUnexplainedVarianceCount).toBe(2);
  });

  it('rejects unsupported variance classes and invalid aggregate inputs', () => {
    expect(() => createIdentityEpisodeShadowEvidence(input({
      comparisons: [{ varianceClass: 'NOT_REVIEWED' as never, matches: false, critical: true }],
    }))).toThrow(/reviewed variance class/i);
    expect(() => createIdentityEpisodeShadowEvidence(input({ elapsedMs: -1 }))).toThrow(/elapsedMs/i);
    expect(() => createIdentityEpisodeShadowEvidence(input({ errorCount: -1 }))).toThrow(/errorCount/i);
    expect(() => createIdentityEpisodeShadowEvidence(input({ observedAtUtc: 'not-a-date' }))).toThrow(/observedAtUtc/i);
  });

  it('rejects PHI, clinical narrative, financial facts, labels, secrets, and provider payloads recursively', () => {
    for (const forbidden of [
      { name: 'Patient Name' },
      { mobile: '01700000000' },
      { nested: { diagnosis: 'Sensitive diagnosis' } },
      { nested: { appointmentNotes: 'private note' } },
      { bedLabel: 'Ward A / Bed 5' },
      { invoiceAmount: 500 },
      { passwordHash: 'secret' },
      { providerPayload: { any: 'payload' } },
    ]) {
      expect(() => createIdentityEpisodeShadowEvidence({
        ...input(),
        metadata: forbidden,
      })).toThrow(/forbidden shadow evidence key/i);
    }
  });
});
