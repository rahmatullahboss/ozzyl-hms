import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  cancelCanonicalImagingAcquisition,
  completeCanonicalImagingAcquisition,
  correctCanonicalImagingReportVersion,
  createCanonicalImagingReportDraft,
  enterCanonicalImagingAcquisitionInError,
  enterCanonicalImagingReportInError,
  finalizeAndPublishCanonicalImagingReportVersion,
  recordCanonicalImagingProvenance,
  registerCanonicalImagingAcquisition,
  registerCanonicalImagingInstance,
  registerCanonicalImagingSeries,
  registerCanonicalImagingStudy,
  replaceCanonicalImagingReportDraft,
  retractCanonicalImagingReportVersion,
  startCanonicalImagingAcquisition,
  verifyCanonicalImagingReportVersion,
  type CreateCanonicalImagingReportDraftInput,
  type RegisterCanonicalImagingAcquisitionInput,
} from '../../src/lib/canonical/commands/manage-radiology-acquisition-report';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly database: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => (value === undefined ? null : value)) as SqlValue[]);
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
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
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    'migrations/0559_canonical_radiology_acquisition_report.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`CREATE TABLE legacy_radiology_compat(id INTEGER PRIMARY KEY AUTOINCREMENT,marker TEXT NOT NULL UNIQUE)`);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const output = [];
        for (const statement of statements) output.push(await statement.run());
        sqlite.exec('COMMIT');
        return output;
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
  for (const [tenant, patientLink, patientId, hash] of [
    ['tenant-a', 'patient-link-101', 101, '1'],
    ['tenant-a', 'patient-link-202', 202, '2'],
    ['tenant-b', 'patient-link-301', 301, '3'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
      evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES (?,?,?,'unlinked','unverified','no_link_placeholder',?,?,1)`).run(
      tenant, patientLink, patientId, hash.repeat(64), '2026-07-28T00:00:00.000Z',
    );
  }
  for (const [tenant, practitioner, name, hash] of [
    ['tenant-a', 'practitioner-101', 'Performer', '4'],
    ['tenant-a', 'practitioner-102', 'Reporter', '5'],
    ['tenant-a', 'practitioner-103', 'Approver', '6'],
    ['tenant-b', 'practitioner-301', 'Other', '7'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES (?,?,'internal',?,'active',1,?)`).run(tenant, practitioner, name, hash.repeat(64));
  }
  for (const [tenant, encounter, patientId, patientLink, hash] of [
    ['tenant-a', 'encounter-101', 101, 'patient-link-101', '8'],
    ['tenant-a', 'encounter-202', 202, 'patient-link-202', '9'],
    ['tenant-b', 'encounter-301', 301, 'patient-link-301', 'a'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?, 'outpatient','in_progress',1,'runtime',?,?)`).run(
      tenant, encounter, patientId, patientLink, '2026-07-28T08:00:00.000Z', hash.repeat(64),
    );
  }
  for (const [tenant, service, code, name, hash] of [
    ['tenant-a', 'service-img-101', 'IMG-CXR', 'Chest X-ray', 'b'],
    ['tenant-a', 'service-img-202', 'IMG-CT', 'CT head', 'c'],
    ['tenant-b', 'service-img-301', 'IMG-B', 'Other imaging', 'd'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    ) VALUES (?,?,'radiology',?,?,'study','active',?)`).run(tenant, service, code, name, hash.repeat(64));
  }
  for (const [tenant, request, patientId, encounter, service, hash] of [
    ['tenant-a', 'request-101', 101, 'encounter-101', 'service-img-101', 'e'],
    ['tenant-a', 'request-202', 202, 'encounter-202', 'service-img-202', 'f'],
    ['tenant-b', 'request-301', 301, 'encounter-301', 'service-img-301', '0'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_service_requests (
      tenant_id,request_public_id,legacy_patient_id,encounter_public_id,service_public_id,
      status,requested_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,'fulfilled',?,?)`).run(
      tenant, request, patientId, encounter, service, '2026-07-28T08:10:00.000Z', hash.repeat(64),
    );
    sqlite.prepare(`INSERT INTO canonical_service_events (
      tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id,
      event_type,status,occurred_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,'completed','posted',?,?)`).run(
      tenant, `${request}-event`, request, encounter, service, '2026-07-28T09:00:00.000Z', hash.repeat(64),
    );
  }
}

function acquisitionInput(overrides: Partial<RegisterCanonicalImagingAcquisitionInput> = {}): RegisterCanonicalImagingAcquisitionInput {
  return {
    tenantId: 'tenant-a',
    acquisitionPublicId: 'acquisition-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    requestPublicId: 'request-101',
    eventPublicId: 'request-101-event',
    servicePublicId: 'service-img-101',
    accessionNamespace: 'tenant-ris',
    accessionValue: 'ACC-101',
    modalityCode: 'CR',
    performingPractitionerPublicId: 'practitioner-101',
    sourceType: 'legacy_radiology_requisition',
    sourcePublicId: '501',
    sourceTable: 'radiology_requisitions',
    sourceEvidenceSha256: '1'.repeat(64),
    actorSystemKey: 'canonical.radiology.test',
    idempotencyKey: 'imaging-acquisition-register-101',
    outboxEventPublicId: 'imaging-acquisition-register-outbox-101',
    occurredAtUtc: '2026-07-28T08:20:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function reportInput(overrides: Partial<CreateCanonicalImagingReportDraftInput> = {}): CreateCanonicalImagingReportDraftInput {
  return {
    tenantId: 'tenant-a',
    reportSetPublicId: 'report-set-101',
    versionPublicId: 'report-version-101-v1',
    acquisitionPublicId: 'acquisition-101',
    studyPublicId: 'study-101',
    reportingPractitionerPublicId: 'practitioner-102',
    reportNumberNamespace: 'tenant-ris',
    reportNumberValue: 'RAD-101',
    content: {
      indication: 'Cough',
      technique: 'PA chest',
      findings: 'Clear lungs',
      impression: 'No acute abnormality',
      comparison: null,
      recommendations: null,
    },
    sourceType: 'legacy_radiology_report',
    sourcePublicId: '901',
    sourceTable: 'radiology_reports',
    sourceEvidenceSha256: '2'.repeat(64),
    actorSystemKey: 'canonical.radiology.test',
    idempotencyKey: 'imaging-report-create-101',
    outboxEventPublicId: 'imaging-report-create-outbox-101',
    occurredAtUtc: '2026-07-28T10:00:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function registerAcquisition(db: CanonicalBatchDatabase): Promise<void> {
  await registerCanonicalImagingAcquisition(db, acquisitionInput());
}

async function buildHierarchy(db: CanonicalBatchDatabase): Promise<void> {
  await registerAcquisition(db);
  await registerCanonicalImagingStudy(db, {
    tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-101', studyPublicId: 'study-101',
    studyUidNamespace: 'dicom', studyInstanceUid: '1.2.840.113619.2.55.3.101',
    accessionNamespace: 'tenant-ris', accessionValue: 'ACC-101', modalityCode: 'CR',
    studyStartedAtUtc: '2026-07-28T09:00:00.000Z', sourceType: 'legacy_radiology_dicom_study',
    sourcePublicId: '701', sourceTable: 'radiology_dicom_studies', sourceEvidenceSha256: '3'.repeat(64),
    actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'study-register-101',
    occurredAtUtc: '2026-07-28T09:00:00.000Z', businessDate: '2026-07-28',
  });
  await registerCanonicalImagingSeries(db, {
    tenantId: 'tenant-a', studyPublicId: 'study-101', seriesPublicId: 'series-101',
    seriesUidNamespace: 'dicom', seriesInstanceUid: '1.2.840.113619.2.55.3.101.1',
    seriesNumber: 1, modalityCode: 'CR', sourceType: 'legacy_dicom_series',
    sourcePublicId: '801', sourceTable: 'radiology_dicom_series', sourceEvidenceSha256: '4'.repeat(64),
    actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'series-register-101',
    occurredAtUtc: '2026-07-28T09:01:00.000Z', businessDate: '2026-07-28',
  });
  await registerCanonicalImagingInstance(db, {
    tenantId: 'tenant-a', studyPublicId: 'study-101', seriesPublicId: 'series-101',
    instancePublicId: 'instance-101', sopUidNamespace: 'dicom',
    sopInstanceUid: '1.2.840.113619.2.55.3.101.1.1', sopClassUid: '1.2.840.10008.5.1.4.1.1.1',
    instanceNumber: 1, frameCount: 1, transferSyntaxUid: '1.2.840.10008.1.2.1',
    objectContentSha256: '5'.repeat(64), byteSize: 2048,
    storageProviderType: 'r2', storageProviderPublicId: 'radiology-images',
    storageObjectKey: 'study/series/instance.dcm', storageGeneration: '1',
    sourceType: 'legacy_dicom_instance', sourcePublicId: '901',
    sourceTable: 'radiology_dicom_instances', sourceEvidenceSha256: '6'.repeat(64),
    actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'instance-register-101',
    occurredAtUtc: '2026-07-28T09:02:00.000Z', businessDate: '2026-07-28',
  });
}

async function createReport(db: CanonicalBatchDatabase): Promise<void> {
  await buildHierarchy(db);
  await createCanonicalImagingReportDraft(db, reportInput());
}

describe('canonical radiology acquisition and report commands', () => {
  it('atomically registers an exact acquisition with replay, mapping, receipt, PHI-minimised outbox, and rollback', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_radiology_compat(marker) VALUES (?)`).bind('requisition-501');
      const first = await registerCanonicalImagingAcquisition(db, acquisitionInput(), { authoritativeStatements: [compatibility] });
      const second = await registerCanonicalImagingAcquisition(db, acquisitionInput());
      expect(first).toEqual({ status: 'applied', result: {
        acquisitionPublicId: 'acquisition-101', currentStatus: 'scheduled', statusVersion: 1,
      } });
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(count(sqlite, 'canonical_imaging_acquisitions')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_acquisition_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_radiology_compat')).toBe(1);
      const payload = String((sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events`).get() as { payload_json: string }).payload_json);
      for (const forbidden of ['patient-link-101','encounter-101','request-101','service-img-101','ACC-101','CR']) {
        expect(payload).not.toContain(forbidden);
      }
      await expect(registerCanonicalImagingAcquisition(db, acquisitionInput({ modalityCode: 'DX' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      const rollback = harness();
      try {
        await expect(registerCanonicalImagingAcquisition(rollback.db, acquisitionInput({
          idempotencyKey: 'acquisition-rollback', outboxEventPublicId: 'acquisition-rollback-outbox',
        }), { authoritativeStatements: [
          rollback.db.prepare(`INSERT INTO legacy_radiology_compat(marker) VALUES ('rollback')`),
          rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)'),
        ] })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_imaging_acquisitions')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_outbox_events')).toBe(0);
        expect(count(rollback.sqlite, 'legacy_radiology_compat')).toBe(0);
      } finally { rollback.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('starts, completes, cancels, and enters acquisitions in error through optimistic immutable events', async () => {
    const { sqlite, db } = harness();
    try {
      await registerAcquisition(db);
      await expect(startCanonicalImagingAcquisition(db, {
        tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-101', expectedStatusVersion: 1,
        performingPractitionerPublicId: 'practitioner-101', modalitySourceType: 'legacy_modality',
        modalitySourcePublicId: 'modality-1', sourceEvidenceSha256: '7'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'acquisition-start-101',
        occurredAtUtc: '2026-07-28T09:00:00.000Z', recordedAtUtc: '2026-07-28T09:00:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'in_progress', statusVersion: 2 } });
      await expect(completeCanonicalImagingAcquisition(db, {
        tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-101', expectedStatusVersion: 2,
        performingPractitionerPublicId: 'practitioner-101', sourceEvidenceSha256: '8'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'acquisition-complete-101',
        occurredAtUtc: '2026-07-28T09:10:00.000Z', recordedAtUtc: '2026-07-28T09:10:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'completed', statusVersion: 3 } });
      expect(count(sqlite, 'canonical_imaging_acquisition_status_events')).toBe(3);

      const cancelled = harness();
      try {
        await registerAcquisition(cancelled.db);
        await expect(cancelCanonicalImagingAcquisition(cancelled.db, {
          tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-101', expectedStatusVersion: 1,
          practitionerPublicId: 'practitioner-101', reasonCode: 'patient_unavailable',
          sourceEvidenceSha256: '9'.repeat(64), actorSystemKey: 'canonical.radiology.test',
          idempotencyKey: 'acquisition-cancel-101', occurredAtUtc: '2026-07-28T08:30:00.000Z',
          recordedAtUtc: '2026-07-28T08:30:00.000Z', businessDate: '2026-07-28',
        })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'cancelled', statusVersion: 2 } });
      } finally { cancelled.sqlite.close(); }

      const errored = harness();
      try {
        await registerAcquisition(errored.db);
        await expect(enterCanonicalImagingAcquisitionInError(errored.db, {
          tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-101', expectedStatusVersion: 1,
          practitionerPublicId: 'practitioner-101', reasonCode: 'wrong_patient_mapping',
          sourceEvidenceSha256: 'a'.repeat(64), actorSystemKey: 'canonical.radiology.test',
          idempotencyKey: 'acquisition-error-101', occurredAtUtc: '2026-07-28T08:31:00.000Z',
          recordedAtUtc: '2026-07-28T08:31:00.000Z', businessDate: '2026-07-28',
        })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'entered_in_error', statusVersion: 2 } });
      } finally { errored.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('registers exact Study, Series, SOP instance and immutable PACS/storage provenance with collision protection', async () => {
    const { sqlite, db } = harness();
    try {
      await buildHierarchy(db);
      const provenance = {
        tenantId: 'tenant-a', acquisitionPublicId: 'acquisition-101', studyPublicId: 'study-101',
        seriesPublicId: 'series-101', instancePublicId: 'instance-101',
        provenanceEventPublicId: 'provenance-101', eventType: 'stored' as const,
        disposition: 'accepted' as const, eventVersion: 1,
        modalitySourceType: 'legacy_modality', modalitySourcePublicId: 'modality-1',
        sourceAeTitle: 'MODALITY_AE', pacsEndpointSourceType: 'legacy_pacs',
        pacsEndpointSourcePublicId: 'pacs-1', protocol: 'DICOM',
        objectContentSha256: '5'.repeat(64), storageProviderType: 'r2',
        storageProviderPublicId: 'radiology-images', storageObjectKey: 'study/series/instance.dcm',
        storageGeneration: '1', sourceType: 'legacy_dicom_forward', sourcePublicId: '1001',
        sourceTable: 'radiology_dicom_studies', sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'provenance-record-101',
        occurredAtUtc: '2026-07-28T09:03:00.000Z', recordedAtUtc: '2026-07-28T09:03:00.000Z',
        reasonCode: 'stored', businessDate: '2026-07-28',
      };
      const first = await recordCanonicalImagingProvenance(db, provenance);
      const second = await recordCanonicalImagingProvenance(db, provenance);
      expect(first.status).toBe('applied');
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(count(sqlite, 'canonical_imaging_studies')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_series')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_instances')).toBe(1);
      expect(count(sqlite, 'canonical_imaging_provenance_events')).toBe(1);
      expect(() => sqlite.prepare(`UPDATE canonical_imaging_instances SET storage_object_key='changed.dcm'`).run()).toThrow(/immutable/i);
      await expect(registerCanonicalImagingInstance(db, {
        tenantId: 'tenant-a', studyPublicId: 'study-101', seriesPublicId: 'series-101',
        instancePublicId: 'instance-collision', sopUidNamespace: 'dicom',
        sopInstanceUid: '1.2.840.113619.2.55.3.101.1.1', sopClassUid: '1.2.840.10008.5.1.4.1.1.1',
        frameCount: 1, objectContentSha256: 'c'.repeat(64), byteSize: 2048,
        storageProviderType: 'r2', storageProviderPublicId: 'radiology-images',
        storageObjectKey: 'changed.dcm', storageGeneration: '2', sourceType: 'legacy_dicom_instance',
        sourcePublicId: 'collision', sourceTable: 'radiology_dicom_instances', sourceEvidenceSha256: 'd'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'instance-collision',
        occurredAtUtc: '2026-07-28T09:04:00.000Z', businessDate: '2026-07-28',
      })).rejects.toThrow(/collision|already|unique/i);
    } finally { sqlite.close(); }
  });

  it('creates and replaces complete immutable report drafts with replay and rollback', async () => {
    const { sqlite, db } = harness();
    try {
      await buildHierarchy(db);
      const first = await createCanonicalImagingReportDraft(db, reportInput());
      expect(first).toEqual({ status: 'applied', result: {
        reportSetPublicId: 'report-set-101', versionPublicId: 'report-version-101-v1',
        currentStatus: 'draft', statusVersion: 1, versionNumber: 1,
      } });
      const original = sqlite.prepare(`SELECT content_json,content_sha256,version_status FROM canonical_imaging_report_versions WHERE version_number=1`).get();
      await expect(replaceCanonicalImagingReportDraft(db, {
        tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', expectedStatusVersion: 1,
        versionPublicId: 'report-version-101-v2', authoringPractitionerPublicId: 'practitioner-102',
        reasonCode: 'draft_replaced', content: {
          indication: 'Cough', technique: 'PA chest', findings: 'Mild opacity',
          impression: 'Possible infection', comparison: null, recommendations: 'Follow-up',
        }, sourceEvidenceSha256: 'e'.repeat(64), actorSystemKey: 'canonical.radiology.test',
        idempotencyKey: 'report-replace-101', occurredAtUtc: '2026-07-28T10:05:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: {
        versionPublicId: 'report-version-101-v2', statusVersion: 2, versionNumber: 2,
      } });
      expect(sqlite.prepare(`SELECT content_json,content_sha256,version_status FROM canonical_imaging_report_versions WHERE version_number=1`).get()).toEqual(original);
      expect(count(sqlite, 'canonical_imaging_report_versions')).toBe(2);

      const rollback = harness();
      try {
        await buildHierarchy(rollback.db);
        await expect(createCanonicalImagingReportDraft(rollback.db, reportInput({
          idempotencyKey: 'report-rollback', outboxEventPublicId: 'report-rollback-outbox',
        }), { authoritativeStatements: [
          rollback.db.prepare(`INSERT INTO legacy_radiology_compat(marker) VALUES ('report')`),
          rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)'),
        ] })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_imaging_report_sets')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_imaging_report_versions')).toBe(0);
      } finally { rollback.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('verifies then finalises and publishes one exact signed immutable report version', async () => {
    const { sqlite, db } = harness();
    try {
      await createReport(db);
      const content = sqlite.prepare(`SELECT content_sha256 FROM canonical_imaging_report_versions WHERE version_public_id='report-version-101-v1'`).get() as { content_sha256: string };
      await expect(verifyCanonicalImagingReportVersion(db, {
        tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', versionPublicId: 'report-version-101-v1',
        expectedStatusVersion: 1, verifyingPractitionerPublicId: 'practitioner-102',
        signedContentSha256: content.content_sha256, reasonCode: 'verified',
        sourceEvidenceSha256: 'f'.repeat(64), actorSystemKey: 'canonical.radiology.test',
        idempotencyKey: 'report-verify-101', occurredAtUtc: '2026-07-28T10:10:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'verified', statusVersion: 2 } });
      await expect(finalizeAndPublishCanonicalImagingReportVersion(db, {
        tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', versionPublicId: 'report-version-101-v1',
        expectedStatusVersion: 2, finalisingPractitionerPublicId: 'practitioner-103',
        signedContentSha256: content.content_sha256, finalisationReasonCode: 'finalised',
        publicationReasonCode: 'published', sourceEvidenceSha256: '0'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'report-publish-101',
        finalisedAtUtc: '2026-07-28T10:15:00.000Z', publishedAtUtc: '2026-07-28T10:16:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'published', statusVersion: 4 } });
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_imaging_report_sets`).get())
        .toEqual({ current_status: 'published', status_version: 4 });
      expect(sqlite.prepare(`SELECT version_status,verifying_practitioner_public_id,finalising_practitioner_public_id FROM canonical_imaging_report_versions`).get())
        .toEqual({ version_status: 'published', verifying_practitioner_public_id: 'practitioner-102', finalising_practitioner_public_id: 'practitioner-103' });
      await expect(verifyCanonicalImagingReportVersion(db, {
        tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', versionPublicId: 'report-version-101-v1',
        expectedStatusVersion: 4, verifyingPractitionerPublicId: 'practitioner-102',
        signedContentSha256: '1'.repeat(64), reasonCode: 'bad', sourceEvidenceSha256: '2'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'report-bad-hash',
        occurredAtUtc: '2026-07-28T10:20:00.000Z', businessDate: '2026-07-28',
      })).rejects.toThrow(/content hash|draft/i);
    } finally { sqlite.close(); }
  });

  it('corrects, retracts, and enters reports in error through replacement versions without rewriting prior evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await createReport(db);
      const original = sqlite.prepare(`SELECT content_json,content_sha256,version_status FROM canonical_imaging_report_versions WHERE version_number=1`).get();
      await expect(correctCanonicalImagingReportVersion(db, {
        tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', expectedStatusVersion: 1,
        versionPublicId: 'report-version-101-v2', authoringPractitionerPublicId: 'practitioner-102',
        reasonCode: 'corrected_findings', content: {
          indication: 'Cough', technique: 'PA chest', findings: 'Right lower opacity',
          impression: 'Right lower pneumonia', comparison: null, recommendations: 'Clinical correlation',
        }, sourceEvidenceSha256: '3'.repeat(64), actorSystemKey: 'canonical.radiology.test',
        idempotencyKey: 'report-correct-101', occurredAtUtc: '2026-07-28T10:30:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'draft', statusVersion: 2, versionNumber: 2 } });
      expect(sqlite.prepare(`SELECT content_json,content_sha256,version_status FROM canonical_imaging_report_versions WHERE version_number=1`).get()).toEqual(original);
      await expect(retractCanonicalImagingReportVersion(db, {
        tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', expectedStatusVersion: 2,
        versionPublicId: 'report-version-101-v3', authoringPractitionerPublicId: 'practitioner-103',
        reasonCode: 'wrong_study', sourceEvidenceSha256: '4'.repeat(64),
        actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'report-retract-101',
        occurredAtUtc: '2026-07-28T10:35:00.000Z', businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'retracted', statusVersion: 3, versionNumber: 3 } });
      expect(count(sqlite, 'canonical_imaging_report_versions')).toBe(3);

      const other = harness();
      try {
        await createReport(other.db);
        await expect(enterCanonicalImagingReportInError(other.db, {
          tenantId: 'tenant-a', reportSetPublicId: 'report-set-101', expectedStatusVersion: 1,
          versionPublicId: 'report-version-101-error', authoringPractitionerPublicId: 'practitioner-103',
          reasonCode: 'wrong_patient_link', sourceEvidenceSha256: '5'.repeat(64),
          actorSystemKey: 'canonical.radiology.test', idempotencyKey: 'report-error-101',
          occurredAtUtc: '2026-07-28T10:40:00.000Z', businessDate: '2026-07-28',
        })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'entered_in_error', statusVersion: 2 } });
      } finally { other.sqlite.close(); }
    } finally { sqlite.close(); }
  });
});
