export const CLINICAL_RELEASE_FAILURE_CODES = [
  'report_not_found',
  'report_retracted',
  'tenant_mismatch',
  'specimen_invalid',
  'mandatory_result_missing',
  'verified_snapshot_missing',
  'verified_snapshot_changed',
  'qc_missing_or_stale',
  'qc_failed',
  'calibration_missing_or_stale',
  'calibration_failed',
  'reagent_or_control_lot_invalid',
  'validation_configuration_invalid',
  'validation_failed',
  'critical_threshold_not_configured',
  'critical_communication_incomplete',
  'separation_of_duties_violation',
  'release_version_conflict',
  'final_release_required',
] as const;

export type ClinicalReleaseFailureCode = typeof CLINICAL_RELEASE_FAILURE_CODES[number];

export class ClinicalReleasePolicyError extends Error {
  constructor(
    message: string,
    public readonly code: ClinicalReleaseFailureCode,
    public readonly status = 409,
  ) {
    super(message);
    this.name = 'ClinicalReleasePolicyError';
  }
}

export type ClinicalAbnormalFlag = 'normal' | 'high' | 'low' | 'critical' | 'pending';

/**
 * Clinical criticality must come from approved explicit thresholds. Normal
 * reference intervals are never extrapolated into synthetic critical limits.
 */
export function classifyClinicalNumericResult(input: {
  numericValue: number | null | undefined;
  normalLow: number | null | undefined;
  normalHigh: number | null | undefined;
  criticalLow: number | null | undefined;
  criticalHigh: number | null | undefined;
}): ClinicalAbnormalFlag {
  const { numericValue, normalLow, normalHigh, criticalLow, criticalHigh } = input;
  if (numericValue == null || !Number.isFinite(numericValue)) return 'pending';

  if (criticalLow != null && Number.isFinite(criticalLow) && numericValue < criticalLow) return 'critical';
  if (criticalHigh != null && Number.isFinite(criticalHigh) && numericValue > criticalHigh) return 'critical';

  if (normalLow == null || normalHigh == null || !Number.isFinite(normalLow) || !Number.isFinite(normalHigh)) {
    return 'pending';
  }
  if (numericValue < normalLow) return 'low';
  if (numericValue > normalHigh) return 'high';
  return 'normal';
}

export function assertRequiredCriticalThresholds(input: {
  required: boolean;
  criticalLow: number | null | undefined;
  criticalHigh: number | null | undefined;
}): void {
  if (!input.required) return;
  const hasLow = input.criticalLow != null && Number.isFinite(input.criticalLow);
  const hasHigh = input.criticalHigh != null && Number.isFinite(input.criticalHigh);
  if (!hasLow && !hasHigh) {
    throw new ClinicalReleasePolicyError(
      'Required critical thresholds are not configured',
      'critical_threshold_not_configured',
      422,
    );
  }
}

export function assertSeparationOfDuties(input: {
  required: boolean;
  verifierUserId: string | number | null | undefined;
  releaserUserId: string | number | null | undefined;
}): void {
  if (!input.required) return;
  if (input.verifierUserId == null || input.releaserUserId == null) {
    throw new ClinicalReleasePolicyError(
      'Verifier and releaser identities are required',
      'separation_of_duties_violation',
    );
  }
  if (String(input.verifierUserId) === String(input.releaserUserId)) {
    throw new ClinicalReleasePolicyError(
      'The verifier cannot also perform final clinical release',
      'separation_of_duties_violation',
    );
  }
}

export function assertFinalReleaseEvidence(input: {
  reportStatus: string | null | undefined;
  retractedAt?: string | null;
  releaseVersion?: number | null;
  releaseSnapshotDigest?: string | null;
}): void {
  if (input.retractedAt || String(input.reportStatus ?? '').trim().toLowerCase() === 'retracted') {
    throw new ClinicalReleasePolicyError('Retracted report cannot be rendered as final', 'report_retracted', 409);
  }

  const status = String(input.reportStatus ?? '').trim().toLowerCase();
  if (!['released', 'published', 'final'].includes(status)) {
    throw new ClinicalReleasePolicyError('Final clinical release is required', 'final_release_required', 409);
  }
  if (!Number.isInteger(input.releaseVersion) || Number(input.releaseVersion) <= 0) {
    throw new ClinicalReleasePolicyError('Clinical release version is missing', 'verified_snapshot_missing', 409);
  }
  if (!input.releaseSnapshotDigest || !/^[a-f0-9]{64}$/i.test(input.releaseSnapshotDigest)) {
    throw new ClinicalReleasePolicyError('Clinical release snapshot digest is missing or invalid', 'verified_snapshot_missing', 409);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const child = source[key];
        if (child !== undefined) acc[key] = canonicalize(child);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalClinicalSnapshotJson(snapshot: unknown): string {
  return JSON.stringify(canonicalize(snapshot));
}

export async function digestClinicalSnapshot(snapshot: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalClinicalSnapshotJson(snapshot));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function assertVerifiedSnapshotUnchanged(input: {
  verifiedDigest: string | null | undefined;
  currentDigest: string | null | undefined;
}): void {
  if (!input.verifiedDigest || !input.currentDigest) {
    throw new ClinicalReleasePolicyError('Verified clinical snapshot is missing', 'verified_snapshot_missing', 409);
  }
  if (input.verifiedDigest !== input.currentDigest) {
    throw new ClinicalReleasePolicyError(
      'Clinical content changed after verification; re-verification is required',
      'verified_snapshot_changed',
      409,
    );
  }
}
