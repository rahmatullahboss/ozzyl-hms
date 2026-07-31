import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveLabResultSpecimenProjection,
  type LabResultSpecimenParity,
  type LabResultSpecimenProjection,
  type LabResultSpecimenProviderDatabase,
  type LabResultSpecimenProviderInput,
} from './lab-result-specimen-provider';

export interface LabResultSpecimenAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}

export interface LabResultSpecimenShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'lab_result_specimen';
  consumerId:
    | 'cdb125e_specimen_detail'
    | 'cdb125e_patient_result_timeline'
    | 'cdb125e_report_summary';
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

export interface LabResultSpecimenReadAdapterResult {
  provider: 'lab_result_specimen';
  projection: LabResultSpecimenProjection;
  shadowEvidence: LabResultSpecimenShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}

export interface LabResultSpecimenReadAdapterDependencies {
  projection: (
    db: LabResultSpecimenProviderDatabase,
    input: LabResultSpecimenProviderInput,
  ) => Promise<LabResultSpecimenProjection>;
}

const DEFAULT_DEPENDENCIES: LabResultSpecimenReadAdapterDependencies = {
  projection: resolveLabResultSpecimenProjection,
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

function parityValues(parity: LabResultSpecimenParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity)
    .filter(([key]) => key !== 'ok')
    .map(([, value]) => value === true);
}

async function shadowEvidence(
  consumerId: LabResultSpecimenShadowEvidenceReceipt['consumerId'],
  projection: LabResultSpecimenProjection,
  raw: LabResultSpecimenAdapterEvidenceInput,
): Promise<LabResultSpecimenShadowEvidenceReceipt | null> {
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
    provider: 'lab_result_specimen' as const,
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
  consumerId: LabResultSpecimenShadowEvidenceReceipt['consumerId'],
  db: LabResultSpecimenProviderDatabase,
  input: LabResultSpecimenProviderInput,
  evidence: LabResultSpecimenAdapterEvidenceInput,
  dependencies: LabResultSpecimenReadAdapterDependencies,
): Promise<LabResultSpecimenReadAdapterResult> {
  const projection = await dependencies.projection(db, input);
  return {
    provider: 'lab_result_specimen',
    projection,
    shadowEvidence: await shadowEvidence(consumerId, projection, evidence),
    rollbackMode: 'legacy',
  };
}

export async function readLabSpecimenDetailAdapter(
  db: LabResultSpecimenProviderDatabase,
  input: LabResultSpecimenProviderInput,
  evidence: LabResultSpecimenAdapterEvidenceInput,
  dependencies: LabResultSpecimenReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<LabResultSpecimenReadAdapterResult> {
  if (input.sourceType !== 'legacy_lab_specimen') throw new TypeError('specimen detail adapter requires legacy_lab_specimen');
  return readAdapter('cdb125e_specimen_detail', db, input, evidence, dependencies);
}

export async function readLabPatientResultTimelineAdapter(
  db: LabResultSpecimenProviderDatabase,
  input: LabResultSpecimenProviderInput,
  evidence: LabResultSpecimenAdapterEvidenceInput,
  dependencies: LabResultSpecimenReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<LabResultSpecimenReadAdapterResult> {
  if (input.sourceType !== 'legacy_lab_result_set') throw new TypeError('patient result timeline adapter requires legacy_lab_result_set');
  return readAdapter('cdb125e_patient_result_timeline', db, input, evidence, dependencies);
}

export async function readLabReportSummaryAdapter(
  db: LabResultSpecimenProviderDatabase,
  input: LabResultSpecimenProviderInput,
  evidence: LabResultSpecimenAdapterEvidenceInput,
  dependencies: LabResultSpecimenReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<LabResultSpecimenReadAdapterResult> {
  if (input.sourceType !== 'legacy_lab_result_set') throw new TypeError('report summary adapter requires legacy_lab_result_set');
  return readAdapter('cdb125e_report_summary', db, input, evidence, dependencies);
}
