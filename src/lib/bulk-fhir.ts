/**
 * Bulk FHIR Export (Async NDJSON)
 *
 * Implements FHIR Bulk Data Access (Flat FHIR) spec:
 *   POST /api/bulk-fhir/$export     — kick off async export
 *   GET  /api/bulk-fhir/status/:id  — poll export status
 *   GET  /api/bulk-fhir/download/:id/:type — download NDJSON file
 *   DELETE /api/bulk-fhir/status/:id — cancel/cleanup export
 *
 * Export runs synchronously for small datasets (D1 limit)
 * and stores result as NDJSON in R2 or inline.
 *
 * Resource types: Patient, Observation, AllergyIntolerance,
 *   MedicationStatement, Condition, DiagnosticReport
 */

export const BULK_RESOURCE_TYPES = [
  'Patient',
  'Observation',
  'AllergyIntolerance',
  'MedicationStatement',
  'Condition',
  'DiagnosticReport',
] as const;

export type BulkResourceType = (typeof BULK_RESOURCE_TYPES)[number];

export type BulkExportStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';

export interface BulkExportJob {
  id: string;
  tenant_id: string;
  status: BulkExportStatus;
  resource_types: BulkResourceType[];
  since: string | null;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
  output: BulkExportOutput[];
}

export interface BulkExportOutput {
  type: BulkResourceType;
  count: number;
  url: string;
}

/**
 * Convert a DB patient row to FHIR Patient NDJSON line.
 */
export function patientToNDJSON(row: Record<string, unknown>): string {
  return JSON.stringify({
    resourceType: 'Patient',
    id: String(row.id),
    name: [{ text: row.name }],
    gender: mapGender(row.gender as string),
    birthDate: row.date_of_birth ?? undefined,
    telecom: row.phone ? [{ system: 'phone', value: row.phone }] : [],
    address: row.address ? [{ text: row.address }] : [],
    identifier: row.nid ? [{ system: 'urn:bangladesh:nid', value: row.nid }] : [],
  });
}

/**
 * Convert a vitals/wellness row to FHIR Observation NDJSON line.
 */
export function observationToNDJSON(row: Record<string, unknown>, patientId: string): string {
  return JSON.stringify({
    resourceType: 'Observation',
    id: String(row.id),
    status: 'final',
    subject: { reference: `Patient/${patientId}` },
    code: { text: row.type ?? row.test_name },
    valueQuantity: row.value != null ? { value: row.value, unit: row.unit ?? '' } : undefined,
    effectiveDateTime: row.recorded_at ?? row.result_date,
  });
}

/**
 * Convert allergy row to FHIR AllergyIntolerance NDJSON line.
 */
export function allergyToNDJSON(row: Record<string, unknown>, patientId: string): string {
  return JSON.stringify({
    resourceType: 'AllergyIntolerance',
    id: String(row.id),
    patient: { reference: `Patient/${patientId}` },
    code: { text: row.allergen },
    type: row.reaction_type ?? 'allergy',
    criticality: row.severity === 'severe' ? 'high' : 'low',
    onsetDateTime: row.onset_date,
  });
}

/**
 * Convert medication row to FHIR MedicationStatement NDJSON line.
 */
export function medicationToNDJSON(row: Record<string, unknown>, patientId: string): string {
  return JSON.stringify({
    resourceType: 'MedicationStatement',
    id: String(row.id),
    subject: { reference: `Patient/${patientId}` },
    medicationCodeableConcept: { text: row.medication_name },
    status: row.status ?? 'active',
    dosage: [{ text: `${row.dose ?? ''} ${row.frequency ?? ''}`.trim() }],
    effectivePeriod: { start: row.start_date, end: row.end_date },
  });
}

/**
 * Convert diagnosis row to FHIR Condition NDJSON line.
 */
export function conditionToNDJSON(row: Record<string, unknown>, patientId: string): string {
  return JSON.stringify({
    resourceType: 'Condition',
    id: String(row.id),
    subject: { reference: `Patient/${patientId}` },
    code: {
      text: row.diagnosis,
      coding: row.icd_code ? [{ system: 'http://hl7.org/fhir/sid/icd-10', code: row.icd_code }] : [],
    },
    clinicalStatus: { coding: [{ code: row.status ?? 'active' }] },
    onsetDateTime: row.onset_date,
  });
}

function mapGender(g: string | null | undefined): string {
  if (!g) return 'unknown';
  const lower = g.toLowerCase();
  if (lower === 'male' || lower === 'm') return 'male';
  if (lower === 'female' || lower === 'f') return 'female';
  return 'other';
}

/**
 * Generate a unique export job ID.
 */
export function generateExportId(): string {
  return `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
