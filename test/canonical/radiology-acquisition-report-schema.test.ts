import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0559_canonical_radiology_acquisition_report.sql';
const schemaPath = 'src/db/schema/canonical/radiology-acquisition-report.ts';
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
    ['tenant-a', 'practitioner-101', 'Performer', '4'],
    ['tenant-a', 'practitioner-102', 'Reporter', '5'],
    ['tenant-a', 'practitioner-103', 'Approver', '6'],
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
    ['tenant-a', 'service-img-101', 'IMG-CXR', 'Chest X-ray', 'b'],
    ['tenant-a', 'service-img-202', 'IMG-CT', 'CT head', 'c'],
    ['tenant-b', 'service-img-301', 'IMG-B', 'Other imaging', 'd'],
  ] as const) {
    db.prepare(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,
        status,source_evidence_sha256
      ) VALUES (?,?,'radiology',?,?,'study','active',?)
    `).run(tenant, service, code, name, hash.repeat(64));
  }
  for (const [tenant, request, patientId, encounter, service, hash] of [
    ['tenant-a', 'request-101', 101, 'encounter-101', 'service-img-101', 'e'],
    ['tenant-a', 'request-202', 202, 'encounter-202', 'service-img-202', 'f'],
    ['tenant-b', 'request-301', 301, 'encounter-301', 'service-img-301', '0'],
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

function insertAcquisition(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    publicId: 'acquisition-101', patientLink: 'patient-link-101', encounter: 'encounter-101',
    request: 'request-101', event: 'request-101-event', service: 'service-img-101',
    accessionNamespace: 'tenant-ris', accessionValue: 'ACC-101', modality: 'CR',
    performer: 'practitioner-101', idempotency: 'acquisition-create-101',
    fingerprint: '1'.repeat(64), evidence: '2'.repeat(64), ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_acquisitions (
      tenant_id,acquisition_public_id,patient_link_public_id,encounter_public_id,
      request_public_id,event_public_id,service_public_id,accession_namespace,
      accession_value,modality_code,current_status,status_version,
      performing_practitioner_public_id,actor_system_key,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,?,?,?,'scheduled',1,?,'schema.test',?,?,?,?,?)
  `).run(
    value.publicId, value.patientLink, value.encounter, value.request, value.event,
    value.service, value.accessionNamespace, value.accessionValue, value.modality,
    value.performer, value.idempotency, value.fingerprint, value.evidence,
    '2026-07-28T08:20:00.000Z', '2026-07-28T08:20:00.000Z',
  );
}

function insertAcquisitionEvent(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    eventId: 'acq-event-101-v1', acquisition: 'acquisition-101', fromStatus: null,
    toStatus: 'scheduled', eventVersion: 1, eventType: 'registered',
    practitioner: 'practitioner-101', occurred: '2026-07-28T08:20:00.000Z',
    recorded: '2026-07-28T08:20:00.000Z', reason: 'registered', evidence: '3'.repeat(64),
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_acquisition_status_events (
      tenant_id,event_public_id,acquisition_public_id,from_status,to_status,event_version,
      event_type,actor_practitioner_public_id,actor_system_key,occurred_at_utc,
      recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,?,'schema.test',?,?,?,?,?)
  `).run(
    value.eventId, value.acquisition, value.fromStatus, value.toStatus, value.eventVersion,
    value.eventType, value.practitioner, value.occurred, value.recorded,
    value.reason, value.evidence, value.recorded,
  );
}

function initialiseAcquisition(db: DatabaseSync): void {
  insertAcquisition(db);
  insertAcquisitionEvent(db);
  db.prepare(`
    UPDATE canonical_imaging_acquisitions
    SET current_status_event_public_id='acq-event-101-v1'
    WHERE acquisition_public_id='acquisition-101'
  `).run();
}

function insertStudy(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    publicId: 'study-101', acquisition: 'acquisition-101', uidNamespace: 'dicom',
    uid: '1.2.840.113619.2.55.3.101', accessionNamespace: 'tenant-ris',
    accessionValue: 'ACC-101', modality: 'CR', evidence: '4'.repeat(64),
    idempotency: 'study-create-101', fingerprint: '5'.repeat(64), ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_studies (
      tenant_id,study_public_id,acquisition_public_id,patient_link_public_id,
      encounter_public_id,request_public_id,service_public_id,study_uid_namespace,
      study_instance_uid,accession_namespace,accession_value,modality_code,
      study_started_at_utc,current_status,status_version,actor_system_key,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,?,'patient-link-101','encounter-101','request-101',
              'service-img-101',?,?,?,?,?,'2026-07-28T09:00:00.000Z','active',1,
              'schema.test',?,?,?,?,?)
  `).run(
    value.publicId, value.acquisition, value.uidNamespace, value.uid,
    value.accessionNamespace, value.accessionValue, value.modality,
    value.idempotency, value.fingerprint, value.evidence,
    '2026-07-28T09:00:00.000Z', '2026-07-28T09:00:00.000Z',
  );
}

