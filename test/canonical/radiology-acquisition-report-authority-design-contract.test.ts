import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const auditPath = 'docs/database/audits/2026-07-28-radiology-acquisition-report-authority-audit.md';
const specPath = 'docs/superpowers/specs/2026-07-28-cdb-126a-radiology-acquisition-report-authority-design.md';
const planPath = 'docs/superpowers/plans/2026-07-28-cdb-126-radiology-acquisition-report-authority.md';
const receiptPath = 'docs/database/migration-runs/P12-canonical-radiology-acquisition-report-authority-design.md';
const matrixPath = 'docs/database/canonical-authority-matrix.yaml';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CDB-126A radiology acquisition and report authority design contract', () => {
  it('creates substantial design-only audit, specification, plan, and receipt', () => {
    for (const path of [auditPath, specPath, planPath, receiptPath]) {
      expect(existsSync(path)).toBe(true);
      expect(read(path).length).toBeGreaterThan(5_000);
    }
    const migrationExists = existsSync('migrations/0559_canonical_radiology_acquisition_report.sql');
    const schemaExists = existsSync('src/db/schema/canonical/radiology-acquisition-report.ts');
    const commandExists = existsSync('src/lib/canonical/commands/manage-radiology-acquisition-report.ts');
    expect(schemaExists).toBe(migrationExists);
    expect(commandExists && !schemaExists).toBe(false);
  });

  it('reuses service order authority and separates acquisition, DICOM hierarchy, provenance, report versions, and projections', () => {
    const spec = read(specPath);
    for (const text of [
      'canonical_service_requests',
      'canonical_service_events',
      'canonical_service_participants',
      'canonical_imaging_acquisitions',
      'canonical_imaging_acquisition_status_events',
      'canonical_imaging_studies',
      'canonical_imaging_series',
      'canonical_imaging_instances',
      'canonical_imaging_provenance_events',
      'canonical_imaging_report_sets',
      'canonical_imaging_report_versions',
      'canonical_imaging_report_status_events',
      'report rendering and delivery are projections',
      'raw DICOM pixel data',
    ]) expect(spec).toContain(text);
  });

  it('locks exact UID, accession, practitioner, content-hash, correction, storage, and entered-in-error invariants', () => {
    const spec = read(specPath);
    for (const text of [
      'Study Instance UID',
      'Series Instance UID',
      'SOP Instance UID',
      'accession',
      'modality',
      'source AE title',
      'PACS endpoint',
      'content SHA-256',
      'signed content SHA-256',
      'correction creates a complete replacement version',
      'retraction',
      'entered-in-error',
      'immutable',
      'exact reviewed mapping',
      'patient name',
      'timestamp',
      'similarity',
    ]) expect(spec).toContain(text);
  });

  it('defines sixteen commands, ten persistent partitions, and fixed thirty checks', () => {
    const plan = read(planPath);
    const receipt = read(receiptPath);
    expect(plan).toContain('Sixteen atomic commands');
    expect(plan).toContain('Ten persistent bounded/resumable backfill partitions');
    expect(plan).toContain('Fixed thirty-check reconciliation');
    for (const text of [
      'registerCanonicalImagingAcquisition',
      'startCanonicalImagingAcquisition',
      'completeCanonicalImagingAcquisition',
      'cancelCanonicalImagingAcquisition',
      'enterCanonicalImagingAcquisitionInError',
      'registerCanonicalImagingStudy',
      'registerCanonicalImagingSeries',
      'registerCanonicalImagingInstance',
      'recordCanonicalImagingProvenance',
      'createCanonicalImagingReportDraft',
      'replaceCanonicalImagingReportDraft',
      'verifyCanonicalImagingReportVersion',
      'finalizeAndPublishCanonicalImagingReportVersion',
      'correctCanonicalImagingReportVersion',
      'retractCanonicalImagingReportVersion',
      'enterCanonicalImagingReportInError',
    ]) expect(plan).toContain(text);
    expect(receipt).toContain('target table count: 9');
    expect(receipt).toContain('planned command count: 16');
    expect(receipt).toContain('persistent backfill partition count: 10');
    expect(receipt).toContain('persistent reconciliation check count: 30');
  });

  it('audits all major mutable sources and writer/reader surfaces without declaring them Canonical', () => {
    const audit = read(auditPath);
    for (const text of [
      'radiology_requisitions',
      'radiology_reports',
      'radiology_dicom_studies',
      'ris_study_reconciliation_queue',
      'radiology_report_templates',
      'radiology_film_usage',
      'invoice_items',
      'src/routes/tenant/radiology/orders.ts',
      'src/routes/tenant/radiology/reports.ts',
      'src/routes/tenant/radiology/pacs.ts',
      'src/lib/radiology-cancellation.ts',
      'src/lib/canonical/patient-chart-radiology-billing.ts',
      'src/routes/tenant/patients-chart.ts',
      'src/routes/tenant/patients-timeline.ts',
      'src/routes/tenant/nursing/investigation-results.ts',
      'legacy compatibility source',
      'not Canonical authority',
    ]) expect(audit).toContain(text);
  });

  it('retains CDB-126A design evidence while allowing later verified implementation checkpoints', () => {
    const matrix = read(matrixPath);
    const tracker = read(trackerPath);
    const control = read(controlPath);
    expect(matrix).toContain('radiology_acquisition_report');
    expect(matrix).toContain('local_ready_provider_disabled');
    expect(matrix).toContain(auditPath);
    expect(matrix).toContain(specPath);
    expect(matrix).toContain(planPath);
    expect(matrix).toContain('src/lib/canonical/commands/manage-radiology-acquisition-report.ts');
    expect(tracker).toContain('CDB-126A-RADIOLOGY-ACQUISITION-REPORT-AUTHORITY-DESIGN-VERIFIED');
    expect(tracker).toContain('CDB-126B-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-SCHEMA-VERIFIED');
    expect(tracker).toContain('CDB-126C-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-COMMANDS-VERIFIED');
    expect(tracker).toContain('CDB-126D-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-BACKFILL-RECONCILIATION');
    expect(control).toContain('CDB-126A-RADIOLOGY-ACQUISITION-REPORT-AUTHORITY-DESIGN-VERIFIED');
    expect(control).toContain('CDB-126C-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-COMMANDS-VERIFIED');
    expect(control).toContain('CDB-126D-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-BACKFILL-RECONCILIATION');
  });
});
