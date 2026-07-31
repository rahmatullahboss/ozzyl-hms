import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0558_canonical_lab_result_specimen.sql';
const schemaPath = 'src/db/schema/canonical/lab-result-specimen.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    migrationPath,
  ]) db.exec(readFileSync(migration, 'utf8'));
  return db;
}

function seedDependencies(db: DatabaseSync): void {
  for (const [tenant, patientLink, patientId, hash] of [
    ['tenant-a', 'patient-link-101', 101, '1'],
    ['tenant-a', 'patient-link-202', 202, '2'],
    ['tenant-b', 'patient-link-301', 301, '3'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_tenant_patient_links (
        tenant_id,patient_link_public_id,legacy_patient_id,link_status,
        verification_level,evidence_type,evidence_sha256,effective_from_utc,version
      ) VALUES (?,?,?,'unlinked','unverified','no_link_placeholder',?,?,1)
    `).run(tenant, patientLink, patientId, hash.repeat(64), '2026-07-28T00:00:00.000Z');
  }
  for (const [tenant, practitioner, name, hash] of [
    ['tenant-a', 'practitioner-101', 'Collector', '4'],
    ['tenant-a', 'practitioner-102', 'Verifier', '5'],
    ['tenant-a', 'practitioner-103', 'Validator', '6'],
    ['tenant-b', 'practitioner-301', 'Other tenant', '7'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256
      ) VALUES (?,?,'internal',?,'active',1,?)
    `).run(tenant, practitioner, name, hash.repeat(64));
  }
  for (const [tenant, encounter, patientId, patientLink, hash] of [
    ['tenant-a', 'encounter-101', 101, 'patient-link-101', '8'],
    ['tenant-a', 'encounter-202', 202, 'patient-link-202', '9'],
    ['tenant-b', 'encounter-301', 301, 'patient-link-301', 'a'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?, 'outpatient','in_progress',1,'runtime',?,?)
    `).run(tenant, encounter, patientId, patientLink, '2026-07-28T08:00:00.000Z', hash.repeat(64));
  }
  for (const [tenant, service, code, name, hash] of [
    ['tenant-a', 'service-lab-101', 'LAB-CBC', 'CBC', 'b'],
    ['tenant-a', 'service-lab-202', 'LAB-CRP', 'CRP', 'c'],
    ['tenant-b', 'service-lab-301', 'LAB-B', 'Other lab', 'd'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,
        status,source_evidence_sha256
      ) VALUES (?,?,'laboratory',?,?,'test','active',?)
    `).run(tenant, service, code, name, hash.repeat(64));
  }
  for (const [tenant, request, patientId, encounter, service, hash] of [
    ['tenant-a', 'request-101', 101, 'encounter-101', 'service-lab-101', 'e'],
    ['tenant-a', 'request-202', 202, 'encounter-202', 'service-lab-202', 'f'],
    ['tenant-b', 'request-301', 301, 'encounter-301', 'service-lab-301', '0'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_service_requests (
        tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
        service_public_id,status,requested_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?,?,'fulfilled',?,?)
    `).run(tenant, request, patientId, encounter, service, '2026-07-28T08:10:00.000Z', hash.repeat(64));
    db.prepare(`
      INSERT INTO canonical_service_events (
        tenant_id,event_public_id,request_public_id,encounter_public_id,
        service_public_id,event_type,status,occurred_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?,?,'completed','posted',?,?)
    `).run(tenant, `${request}-event`, request, encounter, service, '2026-07-28T09:00:00.000Z', hash.repeat(64));
  }
}

function insertSpecimen(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    publicId: 'specimen-101',
    patientLink: 'patient-link-101',
    encounter: 'encounter-101',
    request: 'request-101',
    service: 'service-lab-101',
    accessionNamespace: 'tenant-lab',
    accessionValue: 'ACC-101',
    barcodeNamespace: 'tenant-lab',
    barcodeValue: 'BAR-101',
    specimenType: 'blood',
    container: 'edta',
    parent: null,
    actorUser: null,
    actorSystem: 'schema.test',
    idempotency: 'specimen-101-create',
    fingerprint: '1'.repeat(64),
    evidence: '2'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_lab_specimens (
      tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id,
      primary_request_public_id,primary_service_public_id,accession_namespace,
      accession_value,barcode_namespace,barcode_value,specimen_type_code,
      container_code,parent_specimen_public_id,current_status,status_version,
      actor_user_public_id,actor_system_key,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,?,?,?,?,?,?, 'registered',1,?,?,?,?,?,?,?)
  `).run(
    value.publicId, value.patientLink, value.encounter, value.request, value.service,
    value.accessionNamespace, value.accessionValue, value.barcodeNamespace,
    value.barcodeValue, value.specimenType, value.container, value.parent,
    value.actorUser, value.actorSystem, value.idempotency, value.fingerprint,
    value.evidence, '2026-07-28T09:00:00.000Z', '2026-07-28T09:00:00.000Z',
  );
}

function insertSpecimenEvent(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    eventId: 'specimen-event-101-v1',
    specimen: 'specimen-101',
    fromStatus: null,
    toStatus: 'registered',
    eventVersion: 1,
    eventType: 'registered',
    practitioner: 'practitioner-101',
    actorUser: null,
    actorSystem: 'schema.test',
    occurred: '2026-07-28T09:00:00.000Z',
    recorded: '2026-07-28T09:00:00.000Z',
    reason: 'registered',
    evidence: '3'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_lab_specimen_status_events (
      tenant_id,event_public_id,specimen_public_id,from_status,to_status,event_version,
      event_type,actor_practitioner_public_id,actor_user_public_id,actor_system_key,
      occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    value.eventId, value.specimen, value.fromStatus, value.toStatus, value.eventVersion,
    value.eventType, value.practitioner, value.actorUser, value.actorSystem,
    value.occurred, value.recorded, value.reason, value.evidence, value.recorded,
  );
}

function initialiseSpecimen(db: DatabaseSync): void {
  insertSpecimen(db);
  insertSpecimenEvent(db);
  db.prepare(`
    UPDATE canonical_lab_specimens
    SET current_status_event_public_id='specimen-event-101-v1'
    WHERE tenant_id='tenant-a' AND specimen_public_id='specimen-101'
  `).run();
}

function insertResultSet(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO canonical_lab_result_sets (
      tenant_id,result_set_public_id,patient_link_public_id,encounter_public_id,
      request_public_id,event_public_id,specimen_public_id,service_public_id,
      current_status,status_version,creating_practitioner_public_id,actor_system_key,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','result-set-101','patient-link-101','encounter-101',
              'request-101','request-101-event','specimen-101','service-lab-101',
              'draft',1,'practitioner-101','schema.test','result-set-create',?,?,?,?)
  `).run('4'.repeat(64), '5'.repeat(64), '2026-07-28T10:00:00.000Z', '2026-07-28T10:00:00.000Z');
}

function insertResultVersion(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    versionId: 'result-version-101-v1',
    versionNumber: 1,
    supersedes: null,
    versionKind: 'draft',
    contentHash: '6'.repeat(64),
    author: 'practitioner-101',
    reason: null,
    evidence: '7'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_lab_result_versions (
      tenant_id,version_public_id,result_set_public_id,version_number,
      supersedes_version_public_id,version_kind,version_status,content_sha256,
      authoring_practitioner_public_id,actor_system_key,authored_at_utc,
      reason_code,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,?,?, ?,?,'draft',?,?,'schema.test',?,?,?,?)
  `).run(
    value.versionId, 'result-set-101', value.versionNumber, value.supersedes,
    value.versionKind, value.contentHash, value.author,
    '2026-07-28T10:00:00.000Z', value.reason, value.evidence, '2026-07-28T10:00:00.000Z',
  );
}

function insertObservation(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    observationId: 'observation-101',
    sequence: 1,
    code: 'HB',
    valueType: 'decimal',
    valueText: null,
    valueDecimal: '13.5',
    valueCode: null,
    valueCodeSystem: null,
    valueBoolean: null,
    valueDateTime: null,
    unit: 'g/dL',
    referenceLow: '12',
    referenceHigh: '16',
    status: 'final',
    reason: null,
    evidence: '8'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_lab_result_observations (
      tenant_id,observation_public_id,result_set_public_id,version_public_id,
      observation_sequence,service_public_id,component_source_type,
      component_source_public_id,observation_code,code_system,display_snapshot,
      value_type,value_text,value_decimal,value_code,value_code_system,value_boolean,
      value_date_time_utc,unit_code,reference_low_decimal,reference_high_decimal,
      interpretation_code,specimen_public_id,observation_status,reason_code,
      source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,?,?,?, 'service-lab-101','legacy_lab_component','hb',
              ?,'local','Haemoglobin',?,?,?,?,?,?,?,?,?,?, 'normal','specimen-101',?,?,?,?)
  `).run(
    value.observationId, 'result-set-101', 'result-version-101-v1', value.sequence,
    value.code, value.valueType, value.valueText, value.valueDecimal, value.valueCode,
    value.valueCodeSystem, value.valueBoolean, value.valueDateTime, value.unit,
    value.referenceLow, value.referenceHigh, value.status, value.reason,
    value.evidence, '2026-07-28T10:01:00.000Z',
  );
}

function insertResultStatusEvent(
  db: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const value = {
    eventId: 'result-event-101-v1',
    versionId: 'result-version-101-v1',
    fromStatus: null,
    toStatus: 'draft',
    eventVersion: 1,
    eventType: 'draft_created',
    practitioner: 'practitioner-101',
    actorSystem: 'schema.test',
    signedHash: null,
    reason: 'draft_created',
    occurred: '2026-07-28T10:00:00.000Z',
    evidence: '9'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_lab_result_status_events (
      tenant_id,event_public_id,result_set_public_id,version_public_id,from_status,
      to_status,event_version,event_type,actor_practitioner_public_id,
      actor_system_key,signed_content_sha256,reason_code,occurred_at_utc,
      source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,'result-set-101',?,?,?,?,?,?,?, ?,?,?,?,?)
  `).run(
    value.eventId, value.versionId, value.fromStatus, value.toStatus,
    value.eventVersion, value.eventType, value.practitioner, value.actorSystem,
    value.signedHash, value.reason, value.occurred, value.evidence, value.occurred,
  );
}

function initialiseResult(db: DatabaseSync): void {
  initialiseSpecimen(db);
  insertResultSet(db);
  insertResultVersion(db);
  insertObservation(db);
  insertResultStatusEvent(db);
  db.prepare(`
    UPDATE canonical_lab_result_sets
    SET current_version_public_id='result-version-101-v1'
    WHERE tenant_id='tenant-a' AND result_set_public_id='result-set-101'
  `).run();
}

describe('canonical lab result and specimen schema', () => {
  it('reserves migration 0558, dedicated Drizzle module, and Canonical barrel export', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(readFileSync(barrelPath, 'utf8')).toContain("export * from './lab-result-specimen';");
  });

  it('creates exactly eight new lab specimen, result, status, observation, and analyzer table families', () => {
    const db = createDatabase();
    try {
      const tables = db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name GLOB 'canonical_lab_*'
        ORDER BY name
      `).all().map((row) => String((row as { name: string }).name));
      expect(tables).toEqual([
        'canonical_lab_analyzer_evidence',
        'canonical_lab_result_observations',
        'canonical_lab_result_sets',
        'canonical_lab_result_status_events',
        'canonical_lab_result_versions',
        'canonical_lab_specimen_service_items',
        'canonical_lab_specimen_status_events',
        'canonical_lab_specimens',
      ]);
    } finally { db.close(); }
  });

  it('enforces exact specimen patient, encounter, request, service, identifier, and parent scope', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertSpecimen(db);
      expect(() => insertSpecimen(db, {
        publicId: 'specimen-duplicate-accession', barcodeValue: 'BAR-OTHER',
        idempotency: 'specimen-duplicate-accession',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertSpecimen(db, {
        publicId: 'specimen-cross-scope', patientLink: 'patient-link-202',
        idempotency: 'specimen-cross-scope', accessionValue: 'ACC-202', barcodeValue: 'BAR-202',
      })).toThrow(/FOREIGN KEY constraint failed/);
      insertSpecimen(db, {
        publicId: 'specimen-202', patientLink: 'patient-link-202', encounter: 'encounter-202',
        request: 'request-202', service: 'service-lab-202', accessionValue: 'ACC-202',
        barcodeValue: 'BAR-202', idempotency: 'specimen-202',
      });
      expect(() => insertSpecimen(db, {
        publicId: 'specimen-bad-parent', parent: 'specimen-202', accessionValue: 'ACC-103',
        barcodeValue: 'BAR-103', idempotency: 'specimen-bad-parent',
      })).toThrow(/FOREIGN KEY constraint failed/);
    } finally { db.close(); }
  });

  it('requires immutable contiguous specimen custody events and controlled current-state transitions', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertSpecimen(db);
      expect(() => db.prepare(`
        UPDATE canonical_lab_specimens SET current_status_event_public_id='missing'
        WHERE specimen_public_id='specimen-101'
      `).run()).toThrow();
      insertSpecimenEvent(db);
      db.prepare(`UPDATE canonical_lab_specimens
        SET current_status_event_public_id='specimen-event-101-v1'
        WHERE specimen_public_id='specimen-101'`).run();
      insertSpecimenEvent(db, {
        eventId: 'specimen-event-101-v2', fromStatus: 'registered', toStatus: 'collected',
        eventVersion: 2, eventType: 'collected', occurred: '2026-07-28T09:05:00.000Z',
        recorded: '2026-07-28T09:06:00.000Z', reason: 'collected',
      });
      db.prepare(`
        UPDATE canonical_lab_specimens
        SET current_status='collected',status_version=2,
            current_status_event_public_id='specimen-event-101-v2',
            collected_at_utc='2026-07-28T09:05:00.000Z',
            updated_at_utc='2026-07-28T09:06:00.000Z'
        WHERE specimen_public_id='specimen-101'
      `).run();
      expect(() => insertSpecimenEvent(db, {
        eventId: 'specimen-event-gap', fromStatus: 'collected', toStatus: 'received',
        eventVersion: 4, eventType: 'received', reason: 'received',
      })).toThrow(/status event does not match current state|version/i);
      expect(() => db.prepare(`UPDATE canonical_lab_specimen_status_events
        SET reason_code='changed' WHERE event_public_id='specimen-event-101-v1'`).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`DELETE FROM canonical_lab_specimens
        WHERE specimen_public_id='specimen-101'`).run()).toThrow();
    } finally { db.close(); }
  });

  it('enforces exact specimen-to-request/event/service links', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseSpecimen(db);
      db.prepare(`
        INSERT INTO canonical_lab_specimen_service_items (
          tenant_id,link_public_id,specimen_public_id,request_public_id,event_public_id,
          service_public_id,relationship_role,source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','specimen-link-101','specimen-101','request-101',
                  'request-101-event','service-lab-101','primary',?,?)
      `).run('a'.repeat(64), '2026-07-28T09:01:00.000Z');
      expect(() => db.prepare(`
        INSERT INTO canonical_lab_specimen_service_items (
          tenant_id,link_public_id,specimen_public_id,request_public_id,event_public_id,
          service_public_id,relationship_role,source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','specimen-link-bad','specimen-101','request-202',
                  'request-202-event','service-lab-202','primary',?,?)
      `).run('b'.repeat(64), '2026-07-28T09:02:00.000Z')).toThrow(/FOREIGN KEY constraint failed/);
    } finally { db.close(); }
  });

  it('enforces exact result-set scope, immutable complete versions, deterministic observations, and decimal TEXT', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseResult(db);
      expect(() => insertObservation(db, {
        observationId: 'observation-bad-decimal', sequence: 2, valueDecimal: '1e3',
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertObservation(db, {
        observationId: 'observation-bad-shape', sequence: 2,
        valueType: 'text', valueText: 'positive', valueDecimal: '1', unit: null,
        referenceLow: null, referenceHigh: null,
      })).toThrow(/CHECK constraint failed/);
      expect(() => insertObservation(db, {
        observationId: 'observation-gap', sequence: 3, code: 'WBC', valueDecimal: '7.1',
      })).toThrow(/sequence/i);
      expect(() => db.prepare(`UPDATE canonical_lab_result_observations
        SET value_decimal='14' WHERE observation_public_id='observation-101'`).run()).toThrow(/immutable/i);
      insertResultVersion(db, {
        versionId: 'result-version-101-v2', versionNumber: 2,
        supersedes: 'result-version-101-v1', versionKind: 'correction',
        reason: 'corrected_result', contentHash: 'a'.repeat(64), evidence: 'b'.repeat(64),
      });
      expect(() => insertResultVersion(db, {
        versionId: 'result-version-101-v3', versionNumber: 3,
        supersedes: 'result-version-101-v1', versionKind: 'correction',
        reason: 'second_correction', contentHash: 'c'.repeat(64), evidence: 'd'.repeat(64),
      })).toThrow(/UNIQUE constraint failed/);
    } finally { db.close(); }
  });

  it('enforces signed verification/validation lifecycle and current-version ownership', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseResult(db);
      const contentHash = '6'.repeat(64);
      expect(() => insertResultStatusEvent(db, {
        eventId: 'result-event-bad-signature', fromStatus: 'draft', toStatus: 'verified',
        eventVersion: 2, eventType: 'verified', practitioner: 'practitioner-102',
        signedHash: '0'.repeat(64), reason: 'verified',
      })).toThrow(/signed content|CHECK constraint failed/i);
      insertResultStatusEvent(db, {
        eventId: 'result-event-101-v2', fromStatus: 'draft', toStatus: 'verified',
        eventVersion: 2, eventType: 'verified', practitioner: 'practitioner-102',
        signedHash: contentHash, reason: 'verified', occurred: '2026-07-28T10:05:00.000Z',
      });
      db.prepare(`
        UPDATE canonical_lab_result_versions
        SET version_status='verified',signed_content_sha256=?,
            verifying_practitioner_public_id='practitioner-102',
            verified_at_utc='2026-07-28T10:05:00.000Z'
        WHERE version_public_id='result-version-101-v1'
      `).run(contentHash);
      db.prepare(`
        UPDATE canonical_lab_result_sets
        SET current_status='verified',status_version=2,
            current_status_event_public_id='result-event-101-v2',
            updated_at_utc='2026-07-28T10:05:00.000Z'
        WHERE result_set_public_id='result-set-101'
      `).run();
      expect(db.prepare(`SELECT current_status,status_version FROM canonical_lab_result_sets`).get()).toEqual({
        current_status: 'verified', status_version: 2,
      });
      expect(() => db.prepare(`UPDATE canonical_lab_result_versions
        SET content_sha256=? WHERE version_public_id='result-version-101-v1'`).run('f'.repeat(64))).toThrow(/content is immutable|history is immutable/i);
    } finally { db.close(); }
  });

  it('enforces immutable exact analyzer evidence, source uniqueness, accepted observation ownership, and payload hashes', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseResult(db);
      db.prepare(`
        INSERT INTO canonical_lab_analyzer_evidence (
          tenant_id,analyzer_evidence_public_id,result_set_public_id,version_public_id,
          observation_public_id,source_type,source_public_id,ingestion_message_public_id,
          observation_index,machine_source_type,machine_source_public_id,protocol,
          payload_sha256,qc_state,validation_state,match_state,disposition,
          conversion_factor_decimal,actor_system_key,occurred_at_utc,
          source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','analyzer-evidence-101','result-set-101','result-version-101-v1',
                  'observation-101','lis_analyzer_inbox','inbox-101','message-101',0,
                  'legacy_lab_machine','machine-1','HL7',?,'passed','passed','matched',
                  'accepted','1','schema.test',?,?,?)
      `).run('a'.repeat(64), '2026-07-28T10:01:00.000Z', 'b'.repeat(64), '2026-07-28T10:01:00.000Z');
      expect(() => db.prepare(`
        INSERT INTO canonical_lab_analyzer_evidence (
          tenant_id,analyzer_evidence_public_id,result_set_public_id,version_public_id,
          observation_public_id,source_type,source_public_id,ingestion_message_public_id,
          observation_index,protocol,payload_sha256,qc_state,validation_state,
          match_state,disposition,actor_system_key,occurred_at_utc,
          source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','analyzer-evidence-duplicate','result-set-101','result-version-101-v1',
                  'observation-101','lis_analyzer_inbox','inbox-101','message-101',0,
                  'HL7',?,'passed','passed','matched','accepted','schema.test',?,?,?)
      `).run('c'.repeat(64), '2026-07-28T10:02:00.000Z', 'd'.repeat(64), '2026-07-28T10:02:00.000Z')).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`UPDATE canonical_lab_analyzer_evidence
        SET qc_state='failed' WHERE analyzer_evidence_public_id='analyzer-evidence-101'`).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`
        INSERT INTO canonical_lab_analyzer_evidence (
          tenant_id,analyzer_evidence_public_id,result_set_public_id,version_public_id,
          observation_public_id,source_type,source_public_id,ingestion_message_public_id,
          observation_index,protocol,payload_sha256,qc_state,validation_state,
          match_state,disposition,actor_system_key,occurred_at_utc,
          source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','analyzer-evidence-bad-hash','result-set-101','result-version-101-v1',
                  'observation-101','lis_analyzer_inbox','inbox-bad','message-bad',1,
                  'HL7','bad','passed','passed','matched','accepted','schema.test',?,?,?)
      `).run('2026-07-28T10:02:00.000Z', 'e'.repeat(64), '2026-07-28T10:02:00.000Z')).toThrow(/CHECK constraint failed/);
    } finally { db.close(); }
  });
});