function insertSeries(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    publicId: 'series-101', study: 'study-101', namespace: 'dicom',
    uid: '1.2.840.113619.2.55.3.101.1', number: 1, modality: 'CR',
    evidence: '6'.repeat(64), ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_series (
      tenant_id,series_public_id,study_public_id,series_uid_namespace,
      series_instance_uid,series_number,modality_code,current_status,
      source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,'active',?,?,?)
  `).run(
    value.publicId, value.study, value.namespace, value.uid, value.number,
    value.modality, value.evidence, '2026-07-28T09:01:00.000Z', '2026-07-28T09:01:00.000Z',
  );
}

function insertInstance(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    publicId: 'instance-101', study: 'study-101', series: 'series-101',
    namespace: 'dicom', sopUid: '1.2.840.113619.2.55.3.101.1.1',
    sopClass: '1.2.840.10008.5.1.4.1.1.1', instanceNumber: 1, frameCount: 1,
    transferSyntax: '1.2.840.10008.1.2.1', contentHash: '7'.repeat(64), byteSize: 2048,
    providerType: 'r2', providerId: 'radiology-images', objectKey: 'study/series/instance.dcm',
    generation: '1', evidence: '8'.repeat(64), ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_instances (
      tenant_id,instance_public_id,study_public_id,series_public_id,
      sop_uid_namespace,sop_instance_uid,sop_class_uid,instance_number,frame_count,
      transfer_syntax_uid,object_content_sha256,byte_size,storage_provider_type,
      storage_provider_public_id,storage_object_key,storage_generation,current_disposition,
      source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'accepted',?,?)
  `).run(
    value.publicId, value.study, value.series, value.namespace, value.sopUid,
    value.sopClass, value.instanceNumber, value.frameCount, value.transferSyntax,
    value.contentHash, value.byteSize, value.providerType, value.providerId,
    value.objectKey, value.generation, value.evidence, '2026-07-28T09:02:00.000Z',
  );
}

function insertReportSet(db: DatabaseSync): void {
  db.prepare(`
    INSERT INTO canonical_imaging_report_sets (
      tenant_id,report_set_public_id,patient_link_public_id,encounter_public_id,
      request_public_id,service_public_id,acquisition_public_id,study_public_id,
      current_status,status_version,reporting_practitioner_public_id,
      report_number_namespace,report_number_value,actor_system_key,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','report-set-101','patient-link-101','encounter-101','request-101',
              'service-img-101','acquisition-101','study-101','draft',1,
              'practitioner-102','tenant-ris','RAD-101','schema.test','report-create-101',
              ?,?,?,?)
  `).run('9'.repeat(64), 'a'.repeat(64), '2026-07-28T10:00:00.000Z', '2026-07-28T10:00:00.000Z');
}

