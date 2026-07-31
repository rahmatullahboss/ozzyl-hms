import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0554_canonical_prescription_medication_intent.sql';
const schemaPath = 'src/db/schema/canonical/medication.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';
const sourceRegistryPath = 'docs/database/canonical-source-of-truth.yaml';
const authorityMatrixPath = 'docs/database/canonical-authority-matrix.yaml';
const zeroHash = '0'.repeat(64);

const tables = [
  'canonical_medication_order_status_events',
  'canonical_medication_orders',
  'canonical_prescription_safety_events',
  'canonical_prescription_versions',
  'canonical_prescriptions',
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

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table) as
    | { sql?: string }
    | undefined;
  return String(row?.sql ?? '').replace(/\s+/g, ' ');
}

function seedDependencies(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified','no_link_placeholder',?, ?,1)
  `).run('a'.repeat(64), '2026-07-27T08:00:00.000Z');

  db.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal','Doctor','active',1,?)
  `).run('b'.repeat(64));

  db.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-101',101,'patient-link-101',
      'outpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-27T08:30:00.000Z', 'c'.repeat(64));
}

function insertPrescription(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    prescriptionPublicId: 'prescription-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    prescribingPractitionerPublicId: 'practitioner-101',
    currentVersionPublicId: null,
    currentStatus: 'draft',
    statusVersion: 1,
    authoredAtUtc: '2026-07-27T09:00:00.000Z',
    finalizedAtUtc: null,
    cancelledAtUtc: null,
    idempotencyKey: 'prescription-create-101',
    requestFingerprintSha256: 'd'.repeat(64),
    sourceEvidenceSha256: zeroHash,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_prescriptions (
      tenant_id,prescription_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,current_version_public_id,current_status,
      status_version,authored_at_utc,finalized_at_utc,cancelled_at_utc,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId,
    value.prescriptionPublicId,
    value.patientLinkPublicId,
    value.encounterPublicId,
    value.prescribingPractitionerPublicId,
    value.currentVersionPublicId,
    value.currentStatus,
    value.statusVersion,
    value.authoredAtUtc,
    value.finalizedAtUtc,
    value.cancelledAtUtc,
    value.idempotencyKey,
    value.requestFingerprintSha256,
    value.sourceEvidenceSha256,
  );
}

function insertVersion(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    versionPublicId: 'prescription-version-101-v1',
    prescriptionPublicId: 'prescription-101',
    versionNumber: 1,
    supersedesVersionPublicId: null,
    versionStatus: 'draft',
    contentSha256: 'e'.repeat(64),
    signedSnapshotSha256: null,
    authoredAtUtc: '2026-07-27T09:00:00.000Z',
    finalizedAtUtc: null,
    authoringPractitionerPublicId: 'practitioner-101',
    signingPractitionerPublicId: null,
    actorUserPublicId: null,
    actorSystemKey: 'canonical.prescription.test',
    sourceEvidenceSha256: 'f'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_prescription_versions (
      tenant_id,version_public_id,prescription_public_id,version_number,
      supersedes_version_public_id,version_status,content_sha256,signed_snapshot_sha256,
      authored_at_utc,finalized_at_utc,authoring_practitioner_public_id,
      signing_practitioner_public_id,actor_user_public_id,actor_system_key,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId,
    value.versionPublicId,
    value.prescriptionPublicId,
    value.versionNumber,
    value.supersedesVersionPublicId,
    value.versionStatus,
    value.contentSha256,
    value.signedSnapshotSha256,
    value.authoredAtUtc,
    value.finalizedAtUtc,
    value.authoringPractitionerPublicId,
    value.signingPractitionerPublicId,
    value.actorUserPublicId,
    value.actorSystemKey,
    value.sourceEvidenceSha256,
  );
}

