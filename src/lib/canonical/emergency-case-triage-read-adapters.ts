import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveEmergencyCaseTriageProjection,
  type EmergencyCaseTriageParity,
  type EmergencyCaseTriageProjection,
  type EmergencyCaseTriageProviderDatabase,
  type EmergencyCaseTriageProviderInput,
} from './emergency-case-triage-provider';

export interface EmergencyCaseTriageAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}
export interface EmergencyCaseTriageShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'emergency_case_triage';
  consumerId:
    | 'cdb127e_emergency_board_worklist'
    | 'cdb127e_patient_timeline_summary'
    | 'cdb127e_disposition_handoff';
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
export interface EmergencyCaseTriageReadAdapterResult {
  provider: 'emergency_case_triage';
  projection: EmergencyCaseTriageProjection;
  shadowEvidence: EmergencyCaseTriageShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}
export interface EmergencyCaseTriageReadAdapterDependencies {
  projection: (
    db: EmergencyCaseTriageProviderDatabase,
    input: EmergencyCaseTriageProviderInput,
  ) => Promise<EmergencyCaseTriageProjection>;
}
const DEFAULT_DEPENDENCIES: EmergencyCaseTriageReadAdapterDependencies = {
  projection: resolveEmergencyCaseTriageProjection,
};

function nonnegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative safe integer`);
  return value;
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}
function exceptions(values: string[]): string[] {
  const normalized = values.map((value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed !== value) throw new TypeError('acceptedExceptionIds must contain exact non-empty values');
    return trimmed;
  });
  if (new Set(normalized).size !== normalized.length) throw new TypeError('acceptedExceptionIds must be unique');
  return normalized.sort();
}
function parityValues(parity: EmergencyCaseTriageParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity).filter(([key]) => key !== 'ok').map(([, value]) => value === true);
}
async function shadowEvidence(
  consumerId: EmergencyCaseTriageShadowEvidenceReceipt['consumerId'],
  projection: EmergencyCaseTriageProjection,
  raw: EmergencyCaseTriageAdapterEvidenceInput,
): Promise<EmergencyCaseTriageShadowEvidenceReceipt | null> {
  if (projection.mode !== 'shadow') return null;
  const elapsedMs = nonnegative(raw.elapsedMs, 'elapsedMs');
  const errorCount = nonnegative(raw.errorCount, 'errorCount');
  const latencyBudgetMs = positive(raw.latencyBudgetMs, 'latencyBudgetMs');
  const acceptedExceptionIds = exceptions(raw.acceptedExceptionIds);
  const observedAtUtc = toUtcIso(raw.observedAtUtc);
  const comparisons = parityValues(projection.parity);
  const matchedCount = comparisons.filter(Boolean).length;
  const mismatchCount = comparisons.length - matchedCount;
  const aggregate = {
    schemaVersion: 1 as const,
    provider: 'emergency_case_triage' as const,
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
  consumerId: EmergencyCaseTriageShadowEvidenceReceipt['consumerId'],
  db: EmergencyCaseTriageProviderDatabase,
  input: EmergencyCaseTriageProviderInput,
  evidence: EmergencyCaseTriageAdapterEvidenceInput,
  dependencies: EmergencyCaseTriageReadAdapterDependencies,
): Promise<EmergencyCaseTriageReadAdapterResult> {
  const projection = await dependencies.projection(db, input);
  return {
    provider: 'emergency_case_triage',
    projection,
    shadowEvidence: await shadowEvidence(consumerId, projection, evidence),
    rollbackMode: 'legacy',
  };
}

export function readEmergencyBoardAdapter(
  db: EmergencyCaseTriageProviderDatabase,
  input: EmergencyCaseTriageProviderInput,
  evidence: EmergencyCaseTriageAdapterEvidenceInput,
  dependencies: EmergencyCaseTriageReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<EmergencyCaseTriageReadAdapterResult> {
  return readAdapter('cdb127e_emergency_board_worklist', db, input, evidence, dependencies);
}
export function readEmergencyPatientTimelineAdapter(
  db: EmergencyCaseTriageProviderDatabase,
  input: EmergencyCaseTriageProviderInput,
  evidence: EmergencyCaseTriageAdapterEvidenceInput,
  dependencies: EmergencyCaseTriageReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<EmergencyCaseTriageReadAdapterResult> {
  return readAdapter('cdb127e_patient_timeline_summary', db, { ...input, identitySensitive: true }, evidence, dependencies);
}
export function readEmergencyDispositionHandoffAdapter(
  db: EmergencyCaseTriageProviderDatabase,
  input: EmergencyCaseTriageProviderInput,
  evidence: EmergencyCaseTriageAdapterEvidenceInput,
  dependencies: EmergencyCaseTriageReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<EmergencyCaseTriageReadAdapterResult> {
  return readAdapter('cdb127e_disposition_handoff', db, { ...input, identitySensitive: true }, evidence, dependencies);
}
