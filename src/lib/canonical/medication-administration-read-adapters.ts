import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveMedicationAdministrationProjection,
  type MedicationAdministrationParity,
  type MedicationAdministrationProjection,
  type MedicationAdministrationProviderDatabase,
  type MedicationAdministrationProviderInput,
} from './medication-administration-provider';

export interface MedicationAdministrationAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}

export interface MedicationAdministrationShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'medication_administration';
  consumerId: 'cdb124e_mar_detail' | 'cdb124e_reconciliation_summary';
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

export interface MedicationAdministrationReadAdapterResult {
  provider: 'medication_administration';
  projection: MedicationAdministrationProjection;
  shadowEvidence: MedicationAdministrationShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}

export interface MedicationAdministrationReadAdapterDependencies {
  projection: (
    db: MedicationAdministrationProviderDatabase,
    input: MedicationAdministrationProviderInput,
  ) => Promise<MedicationAdministrationProjection>;
}

const DEFAULT_DEPENDENCIES: MedicationAdministrationReadAdapterDependencies = {
  projection: resolveMedicationAdministrationProjection,
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

function parityValues(parity: MedicationAdministrationParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity)
    .filter(([key]) => key !== 'ok')
    .map(([, value]) => value === true);
}

async function shadowEvidence(
  consumerId: MedicationAdministrationShadowEvidenceReceipt['consumerId'],
  projection: MedicationAdministrationProjection,
  raw: MedicationAdministrationAdapterEvidenceInput,
): Promise<MedicationAdministrationShadowEvidenceReceipt | null> {
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
    provider: 'medication_administration' as const,
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
  consumerId: MedicationAdministrationShadowEvidenceReceipt['consumerId'],
  db: MedicationAdministrationProviderDatabase,
  input: MedicationAdministrationProviderInput,
  evidence: MedicationAdministrationAdapterEvidenceInput,
  dependencies: MedicationAdministrationReadAdapterDependencies,
): Promise<MedicationAdministrationReadAdapterResult> {
  const projection = await dependencies.projection(db, input);
  return {
    provider: 'medication_administration',
    projection,
    shadowEvidence: await shadowEvidence(consumerId, projection, evidence),
    rollbackMode: 'legacy',
  };
}

export async function readMedicationAdministrationDetailAdapter(
  db: MedicationAdministrationProviderDatabase,
  input: MedicationAdministrationProviderInput,
  evidence: MedicationAdministrationAdapterEvidenceInput,
  dependencies: MedicationAdministrationReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<MedicationAdministrationReadAdapterResult> {
  return readAdapter('cdb124e_mar_detail', db, input, evidence, dependencies);
}

export async function readMedicationReconciliationSummaryAdapter(
  db: MedicationAdministrationProviderDatabase,
  input: MedicationAdministrationProviderInput,
  evidence: MedicationAdministrationAdapterEvidenceInput,
  dependencies: MedicationAdministrationReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<MedicationAdministrationReadAdapterResult> {
  return readAdapter('cdb124e_reconciliation_summary', db, input, evidence, dependencies);
}