function insertReportVersion(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    versionId: 'report-version-101-v1', versionNumber: 1, supersedes: null,
    versionKind: 'draft', contentJson: '{"findings":"clear","impression":"normal"}',
    contentHash: 'b'.repeat(64), author: 'practitioner-102', reason: null,
    evidence: 'c'.repeat(64), ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_report_versions (
      tenant_id,version_public_id,report_set_public_id,version_number,
      supersedes_version_public_id,version_kind,version_status,content_json,
      content_sha256,authoring_practitioner_public_id,actor_system_key,
      authored_at_utc,reason_code,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,'report-set-101',?,?,?,'draft',?,? ,?,'schema.test',?,?,?,?)
  `).run(
    value.versionId, value.versionNumber, value.supersedes, value.versionKind,
    value.contentJson, value.contentHash, value.author, '2026-07-28T10:00:00.000Z',
    value.reason, value.evidence, '2026-07-28T10:00:00.000Z',
  );
}

function insertReportEvent(db: DatabaseSync, overrides: Partial<Record<string, unknown>> = {}): void {
  const value = {
    eventId: 'report-event-101-v1', versionId: 'report-version-101-v1',
    fromStatus: null, toStatus: 'draft', eventVersion: 1, eventType: 'draft_created',
    practitioner: 'practitioner-102', signedHash: null, reason: 'draft_created',
    occurred: '2026-07-28T10:00:00.000Z', evidence: 'd'.repeat(64), ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_imaging_report_status_events (
      tenant_id,event_public_id,report_set_public_id,version_public_id,from_status,
      to_status,event_version,event_type,actor_practitioner_public_id,actor_system_key,
      signed_content_sha256,reason_code,occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,'report-set-101',?,?,?,?,?,?,'schema.test',?,?,?,?,?)
  `).run(
    value.eventId, value.versionId, value.fromStatus, value.toStatus,
    value.eventVersion, value.eventType, value.practitioner, value.signedHash,
    value.reason, value.occurred, value.evidence, value.occurred,
  );
}

function initialiseReport(db: DatabaseSync): void {
  initialiseAcquisition(db);
  insertStudy(db);
  insertReportSet(db);
  insertReportVersion(db);
  insertReportEvent(db);
  db.prepare(`
    UPDATE canonical_imaging_report_sets
    SET current_version_public_id='report-version-101-v1',
        current_status_event_public_id='report-event-101-v1'
    WHERE report_set_public_id='report-set-101'
  `).run();
}

