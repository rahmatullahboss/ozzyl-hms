import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  completeCanonicalImagingAcquisition,
  createCanonicalImagingReportDraft,
  finalizeAndPublishCanonicalImagingReportVersion,
  recordCanonicalImagingProvenance,
  registerCanonicalImagingAcquisition,
  registerCanonicalImagingInstance,
  registerCanonicalImagingSeries,
  registerCanonicalImagingStudy,
  startCanonicalImagingAcquisition,
  verifyCanonicalImagingReportVersion,
} from '../../src/lib/canonical/commands/manage-radiology-acquisition-report';
import {
  resolveRadiologyAcquisitionReportProjection,
  resolveRadiologyAcquisitionReportProviderMode,
  type RadiologyAcquisitionReportProviderDatabase,
  type RadiologyAcquisitionReportProviderPreparedStatement,
} from '../../src/lib/canonical/radiology-acquisition-report-provider';
import {
  readRadiologyAcquisitionWorklistAdapter,
  readRadiologyPacsHierarchyAdapter,
  readRadiologyPatientTimelineAdapter,
  readRadiologyReportRenderingAdapter,
} from '../../src/lib/canonical/radiology-acquisition-report-read-adapters';

type SqlValue = string | number | bigint | null | Uint8Array;
class Statement implements CanonicalPreparedStatement, RadiologyAcquisitionReportProviderPreparedStatement {
  constructor(private readonly database: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}
interface Harness {
  sqlite: DatabaseSync;
  db: CanonicalBatchDatabase & RadiologyAcquisitionReportProviderDatabase;
}
async function harness(): Promise<Harness> {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    'migrations/0559_canonical_radiology_acquisition_report.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE radiology_requisitions (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      order_status TEXT NOT NULL,is_scanned INTEGER NOT NULL,scanned_by TEXT,
      scanned_on TEXT,created_at TEXT,updated_at TEXT
    );
    CREATE TABLE radiology_dicom_studies (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER,requisition_id INTEGER,
      is_active INTEGER NOT NULL,series_count INTEGER NOT NULL,image_count INTEGER NOT NULL,
      study_date TEXT,created_at TEXT,updated_at TEXT
    );
    CREATE TABLE radiology_reports (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      requisition_id INTEGER NOT NULL,patient_study_id INTEGER,performer_id INTEGER,
      order_status TEXT NOT NULL,is_active INTEGER NOT NULL,created_at TEXT,updated_at TEXT
    );
  `);
  const db: CanonicalBatchDatabase & RadiologyAcquisitionReportProviderDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
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
  await seedCanonical(db, sqlite);
  return { sqlite, db };
}
function seedDependencies(sqlite: DatabaseSync): void {
  sqlite.prepare(`INSERT INTO canonical_tenant_patient_links (
    tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
    evidence_type,evidence_sha256,effective_from_utc,version
  ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified','no_link_placeholder',?,'2026-07-28T00:00:00.000Z',1)`)
    .run('1'.repeat(64));
  for (const [id, name, hash] of [
    ['practitioner-101', 'Performer', '2'],
    ['practitioner-102', 'Reporter', '3'],
    ['practitioner-103', 'Approver', '4'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'internal',?,'active',1,?)`).run(id, name, hash.repeat(64));
  }
  sqlite.prepare(`INSERT INTO canonical_encounters (
    tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,status,
    encounter_version,source_kind,started_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','encounter-101',101,'patient-link-101','outpatient','in_progress',1,'runtime','2026-07-28T08:00:00.000Z',?)`)
    .run('5'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_service_catalog_items (
    tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
  ) VALUES ('tenant-a','service-img-101','radiology','IMG-CXR','Chest X-ray','study','active',?)`).run('6'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_service_requests (
    tenant_id,request_public_id,legacy_patient_id,encounter_public_id,service_public_id,status,requested_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','request-101',101,'encounter-101','service-img-101','fulfilled','2026-07-28T08:10:00.000Z',?)`).run('7'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_service_events (
    tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id,event_type,status,occurred_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','event-101','request-101','encounter-101','service-img-101','completed','posted','2026-07-28T09:10:00.000Z',?)`).run('8'.repeat(64));
  sqlite.prepare(`INSERT INTO radiology_requisitions VALUES
    (501,'tenant-a',101,'reported',1,'101','2026-07-28 09:00:00','2026-07-28 08:10:00','2026-07-28 09:10:00'),
    (502,'tenant-a',101,'pending',0,NULL,NULL,'2026-07-28 11:00:00','2026-07-28 11:00:00')`).run();
  sqlite.prepare(`INSERT INTO radiology_dicom_studies VALUES
    (701,'tenant-a',101,501,1,1,1,'2026-07-28','2026-07-28 09:01:00','2026-07-28 09:05:00')`).run();
  sqlite.prepare(`INSERT INTO radiology_reports VALUES
    (901,'tenant-a',101,501,701,102,'final',1,'2026-07-28 10:00:00','2026-07-28 10:15:00'),
    (902,'tenant-a',101,502,NULL,NULL,'draft',1,'2026-07-28 11:00:00','2026-07-28 11:00:00')`).run();
}
async function seedCanonical(db: CanonicalBatchDatabase, sqlite: DatabaseSync): Promise<void> {
  await registerCanonicalImagingAcquisition(db, {
    tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-501', patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101', requestPublicId: 'request-101', eventPublicId: 'event-101',
    servicePublicId: 'service-img-101', accessionNamespace: 'legacy-radiology', accessionValue: 'ACC-501',
    modalityCode: 'CR', performingPractitionerPublicId: 'practitioner-101',
    sourceType: 'legacy_radiology_requisition', sourcePublicId: '501', sourceTable: 'radiology_requisitions',
    sourceEvidenceSha256: '9'.repeat(64), actorSystemKey: 'provider.test', idempotencyKey: 'provider-acq-501',
    occurredAtUtc: '2026-07-28T08:10:00.000Z', businessDate: '2026-07-28',
  });
  await startCanonicalImagingAcquisition(db, {
    tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-501', expectedStatusVersion: 1,
    performingPractitionerPublicId: 'practitioner-101', sourceEvidenceSha256: 'a'.repeat(64),
    actorSystemKey: 'provider.test', idempotencyKey: 'provider-acq-start-501',
    occurredAtUtc: '2026-07-28T09:00:00.000Z', recordedAtUtc: '2026-07-28T09:00:00.000Z', businessDate: '2026-07-28',
  });
  await completeCanonicalImagingAcquisition(db, {
    tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-501', expectedStatusVersion: 2,
    performingPractitionerPublicId: 'practitioner-101', sourceEvidenceSha256: 'b'.repeat(64),
    actorSystemKey: 'provider.test', idempotencyKey: 'provider-acq-complete-501',
    occurredAtUtc: '2026-07-28T09:10:00.000Z', recordedAtUtc: '2026-07-28T09:10:00.000Z', businessDate: '2026-07-28',
  });
  await registerCanonicalImagingStudy(db, {
    tenantId: 'tenant-a', studyPublicId: 'study-701', acquisitionPublicId: 'acquisition-501',
    studyUidNamespace: 'dicom', studyInstanceUid: '1.2.840.113619.701',
    accessionNamespace: 'legacy-radiology', accessionValue: 'ACC-501', modalityCode: 'CR',
    studyStartedAtUtc: '2026-07-28T09:01:00.000Z', sourceType: 'legacy_radiology_dicom_study',
    sourcePublicId: '701', sourceTable: 'radiology_dicom_studies', sourceEvidenceSha256: 'c'.repeat(64),
    actorSystemKey: 'provider.test', idempotencyKey: 'provider-study-701',
    occurredAtUtc: '2026-07-28T09:01:00.000Z', businessDate: '2026-07-28',
  });
  await registerCanonicalImagingSeries(db, {
    tenantId: 'tenant-a', studyPublicId: 'study-701', seriesPublicId: 'series-711',
    seriesUidNamespace: 'dicom', seriesInstanceUid: '1.2.840.113619.701.1', seriesNumber: 1,
    modalityCode: 'CR', sourceType: 'legacy_dicom_series', sourcePublicId: '711',
    sourceTable: 'radiology_dicom_series', sourceEvidenceSha256: 'd'.repeat(64), actorSystemKey: 'provider.test',
    idempotencyKey: 'provider-series-711', occurredAtUtc: '2026-07-28T09:02:00.000Z', businessDate: '2026-07-28',
  });
  await registerCanonicalImagingInstance(db, {
    tenantId: 'tenant-a', studyPublicId: 'study-701', seriesPublicId: 'series-711', instancePublicId: 'instance-721',
    sopUidNamespace: 'dicom', sopInstanceUid: '1.2.840.113619.701.1.1', sopClassUid: '1.2.840.10008.5.1.4.1.1.1',
    instanceNumber: 1, frameCount: 1, transferSyntaxUid: '1.2.840.10008.1.2.1',
    objectContentSha256: 'e'.repeat(64), byteSize: 4096, storageProviderType: 'r2',
    storageProviderPublicId: 'radiology-images', storageObjectKey: '701/711/721.dcm', storageGeneration: '1',
    sourceType: 'legacy_dicom_instance', sourcePublicId: '721', sourceTable: 'radiology_dicom_instances',
    sourceEvidenceSha256: 'f'.repeat(64), actorSystemKey: 'provider.test', idempotencyKey: 'provider-instance-721',
    occurredAtUtc: '2026-07-28T09:03:00.000Z', businessDate: '2026-07-28',
  });
  await recordCanonicalImagingProvenance(db, {
    tenantId: 'tenant-a', provenanceEventPublicId: 'provenance-731', acquisitionPublicId: 'acquisition-501',
    studyPublicId: 'study-701', seriesPublicId: 'series-711', instancePublicId: 'instance-721',
    eventType: 'stored', disposition: 'accepted', eventVersion: 1,
    modalitySourceType: 'dicom_ae', modalitySourcePublicId: 'MODALITY_AE', sourceAeTitle: 'MODALITY_AE',
    pacsEndpointSourceType: 'pacs_endpoint', pacsEndpointSourcePublicId: 'PACS-1', protocol: 'DICOM',
    objectContentSha256: 'e'.repeat(64), storageProviderType: 'r2', storageProviderPublicId: 'radiology-images',
    storageObjectKey: '701/711/721.dcm', storageGeneration: '1', sourceType: 'legacy_dicom_provenance',
    sourcePublicId: '731', sourceTable: 'radiology_dicom_studies', sourceEvidenceSha256: '0'.repeat(64),
    actorSystemKey: 'provider.test', idempotencyKey: 'provider-provenance-731',
    occurredAtUtc: '2026-07-28T09:04:00.000Z', recordedAtUtc: '2026-07-28T09:04:00.000Z',
    reasonCode: 'stored', businessDate: '2026-07-28',
  });
  await createCanonicalImagingReportDraft(db, {
    tenantId: 'tenant-a', reportSetPublicId: 'report-set-901', versionPublicId: 'report-version-901-v1',
    acquisitionPublicId: 'acquisition-501', studyPublicId: 'study-701', reportingPractitionerPublicId: 'practitioner-102',
    reportNumberNamespace: 'legacy-radiology', reportNumberValue: 'RAD-901',
    content: { indication: 'Cough', technique: 'PA chest', findings: 'Clear lungs', impression: 'No acute abnormality', comparison: null, recommendations: null },
    sourceType: 'legacy_radiology_report', sourcePublicId: '901', sourceTable: 'radiology_reports',
    sourceEvidenceSha256: '1'.repeat(64), actorSystemKey: 'provider.test', idempotencyKey: 'provider-report-901',
    occurredAtUtc: '2026-07-28T10:00:00.000Z', businessDate: '2026-07-28',
  });
  const version = sqlite.prepare(`SELECT content_sha256 FROM canonical_imaging_report_versions WHERE version_public_id='report-version-901-v1'`).get() as { content_sha256: string };
  await verifyCanonicalImagingReportVersion(db, {
    tenantId: 'tenant-a', reportSetPublicId: 'report-set-901', versionPublicId: 'report-version-901-v1', expectedStatusVersion: 1,
    verifyingPractitionerPublicId: 'practitioner-102', signedContentSha256: version.content_sha256,
    reasonCode: 'verified', sourceEvidenceSha256: '2'.repeat(64), actorSystemKey: 'provider.test',
    idempotencyKey: 'provider-report-verify-901', occurredAtUtc: '2026-07-28T10:05:00.000Z', businessDate: '2026-07-28',
  });
  await finalizeAndPublishCanonicalImagingReportVersion(db, {
    tenantId: 'tenant-a', reportSetPublicId: 'report-set-901', versionPublicId: 'report-version-901-v1', expectedStatusVersion: 2,
    finalisingPractitionerPublicId: 'practitioner-103', signedContentSha256: version.content_sha256,
    finalisationReasonCode: 'finalised', publicationReasonCode: 'published', sourceEvidenceSha256: '3'.repeat(64),
    actorSystemKey: 'provider.test', idempotencyKey: 'provider-report-publish-901',
    finalisedAtUtc: '2026-07-28T10:10:00.000Z', publishedAtUtc: '2026-07-28T10:15:00.000Z', businessDate: '2026-07-28',
  });
}
function setMode(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.exec(`DELETE FROM canonical_feature_flags WHERE tenant_id='tenant-a' AND flag_key='canonical_radiology_acquisition_report_provider_v1'`);
  sqlite.prepare(`INSERT INTO canonical_feature_flags (
    tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
  ) VALUES ('tenant-a','canonical_radiology_acquisition_report_provider_v1','radiology_acquisition_report',?,?,?,?)`)
    .run(mode, enabled, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
}
const evidence = {
  observedAtUtc: '2026-07-28T13:00:00.000Z', elapsedMs: 4, errorCount: 0,
  latencyBudgetMs: 100, acceptedExceptionIds: [] as string[],
};

describe('canonical radiology acquisition/report provider', () => {
  it('defaults to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = await harness();
    try {
      await expect(resolveRadiologyAcquisitionReportProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolveRadiologyAcquisitionReportProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'disabled', 0);
      await expect(resolveRadiologyAcquisitionReportProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'shadow', 1);
      await expect(resolveRadiologyAcquisitionReportProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      setMode(sqlite, 'canonical', 1);
      await expect(resolveRadiologyAcquisitionReportProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally { sqlite.close(); }
  });

  it('legacy mode preserves unmapped output and identity-sensitive reads fail without exact mapping', async () => {
    const { sqlite, db } = await harness();
    try {
      await expect(resolveRadiologyAcquisitionReportProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_requisition', legacyId: 502,
      })).resolves.toMatchObject({ mode: 'legacy', kind: 'acquisition', canonicalPublicId: null, status: 'pending', historyVisible: false });
      await expect(resolveRadiologyAcquisitionReportProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_requisition', legacyId: 502, identitySensitive: true,
      })).rejects.toThrow(/explicit radiology acquisition\/report source mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('shadow worklist adapter preserves legacy-facing status and emits aggregate PHI-minimised parity only', async () => {
    const { sqlite, db } = await harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readRadiologyAcquisitionWorklistAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_requisition', legacyId: 501,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', kind: 'acquisition', canonicalPublicId: 'acquisition-501', status: 'reported',
        statusVersion: 0, historyVisible: false, parity: { mapping: true, acquisition: true, acquisitionStatus: true },
      });
      expect(result.shadowEvidence).toMatchObject({
        provider: 'radiology_acquisition_report', consumerId: 'cdb126e_acquisition_worklist_detail',
        mode: 'shadow', comparisonCount: 14, mismatchCount: 0,
      });
      const json = JSON.stringify(result.shadowEvidence);
      for (const forbidden of [
        'patient-link-101', 'encounter-101', 'request-101', 'service-img-101', 'acquisition-501',
        'study-701', 'series-711', 'instance-721', '1.2.840.113619', 'MODALITY_AE',
        '701/711/721.dcm', 'Clear lungs',
      ]) expect(json).not.toContain(forbidden);
    } finally { sqlite.close(); }
  });

  it('canonical PACS adapter exposes exact Study/Series/SOP hierarchy and immutable provenance hashes', async () => {
    const { sqlite, db } = await harness();
    try {
      setMode(sqlite, 'canonical');
      const result = await readRadiologyPacsHierarchyAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_dicom_study', legacyId: 701,
      }, evidence);
      expect(result.shadowEvidence).toBeNull();
      expect(result.projection).toMatchObject({
        mode: 'canonical', kind: 'study', canonicalPublicId: 'study-701', acquisitionPublicId: 'acquisition-501',
        status: 'active', historyVisible: true,
      });
      expect(result.projection.acquisitionHistory).toHaveLength(3);
      expect(result.projection.studies).toHaveLength(1);
      expect(result.projection.series).toHaveLength(1);
      expect(result.projection.instances).toHaveLength(1);
      expect(result.projection.provenance).toHaveLength(1);
      expect(result.projection.instances[0]).toMatchObject({
        sopInstanceUid: '1.2.840.113619.701.1.1', objectContentSha256: 'e'.repeat(64),
        storageObjectKey: '701/711/721.dcm', storageGeneration: '1',
      });
      expect(result.projection.provenance[0]).toMatchObject({
        eventType: 'stored', sourceAeTitle: 'MODALITY_AE', objectContentSha256: 'e'.repeat(64),
      });
    } finally { sqlite.close(); }
  });

  it('canonical timeline and rendering adapters expose complete signed report lineage and fail closed when mapping is absent', async () => {
    const { sqlite, db } = await harness();
    try {
      setMode(sqlite, 'canonical');
      const timeline = await readRadiologyPatientTimelineAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_report', legacyId: 901,
      }, evidence);
      const rendering = await readRadiologyReportRenderingAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_report', legacyId: 901,
      }, evidence);
      for (const result of [timeline, rendering]) {
        expect(result.projection).toMatchObject({
          mode: 'canonical', kind: 'report', canonicalPublicId: 'report-set-901',
          reportSetPublicId: 'report-set-901', status: 'published', statusVersion: 4, historyVisible: true,
        });
        expect(result.projection.reportVersions).toHaveLength(1);
        expect(result.projection.reportStatusHistory).toHaveLength(4);
        expect(result.projection.reportVersions[0].signedContentSha256)
          .toBe(result.projection.reportVersions[0].contentSha256);
        expect(result.projection.reportVersions[0].contentJson).toContain('Clear lungs');
        expect(result.projection.reportStatusHistory.map((event) => event.eventType))
          .toEqual(['draft_created', 'verified', 'finalised', 'published']);
      }
      await expect(resolveRadiologyAcquisitionReportProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_radiology_report', legacyId: 902,
      })).rejects.toThrow(/explicit radiology acquisition\/report source mapping is required/i);
    } finally { sqlite.close(); }
  });
});
