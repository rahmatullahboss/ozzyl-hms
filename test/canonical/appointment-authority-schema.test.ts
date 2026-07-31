import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0546_canonical_appointment_authority.sql';
const schemaPath = 'src/db/schema/canonical/appointments.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';
const sourceRegistryPath = 'docs/database/canonical-source-of-truth.yaml';
const zeroHash = '0'.repeat(64);

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    migrationPath,
  ]) db.exec(readFileSync(migration, 'utf8'));
  return db;
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table) as
    | { sql?: string }
    | undefined;
  return String(row?.sql ?? '').replace(/\s+/g, ' ');
}

function uniqueIndexColumns(db: DatabaseSync, table: string): Array<{ columns: string[]; partial: number }> {
  return (db.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as Array<{
    name: string;
    unique: number;
    partial: number;
  }>)
    .filter((entry) => Number(entry.unique) === 1)
    .map((entry) => ({
      partial: Number(entry.partial),
      columns: (db.prepare(`PRAGMA index_info(${JSON.stringify(entry.name)})`).all() as Array<{
        name: string;
        seqno: number;
      }>)
        .sort((a, b) => Number(a.seqno) - Number(b.seqno))
        .map((column) => String(column.name)),
    }));
}

function seedDependencies(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?, ?,1)
  `).run('a'.repeat(64), '2026-07-26T00:00:00.000Z');
  db.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal','Doctor','active',1,?)
  `).run('b'.repeat(64));
  db.prepare(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','service-consult-101','consultation','Consultation','visit','active',?)
  `).run('c'.repeat(64));
  db.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-101',101,'outpatient','in_progress',?,?)
  `).run('2026-07-26T09:00:00.000Z', 'd'.repeat(64));
}

