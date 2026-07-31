import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveMedicationOrderProjection,
  resolvePrescriptionDocumentProjection,
  type MedicationOrderParity,
  type MedicationOrderProjection,
  type MedicationOrderProviderInput,
  type PrescriptionDocumentParity,
  type PrescriptionDocumentProjection,
  type PrescriptionDocumentProviderInput,
  type PrescriptionMedicationProviderDatabase,
} from './prescription-medication-provider';

export interface PrescriptionMedicationAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}

export interface PrescriptionMedicationShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'prescription_medication_intent';
  consumerId: 'cdb121e_prescription_detail' | 'cdb121e_medication_order_detail';
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

export interface PrescriptionMedicationReadAdapterResult<T> {
  provider: 'prescription_medication_intent';
  projection: T;
  shadowEvidence: PrescriptionMedicationShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}

export interface PrescriptionMedicationReadAdapterDependencies {
  prescription: (
    db: PrescriptionMedicationProviderDatabase,
    input: PrescriptionDocumentProviderInput,
  ) => Promise<PrescriptionDocumentProjection>;
  medicationOrder: (
    db: PrescriptionMedicationProviderDatabase,
    input: MedicationOrderProviderInput,
  ) => Promise<MedicationOrderProjection>;
}

const DEFAULT_DEPENDENCIES: PrescriptionMedicationReadAdapterDependencies = {
  prescription: resolvePrescriptionDocumentProjection,
  medicationOrder: resolveMedicationOrderProjection,
};

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function exactExceptionIds(values: string[]): string[] {
  const normalized = values.map((value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed !== value) {
      throw new TypeError('acceptedExceptionIds must contain exact non-empty values');
    }
    return trimmed;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('acceptedExceptionIds must be unique');
  }
  return normalized.sort();
}

function parityValues(parity: PrescriptionDocumentParity | MedicationOrderParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity)
    .filter(([key]) => key !== 'ok')
    .map(([, value]) => value === true);
}

async function createShadowEvidence(
  consumerId: PrescriptionMedicationShadowEvidenceReceipt['consumerId'],
  mode: string,
  parity: PrescriptionDocumentParity | MedicationOrderParity | undefined,
  raw: PrescriptionMedicationAdapterEvidenceInput,
): Promise<PrescriptionMedicationShadowEvidenceReceipt | null> {
  if (mode !== 'shadow') return null;
  const elapsedMs = nonnegative(raw.elapsedMs, 'elapsedMs');
  const errorCount = nonnegative(raw.errorCount, 'errorCount');
  const latencyBudgetMs = positive(raw.latencyBudgetMs, 'latencyBudgetMs');
  const acceptedExceptionIds = exactExceptionIds(raw.acceptedExceptionIds);
  const observedAtUtc = toUtcIso(raw.observedAtUtc);
  const comparisons = parityValues(parity);
  const matchedCount = comparisons.filter(Boolean).length;
  const mismatchCount = comparisons.length - matchedCount;
  const aggregate = {
    schemaVersion: 1 as const,
    provider: 'prescription_medication_intent' as const,
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
  return {
    ...aggregate,
    evidenceSha256: await createSourceEvidenceSha256(aggregate),
  };
}

export async function readPrescriptionDocumentAdapter(
  db: PrescriptionMedicationProviderDatabase,
  input: PrescriptionDocumentProviderInput,
  evidence: PrescriptionMedicationAdapterEvidenceInput,
  dependencies: PrescriptionMedicationReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<PrescriptionMedicationReadAdapterResult<PrescriptionDocumentProjection>> {
  const projection = await dependencies.prescription(db, input);
  return {
    provider: 'prescription_medication_intent',
    projection,
    shadowEvidence: await createShadowEvidence(
      'cdb121e_prescription_detail',
      projection.mode,
      projection.parity,
      evidence,
    ),
    rollbackMode: 'legacy',
  };
}

export async function readMedicationOrderAdapter(
  db: PrescriptionMedicationProviderDatabase,
  input: MedicationOrderProviderInput,
  evidence: PrescriptionMedicationAdapterEvidenceInput,
  dependencies: PrescriptionMedicationReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<PrescriptionMedicationReadAdapterResult<MedicationOrderProjection>> {
  const projection = await dependencies.medicationOrder(db, input);
  return {
    provider: 'prescription_medication_intent',
    projection,
    shadowEvidence: await createShadowEvidence(
      'cdb121e_medication_order_detail',
      projection.mode,
      projection.parity,
      evidence,
    ),
    rollbackMode: 'legacy',
  };
}
