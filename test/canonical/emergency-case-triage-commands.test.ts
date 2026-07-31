import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  correctCanonicalEmergencyCaseClassification,
  correctCanonicalEmergencyTriageAssessment,
  enterCanonicalEmergencyCaseInError,
  recordCanonicalEmergencyCaseClassification,
  recordCanonicalEmergencyDisposition,
  recordCanonicalEmergencyTriageAssessment,
  registerCanonicalEmergencyCase,
  replaceCanonicalEmergencyArrivalAssessment,
  transitionCanonicalEmergencyCase,
  type RecordCanonicalEmergencyDispositionInput,
  type RegisterCanonicalEmergencyCaseInput,
} from '../../src/lib/canonical/commands/manage-emergency-case-triage';

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
    'migrations/0555_canonical_clinical_document_diagnosis.sql',
    'migrations/0556_canonical_patient_vital_measurement.sql',
    'migrations/0560_canonical_emergency_case_triage.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec('CREATE TABLE legacy_emergency_compat(id INTEGER PRIMARY KEY AUTOINCREMENT, marker TEXT NOT NULL UNIQUE)');
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
  for (const [tenant, practitioner, name, status, hash] of [
    ['tenant-a', 'practitioner-triage', 'Triage Nurse', 'active', '4'],
    ['tenant-a', 'practitioner-emergency', 'Emergency Physician', 'active', '5'],
    ['tenant-a', 'practitioner-inactive', 'Inactive Clinician', 'inactive', '6'],
    ['tenant-b', 'practitioner-other', 'Other Tenant Clinician', 'active', '7'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES (?,?,'internal',?,?,1,?)`).run(tenant, practitioner, name, status, hash.repeat(64));
  }
  for (const [tenant, encounter, patientId, patientLink, encounterType, hash] of [
    ['tenant-a', 'encounter-er-101', 101, 'patient-link-101', 'emergency', '8'],
    ['tenant-a', 'encounter-er-202', 202, 'patient-link-202', 'emergency', '9'],
    ['tenant-a', 'encounter-opd-101', 101, 'patient-link-101', 'outpatient', 'a'],
    ['tenant-a', 'encounter-ipd-101', 101, 'patient-link-101', 'inpatient', 'b'],
    ['tenant-a', 'encounter-ipd-202', 202, 'patient-link-202', 'inpatient', 'c'],
    ['tenant-b', 'encounter-er-301', 301, 'patient-link-301', 'emergency', 'd'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,status,
      encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES (?,?,?,?,?,'in_progress',1,'runtime','2026-07-28T08:00:00.000Z',?)`).run(
      tenant, encounter, patientId, patientLink, encounterType, hash.repeat(64),
    );
  }
  for (const [admission, encounter, patientLink, number, hash] of [
    ['admission-101', 'encounter-ipd-101', 'patient-link-101', 'ADM-101', 'e'],
    ['admission-202', 'encounter-ipd-202', 'patient-link-202', 'ADM-202', 'f'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_admissions (
      tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,admission_number,
      admission_type,admission_source,current_status,status_version,admitted_at_utc,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,'emergency','emergency','admitted',1,'2026-07-28T10:00:00.000Z',?,?,?)`).run(
      admission, encounter, patientLink, number, `seed-${admission}`, hash.repeat(64), hash.repeat(64),
    );
  }
  sqlite.prepare(`INSERT INTO canonical_vital_observation_sets (
    tenant_id,observation_set_public_id,patient_link_public_id,encounter_public_id,practitioner_public_id,
    source_kind,effective_at_utc,recorded_at_utc,review_status,status_version,actor_system_key,
    idempotency_key,request_fingerprint_sha256,source_evidence_sha256
  ) VALUES ('tenant-a','vital-er-101','patient-link-101','encounter-er-101','practitioner-triage',
    'nurse_entered','2026-07-28T08:05:00.000Z','2026-07-28T08:06:00.000Z','pending_review',1,
    'canonical.emergency.test','seed-vital-er-101',?,?)`).run('0'.repeat(64), '0'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_vital_observation_status_events (
    tenant_id,event_public_id,observation_set_public_id,from_review_status,to_review_status,event_version,event_type,
    reason_code,actor_practitioner_public_id,actor_system_key,occurred_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','vital-er-101-event','vital-er-101',NULL,'pending_review',1,'recorded',
    'recorded','practitioner-triage','canonical.emergency.test','2026-07-28T08:06:00.000Z',
    ?,'2026-07-28T08:06:00.000Z')`).run('0'.repeat(64));
  createSignedDischargeDocument(sqlite, {
    documentPublicId: 'document-discharge-101',
    versionPublicId: 'document-discharge-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-er-101',
    contentSha256: '1'.repeat(64),
  });
  createSignedDischargeDocument(sqlite, {
    documentPublicId: 'document-discharge-202',
    versionPublicId: 'document-discharge-202-v1',
    patientLinkPublicId: 'patient-link-202',
    encounterPublicId: 'encounter-er-202',
    contentSha256: '2'.repeat(64),
  });
}

function createSignedDischargeDocument(sqlite: DatabaseSync, input: {
  documentPublicId: string;
  versionPublicId: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  contentSha256: string;
}): void {
  sqlite.prepare(`INSERT INTO canonical_clinical_documents (
    tenant_id,document_public_id,patient_link_public_id,encounter_public_id,scope_kind,
    authoring_practitioner_public_id,document_type,current_status,status_version,confidentiality_code,
    authored_at_utc,idempotency_key,request_fingerprint_sha256,source_evidence_sha256
  ) VALUES ('tenant-a',?,?,?,'encounter','practitioner-emergency','discharge_summary','draft',1,'normal',
    '2026-07-28T11:00:00.000Z',?,?,?)`).run(
      input.documentPublicId, input.patientLinkPublicId, input.encounterPublicId,
      `seed-${input.documentPublicId}`, input.contentSha256, input.contentSha256,
    );
  sqlite.prepare(`INSERT INTO canonical_clinical_document_versions (
    tenant_id,version_public_id,document_public_id,version_number,version_kind,content_format,content_payload,
    content_sha256,authoring_practitioner_public_id,actor_system_key,authored_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,1,'draft','plain_text','Signed emergency discharge summary',?,
    'practitioner-emergency','canonical.emergency.test','2026-07-28T11:00:00.000Z',?,
    '2026-07-28T11:00:00.000Z')`).run(
      input.versionPublicId, input.documentPublicId, input.contentSha256, input.contentSha256,
    );
  sqlite.prepare(`INSERT INTO canonical_clinical_document_signatures (
    tenant_id,signature_public_id,document_public_id,version_public_id,signer_practitioner_public_id,
    signature_method,signed_content_sha256,attestation_sha256,signed_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,?,?, 'authenticated_attestation',?,?,
    '2026-07-28T11:05:00.000Z',?,'2026-07-28T11:05:00.000Z')`).run(
      `signature-${input.versionPublicId}`, input.documentPublicId, input.versionPublicId,
      'practitioner-emergency', input.contentSha256, input.contentSha256, input.contentSha256,
    );
  sqlite.prepare(`UPDATE canonical_clinical_document_versions
    SET version_kind='final',finalized_at_utc='2026-07-28T11:05:00.000Z'
    WHERE tenant_id='tenant-a' AND version_public_id=?`).run(input.versionPublicId);
  sqlite.prepare(`UPDATE canonical_clinical_documents
    SET current_version_public_id=?,current_status='final',finalized_at_utc='2026-07-28T11:05:00.000Z',
      updated_at_utc='2026-07-28T11:05:00.000Z'
    WHERE tenant_id='tenant-a' AND document_public_id=?`).run(input.versionPublicId, input.documentPublicId);
}

function registrationInput(overrides: Partial<RegisterCanonicalEmergencyCaseInput> = {}): RegisterCanonicalEmergencyCaseInput {
  return {
    tenantId: 'tenant-a',
    emergencyCasePublicId: 'emergency-case-101',
    arrivalAssessmentPublicId: 'arrival-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-er-101',
    emergencyNumberNamespace: 'legacy_er',
    emergencyNumberValue: 'ER-101',
    initialStatus: 'arrived',
    arrivalAtUtc: '2026-07-28T08:00:00.000Z',
    modeOfArrivalCode: 'walk_in',
    conditionOnArrivalCode: 'stable',
    conditionSnapshot: 'Patient arrived conscious',
    broughtByCategory: 'self',
    policeCaseIndicator: false,
    observedAtUtc: '2026-07-28T08:00:00.000Z',
    recordedAtUtc: '2026-07-28T08:01:00.000Z',
    sourceType: 'legacy_er_patient',
    sourcePublicId: '101',
    sourceTable: 'er_patients',
    sourceEvidenceSha256: '3'.repeat(64),
    actorSystemKey: 'canonical.emergency.test',
    idempotencyKey: 'emergency-register-101',
    outboxEventPublicId: 'emergency-register-outbox-101',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function source(suffix: string) {
  return {
    sourceType: 'legacy_er_patient',
    sourcePublicId: suffix,
    sourceTable: 'er_patients',
    sourceEvidenceSha256: '4'.repeat(64),
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function register(db: CanonicalBatchDatabase): Promise<void> {
  await registerCanonicalEmergencyCase(db, registrationInput());
}

async function triage(db: CanonicalBatchDatabase): Promise<void> {
  await register(db);
  await recordCanonicalEmergencyTriageAssessment(db, {
    tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
    expectedTriageVersion: 0, triageAssessmentPublicId: 'triage-101-v1', acuityCode: 'red',
    triagePractitionerPublicId: 'practitioner-triage', vitalObservationSetPublicId: 'vital-er-101',
    observedAtUtc: '2026-07-28T08:08:00.000Z', recordedAtUtc: '2026-07-28T08:10:00.000Z',
    ...source('triage-101-v1'), actorSystemKey: 'canonical.emergency.test',
    idempotencyKey: 'triage-record-101-v1', businessDate: '2026-07-28',
  });
}

async function prepareDisposition(db: CanonicalBatchDatabase): Promise<void> {
  await triage(db);
  await transitionCanonicalEmergencyCase(db, {
    tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 2,
    toStatus: 'care_in_progress', actorPractitionerPublicId: 'practitioner-emergency',
    reasonCode: 'care_started', occurredAtUtc: '2026-07-28T08:20:00.000Z',
    recordedAtUtc: '2026-07-28T08:20:00.000Z', ...source('status-care-101'),
    actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'status-care-101', businessDate: '2026-07-28',
  });
  await transitionCanonicalEmergencyCase(db, {
    tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 3,
    toStatus: 'disposition_pending', actorPractitionerPublicId: 'practitioner-emergency',
    reasonCode: 'disposition_pending', occurredAtUtc: '2026-07-28T09:00:00.000Z',
    recordedAtUtc: '2026-07-28T09:00:00.000Z', ...source('status-disposition-101'),
    actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'status-disposition-101', businessDate: '2026-07-28',
  });
}

function dispositionInput(overrides: Partial<RecordCanonicalEmergencyDispositionInput> = {}): RecordCanonicalEmergencyDispositionInput {
  return {
    tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 4,
    expectedDispositionVersion: 0, dispositionEventPublicId: 'disposition-101-v1',
    dispositionCode: 'admitted', actorPractitionerPublicId: 'practitioner-emergency',
    canonicalAdmissionPublicId: 'admission-101', occurredAtUtc: '2026-07-28T10:00:00.000Z',
    recordedAtUtc: '2026-07-28T10:00:00.000Z', reasonCode: 'admitted_to_ipd',
    ...source('disposition-101-v1'), actorSystemKey: 'canonical.emergency.test',
    idempotencyKey: 'disposition-record-101-v1', businessDate: '2026-07-28',
    ...overrides,
  };
}

describe('canonical emergency case and triage commands', () => {
  it('atomically registers exact case/arrival/status evidence with replay, mapping, PHI-minimised outbox, and rollback', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare('INSERT INTO legacy_emergency_compat(marker) VALUES (?)').bind('er-101');
      const first = await registerCanonicalEmergencyCase(db, registrationInput(), { authoritativeStatements: [compatibility] });
      const replay = await registerCanonicalEmergencyCase(db, registrationInput());
      expect(first).toEqual({ status: 'applied', result: {
        emergencyCasePublicId: 'emergency-case-101', currentStatus: 'arrived', statusVersion: 1,
        currentArrivalAssessmentPublicId: 'arrival-101-v1', currentTriageAssessmentPublicId: null,
        currentDispositionEventPublicId: null,
      } });
      expect(replay).toEqual({ status: 'replayed', result: first.result });
      expect(count(sqlite, 'canonical_emergency_cases')).toBe(1);
      expect(count(sqlite, 'canonical_emergency_arrival_assessments')).toBe(1);
      expect(count(sqlite, 'canonical_emergency_case_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_emergency_compat')).toBe(1);
      const payload = String((sqlite.prepare('SELECT payload_json FROM canonical_outbox_events').get() as { payload_json: string }).payload_json);
      for (const forbidden of [
        'patient-link-101', 'encounter-er-101', 'Patient arrived conscious', 'walk_in', 'stable', 'er_patients',
      ]) expect(payload).not.toContain(forbidden);
      await expect(registerCanonicalEmergencyCase(db, registrationInput({ conditionOnArrivalCode: 'critical' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      const rollback = harness();
      try {
        await expect(registerCanonicalEmergencyCase(rollback.db, registrationInput({
          idempotencyKey: 'emergency-register-rollback', outboxEventPublicId: 'emergency-register-rollback-outbox',
        }), { authoritativeStatements: [
          rollback.db.prepare("INSERT INTO legacy_emergency_compat(marker) VALUES ('rollback')"),
          rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)'),
        ] })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_emergency_cases')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_outbox_events')).toBe(0);
        expect(count(rollback.sqlite, 'legacy_emergency_compat')).toBe(0);
      } finally { rollback.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('replaces arrival assessment immutably with optimistic version guards and replay', async () => {
    const { sqlite, db } = harness();
    try {
      await register(db);
      const input = {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
        expectedArrivalVersion: 1, arrivalAssessmentPublicId: 'arrival-101-v2',
        arrivalAtUtc: '2026-07-28T07:58:00.000Z', modeOfArrivalCode: 'ambulance',
        conditionOnArrivalCode: 'critical', conditionSnapshot: 'Corrected source record',
        broughtByCategory: 'ambulance', policeCaseIndicator: false,
        observedAtUtc: '2026-07-28T07:58:00.000Z', recordedAtUtc: '2026-07-28T08:30:00.000Z',
        reasonCode: 'source_correction', ...source('arrival-101-v2'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'arrival-replace-101-v2', businessDate: '2026-07-28',
      } as const;
      const first = await replaceCanonicalEmergencyArrivalAssessment(db, input);
      const replay = await replaceCanonicalEmergencyArrivalAssessment(db, input);
      expect(first.status).toBe('applied');
      expect(replay).toEqual({ status: 'replayed', result: first.result });
      expect(count(sqlite, 'canonical_emergency_arrival_assessments')).toBe(2);
      const rows = sqlite.prepare(`SELECT version_number,version_kind,condition_on_arrival_code,
        supersedes_arrival_assessment_public_id FROM canonical_emergency_arrival_assessments ORDER BY version_number`).all();
      expect(rows).toEqual([
        { version_number: 1, version_kind: 'initial', condition_on_arrival_code: 'stable', supersedes_arrival_assessment_public_id: null },
        { version_number: 2, version_kind: 'correction', condition_on_arrival_code: 'critical', supersedes_arrival_assessment_public_id: 'arrival-101-v1' },
      ]);
      expect((sqlite.prepare(`SELECT current_arrival_assessment_public_id FROM canonical_emergency_cases`).get() as Record<string, unknown>)
        .current_arrival_assessment_public_id).toBe('arrival-101-v2');
      await expect(replaceCanonicalEmergencyArrivalAssessment(db, {
        ...input, idempotencyKey: 'arrival-stale', expectedArrivalVersion: 1,
      })).rejects.toThrow(/arrival version conflict/i);
    } finally { sqlite.close(); }
  });

  it('records triage, reassessment, and correction without erasing prior acuity evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await register(db);
      await expect(recordCanonicalEmergencyTriageAssessment(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
        expectedTriageVersion: 0, acuityCode: 'red', triagePractitionerPublicId: 'practitioner-inactive',
        observedAtUtc: '2026-07-28T08:08:00.000Z', recordedAtUtc: '2026-07-28T08:10:00.000Z',
        ...source('triage-invalid'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'triage-invalid', businessDate: '2026-07-28',
      })).rejects.toThrow(/active practitioner/i);
      await recordCanonicalEmergencyTriageAssessment(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
        expectedTriageVersion: 0, triageAssessmentPublicId: 'triage-101-v1', acuityCode: 'red',
        triagePractitionerPublicId: 'practitioner-triage', vitalObservationSetPublicId: 'vital-er-101',
        observedAtUtc: '2026-07-28T08:08:00.000Z', recordedAtUtc: '2026-07-28T08:10:00.000Z',
        ...source('triage-101-v1'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'triage-record-101-v1', businessDate: '2026-07-28',
      });
      await recordCanonicalEmergencyTriageAssessment(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 2,
        expectedTriageVersion: 1, triageAssessmentPublicId: 'triage-101-v2', acuityCode: 'yellow',
        triagePractitionerPublicId: 'practitioner-triage', vitalObservationSetPublicId: 'vital-er-101',
        observedAtUtc: '2026-07-28T08:25:00.000Z', recordedAtUtc: '2026-07-28T08:26:00.000Z',
        reasonCode: 'reassessment', ...source('triage-101-v2'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'triage-record-101-v2', businessDate: '2026-07-28',
      });
      const correctionInput = {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 2,
        expectedTriageVersion: 2, triageAssessmentPublicId: 'triage-101-v3', acuityCode: 'green',
        triagePractitionerPublicId: 'practitioner-triage', vitalObservationSetPublicId: 'vital-er-101',
        observedAtUtc: '2026-07-28T08:25:00.000Z', recordedAtUtc: '2026-07-28T08:30:00.000Z',
        reasonCode: 'acuity_corrected', ...source('triage-101-v3'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'triage-correct-101-v3', businessDate: '2026-07-28',
      } as const;
      const corrected = await correctCanonicalEmergencyTriageAssessment(db, correctionInput);
      expect((await correctCanonicalEmergencyTriageAssessment(db, correctionInput)).status).toBe('replayed');
      expect(corrected.result.currentStatus).toBe('triaged');
      expect(corrected.result.statusVersion).toBe(2);
      expect(count(sqlite, 'canonical_emergency_triage_assessments')).toBe(3);
      expect(sqlite.prepare(`SELECT version_number,version_kind,acuity_code FROM canonical_emergency_triage_assessments ORDER BY version_number`).all())
        .toEqual([
          { version_number: 1, version_kind: 'initial', acuity_code: 'red' },
          { version_number: 2, version_kind: 'reassessment', acuity_code: 'yellow' },
          { version_number: 3, version_kind: 'correction', acuity_code: 'green' },
        ]);
      expect(count(sqlite, 'canonical_emergency_case_status_events')).toBe(2);
      expect((sqlite.prepare(`SELECT current_triage_assessment_public_id,current_status,status_version FROM canonical_emergency_cases`).get()))
        .toEqual({ current_triage_assessment_public_id: 'triage-101-v3', current_status: 'triaged', status_version: 2 });
    } finally { sqlite.close(); }
  });

  it('records and corrects typed emergency classifications through immutable families', async () => {
    const { sqlite, db } = harness();
    try {
      await register(db);
      await expect(recordCanonicalEmergencyCaseClassification(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
        classificationFamilyPublicId: 'classification-bite', classificationPublicId: 'classification-bite-v1',
        classificationNamespace: 'legacy_er_case', classificationCode: 'animal_bite', categoryCode: 'animal_bite',
        occurredAtUtc: '2026-07-28T08:10:00.000Z', recordedAtUtc: '2026-07-28T08:11:00.000Z',
        ...source('classification-invalid'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'classification-invalid', businessDate: '2026-07-28',
      })).rejects.toThrow(/animal bite evidence/i);
      await recordCanonicalEmergencyCaseClassification(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
        classificationFamilyPublicId: 'classification-bite', classificationPublicId: 'classification-bite-v1',
        classificationNamespace: 'legacy_er_case', classificationCode: 'animal_bite', categoryCode: 'animal_bite',
        animalCategoryCode: 'dog', biteSiteCode: 'left_leg', biteAtUtc: '2026-07-28T07:30:00.000Z',
        firstAidCode: 'washed', actorPractitionerPublicId: 'practitioner-emergency',
        occurredAtUtc: '2026-07-28T08:10:00.000Z', recordedAtUtc: '2026-07-28T08:11:00.000Z',
        ...source('classification-bite-v1'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'classification-bite-v1', businessDate: '2026-07-28',
      });
      await correctCanonicalEmergencyCaseClassification(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 1,
        classificationFamilyPublicId: 'classification-bite', expectedClassificationVersion: 1,
        classificationPublicId: 'classification-bite-v2', classificationNamespace: 'legacy_er_case',
        classificationCode: 'animal_bite', categoryCode: 'animal_bite', animalCategoryCode: 'dog',
        biteSiteCode: 'right_leg', biteAtUtc: '2026-07-28T07:30:00.000Z', firstAidCode: 'washed',
        actorPractitionerPublicId: 'practitioner-emergency', reasonCode: 'bite_site_corrected',
        occurredAtUtc: '2026-07-28T08:10:00.000Z', recordedAtUtc: '2026-07-28T08:20:00.000Z',
        ...source('classification-bite-v2'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'classification-bite-v2', businessDate: '2026-07-28',
      });
      expect(sqlite.prepare(`SELECT version_number,version_kind,bite_site_code,supersedes_classification_public_id
        FROM canonical_emergency_case_classifications ORDER BY version_number`).all()).toEqual([
          { version_number: 1, version_kind: 'initial', bite_site_code: 'left_leg', supersedes_classification_public_id: null },
          { version_number: 2, version_kind: 'correction', bite_site_code: 'right_leg', supersedes_classification_public_id: 'classification-bite-v1' },
        ]);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(3);
    } finally { sqlite.close(); }
  });

  it('guards non-terminal lifecycle transitions and optimistic status versions', async () => {
    const { sqlite, db } = harness();
    try {
      await triage(db);
      await expect(transitionCanonicalEmergencyCase(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 2,
        toStatus: 'admitted' as never, actorPractitionerPublicId: 'practitioner-emergency',
        reasonCode: 'invalid_terminal_transition', occurredAtUtc: '2026-07-28T08:20:00.000Z',
        recordedAtUtc: '2026-07-28T08:20:00.000Z', ...source('status-invalid-terminal'),
        actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'status-invalid-terminal', businessDate: '2026-07-28',
      })).rejects.toThrow(/disposition command/i);
      await transitionCanonicalEmergencyCase(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 2,
        toStatus: 'care_in_progress', actorPractitionerPublicId: 'practitioner-emergency',
        reasonCode: 'care_started', occurredAtUtc: '2026-07-28T08:20:00.000Z',
        recordedAtUtc: '2026-07-28T08:20:00.000Z', ...source('status-care-101'),
        actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'status-care-101', businessDate: '2026-07-28',
      });
      await transitionCanonicalEmergencyCase(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 3,
        toStatus: 'observation', actorPractitionerPublicId: 'practitioner-emergency',
        reasonCode: 'observation_started', occurredAtUtc: '2026-07-28T08:30:00.000Z',
        recordedAtUtc: '2026-07-28T08:30:00.000Z', ...source('status-observation-101'),
        actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'status-observation-101', businessDate: '2026-07-28',
      });
      await transitionCanonicalEmergencyCase(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 4,
        toStatus: 'disposition_pending', actorPractitionerPublicId: 'practitioner-emergency',
        reasonCode: 'disposition_pending', occurredAtUtc: '2026-07-28T09:00:00.000Z',
        recordedAtUtc: '2026-07-28T09:00:00.000Z', ...source('status-disposition-101'),
        actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'status-disposition-101', businessDate: '2026-07-28',
      });
      expect((sqlite.prepare(`SELECT current_status,status_version FROM canonical_emergency_cases`).get()))
        .toEqual({ current_status: 'disposition_pending', status_version: 5 });
      await expect(transitionCanonicalEmergencyCase(db, {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 4,
        toStatus: 'care_in_progress', actorPractitionerPublicId: 'practitioner-emergency',
        reasonCode: 'stale', occurredAtUtc: '2026-07-28T09:01:00.000Z', recordedAtUtc: '2026-07-28T09:01:00.000Z',
        ...source('status-stale'), actorSystemKey: 'canonical.emergency.test',
        idempotencyKey: 'status-stale', businessDate: '2026-07-28',
      })).rejects.toThrow(/status version conflict/i);
    } finally { sqlite.close(); }
  });

  it('records exact admitted, discharged, transferred, and death dispositions without duplicating external authority', async () => {
    const scenarios: Array<{
      name: string;
      input: Partial<RecordCanonicalEmergencyDispositionInput>;
      expectedStatus: string;
    }> = [
      { name: 'admitted', input: { dispositionCode: 'admitted', canonicalAdmissionPublicId: 'admission-101' }, expectedStatus: 'admitted' },
      {
        name: 'discharged',
        input: {
          dispositionCode: 'discharged', canonicalAdmissionPublicId: null,
          dischargeDocumentPublicId: 'document-discharge-101',
          dischargeDocumentVersionPublicId: 'document-discharge-101-v1',
          dischargeDocumentContentSha256: '1'.repeat(64),
        },
        expectedStatus: 'discharged',
      },
      {
        name: 'transferred',
        input: {
          dispositionCode: 'transferred', canonicalAdmissionPublicId: null,
          receivingOrganizationSourceType: 'external_facility', receivingOrganizationSourcePublicId: 'facility-55',
          receivingEncounterSourceType: 'external_referral', receivingEncounterSourcePublicId: 'referral-55',
        },
        expectedStatus: 'transferred',
      },
      {
        name: 'death',
        input: { dispositionCode: 'death', canonicalAdmissionPublicId: null, terminalEvidenceCode: 'death_confirmed' },
        expectedStatus: 'death',
      },
    ];
    for (const scenario of scenarios) {
      const { sqlite, db } = harness();
      try {
        await prepareDisposition(db);
        const input = dispositionInput({
          dispositionEventPublicId: `disposition-${scenario.name}-101`,
          idempotencyKey: `disposition-${scenario.name}-101`,
          sourcePublicId: `disposition-${scenario.name}-101`,
          reasonCode: scenario.name,
          ...scenario.input,
        });
        const first = await recordCanonicalEmergencyDisposition(db, input);
        const replay = await recordCanonicalEmergencyDisposition(db, input);
        expect(first.result.currentStatus).toBe(scenario.expectedStatus);
        expect(first.result.statusVersion).toBe(5);
        expect(replay).toEqual({ status: 'replayed', result: first.result });
        expect(count(sqlite, 'canonical_emergency_disposition_events')).toBe(1);
        expect((sqlite.prepare(`SELECT current_status,current_disposition_event_public_id FROM canonical_emergency_cases`).get()))
          .toEqual({ current_status: scenario.expectedStatus, current_disposition_event_public_id: `disposition-${scenario.name}-101` });
      } finally { sqlite.close(); }
    }

    const wrong = harness();
    try {
      await prepareDisposition(wrong.db);
      await expect(recordCanonicalEmergencyDisposition(wrong.db, dispositionInput({
        canonicalAdmissionPublicId: 'admission-202', idempotencyKey: 'disposition-wrong-admission',
        sourcePublicId: 'disposition-wrong-admission',
      }))).rejects.toThrow(/admission patient mismatch/i);
    } finally { wrong.sqlite.close(); }
  });

  it('enters a terminal emergency case in error while preserving prior disposition and lifecycle evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await prepareDisposition(db);
      await recordCanonicalEmergencyDisposition(db, dispositionInput({
        dispositionCode: 'discharged', canonicalAdmissionPublicId: null,
        dischargeDocumentPublicId: 'document-discharge-101',
        dischargeDocumentVersionPublicId: 'document-discharge-101-v1',
        dischargeDocumentContentSha256: '1'.repeat(64),
        dispositionEventPublicId: 'disposition-discharge-101',
        idempotencyKey: 'disposition-discharge-101', sourcePublicId: 'disposition-discharge-101',
        reasonCode: 'discharged',
      }));
      const input = {
        tenantId: 'tenant-a', emergencyCasePublicId: 'emergency-case-101', expectedStatusVersion: 5,
        expectedDispositionVersion: 1, dispositionEventPublicId: 'disposition-error-101',
        actorPractitionerPublicId: 'practitioner-emergency', terminalEvidenceCode: 'legacy_case_invalid',
        reasonCode: 'source_entered_in_error', occurredAtUtc: '2026-07-28T12:00:00.000Z',
        recordedAtUtc: '2026-07-28T12:00:00.000Z', ...source('disposition-error-101'),
        actorSystemKey: 'canonical.emergency.test', idempotencyKey: 'disposition-error-101',
        businessDate: '2026-07-28',
      } as const;
      const first = await enterCanonicalEmergencyCaseInError(db, input);
      expect((await enterCanonicalEmergencyCaseInError(db, input)).status).toBe('replayed');
      expect(first.result.currentStatus).toBe('entered_in_error');
      expect(first.result.statusVersion).toBe(6);
      expect(count(sqlite, 'canonical_emergency_disposition_events')).toBe(2);
      expect(count(sqlite, 'canonical_emergency_case_status_events')).toBe(6);
      expect(sqlite.prepare(`SELECT disposition_version,disposition_code FROM canonical_emergency_disposition_events ORDER BY disposition_version`).all())
        .toEqual([
          { disposition_version: 1, disposition_code: 'discharged' },
          { disposition_version: 2, disposition_code: 'entered_in_error' },
        ]);
      expect((sqlite.prepare(`SELECT current_status,current_disposition_event_public_id FROM canonical_emergency_cases`).get()))
        .toEqual({ current_status: 'entered_in_error', current_disposition_event_public_id: 'disposition-error-101' });
    } finally { sqlite.close(); }
  });
});
