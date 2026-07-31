import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0548_canonical_encounter_admission_bed_convergence.sql';
const admissionAlignmentMigrationPath = 'migrations/0571_canonical_admission_encounter_type_alignment.sql';
const schemaPath = 'src/db/schema/canonical/clinical.ts';
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
    'migrations/0546_canonical_appointment_authority.sql',
    migrationPath,
  ]) db.exec(readFileSync(migration, 'utf8'));
  if (existsSync(admissionAlignmentMigrationPath)) {
    db.exec(readFileSync(admissionAlignmentMigrationPath, 'utf8'));
  }
  return db;
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table) as
    | { sql?: string }
    | undefined;
  return String(row?.sql ?? '').replace(/\s+/g, ' ');
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{ name: string }>)
    .map((column) => String(column.name));
}

function uniqueIndexes(db: DatabaseSync, table: string): Array<{ name: string; columns: string[]; partial: number }> {
  return (db.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all() as Array<{
    name: string;
    unique: number;
    partial: number;
  }>)
    .filter((entry) => Number(entry.unique) === 1)
    .map((entry) => ({
      name: String(entry.name),
      partial: Number(entry.partial),
      columns: (db.prepare(`PRAGMA index_info(${JSON.stringify(entry.name)})`).all() as Array<{
        name: string;
        seqno: number;
      }>)
        .sort((a, b) => Number(a.seqno) - Number(b.seqno))
        .map((column) => String(column.name)),
    }));
}

function seedPatientLink(db: DatabaseSync, tenantId: string, linkId: string, legacyPatientId: number): void {
  db.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES (?,?,?,'unlinked','unverified','no_link_placeholder',?, ?,1)
  `).run(tenantId, linkId, legacyPatientId, 'a'.repeat(64), '2026-07-26T00:00:00.000Z');
}

function seedLocation(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const input = {
    tenantId: 'tenant-a',
    locationPublicId: 'location-ward-a',
    parentLocationPublicId: null,
    locationKind: 'ward',
    locationCode: 'WARD-A',
    displayName: 'Ward A',
    operationalStatus: 'active',
    timezone: 'Asia/Dhaka',
    version: 1,
    sourceEvidenceSha256: 'b'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_care_locations (
      tenant_id,location_public_id,parent_location_public_id,location_kind,
      location_code,display_name,operational_status,timezone,version,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.tenantId,
    input.locationPublicId,
    input.parentLocationPublicId,
    input.locationKind,
    input.locationCode,
    input.displayName,
    input.operationalStatus,
    input.timezone,
    input.version,
    input.sourceEvidenceSha256,
  );
}

function seedBed(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const input = {
    tenantId: 'tenant-a',
    bedPublicId: 'bed-a-01',
    locationPublicId: 'location-ward-a',
    bedCode: 'A-01',
    bedClass: 'general',
    operationalStatus: 'active',
    version: 1,
    sourceEvidenceSha256: 'c'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_beds (
      tenant_id,bed_public_id,location_public_id,bed_code,bed_class,
      operational_status,version,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?)
  `).run(
    input.tenantId,
    input.bedPublicId,
    input.locationPublicId,
    input.bedCode,
    input.bedClass,
    input.operationalStatus,
    input.version,
    input.sourceEvidenceSha256,
  );
}

function seedEncounter(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const input = {
    tenantId: 'tenant-a',
    encounterPublicId: 'encounter-ipd-a',
    legacyPatientId: 101,
    patientLinkPublicId: 'ptl-101',
    encounterType: 'inpatient',
    status: 'in_progress',
    encounterVersion: 1,
    careLocationPublicId: 'location-ward-a',
    sourceKind: 'runtime',
    sourceCommandKey: 'encounter-command-a',
    startedAtUtc: '2026-07-26T08:00:00.000Z',
    sourceEvidenceSha256: 'd'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,care_location_public_id,source_kind,
      source_command_key,started_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.tenantId,
    input.encounterPublicId,
    input.legacyPatientId,
    input.patientLinkPublicId,
    input.encounterType,
    input.status,
    input.encounterVersion,
    input.careLocationPublicId,
    input.sourceKind,
    input.sourceCommandKey,
    input.startedAtUtc,
    input.sourceEvidenceSha256,
  );
}

