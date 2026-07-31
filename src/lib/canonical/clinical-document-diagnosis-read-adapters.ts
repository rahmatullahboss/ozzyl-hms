import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveClinicalDiagnosisProjection,
  resolveClinicalDocumentProjection,
  type ClinicalDiagnosisParity,
  type ClinicalDiagnosisProjection,
  type ClinicalDiagnosisProviderInput,
  type ClinicalDocumentDiagnosisProviderDatabase,
  type ClinicalDocumentParity,
  type ClinicalDocumentProjection,
  type ClinicalDocumentProviderInput,
} from './clinical-document-diagnosis-provider';

export interface ClinicalDocumentDiagnosisAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}

export interface ClinicalDocumentDiagnosisShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'clinical_document_diagnosis';
  consumerId: 'cdb122e_clinical_document_detail' | 'cdb122e_clinical_diagnosis_detail';
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

export interface ClinicalDocumentDiagnosisReadAdapterResult<T> {
  provider: 'clinical_document_diagnosis';
  projection: T;
  shadowEvidence: ClinicalDocumentDiagnosisShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}

export interface ClinicalDocumentDiagnosisReadAdapterDependencies {
  document: (
    db: ClinicalDocumentDiagnosisProviderDatabase,
    input: ClinicalDocumentProviderInput,
  ) => Promise<ClinicalDocumentProjection>;
  diagnosis: (
    db: ClinicalDocumentDiagnosisProviderDatabase,
    input: ClinicalDiagnosisProviderInput,
  ) => Promise<ClinicalDiagnosisProjection>;
}

const DEFAULT_DEPENDENCIES: ClinicalDocumentDiagnosisReadAdapterDependencies = {
  document: resolveClinicalDocumentProjection,
  diagnosis: resolveClinicalDiagnosisProjection,
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

function parityValues(parity: ClinicalDocumentParity | ClinicalDiagnosisParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity)
    .filter(([key]) => key !== 'ok')
    .map(([, value]) => value === true);
}

async function shadowEvidence(
  consumerId: ClinicalDocumentDiagnosisShadowEvidenceReceipt['consumerId'],
  mode: string,
  parity: ClinicalDocumentParity | ClinicalDiagnosisParity | undefined,
  raw: ClinicalDocumentDiagnosisAdapterEvidenceInput,
): Promise<ClinicalDocumentDiagnosisShadowEvidenceReceipt | null> {
  if (mode !== 'shadow') return null;
  const elapsedMs = nonnegative(raw.elapsedMs, 'elapsedMs');
  const errorCount = nonnegative(raw.errorCount, 'errorCount');
  const latencyBudgetMs = positive(raw.latencyBudgetMs, 'latencyBudgetMs');
  const acceptedExceptionIds = exceptionIds(raw.acceptedExceptionIds);
  const observedAtUtc = toUtcIso(raw.observedAtUtc);
  const comparisons = parityValues(parity);
  const matchedCount = comparisons.filter(Boolean).length;
  const mismatchCount = comparisons.length - matchedCount;
  const aggregate = {
    schemaVersion: 1 as const,
    provider: 'clinical_document_diagnosis' as const,
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

export async function readClinicalDocumentAdapter(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  input: ClinicalDocumentProviderInput,
  evidence: ClinicalDocumentDiagnosisAdapterEvidenceInput,
  dependencies: ClinicalDocumentDiagnosisReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<ClinicalDocumentDiagnosisReadAdapterResult<ClinicalDocumentProjection>> {
  const projection = await dependencies.document(db, input);
  return {
    provider: 'clinical_document_diagnosis',
    projection,
    shadowEvidence: await shadowEvidence(
      'cdb122e_clinical_document_detail', projection.mode, projection.parity, evidence,
    ),
    rollbackMode: 'legacy',
  };
}

export async function readClinicalDiagnosisAdapter(
  db: ClinicalDocumentDiagnosisProviderDatabase,
  input: ClinicalDiagnosisProviderInput,
  evidence: ClinicalDocumentDiagnosisAdapterEvidenceInput,
  dependencies: ClinicalDocumentDiagnosisReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<ClinicalDocumentDiagnosisReadAdapterResult<ClinicalDiagnosisProjection>> {
  const projection = await dependencies.diagnosis(db, input);
  return {
    provider: 'clinical_document_diagnosis',
    projection,
    shadowEvidence: await shadowEvidence(
      'cdb122e_clinical_diagnosis_detail', projection.mode, projection.parity, evidence,
    ),
    rollbackMode: 'legacy',
  };
}
