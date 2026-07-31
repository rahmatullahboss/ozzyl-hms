import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveVitalObservationProjection,
  type PatientVitalMeasurementParity,
  type PatientVitalMeasurementProviderDatabase,
  type PatientVitalMeasurementProviderInput,
  type VitalObservationProjection,
} from './patient-vital-measurement-provider';

export interface PatientVitalMeasurementAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}

export interface PatientVitalMeasurementShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'patient_vital_measurement';
  consumerId: 'cdb123e_vital_observation_detail' | 'cdb123e_vital_observation_timeline';
  mode: 'shadow';
  comparisonCount: number;
  matchedCount: number;
  mismatchCount: number;
  criticalMismatchCount: number;
  latencyWithinBudget: boolean;
  errorCount: number;
  acceptedExceptionCount: number;
  observedAtUtc: string;
  evidenceSha256: string;
}

export interface PatientVitalMeasurementReadAdapterResult {
  provider: 'patient_vital_measurement';
  projection: VitalObservationProjection;
  shadowEvidence: PatientVitalMeasurementShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}

export interface PatientVitalMeasurementReadAdapterDependencies {
  observation: (
    db: PatientVitalMeasurementProviderDatabase,
    input: PatientVitalMeasurementProviderInput,
  ) => Promise<VitalObservationProjection>;
}

const DEFAULT_DEPENDENCIES: PatientVitalMeasurementReadAdapterDependencies = {
  observation: resolveVitalObservationProjection,
};

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function exceptionIds(values: string[]): string[] {
  const normalized = values.map((value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed !== value) throw new TypeError('acceptedExceptionIds must contain exact non-empty values');
    return trimmed;
  });
  if (new Set(normalized).size !== normalized.length) throw new TypeError('acceptedExceptionIds must be unique');
  return normalized.sort();
}

function parityValues(parity: PatientVitalMeasurementParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity)
    .filter(([key]) => key !== 'ok')
    .map(([, value]) => value === true);
}

async function shadowEvidence(
  consumerId: PatientVitalMeasurementShadowEvidenceReceipt['consumerId'],
  projection: VitalObservationProjection,
  raw: PatientVitalMeasurementAdapterEvidenceInput,
): Promise<PatientVitalMeasurementShadowEvidenceReceipt | null> {
  if (projection.mode !== 'shadow') return null;
  const elapsedMs = nonnegative(raw.elapsedMs, 'elapsedMs');
  const errorCount = nonnegative(raw.errorCount, 'errorCount');
  const latencyBudgetMs = positive(raw.latencyBudgetMs, 'latencyBudgetMs');
  const acceptedExceptionIds = exceptionIds(raw.acceptedExceptionIds);
  const observedAtUtc = toUtcIso(raw.observedAtUtc);
  const comparisons = parityValues(projection.parity);
  const matchedCount = comparisons.filter(Boolean).length;
  const mismatchCount = comparisons.length - matchedCount;
  const aggregate = {
    schemaVersion: 1 as const,
    provider: 'patient_vital_measurement' as const,
    consumerId,
    mode: 'shadow' as const,
    comparisonCount: comparisons.length,
    matchedCount,
    mismatchCount,
    criticalMismatchCount: mismatchCount,
    latencyWithinBudget: elapsedMs <= latencyBudgetMs,
    errorCount,
    acceptedExceptionCount: acceptedExceptionIds.length,
    observedAtUtc,
  };
  return { ...aggregate, evidenceSha256: await createSourceEvidenceSha256(aggregate) };
}

async function readAdapter(
  consumerId: PatientVitalMeasurementShadowEvidenceReceipt['consumerId'],
  db: PatientVitalMeasurementProviderDatabase,
  input: PatientVitalMeasurementProviderInput,
  evidence: PatientVitalMeasurementAdapterEvidenceInput,
  dependencies: PatientVitalMeasurementReadAdapterDependencies,
): Promise<PatientVitalMeasurementReadAdapterResult> {
  const projection = await dependencies.observation(db, input);
  return {
    provider: 'patient_vital_measurement',
    projection,
    shadowEvidence: await shadowEvidence(consumerId, projection, evidence),
    rollbackMode: 'legacy',
  };
}

export async function readVitalObservationDetailAdapter(
  db: PatientVitalMeasurementProviderDatabase,
  input: PatientVitalMeasurementProviderInput,
  evidence: PatientVitalMeasurementAdapterEvidenceInput,
  dependencies: PatientVitalMeasurementReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<PatientVitalMeasurementReadAdapterResult> {
  return readAdapter('cdb123e_vital_observation_detail', db, input, evidence, dependencies);
}

export async function readVitalObservationTimelineAdapter(
  db: PatientVitalMeasurementProviderDatabase,
  input: PatientVitalMeasurementProviderInput,
  evidence: PatientVitalMeasurementAdapterEvidenceInput,
  dependencies: PatientVitalMeasurementReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<PatientVitalMeasurementReadAdapterResult> {
  return readAdapter('cdb123e_vital_observation_timeline', db, input, evidence, dependencies);
}
