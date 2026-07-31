import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  design: 'docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md',
  plan: 'docs/superpowers/plans/2026-07-26-cdb-113a-identity-episode-foundation.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('CDB-113A identity and episode foundation design contract', () => {
  it('keeps substantial design and execution documents', () => {
    expect(fs.existsSync(path.join(root, files.design))).toBe(true);
    expect(fs.existsSync(path.join(root, files.plan))).toBe(true);
    expect(read(files.design).length).toBeGreaterThan(18_000);
    expect(read(files.plan).length).toBeGreaterThan(10_000);
  });

  it('preserves one authority and separates planned care from actual care', () => {
    const combined = `${read(files.design)}\n${read(files.plan)}`;
    for (const text of [
      'Appointment is planned intent; encounter is actual care.',
      'canonical_tenant_patient_links',
      'canonical_tenant_patient_link_events',
      'canonical_appointments',
      'canonical_appointment_status_events',
      'canonical_appointment_encounter_links',
      'canonical_admissions',
      'canonical_admission_status_events',
      'canonical_care_locations',
      'canonical_beds',
      'canonical_bed_stays',
      'global_patient_identity remains an external governed authority',
      'patients remains the tenant operational patient record during migration',
      'do not create another patient demographics authority',
    ]) expect(combined).toContain(text);
  });

  it('requires exact identity evidence and forbids proximity or name-only merges', () => {
    const combined = `${read(files.design)}\n${read(files.plan)}`;
    for (const text of [
      'Name-only practitioner matching is prohibited.',
      'Phone-only patient matching is prohibited.',
      'Time proximity alone never merges an appointment, consultation, visit, encounter, or admission.',
      'Ambiguous historical evidence creates a stable canonical processing issue.',
      'National identity evidence must be verified, unique, and tenant-safe before automatic linking.',
    ]) expect(combined).toContain(text);
  });

  it('defines atomic commands, provider cutover, reconciliation, and rollback', () => {
    const combined = `${read(files.design)}\n${read(files.plan)}`;
    for (const text of [
      'register-or-link-patient',
      'create-or-reschedule-appointment',
      'check-in-and-start-encounter',
      'admit-patient-and-claim-bed',
      'transfer-bed',
      'discharge-or-cancel-admission',
      'one open bed stay per bed',
      'one active admission per inpatient encounter',
      'source mapping',
      'idempotency',
      'outbox',
      'shadow comparison',
      'rollback',
      'zero unexplained variance',
    ]) expect(combined).toContain(text);
  });

  it('keeps the next implementation serial, additive, and locally safe', () => {
    const combined = `${read(files.design)}\n${read(files.plan)}`;
    for (const text of [
      'CDB-113B-PATIENT-LINK-FOUNDATION',
      'CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION',
      'CDB-113D-APPOINTMENT-AUTHORITY',
      'CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE',
      'CDB-113F-IDENTITY-EPISODE-READ-PROMOTION',
      'additive migrations only',
      'Production mutation is not authorised.',
      'Local-sync expansion remains paused.',
      'Destructive legacy retirement is not authorised.',
    ]) expect(combined).toContain(text);
  });
});
