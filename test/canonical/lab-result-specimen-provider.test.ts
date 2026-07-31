import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  LabResultSpecimenProviderDatabase,
  LabResultSpecimenProviderPreparedStatement,
} from '../../src/lib/canonical/lab-result-specimen-provider';
import {
  resolveLabResultSpecimenProjection,
  resolveLabResultSpecimenProviderMode,
} from '../../src/lib/canonical/lab-result-specimen-provider';
import {
  readLabPatientResultTimelineAdapter,
  readLabReportSummaryAdapter,
  readLabSpecimenDetailAdapter,
} from '../../src/lib/canonical/lab-result-specimen-read-adapters';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements LabResultSpecimenProviderPreparedStatement {
  constructor(private readonly database: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.database, this.sql, values.map((value) => (value === undefined ? null : value)) as SqlValue[]);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function harness(): { sqlite: DatabaseSync; db: LabResultSpecimenProviderDatabase } {
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
  sqlite.exec(`
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      visit_id INTEGER NOT NULL,test_id INTEGER NOT NULL,specimen_id INTEGER,
      status TEXT,result_status TEXT,completed_at TEXT,updated_at TEXT
    );
    CREATE TABLE lab_specimens (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,patient_id INTEGER NOT NULL,
      collection_status TEXT NOT NULL,collected_by INTEGER,collected_at TEXT,
      received_by INTEGER,received_at TEXT,rejected_by INTEGER,rejected_at TEXT,
      created_at TEXT,updated_at TEXT
    );
    CREATE TABLE lab_specimen_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,specimen_id INTEGER NOT NULL,
      order_item_id INTEGER NOT NULL,test_id INTEGER NOT NULL
    );
    CREATE TABLE lab_results (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,order_item_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,visit_id INTEGER NOT NULL,specimen_id INTEGER NOT NULL,
      status TEXT NOT NULL,reported_by INTEGER,reported_at TEXT,verified_by INTEGER,
      verified_at TEXT,analyzer_inbox_id INTEGER,created_at TEXT,updated_at TEXT
    );
    CREATE TABLE lab_reports (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,order_item_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,visit_id INTEGER NOT NULL,report_status TEXT NOT NULL,
      reviewer_id INTEGER,validator_id INTEGER,verified_at TEXT,validated_at TEXT,
      published_at TEXT,created_at TEXT,updated_at TEXT
    );
  `);
  seed(sqlite);
  return { sqlite, db: { prepare(sql: string) { return new Statement(sqlite, sql); } } };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
      evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified',
              'no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-28T00:00:00.000Z');
  for (const [practitioner, userId, name, hash] of [
    ['practitioner-901', 901, 'Collector', '2'],
    ['practitioner-902', 902, 'Verifier', '3'],
    ['practitioner-903', 903, 'Validator', '4'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,
        source_evidence_sha256
      ) VALUES ('tenant-a',?,'internal',?,'active',1,?)
    `).run(practitioner, name, hash.repeat(64));
    sqlite.prepare(`
      INSERT INTO canonical_practitioner_user_links (
        tenant_id,practitioner_public_id,legacy_user_id,link_status,evidence_type
      ) VALUES ('tenant-a',?,?,'active','legacy_doctor_user_id')
    `).run(practitioner, userId);
  }
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-701',101,'patient-link-101','outpatient',
              'in_progress',1,'runtime',?,?)
  `).run('2026-07-28T08:00:00.000Z', '5'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,
      status,source_evidence_sha256
    ) VALUES ('tenant-a','service-lab-301','laboratory','LAB-HB','Haemoglobin','test','active',?)
  `).run('6'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_requests (
      tenant_id,request_public_id,legacy_patient_id,encounter_public_id,service_public_id,
      status,requested_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','request-501',101,'encounter-701','service-lab-301',
              'fulfilled',?,?)
  `).run('2026-07-28T08:10:00.000Z', '7'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,request_public_id,encounter_public_id,service_public_id,
      event_type,status,occurred_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','event-501','request-501','encounter-701','service-lab-301',
              'completed','posted',?,?)
  `).run('2026-07-28T09:00:00.000Z', '8'.repeat(64));

  sqlite.prepare(`INSERT INTO lab_order_items VALUES
    (501,'tenant-a',101,701,301,601,'completed','published','2026-07-28 10:00:00','2026-07-28 10:10:00'),
    (502,'tenant-a',101,701,301,602,'completed','final','2026-07-28 11:00:00','2026-07-28 11:05:00')`).run();
  sqlite.prepare(`INSERT INTO lab_specimens VALUES
    (601,'tenant-a',101,'received',901,'2026-07-28 15:00:00',901,'2026-07-28 15:15:00',NULL,NULL,'2026-07-28 14:50:00','2026-07-28 15:15:00'),
    (602,'tenant-a',101,'collected',901,'2026-07-28 10:30:00',NULL,NULL,NULL,NULL,'2026-07-28 10:20:00','2026-07-28 10:30:00')`).run();
  sqlite.prepare(`INSERT INTO lab_specimen_items VALUES
    (611,'tenant-a',601,501,301),(612,'tenant-a',602,502,301)`).run();
  sqlite.prepare(`INSERT INTO lab_results VALUES
    (801,'tenant-a',501,101,701,601,'final',901,'2026-07-28 10:00:00',902,'2026-07-28 10:05:00',1101,'2026-07-28 10:00:00','2026-07-28 10:05:00'),
    (802,'tenant-a',502,101,701,602,'final',901,'2026-07-28 11:00:00',NULL,NULL,NULL,'2026-07-28 11:00:00','2026-07-28 11:05:00')`).run();
  sqlite.prepare(`INSERT INTO lab_reports VALUES
    (901,'tenant-a',501,101,701,'published',902,903,'2026-07-28 10:05:00','2026-07-28 10:08:00','2026-07-28 10:10:00','2026-07-28 10:00:00','2026-07-28 10:10:00'),
    (902,'tenant-a',502,101,701,'draft',NULL,NULL,NULL,NULL,NULL,'2026-07-28 11:00:00','2026-07-28 11:05:00')`).run();

  sqlite.prepare(`
    INSERT INTO canonical_lab_specimens (
      tenant_id,specimen_public_id,patient_link_public_id,encounter_public_id,
      primary_request_public_id,primary_service_public_id,accession_namespace,
      accession_value,barcode_namespace,barcode_value,specimen_type_code,container_code,
      current_status,status_version,actor_system_key,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','specimen-601','patient-link-101','encounter-701','request-501',
              'service-lab-301','legacy','ACC-601','legacy','BAR-601','blood','edta',
              'registered',1,'provider.test','provider-specimen-601',?,?,?,?)
  `).run('9'.repeat(64), 'a'.repeat(64), '2026-07-28T08:50:00.000Z', '2026-07-28T08:50:00.000Z');
  const specimenEvent = sqlite.prepare(`
    INSERT INTO canonical_lab_specimen_status_events (
      tenant_id,event_public_id,specimen_public_id,from_status,to_status,event_version,event_type,
      actor_practitioner_public_id,actor_system_key,occurred_at_utc,recorded_at_utc,
      reason_code,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,'specimen-601',?,?,?,?,?,'provider.test',?,?,?, ?,?)
  `);
  specimenEvent.run('specimen-601-v1', null, 'registered', 1, 'registered', 'practitioner-901',
    '2026-07-28T08:50:00.000Z','2026-07-28T08:50:00.000Z','registered','b'.repeat(64),'2026-07-28T08:50:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_specimens SET current_status_event_public_id='specimen-601-v1' WHERE specimen_public_id='specimen-601'`).run();
  specimenEvent.run('specimen-601-v2', 'registered', 'collected', 2, 'collected', 'practitioner-901',
    '2026-07-28T09:00:00.000Z','2026-07-28T09:00:00.000Z','collected','c'.repeat(64),'2026-07-28T09:00:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_specimens SET current_status='collected',status_version=2,
    current_status_event_public_id='specimen-601-v2',collected_at_utc='2026-07-28T09:00:00.000Z',
    updated_at_utc='2026-07-28T09:00:00.000Z' WHERE specimen_public_id='specimen-601'`).run();
  specimenEvent.run('specimen-601-v3', 'collected', 'received', 3, 'received', 'practitioner-901',
    '2026-07-28T09:15:00.000Z','2026-07-28T09:15:00.000Z','received','d'.repeat(64),'2026-07-28T09:15:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_specimens SET current_status='received',status_version=3,
    current_status_event_public_id='specimen-601-v3',received_at_utc='2026-07-28T09:15:00.000Z',
    updated_at_utc='2026-07-28T09:15:00.000Z' WHERE specimen_public_id='specimen-601'`).run();
  sqlite.prepare(`INSERT INTO canonical_lab_specimen_service_items (
    tenant_id,link_public_id,specimen_public_id,request_public_id,event_public_id,
    service_public_id,relationship_role,source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','specimen-link-601','specimen-601','request-501','event-501',
            'service-lab-301','primary',?,?)`).run('e'.repeat(64),'2026-07-28T08:50:00.000Z');

  sqlite.prepare(`
    INSERT INTO canonical_lab_result_sets (
      tenant_id,result_set_public_id,patient_link_public_id,encounter_public_id,
      request_public_id,event_public_id,specimen_public_id,service_public_id,current_status,
      status_version,creating_practitioner_public_id,actor_system_key,idempotency_key,
      request_fingerprint_sha256,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','result-set-501','patient-link-101','encounter-701','request-501',
              'event-501','specimen-601','service-lab-301','draft',1,'practitioner-901',
              'provider.test','provider-result-501',?,?,?,?)
  `).run('f'.repeat(64), '0'.repeat(64), '2026-07-28T10:00:00.000Z', '2026-07-28T10:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_lab_result_versions (
      tenant_id,version_public_id,result_set_public_id,version_number,version_kind,
      version_status,content_sha256,authoring_practitioner_public_id,actor_system_key,
      authored_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','result-version-501-v1','result-set-501',1,'draft','draft',?,
              'practitioner-901','provider.test',?,?,?)
  `).run('1'.repeat(64), '2026-07-28T10:00:00.000Z', '2'.repeat(64), '2026-07-28T10:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_lab_result_observations (
      tenant_id,observation_public_id,result_set_public_id,version_public_id,
      observation_sequence,service_public_id,component_source_type,component_source_public_id,
      observation_code,code_system,display_snapshot,value_type,value_decimal,unit_code,
      reference_low_decimal,reference_high_decimal,interpretation_code,specimen_public_id,
      observation_status,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','observation-801','result-set-501','result-version-501-v1',1,
              'service-lab-301','legacy_lab_test','301','HB','local','Haemoglobin',
              'decimal','13.5','g/dL','12','16','normal','specimen-601','final',?,?)
  `).run('3'.repeat(64), '2026-07-28T10:00:00.000Z');
  const resultEvent = sqlite.prepare(`
    INSERT INTO canonical_lab_result_status_events (
      tenant_id,event_public_id,result_set_public_id,version_public_id,from_status,to_status,
      event_version,event_type,actor_practitioner_public_id,actor_system_key,
      signed_content_sha256,reason_code,occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a',?,'result-set-501','result-version-501-v1',?,?,?,?,?,
              'provider.test',?,?,?,?,?)
  `);
  resultEvent.run('result-501-e1', null, 'draft', 1, 'draft_created', 'practitioner-901', null,
    'draft_created','2026-07-28T10:00:00.000Z','4'.repeat(64),'2026-07-28T10:00:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_result_sets SET current_version_public_id='result-version-501-v1',
    current_status_event_public_id='result-501-e1' WHERE result_set_public_id='result-set-501'`).run();
  resultEvent.run('result-501-e2', 'draft', 'verified', 2, 'verified', 'practitioner-902', '1'.repeat(64),
    'verified','2026-07-28T10:05:00.000Z','5'.repeat(64),'2026-07-28T10:05:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_result_versions SET version_status='verified',signed_content_sha256=?,
    verifying_practitioner_public_id='practitioner-902',verified_at_utc='2026-07-28T10:05:00.000Z'
    WHERE version_public_id='result-version-501-v1'`).run('1'.repeat(64));
  sqlite.prepare(`UPDATE canonical_lab_result_sets SET current_status='verified',status_version=2,
    current_status_event_public_id='result-501-e2',updated_at_utc='2026-07-28T10:05:00.000Z'
    WHERE result_set_public_id='result-set-501'`).run();
  resultEvent.run('result-501-e3', 'verified', 'validated', 3, 'validated', 'practitioner-903', '1'.repeat(64),
    'validated','2026-07-28T10:08:00.000Z','6'.repeat(64),'2026-07-28T10:08:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_result_versions SET version_status='validated',
    validating_practitioner_public_id='practitioner-903',validated_at_utc='2026-07-28T10:08:00.000Z'
    WHERE version_public_id='result-version-501-v1'`).run();
  sqlite.prepare(`UPDATE canonical_lab_result_sets SET current_status='validated',status_version=3,
    current_status_event_public_id='result-501-e3',updated_at_utc='2026-07-28T10:08:00.000Z'
    WHERE result_set_public_id='result-set-501'`).run();
  resultEvent.run('result-501-e4', 'validated', 'published', 4, 'published', 'practitioner-903', '1'.repeat(64),
    'published','2026-07-28T10:10:00.000Z','7'.repeat(64),'2026-07-28T10:10:00.000Z');
  sqlite.prepare(`UPDATE canonical_lab_result_versions SET version_status='published',
    published_at_utc='2026-07-28T10:10:00.000Z' WHERE version_public_id='result-version-501-v1'`).run();
  sqlite.prepare(`UPDATE canonical_lab_result_sets SET current_status='published',status_version=4,
    current_status_event_public_id='result-501-e4',updated_at_utc='2026-07-28T10:10:00.000Z'
    WHERE result_set_public_id='result-set-501'`).run();
  sqlite.prepare(`
    INSERT INTO canonical_lab_analyzer_evidence (
      tenant_id,analyzer_evidence_public_id,result_set_public_id,version_public_id,
      observation_public_id,source_type,source_public_id,ingestion_message_public_id,
      observation_index,machine_source_type,machine_source_public_id,protocol,payload_sha256,
      qc_state,validation_state,match_state,disposition,conversion_factor_decimal,
      actor_system_key,occurred_at_utc,source_evidence_sha256,created_at_utc
    ) VALUES ('tenant-a','analyzer-1101','result-set-501','result-version-501-v1',
              'observation-801','lis_analyzer_inbox','inbox-1101','message-1091',0,
              'legacy_lab_machine','11','HL7',?,'passed','passed','matched','accepted','1',
              'provider.test',?,?,?)
  `).run('8'.repeat(64), '2026-07-28T10:00:00.000Z', '9'.repeat(64), '2026-07-28T10:00:00.000Z');

  const mapping = sqlite.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
      mapping_status,mapping_version,evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,?,'mapped',1,?)
  `);
  mapping.run('patient_link','patient-link-101','legacy_patient','101','patients','a'.repeat(64));
  mapping.run('encounter','encounter-701','legacy_visit','701','visits','b'.repeat(64));
  mapping.run('service_request','request-501','legacy_lab_order_item','501','lab_order_items','c'.repeat(64));
  mapping.run('service_event','event-501','legacy_lab_order_item_event','501','lab_order_items','d'.repeat(64));
  mapping.run('lab_specimen','specimen-601','legacy_lab_specimen','601','lab_specimens','e'.repeat(64));
  mapping.run('lab_result_set','result-set-501','legacy_lab_result_set','501','lab_results','f'.repeat(64));
}