function insertMedicationOrder(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    tenantId: 'tenant-a',
    medicationOrderPublicId: 'medication-order-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    prescribingPractitionerPublicId: 'practitioner-101',
    prescriptionPublicId: 'prescription-101',
    prescriptionVersionPublicId: 'prescription-version-101-v1',
    medicationCodeSystem: null,
    medicationCode: null,
    medicationDisplay: 'Protected medication display',
    genericDisplay: null,
    strengthSnapshot: null,
    doseText: 'Protected dose',
    routeCode: 'oral',
    frequencyCode: 'bid',
    durationText: 'Protected duration',
    instructionsText: 'Protected instructions',
    priority: 'routine',
    intendedStartUtc: '2026-07-27T09:00:00.000Z',
    intendedEndUtc: null,
    currentStatus: 'draft',
    statusVersion: 1,
    idempotencyKey: 'medication-order-create-101',
    requestFingerprintSha256: '1'.repeat(64),
    sourceEvidenceSha256: '2'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_medication_orders (
      tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,prescription_public_id,prescription_version_public_id,
      medication_code_system,medication_code,medication_display,generic_display,
      strength_snapshot,dose_text,route_code,frequency_code,duration_text,instructions_text,
      priority,intended_start_utc,intended_end_utc,current_status,status_version,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.tenantId,
    value.medicationOrderPublicId,
    value.patientLinkPublicId,
    value.encounterPublicId,
    value.prescribingPractitionerPublicId,
    value.prescriptionPublicId,
    value.prescriptionVersionPublicId,
    value.medicationCodeSystem,
    value.medicationCode,
    value.medicationDisplay,
    value.genericDisplay,
    value.strengthSnapshot,
    value.doseText,
    value.routeCode,
    value.frequencyCode,
    value.durationText,
    value.instructionsText,
    value.priority,
    value.intendedStartUtc,
    value.intendedEndUtc,
    value.currentStatus,
    value.statusVersion,
    value.idempotencyKey,
    value.requestFingerprintSha256,
    value.sourceEvidenceSha256,
  );
}

