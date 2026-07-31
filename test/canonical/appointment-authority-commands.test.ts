import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  createAppointmentIntent,
  fulfilAppointment,
  rescheduleAppointment,
  retireAppointmentEncounterLink,
  transitionAppointmentStatus,
  type CreateAppointmentIntentInput,
} from '../../src/lib/canonical/commands/manage-appointment';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0546_canonical_appointment_authority.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_appointment_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    )
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  seedDependencies(sqlite);
  return { sqlite, db };
}

function seedDependencies(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-26T00:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES
      ('tenant-a','practitioner-101','internal','Doctor Example','active',1,?),
      ('tenant-a','practitioner-102','internal','Doctor Reassigned','active',1,?)
  `).run('2'.repeat(64), '5'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','service-consult-101','consultation','Consultation','visit','active',?)
  `).run('3'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-101',101,'outpatient','in_progress',?,?)
  `).run('2026-07-26T09:05:00.000Z', '4'.repeat(64));
}

function createInput(overrides: Partial<CreateAppointmentIntentInput> = {}): CreateAppointmentIntentInput {
  return {
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
    initialStatus: 'scheduled',
    requestNote: 'Sensitive complaint text',
    referralPractitionerPublicId: null,
    quote: {
      amountMinor: 100000,
      currencyCode: 'BDT',
      source: 'doctor_fee_schedule',
      effectiveAtUtc: '2026-07-26T08:00:00.000Z',
    },
    sourceType: 'legacy_appointment',
    sourcePublicId: '9001',
    sourceTable: 'appointments',
    sourceEvidenceSha256: 'a'.repeat(64),
    actorSystemKey: 'canonical.appointment.test',
    idempotencyKey: 'appointment-create-101',
    eventPublicId: 'appointment-outbox-create-101',
    occurredAtUtc: '2026-07-26T08:00:00.000Z',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function createCheckedInAppointment(db: CanonicalBatchDatabase): Promise<void> {
  await createAppointmentIntent(db, createInput());
  await transitionAppointmentStatus(db, {
    tenantId: 'tenant-a',
    appointmentPublicId: 'appointment-101',
    toStatus: 'checked_in',
    expectedVersion: 1,
    reasonCode: 'reception_check_in',
    sourceEvidenceSha256: 'b'.repeat(64),
    actorSystemKey: 'canonical.appointment.test',
    idempotencyKey: 'appointment-check-in-101',
    eventPublicId: 'appointment-outbox-check-in-101',
    occurredAtUtc: '2026-07-26T09:00:00.000Z',
    businessDate: '2026-07-26',
  });
}

describe('canonical appointment authority commands', () => {
  it('atomically creates planned intent, immutable event, source mapping, compatibility, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_appointment_compat(marker) VALUES (?)`).bind('legacy-9001');
      await expect(createAppointmentIntent(db, createInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          appointmentPublicId: 'appointment-101',
          currentStatus: 'scheduled',
          statusVersion: 1,
        },
      });
      expect(count(sqlite, 'canonical_appointments')).toBe(1);
      expect(count(sqlite, 'canonical_appointment_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_appointment_compat')).toBe(1);
      expect(sqlite.prepare(`
        SELECT patient_link_public_id,requested_practitioner_public_id,current_status,status_version,
               quoted_amount_minor,currency_code
        FROM canonical_appointments
      `).get()).toEqual({
        patient_link_public_id: 'ptl-101',
        requested_practitioner_public_id: 'practitioner-101',
        current_status: 'scheduled',
        status_version: 1,
        quoted_amount_minor: 100000,
        currency_code: 'BDT',
      });
      expect(sqlite.prepare(`
        SELECT event_type,from_status,to_status,sequence FROM canonical_appointment_status_events
      `).get()).toEqual({ event_type: 'created', from_status: null, to_status: 'scheduled', sequence: 1 });
      expect(sqlite.prepare(`
        SELECT entity_type,canonical_public_id,source_type,source_public_id,mapping_status
        FROM canonical_source_mappings
      `).get()).toEqual({
        entity_type: 'appointment',
        canonical_public_id: 'appointment-101',
        source_type: 'legacy_appointment',
        source_public_id: '9001',
        mapping_status: 'mapped',
      });

      const outbox = sqlite.prepare(`
        SELECT aggregate_type,aggregate_public_id,event_type,payload_json
        FROM canonical_outbox_events
      `).get() as Record<string, string>;
      expect(outbox).toMatchObject({
        aggregate_type: 'canonical_appointment',
        aggregate_public_id: 'appointment-101',
        event_type: 'canonical.appointment.created',
      });
      for (const forbidden of [
        'Sensitive complaint text', 'ptl-101', 'practitioner-101', 'service-consult-101',
        '9001', '100000', 'doctor_fee_schedule',
      ]) expect(outbox.payload_json).not.toContain(forbidden);
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        appointmentPublicId: 'appointment-101',
        currentStatus: 'scheduled',
        statusVersion: 1,
      });
    } finally {
      sqlite.close();
    }
  });

  it('bootstraps one fulfilled legacy appointment only with exact encounter evidence', async () => {
    const { sqlite, db } = harness();
    try {
      const request = {
        ...createInput({
          appointmentPublicId: undefined,
          sourcePublicId: 'legacy-bootstrap-9001',
          idempotencyKey: 'appointment-bootstrap-9001',
          eventPublicId: undefined,
          actorSystemKey: 'canonical.appointment.route-bootstrap',
        }),
        legacyBootstrap: {
          currentStatus: 'fulfilled' as const,
          encounterPublicId: 'encounter-101',
          linkType: 'fulfilled_by' as const,
        },
      };
      await expect(createAppointmentIntent(db, request)).resolves.toMatchObject({
        status: 'applied',
        result: { currentStatus: 'fulfilled', statusVersion: 1 },
      });
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_appointments
      `).get()).toEqual({ current_status: 'fulfilled', status_version: 1 });
      expect(sqlite.prepare(`
        SELECT encounter_public_id,link_type,link_status
        FROM canonical_appointment_encounter_links
      `).get()).toEqual({
        encounter_public_id: 'encounter-101',
        link_type: 'fulfilled_by',
        link_status: 'active',
      });
      await expect(createAppointmentIntent(db, {
        ...createInput({
          appointmentPublicId: 'appointment-invalid-bootstrap',
          sourcePublicId: 'legacy-bootstrap-invalid',
          idempotencyKey: 'appointment-bootstrap-invalid',
          eventPublicId: 'appointment-bootstrap-invalid-event',
          actorSystemKey: 'canonical.appointment.route-bootstrap',
        }),
        legacyBootstrap: { currentStatus: 'fulfilled' as const },
      })).rejects.toThrow(/encounter evidence/);
    } finally {
      sqlite.close();
    }
  });

  it('creates telemedicine intent with deterministic IDs, replays identical requests, and rejects changed replay', async () => {
    const { sqlite, db } = harness();
    try {
      const request = createInput({
        appointmentPublicId: undefined,
        eventPublicId: undefined,
        appointmentKind: 'telemedicine',
        modality: 'telemedicine',
        schedulingChannel: 'marketplace',
        tokenNumber: null,
        tokenAssignmentType: 'none',
        sourceType: 'legacy_consultation',
        sourcePublicId: '7001',
        sourceTable: 'consultations',
        idempotencyKey: 'appointment-create-tele-7001',
      });
      const first = await createAppointmentIntent(db, request);
      expect(first.result.appointmentPublicId).toMatch(/^appt_[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(createAppointmentIntent(db, {
        ...request,
        occurredAtUtc: '2026-07-26T08:05:00.000Z',
      })).resolves.toEqual({ status: 'replayed', result: first.result });
      await expect(createAppointmentIntent(db, {
        ...request,
        requestedEndUtc: '2026-07-26T10:00:00.000Z',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_appointments')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed for missing patient links, inactive practitioners, and conflicting source mappings', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createAppointmentIntent(db, createInput({
        appointmentPublicId: 'appointment-missing-patient',
        patientLinkPublicId: 'ptl-missing',
        idempotencyKey: 'appointment-missing-patient',
        eventPublicId: 'appointment-outbox-missing-patient',
        sourcePublicId: '9002',
      }))).rejects.toThrow(/patient link not found/);

      sqlite.prepare(`
        UPDATE canonical_practitioners SET status='inactive'
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101'
      `).run();
      await expect(createAppointmentIntent(db, createInput({
        appointmentPublicId: 'appointment-inactive-practitioner',
        idempotencyKey: 'appointment-inactive-practitioner',
        eventPublicId: 'appointment-outbox-inactive-practitioner',
        sourcePublicId: '9003',
      }))).rejects.toThrow(/active practitioner/);
      sqlite.prepare(`
        UPDATE canonical_practitioners SET status='active'
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101'
      `).run();

      sqlite.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('tenant-a','appointment','appointment-other','legacy_appointment','9004',
                  'appointments','mapped',1,?)
      `).run('c'.repeat(64));
      await expect(createAppointmentIntent(db, createInput({
        appointmentPublicId: 'appointment-conflict',
        idempotencyKey: 'appointment-source-conflict',
        eventPublicId: 'appointment-outbox-source-conflict',
        sourcePublicId: '9004',
      }))).rejects.toThrow(/source mapping already belongs to another appointment/);
      expect(count(sqlite, 'canonical_appointments')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back canonical, mapping, event, and outbox facts when compatibility fails', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO legacy_appointment_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_appointment_compat(marker) VALUES ('duplicate')`);
      await expect(createAppointmentIntent(db, createInput(), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      expect(count(sqlite, 'canonical_appointments')).toBe(0);
      expect(count(sqlite, 'canonical_appointment_status_events')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('uses exact expected-version guards, reviewed transitions, immutable sequence, and replay before current-state validation', async () => {
    const { sqlite, db } = harness();
    try {
      await createAppointmentIntent(db, createInput());
      const confirmed = {
        tenantId: 'tenant-a', appointmentPublicId: 'appointment-101', toStatus: 'confirmed' as const,
        expectedVersion: 1, reasonCode: 'patient_confirmed', sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.appointment.test', idempotencyKey: 'appointment-confirm-101',
        eventPublicId: 'appointment-outbox-confirm-101', occurredAtUtc: '2026-07-26T08:10:00.000Z',
        businessDate: '2026-07-26',
      };
      await expect(transitionAppointmentStatus(db, confirmed)).resolves.toMatchObject({
        status: 'applied', result: { currentStatus: 'confirmed', statusVersion: 2 },
      });
      await transitionAppointmentStatus(db, {
        ...confirmed,
        toStatus: 'arrived',
        expectedVersion: 2,
        idempotencyKey: 'appointment-arrive-101',
        eventPublicId: 'appointment-outbox-arrive-101',
        occurredAtUtc: '2026-07-26T08:50:00.000Z',
      });
      await transitionAppointmentStatus(db, {
        ...confirmed,
        toStatus: 'checked_in',
        expectedVersion: 3,
        idempotencyKey: 'appointment-check-in-101',
        eventPublicId: 'appointment-outbox-check-in-101',
        occurredAtUtc: '2026-07-26T09:00:00.000Z',
      });
      await expect(transitionAppointmentStatus(db, {
        ...confirmed,
        occurredAtUtc: '2026-07-26T08:15:00.000Z',
      })).resolves.toEqual({
        status: 'replayed',
        result: { appointmentPublicId: 'appointment-101', currentStatus: 'confirmed', statusVersion: 2 },
      });
      await expect(transitionAppointmentStatus(db, {
        ...confirmed,
        toStatus: 'entered_in_error',
        expectedVersion: 2,
        idempotencyKey: 'appointment-stale-101',
        eventPublicId: 'appointment-outbox-stale-101',
      })).rejects.toThrow(/expectedVersion 2 does not match current version 4/);
      await expect(transitionAppointmentStatus(db, {
        ...confirmed,
        toStatus: 'no_show',
        expectedVersion: 4,
        idempotencyKey: 'appointment-invalid-transition-101',
        eventPublicId: 'appointment-outbox-invalid-transition-101',
      })).rejects.toThrow(/transition checked_in -> no_show is not allowed/);
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_appointments
      `).get()).toEqual({ current_status: 'checked_in', status_version: 4 });
      expect(sqlite.prepare(`
        SELECT group_concat(sequence, ',') AS sequences
        FROM canonical_appointment_status_events ORDER BY sequence
      `).get()).toEqual({ sequences: '1,2,3,4' });
    } finally {
      sqlite.close();
    }
  });

  it('reschedules by closing the old intent and creating a new linked intent without rewriting history', async () => {
    const { sqlite, db } = harness();
    try {
      await createAppointmentIntent(db, createInput());
      const compatibility = db.prepare(`INSERT INTO legacy_appointment_compat(marker) VALUES ('reschedule-9001-9002')`);
      await expect(rescheduleAppointment(db, {
        tenantId: 'tenant-a',
        appointmentPublicId: 'appointment-101',
        expectedVersion: 1,
        newAppointmentPublicId: 'appointment-102',
        requestedPractitionerPublicId: 'practitioner-102',
        requestedStartUtc: '2026-07-27T10:00:00.000Z',
        requestedEndUtc: '2026-07-27T10:30:00.000Z',
        businessDate: '2026-07-27',
        timezone: 'Asia/Dhaka',
        tokenNumber: 2,
        tokenAssignmentType: 'auto',
        sourceType: 'legacy_appointment',
        sourcePublicId: '9002',
        sourceTable: 'appointments',
        sourceEvidenceSha256: 'c'.repeat(64),
        reasonCode: 'patient_requested_new_time',
        actorSystemKey: 'canonical.appointment.test',
        idempotencyKey: 'appointment-reschedule-101-102',
        eventPublicId: 'appointment-outbox-reschedule-101-102',
        occurredAtUtc: '2026-07-26T08:30:00.000Z',
      }, { authoritativeStatements: [compatibility] })).resolves.toEqual({
        status: 'applied',
        result: {
          previousAppointmentPublicId: 'appointment-101',
          previousStatusVersion: 2,
          newAppointmentPublicId: 'appointment-102',
          newStatusVersion: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT appointment_public_id,current_status,status_version,rescheduled_from_appointment_public_id,
               requested_start_utc,requested_practitioner_public_id
        FROM canonical_appointments ORDER BY appointment_public_id
      `).all()).toEqual([
        {
          appointment_public_id: 'appointment-101', current_status: 'rescheduled', status_version: 2,
          rescheduled_from_appointment_public_id: null, requested_start_utc: '2026-07-26T09:00:00.000Z',
          requested_practitioner_public_id: 'practitioner-101',
        },
        {
          appointment_public_id: 'appointment-102', current_status: 'scheduled', status_version: 1,
          rescheduled_from_appointment_public_id: 'appointment-101', requested_start_utc: '2026-07-27T10:00:00.000Z',
          requested_practitioner_public_id: 'practitioner-102',
        },
      ]);
      expect(sqlite.prepare(`
        SELECT appointment_public_id,event_type,sequence FROM canonical_appointment_status_events
        ORDER BY appointment_public_id,sequence
      `).all()).toEqual([
        { appointment_public_id: 'appointment-101', event_type: 'created', sequence: 1 },
        { appointment_public_id: 'appointment-101', event_type: 'rescheduled', sequence: 2 },
        { appointment_public_id: 'appointment-102', event_type: 'created', sequence: 1 },
      ]);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
      expect(count(sqlite, 'legacy_appointment_compat')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('fulfils an active scheduled appointment directly when exact encounter evidence exists', async () => {
    const { sqlite, db } = harness();
    try {
      await createAppointmentIntent(db, createInput());
      await expect(fulfilAppointment(db, {
        tenantId: 'tenant-a',
        appointmentPublicId: 'appointment-101',
        encounterPublicId: 'encounter-101',
        linkPublicId: 'appointment-encounter-link-direct',
        linkType: 'fulfilled_by',
        expectedVersion: 1,
        reasonCode: 'doctor_signed_encounter',
        sourceEvidenceSha256: 'd'.repeat(64),
        actorSystemKey: 'canonical.appointment.route',
        idempotencyKey: 'appointment-fulfil-direct-101',
        eventPublicId: 'appointment-outbox-fulfil-direct-101',
        occurredAtUtc: '2026-07-26T09:05:00.000Z',
        businessDate: '2026-07-26',
      })).resolves.toMatchObject({
        status: 'applied',
        result: { currentStatus: 'fulfilled', statusVersion: 2 },
      });
      expect(sqlite.prepare(`
        SELECT event_type,from_status,to_status,sequence
        FROM canonical_appointment_status_events ORDER BY sequence DESC LIMIT 1
      `).get()).toEqual({
        event_type: 'fulfilled',
        from_status: 'scheduled',
        to_status: 'fulfilled',
        sequence: 2,
      });
    } finally {
      sqlite.close();
    }
  });

  it('fulfils only with explicit encounter evidence and one active link in each direction', async () => {
    const { sqlite, db } = harness();
    try {
      await createCheckedInAppointment(db);
      await expect(fulfilAppointment(db, {
        tenantId: 'tenant-a',
        appointmentPublicId: 'appointment-101',
        encounterPublicId: 'encounter-101',
        linkPublicId: 'appointment-encounter-link-101',
        linkType: 'fulfilled_by',
        expectedVersion: 2,
        reasonCode: 'visit_started',
        sourceEvidenceSha256: 'd'.repeat(64),
        actorSystemKey: 'canonical.appointment.test',
        idempotencyKey: 'appointment-fulfil-101',
        eventPublicId: 'appointment-outbox-fulfil-101',
        occurredAtUtc: '2026-07-26T09:05:00.000Z',
        businessDate: '2026-07-26',
      })).resolves.toMatchObject({
        status: 'applied',
        result: {
          appointmentPublicId: 'appointment-101', encounterPublicId: 'encounter-101',
          currentStatus: 'fulfilled', statusVersion: 3, linkStatus: 'active',
        },
      });
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_appointments
      `).get()).toEqual({ current_status: 'fulfilled', status_version: 3 });
      expect(sqlite.prepare(`
        SELECT appointment_public_id,encounter_public_id,link_type,link_status
        FROM canonical_appointment_encounter_links
      `).get()).toEqual({
        appointment_public_id: 'appointment-101', encounter_public_id: 'encounter-101',
        link_type: 'fulfilled_by', link_status: 'active',
      });
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_appointment_encounter_links (
          tenant_id,link_public_id,appointment_public_id,encounter_public_id,
          link_type,link_status,source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','duplicate-link','appointment-101','encounter-101',
                  'approved_manual','active',?,?)
      `).run('e'.repeat(64), '2026-07-26T09:06:00.000Z')).toThrow(/UNIQUE constraint failed/);
    } finally {
      sqlite.close();
    }
  });

  it('rejects fulfilment when patient identity does not agree across appointment and encounter', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_tenant_patient_links (
          tenant_id,patient_link_public_id,legacy_patient_id,link_status,
          verification_level,evidence_type,evidence_sha256,effective_from_utc,version
        ) VALUES ('tenant-a','ptl-102',102,'unlinked','unverified','no_link_placeholder',?,?,1)
      `).run('5'.repeat(64), '2026-07-26T00:00:00.000Z');
      await createAppointmentIntent(db, createInput({
        appointmentPublicId: 'appointment-102',
        patientLinkPublicId: 'ptl-102',
        tokenNumber: 2,
        sourcePublicId: '9002',
        idempotencyKey: 'appointment-create-102',
        eventPublicId: 'appointment-outbox-create-102',
      }));
      await transitionAppointmentStatus(db, {
        tenantId: 'tenant-a', appointmentPublicId: 'appointment-102', toStatus: 'checked_in',
        expectedVersion: 1, reasonCode: 'reception_check_in', sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.appointment.test', idempotencyKey: 'appointment-check-in-102',
        eventPublicId: 'appointment-outbox-check-in-102', occurredAtUtc: '2026-07-26T09:00:00.000Z',
        businessDate: '2026-07-26',
      });
      await expect(fulfilAppointment(db, {
        tenantId: 'tenant-a', appointmentPublicId: 'appointment-102', encounterPublicId: 'encounter-101',
        linkType: 'fulfilled_by', expectedVersion: 2, reasonCode: 'visit_started',
        sourceEvidenceSha256: 'd'.repeat(64), actorSystemKey: 'canonical.appointment.test',
        idempotencyKey: 'appointment-fulfil-mismatch-102', eventPublicId: 'appointment-outbox-fulfil-mismatch-102',
        occurredAtUtc: '2026-07-26T09:05:00.000Z', businessDate: '2026-07-26',
      })).rejects.toThrow(/patient identity does not agree/);
      expect(count(sqlite, 'canonical_appointment_encounter_links')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('retires an active encounter link by entering the appointment in error instead of deleting history', async () => {
    const { sqlite, db } = harness();
    try {
      await createCheckedInAppointment(db);
      await fulfilAppointment(db, {
        tenantId: 'tenant-a', appointmentPublicId: 'appointment-101', encounterPublicId: 'encounter-101',
        linkPublicId: 'appointment-encounter-link-101', linkType: 'fulfilled_by', expectedVersion: 2,
        reasonCode: 'visit_started', sourceEvidenceSha256: 'd'.repeat(64),
        actorSystemKey: 'canonical.appointment.test', idempotencyKey: 'appointment-fulfil-101',
        eventPublicId: 'appointment-outbox-fulfil-101', occurredAtUtc: '2026-07-26T09:05:00.000Z',
        businessDate: '2026-07-26',
      });
      await expect(retireAppointmentEncounterLink(db, {
        tenantId: 'tenant-a',
        appointmentPublicId: 'appointment-101',
        linkPublicId: 'appointment-encounter-link-101',
        expectedVersion: 3,
        linkStatus: 'retired',
        reasonCode: 'wrong_encounter_link',
        sourceEvidenceSha256: 'e'.repeat(64),
        actorSystemKey: 'canonical.appointment.test',
        idempotencyKey: 'appointment-retire-link-101',
        eventPublicId: 'appointment-outbox-retire-link-101',
        occurredAtUtc: '2026-07-26T09:10:00.000Z',
        businessDate: '2026-07-26',
      })).resolves.toMatchObject({
        status: 'applied',
        result: {
          appointmentPublicId: 'appointment-101', linkPublicId: 'appointment-encounter-link-101',
          currentStatus: 'entered_in_error', statusVersion: 4, linkStatus: 'retired',
        },
      });
      expect(sqlite.prepare(`
        SELECT link_status,retired_at_utc FROM canonical_appointment_encounter_links
      `).get()).toEqual({ link_status: 'retired', retired_at_utc: '2026-07-26T09:10:00.000Z' });
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_appointments
      `).get()).toEqual({ current_status: 'entered_in_error', status_version: 4 });
      expect(count(sqlite, 'canonical_appointment_encounter_links')).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