function setMode(sqlite: DatabaseSync, mode: string, enabled = 1): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,created_at_utc,updated_at_utc
    ) VALUES ('tenant-a','canonical_lab_result_specimen_provider_v1',
              'lab_result_specimen',?,?,?,?)
  `).run(mode, enabled, '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z');
}

const evidence = {
  observedAtUtc: '2026-07-28T13:00:00.000Z',
  elapsedMs: 4,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [] as string[],
};

describe('canonical lab result and specimen provider', () => {
  it('defaults safely to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolveLabResultSpecimenProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      setMode(sqlite, 'canonical', 0);
      await expect(resolveLabResultSpecimenProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec('DELETE FROM canonical_feature_flags');
      setMode(sqlite, 'disabled', 0);
      await expect(resolveLabResultSpecimenProviderMode(db, 'tenant-a')).resolves.toBe('legacy');
      sqlite.exec('DELETE FROM canonical_feature_flags');
      setMode(sqlite, 'shadow');
      await expect(resolveLabResultSpecimenProviderMode(db, 'tenant-a')).resolves.toBe('shadow');
      sqlite.exec(`UPDATE canonical_feature_flags SET mode='canonical'`);
      await expect(resolveLabResultSpecimenProviderMode(db, 'tenant-a')).resolves.toBe('canonical');
    } finally { sqlite.close(); }
  });

  it('legacy mode preserves unmapped result output and identity-sensitive reads require exact mapping', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(resolveLabResultSpecimenProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_result_set', legacyId: 502,
      })).resolves.toMatchObject({
        mode: 'legacy', kind: 'result', canonicalPublicId: null,
        status: 'draft', observationCount: 1, historyVisible: false,
      });
      await expect(resolveLabResultSpecimenProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_result_set', legacyId: 502,
        identitySensitive: true,
      })).rejects.toThrow(/explicit lab result specimen source mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('shadow specimen adapter preserves legacy-facing output and emits aggregate PHI-minimised parity', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow');
      const result = await readLabSpecimenDetailAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_specimen', legacyId: 601,
      }, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', kind: 'specimen', canonicalPublicId: 'specimen-601',
        status: 'received', statusVersion: 0,
        parity: {
          mapping: true, patientLink: true, encounter: true, request: true,
          service: true, specimen: true, status: true, effectiveTime: true,
          custodyHistoryVisible: true,
        },
      });
      expect(result.shadowEvidence).toMatchObject({
        provider: 'lab_result_specimen', consumerId: 'cdb125e_specimen_detail',
        mode: 'shadow', comparisonCount: 13,
      });
      const json = JSON.stringify(result.shadowEvidence);
      for (const forbidden of [
        'patient-link-101','encounter-701','request-501','service-lab-301','specimen-601',
        '601','ACC-601','BAR-601','blood','13.5','observation-801','analyzer-1101',
      ]) expect(json).not.toContain(forbidden);
    } finally { sqlite.close(); }
  });

  it('canonical specimen mode requires mapping and exposes complete immutable custody history', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical');
      await expect(resolveLabResultSpecimenProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_specimen', legacyId: 601,
      })).resolves.toMatchObject({
        mode: 'canonical', kind: 'specimen', canonicalPublicId: 'specimen-601',
        status: 'received', statusVersion: 3, historyVisible: true,
        custodyHistory: [
          { eventVersion: 1, fromStatus: null, toStatus: 'registered' },
          { eventVersion: 2, fromStatus: 'registered', toStatus: 'collected' },
          { eventVersion: 3, fromStatus: 'collected', toStatus: 'received' },
        ],
      });
      await expect(resolveLabResultSpecimenProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_specimen', legacyId: 602,
      })).rejects.toThrow(/canonical lab result specimen mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('canonical result adapters expose version, observation, signature, and analyzer histories while rollback stays legacy', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical');
      const timeline = await readLabPatientResultTimelineAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_result_set', legacyId: 501,
      }, evidence);
      expect(timeline.projection).toMatchObject({
        mode: 'canonical', kind: 'result', canonicalPublicId: 'result-set-501',
        status: 'published', statusVersion: 4, versionNumber: 1,
        observationCount: 1, historyVisible: true,
      });
      expect(timeline.projection.versions).toHaveLength(1);
      expect(timeline.projection.observations).toMatchObject([
        { observationPublicId: 'observation-801', observationSequence: 1, valueType: 'decimal', valueDecimal: '13.5' },
      ]);
      expect(timeline.projection.statusHistory).toHaveLength(4);
      expect(timeline.projection.statusHistory.at(-1)).toMatchObject({
        eventType: 'published', signedContentSha256: '1'.repeat(64),
      });
      expect(timeline.projection.analyzerEvidence).toMatchObject([
        { analyzerEvidencePublicId: 'analyzer-1101', disposition: 'accepted', payloadSha256: '8'.repeat(64) },
      ]);
      expect(timeline.shadowEvidence).toBeNull();
      expect(timeline.rollbackMode).toBe('legacy');

      const report = await readLabReportSummaryAdapter(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_result_set', legacyId: 501,
      }, evidence);
      expect(report.projection.status).toBe('published');
      expect(report.rollbackMode).toBe('legacy');
      await expect(resolveLabResultSpecimenProjection(db, {
        tenantId: 'tenant-a', sourceType: 'legacy_lab_result_set', legacyId: 502,
      })).rejects.toThrow(/canonical lab result specimen mapping is required/i);
    } finally { sqlite.close(); }
  });
});
