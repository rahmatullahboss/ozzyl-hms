import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const auditPath = 'docs/database/audits/2026-07-28-lab-result-specimen-authority-audit.md';
const specPath = 'docs/superpowers/specs/2026-07-28-cdb-125a-lab-result-specimen-authority-design.md';
const planPath = 'docs/superpowers/plans/2026-07-28-cdb-125-lab-result-specimen-authority.md';
const receiptPath = 'docs/database/migration-runs/P12-canonical-lab-result-specimen-authority-design.md';
const matrixPath = 'docs/database/canonical-authority-matrix.yaml';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CDB-125A lab result and specimen authority design contract', () => {
  it('creates substantial design-only audit, specification, plan, and receipt', () => {
    for (const path of [auditPath, specPath, planPath, receiptPath]) {
      expect(existsSync(path), path).toBe(true);
      expect(read(path).length, path).toBeGreaterThan(3_000);
    }
    const migrationExists = existsSync('migrations/0558_canonical_lab_result_specimen.sql');
    const schemaExists = existsSync('src/db/schema/canonical/lab-result-specimen.ts');
    const commandExists = existsSync('src/lib/canonical/commands/manage-lab-result-specimen.ts');
    expect(schemaExists).toBe(migrationExists);
    expect(commandExists && !schemaExists).toBe(false);
  });

  it('separates service request, specimen custody, result versions, report projection, and analyzer evidence', () => {
    const combined = [auditPath, specPath, planPath].map(read).join('\n');
    for (const text of [
      'canonical_service_requests',
      'canonical_service_events',
      'canonical_lab_specimens',
      'canonical_lab_specimen_service_items',
      'canonical_lab_specimen_status_events',
      'canonical_lab_result_sets',
      'canonical_lab_result_versions',
      'canonical_lab_result_observations',
      'canonical_lab_result_status_events',
      'canonical_lab_analyzer_evidence',
      'report projection',
    ]) expect(combined).toContain(text);
  });

  it('locks immutable specimen, observation, correction, verification, signature, retraction, and analyzer provenance rules', () => {
    const spec = read(specPath);
    for (const text of [
      'accession and barcode are identifiers, not patient or order identity proof',
      'specimen custody events are append-only',
      'result observations are immutable within one exact version',
      'correction creates a replacement version',
      'entered-in-error and retraction never delete prior evidence',
      'signed content hash must equal the exact version content hash',
      'verification and validation require explicit practitioners',
      'analyzer evidence stores hashes and exact source identities',
      'MAX(version) + 1 is not an acceptable concurrency contract',
      'numeric laboratory values use canonical decimal TEXT',
    ]) expect(spec).toContain(text);
  });

  it('defines thirteen atomic commands, ten persistent partitions, and fixed twenty-eight checks', () => {
    const plan = read(planPath);
    for (const command of [
      'registerCanonicalLabSpecimen',
      'collectCanonicalLabSpecimen',
      'receiveCanonicalLabSpecimen',
      'rejectCanonicalLabSpecimen',
      'createCanonicalLabSpecimenAliquot',
      'createCanonicalLabResultDraft',
      'replaceCanonicalLabResultDraft',
      'verifyCanonicalLabResultVersion',
      'validateAndPublishCanonicalLabResultVersion',
      'correctCanonicalLabResultVersion',
      'retractCanonicalLabResultVersion',
      'enterCanonicalLabResultInError',
      'attachCanonicalLabAnalyzerEvidence',
    ]) expect(plan).toContain(command);
    expect(plan).toContain('Ten persistent bounded/resumable backfill partitions');
    expect(plan).toContain('Fixed twenty-eight-check reconciliation');
  });

  it('audits the competing writers, mutable caches, LIS safety inbox, and reader surface without treating them as Canonical', () => {
    const audit = read(auditPath);
    for (const text of [
      'lab_order_items',
      'lab_specimens',
      'lab_specimen_events',
      'lab_reports',
      'lab_results',
      'lab_observation_audit',
      'lab_result_corrections',
      'lis_ingestion_messages',
      'lis_analyzer_inbox',
      'lis_result_retraction_requests',
      'src/routes/tenant/lab.ts',
      'src/routes/tenant/lab-results.ts',
      'src/routes/tenant/labWorkflow.ts',
      'src/services/lis-result-acceptance.ts',
      'src/services/lis-result-retraction.ts',
      'src/routes/tenant/reportLab.ts',
      'src/routes/tenant/patients-timeline.ts',
      'src/lib/health-summary.ts',
    ]) expect(audit).toContain(text);
    expect(audit).toContain('legacy compatibility source');
    expect(audit).toContain('not Canonical authority');
  });

  it('preserves CDB-125A design evidence while later schema and command checkpoints advance', () => {
    const matrix = read(matrixPath);
    const tracker = read(trackerPath);
    const control = read(controlPath);
    expect(matrix).toContain('lab_result_specimen');
    expect(matrix).toContain('canonical_lab_specimens');
    expect(matrix).toContain('canonical_lab_result_versions');
    expect(matrix).toContain('partial_canonical');
    expect(read(receiptPath)).toContain(auditPath);
    expect(read(receiptPath)).toContain(specPath);
    expect(read(receiptPath)).toContain(planPath);
    expect(tracker).toContain('CDB-125A-LAB-RESULT-SPECIMEN-AUTHORITY-DESIGN-VERIFIED');
    expect(tracker).toMatch(/CDB-125[BC]-CANONICAL-LAB-RESULT-SPECIMEN/);
    expect(control).toContain('CDB-125A-LAB-RESULT-SPECIMEN-AUTHORITY-DESIGN-VERIFIED');
    expect(control).toMatch(/CDB-125[BC]-CANONICAL-LAB-RESULT-SPECIMEN/);
  });
});
