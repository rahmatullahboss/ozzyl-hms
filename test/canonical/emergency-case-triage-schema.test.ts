import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0560_canonical_emergency_case_triage.sql';
const schemaPath = 'src/db/schema/canonical/emergency-case-triage.ts';
const barrelPath = 'src/db/schema/canonical/index.ts';

const tables = [
  'canonical_emergency_cases',
  'canonical_emergency_arrival_assessments',
  'canonical_emergency_case_status_events',
  'canonical_emergency_triage_assessments',
  'canonical_emergency_case_classifications',
  'canonical_emergency_disposition_events',
] as const;

function database(): DatabaseSync {
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
    'migrations/0555_canonical_clinical_document_diagnosis.sql',
    'migrations/0556_canonical_patient_vital_measurement.sql',
    migrationPath,
  ]) db.exec(readFileSync(migration, 'utf8'));
  seedDependencies(db);
  return db;
}

function seedDependencies(db: DatabaseSync): void {
  for (const [patientLink, patientId, hash] of [
    ['patient-link-101', 101, '1'],
    ['patient-link-202', 202, '2'],
  ] as const) {
    db.prepare(`INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
      evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a',?,?,'unlinked','unverified','no_link_placeholder',?,'2026-07-28T00:00:00.000Z',1)`)
      .run(patientLink, patientId, hash.repeat(64));
  }
  for (const [practitioner, displayName, hash] of [
    ['practitioner-triage', 'Triage Nurse', '3'],
    ['practitioner-disposition', 'Emergency Physician', '4'],
    ['practitioner-inactive', 'Inactive', '5'],
  ] as const) {
    db.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'internal',?,?,1,?)`).run(
      practitioner, displayName, practitioner === 'practitioner-inactive' ? 'inactive' : 'active', hash.repeat(64),
    );
  }
  for (const [encounter, patientId, patientLink, encounterType, hash] of [
    ['encounter-er-101', 101, 'patient-link-101', 'emergency', '6'],
    ['encounter-er-202', 202, 'patient-link-202', 'emergency', '7'],
    ['encounter-opd-101', 101, 'patient-link-101', 'outpatient', '8'],
    ['encounter-ipd-101', 101, 'patient-link-101', 'inpatient', '9'],
    ['encounter-ipd-202', 202, 'patient-link-202', 'inpatient', 'a'],
  ] as const) {
    db.prepare(`INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,status,
      encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,'in_progress',1,'runtime','2026-07-28T08:00:00.000Z',?)`)
      .run(encounter, patientId, patientLink, encounterType, hash.repeat(64));
  }
  for (const [admission, encounter, patientLink, number, hash] of [
    ['admission-101', 'encounter-ipd-101', 'patient-link-101', 'ADM-101', 'b'],
    ['admission-202', 'encounter-ipd-202', 'patient-link-202', 'ADM-202', 'c'],
  ] as const) {
    db.prepare(`INSERT INTO canonical_admissions (
      tenant_id,admission_public_id,encounter_public_id,patient_link_public_id,admission_number,
      admission_type,admission_source,current_status,status_version,admitted_at_utc,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES ('tenant-a',?,?,?,?,'emergency','emergency','admitted',1,'2026-07-28T10:00:00.000Z',?,?,?)`)
      .run(admission, encounter, patientLink, number, `admission-${admission}`, hash.repeat(64), hash.repeat(64));
  }

  db.prepare(`INSERT INTO canonical_vital_observation_sets (
    tenant_id,observation_set_public_id,patient_link_public_id,encounter_public_id,practitioner_public_id,
    source_kind,effective_at_utc,recorded_at_utc,review_status,status_version,actor_system_key,
    idempotency_key,request_fingerprint_sha256,source_evidence_sha256
  ) VALUES ('tenant-a','vital-er-101','patient-link-101','encounter-er-101','practitioner-triage',
    'nurse_entered','2026-07-28T08:05:00.000Z','2026-07-28T08:06:00.000Z','pending_review',1,
    'schema.test','vital-er-101',?,?)`).run('d'.repeat(64), 'd'.repeat(64));
  db.prepare(`INSERT INTO canonical_vital_observation_status_events (
    tenant_id,event_public_id,observation_set_public_id,from_review_status,to_review_status,event_version,event_type,
    reason_code,actor_practitioner_public_id,actor_system_key,occurred_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','vital-er-101-event','vital-er-101',NULL,'pending_review',1,'recorded',
    'recorded','practitioner-triage','schema.test','2026-07-28T08:05:00.000Z',?,
    '2026-07-28T08:06:00.000Z')`).run('d'.repeat(64));

  createSignedDischargeDocument(db, {
    documentPublicId: 'document-discharge-101',
    versionPublicId: 'document-discharge-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-er-101',
    contentSha256: 'e'.repeat(64),
  });
  createSignedDischargeDocument(db, {
    documentPublicId: 'document-discharge-202',
    versionPublicId: 'document-discharge-202-v1',
    patientLinkPublicId: 'patient-link-202',
    encounterPublicId: 'encounter-er-202',
    contentSha256: 'f'.repeat(64),
  });
}

function createSignedDischargeDocument(db: DatabaseSync, input: {
  documentPublicId: string;
  versionPublicId: string;
  patientLinkPublicId: string;
  encounterPublicId: string;
  contentSha256: string;
}): void {
  db.prepare(`INSERT INTO canonical_clinical_documents (
    tenant_id,document_public_id,patient_link_public_id,encounter_public_id,scope_kind,
    authoring_practitioner_public_id,document_type,current_status,authored_at_utc,
    idempotency_key,request_fingerprint_sha256,source_evidence_sha256
  ) VALUES ('tenant-a',?,?,?,'encounter','practitioner-disposition','discharge_summary','draft',
    '2026-07-28T11:00:00.000Z',?,?,?)`).run(
      input.documentPublicId, input.patientLinkPublicId, input.encounterPublicId,
      `document-${input.documentPublicId}`, input.contentSha256, input.contentSha256,
    );
  db.prepare(`INSERT INTO canonical_clinical_document_versions (
    tenant_id,version_public_id,document_public_id,version_number,version_kind,content_format,content_payload,
    content_sha256,authoring_practitioner_public_id,actor_system_key,authored_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,1,'draft','plain_text','Signed emergency discharge summary',?,
    'practitioner-disposition','schema.test','2026-07-28T11:00:00.000Z',?,'2026-07-28T11:00:00.000Z')`).run(
      input.versionPublicId, input.documentPublicId, input.contentSha256, input.contentSha256,
    );
  db.prepare(`INSERT INTO canonical_clinical_document_signatures (
    tenant_id,signature_public_id,document_public_id,version_public_id,signer_practitioner_public_id,
    signature_method,signed_content_sha256,attestation_sha256,signed_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,?,?, 'authenticated_attestation',?,?,
    '2026-07-28T11:05:00.000Z',?,'2026-07-28T11:05:00.000Z')`).run(
      `signature-${input.versionPublicId}`, input.documentPublicId, input.versionPublicId,
      'practitioner-disposition', input.contentSha256, input.contentSha256, input.contentSha256,
    );
  db.prepare(`UPDATE canonical_clinical_document_versions
    SET version_kind='final',finalized_at_utc='2026-07-28T11:05:00.000Z'
    WHERE tenant_id='tenant-a' AND version_public_id=?`).run(input.versionPublicId);
  db.prepare(`UPDATE canonical_clinical_documents
    SET current_version_public_id=?,current_status='final',finalized_at_utc='2026-07-28T11:05:00.000Z',
      updated_at_utc='2026-07-28T11:05:00.000Z'
    WHERE tenant_id='tenant-a' AND document_public_id=?`).run(input.versionPublicId, input.documentPublicId);
}

function insertCase(db: DatabaseSync, suffix = '101', patient = '101'): void {
  db.prepare(`INSERT INTO canonical_emergency_cases (
    tenant_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    emergency_number_namespace,emergency_number_value,current_status,status_version,
    actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
    created_at_utc,updated_at_utc
  ) VALUES ('tenant-a',?,?,?,?,?,'arrived',1,'schema.test',?,?,?,
    '2026-07-28T08:00:00.000Z','2026-07-28T08:00:00.000Z')`).run(
      `emergency-case-${suffix}`, `patient-link-${patient}`, `encounter-er-${patient}`,
      'legacy_er', `ER-${suffix}`, `case-${suffix}`, '1'.repeat(64), '2'.repeat(64),
    );
}

function insertInitialArrivalAndEvent(db: DatabaseSync, suffix = '101', patient = '101'): void {
  db.prepare(`INSERT INTO canonical_emergency_arrival_assessments (
    tenant_id,arrival_assessment_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    version_number,version_kind,arrival_at_utc,mode_of_arrival_code,condition_on_arrival_code,
    brought_by_category,police_case_indicator,actor_system_key,observed_at_utc,recorded_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,?, ?,1,'initial','2026-07-28T08:00:00.000Z','walk_in','stable',
    'self',0,'schema.test','2026-07-28T08:00:00.000Z','2026-07-28T08:01:00.000Z',?,
    '2026-07-28T08:01:00.000Z')`).run(
      `arrival-${suffix}-v1`, `emergency-case-${suffix}`, `patient-link-${patient}`, `encounter-er-${patient}`, '3'.repeat(64),
    );
  db.prepare(`INSERT INTO canonical_emergency_case_status_events (
    tenant_id,event_public_id,emergency_case_public_id,from_status,to_status,event_version,event_type,
    actor_system_key,occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,NULL,'arrived',1,'registered','schema.test',
    '2026-07-28T08:00:00.000Z','2026-07-28T08:01:00.000Z','registered',?,
    '2026-07-28T08:01:00.000Z')`).run(`case-${suffix}-event-1`, `emergency-case-${suffix}`, '4'.repeat(64));
  db.prepare(`UPDATE canonical_emergency_cases SET
    current_arrival_assessment_public_id=?,current_status_event_public_id=?,updated_at_utc='2026-07-28T08:01:00.000Z'
    WHERE tenant_id='tenant-a' AND emergency_case_public_id=?`).run(
      `arrival-${suffix}-v1`, `case-${suffix}-event-1`, `emergency-case-${suffix}`,
    );
}

function insertTriage(db: DatabaseSync, suffix = '101', input: {
  publicId?: string;
  version?: number;
  kind?: string;
  supersedes?: string | null;
  acuity?: string;
  practitioner?: string;
  vital?: string | null;
  observed?: string;
  recorded?: string;
  reason?: string | null;
} = {}): string {
  const publicId = input.publicId ?? `triage-${suffix}-v${input.version ?? 1}`;
  db.prepare(`INSERT INTO canonical_emergency_triage_assessments (
    tenant_id,triage_assessment_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    version_number,supersedes_triage_assessment_public_id,version_kind,acuity_code,
    triage_practitioner_public_id,vital_observation_set_public_id,observed_at_utc,recorded_at_utc,
    reason_code,source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,?,?,?,?,?,?,?,?,?,?,?,?,?,
    '2026-07-28T08:10:00.000Z')`).run(
      publicId, `emergency-case-${suffix}`, 'patient-link-101', 'encounter-er-101',
      input.version ?? 1, input.supersedes ?? null, input.kind ?? 'initial', input.acuity ?? 'red',
      input.practitioner ?? 'practitioner-triage', input.vital === undefined ? 'vital-er-101' : input.vital,
      input.observed ?? '2026-07-28T08:08:00.000Z', input.recorded ?? '2026-07-28T08:10:00.000Z',
      input.reason ?? null, '5'.repeat(64),
    );
  return publicId;
}

function addStatusEvent(db: DatabaseSync, input: {
  version: number;
  from: string;
  to: string;
  type: string;
  occurred?: string;
}): string {
  const publicId = `case-101-event-${input.version}`;
  db.prepare(`INSERT INTO canonical_emergency_case_status_events (
    tenant_id,event_public_id,emergency_case_public_id,from_status,to_status,event_version,event_type,
    actor_practitioner_public_id,actor_system_key,occurred_at_utc,recorded_at_utc,reason_code,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,'emergency-case-101',?,?,?,?,
    'practitioner-disposition','schema.test',?,?,'schema_transition',?,?)`).run(
      publicId, input.from, input.to, input.version, input.type,
      input.occurred ?? `2026-07-28T08:${10 + input.version}:00.000Z`,
      input.occurred ?? `2026-07-28T08:${10 + input.version}:00.000Z`,
      '6'.repeat(64), input.occurred ?? `2026-07-28T08:${10 + input.version}:00.000Z`,
    );
  return publicId;
}

describe('canonical emergency case/triage schema', () => {
  it('creates exactly six governed tables and exports all six Drizzle models', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(schemaPath)).toBe(true);
    const db = database();
    try {
      const existing = (db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'canonical_emergency_%' ORDER BY name`).all() as { name: string }[])
        .map((row) => row.name);
      expect(existing).toEqual([...tables].sort());
      const schema = readFileSync(schemaPath, 'utf8');
      const barrel = readFileSync(barrelPath, 'utf8');
      for (const table of tables) expect(schema).toContain(`'${table}'`);
      expect(barrel).toContain("export * from './emergency-case-triage'");
    } finally { db.close(); }
  });

  it('requires exact active patient/emergency-encounter scope and one case per encounter', () => {
    const db = database();
    try {
      insertCase(db);
      expect(() => insertCase(db, 'duplicate')).toThrow(/unique/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_cases (
        tenant_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,current_status,status_version,
        actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256
      ) VALUES ('tenant-a','bad-patient','patient-link-202','encounter-er-101','arrived',1,
        'schema.test','bad-patient',?,?)`).run('1'.repeat(64), '2'.repeat(64))).toThrow(/patient encounter mismatch/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_cases (
        tenant_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,current_status,status_version,
        actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256
      ) VALUES ('tenant-a','bad-type','patient-link-101','encounter-opd-101','arrived',1,
        'schema.test','bad-type',?,?)`).run('1'.repeat(64), '2'.repeat(64))).toThrow(/emergency encounter/i);
      expect(() => db.prepare(`UPDATE canonical_emergency_cases SET encounter_public_id='encounter-er-202' WHERE emergency_case_public_id='emergency-case-101'`).run())
        .toThrow(/identity is immutable/i);
    } finally { db.close(); }
  });

  it('enforces immutable contiguous arrival/status history and matching current pointers', () => {
    const db = database();
    try {
      insertCase(db);
      insertInitialArrivalAndEvent(db);
      expect(db.prepare(`SELECT current_arrival_assessment_public_id,current_status_event_public_id,current_status,status_version
        FROM canonical_emergency_cases`).get()).toEqual({
          current_arrival_assessment_public_id: 'arrival-101-v1',
          current_status_event_public_id: 'case-101-event-1',
          current_status: 'arrived',
          status_version: 1,
        });
      expect(() => db.prepare(`INSERT INTO canonical_emergency_arrival_assessments (
        tenant_id,arrival_assessment_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        version_number,version_kind,arrival_at_utc,mode_of_arrival_code,condition_on_arrival_code,
        actor_system_key,observed_at_utc,recorded_at_utc,source_evidence_sha256
      ) VALUES ('tenant-a','arrival-101-v3','emergency-case-101','patient-link-101','encounter-er-101',
        3,'correction','2026-07-28T08:00:00.000Z','walk_in','stable','schema.test',
        '2026-07-28T08:00:00.000Z','2026-07-28T08:01:00.000Z',?)`).run('3'.repeat(64)))
        .toThrow(/contiguous/i);
      expect(() => db.prepare(`UPDATE canonical_emergency_arrival_assessments SET condition_on_arrival_code='critical' WHERE arrival_assessment_public_id='arrival-101-v1'`).run())
        .toThrow(/immutable/i);
      expect(() => db.prepare(`UPDATE canonical_emergency_cases SET current_arrival_assessment_public_id='missing' WHERE emergency_case_public_id='emergency-case-101'`).run())
        .toThrow(/arrival pointer/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_case_status_events (
        tenant_id,event_public_id,emergency_case_public_id,from_status,to_status,event_version,event_type,
        actor_system_key,occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256
      ) VALUES ('tenant-a','case-101-event-3','emergency-case-101','arrived','triaged',3,'triaged',
        'schema.test','2026-07-28T08:10:00.000Z','2026-07-28T08:10:00.000Z','triaged',?)`).run('4'.repeat(64)))
        .toThrow(/contiguous/i);
      expect(() => db.prepare(`DELETE FROM canonical_emergency_case_status_events WHERE event_public_id='case-101-event-1'`).run())
        .toThrow(/immutable|delete is forbidden/i);
    } finally { db.close(); }
  });

  it('enforces exact active triage practitioner, acuity, ordered times, vital scope, versions, and pointer parity', () => {
    const db = database();
    try {
      insertCase(db);
      insertInitialArrivalAndEvent(db);
      const triage = insertTriage(db);
      const replacementProbe = { version: 2, kind: 'correction', supersedes: triage, reason: 'validation_probe' };
      expect(() => insertTriage(db, '101', {
        ...replacementProbe, publicId: 'triage-inactive', practitioner: 'practitioner-inactive',
      })).toThrow(/active triage practitioner/i);
      expect(() => insertTriage(db, '101', {
        ...replacementProbe, publicId: 'triage-bad-acuity', acuity: 'blue',
      })).toThrow(/check constraint/i);
      expect(() => insertTriage(db, '101', {
        ...replacementProbe, publicId: 'triage-bad-time',
        observed: '2026-07-28T08:10:00.000Z', recorded: '2026-07-28T08:09:00.000Z',
      })).toThrow(/check constraint/i);
      expect(() => insertTriage(db, '101', {
        ...replacementProbe, publicId: 'triage-bad-vital', vital: 'missing-vital',
      })).toThrow(/foreign key|vital/i);
      db.prepare(`UPDATE canonical_emergency_cases SET current_triage_assessment_public_id=?,updated_at_utc='2026-07-28T08:10:00.000Z'
        WHERE emergency_case_public_id='emergency-case-101'`).run(triage);
      expect(() => db.prepare(`UPDATE canonical_emergency_cases SET current_triage_assessment_public_id='missing' WHERE emergency_case_public_id='emergency-case-101'`).run())
        .toThrow(/triage pointer/i);
      expect(() => db.prepare(`UPDATE canonical_emergency_triage_assessments SET acuity_code='yellow' WHERE triage_assessment_public_id=?`).run(triage))
        .toThrow(/immutable/i);
      const correction = insertTriage(db, '101', {
        publicId: 'triage-101-v2', version: 2, kind: 'correction', supersedes: triage,
        acuity: 'yellow', reason: 'acuity_corrected',
      });
      expect(correction).toBe('triage-101-v2');
      expect(() => insertTriage(db, '101', {
        publicId: 'triage-101-v2b', version: 2, kind: 'correction', supersedes: triage,
        acuity: 'green', reason: 'duplicate_replacement',
      })).toThrow(/contiguous|unique|replacement/i);
    } finally { db.close(); }
  });

  it('enforces immutable versioned classifications and typed animal-bite/police evidence', () => {
    const db = database();
    try {
      insertCase(db);
      insertInitialArrivalAndEvent(db);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_case_classifications (
        tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
        patient_link_public_id,encounter_public_id,version_number,version_kind,classification_namespace,
        classification_code,category_code,actor_system_key,occurred_at_utc,recorded_at_utc,
        source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','classification-bite-v1','classification-bite','emergency-case-101',
        'patient-link-101','encounter-er-101',1,'initial','legacy_er_case','animal_bite','animal_bite',
        'schema.test','2026-07-28T08:15:00.000Z','2026-07-28T08:16:00.000Z',?,
        '2026-07-28T08:16:00.000Z')`).run('7'.repeat(64))).toThrow(/animal bite evidence/i);
      db.prepare(`INSERT INTO canonical_emergency_case_classifications (
        tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
        patient_link_public_id,encounter_public_id,version_number,version_kind,classification_namespace,
        classification_code,category_code,animal_category_code,bite_site_code,bite_at_utc,
        actor_system_key,occurred_at_utc,recorded_at_utc,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','classification-bite-v1','classification-bite','emergency-case-101',
        'patient-link-101','encounter-er-101',1,'initial','legacy_er_case','animal_bite','animal_bite',
        'dog','left_leg','2026-07-28T07:30:00.000Z','schema.test',
        '2026-07-28T08:15:00.000Z','2026-07-28T08:16:00.000Z',?,
        '2026-07-28T08:16:00.000Z')`).run('7'.repeat(64));
      expect(() => db.prepare(`UPDATE canonical_emergency_case_classifications SET bite_site_code='right_leg' WHERE classification_public_id='classification-bite-v1'`).run())
        .toThrow(/immutable/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_case_classifications (
        tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
        patient_link_public_id,encounter_public_id,version_number,supersedes_classification_public_id,
        version_kind,classification_namespace,classification_code,category_code,animal_category_code,
        bite_site_code,bite_at_utc,actor_system_key,occurred_at_utc,recorded_at_utc,reason_code,
        source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','classification-bite-v3','classification-bite','emergency-case-101',
        'patient-link-101','encounter-er-101',3,'classification-bite-v1','correction','legacy_er_case',
        'animal_bite','animal_bite','dog','right_leg','2026-07-28T07:30:00.000Z','schema.test',
        '2026-07-28T08:20:00.000Z','2026-07-28T08:20:00.000Z','corrected',?,
        '2026-07-28T08:20:00.000Z')`).run('8'.repeat(64))).toThrow(/contiguous/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_case_classifications (
        tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
        patient_link_public_id,encounter_public_id,version_number,version_kind,classification_namespace,
        classification_code,category_code,police_case_indicator,actor_system_key,occurred_at_utc,
        recorded_at_utc,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','classification-police-v1','classification-police','emergency-case-101',
        'patient-link-101','encounter-er-101',1,'initial','legacy_er_case','police_case','police_case',0,
        'schema.test','2026-07-28T08:20:00.000Z','2026-07-28T08:20:00.000Z',?,
        '2026-07-28T08:20:00.000Z')`).run('9'.repeat(64))).toThrow(/police case evidence/i);
    } finally { db.close(); }
  });

  it('requires exact admission, signed discharge document, transfer pairs, and typed terminal reasons', () => {
    const db = database();
    try {
      insertCase(db);
      insertInitialArrivalAndEvent(db);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_disposition_events (
        tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        disposition_version,disposition_code,actor_practitioner_public_id,occurred_at_utc,recorded_at_utc,
        reason_code,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','disposition-admit-bad','emergency-case-101','patient-link-101','encounter-er-101',
        1,'admitted','practitioner-disposition','2026-07-28T09:00:00.000Z','2026-07-28T09:00:00.000Z',
        'admitted',?,'2026-07-28T09:00:00.000Z')`).run('a'.repeat(64))).toThrow(/admission evidence/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_disposition_events (
        tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        disposition_version,disposition_code,actor_practitioner_public_id,canonical_admission_public_id,
        occurred_at_utc,recorded_at_utc,reason_code,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','disposition-admit-wrong','emergency-case-101','patient-link-101','encounter-er-101',
        1,'admitted','practitioner-disposition','admission-202','2026-07-28T09:00:00.000Z',
        '2026-07-28T09:00:00.000Z','admitted',?,'2026-07-28T09:00:00.000Z')`).run('a'.repeat(64)))
        .toThrow(/admission patient mismatch/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_disposition_events (
        tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        disposition_version,disposition_code,actor_practitioner_public_id,discharge_document_public_id,
        discharge_document_version_public_id,discharge_document_content_sha256,occurred_at_utc,recorded_at_utc,
        reason_code,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','disposition-discharge-wrong','emergency-case-101','patient-link-101','encounter-er-101',
        1,'discharged','practitioner-disposition','document-discharge-202','document-discharge-202-v1',?,
        '2026-07-28T11:10:00.000Z','2026-07-28T11:10:00.000Z','discharged',?,
        '2026-07-28T11:10:00.000Z')`).run('f'.repeat(64), 'b'.repeat(64))).toThrow(/discharge document scope mismatch/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_disposition_events (
        tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        disposition_version,disposition_code,actor_practitioner_public_id,occurred_at_utc,recorded_at_utc,
        reason_code,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','disposition-transfer-bad','emergency-case-101','patient-link-101','encounter-er-101',
        1,'transferred','practitioner-disposition','2026-07-28T11:20:00.000Z','2026-07-28T11:20:00.000Z',
        'transferred',?,'2026-07-28T11:20:00.000Z')`).run('c'.repeat(64))).toThrow(/transfer destination/i);
      expect(() => db.prepare(`INSERT INTO canonical_emergency_disposition_events (
        tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        disposition_version,disposition_code,actor_practitioner_public_id,occurred_at_utc,recorded_at_utc,
        reason_code,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','disposition-death-bad','emergency-case-101','patient-link-101','encounter-er-101',
        1,'death','practitioner-disposition','2026-07-28T11:30:00.000Z','2026-07-28T11:30:00.000Z',
        'death',?,'2026-07-28T11:30:00.000Z')`).run('d'.repeat(64))).toThrow(/typed terminal evidence/i);
    } finally { db.close(); }
  });

  it('guards valid lifecycle/terminal pointers and blocks all history/case deletes', () => {
    const db = database();
    try {
      insertCase(db);
      insertInitialArrivalAndEvent(db);
      const triage = insertTriage(db);
      const event2 = addStatusEvent(db, { version: 2, from: 'arrived', to: 'triaged', type: 'triaged' });
      db.prepare(`UPDATE canonical_emergency_cases SET current_triage_assessment_public_id=?,current_status='triaged',
        status_version=2,current_status_event_public_id=?,updated_at_utc='2026-07-28T08:12:00.000Z'
        WHERE emergency_case_public_id='emergency-case-101'`).run(triage, event2);
      expect(() => db.prepare(`UPDATE canonical_emergency_cases SET current_status='admitted',status_version=3,
        current_status_event_public_id='missing' WHERE emergency_case_public_id='emergency-case-101'`).run())
        .toThrow(/status pointer|disposition pointer/i);

      const event3 = addStatusEvent(db, { version: 3, from: 'triaged', to: 'care_in_progress', type: 'care_started' });
      db.prepare(`UPDATE canonical_emergency_cases SET current_status='care_in_progress',status_version=3,
        current_status_event_public_id=?,updated_at_utc='2026-07-28T08:13:00.000Z'
        WHERE emergency_case_public_id='emergency-case-101'`).run(event3);
      const event4 = addStatusEvent(db, { version: 4, from: 'care_in_progress', to: 'disposition_pending', type: 'disposition_pending' });
      db.prepare(`UPDATE canonical_emergency_cases SET current_status='disposition_pending',status_version=4,
        current_status_event_public_id=?,updated_at_utc='2026-07-28T08:14:00.000Z'
        WHERE emergency_case_public_id='emergency-case-101'`).run(event4);
      db.prepare(`INSERT INTO canonical_emergency_disposition_events (
        tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
        disposition_version,disposition_code,actor_practitioner_public_id,discharge_document_public_id,
        discharge_document_version_public_id,discharge_document_content_sha256,occurred_at_utc,recorded_at_utc,
        reason_code,source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','disposition-discharge-101','emergency-case-101','patient-link-101','encounter-er-101',
        1,'discharged','practitioner-disposition','document-discharge-101','document-discharge-101-v1',?,
        '2026-07-28T11:10:00.000Z','2026-07-28T11:10:00.000Z','discharged',?,
        '2026-07-28T11:10:00.000Z')`).run('e'.repeat(64), 'e'.repeat(64));
      const event5 = addStatusEvent(db, { version: 5, from: 'disposition_pending', to: 'discharged', type: 'discharged', occurred: '2026-07-28T11:10:00.000Z' });
      db.prepare(`UPDATE canonical_emergency_cases SET current_status='discharged',status_version=5,
        current_status_event_public_id=?,current_disposition_event_public_id='disposition-discharge-101',
        updated_at_utc='2026-07-28T11:10:00.000Z' WHERE emergency_case_public_id='emergency-case-101'`).run(event5);
      expect(db.prepare(`SELECT current_status,status_version,current_disposition_event_public_id FROM canonical_emergency_cases`).get())
        .toEqual({ current_status: 'discharged', status_version: 5, current_disposition_event_public_id: 'disposition-discharge-101' });
      db.prepare(`INSERT INTO canonical_emergency_case_classifications (
        tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
        patient_link_public_id,encounter_public_id,version_number,version_kind,classification_namespace,
        classification_code,category_code,actor_system_key,occurred_at_utc,recorded_at_utc,
        source_evidence_sha256,created_at_utc
      ) VALUES ('tenant-a','classification-trauma-v1','classification-trauma','emergency-case-101',
        'patient-link-101','encounter-er-101',1,'initial','legacy_er_case','trauma','trauma',
        'schema.test','2026-07-28T08:15:00.000Z','2026-07-28T08:16:00.000Z',?,
        '2026-07-28T08:16:00.000Z')`).run('7'.repeat(64));

      for (const table of tables) {
        expect(() => db.prepare(`DELETE FROM ${table}`).run()).toThrow(/delete|immutable|restricted/i);
      }
      expect(() => db.prepare(`UPDATE canonical_emergency_disposition_events SET reason_code='changed'`).run()).toThrow(/immutable/i);
    } finally { db.close(); }
  });
});