function seedAdmission(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const input = {
    tenantId: 'tenant-a',
    admissionPublicId: 'admission-a-01',
    encounterPublicId: 'encounter-ipd-a',
    patientLinkPublicId: 'ptl-101',
    admissionNumber: 'ADM-0001',
    admissionType: 'inpatient',
    admissionSource: 'planned',
    currentStatus: 'admitted',
    statusVersion: 1,
    admittedAtUtc: '2026-07-26T08:00:00.000Z',
    dischargedAtUtc: null,
    reasonCode: 'planned_admission',
    idempotencyKey: 'admission-command-a',
    requestFingerprintSha256: 'e'.repeat(64),
    sourceEvidenceSha256: 'f'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_admissions (
      tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,
      admission_number,admission_type,admission_source,current_status,status_version,
      admitted_at_utc,discharged_at_utc,reason_code,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.tenantId,
    input.admissionPublicId,
    input.encounterPublicId,
    input.patientLinkPublicId,
    input.admissionNumber,
    input.admissionType,
    input.admissionSource,
    input.currentStatus,
    input.statusVersion,
    input.admittedAtUtc,
    input.dischargedAtUtc,
    input.reasonCode,
    input.idempotencyKey,
    input.requestFingerprintSha256,
    input.sourceEvidenceSha256,
  );
}

function seedDependencies(db: DatabaseSync): void {
  seedPatientLink(db, 'tenant-a', 'ptl-101', 101);
  seedPatientLink(db, 'tenant-a', 'ptl-102', 102);
  seedPatientLink(db, 'tenant-b', 'ptl-b-101', 101);
  seedLocation(db);
  seedBed(db);
  seedEncounter(db);
  seedAdmission(db);
}

describe('canonical encounter, admission, and bed convergence schema', () => {
  it('reserves the additive migration, canonical schema module, barrel, and source registry entries', () => {
    for (const file of [migrationPath, schemaPath, barrelPath, sourceRegistryPath]) {
      expect(existsSync(file)).toBe(true);
    }
    if (!existsSync(schemaPath) || !existsSync(barrelPath) || !existsSync(sourceRegistryPath)) return;
    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    const registry = readFileSync(sourceRegistryPath, 'utf8');
    for (const table of [
      'canonical_encounters',
      'canonical_admissions',
      'canonical_admission_status_events',
      'canonical_care_locations',
      'canonical_beds',
      'canonical_bed_stays',
    ]) {
      expect(schema).toContain(`'${table}'`);
      expect(registry).toContain(`"name": "${table}"`);
    }
    expect(barrel).toContain("export * from './clinical';");
  });

  it('extends the existing encounter and bed-stay authorities instead of creating duplicates', () => {
    const db = createDatabase();
    try {
      const tables = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name IN (
          'canonical_encounters','canonical_admissions','canonical_admission_status_events',
          'canonical_care_locations','canonical_beds','canonical_bed_stays'
        ) ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(tables).toEqual([
        'canonical_admission_status_events',
        'canonical_admissions',
        'canonical_bed_stays',
        'canonical_beds',
        'canonical_care_locations',
        'canonical_encounters',
      ]);
      expect(columnNames(db, 'canonical_encounters')).toEqual(expect.arrayContaining([
        'legacy_patient_id',
        'patient_link_public_id',
        'encounter_version',
        'care_location_public_id',
        'source_kind',
        'source_command_key',
      ]));
      expect(columnNames(db, 'canonical_bed_stays')).toEqual(expect.arrayContaining([
        'legacy_patient_bed_info_id',
        'legacy_admission_id',
        'legacy_bed_id',
        'admission_public_id',
        'bed_public_id',
        'patient_link_public_id',
        'stay_version',
        'movement_reason',
        'source_command_key',
      ]));
      expect((db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_schema
        WHERE type='table' AND name='canonical_encounters'
      `).get() as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it('keeps admission, location, bed, and occupancy authority free of demographics, finance, and copied billing state', () => {
    const db = createDatabase();
    try {
      const forbidden = new Set([
        'patient_name', 'phone', 'mobile', 'email', 'address', 'care_of_name', 'care_of_phone',
        'doctor_name', 'nurse_id', 'password', 'diagnosis', 'provisional_diagnosis', 'final_diagnosis',
        'admission_fee', 'rate_per_day', 'days', 'charge_amount', 'is_billed', 'billed_bill_id',
        'billing_mode', 'package_id', 'bill_status', 'due_cleared', 'invoice_id', 'payment_id',
        'deposit_id', 'occupied', 'available', 'current_patient_id', 'current_admission_id',
      ]);
      for (const table of [
        'canonical_admissions',
        'canonical_admission_status_events',
        'canonical_care_locations',
        'canonical_beds',
        'canonical_bed_stays',
      ]) {
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

  it('enforces staged encounter patient-link, version, location, source-kind, and tenant safety', () => {
    const db = createDatabase();
    try {
      seedPatientLink(db, 'tenant-a', 'ptl-101', 101);
      seedPatientLink(db, 'tenant-b', 'ptl-b-101', 101);
      seedLocation(db);
      seedEncounter(db);
      const encounterSql = tableSql(db, 'canonical_encounters');
      expect(encounterSql).toContain("'planned'");
      expect(encounterSql).toContain("'on_hold'");
      expect(encounterSql).toContain("'entered_in_error'");
      seedEncounter(db, {
        encounterPublicId: 'encounter-on-hold',
        status: 'on_hold',
        sourceCommandKey: 'encounter-command-on-hold',
      });
      seedEncounter(db, {
        encounterPublicId: 'encounter-entered-in-error',
        status: 'entered_in_error',
        sourceCommandKey: 'encounter-command-entered-in-error',
      });
      expect(() => seedEncounter(db, {
        encounterPublicId: 'encounter-bad-version',
        encounterVersion: 0,
      })).toThrow(/CHECK constraint failed/);
      expect(() => seedEncounter(db, {
        encounterPublicId: 'encounter-bad-source-kind',
        sourceKind: 'mystery',
      })).toThrow(/CHECK constraint failed/);
      expect(() => seedEncounter(db, {
        encounterPublicId: 'encounter-cross-tenant-patient',
        patientLinkPublicId: 'ptl-b-101',
      })).toThrow(/patient link|tenant|constraint|abort/i);
      expect(() => seedEncounter(db, {
        encounterPublicId: 'encounter-cross-tenant-location',
        careLocationPublicId: 'missing-location',
      })).toThrow(/care location|tenant|constraint|abort/i);
      expect(() => seedEncounter(db, {
        encounterPublicId: 'encounter-bad-hash',
        sourceEvidenceSha256: 'A'.repeat(64),
      })).toThrow(/source evidence hash|CHECK constraint failed/i);
    } finally {
      db.close();
    }
  });

  it('enforces one active admission per encounter, patient agreement, interval, vocabularies, and evidence', () => {
    const db = createDatabase();
    try {
      seedPatientLink(db, 'tenant-a', 'ptl-101', 101);
      seedPatientLink(db, 'tenant-a', 'ptl-102', 102);
      seedPatientLink(db, 'tenant-b', 'ptl-b-101', 101);
      seedLocation(db);
      seedEncounter(db);
      seedAdmission(db);
      const sql = tableSql(db, 'canonical_admissions');
      for (const status of [
        'planned', 'admitted', 'transfer_pending', 'discharge_pending',
        'discharged', 'cancelled', 'entered_in_error',
      ]) expect(sql).toContain(`'${status}'`);
      expect(sql).toContain('status_version > 0');
      expect(sql).toContain('discharged_at_utc >= admitted_at_utc');
      expect(uniqueIndexes(db, 'canonical_admissions')).toEqual(expect.arrayContaining([
        expect.objectContaining({ columns: ['tenant_id', 'encounter_public_id'], partial: 1 }),
      ]));

      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-active-duplicate',
        admissionNumber: 'ADM-0002',
        idempotencyKey: 'admission-command-duplicate',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-cross-tenant-patient',
        admissionNumber: 'ADM-0003',
        patientLinkPublicId: 'ptl-b-101',
        currentStatus: 'cancelled',
        idempotencyKey: 'admission-command-cross-tenant',
      })).toThrow(/FOREIGN KEY constraint failed|patient|tenant/i);
      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-patient-mismatch',
        admissionNumber: 'ADM-0004',
        patientLinkPublicId: 'ptl-102',
        currentStatus: 'cancelled',
        idempotencyKey: 'admission-command-patient-mismatch',
      })).toThrow(/patient.*encounter|constraint|abort/i);
      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-bad-interval',
        admissionNumber: 'ADM-0005',
        currentStatus: 'discharged',
        dischargedAtUtc: '2026-07-26T07:59:59.000Z',
        idempotencyKey: 'admission-command-bad-interval',
      })).toThrow(/CHECK constraint failed/);
      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-bad-status',
        admissionNumber: 'ADM-0006',
        currentStatus: 'critical',
        idempotencyKey: 'admission-command-bad-status',
      })).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('aligns emergency admissions to emergency encounters and all other admissions to inpatient encounters', () => {
    const db = createDatabase();
    try {
      seedPatientLink(db, 'tenant-a', 'ptl-101', 101);
      seedPatientLink(db, 'tenant-a', 'ptl-102', 102);
      seedLocation(db);
      seedEncounter(db);
      seedEncounter(db, {
        encounterPublicId: 'encounter-emergency-a',
        legacyPatientId: 102,
        patientLinkPublicId: 'ptl-102',
        encounterType: 'emergency',
        sourceCommandKey: 'encounter-command-emergency-a',
      });

      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-emergency-a',
        encounterPublicId: 'encounter-emergency-a',
        patientLinkPublicId: 'ptl-102',
        admissionNumber: 'ADM-EMERGENCY-1',
        admissionType: 'emergency',
        admissionSource: 'emergency',
        idempotencyKey: 'admission-command-emergency-a',
      })).not.toThrow();
      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-inpatient-a',
        encounterPublicId: 'encounter-ipd-a',
        patientLinkPublicId: 'ptl-101',
        admissionNumber: 'ADM-INPATIENT-1',
        admissionType: 'inpatient',
        admissionSource: 'planned',
        idempotencyKey: 'admission-command-inpatient-a',
      })).not.toThrow();

      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-emergency-on-inpatient',
        encounterPublicId: 'encounter-ipd-a',
        patientLinkPublicId: 'ptl-101',
        admissionNumber: 'ADM-CROSS-1',
        admissionType: 'emergency',
        admissionSource: 'emergency',
        currentStatus: 'cancelled',
        idempotencyKey: 'admission-command-cross-1',
      })).toThrow(/admission patient encounter mismatch|abort/i);
      expect(() => seedAdmission(db, {
        admissionPublicId: 'admission-inpatient-on-emergency',
        encounterPublicId: 'encounter-emergency-a',
        patientLinkPublicId: 'ptl-102',
        admissionNumber: 'ADM-CROSS-2',
        admissionType: 'inpatient',
        admissionSource: 'planned',
        currentStatus: 'cancelled',
        idempotencyKey: 'admission-command-cross-2',
      })).toThrow(/admission patient encounter mismatch|abort/i);

      expect(() => db.prepare(`
        UPDATE canonical_admissions
        SET admission_type='inpatient',updated_at_utc='2026-07-31T00:00:00.000Z'
        WHERE tenant_id='tenant-a' AND admission_public_id='admission-emergency-a'
      `).run()).toThrow(/admission patient encounter mismatch|abort/i);
    } finally {
      db.close();
    }
  });

  it('enforces immutable admission event sequence, actor, idempotency, and tenant-scoped admission reference', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      const insert = db.prepare(`
        INSERT INTO canonical_admission_status_events (
          tenant_id,event_public_id,admission_public_id,event_type,from_status,to_status,
          sequence,reason_code,safe_note,actor_user_public_id,actor_system_key,
          idempotency_key,source_evidence_sha256,occurred_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      insert.run(
        'tenant-a', 'admission-event-1', 'admission-a-01', 'admitted', null, 'admitted',
        1, 'planned_admission', null, null, 'canonical.admission.test',
        'admission-event-idem-1', '1'.repeat(64), '2026-07-26T08:00:00.000Z',
      );
      expect(() => insert.run(
        'tenant-a', 'admission-event-duplicate-sequence', 'admission-a-01', 'transfer_requested',
        'admitted', 'transfer_pending', 1, 'bed_transfer', null, null, 'canonical.admission.test',
        'admission-event-idem-2', '2'.repeat(64), '2026-07-26T09:00:00.000Z',
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => insert.run(
        'tenant-a', 'admission-event-no-actor', 'admission-a-01', 'transfer_requested',
        'admitted', 'transfer_pending', 2, 'bed_transfer', null, null, null,
        'admission-event-idem-3', '3'.repeat(64), '2026-07-26T09:00:00.000Z',
      )).toThrow(/CHECK constraint failed/);
      expect(() => insert.run(
        'tenant-b', 'admission-event-cross-tenant', 'admission-a-01', 'cancelled',
        'admitted', 'cancelled', 2, 'cancelled', null, null, 'canonical.admission.test',
        'admission-event-idem-4', '4'.repeat(64), '2026-07-26T09:00:00.000Z',
      )).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces tenant-safe location hierarchy and bed resource identity without occupancy or price', () => {
    const db = createDatabase();
    try {
      seedLocation(db, {
        locationPublicId: 'location-floor-a',
        locationKind: 'floor',
        locationCode: 'FLOOR-A',
        displayName: 'Floor A',
      });
      seedLocation(db, {
        parentLocationPublicId: 'location-floor-a',
      });
      seedBed(db);
      const locationSql = tableSql(db, 'canonical_care_locations');
      const bedSql = tableSql(db, 'canonical_beds');
      for (const kind of ['facility', 'branch', 'floor', 'ward', 'room', 'care_area', 'other']) {
        expect(locationSql).toContain(`'${kind}'`);
      }
      for (const status of ['active', 'inactive', 'maintenance', 'retired']) {
        expect(bedSql).toContain(`'${status}'`);
      }
      expect(bedSql).not.toContain("'occupied'");
      expect(bedSql).not.toContain("'available'");
      expect(() => seedLocation(db, {
        locationPublicId: 'location-self-parent',
        parentLocationPublicId: 'location-self-parent',
        locationCode: 'SELF',
      })).toThrow(/CHECK constraint failed/);
      expect(() => seedBed(db, {
        bedPublicId: 'bed-bad-status',
        bedCode: 'BAD-1',
        operationalStatus: 'occupied',
      })).toThrow(/CHECK constraint failed/);
      expect(() => seedBed(db, {
        bedPublicId: 'bed-duplicate-code',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => seedBed(db, {
        tenantId: 'tenant-b',
        bedPublicId: 'bed-cross-tenant-location',
        bedCode: 'B-01',
      })).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces one open stay per bed and admission, interval validity, canonical references, and bed operational state', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      const insertStay = db.prepare(`
        INSERT INTO canonical_bed_stays (
          tenant_id,bed_stay_public_id,encounter_public_id,
          legacy_patient_bed_info_id,legacy_admission_id,legacy_bed_id,
          admission_public_id,bed_public_id,patient_link_public_id,
          started_at_utc,ended_at_utc,status,stay_version,
          movement_reason,source_command_key,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      insertStay.run(
        'tenant-a', 'stay-a-01', 'encounter-ipd-a', 1001, 2001, 3001,
        'admission-a-01', 'bed-a-01', 'ptl-101',
        '2026-07-26T08:00:00.000Z', null, 'active', 1,
        'admission', 'stay-command-a', '5'.repeat(64),
      );
      expect(uniqueIndexes(db, 'canonical_bed_stays')).toEqual(expect.arrayContaining([
        expect.objectContaining({ columns: ['tenant_id', 'bed_public_id'], partial: 1 }),
        expect.objectContaining({ columns: ['tenant_id', 'admission_public_id'], partial: 1 }),
      ]));
      expect(() => insertStay.run(
        'tenant-a', 'stay-a-duplicate-admission', 'encounter-ipd-a', 1002, 2001, 3001,
        'admission-a-01', 'bed-a-01', 'ptl-101',
        '2026-07-26T09:00:00.000Z', null, 'active', 1,
        'transfer', 'stay-command-b', '6'.repeat(64),
      )).toThrow(/UNIQUE constraint failed/);

      seedLocation(db, {
        locationPublicId: 'location-ward-b',
        locationCode: 'WARD-B',
        displayName: 'Ward B',
      });
      seedBed(db, {
        bedPublicId: 'bed-b-01',
        locationPublicId: 'location-ward-b',
        bedCode: 'B-01',
        operationalStatus: 'maintenance',
      });
      expect(() => insertStay.run(
        'tenant-a', 'stay-maintenance-bed', 'encounter-ipd-a', 1003, 2001, 3002,
        'admission-a-01', 'bed-b-01', 'ptl-101',
        '2026-07-26T09:00:00.000Z', null, 'active', 1,
        'transfer', 'stay-command-maintenance', '7'.repeat(64),
      )).toThrow(/maintenance|bed.*active|constraint|abort/i);
      expect(() => insertStay.run(
        'tenant-a', 'stay-patient-mismatch', 'encounter-ipd-a', 1004, 2001, 3002,
        'admission-a-01', 'bed-b-01', 'ptl-102',
        '2026-07-26T09:00:00.000Z', '2026-07-26T10:00:00.000Z', 'completed', 1,
        'transfer', 'stay-command-patient-mismatch', '8'.repeat(64),
      )).toThrow(/patient|admission|encounter|constraint|abort/i);
      seedBed(db, {
        bedPublicId: 'bed-b-02',
        locationPublicId: 'location-ward-b',
        bedCode: 'B-02',
      });
      expect(() => insertStay.run(
        'tenant-a', 'stay-bad-interval', 'encounter-ipd-a', 1005, 2001, 3003,
        'admission-a-01', 'bed-b-02', 'ptl-101',
        '2026-07-26T10:00:00.000Z', '2026-07-26T09:59:59.000Z', 'completed', 1,
        'transfer', 'stay-command-bad-interval', '9'.repeat(64),
      )).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });
});
