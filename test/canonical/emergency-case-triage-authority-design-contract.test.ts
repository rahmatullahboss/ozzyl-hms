import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const auditPath = 'docs/database/audits/2026-07-28-emergency-case-triage-authority-audit.md';
const specPath = 'docs/superpowers/specs/2026-07-28-cdb-127a-emergency-case-triage-authority-design.md';
const planPath = 'docs/superpowers/plans/2026-07-28-cdb-127-emergency-case-triage-authority.md';
const receiptPath = 'docs/database/migration-runs/P12-canonical-emergency-case-triage-authority-design.md';
const matrixPath = 'docs/database/canonical-authority-matrix.yaml';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CDB-127A emergency case and triage authority design contract', () => {
  it('retains substantial design evidence while allowing later reviewed implementation checkpoints', () => {
    for (const path of [auditPath, specPath, planPath, receiptPath]) {
      expect(existsSync(path)).toBe(true);
      expect(read(path).length).toBeGreaterThan(5_000);
    }
    const migrationExists = existsSync('migrations/0560_canonical_emergency_case_triage.sql');
    const schemaExists = existsSync('src/db/schema/canonical/emergency-case-triage.ts');
    const commandExists = existsSync('src/lib/canonical/commands/manage-emergency-case-triage.ts');
    const providerExists = existsSync('src/lib/canonical/emergency-case-triage-provider.ts');
    expect(schemaExists).toBe(migrationExists);
    expect(commandExists && !schemaExists).toBe(false);
    expect(providerExists && !commandExists).toBe(false);
  });

  it('reuses existing patient, encounter, practitioner, service, document, diagnosis, vital, medication, admission, and finance authorities', () => {
    const spec = read(specPath);
    for (const text of [
      'canonical_tenant_patient_links',
      'canonical_encounters',
      'canonical_practitioners',
      'canonical_service_requests',
      'canonical_service_events',
      'canonical_clinical_documents',
      'canonical_diagnosis_assertions',
      'canonical_vital_observation_sets',
      'canonical_medication_administration_events',
      'canonical_admissions',
      'canonical_invoices',
      'does not duplicate',
      'signed discharge summary',
    ]) expect(spec).toContain(text);
  });

  it('defines six emergency extension tables and separates arrival, lifecycle, triage, classification, and disposition evidence', () => {
    const spec = read(specPath);
    for (const text of [
      'canonical_emergency_cases',
      'canonical_emergency_arrival_assessments',
      'canonical_emergency_case_status_events',
      'canonical_emergency_triage_assessments',
      'canonical_emergency_case_classifications',
      'canonical_emergency_disposition_events',
      'one emergency case per Canonical encounter',
      'immutable',
      'replacement lineage',
      'current triage pointer',
      'current disposition pointer',
    ]) expect(spec).toContain(text);
  });

  it('locks exact identity, acuity, practitioner, time, disposition, correction, and entered-in-error invariants', () => {
    const spec = read(specPath);
    for (const text of [
      'exact reviewed mapping',
      'patient name',
      'phone',
      'numeric ID coincidence',
      'timestamp proximity',
      'red',
      'yellow',
      'green',
      'triage practitioner',
      'observed time',
      'recorded time',
      'admitted',
      'discharged',
      'transferred',
      'lama',
      'dor',
      'death',
      'correction creates a replacement',
      'entered-in-error',
      'Hard delete',
    ]) expect(spec).toContain(text);
  });

  it('defines nine commands, eight persistent partitions, fixed twenty-four checks, and a disabled-safe provider plan', () => {
    const plan = read(planPath);
    const receipt = read(receiptPath);
    expect(plan).toContain('Nine atomic commands');
    expect(plan).toContain('Eight persistent bounded/resumable backfill partitions');
    expect(plan).toContain('Fixed twenty-four-check reconciliation');
    for (const text of [
      'registerCanonicalEmergencyCase',
      'replaceCanonicalEmergencyArrivalAssessment',
      'recordCanonicalEmergencyTriageAssessment',
      'correctCanonicalEmergencyTriageAssessment',
      'recordCanonicalEmergencyCaseClassification',
      'correctCanonicalEmergencyCaseClassification',
      'transitionCanonicalEmergencyCase',
      'recordCanonicalEmergencyDisposition',
      'enterCanonicalEmergencyCaseInError',
      'canonical_emergency_case_triage_provider_v1',
      'legacy',
      'shadow',
      'canonical',
    ]) expect(plan).toContain(text);
    expect(receipt).toContain('target table count: 6');
    expect(receipt).toContain('planned command count: 9');
    expect(receipt).toContain('persistent backfill partition count: 8');
    expect(receipt).toContain('persistent reconciliation check count: 24');
  });

  it('audits mutable and stale sources plus actual writer/reader surfaces and advances program metadata', () => {
    const audit = read(auditPath);
    for (const text of [
      'er_patients',
      'er_patient_cases',
      'er_discharge_summaries',
      'er_file_uploads',
      'er_mode_of_arrival',
      'visits',
      'admissions',
      'emergency_visits',
      'src/routes/tenant/emergency.ts',
      'src/routes/tenant/reception.ts',
      'src/routes/tenant/admissions.ts',
      'src/routes/tenant/qualityKpi.ts',
      'src/routes/tenant/doctors.ts',
      'src/routes/tenant/ipdReports.ts',
      'legacy compatibility source',
      'not Canonical authority',
    ]) expect(audit).toContain(text);

    const matrix = read(matrixPath);
    const tracker = read(trackerPath);
    const control = read(controlPath);
    const emergencyConcept = matrix.slice(
      matrix.indexOf('"id": "emergency_case_extension"'),
      matrix.indexOf('"id": "operation_theatre_procedure"'),
    );
    expect(emergencyConcept).toContain('emergency_case_extension');
    expect(emergencyConcept).not.toContain('canonical_gap');
    expect(emergencyConcept).toContain(auditPath);
    expect(emergencyConcept).toContain(specPath);
    expect(emergencyConcept).toContain(planPath);
    expect(tracker).toContain('CDB-127A-EMERGENCY-CASE-TRIAGE-AUTHORITY-DESIGN-VERIFIED');
    expect(tracker).toContain('CDB-127B-CANONICAL-EMERGENCY-CASE-TRIAGE-SCHEMA');
    expect(control).toContain('CDB-127A-EMERGENCY-CASE-TRIAGE-AUTHORITY-DESIGN-VERIFIED');
    expect(control).toContain('CDB-127B-CANONICAL-EMERGENCY-CASE-TRIAGE-SCHEMA');
  });
});