describe('canonical radiology acquisition and report schema', () => {
  it('reserves migration 0559, dedicated Drizzle module, and Canonical barrel export', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    expect(readFileSync(barrelPath, 'utf8')).toContain("export * from './radiology-acquisition-report';");
  });

  it('creates exactly nine acquisition, DICOM hierarchy, provenance, and report table families', () => {
    const db = createDatabase();
    try {
      const tables = db.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name GLOB 'canonical_imaging_*'
        ORDER BY name
      `).all().map((row) => String((row as { name: string }).name));
      expect(tables).toEqual([
        'canonical_imaging_acquisition_status_events',
        'canonical_imaging_acquisitions',
        'canonical_imaging_instances',
        'canonical_imaging_provenance_events',
        'canonical_imaging_report_sets',
        'canonical_imaging_report_status_events',
        'canonical_imaging_report_versions',
        'canonical_imaging_series',
        'canonical_imaging_studies',
      ]);
    } finally { db.close(); }
  });

  it('enforces exact acquisition patient, encounter, request, event, service, practitioner, and accession scope', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertAcquisition(db);
      expect(() => insertAcquisition(db, {
        publicId: 'acquisition-duplicate-accession', idempotency: 'duplicate-accession',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertAcquisition(db, {
        publicId: 'acquisition-cross-scope', patientLink: 'patient-link-202',
        accessionValue: 'ACC-202', idempotency: 'cross-scope',
      })).toThrow(/FOREIGN KEY constraint failed/);
      expect(() => insertAcquisition(db, {
        publicId: 'acquisition-bad-performer', performer: 'practitioner-301',
        accessionValue: 'ACC-203', idempotency: 'bad-performer',
      })).toThrow(/FOREIGN KEY constraint failed/);
    } finally { db.close(); }
  });

  it('requires immutable contiguous acquisition lifecycle and guarded current-state transitions', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      insertAcquisition(db);
      expect(() => db.prepare(`UPDATE canonical_imaging_acquisitions
        SET current_status_event_public_id='missing' WHERE acquisition_public_id='acquisition-101'`).run()).toThrow();
      insertAcquisitionEvent(db);
      db.prepare(`UPDATE canonical_imaging_acquisitions
        SET current_status_event_public_id='acq-event-101-v1' WHERE acquisition_public_id='acquisition-101'`).run();
      insertAcquisitionEvent(db, {
        eventId: 'acq-event-101-v2', fromStatus: 'scheduled', toStatus: 'in_progress',
        eventVersion: 2, eventType: 'started', occurred: '2026-07-28T09:00:00.000Z',
        recorded: '2026-07-28T09:00:00.000Z', reason: 'started',
      });
      db.prepare(`UPDATE canonical_imaging_acquisitions SET current_status='in_progress',
        status_version=2,current_status_event_public_id='acq-event-101-v2',
        started_at_utc='2026-07-28T09:00:00.000Z',updated_at_utc='2026-07-28T09:00:00.000Z'
        WHERE acquisition_public_id='acquisition-101'`).run();
      expect(() => insertAcquisitionEvent(db, {
        eventId: 'acq-event-gap', fromStatus: 'in_progress', toStatus: 'completed',
        eventVersion: 4, eventType: 'completed', reason: 'completed',
      })).toThrow(/current state|version/i);
      expect(() => db.prepare(`UPDATE canonical_imaging_acquisition_status_events
        SET reason_code='changed' WHERE event_public_id='acq-event-101-v1'`).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`DELETE FROM canonical_imaging_acquisitions
        WHERE acquisition_public_id='acquisition-101'`).run()).toThrow();
    } finally { db.close(); }
  });

  it('enforces exact Study, Series, and SOP Instance UID hierarchy plus immutable accepted storage identity', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseAcquisition(db);
      insertStudy(db);
      insertSeries(db);
      insertInstance(db);
      expect(() => insertStudy(db, {
        publicId: 'study-duplicate', acquisition: 'acquisition-101',
        idempotency: 'study-duplicate', fingerprint: 'e'.repeat(64), evidence: 'f'.repeat(64),
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertSeries(db, {
        publicId: 'series-duplicate', uid: '1.2.840.113619.2.55.3.101.1',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertInstance(db, {
        publicId: 'instance-collision', contentHash: '0'.repeat(64), objectKey: 'changed.dcm',
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertInstance(db, {
        publicId: 'instance-bad-hash', sopUid: '1.2.840.113619.2.55.3.101.1.2',
        contentHash: 'bad', objectKey: 'bad.dcm',
      })).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare(`UPDATE canonical_imaging_instances
        SET storage_object_key='changed.dcm' WHERE instance_public_id='instance-101'`).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`DELETE FROM canonical_imaging_studies WHERE study_public_id='study-101'`).run()).toThrow();
    } finally { db.close(); }
  });

  it('enforces immutable exact PACS/modality/storage provenance and source/hash uniqueness', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseAcquisition(db);
      insertStudy(db);
      insertSeries(db);
      insertInstance(db);
      db.prepare(`
        INSERT INTO canonical_imaging_provenance_events (
          tenant_id,provenance_event_public_id,acquisition_public_id,study_public_id,
          series_public_id,instance_public_id,event_type,disposition,event_version,
          modality_source_type,modality_source_public_id,source_ae_title,
          pacs_endpoint_source_type,pacs_endpoint_source_public_id,protocol,
          object_content_sha256,storage_provider_type,storage_provider_public_id,
          storage_object_key,storage_generation,actor_system_key,occurred_at_utc,
          recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','prov-101','acquisition-101','study-101','series-101',
                  'instance-101','stored','accepted',1,'legacy_modality','modality-1',
                  'MODALITY_AE','legacy_pacs','pacs-1','DICOM',?,'r2','radiology-images',
                  'study/series/instance.dcm','1','schema.test',?,?, 'stored',?,?)
      `).run('7'.repeat(64), '2026-07-28T09:03:00.000Z', '2026-07-28T09:03:00.000Z',
        '1'.repeat(64), '2026-07-28T09:03:00.000Z');
      expect(() => db.prepare(`
        INSERT INTO canonical_imaging_provenance_events (
          tenant_id,provenance_event_public_id,acquisition_public_id,study_public_id,
          series_public_id,instance_public_id,event_type,disposition,event_version,
          modality_source_type,modality_source_public_id,source_ae_title,protocol,
          object_content_sha256,actor_system_key,occurred_at_utc,recorded_at_utc,
          reason_code,source_evidence_sha256,created_at_utc
        ) VALUES ('tenant-a','prov-duplicate','acquisition-101','study-101','series-101',
                  'instance-101','stored','accepted',2,'legacy_modality','modality-1',
                  'MODALITY_AE','DICOM',?,'schema.test',?,?, 'duplicate',?,?)
      `).run('7'.repeat(64), '2026-07-28T09:04:00.000Z', '2026-07-28T09:04:00.000Z',
        '2'.repeat(64), '2026-07-28T09:04:00.000Z')).toThrow(/UNIQUE constraint failed/);
      expect(() => db.prepare(`UPDATE canonical_imaging_provenance_events
        SET disposition='rejected' WHERE provenance_event_public_id='prov-101'`).run()).toThrow(/immutable/i);
    } finally { db.close(); }
  });

  it('enforces exact report scope, contiguous immutable complete versions, and one replacement per superseded version', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseReport(db);
      insertReportVersion(db, {
        versionId: 'report-version-101-v2', versionNumber: 2,
        supersedes: 'report-version-101-v1', versionKind: 'correction',
        contentJson: '{"findings":"opacity","impression":"pneumonia"}',
        contentHash: 'e'.repeat(64), reason: 'corrected_findings', evidence: 'f'.repeat(64),
      });
      expect(() => insertReportVersion(db, {
        versionId: 'report-version-101-v3', versionNumber: 3,
        supersedes: 'report-version-101-v1', versionKind: 'correction',
        contentHash: '0'.repeat(64), reason: 'second_branch', evidence: '1'.repeat(64),
      })).toThrow(/UNIQUE constraint failed/);
      expect(() => insertReportVersion(db, {
        versionId: 'report-version-gap', versionNumber: 4,
        supersedes: 'report-version-101-v2', versionKind: 'correction',
        contentHash: '2'.repeat(64), reason: 'gap', evidence: '3'.repeat(64),
      })).toThrow(/sequence/i);
      expect(() => db.prepare(`UPDATE canonical_imaging_report_versions
        SET content_json='{}' WHERE version_public_id='report-version-101-v1'`).run()).toThrow(/immutable/i);
      expect(() => db.prepare(`DELETE FROM canonical_imaging_report_sets
        WHERE report_set_public_id='report-set-101'`).run()).toThrow();
    } finally { db.close(); }
  });

  it('enforces signed report lifecycle, current-version ownership, and excludes raw pixel/payload columns', () => {
    const db = createDatabase();
    try {
      seedDependencies(db);
      initialiseReport(db);
      const contentHash = 'b'.repeat(64);
      expect(() => insertReportEvent(db, {
        eventId: 'report-event-bad-signature', fromStatus: 'draft', toStatus: 'verified',
        eventVersion: 2, eventType: 'verified', practitioner: 'practitioner-102',
        signedHash: '0'.repeat(64), reason: 'verified',
      })).toThrow(/signed content|CHECK constraint failed/i);
      insertReportEvent(db, {
        eventId: 'report-event-101-v2', fromStatus: 'draft', toStatus: 'verified',
        eventVersion: 2, eventType: 'verified', practitioner: 'practitioner-102',
        signedHash: contentHash, reason: 'verified', occurred: '2026-07-28T10:05:00.000Z',
      });
      db.prepare(`UPDATE canonical_imaging_report_versions
        SET version_status='verified',signed_content_sha256=?,
            verifying_practitioner_public_id='practitioner-102',
            verified_at_utc='2026-07-28T10:05:00.000Z'
        WHERE version_public_id='report-version-101-v1'`).run(contentHash);
      db.prepare(`UPDATE canonical_imaging_report_sets
        SET current_status='verified',status_version=2,
            current_status_event_public_id='report-event-101-v2',
            updated_at_utc='2026-07-28T10:05:00.000Z'
        WHERE report_set_public_id='report-set-101'`).run();
      expect(db.prepare(`SELECT current_status,status_version FROM canonical_imaging_report_sets`).get())
        .toEqual({ current_status: 'verified', status_version: 2 });

      const allColumns = db.prepare(`
        SELECT name FROM pragma_table_info('canonical_imaging_instances')
        UNION ALL SELECT name FROM pragma_table_info('canonical_imaging_provenance_events')
      `).all().map((row) => String((row as { name: string }).name));
      expect(allColumns).not.toEqual(expect.arrayContaining([
        'pixel_data','dicom_payload','raw_payload','patient_name','payload_json',
      ]));
    } finally { db.close(); }
  });
});