function insertAppointment(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const input = {
    tenantId: 'tenant-a',
    appointmentPublicId: 'appointment-101',
    patientLinkPublicId: 'ptl-101',
    requestedPractitionerPublicId: 'practitioner-101',
    requestedServiceItemPublicId: 'service-consult-101',
    requestedLocationPublicId: null,
    appointmentKind: 'new_patient',
    modality: 'in_person',
    schedulingChannel: 'reception',
    requestedStartUtc: '2026-07-26T09:00:00.000Z',
    requestedEndUtc: '2026-07-26T09:30:00.000Z',
    businessDate: '2026-07-26',
    timezone: 'Asia/Dhaka',
    tokenNumber: 1,
    tokenAssignmentType: 'auto',
    currentStatus: 'scheduled',
    statusVersion: 1,
    rescheduledFromAppointmentPublicId: null,
    requestNote: 'Access controlled request note',
    referralPractitionerPublicId: null,
    quotedAmountMinor: 100000,
    currencyCode: 'BDT',
    quoteSource: 'doctor_fee_schedule',
    quoteEffectiveAtUtc: '2026-07-26T08:00:00.000Z',
    sourceEvidenceSha256: zeroHash,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_appointments (
      tenant_id,appointment_public_id,patient_link_public_id,
      requested_practitioner_public_id,requested_service_item_public_id,
      requested_location_public_id,appointment_kind,modality,scheduling_channel,
      requested_start_utc,requested_end_utc,business_date,timezone,token_number,
      token_assignment_type,current_status,status_version,
      rescheduled_from_appointment_public_id,request_note,referral_practitioner_public_id,
      quoted_amount_minor,currency_code,quote_source,quote_effective_at_utc,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.tenantId,
    input.appointmentPublicId,
    input.patientLinkPublicId,
    input.requestedPractitionerPublicId,
    input.requestedServiceItemPublicId,
    input.requestedLocationPublicId,
    input.appointmentKind,
    input.modality,
    input.schedulingChannel,
    input.requestedStartUtc,
    input.requestedEndUtc,
    input.businessDate,
    input.timezone,
    input.tokenNumber,
    input.tokenAssignmentType,
    input.currentStatus,
    input.statusVersion,
    input.rescheduledFromAppointmentPublicId,
    input.requestNote,
    input.referralPractitionerPublicId,
    input.quotedAmountMinor,
    input.currencyCode,
    input.quoteSource,
    input.quoteEffectiveAtUtc,
    input.sourceEvidenceSha256,
  );
}

describe('canonical appointment authority schema', () => {
  it('reserves the additive migration, Drizzle module, barrel export, and source registry', () => {
    for (const file of [migrationPath, schemaPath, barrelPath, sourceRegistryPath]) {
      expect(existsSync(file)).toBe(true);
    }
    if (!existsSync(schemaPath) || !existsSync(barrelPath) || !existsSync(sourceRegistryPath)) return;
    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    const registry = readFileSync(sourceRegistryPath, 'utf8');
    expect(schema).toContain("'canonical_appointments'");
    expect(schema).toContain("'canonical_appointment_status_events'");
    expect(schema).toContain("'canonical_appointment_encounter_links'");
    expect(barrel).toContain("export * from './appointments';");
    for (const table of [
      'canonical_appointments',
      'canonical_appointment_status_events',
      'canonical_appointment_encounter_links',
    ]) expect(registry).toContain(`"name": "${table}"`);
  });

  it('creates exactly three additive appointment authority tables without copying foreign authorities', () => {
    const db = createDatabase();
    try {
      const tables = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name LIKE 'canonical_appointment%'
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(tables).toEqual([
        'canonical_appointment_encounter_links',
        'canonical_appointment_status_events',
        'canonical_appointments',
      ]);
      const forbidden = new Set([
        'patient_name', 'phone', 'mobile', 'email', 'doctor_name', 'password', 'password_hash',
        'billing_status', 'paid', 'due', 'discount_amount', 'discount_by_name', 'invoice_id',
        'payment_id', 'queue_status', 'visit_status', 'room_url', 'prescription', 'revenue',
      ]);
      for (const table of tables) {
        const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{
          name: string;
          type: string;
        }>;
        expect(columns.some((column) => forbidden.has(column.name))).toBe(false);
        expect(columns.some((column) => column.type.toUpperCase() === 'REAL')).toBe(false);
      }
    } finally {
      db.close();
    }
  });

  it('enforces appointment identities, vocabularies, interval, token, quote, and evidence constraints', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertAppointment(db);
      const sql = tableSql(db, 'canonical_appointments');
      for (const status of [
        'requested', 'scheduled', 'confirmed', 'arrived', 'checked_in',
        'fulfilled', 'cancelled', 'no_show', 'rescheduled', 'entered_in_error',
      ]) expect(sql).toContain(`'${status}'`);
      expect(sql).toContain('status_version > 0');
      expect(sql).toContain('requested_end_utc >= requested_start_utc');
      expect(sql).toContain('quoted_amount_minor >= 0');
      expect(sql).toContain('length(source_evidence_sha256) = 64');

      expect(() => insertAppointment(db, {
        appointmentPublicId: 'appointment-bad-interval',
        tokenNumber: 2,
        requestedEndUtc: '2026-07-26T08:59:59.000Z',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAppointment(db, {
        appointmentPublicId: 'appointment-bad-hash',
        tokenNumber: 2,
        sourceEvidenceSha256: 'A'.repeat(64),
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAppointment(db, {
        appointmentPublicId: 'appointment-bad-quote',
        tokenNumber: 2,
        currencyCode: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAppointment(db, {
        appointmentPublicId: 'appointment-bad-patient',
        patientLinkPublicId: 'missing-patient-link',
        tokenNumber: 2,
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertAppointment(db, {
        appointmentPublicId: 'appointment-bad-token',
        tokenNumber: null,
        tokenAssignmentType: 'auto',
      })).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces immutable status event identity, sequence, actor, and tenant-scoped appointment reference', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertAppointment(db);
      const insert = db.prepare(`
        INSERT INTO canonical_appointment_status_events (
          tenant_id,event_public_id,appointment_public_id,event_type,from_status,to_status,
          sequence,reason_code,safe_note,actor_user_public_id,actor_system_key,
          idempotency_key,source_evidence_sha256,occurred_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      insert.run(
        'tenant-a', 'appointment-event-101', 'appointment-101', 'scheduled', 'requested', 'scheduled',
        1, 'legacy_scheduled', null, null, 'canonical.appointment.test',
        'appointment-event-idem-101', 'e'.repeat(64), '2026-07-26T08:00:00.000Z',
      );
      expect(() => insert.run(
        'tenant-a', 'appointment-event-duplicate-sequence', 'appointment-101', 'confirmed', 'scheduled', 'confirmed',
        1, 'confirmed', null, null, 'canonical.appointment.test',
        'appointment-event-idem-102', 'f'.repeat(64), '2026-07-26T08:10:00.000Z',
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => insert.run(
        'tenant-a', 'appointment-event-no-actor', 'appointment-101', 'confirmed', 'scheduled', 'confirmed',
        2, 'confirmed', null, null, null,
        'appointment-event-idem-103', 'f'.repeat(64), '2026-07-26T08:10:00.000Z',
      )).toThrow(/CHECK constraint failed/);
      expect(() => insert.run(
        'tenant-b', 'appointment-event-cross-tenant', 'appointment-101', 'confirmed', 'scheduled', 'confirmed',
        2, 'confirmed', null, null, 'canonical.appointment.test',
        'appointment-event-idem-104', 'f'.repeat(64), '2026-07-26T08:10:00.000Z',
      )).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces reschedule lineage and one active appointment/encounter linkage in each direction', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertAppointment(db);
      insertAppointment(db, {
        appointmentPublicId: 'appointment-102',
        tokenNumber: 2,
        rescheduledFromAppointmentPublicId: 'appointment-101',
      });
      expect(() => db.prepare(`
        UPDATE canonical_appointments
        SET rescheduled_from_appointment_public_id='appointment-101'
        WHERE tenant_id='tenant-a' AND appointment_public_id='appointment-101'
      `).run()).toThrow(/CHECK constraint failed/);

      const link = db.prepare(`
        INSERT INTO canonical_appointment_encounter_links (
          tenant_id,link_public_id,appointment_public_id,encounter_public_id,
          link_type,link_status,source_evidence_sha256,created_at_utc,retired_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `);
      link.run(
        'tenant-a', 'appointment-encounter-link-101', 'appointment-101', 'encounter-101',
        'fulfilled_by', 'active', 'f'.repeat(64), '2026-07-26T09:00:00.000Z', null,
      );
      expect(() => link.run(
        'tenant-a', 'appointment-encounter-link-102', 'appointment-101', 'encounter-101',
        'approved_manual', 'active', 'f'.repeat(64), '2026-07-26T09:01:00.000Z', null,
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => link.run(
        'tenant-a', 'appointment-encounter-link-103', 'appointment-102', 'encounter-101',
        'approved_manual', 'active', 'f'.repeat(64), '2026-07-26T09:02:00.000Z', null,
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => link.run(
        'tenant-a', 'appointment-encounter-link-retired-without-time', 'appointment-102', 'encounter-101',
        'approved_manual', 'retired', 'f'.repeat(64), '2026-07-26T09:03:00.000Z', null,
      )).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('creates reviewed unique indexes for public IDs, event replay, sequence, token, and active links', () => {
    const db = createDatabase();
    try {
      expect(uniqueIndexColumns(db, 'canonical_appointments')).toContainEqual({
        columns: ['tenant_id', 'appointment_public_id'], partial: 0,
      });
      expect(uniqueIndexColumns(db, 'canonical_appointments')).toContainEqual({
        columns: ['tenant_id', 'requested_practitioner_public_id', 'business_date', 'token_number'], partial: 1,
      });
      expect(uniqueIndexColumns(db, 'canonical_appointment_status_events')).toContainEqual({
        columns: ['tenant_id', 'appointment_public_id', 'sequence'], partial: 0,
      });
      expect(uniqueIndexColumns(db, 'canonical_appointment_status_events')).toContainEqual({
        columns: ['tenant_id', 'idempotency_key'], partial: 0,
      });
      expect(uniqueIndexColumns(db, 'canonical_appointment_encounter_links')).toContainEqual({
        columns: ['tenant_id', 'appointment_public_id'], partial: 1,
      });
      expect(uniqueIndexColumns(db, 'canonical_appointment_encounter_links')).toContainEqual({
        columns: ['tenant_id', 'encounter_public_id'], partial: 1,
      });
    } finally {
      db.close();
    }
  });
});
