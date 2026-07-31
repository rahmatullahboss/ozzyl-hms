import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0557_canonical_medication_administration.sql';
const schemaPath = 'src/db/schema/canonical/medication-administration.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';

const tables = [
  'canonical_medication_administration_events',
  'canonical_medication_reconciliation_items',
  'canonical_medication_reconciliation_status_events',
  'canonical_medication_reconciliation_versions',
  'canonical_medication_reconciliations',
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
    'migrations/0554_canonical_prescription_medication_intent.sql',
    'migrations/0556_canonical_patient_vital_measurement.sql',
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
  for (const [practitioner, name, hash] of [
    ['practitioner-101', 'Prescriber', '3'],
    ['practitioner-102', 'Administering nurse', '4'],
    ['practitioner-103', 'Reconciliation reviewer', '5'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256
      ) VALUES ('tenant-a',?,'internal',?,'active',1,?)
    `).run(practitioner, name, hash.repeat(64));
  }
  for (const [encounter, patient, legacy, hash] of [
    ['encounter-101', 'patient-link-101', 101, '6'],
    ['encounter-202', 'patient-link-202', 202, '7'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES ('tenant-a',?,?,?,'inpatient','in_progress',1,'runtime',?,?)
    `).run(encounter, legacy, patient, '2026-07-28T08:00:00.000Z', hash.repeat(64));
  }

  db.prepare(`
    INSERT INTO canonical_medication_orders (
      tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,medication_display,dose_text,route_code,
      frequency_code,priority,intended_start_utc,current_status,status_version,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a','med-order-101','patient-link-101','encounter-101',
              'practitioner-101','Ceftriaxone','1 g','IV','OD','routine',?,
              'active',2,'seed-med-order-101',?,?)
  `).run('2026-07-28T08:30:00.000Z', '8'.repeat(64), '9'.repeat(64));
  db.prepare(`
    INSERT INTO canonical_medication_order_status_events (
      tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
      event_version,reason_code,actor_practitioner_public_id,actor_system_key,
      idempotency_key,source_evidence_sha256,occurred_at_utc
    ) VALUES
      ('tenant-a','med-order-event-101-v1','med-order-101',NULL,'draft',1,'created',
       'practitioner-101','schema.test','seed-med-order-event-v1',?,?),
      ('tenant-a','med-order-event-101-v2','med-order-101','draft','active',2,'activated',
       'practitioner-101','schema.test','seed-med-order-event-v2',?,?)
  `).run(
    'a'.repeat(64), '2026-07-28T08:30:00.000Z',
    'b'.repeat(64), '2026-07-28T08:31:00.000Z',
  );
}

function insertAdministration(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    publicId: 'administration-101',
    eventKind: 'administration',
    orderId: 'med-order-101',
    orderVersion: 2,
    patientLink: 'patient-link-101',
    encounter: 'encounter-101',
    practitioner: 'practitioner-102',
    actorUser: null,
    actorSystem: 'schema.test',
    scheduledAt: '2026-07-28T09:00:00.000Z',
    occurredAt: '2026-07-28T09:03:00.000Z',
    recordedAt: '2026-07-28T09:04:00.000Z',
    lateReason: null,
    outcome: 'given',
    doseValue: '1',
    doseUnit: 'g',
    route: 'IV',
    site: 'left_arm',
    method: null,
    reason: null,
    dispenseType: null,
    dispenseId: null,
    lotType: null,
    lotId: null,
    barcodeType: null,
    barcodeId: null,
    deviceType: null,
    deviceId: null,
    supersedes: null,
    idempotencyKey: 'administration-create-101',
    requestHash: 'c'.repeat(64),
    evidenceHash: 'd'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_medication_administration_events (
      tenant_id,administration_event_public_id,event_kind,medication_order_public_id,
      medication_order_status_version,patient_link_public_id,encounter_public_id,
      administering_practitioner_public_id,actor_user_public_id,actor_system_key,
      scheduled_at_utc,occurred_at_utc,recorded_at_utc,late_entry_reason_code,
      outcome_code,administered_dose_value_decimal,administered_dose_unit_code,
      route_code,site_code,method_code,reason_code,dispense_source_type,
      dispense_source_public_id,lot_source_type,lot_source_public_id,
      barcode_source_type,barcode_source_public_id,device_source_type,
      device_source_public_id,supersedes_administration_event_public_id,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'tenant-a', value.publicId, value.eventKind, value.orderId, value.orderVersion,
    value.patientLink, value.encounter, value.practitioner, value.actorUser,
    value.actorSystem, value.scheduledAt, value.occurredAt, value.recordedAt,
    value.lateReason, value.outcome, value.doseValue, value.doseUnit, value.route,
    value.site, value.method, value.reason, value.dispenseType, value.dispenseId,
    value.lotType, value.lotId, value.barcodeType, value.barcodeId,
    value.deviceType, value.deviceId, value.supersedes, value.idempotencyKey,
    value.requestHash, value.evidenceHash,
  );
}

