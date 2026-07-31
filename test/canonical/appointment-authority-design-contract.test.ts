import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  audit: 'docs/database/audits/2026-07-26-appointment-authority-audit.md',
  plan: 'docs/superpowers/plans/2026-07-26-cdb-113d-appointment-authority.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('CDB-113D appointment authority design contract', () => {
  it('keeps substantial audit and serial execution documents', () => {
    expect(fs.existsSync(path.join(root, files.audit))).toBe(true);
    expect(fs.existsSync(path.join(root, files.plan))).toBe(true);
    if (!fs.existsSync(path.join(root, files.audit)) || !fs.existsSync(path.join(root, files.plan))) return;
    expect(read(files.audit).length).toBeGreaterThan(12_000);
    expect(read(files.plan).length).toBeGreaterThan(14_000);
  });

  it('records exact appointment, consultation, and schedule access evidence', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`appointments`: 8 writers and 30 readers',
      '`consultations`: 3 writers and 8 readers',
      '`doctor_schedules`: 3 writers and 8 readers',
      '24 literal SQL or Drizzle appointment mutation references',
      '`src/routes/tenant/appointments.ts`',
      '`src/routes/marketplace-patient.ts`',
      '`src/routes/tenant/doctors.ts`',
      '`src/routes/tenant/queue.ts`',
    ]) expect(combined).toContain(text);
  });

  it('separates planned appointment intent from encounter, billing, and channel projections', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'Appointment is planned intent.',
      'Encounter is actual care.',
      'Billing status is not canonical appointment authority.',
      'quoted fee is a planning snapshot',
      '`marketplace_bookings` is channel/workflow projection',
      '`doctor_schedules` is a schedule-availability extension',
      'time proximity',
      'Patient demographics are not copied',
    ]) expect(combined).toContain(text);
  });

  it('defines three additive canonical tables and immutable lifecycle rules', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`canonical_appointments`',
      '`canonical_appointment_status_events`',
      '`canonical_appointment_encounter_links`',
      '`migrations/0546_canonical_appointment_authority.sql`',
      '`patient_link_public_id`',
      '`requested_practitioner_public_id`',
      '`status_version`',
      '`rescheduled_from_appointment_public_id`',
      '`quoted_amount_minor`',
      '`fulfilled_by`',
      'one active appointment fulfilment link',
      'Reschedule closes the old appointment',
    ]) expect(combined).toContain(text);
  });

  it('defines idempotent commands, atomic compatibility, provider modes, and safe outbox evidence', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'create appointment intent',
      'Lifecycle transition command',
      'Reschedule command',
      'Fulfil/link command',
      'authoritativeStatements',
      'exact idempotency replay',
      'expected version',
      'PHI-minimised outbox',
      'legacy mode',
      'shadow mode',
      'canonical mode',
      '`canonical_appointment_provider_v1`',
      'feature flag remains disabled',
    ]) expect(combined).toContain(text);
  });

  it('requires resumable backfill, persistent reconciliation, and fail-closed safety', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'bounded, resumable, deterministic, and second-pass safe',
      'appointment mapping cardinality',
      'patient-link reference validity',
      'header/latest-event parity',
      'reschedule lineage validity',
      'active token uniqueness',
      'patient identity agreement',
      'cross-tenant references',
      'second pass creates zero new business rows',
      'Production mutation is not authorised.',
      'Local-sync expansion remains paused.',
      'Destructive legacy retirement is not authorised.',
      'CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE',
    ]) expect(combined).toContain(text);
  });
});
