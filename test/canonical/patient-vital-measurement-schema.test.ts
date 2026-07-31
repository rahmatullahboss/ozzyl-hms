import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0556_canonical_patient_vital_measurement.sql';
const schemaPath = 'src/db/schema/canonical/vital-observations.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';

const tables = [
  'canonical_vital_observation_components',
  'canonical_vital_observation_sets',
  'canonical_vital_observation_status_events',
];

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    migrationPath,
  ]) db.exec(readFileSync(migration, 'utf8'));
  return db;
}

function seedDependencies(db: DatabaseSync): void {
  for (const [patientLink, legacyPatientId, hash] of [
    ['patient-link-101', 101, '1'],
    ['patient-link-202', 202, '2'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_tenant_patient_links (
        tenant_id,patient_link_public_id,legacy_patient_id,link_status,
        verification_level,evidence_type,evidence_sha256,effective_from_utc,version
      ) VALUES ('tenant-a',?,?,'unlinked','unverified','no_link_placeholder',?,?,1)
    `).run(patientLink, legacyPatientId, hash.repeat(64), '2026-07-28T00:00:00.000Z');
  }
  db.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal','Clinician','active',1,?)
  `).run('3'.repeat(64));
  for (const [encounter, patient, legacy, hash] of [
    ['encounter-101', 'patient-link-101', 101, '4'],
    ['encounter-202', 'patient-link-202', 202, '5'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES ('tenant-a',?,?,?,'outpatient','in_progress',1,'runtime',?,?)
    `).run(encounter, legacy, patient, '2026-07-28T08:00:00.000Z', hash.repeat(64));
  }
}

function insertSet(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    publicId: 'vital-set-101',
    patientLink: 'patient-link-101',
    encounter: 'encounter-101',
    practitioner: 'practitioner-101',
    sourceKind: 'practitioner_entered',
    deviceType: null,
    deviceId: null,
    effectiveAt: '2026-07-28T09:00:00.000Z',
    recordedAt: '2026-07-28T09:01:00.000Z',
    reviewStatus: 'pending_review',
    statusVersion: 1,
    supersedes: null,
    actorUser: null,
    actorSystem: 'canonical.vitals.test',
    idempotencyKey: 'vital-set-create-101',
    requestHash: '6'.repeat(64),
    evidenceHash: '7'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_vital_observation_sets (
      tenant_id,observation_set_public_id,patient_link_public_id,encounter_public_id,
      practitioner_public_id,source_kind,external_device_source_type,
      external_device_source_public_id,effective_at_utc,recorded_at_utc,review_status,
      status_version,supersedes_observation_set_public_id,actor_user_public_id,
      actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.publicId, value.patientLink, value.encounter,
    value.practitioner, value.sourceKind, value.deviceType, value.deviceId,
    value.effectiveAt, value.recordedAt, value.reviewStatus, value.statusVersion,
    value.supersedes, value.actorUser, value.actorSystem, value.idempotencyKey,
    value.requestHash, value.evidenceHash,
  );
}

function insertComponent(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    publicId: 'vital-component-101',
    setPublicId: 'vital-set-101',
    sequence: 1,
    measurementCode: 'heart_rate',
    numericValue: 80,
    canonicalUnit: '/min',
    sourceNumericValue: null,
    sourceUnit: null,
    methodCode: null,
    bodySiteCode: null,
    postureCode: null,
    lateralityCode: null,
    fastingContextCode: null,
    referenceLow: null,
    referenceHigh: null,
    alertLevel: null,
    isDerived: 0,
    formulaKey: null,
    formulaVersion: null,
    evidenceHash: '8'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_vital_observation_components (
      tenant_id,component_public_id,observation_set_public_id,component_sequence,
      measurement_code,numeric_value,canonical_unit_code,source_numeric_value,
      source_unit_code,method_code,body_site_code,posture_code,laterality_code,
      fasting_context_code,reference_low,reference_high,alert_level,is_derived,
      derivation_formula_key,derivation_formula_version,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.publicId, value.setPublicId, value.sequence,
    value.measurementCode, value.numericValue, value.canonicalUnit,
    value.sourceNumericValue, value.sourceUnit, value.methodCode,
    value.bodySiteCode, value.postureCode, value.lateralityCode,
    value.fastingContextCode, value.referenceLow, value.referenceHigh,
    value.alertLevel, value.isDerived, value.formulaKey, value.formulaVersion,
    value.evidenceHash,
  );
}

function insertEvent(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    publicId: 'vital-event-101-v2',
    setPublicId: 'vital-set-101',
    fromStatus: 'pending_review',
    toStatus: 'verified',
    eventVersion: 2,
    eventType: 'verified',
    reasonCode: 'clinician_verified',
    practitioner: 'practitioner-101',
    actorUser: null,
    actorSystem: 'canonical.vitals.test',
    occurredAt: '2026-07-28T09:02:00.000Z',
    evidenceHash: '9'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_vital_observation_status_events (
      tenant_id,event_public_id,observation_set_public_id,from_review_status,
      to_review_status,event_version,event_type,reason_code,actor_practitioner_public_id,
      actor_user_public_id,actor_system_key,occurred_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId, value.publicId, value.setPublicId, value.fromStatus,
    value.toStatus, value.eventVersion, value.eventType, value.reasonCode,
    value.practitioner, value.actorUser, value.actorSystem, value.occurredAt,
    value.evidenceHash,
  );
}

describe('canonical patient vital measurement schema', () => {
  it('reserves migration 0556, a dedicated Drizzle module, and the Canonical barrel export', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(barrelPath)).toBe(true);
    if (!existsSync(schemaPath) || !existsSync(barrelPath)) return;
    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    for (const table of tables) expect(schema).toContain(`'${table}'`);
    expect(barrel).toContain("export * from './vital-observations';");
  });

  it('creates exactly three new vital authority table families', () => {
    const db = createDatabase();
    try {
      const actual = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name LIKE 'canonical_vital_observation_%'
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(actual).toEqual(tables);
    } finally { db.close(); }
  });

  it('enforces patient/encounter/practitioner scope, pending-review insertion, device pairing, and time order', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertSet(db);
      expect(() => insertSet(db, {
        publicId: 'vital-set-bad-scope', idempotencyKey: 'vital-set-bad-scope',
        encounter: 'encounter-202',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertSet(db, {
        publicId: 'vital-set-direct-verified', idempotencyKey: 'vital-set-direct-verified',
        reviewStatus: 'verified',
      })).toThrow(/must start pending_review/i);
      expect(() => insertSet(db, {
        publicId: 'vital-set-device-pair', idempotencyKey: 'vital-set-device-pair',
        sourceKind: 'device_imported', practitioner: null, deviceType: 'wearable', deviceId: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertSet(db, {
        publicId: 'vital-set-bad-time', idempotencyKey: 'vital-set-bad-time',
        recordedAt: '2026-07-28T08:59:00.000Z',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertSet(db, {
        publicId: 'vital-set-patient-reported', idempotencyKey: 'vital-set-patient-reported',
        sourceKind: 'patient_reported', practitioner: null, actorSystem: 'patient.portal',
      })).not.toThrow();
    } finally { db.close(); }
  });

  it('enforces exact code/unit/value rules, paired source values, and derived BMI evidence', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertSet(db);
      insertComponent(db);
      expect(() => insertComponent(db, {
        publicId: 'component-bad-unit', sequence: 2, measurementCode: 'body_temperature',
        numericValue: 37, canonicalUnit: 'degF',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertComponent(db, {
        publicId: 'component-bad-spo2', sequence: 2, measurementCode: 'oxygen_saturation',
        numericValue: 101, canonicalUnit: '%',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertComponent(db, {
        publicId: 'component-source-pair', sequence: 2, measurementCode: 'body_temperature',
        numericValue: 37, canonicalUnit: 'Cel', sourceNumericValue: 98.6, sourceUnit: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertComponent(db, {
        publicId: 'component-manual-bmi', sequence: 2, measurementCode: 'body_mass_index',
        numericValue: 24, canonicalUnit: 'kg/m2', isDerived: 0,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertComponent(db, {
        publicId: 'component-derived-bmi', sequence: 2, measurementCode: 'body_mass_index',
        numericValue: 24, canonicalUnit: 'kg/m2', isDerived: 1,
        formulaKey: 'bmi_weight_kg_height_m_v1', formulaVersion: '1',
      })).not.toThrow();
    } finally { db.close(); }
  });

  it('requires status events and component completeness before verification, including paired blood pressure', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertSet(db);
      insertComponent(db, {
        publicId: 'bp-systolic', measurementCode: 'blood_pressure_systolic',
        numericValue: 120, canonicalUnit: 'mm[Hg]',
      });
      expect(() => db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='verified',status_version=2
        WHERE tenant_id='tenant-a' AND observation_set_public_id='vital-set-101'
      `).run()).toThrow(/matching status event|paired blood pressure/i);
      insertEvent(db);
      expect(() => db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='verified',status_version=2
        WHERE tenant_id='tenant-a' AND observation_set_public_id='vital-set-101'
      `).run()).toThrow(/paired blood pressure/i);
      insertComponent(db, {
        publicId: 'bp-diastolic', sequence: 2, measurementCode: 'blood_pressure_diastolic',
        numericValue: 80, canonicalUnit: 'mm[Hg]',
      });
      expect(() => db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='verified',status_version=2,updated_at_utc='2026-07-28T09:02:00.000Z'
        WHERE tenant_id='tenant-a' AND observation_set_public_id='vital-set-101'
      `).run()).not.toThrow();
    } finally { db.close(); }
  });

  it('keeps components/events immutable, forbids hard delete, and enforces one replacement lineage', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertSet(db);
      insertComponent(db);
      insertEvent(db);
      db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='verified',status_version=2,updated_at_utc='2026-07-28T09:02:00.000Z'
        WHERE tenant_id='tenant-a' AND observation_set_public_id='vital-set-101'
      `).run();
      expect(() => db.prepare(`UPDATE canonical_vital_observation_components SET numeric_value=81`).run())
        .toThrow(/immutable/i);
      expect(() => db.prepare(`DELETE FROM canonical_vital_observation_components`).run())
        .toThrow(/immutable|restricted/i);
      expect(() => db.prepare(`DELETE FROM canonical_vital_observation_status_events`).run())
        .toThrow(/immutable/i);
      expect(() => db.prepare(`DELETE FROM canonical_vital_observation_sets`).run())
        .toThrow(/restricted|delete/i);

      insertSet(db, {
        publicId: 'vital-set-102', idempotencyKey: 'vital-set-create-102',
        supersedes: 'vital-set-101', requestHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64),
      });
      expect(() => insertSet(db, {
        publicId: 'vital-set-103', idempotencyKey: 'vital-set-create-103',
        supersedes: 'vital-set-101', requestHash: 'c'.repeat(64), evidenceHash: 'd'.repeat(64),
      })).toThrow(/UNIQUE constraint failed/);
      insertEvent(db, {
        publicId: 'vital-event-101-v3', fromStatus: 'verified', toStatus: 'superseded',
        eventVersion: 3, eventType: 'superseded', reasonCode: 'corrected',
        occurredAt: '2026-07-28T09:03:00.000Z', evidenceHash: 'e'.repeat(64),
      });
      expect(() => db.prepare(`
        UPDATE canonical_vital_observation_sets
        SET review_status='superseded',status_version=3,updated_at_utc='2026-07-28T09:03:00.000Z'
        WHERE tenant_id='tenant-a' AND observation_set_public_id='vital-set-101'
      `).run()).not.toThrow();
    } finally { db.close(); }
  });
});
