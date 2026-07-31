import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const auditPath = 'docs/database/audits/2026-07-28-patient-vital-measurement-authority-audit.md';
const specPath = 'docs/superpowers/specs/2026-07-28-cdb-123a-patient-vital-measurement-authority-design.md';
const planPath = 'docs/superpowers/plans/2026-07-28-cdb-123-patient-vital-measurement-authority.md';
const matrixPath = 'docs/database/canonical-authority-matrix.yaml';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function lower(path: string): string {
  return read(path).toLowerCase();
}

describe('CDB-123 patient vital measurement authority design continuity', () => {
  it('preserves the design artifacts and the serial A-E implementation layering', () => {
    for (const path of [
      auditPath,
      specPath,
      planPath,
      'migrations/0556_canonical_patient_vital_measurement.sql',
      'src/db/schema/canonical/vital-observations.ts',
      'src/lib/canonical/commands/manage-vital-observations.ts',
      'scripts/canonical/backfill-patient-vital-measurement.ts',
      'scripts/canonical/reconcile-patient-vital-measurement.ts',
      'src/lib/canonical/patient-vital-measurement-provider.ts',
      'src/lib/canonical/patient-vital-measurement-read-adapters.ts',
    ]) expect(existsSync(path)).toBe(true);
  });

  it('enumerates every competing authority and the global schema contract conflict', () => {
    const audit = lower(auditPath);
    for (const table of [
      'patient_vitals', 'clinical_vitals', 'global_patient_vitals', 'nur_patient_monitoring',
      'vital_alert_rules', 'vital_alerts',
    ]) expect(audit).toContain(table);
    for (const route of [
      'src/routes/tenant/vitals.ts',
      'src/routes/tenant/clinical/vitals.ts',
      'src/routes/tenant/nursing/monitoring.ts',
      'src/routes/patient-phr.ts',
      'src/routes/wellness.ts',
    ]) expect(audit).toContain(route);
    expect(audit).toContain('uhid, logged_on');
    expect(audit).toContain('patient_id, logged_at');
    expect(audit).toContain('incompatible runtime column contracts');
    expect(audit).toContain('hard delete');
    expect(audit).toContain('mutable signed clinical fact');
  });

  it('locks one observation authority with typed components and immutable correction history', () => {
    const spec = lower(specPath);
    for (const table of [
      'canonical_vital_observation_sets',
      'canonical_vital_observation_components',
      'canonical_vital_observation_status_events',
    ]) expect(spec).toContain(table);
    for (const principle of [
      'one observation set groups measurements captured in one act',
      'one component stores one coded measurement and one canonical unit',
      'corrections append a replacement set and immutable status event',
      'hard delete is forbidden',
      'alerts are projections, not vital authority',
      'nursing monitoring is a consumer and compatibility adapter',
      'bmi is derived evidence and never an independently authoritative manual fact',
      'temperature storage unit is cel',
      'blood pressure requires paired systolic and diastolic components',
      'effective_at_utc',
      'recorded_at_utc',
      'patient_link_public_id',
      'encounter_public_id',
      'practitioner_public_id',
      'external_device_source_type',
      'external_device_source_public_id',
    ]) expect(spec).toContain(principle);
  });

  it('defines exact measurement codes, units, source identity, duplicate policy, and review semantics', () => {
    const spec = lower(specPath);
    for (const code of [
      'body_temperature', 'heart_rate', 'respiratory_rate', 'oxygen_saturation',
      'blood_pressure_systolic', 'blood_pressure_diastolic', 'body_weight',
      'body_height', 'body_mass_index', 'pain_score', 'blood_glucose',
    ]) expect(spec).toContain(code);
    for (const unit of ['cel', '/min', '%', 'mm[hg]', 'kg', 'cm', 'kg/m2', '{score}', 'mg/dl']) {
      expect(spec).toContain(unit);
    }
    expect(spec).toContain('source mapping is the only cross-table identity proof');
    expect(spec).toContain('same patient, same timestamp, and same values are not sufficient to merge');
    expect(spec).toContain('patient-reported observations start pending_review');
    for (const status of ['verified', 'rejected', 'entered_in_error']) expect(spec).toContain(status);
  });

  it('defines schema, commands, nine-partition backfill, fixed reconciliation, disabled providers, and gates', () => {
    const plan = lower(planPath);
    for (const checkpoint of ['cdb-123b', 'cdb-123c', 'cdb-123d', 'cdb-123e']) expect(plan).toContain(checkpoint);
    for (const command of [
      'recordcanonicalvitalobservationset',
      'reviewcanonicalvitalobservationset',
      'correctcanonicalvitalobservationset',
      'entercanonicalvitalobservationsetinerror',
    ]) expect(plan).toContain(command);
    expect(plan).toContain('nine persistent bounded-backfill partitions');
    expect(plan).toContain('fixed twenty-check reconciliation');
    expect(plan).toContain('canonical_patient_vital_measurement_provider_v1');
    expect(plan).toContain('enabledbydefault: false');
    expect(plan).toContain('defaultmode: legacy');
    expect(plan).toContain('rollbackmode: legacy');
    expect(plan).toContain('production activation remains an external gate');
    expect(plan).toContain('legacy retirement remains an external gate');
  });

  it('keeps matrix, tracker, and control center aligned to the advanced CDB-123 state', () => {
    const matrix = read(matrixPath);
    const tracker = read(trackerPath);
    const control = read(controlPath);
    expect(matrix).toContain('patient_vital_measurement');
    for (const table of [
      'canonical_vital_observation_sets',
      'canonical_vital_observation_components',
      'canonical_vital_observation_status_events',
    ]) expect(matrix).toContain(table);
    expect(tracker).toContain('CDB-123A-PATIENT-VITAL-MEASUREMENT-AUTHORITY-DESIGN-VERIFIED');
    expect(tracker).toMatch(/CDB-123[BCDE]-CANONICAL-PATIENT-VITAL-MEASUREMENT/);
    expect(control).toMatch(/CDB-123[BCDE]-CANONICAL-PATIENT-VITAL-MEASUREMENT/);
  });
});
