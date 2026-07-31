import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  resolveAppointmentCheckIn,
  resolveAppointmentDetail,
  resolveAppointmentProjection,
  resolveAppointmentProviderMode,
  resolveAppointmentReminderProjection,
  resolveMarketplaceBookingProjection,
  resolvePatientPortalAppointmentProjection,
  type AppointmentProviderDatabase,
  type AppointmentProviderPreparedStatement,
} from '../../src/lib/canonical/appointment-provider';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements AppointmentProviderPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): { sqlite: DatabaseSync; db: AppointmentProviderDatabase } {
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
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      appt_date TEXT NOT NULL,
      appt_time TEXT,
      appointment_type TEXT,
      visit_type TEXT,
      source TEXT,
      token_no INTEGER,
      token_assignment_type TEXT,
      status TEXT NOT NULL,
      notes TEXT,
      billing_status TEXT,
      final_fee INTEGER
    );
    CREATE TABLE consultations (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      room_url TEXT
    );
  `);
  return {
    sqlite,
    db: {
      prepare(sql: string) {
        return new Statement(sqlite, sql);
      },
    },
  };
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
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal','Canonical Doctor','active',1,?)
  `).run('2'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','practitioner','practitioner-101','legacy_doctor','201',
              'doctors','mapped',1,?)
  `).run('2'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','service-consult-101','consultation','Consultation','visit','active',?)
  `).run('3'.repeat(64));
}

function seedLegacyAppointment(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO appointments (
      id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
      visit_type,source,token_no,token_assignment_type,status,notes,billing_status,final_fee
    ) VALUES (9001,'tenant-a',101,201,'2026-07-26','09:00','new_patient',
              'opd','marketplace',7,'auto','scheduled','Sensitive note','paid',100000)
  `).run();
}

function seedCanonicalAppointment(sqlite: DatabaseSync, options: {
  status?: string;
  start?: string;
  channel?: string;
  token?: number;
  appointmentId?: string;
  sourceType?: string;
  sourceId?: string;
} = {}): void {
  const appointmentId = options.appointmentId ?? 'appointment-9001';
  const sourceType = options.sourceType ?? 'legacy_appointment';
  const sourceId = options.sourceId ?? '9001';
  const status = options.status ?? 'scheduled';
  const start = options.start ?? '2026-07-26T03:00:00.000Z';
  sqlite.prepare(`
    INSERT INTO canonical_appointments (
      tenant_id,appointment_public_id,patient_link_public_id,requested_practitioner_public_id,
      requested_service_item_public_id,appointment_kind,modality,scheduling_channel,
      requested_start_utc,requested_end_utc,business_date,timezone,token_number,
      token_assignment_type,current_status,status_version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'ptl-101','practitioner-101','service-consult-101',
              'new_patient','in_person',?,?,?,'2026-07-26','Asia/Dhaka',?,'auto',?,1,?)
  `).run(
    appointmentId,
    options.channel ?? 'marketplace',
    start,
    start === '2026-07-26T03:00:00.000Z' ? '2026-07-26T03:30:00.000Z' : '2026-07-26T04:30:00.000Z',
    options.token ?? 7,
    status,
    'a'.repeat(64),
  );
  sqlite.prepare(`
    INSERT INTO canonical_appointment_status_events (
      tenant_id,event_public_id,appointment_public_id,event_type,from_status,to_status,
      sequence,reason_code,actor_system_key,idempotency_key,source_evidence_sha256,occurred_at_utc
    ) VALUES ('tenant-a',?,?, 'created',NULL,?,1,'legacy_created','provider.test',?,?,?)
  `).run(
    `event-${appointmentId}`,
    appointmentId,
    status,
    `idem-${appointmentId}`,
    'a'.repeat(64),
    '2026-07-26T02:00:00.000Z',
  );
  sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a','appointment',?,?,?,?,'mapped',1,?)
  `).run(appointmentId, sourceType, sourceId, sourceType === 'legacy_consultation' ? 'consultations' : 'appointments', 'a'.repeat(64));
}

