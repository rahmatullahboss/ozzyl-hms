import { describe, expect, it } from 'vitest';
import {
  ClinicalReleasePolicyError,
  assertFinalReleaseEvidence,
  assertRequiredCriticalThresholds,
  assertSeparationOfDuties,
  assertVerifiedSnapshotUnchanged,
  canonicalClinicalSnapshotJson,
  classifyClinicalNumericResult,
  digestClinicalSnapshot,
} from '../../src/lib/lis-clinical-release-policy';

describe('LIS clinical release policy', () => {
  it('never fabricates a critical threshold from the normal interval', () => {
    expect(classifyClinicalNumericResult({
      numericValue: 250,
      normalLow: 70,
      normalHigh: 100,
      criticalLow: null,
      criticalHigh: null,
    })).toBe('high');
  });

  it('uses an explicit configured critical threshold', () => {
    expect(classifyClinicalNumericResult({
      numericValue: 250,
      normalLow: 70,
      normalHigh: 100,
      criticalLow: 30,
      criticalHigh: 200,
    })).toBe('critical');
  });

  it('fails closed when required critical thresholds are missing', () => {
    expect(() => assertRequiredCriticalThresholds({
      required: true,
      criticalLow: null,
      criticalHigh: null,
    })).toThrowError(expect.objectContaining({ code: 'critical_threshold_not_configured' }));
  });

  it('enforces separation of duties when configured', () => {
    expect(() => assertSeparationOfDuties({
      required: true,
      verifierUserId: 41,
      releaserUserId: 41,
    })).toThrowError(expect.objectContaining({ code: 'separation_of_duties_violation' }));
  });

  it('requires final release evidence before final rendering', () => {
    expect(() => assertFinalReleaseEvidence({
      reportStatus: 'pending',
      releaseVersion: null,
      releaseSnapshotDigest: null,
    })).toThrowError(expect.objectContaining({ code: 'final_release_required' }));
  });

  it('rejects retracted reports even with release-like metadata', () => {
    expect(() => assertFinalReleaseEvidence({
      reportStatus: 'released',
      retractedAt: '2026-08-11T00:00:00Z',
      releaseVersion: 1,
      releaseSnapshotDigest: 'a'.repeat(64),
    })).toThrowError(expect.objectContaining({ code: 'report_retracted' }));
  });

  it('accepts a properly bound released report', () => {
    expect(() => assertFinalReleaseEvidence({
      reportStatus: 'released',
      releaseVersion: 3,
      releaseSnapshotDigest: 'a'.repeat(64),
    })).not.toThrow();
  });

  it('canonicalizes object keys deterministically', () => {
    const a = canonicalClinicalSnapshotJson({ z: 1, a: { d: 4, b: 2 } });
    const b = canonicalClinicalSnapshotJson({ a: { b: 2, d: 4 }, z: 1 });
    expect(a).toBe(b);
  });

  it('produces the same digest for semantically identical snapshots', async () => {
    const a = await digestClinicalSnapshot({ result: 4.2, unit: 'mmol/L', ids: { report: 8, order: 2 } });
    const b = await digestClinicalSnapshot({ ids: { order: 2, report: 8 }, unit: 'mmol/L', result: 4.2 });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });

  it('detects a TOCTOU change after verification', () => {
    expect(() => assertVerifiedSnapshotUnchanged({
      verifiedDigest: 'a'.repeat(64),
      currentDigest: 'b'.repeat(64),
    })).toThrowError(expect.objectContaining({ code: 'verified_snapshot_changed' }));
  });

  it('uses a typed policy error for machine-readable failures', () => {
    try {
      assertSeparationOfDuties({ required: true, verifierUserId: 1, releaserUserId: 1 });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ClinicalReleasePolicyError);
    }
  });
});
