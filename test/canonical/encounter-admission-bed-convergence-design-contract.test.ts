import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  audit: 'docs/database/audits/2026-07-26-encounter-admission-bed-convergence-audit.md',
  plan: 'docs/superpowers/plans/2026-07-26-cdb-113e-encounter-admission-bed-convergence.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('CDB-113E encounter, admission, and bed convergence design contract', () => {
  it('keeps substantial audit and serial execution documents', () => {
    expect(fs.existsSync(path.join(root, files.audit))).toBe(true);
    expect(fs.existsSync(path.join(root, files.plan))).toBe(true);
    if (!fs.existsSync(path.join(root, files.audit)) || !fs.existsSync(path.join(root, files.plan))) return;
    expect(read(files.audit).length).toBeGreaterThan(15_000);
    expect(read(files.plan).length).toBeGreaterThan(17_000);
  });

  it('records exact legacy and canonical access evidence', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`canonical_encounters`: 4 writers and 12 readers',
      '`canonical_encounter_participants`: 2 writers and 0 readers',
      '`canonical_encounter_admission_links`: 1 writer and 4 readers',
      '`canonical_bed_stays`: 2 writers and 2 readers',
      '`encounters`: 2 writers and 5 readers',
      '`visits`: 9 writers and 42 readers',
      '`consultations`: 3 writers and 11 readers',
      '`admissions`: 7 writers and 40 readers',
      '`beds`: 6 writers and 25 readers',
      '`patient_bed_infos`: 6 writers and 10 readers',
      '69 literal admission/bed/occupancy mutation references',
      '`src/routes/tenant/appointment-paid-context.ts`',
      '`src/routes/tenant/admissions.ts`',
      '`src/routes/tenant/ipBilling.ts`',
      '`src/routes/tenant/dischargePlanning.ts`',
      '`src/routes/tenant/deathRecords.ts`',
    ]) expect(combined).toContain(text);
  });

  it('separates actual care, admission lifecycle, resource identity, occupancy, and finance', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'Encounter is actual care.',
      'Admission is an inpatient extension linked to one encounter.',
      'Bed is resource identity.',
      'Bed stay is interval-based occupancy truth.',
      'Clinical discharge is not financial settlement.',
      'Bed price is not bed identity or occupancy truth.',
      'Billing fields are not canonical admission lifecycle authority.',
      'Patient demographics are not copied',
      'time proximity',
      'room labels',
      'numeric-ID coincidence',
    ]) expect(combined).toContain(text);
  });

  it('defines additive encounter hardening, admission events, location, bed, and stay authority', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`migrations/0548_canonical_encounter_admission_bed_convergence.sql`',
      '`canonical_encounters`',
      '`patient_link_public_id`',
      '`encounter_version`',
      '`canonical_admissions`',
      '`canonical_admission_status_events`',
      '`canonical_care_locations`',
      '`canonical_beds`',
      '`canonical_bed_stays`',
      '`admission_public_id`',
      '`location_public_id`',
      '`bed_public_id`',
      'one active admission per inpatient encounter',
      'one open bed stay per bed',
      'one open bed stay per active admission',
      'no overlap for the same bed',
      'no overlap for the same admission',
    ]) expect(combined).toContain(text);
  });

  it('defines atomic commands, provider modes, concurrency, and PHI-safe evidence', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`admit-patient-and-claim-bed`',
      '`transfer-bed`',
      '`discharge-or-cancel-admission`',
      '`manage-care-location-and-bed`',
      'exact idempotency replay',
      'expected version',
      'authoritativeStatements',
      'double admission',
      'double bed claim',
      'concurrent transfer',
      'repeated discharge',
      'PHI-minimised outbox',
      '`canonical_encounter_provider_v1`',
      '`canonical_admission_bed_provider_v1`',
      'legacy mode',
      'shadow mode',
      'canonical mode',
      'feature flags remain disabled',
    ]) expect(combined).toContain(text);
  });

  it('requires resumable backfill, persistent reconciliation, and fail-closed safety', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'bounded, resumable, deterministic, and second-pass safe',
      'encounter patient-link validity',
      'admission mapping cardinality',
      'admission header/latest-event parity',
      'encounter/admission patient agreement',
      'bed resource mapping validity',
      'open-stay cardinality',
      'interval overlap',
      'legacy bed status versus derived occupancy',
      'cross-tenant references',
      'second pass creates zero new business rows',
      'Production mutation is not authorised.',
      'Local-sync expansion remains paused.',
      'Destructive legacy retirement is not authorised.',
      'CDB-113F-IDENTITY-EPISODE-READ-PROMOTION',
    ]) expect(combined).toContain(text);
  });
});