function setMode(sqlite: DatabaseSync, mode: 'legacy' | 'shadow' | 'canonical', enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_appointment_provider_v1','appointment',?,?,
              '2026-07-26T00:00:00.000Z','2026-07-26T00:00:00.000Z')
  `).run(mode, enabled);
}

describe('canonical appointment provider', () => {
  it('defaults to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolveAppointmentProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolveAppointmentProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.prepare(`DELETE FROM canonical_feature_flags`).run();
      setMode(sqlite, 'shadow');
      await expect(resolveAppointmentProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.prepare(`UPDATE canonical_feature_flags SET mode='canonical'`).run();
      await expect(resolveAppointmentProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally {
      sqlite.close();
    }
  });

  it('legacy mode resolves canonical identity only through explicit source and identity mappings', async () => {
    const { sqlite, db } = harness();
    try {
      seedLegacyAppointment(sqlite);
      sqlite.prepare(`
        INSERT INTO canonical_tenant_patient_links (
          tenant_id,patient_link_public_id,legacy_patient_id,link_status,
          verification_level,evidence_type,evidence_sha256,effective_from_utc,version
        ) VALUES ('tenant-a','ptl-unrelated',999,'unlinked','unverified','no_link_placeholder',?,?,1)
      `).run('9'.repeat(64), '2026-07-26T00:00:00.000Z');
      sqlite.prepare(`
        INSERT INTO canonical_appointments (
          tenant_id,appointment_public_id,patient_link_public_id,appointment_kind,modality,
          scheduling_channel,requested_start_utc,requested_end_utc,business_date,timezone,
          token_assignment_type,current_status,status_version,source_evidence_sha256
        ) VALUES ('tenant-a','same-time-unmapped','ptl-unrelated','new_patient','in_person',
                  'marketplace','2026-07-26T03:00:00.000Z','2026-07-26T03:30:00.000Z',
                  '2026-07-26','Asia/Dhaka','none','scheduled',1,?)
      `).run('b'.repeat(64));
      const projection = await resolveAppointmentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 9001, timezone: 'Asia/Dhaka',
      });
      expect(projection.mode).toBe('legacy');
      expect(projection.appointmentPublicId).toBeNull();
      expect(projection.patientLinkPublicId).toBeNull();
      expect(projection.requestedPractitionerPublicId).toBeNull();
      await expect(resolveAppointmentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 9001,
        timezone: 'Asia/Dhaka', identitySensitive: true,
      })).rejects.toThrow(/explicit appointment, patient, and practitioner mappings are required/);
    } finally {
      sqlite.close();
    }
  });

  it('shadow mode compares authority facts while ignoring notes, billing state, and fee', async () => {
    const { sqlite, db } = harness();
    try {
      seedDependencies(sqlite);
      seedLegacyAppointment(sqlite);
      seedCanonicalAppointment(sqlite);
      setMode(sqlite, 'shadow');
      const projection = await resolveAppointmentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 9001,
        timezone: 'Asia/Dhaka', identitySensitive: true,
      });
      expect(projection).toMatchObject({
        mode: 'shadow',
        appointmentPublicId: 'appointment-9001',
        patientLinkPublicId: 'ptl-101',
        requestedPractitionerPublicId: 'practitioner-101',
        appointmentKind: 'new_patient',
        modality: 'in_person',
        schedulingChannel: 'marketplace',
        requestedStartUtc: '2026-07-26T03:00:00.000Z',
        requestedEndUtc: '2026-07-26T03:30:00.000Z',
        businessDate: '2026-07-26',
        timezone: 'Asia/Dhaka',
        tokenNumber: 7,
        tokenAssignmentType: 'auto',
        currentStatus: 'scheduled',
        statusVersion: 1,
      });
      expect(projection.parity).toEqual({
        ok: true,
        mapping: true,
        patientLink: true,
        practitioner: true,
        kind: true,
        modality: true,
        channel: true,
        interval: true,
        businessDate: true,
        token: true,
        status: true,
        lineage: true,
        encounterLink: true,
      });
      expect(JSON.stringify(projection)).not.toContain('Sensitive note');
      expect(JSON.stringify(projection)).not.toContain('paid');
      expect(JSON.stringify(projection)).not.toContain('100000');

      sqlite.prepare(`UPDATE canonical_appointments SET current_status='confirmed'`).run();
      const drift = await resolveAppointmentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 9001,
        timezone: 'Asia/Dhaka', identitySensitive: true,
      });
      expect(drift.parity).toMatchObject({ ok: false, status: false });
    } finally {
      sqlite.close();
    }
  });

  it('canonical mode returns canonical intent and explicit encounter linkage with legacy ID as metadata only', async () => {
    const { sqlite, db } = harness();
    try {
      seedDependencies(sqlite);
      seedLegacyAppointment(sqlite);
      seedCanonicalAppointment(sqlite, { status: 'fulfilled' });
      sqlite.prepare(`
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
          started_at_utc,source_evidence_sha256
        ) VALUES ('tenant-a','encounter-9001',101,'outpatient','completed',?,?)
      `).run('2026-07-26T03:05:00.000Z', 'c'.repeat(64));
      sqlite.prepare(`
        INSERT INTO canonical_appointment_encounter_links (
          tenant_id,link_public_id,appointment_public_id,encounter_public_id,
          link_type,link_status,source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','link-9001','appointment-9001','encounter-9001',
                  'fulfilled_by','active',?,?)
      `).run('d'.repeat(64), '2026-07-26T03:05:00.000Z');
      setMode(sqlite, 'canonical');
      const projection = await resolveAppointmentProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 9001,
        timezone: 'Asia/Dhaka', identitySensitive: true,
      });
      expect(projection).toMatchObject({
        mode: 'canonical',
        appointmentPublicId: 'appointment-9001',
        patientLinkPublicId: 'ptl-101',
        requestedPractitionerPublicId: 'practitioner-101',
        currentStatus: 'fulfilled',
        encounterPublicId: 'encounter-9001',
        legacy: { sourceType: 'legacy_appointment', legacyId: 9001 },
      });
      expect(projection).not.toHaveProperty('billingStatus');
      expect(projection).not.toHaveProperty('notes');
      expect(projection).not.toHaveProperty('fee');
    } finally {
      sqlite.close();
    }
  });

  it('maps scheduled telemedicine consultations into the same appointment provider contract', async () => {
    const { sqlite, db } = harness();
    try {
      seedDependencies(sqlite);
      sqlite.prepare(`
        INSERT INTO consultations (
          id,tenant_id,patient_id,doctor_id,scheduled_at,duration_min,status,notes,room_url
        ) VALUES (7001,'tenant-a',101,201,'2026-07-26T04:00:00.000Z',30,'scheduled',
                  'Private complaint','https://private-room.example')
      `).run();
      seedCanonicalAppointment(sqlite, {
        appointmentId: 'appointment-7001',
        sourceType: 'legacy_consultation',
        sourceId: '7001',
        start: '2026-07-26T04:00:00.000Z',
        channel: 'marketplace',
        token: 8,
      });
      sqlite.prepare(`
        UPDATE canonical_appointments
        SET appointment_kind='telemedicine',modality='telemedicine',
            token_number=NULL,token_assignment_type='none'
        WHERE appointment_public_id='appointment-7001'
      `).run();
      setMode(sqlite, 'canonical');
      const projection = await resolveMarketplaceBookingProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_consultation', legacyId: 7001,
        timezone: 'Asia/Dhaka', identitySensitive: true,
      });
      expect(projection).toMatchObject({
        appointmentPublicId: 'appointment-7001',
        appointmentKind: 'telemedicine',
        modality: 'telemedicine',
        tokenNumber: null,
        tokenAssignmentType: 'none',
      });
      expect(JSON.stringify(projection)).not.toContain('Private complaint');
      expect(JSON.stringify(projection)).not.toContain('private-room');
    } finally {
      sqlite.close();
    }
  });

  it('provides disabled-safe detail, portal, check-in, marketplace, and reminder adapters', async () => {
    const { sqlite, db } = harness();
    try {
      seedDependencies(sqlite);
      seedLegacyAppointment(sqlite);
      seedCanonicalAppointment(sqlite);
      const input = {
        tenantId: 'tenant-a' as const,
        sourceType: 'legacy_appointment' as const,
        legacyId: 9001,
        timezone: 'Asia/Dhaka',
      };
      const detail = await resolveAppointmentDetail(db, input);
      expect(detail.mode).toBe('legacy');
      expect(detail.appointmentPublicId).toBe('appointment-9001');

      const portal = await resolvePatientPortalAppointmentProjection(db, input);
      expect(portal.patientLinkPublicId).toBe('ptl-101');

      const marketplace = await resolveMarketplaceBookingProjection(db, input);
      expect(marketplace.requestedPractitionerPublicId).toBe('practitioner-101');

      const checkIn = await resolveAppointmentCheckIn(db, input);
      expect(checkIn).toEqual({
        appointmentPublicId: 'appointment-9001',
        patientLinkPublicId: 'ptl-101',
        requestedPractitionerPublicId: 'practitioner-101',
        currentStatus: 'scheduled',
        legacyId: 9001,
      });

      const reminder = await resolveAppointmentReminderProjection(db, input);
      expect(reminder).toEqual({
        appointmentPublicId: 'appointment-9001',
        patientLinkPublicId: 'ptl-101',
        requestedStartUtc: '2026-07-26T03:00:00.000Z',
        currentStatus: 'scheduled',
        legacyId: 9001,
      });
    } finally {
      sqlite.close();
    }
  });
});