function insertReconciliationHeader(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    publicId: 'reconciliation-101',
    patientLink: 'patient-link-101',
    encounter: 'encounter-101',
    type: 'discharge',
    currentVersion: null,
    status: 'draft',
    statusVersion: 1,
    creator: 'practitioner-103',
    actorUser: null,
    actorSystem: 'schema.test',
    idempotencyKey: 'reconciliation-create-101',
    requestHash: 'e'.repeat(64),
    evidenceHash: 'f'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_medication_reconciliations (
      tenant_id,reconciliation_public_id,patient_link_public_id,encounter_public_id,
      reconciliation_type,current_version_public_id,current_status,status_version,
      creating_practitioner_public_id,actor_user_public_id,actor_system_key,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'tenant-a', value.publicId, value.patientLink, value.encounter, value.type,
    value.currentVersion, value.status, value.statusVersion, value.creator,
    value.actorUser, value.actorSystem, value.idempotencyKey, value.requestHash,
    value.evidenceHash,
  );
}

function insertReconciliationVersion(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    versionId: 'reconciliation-version-101-v1',
    reconciliationId: 'reconciliation-101',
    versionNumber: 1,
    supersedes: null,
    versionStatus: 'draft',
    sourceSummaryHash: '1'.repeat(64),
    contentHash: '2'.repeat(64),
    signedContentHash: null,
    author: 'practitioner-103',
    finalizer: null,
    actorUser: null,
    actorSystem: 'schema.test',
    createdAt: '2026-07-28T10:00:00.000Z',
    finalizedAt: null,
    evidenceHash: '3'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_medication_reconciliation_versions (
      tenant_id,version_public_id,reconciliation_public_id,version_number,
      supersedes_version_public_id,version_status,source_summary_sha256,
      content_sha256,signed_content_sha256,authoring_practitioner_public_id,
      finalizing_practitioner_public_id,actor_user_public_id,actor_system_key,
      authored_at_utc,finalized_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'tenant-a', value.versionId, value.reconciliationId, value.versionNumber,
    value.supersedes, value.versionStatus, value.sourceSummaryHash,
    value.contentHash, value.signedContentHash, value.author, value.finalizer,
    value.actorUser, value.actorSystem, value.createdAt, value.finalizedAt,
    value.evidenceHash,
  );
}

function insertReconciliationItem(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    publicId: 'reconciliation-item-101',
    reconciliationId: 'reconciliation-101',
    versionId: 'reconciliation-version-101-v1',
    sequence: 1,
    sourceKind: 'inpatient',
    decision: 'continue',
    prescriptionId: null,
    prescriptionVersionId: null,
    medicationOrderId: 'med-order-101',
    medicationSnapshot: 'Ceftriaxone',
    priorDose: '1 g',
    priorRoute: 'IV',
    priorFrequency: 'OD',
    proposedDose: null,
    proposedRoute: null,
    proposedFrequency: null,
    reason: 'continue_on_discharge',
    evidenceHash: '4'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_medication_reconciliation_items (
      tenant_id,item_public_id,reconciliation_public_id,version_public_id,
      item_sequence,source_kind,decision_code,prescription_public_id,
      prescription_version_public_id,medication_order_public_id,
      medication_description_snapshot,prior_dose_snapshot,prior_route_snapshot,
      prior_frequency_snapshot,proposed_dose_snapshot,proposed_route_snapshot,
      proposed_frequency_snapshot,reason_code,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'tenant-a', value.publicId, value.reconciliationId, value.versionId,
    value.sequence, value.sourceKind, value.decision, value.prescriptionId,
    value.prescriptionVersionId, value.medicationOrderId,
    value.medicationSnapshot, value.priorDose, value.priorRoute,
    value.priorFrequency, value.proposedDose, value.proposedRoute,
    value.proposedFrequency, value.reason, value.evidenceHash,
  );
}

