import { createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';
import {
  resolveRadiologyAcquisitionReportProjection,
  type RadiologyAcquisitionReportParity,
  type RadiologyAcquisitionReportProjection,
  type RadiologyAcquisitionReportProviderDatabase,
  type RadiologyAcquisitionReportProviderInput,
} from './radiology-acquisition-report-provider';

export interface RadiologyAcquisitionReportAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
}
export interface RadiologyAcquisitionReportShadowEvidenceReceipt {
  schemaVersion: 1;
  provider: 'radiology_acquisition_report';
  consumerId:
    | 'cdb126e_acquisition_worklist_detail'
    | 'cdb126e_pacs_hierarchy_provenance'
    | 'cdb126e_patient_timeline_imaging_result'
    | 'cdb126e_report_rendering_summary';
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
export interface RadiologyAcquisitionReportReadAdapterResult {
  provider: 'radiology_acquisition_report';
  projection: RadiologyAcquisitionReportProjection;
  shadowEvidence: RadiologyAcquisitionReportShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}
export interface RadiologyAcquisitionReportReadAdapterDependencies {
  projection: (
    db: RadiologyAcquisitionReportProviderDatabase,
    input: RadiologyAcquisitionReportProviderInput,
  ) => Promise<RadiologyAcquisitionReportProjection>;
}
const DEFAULT_DEPENDENCIES: RadiologyAcquisitionReportReadAdapterDependencies = {
  projection: resolveRadiologyAcquisitionReportProjection,
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
function parityValues(parity: RadiologyAcquisitionReportParity | undefined): boolean[] {
  if (!parity) return [false];
  return Object.entries(parity).filter(([key]) => key !== 'ok').map(([, value]) => value === true);
}
async function shadowEvidence(
  consumerId: RadiologyAcquisitionReportShadowEvidenceReceipt['consumerId'],
  projection: RadiologyAcquisitionReportProjection,
  raw: RadiologyAcquisitionReportAdapterEvidenceInput,
): Promise<RadiologyAcquisitionReportShadowEvidenceReceipt | null> {
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
    provider: 'radiology_acquisition_report' as const,
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
  consumerId: RadiologyAcquisitionReportShadowEvidenceReceipt['consumerId'],
  db: RadiologyAcquisitionReportProviderDatabase,
  input: RadiologyAcquisitionReportProviderInput,
  evidence: RadiologyAcquisitionReportAdapterEvidenceInput,
  dependencies: RadiologyAcquisitionReportReadAdapterDependencies,
): Promise<RadiologyAcquisitionReportReadAdapterResult> {
  const projection = await dependencies.projection(db, input);
  return {
    provider: 'radiology_acquisition_report',
    projection,
    shadowEvidence: await shadowEvidence(consumerId, projection, evidence),
    rollbackMode: 'legacy',
  };
}

export async function readRadiologyAcquisitionWorklistAdapter(
  db: RadiologyAcquisitionReportProviderDatabase,
  input: RadiologyAcquisitionReportProviderInput,
  evidence: RadiologyAcquisitionReportAdapterEvidenceInput,
  dependencies: RadiologyAcquisitionReportReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<RadiologyAcquisitionReportReadAdapterResult> {
  if (input.sourceType !== 'legacy_radiology_requisition') throw new TypeError('acquisition worklist adapter requires legacy_radiology_requisition');
  return readAdapter('cdb126e_acquisition_worklist_detail', db, input, evidence, dependencies);
}
export async function readRadiologyPacsHierarchyAdapter(
  db: RadiologyAcquisitionReportProviderDatabase,
  input: RadiologyAcquisitionReportProviderInput,
  evidence: RadiologyAcquisitionReportAdapterEvidenceInput,
  dependencies: RadiologyAcquisitionReportReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<RadiologyAcquisitionReportReadAdapterResult> {
  if (input.sourceType !== 'legacy_radiology_dicom_study') throw new TypeError('PACS hierarchy adapter requires legacy_radiology_dicom_study');
  return readAdapter('cdb126e_pacs_hierarchy_provenance', db, input, evidence, dependencies);
}
export async function readRadiologyPatientTimelineAdapter(
  db: RadiologyAcquisitionReportProviderDatabase,
  input: RadiologyAcquisitionReportProviderInput,
  evidence: RadiologyAcquisitionReportAdapterEvidenceInput,
  dependencies: RadiologyAcquisitionReportReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<RadiologyAcquisitionReportReadAdapterResult> {
  if (input.sourceType !== 'legacy_radiology_report') throw new TypeError('patient timeline imaging adapter requires legacy_radiology_report');
  return readAdapter('cdb126e_patient_timeline_imaging_result', db, input, evidence, dependencies);
}
export async function readRadiologyReportRenderingAdapter(
  db: RadiologyAcquisitionReportProviderDatabase,
  input: RadiologyAcquisitionReportProviderInput,
  evidence: RadiologyAcquisitionReportAdapterEvidenceInput,
  dependencies: RadiologyAcquisitionReportReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<RadiologyAcquisitionReportReadAdapterResult> {
  if (input.sourceType !== 'legacy_radiology_report') throw new TypeError('report rendering adapter requires legacy_radiology_report');
  return readAdapter('cdb126e_report_rendering_summary', db, input, evidence, dependencies);
}
