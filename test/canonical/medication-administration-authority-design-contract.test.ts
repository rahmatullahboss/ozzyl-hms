import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const auditPath = 'docs/database/audits/2026-07-28-medication-administration-reconciliation-authority-audit.md';
const specPath = 'docs/superpowers/specs/2026-07-28-cdb-124a-medication-administration-authority-design.md';
const planPath = 'docs/superpowers/plans/2026-07-28-cdb-124-medication-administration-authority.md';
const receiptPath = 'docs/database/migration-runs/P12-canonical-medication-administration-authority-design.md';
const matrixPath = 'docs/database/canonical-authority-matrix.yaml';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function lower(path: string): string {
  return read(path).toLowerCase();
}

describe('CDB-124A medication administration and reconciliation authority design', () => {
  it('preserves the design evidence and recognises the completed local implementation checkpoints', () => {
    for (const path of [auditPath, specPath, planPath, receiptPath]) expect(existsSync(path)).toBe(true);
    for (const path of [
      'migrations/0557_canonical_medication_administration.sql',
      'src/db/schema/canonical/medication-administration.ts',
      'src/lib/canonical/commands/manage-medication-administration.ts',
      'scripts/canonical/backfill-medication-administration.ts',
      'scripts/canonical/reconcile-medication-administration.ts',
      'docs/database/migration-runs/P12-canonical-medication-administration-backfill-reconciliation.md',
    ]) expect(existsSync(path)).toBe(true);
  });

  it('audits the mixed MAR schedule/fact model, mutable administration history, and separate reconciliation workflow', () => {
    const audit = lower(auditPath);
    for (const table of [
      'nur_medication_admin',
      'cln_medication_orders',
      'cln_medication_reconciliation',
      'cln_medication_reconciliation_items',
      'canonical_medication_orders',
    ]) expect(audit).toContain(table);
    for (const route of [
      'src/routes/tenant/nursing/mar.ts',
      'src/routes/tenant/nursing/medication-orders.ts',
      'src/routes/tenant/nursing/medication-reconciliation.ts',
      'src/routes/tenant/nursing/medication-due.ts',
    ]) expect(audit).toContain(route);
    for (const risk of [
      'future schedule and actual administration are stored in the same row',
      'in-place administration update',
      'soft delete can hide medication administration evidence',
      'medication text is not medication-order identity',
      'reconciliation is a separate signed workflow authority',
      'discharge checklist update is non-atomic',
    ]) expect(audit).toContain(risk);
  });

  it('locks immutable administration events and versioned reconciliation as separate authorities', () => {
    const spec = lower(specPath);
    for (const table of [
      'canonical_medication_administration_events',
      'canonical_medication_reconciliations',
      'canonical_medication_reconciliation_versions',
      'canonical_medication_reconciliation_items',
      'canonical_medication_reconciliation_status_events',
    ]) expect(spec).toContain(table);
    for (const principle of [
      'scheduled dose opportunities are workflow projections, not administration facts',
      'one administration event records one actual administration or non-administration outcome',
      'administration events are append-only',
      'correction creates a replacement event',
      'entered-in-error creates immutable error evidence',
      'medication reconciliation never becomes administration evidence',
      'completion does not silently create medication orders or prescriptions',
      'hard delete is forbidden',
    ]) expect(spec).toContain(principle);
  });

  it('requires exact medication-order, patient, encounter, actor, time, dose, route, and outcome evidence', () => {
    const spec = lower(specPath);
    for (const field of [
      'medication_order_public_id',
      'medication_order_status_version',
      'patient_link_public_id',
      'encounter_public_id',
      'administering_practitioner_public_id',
      'scheduled_at_utc',
      'occurred_at_utc',
      'recorded_at_utc',
      'administered_dose_value_decimal',
      'administered_dose_unit_code',
      'route_code',
      'site_code',
      'outcome_code',
      'reason_code',
      'supersedes_administration_event_public_id',
    ]) expect(spec).toContain(field);
    for (const outcome of ['given', 'partially_given', 'withheld', 'refused', 'omitted', 'not_available', 'cancelled']) {
      expect(spec).toContain(outcome);
    }
    expect(spec).toContain('medicine name, patient/time proximity, schedule similarity, and numeric coincidence are not identity proof');
    expect(spec).toContain('given and partially_given require exact administered dose and route');
    expect(spec).toContain('non-administration outcomes require a reason code');
  });

  it('defines serial schema, commands, bounded backfill, fixed reconciliation, disabled providers, and external gates', () => {
    const plan = lower(planPath);
    for (const checkpoint of ['cdb-124b', 'cdb-124c', 'cdb-124d', 'cdb-124e']) expect(plan).toContain(checkpoint);
    for (const command of [
      'recordcanonicalmedicationadministrationevent',
      'correctcanonicalmedicationadministrationevent',
      'entercanonicalmedicationadministrationinerror',
      'createcanonicalmedicationreconciliationdraft',
      'replacecanonicalmedicationreconciliationdraft',
      'finalizecanonicalmedicationreconciliation',
      'cancelcanonicalmedicationreconciliation',
    ]) expect(plan).toContain(command);
    expect(plan).toContain('eight persistent bounded-backfill partitions');
    expect(plan).toContain('fixed twenty-two-check reconciliation');
    expect(plan).toContain('canonical_medication_administration_provider_v1');
    expect(plan).toContain('enabledbydefault: false');
    expect(plan).toContain('defaultmode: legacy');
    expect(plan).toContain('rollbackmode: legacy');
    expect(plan).toContain('production activation remains an external gate');
    expect(plan).toContain('legacy retirement remains an external gate');
  });

  it('keeps historical design evidence while current metadata reaches CDB-124E with CDB-125A next', () => {
    const matrix = read(matrixPath);
    const tracker = read(trackerPath);
    const control = read(controlPath);
    expect(matrix).toContain('medication_administration');
    expect(matrix).toContain('"status": "local_ready"');
    expect(matrix).toContain('src/lib/canonical/medication-administration-provider.ts');
    expect(matrix).toContain('docs/database/medication-administration-readiness.json');
    expect(tracker).toContain('CDB-124A-MEDICATION-ADMINISTRATION-AUTHORITY-DESIGN-VERIFIED');
    expect(tracker).toContain('CDB-124E-CANONICAL-MEDICATION-ADMINISTRATION-PROVIDER-READINESS-VERIFIED');
    expect(tracker).toContain('CDB-125A-LAB-RESULT-SPECIMEN-AUTHORITY-DESIGN');
    expect(control).toContain('CDB-124E-CANONICAL-MEDICATION-ADMINISTRATION-PROVIDER-READINESS-VERIFIED');
    expect(control).toContain('CDB-125A-LAB-RESULT-SPECIMEN-AUTHORITY-DESIGN');
  });
});
