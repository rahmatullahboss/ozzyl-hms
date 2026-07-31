import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const receiptPath =
  'docs/database/migration-runs/production/CDB-113H2-protected-clone-backfill-reconciliation.md';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';
const handoffPath = '.ai-bridge/current-plan.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CDB-113H2 protected clone backfill reconciliation continuity', () => {
  it('records exact H2 clone evidence without claiming production execution', () => {
    expect(existsSync(receiptPath)).toBe(true);
    const receipt = read(receiptPath);
    for (const text of [
      'CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-VERIFIED',
      'tenant-100 protected local clone-only backfill and reconciliation',
      'canonical tenant patient links: **325**',
      'canonical practitioners: **30**',
      'canonical appointments: **141**',
      'exact appointment–encounter links: **19**',
      'canonical encounters preserved: **234**',
      'exact canonical admissions created: **26**',
      'care locations: **8**',
      'beds: **31**',
      'canonical bed stays preserved: **28**',
      'operationally valid active/completed stays: **16**',
      'invalid historical stays preserved with exact issue dispositions: **12**',
      '23-check encounter/admission/bed reconciliation: **23/23 passed**',
      'All **61** open convergence issues were validated',
      'admission dispositions: 26 mapped / 39 ambiguous',
      'bed-stay dispositions: 16 mapped / 16 ambiguous',
      'production migration ledger remained **487**',
      'rows written: **0**',
      'production mutation performed: **no**',
      'CDB-113H2A-MAIN-SYNC-AND-H2-EVIDENCE-REVALIDATION',
      'CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-REQUIRED',
    ]) expect(receipt).toContain(text);
    expect(receipt).not.toContain('.hms-canonical-rehearsals');
    expect(receipt).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  });

  it('keeps tracker, control center, and handoff aligned with the local revalidation gate', () => {
    const combined = [trackerPath, controlPath, handoffPath].map(read).join('\n');
    for (const text of [
      'CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-VERIFIED',
      'CDB-113H2A-MAIN-SYNC-AND-H2-EVIDENCE-REVALIDATION',
      receiptPath,
      'h2_authorization_revision: 8',
      'h2_patient_links: 325',
      'h2_practitioners: 30',
      'h2_appointments: 141',
      'h2_appointment_encounter_links: 19',
      'h2_encounters: 234',
      'h2_admissions_mapped: 26',
      'h2_admissions_ambiguous: 39',
      'h2_care_locations: 8',
      'h2_beds: 31',
      'h2_bed_stays_preserved: 28',
      'h2_bed_stays_mapped: 16',
      'h2_bed_stays_ambiguous: 16',
      'h2_invalid_historical_bed_stays: 12',
      'h2_stable_issue_count: 61',
      'h2_reconciliation_runs_passed: 7',
      'h2_foreign_key_violations: 0',
      'h2_source_tables_unchanged: true',
      'production_migration_ledger_after_h2: 487',
      'production_rows_written: 0',
      'production_mutation_performed: false',
    ]) expect(combined).toContain(text);
  });
});