function insertReconciliationEvent(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    publicId: 'reconciliation-event-101-v2',
    reconciliationId: 'reconciliation-101',
    versionId: 'reconciliation-version-101-v1',
    fromStatus: 'draft',
    toStatus: 'final',
    eventVersion: 2,
    eventType: 'finalized',
    reason: 'clinician_finalized',
    practitioner: 'practitioner-103',
    actorUser: null,
    actorSystem: 'schema.test',
    occurredAt: '2026-07-28T10:05:00.000Z',
    evidenceHash: '5'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_medication_reconciliation_status_events (
      tenant_id,event_public_id,reconciliation_public_id,version_public_id,
      from_status,to_status,event_version,event_type,reason_code,
      actor_practitioner_public_id,actor_user_public_id,actor_system_key,
      occurred_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'tenant-a', value.publicId, value.reconciliationId, value.versionId,
    value.fromStatus, value.toStatus, value.eventVersion, value.eventType,
    value.reason, value.practitioner, value.actorUser, value.actorSystem,
    value.occurredAt, value.evidenceHash,
  );
}

describe('canonical medication administration and reconciliation schema', () => {
  it('reserves migration 0557, a dedicated Drizzle module, and the Canonical barrel export', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(existsSync(barrelPath)).toBe(true);
    if (!existsSync(schemaPath) || !existsSync(barrelPath)) return;
    const schema = readFileSync(schemaPath, 'utf8');
    const barrel = readFileSync(barrelPath, 'utf8');
    for (const table of tables) expect(schema).toContain(`'${table}'`);
    expect(barrel).toContain("export * from './medication-administration';");
  });

  it('creates exactly five new medication administration and reconciliation table families', () => {
    const db = createDatabase();
    try {
      const actual = (db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND (
          name='canonical_medication_administration_events'
          OR name LIKE 'canonical_medication_reconciliation%'
        ) ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      expect(actual).toEqual(tables);
    } finally { db.close(); }
  });

  it('enforces exact medication-order version, patient/encounter/practitioner scope, actor evidence, and time order', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      expect(() => insertAdministration(db)).not.toThrow();
      expect(() => insertAdministration(db, {
        publicId: 'administration-bad-version',
        orderVersion: 3,
        idempotencyKey: 'administration-bad-version',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-bad-patient',
        patientLink: 'patient-link-202',
        encounter: 'encounter-202',
        idempotencyKey: 'administration-bad-patient',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-no-actor',
        actorSystem: null,
        idempotencyKey: 'administration-no-actor',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-bad-time',
        recordedAt: '2026-07-28T09:02:00.000Z',
        lateReason: null,
        idempotencyKey: 'administration-bad-time',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-late-entry',
        recordedAt: '2026-07-28T09:02:00.000Z',
        lateReason: 'clock_correction',
        idempotencyKey: 'administration-late-entry',
      })).not.toThrow();
    } finally { db.close(); }
  });

  it('enforces outcome-specific decimal dose, unit, route, and reason rules plus paired provenance identities', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      expect(() => insertAdministration(db, {
        publicId: 'administration-given-no-route',
        route: null,
        idempotencyKey: 'administration-given-no-route',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-given-bad-decimal',
        doseValue: '1e3',
        idempotencyKey: 'administration-given-bad-decimal',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-withheld-no-reason',
        outcome: 'withheld',
        doseValue: null,
        doseUnit: null,
        route: null,
        reason: null,
        idempotencyKey: 'administration-withheld-no-reason',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertAdministration(db, {
        publicId: 'administration-refused',
        outcome: 'refused',
        doseValue: null,
        doseUnit: null,
        route: null,
        site: null,
        reason: 'patient_refused',
        idempotencyKey: 'administration-refused',
      })).not.toThrow();
      expect(() => insertAdministration(db, {
        publicId: 'administration-bad-source-pair',
        dispenseType: 'pharmacy_dispense',
        dispenseId: null,
        idempotencyKey: 'administration-bad-source-pair',
      })).toThrow(/CHECK constraint failed/);
    } finally { db.close(); }
  });

  it('keeps administration history immutable and enforces one same-scope replacement or error event', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertAdministration(db);
      expect(() => insertAdministration(db, {
        publicId: 'administration-cross-scope-correction',
        eventKind: 'correction',
        patientLink: 'patient-link-202',
        encounter: 'encounter-202',
        supersedes: 'administration-101',
        idempotencyKey: 'administration-cross-scope-correction',
      })).toThrow(/FOREIGN KEY constraint failed/);
      insertAdministration(db, {
        publicId: 'administration-102',
        eventKind: 'correction',
        outcome: 'given',
        doseValue: '0.5',
        supersedes: 'administration-101',
        idempotencyKey: 'administration-correction-101',
      });
      expect(() => insertAdministration(db, {
        publicId: 'administration-103',
        eventKind: 'correction',
        supersedes: 'administration-101',
        idempotencyKey: 'administration-second-correction-101',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`
        UPDATE canonical_medication_administration_events
        SET administered_dose_value_decimal='2'
        WHERE administration_event_public_id='administration-101'
      `).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`
        DELETE FROM canonical_medication_administration_events
        WHERE administration_event_public_id='administration-101'
      `).run()).toThrow(/immutable|restricted/i);
    } finally { db.close(); }
  });

  it('allows one-time draft current-version pointer initialization only with matching draft-created evidence', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertReconciliationHeader(db);
      insertReconciliationVersion(db);
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliations
        SET current_version_public_id='reconciliation-version-101-v1'
        WHERE reconciliation_public_id='reconciliation-101'
      `).run()).toThrow(/matching status event|invalid canonical medication reconciliation status transition/i);
      insertReconciliationEvent(db, {
        publicId: 'reconciliation-event-101-v1',
        fromStatus: null,
        toStatus: 'draft',
        eventVersion: 1,
        eventType: 'draft_created',
        reason: 'draft_created',
      });
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliations
        SET current_version_public_id='reconciliation-version-101-v1',
            updated_at_utc='2026-07-28T10:00:00.000Z'
        WHERE reconciliation_public_id='reconciliation-101'
      `).run()).not.toThrow();
    } finally { db.close(); }
  });

  it('enforces reconciliation patient/encounter scope, immutable versions/items, final signature parity, and controlled status transitions', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      expect(() => insertReconciliationHeader(db)).not.toThrow();
      expect(() => insertReconciliationHeader(db, {
        publicId: 'reconciliation-bad-scope',
        patientLink: 'patient-link-202',
        encounter: 'encounter-101',
        idempotencyKey: 'reconciliation-bad-scope',
      })).toThrow(/FOREIGN KEY constraint failed/);
      insertReconciliationVersion(db);
      insertReconciliationItem(db);
      expect(() => insertReconciliationItem(db, {
        publicId: 'reconciliation-item-bad-order',
        sequence: 2,
        medicationOrderId: 'missing-order',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliation_versions
        SET content_sha256=? WHERE version_public_id='reconciliation-version-101-v1'
      `).run('9'.repeat(64))).toThrow(/immutable/i);
      expect(() => db.prepare(`
        DELETE FROM canonical_medication_reconciliation_items
        WHERE item_public_id='reconciliation-item-101'
      `).run()).toThrow(/immutable/i);

      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliation_versions
        SET version_status='final',signed_content_sha256=?,
            finalizing_practitioner_public_id='practitioner-103',
            finalized_at_utc='2026-07-28T10:05:00.000Z'
        WHERE version_public_id='reconciliation-version-101-v1'
      `).run('8'.repeat(64))).toThrow(/matching status event|content hash/i);

      insertReconciliationEvent(db);
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliation_versions
        SET version_status='final',signed_content_sha256=content_sha256,
            finalizing_practitioner_public_id='practitioner-103',
            finalized_at_utc='2026-07-28T10:05:00.000Z'
        WHERE version_public_id='reconciliation-version-101-v1'
      `).run()).not.toThrow();
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliations
        SET current_version_public_id='reconciliation-version-101-v1',
            current_status='final',status_version=2,
            updated_at_utc='2026-07-28T10:05:00.000Z'
        WHERE reconciliation_public_id='reconciliation-101'
      `).run()).not.toThrow();
      expect(db.prepare(`
        SELECT current_status,status_version,current_version_public_id
        FROM canonical_medication_reconciliations
        WHERE reconciliation_public_id='reconciliation-101'
      `).get()).toEqual({
        current_status: 'final',
        status_version: 2,
        current_version_public_id: 'reconciliation-version-101-v1',
      });
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliation_items
        SET decision_code='modify'
        WHERE item_public_id='reconciliation-item-101'
      `).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`
        UPDATE canonical_medication_reconciliation_status_events
        SET reason_code='changed'
      `).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`
        DELETE FROM canonical_medication_reconciliations
        WHERE reconciliation_public_id='reconciliation-101'
      `).run()).toThrow(/restricted|delete/i);
    } finally { db.close(); }
  });
});
