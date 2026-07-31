import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  attachCanonicalLabAnalyzerEvidence,
  collectCanonicalLabSpecimen,
  correctCanonicalLabResultVersion,
  createCanonicalLabResultDraft,
  createCanonicalLabSpecimenAliquot,
  enterCanonicalLabResultInError,
  receiveCanonicalLabSpecimen,
  registerCanonicalLabSpecimen,
  rejectCanonicalLabSpecimen,
  replaceCanonicalLabResultDraft,
  retractCanonicalLabResultVersion,
  validateAndPublishCanonicalLabResultVersion,
  verifyCanonicalLabResultVersion,
  type CreateCanonicalLabResultDraftInput,
  type RegisterCanonicalLabSpecimenInput,
} from '../../src/lib/canonical/commands/manage-lab-result-specimen';

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
    'migrations/0558_canonical_lab_result_specimen.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`CREATE TABLE legacy_lab_compat(id INTEGER PRIMARY KEY AUTOINCREMENT,marker TEXT NOT NULL UNIQUE)`);
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
    ['tenant-a', 'practitioner-101', 'Collector', '4'],
    ['tenant-a', 'practitioner-102', 'Verifier', '5'],
    ['tenant-a', 'practitioner-103', 'Validator', '6'],
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
    ['tenant-a', 'service-lab-101', 'LAB-CBC', 'CBC', 'b'],
    ['tenant-a', 'service-lab-202', 'LAB-CRP', 'CRP', 'c'],
    ['tenant-b', 'service-lab-301', 'LAB-B', 'Other lab', 'd'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    ) VALUES (?,?,'laboratory',?,?,'test','active',?)`).run(tenant, service, code, name, hash.repeat(64));
  }
  for (const [tenant, request, patientId, encounter, service, hash] of [
    ['tenant-a', 'request-101', 101, 'encounter-101', 'service-lab-101', 'e'],
    ['tenant-a', 'request-202', 202, 'encounter-202', 'service-lab-202', 'f'],
    ['tenant-b', 'request-301', 301, 'encounter-301', 'service-lab-301', '0'],
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

function specimenInput(overrides: Partial<RegisterCanonicalLabSpecimenInput> = {}): RegisterCanonicalLabSpecimenInput {
  return {
    tenantId: 'tenant-a',
    specimenPublicId: 'specimen-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    requestPublicId: 'request-101',
    servicePublicId: 'service-lab-101',
    eventPublicId: 'request-101-event',
    accessionNamespace: 'tenant-lab',
    accessionValue: 'ACC-101',
    barcodeNamespace: 'tenant-lab',
    barcodeValue: 'BAR-101',
    specimenTypeCode: 'blood',
    containerCode: 'edta',
    sourceType: 'legacy_lab_specimen',
    sourcePublicId: '501',
    sourceTable: 'lab_specimens',
    sourceEvidenceSha256: '1'.repeat(64),
    actorSystemKey: 'canonical.lab.test',
    idempotencyKey: 'lab-specimen-register-101',
    outboxEventPublicId: 'lab-specimen-register-outbox-101',
    occurredAtUtc: '2026-07-28T09:00:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function resultInput(overrides: Partial<CreateCanonicalLabResultDraftInput> = {}): CreateCanonicalLabResultDraftInput {
  return {
    tenantId: 'tenant-a',
    resultSetPublicId: 'result-set-101',
    versionPublicId: 'result-version-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    requestPublicId: 'request-101',
    eventPublicId: 'request-101-event',
    specimenPublicId: 'specimen-101',
    servicePublicId: 'service-lab-101',
    creatingPractitionerPublicId: 'practitioner-101',
    observations: [
      {
        observationPublicId: 'observation-101',
        servicePublicId: 'service-lab-101',
        componentSourceType: 'legacy_lab_component',
        componentSourcePublicId: 'hb',
        observationCode: 'HB',
        codeSystem: 'local',
        displaySnapshot: 'Haemoglobin',
        valueType: 'decimal',
        valueDecimal: '13.50',
        unitCode: 'g/dL',
        referenceLowDecimal: '12.0',
        referenceHighDecimal: '16.0',
        interpretationCode: 'normal',
        observationStatus: 'final',
        sourceEvidenceSha256: '2'.repeat(64),
      },
    ],
    sourceType: 'legacy_lab_result_set',
    sourcePublicId: '701',
    sourceTable: 'lab_reports',
    sourceEvidenceSha256: '3'.repeat(64),
    actorSystemKey: 'canonical.lab.test',
    idempotencyKey: 'lab-result-create-101',
    outboxEventPublicId: 'lab-result-create-outbox-101',
    occurredAtUtc: '2026-07-28T10:00:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function registerSpecimen(db: CanonicalBatchDatabase): Promise<void> {
  await registerCanonicalLabSpecimen(db, specimenInput());
}

async function createResult(db: CanonicalBatchDatabase): Promise<void> {
  await registerSpecimen(db);
  await createCanonicalLabResultDraft(db, resultInput());
}

describe('canonical lab result and specimen commands', () => {
  it('atomically registers an exact specimen with initial custody event, service link, mapping, replay, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_lab_compat(marker) VALUES (?)`).bind('specimen-501');
      const first = await registerCanonicalLabSpecimen(db, specimenInput(), { authoritativeStatements: [compatibility] });
      const second = await registerCanonicalLabSpecimen(db, specimenInput());
      expect(first).toEqual({ status: 'applied', result: {
        specimenPublicId: 'specimen-101', currentStatus: 'registered', statusVersion: 1,
      } });
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(count(sqlite, 'canonical_lab_specimens')).toBe(1);
      expect(count(sqlite, 'canonical_lab_specimen_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_lab_specimen_service_items')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_lab_compat')).toBe(1);
      const payload = String((sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events`).get() as { payload_json: string }).payload_json);
      for (const forbidden of ['patient-link-101','encounter-101','request-101','ACC-101','BAR-101','blood']) {
        expect(payload).not.toContain(forbidden);
      }
      await expect(registerCanonicalLabSpecimen(db, specimenInput({ barcodeValue: 'BAR-CHANGED' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally { sqlite.close(); }
  });

  it('validates exact scope and rolls registration back completely on any statement failure', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(registerCanonicalLabSpecimen(db, specimenInput({
        idempotencyKey: 'lab-specimen-cross-scope', outboxEventPublicId: 'cross-scope',
        patientLinkPublicId: 'patient-link-202',
      }))).rejects.toThrow(/scope mismatch|request/i);
      const compatibility = db.prepare(`INSERT INTO legacy_lab_compat(marker) VALUES (?)`).bind('rollback');
      await expect(registerCanonicalLabSpecimen(db, specimenInput({
        idempotencyKey: 'lab-specimen-rollback', outboxEventPublicId: 'rollback-outbox',
      }), { authoritativeStatements: [compatibility, db.prepare('INSERT INTO missing_table(x) VALUES (1)')] }))
        .rejects.toThrow();
      expect(count(sqlite, 'canonical_lab_specimens')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(count(sqlite, 'legacy_lab_compat')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('collects, receives, rejects, and creates aliquots through immutable optimistic custody events', async () => {
    const { sqlite, db } = harness();
    try {
      await registerSpecimen(db);
      await expect(collectCanonicalLabSpecimen(db, {
        tenantId: 'tenant-a', specimenPublicId: 'specimen-101', expectedStatusVersion: 1,
        practitionerPublicId: 'practitioner-101', collectionMethodCode: 'venipuncture',
        locationSourceType: 'legacy_lab_location', locationSourcePublicId: 'collection-room',
        sourceEvidenceSha256: '4'.repeat(64), actorSystemKey: 'canonical.lab.test',
        idempotencyKey: 'lab-specimen-collect-101', outboxEventPublicId: 'collect-outbox',
        occurredAtUtc: '2026-07-28T09:05:00.000Z', recordedAtUtc: '2026-07-28T09:06:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'collected', statusVersion: 2 } });
      await expect(receiveCanonicalLabSpecimen(db, {
        tenantId: 'tenant-a', specimenPublicId: 'specimen-101', expectedStatusVersion: 2,
        practitionerPublicId: 'practitioner-101', transportConditionCode: 'ambient_ok',
        locationSourceType: 'legacy_lab_location', locationSourcePublicId: 'lab-receiving',
        sourceEvidenceSha256: '5'.repeat(64), actorSystemKey: 'canonical.lab.test',
        idempotencyKey: 'lab-specimen-receive-101', outboxEventPublicId: 'receive-outbox',
        occurredAtUtc: '2026-07-28T09:15:00.000Z', recordedAtUtc: '2026-07-28T09:16:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'received', statusVersion: 3 } });
      await expect(createCanonicalLabSpecimenAliquot(db, {
        tenantId: 'tenant-a', parentSpecimenPublicId: 'specimen-101', expectedParentStatusVersion: 3,
        aliquotSpecimenPublicId: 'specimen-101-a1', accessionNamespace: 'tenant-lab',
        accessionValue: 'ACC-101-A1', barcodeNamespace: 'tenant-lab', barcodeValue: 'BAR-101-A1',
        specimenTypeCode: 'plasma', containerCode: 'aliquot_tube', practitionerPublicId: 'practitioner-101',
        sourceType: 'legacy_lab_specimen_aliquot', sourcePublicId: '501:a1', sourceTable: 'lab_specimens',
        sourceEvidenceSha256: '6'.repeat(64), actorSystemKey: 'canonical.lab.test',
        idempotencyKey: 'lab-specimen-aliquot-101', outboxEventPublicId: 'aliquot-outbox',
        occurredAtUtc: '2026-07-28T09:20:00.000Z', businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: {
        specimenPublicId: 'specimen-101-a1', parentSpecimenPublicId: 'specimen-101', currentStatus: 'registered',
      } });
      expect(count(sqlite, 'canonical_lab_specimens')).toBe(2);
      expect(count(sqlite, 'canonical_lab_specimen_status_events')).toBe(4);

      const other = harness();
      try {
        await registerCanonicalLabSpecimen(other.db, specimenInput());
        await collectCanonicalLabSpecimen(other.db, {
          tenantId: 'tenant-a', specimenPublicId: 'specimen-101', expectedStatusVersion: 1,
          practitionerPublicId: 'practitioner-101', sourceEvidenceSha256: '7'.repeat(64),
          actorSystemKey: 'canonical.lab.test', idempotencyKey: 'collect-for-reject',
          occurredAtUtc: '2026-07-28T09:05:00.000Z', recordedAtUtc: '2026-07-28T09:05:00.000Z',
          businessDate: '2026-07-28',
        });
        await expect(rejectCanonicalLabSpecimen(other.db, {
          tenantId: 'tenant-a', specimenPublicId: 'specimen-101', expectedStatusVersion: 2,
          practitionerPublicId: 'practitioner-101', reasonCode: 'hemolysed',
          sourceEvidenceSha256: '8'.repeat(64), actorSystemKey: 'canonical.lab.test',
          idempotencyKey: 'reject-101', outboxEventPublicId: 'reject-outbox',
          occurredAtUtc: '2026-07-28T09:07:00.000Z', recordedAtUtc: '2026-07-28T09:07:00.000Z',
          businessDate: '2026-07-28',
        })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'rejected', statusVersion: 3 } });
      } finally { other.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('creates and replaces complete immutable result drafts with canonical decimal observations and rollback', async () => {
    const { sqlite, db } = harness();
    try {
      await registerSpecimen(db);
      const first = await createCanonicalLabResultDraft(db, resultInput());
      expect(first).toEqual({ status: 'applied', result: {
        resultSetPublicId: 'result-set-101', versionPublicId: 'result-version-101-v1',
        currentStatus: 'draft', statusVersion: 1, versionNumber: 1, observationCount: 1,
      } });
      expect(sqlite.prepare(`SELECT value_decimal,reference_low_decimal,reference_high_decimal FROM canonical_lab_result_observations`).get()).toEqual({
        value_decimal: '13.5', reference_low_decimal: '12', reference_high_decimal: '16',
      });
      const old = sqlite.prepare(`SELECT content_sha256,version_status FROM canonical_lab_result_versions WHERE version_number=1`).get();
      await expect(replaceCanonicalLabResultDraft(db, {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', expectedStatusVersion: 1,
        versionPublicId: 'result-version-101-v2', authoringPractitionerPublicId: 'practitioner-101',
        reasonCode: 'draft_replaced', observations: [{
          observationPublicId: 'observation-102', servicePublicId: 'service-lab-101',
          componentSourceType: 'legacy_lab_component', componentSourcePublicId: 'hb',
          observationCode: 'HB', codeSystem: 'local', displaySnapshot: 'Haemoglobin',
          valueType: 'decimal', valueDecimal: '14.0', unitCode: 'g/dL', observationStatus: 'final',
          sourceEvidenceSha256: '9'.repeat(64),
        }],
        sourceEvidenceSha256: 'a'.repeat(64), actorSystemKey: 'canonical.lab.test',
        idempotencyKey: 'replace-result-draft-101', outboxEventPublicId: 'replace-result-outbox',
        occurredAtUtc: '2026-07-28T10:05:00.000Z', businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: {
        versionPublicId: 'result-version-101-v2', statusVersion: 2, versionNumber: 2,
      } });
      expect(sqlite.prepare(`SELECT content_sha256,version_status FROM canonical_lab_result_versions WHERE version_number=1`).get()).toEqual(old);
      expect(count(sqlite, 'canonical_lab_result_versions')).toBe(2);

      const rollback = harness();
      try {
        await registerSpecimen(rollback.db);
        await expect(createCanonicalLabResultDraft(rollback.db, resultInput({
          idempotencyKey: 'result-rollback', outboxEventPublicId: 'result-rollback-outbox',
        }), { authoritativeStatements: [rollback.db.prepare(`INSERT INTO legacy_lab_compat(marker) VALUES ('result')`), rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)')] })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_lab_result_sets')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_lab_result_versions')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_lab_result_observations')).toBe(0);
      } finally { rollback.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('verifies then validates and publishes one exact signed immutable result version', async () => {
    const { sqlite, db } = harness();
    try {
      await createResult(db);
      const content = sqlite.prepare(`SELECT content_sha256 FROM canonical_lab_result_versions WHERE version_public_id='result-version-101-v1'`).get() as { content_sha256: string };
      await expect(verifyCanonicalLabResultVersion(db, {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', versionPublicId: 'result-version-101-v1',
        expectedStatusVersion: 1, verifyingPractitionerPublicId: 'practitioner-102',
        signedContentSha256: content.content_sha256, reasonCode: 'verified', sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.lab.test', idempotencyKey: 'verify-result-101',
        outboxEventPublicId: 'verify-result-outbox', occurredAtUtc: '2026-07-28T10:10:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'verified', statusVersion: 2 } });
      await expect(validateAndPublishCanonicalLabResultVersion(db, {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', versionPublicId: 'result-version-101-v1',
        expectedStatusVersion: 2, validatingPractitionerPublicId: 'practitioner-103',
        signedContentSha256: content.content_sha256, validationReasonCode: 'validated',
        publicationReasonCode: 'published', sourceEvidenceSha256: 'c'.repeat(64),
        actorSystemKey: 'canonical.lab.test', idempotencyKey: 'publish-result-101',
        outboxEventPublicId: 'publish-result-outbox', validatedAtUtc: '2026-07-28T10:15:00.000Z',
        publishedAtUtc: '2026-07-28T10:16:00.000Z', businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'published', statusVersion: 4 } });
      expect(sqlite.prepare(`SELECT current_status,status_version FROM canonical_lab_result_sets`).get()).toEqual({
        current_status: 'published', status_version: 4,
      });
      expect(sqlite.prepare(`SELECT version_status,verifying_practitioner_public_id,validating_practitioner_public_id FROM canonical_lab_result_versions`).get()).toEqual({
        version_status: 'published', verifying_practitioner_public_id: 'practitioner-102', validating_practitioner_public_id: 'practitioner-103',
      });
      await expect(verifyCanonicalLabResultVersion(db, {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', versionPublicId: 'result-version-101-v1',
        expectedStatusVersion: 4, verifyingPractitionerPublicId: 'practitioner-102',
        signedContentSha256: '0'.repeat(64), reasonCode: 'bad', sourceEvidenceSha256: 'd'.repeat(64),
        actorSystemKey: 'canonical.lab.test', idempotencyKey: 'verify-bad-hash',
        occurredAtUtc: '2026-07-28T10:20:00.000Z', businessDate: '2026-07-28',
      })).rejects.toThrow(/content hash|draft/i);
    } finally { sqlite.close(); }
  });

  it('corrects, retracts, and enters results in error through complete replacement versions without rewriting prior evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await createResult(db);
      const original = sqlite.prepare(`SELECT content_sha256,version_status FROM canonical_lab_result_versions WHERE version_number=1`).get();
      await expect(correctCanonicalLabResultVersion(db, {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', expectedStatusVersion: 1,
        versionPublicId: 'result-version-101-v2', authoringPractitionerPublicId: 'practitioner-102',
        reasonCode: 'corrected_value', observations: [{
          observationPublicId: 'observation-corrected', servicePublicId: 'service-lab-101',
          componentSourceType: 'legacy_lab_component', componentSourcePublicId: 'hb',
          observationCode: 'HB', codeSystem: 'local', displaySnapshot: 'Haemoglobin', valueType: 'decimal',
          valueDecimal: '12.8', unitCode: 'g/dL', observationStatus: 'corrected',
          sourceEvidenceSha256: 'e'.repeat(64),
        }],
        sourceEvidenceSha256: 'f'.repeat(64), actorSystemKey: 'canonical.lab.test',
        idempotencyKey: 'correct-result-101', outboxEventPublicId: 'correct-result-outbox',
        occurredAtUtc: '2026-07-28T10:30:00.000Z', businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'draft', statusVersion: 2, versionNumber: 2 } });
      expect(sqlite.prepare(`SELECT content_sha256,version_status FROM canonical_lab_result_versions WHERE version_number=1`).get()).toEqual(original);
      await expect(retractCanonicalLabResultVersion(db, {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', expectedStatusVersion: 2,
        versionPublicId: 'result-version-101-v3', authoringPractitionerPublicId: 'practitioner-103',
        reasonCode: 'specimen_compromised', sourceEvidenceSha256: '0'.repeat(64),
        actorSystemKey: 'canonical.lab.test', idempotencyKey: 'retract-result-101',
        outboxEventPublicId: 'retract-result-outbox', occurredAtUtc: '2026-07-28T10:35:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'retracted', statusVersion: 3, versionNumber: 3 } });
      expect(count(sqlite, 'canonical_lab_result_versions')).toBe(3);

      const other = harness();
      try {
        await createResult(other.db);
        await expect(enterCanonicalLabResultInError(other.db, {
          tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', expectedStatusVersion: 1,
          versionPublicId: 'result-version-101-error', authoringPractitionerPublicId: 'practitioner-103',
          reasonCode: 'wrong_patient_link', sourceEvidenceSha256: '1'.repeat(64),
          actorSystemKey: 'canonical.lab.test', idempotencyKey: 'error-result-101',
          outboxEventPublicId: 'error-result-outbox', occurredAtUtc: '2026-07-28T10:40:00.000Z',
          businessDate: '2026-07-28',
        })).resolves.toMatchObject({ status: 'applied', result: { currentStatus: 'entered_in_error', statusVersion: 2 } });
      } finally { other.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('attaches exact immutable analyzer evidence with source uniqueness, replay, and observation ownership', async () => {
    const { sqlite, db } = harness();
    try {
      await createResult(db);
      const command = {
        tenantId: 'tenant-a', resultSetPublicId: 'result-set-101', versionPublicId: 'result-version-101-v1',
        observationPublicId: 'observation-101', analyzerEvidencePublicId: 'analyzer-evidence-101',
        sourceType: 'lis_analyzer_inbox', sourcePublicId: 'inbox-101', ingestionMessagePublicId: 'message-101',
        observationIndex: 0, machineSourceType: 'legacy_lab_machine', machineSourcePublicId: 'machine-1',
        protocol: 'HL7', payloadSha256: '2'.repeat(64), qcState: 'passed' as const,
        validationState: 'passed' as const, matchState: 'matched' as const, disposition: 'accepted' as const,
        conversionFactorDecimal: '1.00', sourceEvidenceSha256: '3'.repeat(64),
        actorSystemKey: 'canonical.lab.test', idempotencyKey: 'attach-analyzer-101',
        outboxEventPublicId: 'attach-analyzer-outbox', occurredAtUtc: '2026-07-28T10:02:00.000Z',
        businessDate: '2026-07-28',
      };
      const first = await attachCanonicalLabAnalyzerEvidence(db, command);
      const second = await attachCanonicalLabAnalyzerEvidence(db, command);
      expect(first).toEqual({ status: 'applied', result: {
        analyzerEvidencePublicId: 'analyzer-evidence-101', observationPublicId: 'observation-101', disposition: 'accepted',
      } });
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(sqlite.prepare(`SELECT conversion_factor_decimal,payload_sha256 FROM canonical_lab_analyzer_evidence`).get()).toEqual({
        conversion_factor_decimal: '1', payload_sha256: '2'.repeat(64),
      });
      await expect(attachCanonicalLabAnalyzerEvidence(db, {
        ...command, analyzerEvidencePublicId: 'analyzer-evidence-duplicate', idempotencyKey: 'attach-analyzer-duplicate',
        outboxEventPublicId: 'attach-analyzer-duplicate-outbox',
      })).rejects.toThrow(/already mapped|UNIQUE|source/i);
      expect(() => sqlite.prepare(`UPDATE canonical_lab_analyzer_evidence SET qc_state='failed'`).run()).toThrow(/immutable/i);
    } finally { sqlite.close(); }
  });
});