describe('canonical prescription medication-intent schema', () => {
  it('reserves migration 0554, Drizzle module, barrel export, and governance registrations', () => {
    for (const file of [migrationPath, schemaPath, barrelPath, sourceRegistryPath, authorityMatrixPath]) {
      expect(existsSync(file)).toBe(true);
    }
    if (![migrationPath, schemaPath, barrelPath, sourceRegistryPath, authorityMatrixPath].every(existsSync)) return;

    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    const registry = readFileSync(sourceRegistryPath, 'utf8');
    const matrix = readFileSync(authorityMatrixPath, 'utf8');
    for (const table of tables) {
      expect(schema).toContain(`'${table}'`);
      expect(registry).toContain(`"name": "${table}"`);
      expect(matrix).toContain(`"${table}"`);
    }
    expect(barrel).toContain("export * from './medication';");
    expect(matrix).toContain('"id": "prescription_medication_intent"');
    expect(matrix).toContain('"status": "partial_canonical"');
  });

  it('creates exactly five additive canonical prescription and medication-intent tables', () => {
    const db = createDatabase();
    try {
      const actual = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table'
          AND name IN (
            'canonical_prescriptions','canonical_prescription_versions',
            'canonical_medication_orders','canonical_medication_order_status_events',
            'canonical_prescription_safety_events'
          )
        ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(actual).toEqual(tables);

      const forbidden = new Set([
        'patient_name', 'patient_phone', 'phone', 'email', 'doctor_name', 'password',
        'diagnosis', 'advice', 'chief_complaint', 'bp', 'temperature', 'weight', 'spo2',
        'dispensed_qty', 'sale_id', 'payment_id', 'invoice_id', 'stock_quantity',
      ]);
      for (const table of actual) {
        const columns = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{
          name: string;
          type: string;
        }>;
        expect(columns.some((column) => forbidden.has(column.name))).toBe(false);
        expect(columns.some((column) => column.type.toUpperCase() === 'REAL')).toBe(false);
        expect(columns.some((column) => column.name === 'tenant_id' && column.type.toUpperCase() === 'TEXT')).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('enforces tenant-scoped patient, encounter, practitioner, status, lifecycle, and SHA-256 prescription constraints', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertPrescription(db);
      const sql = tableSql(db, 'canonical_prescriptions');
      for (const status of ['draft', 'final', 'amended', 'cancelled', 'entered_in_error']) {
        expect(sql).toContain(`'${status}'`);
      }
      expect(sql).toContain('status_version > 0');
      expect(sql).toContain('length(request_fingerprint_sha256) = 64');
      expect(sql).toContain('length(source_evidence_sha256) = 64');
      expect(sql).toContain('ON DELETE RESTRICT');

      expect(() => insertPrescription(db, {
        prescriptionPublicId: 'prescription-bad-patient',
        idempotencyKey: 'prescription-bad-patient',
        patientLinkPublicId: 'missing-patient-link',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertPrescription(db, {
        prescriptionPublicId: 'prescription-bad-encounter',
        idempotencyKey: 'prescription-bad-encounter',
        encounterPublicId: 'missing-encounter',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertPrescription(db, {
        prescriptionPublicId: 'prescription-bad-practitioner',
        idempotencyKey: 'prescription-bad-practitioner',
        prescribingPractitionerPublicId: 'missing-practitioner',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertPrescription(db, {
        prescriptionPublicId: 'prescription-bad-final',
        idempotencyKey: 'prescription-bad-final',
        currentStatus: 'final',
        finalizedAtUtc: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertPrescription(db, {
        prescriptionPublicId: 'prescription-bad-hash',
        idempotencyKey: 'prescription-bad-hash',
        sourceEvidenceSha256: 'A'.repeat(64),
      })).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces immutable version identity, status/signature lifecycle, actor, and supersession lineage', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertPrescription(db);
      insertVersion(db);
      db.prepare(`
        UPDATE canonical_prescriptions
        SET current_version_public_id = 'prescription-version-101-v1'
        WHERE tenant_id='tenant-a' AND prescription_public_id='prescription-101'
      `).run();

      expect(() => insertVersion(db, {
        versionPublicId: 'prescription-version-duplicate-number',
        contentSha256: '3'.repeat(64),
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertVersion(db, {
        versionPublicId: 'prescription-version-final-without-signature',
        versionNumber: 2,
        versionStatus: 'final',
        contentSha256: '4'.repeat(64),
        finalizedAtUtc: '2026-07-27T09:10:00.000Z',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertVersion(db, {
        versionPublicId: 'prescription-version-no-actor',
        versionNumber: 2,
        contentSha256: '5'.repeat(64),
        actorSystemKey: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertVersion(db, {
        versionPublicId: 'prescription-version-cross-tenant',
        tenantId: 'tenant-b',
        versionNumber: 2,
        contentSha256: '6'.repeat(64),
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => db.prepare(`
        UPDATE canonical_prescriptions
        SET current_version_public_id = 'missing-version'
        WHERE tenant_id='tenant-a' AND prescription_public_id='prescription-101'
      `).run()).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces medication-order source scope, clinical identities, vocabulary, interval, and no fulfilment authority', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertPrescription(db);
      insertVersion(db);
      insertMedicationOrder(db);
      const sql = tableSql(db, 'canonical_medication_orders');
      for (const status of ['draft', 'active', 'on_hold', 'completed', 'stopped', 'cancelled', 'entered_in_error']) {
        expect(sql).toContain(`'${status}'`);
      }
      for (const priority of ['routine', 'urgent', 'stat', 'prn']) expect(sql).toContain(`'${priority}'`);
      expect(sql).toContain('prescription_public_id IS NULL AND prescription_version_public_id IS NULL');
      expect(sql).toContain('intended_end_utc >= intended_start_utc');
      expect(sql).not.toContain('sale_id');
      expect(sql).not.toContain('payment_id');
      expect(sql).not.toContain('dispensed_qty');

      expect(() => insertMedicationOrder(db, {
        medicationOrderPublicId: 'medication-order-bad-version-scope',
        idempotencyKey: 'medication-order-bad-version-scope',
        prescriptionVersionPublicId: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertMedicationOrder(db, {
        medicationOrderPublicId: 'medication-order-bad-code-pair',
        idempotencyKey: 'medication-order-bad-code-pair',
        medicationCodeSystem: 'local-formulary',
        medicationCode: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertMedicationOrder(db, {
        medicationOrderPublicId: 'medication-order-bad-interval',
        idempotencyKey: 'medication-order-bad-interval',
        intendedEndUtc: '2026-07-27T08:59:59.000Z',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertMedicationOrder(db, {
        medicationOrderPublicId: 'medication-order-cross-patient',
        idempotencyKey: 'medication-order-cross-patient',
        patientLinkPublicId: 'missing-patient-link',
      })).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      db.close();
    }
  });

  it('enforces append-only medication lifecycle and prescription safety event identities and actor evidence', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertPrescription(db);
      insertVersion(db);
      insertMedicationOrder(db);

      const orderEvent = db.prepare(`
        INSERT INTO canonical_medication_order_status_events (
          tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
          event_version,reason_code,actor_practitioner_public_id,actor_user_public_id,
          actor_system_key,idempotency_key,source_evidence_sha256,occurred_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      orderEvent.run(
        'tenant-a','medication-order-event-101','medication-order-101','draft','active',
        1,'prescription_finalized','practitioner-101',null,null,
        'medication-order-event-idem-101','7'.repeat(64),'2026-07-27T09:10:00.000Z',
      );
      expect(() => orderEvent.run(
        'tenant-a','medication-order-event-duplicate','medication-order-101','active','on_hold',
        1,'clinical_hold','practitioner-101',null,null,
        'medication-order-event-idem-102','8'.repeat(64),'2026-07-27T09:20:00.000Z',
      )).toThrow(/UNIQUE constraint failed/);
      expect(() => orderEvent.run(
        'tenant-a','medication-order-event-no-actor','medication-order-101','active','on_hold',
        2,'clinical_hold',null,null,null,
        'medication-order-event-idem-103','8'.repeat(64),'2026-07-27T09:20:00.000Z',
      )).toThrow(/CHECK constraint failed/);

      const safetyEvent = db.prepare(`
        INSERT INTO canonical_prescription_safety_events (
          tenant_id,event_public_id,prescription_public_id,prescription_version_public_id,
          medication_order_public_id,event_type,outcome,severity,evidence_code,
          actor_practitioner_public_id,actor_user_public_id,actor_system_key,
          idempotency_key,source_evidence_sha256,occurred_at_utc
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      safetyEvent.run(
        'tenant-a','prescription-safety-101','prescription-101','prescription-version-101-v1',
        'medication-order-101','allergy_check','passed','none','no_known_conflict',
        'practitioner-101',null,null,'prescription-safety-idem-101','9'.repeat(64),
        '2026-07-27T09:05:00.000Z',
      );
      expect(() => safetyEvent.run(
        'tenant-a','prescription-safety-override-no-practitioner','prescription-101','prescription-version-101-v1',
        'medication-order-101','override','overridden','high','reviewed_override',
        null,null,'canonical.safety.system','prescription-safety-idem-102','a'.repeat(64),
        '2026-07-27T09:06:00.000Z',
      )).toThrow(/CHECK constraint failed/);
      expect(() => safetyEvent.run(
        'tenant-a','prescription-safety-bad-outcome','prescription-101','prescription-version-101-v1',
        'medication-order-101','override','passed','high','reviewed_override',
        'practitioner-101',null,null,'prescription-safety-idem-103','a'.repeat(64),
        '2026-07-27T09:06:00.000Z',
      )).toThrow(/CHECK constraint failed/);
    } finally {
      db.close();
    }
  });
});
