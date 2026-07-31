import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  resolveEmergencyCaseTriageProjection,
  resolveEmergencyCaseTriageProviderMode,
  type EmergencyCaseTriageProviderDatabase,
} from '../../src/lib/canonical/emergency-case-triage-provider';
import {
  readEmergencyBoardAdapter,
  readEmergencyDispositionHandoffAdapter,
  readEmergencyPatientTimelineAdapter,
} from '../../src/lib/canonical/emergency-case-triage-read-adapters';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement {
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

function harness(): { sqlite: DatabaseSync; db: EmergencyCaseTriageProviderDatabase } {
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
  sqlite.exec(`
    CREATE TABLE patients (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
    CREATE TABLE visits (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
  `);
  sqlite.exec(readFileSync('migrations/0032_emergency.sql', 'utf8'));
  const db: EmergencyCaseTriageProviderDatabase = { prepare(sql: string) { return new Statement(sqlite, sql); } };
  seed(sqlite);
  return { sqlite, db };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.prepare(`INSERT INTO canonical_tenant_patient_links (
    tenant_id,patient_link_public_id,legacy_patient_id,link_status,verification_level,
    evidence_type,evidence_sha256,effective_from_utc,version
  ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified','no_link_placeholder',?,
    '2026-07-28T00:00:00.000Z',1)`).run('1'.repeat(64));
  for (const [id, name, hash] of [
    ['practitioner-triage', 'Triage Nurse', '2'],
    ['practitioner-emergency', 'Emergency Physician', '3'],
  ] as const) {
    sqlite.prepare(`INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES ('tenant-a',?,'internal',?,'active',1,?)`).run(id, name, hash.repeat(64));
  }
  sqlite.prepare(`INSERT INTO canonical_encounters (
    tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,encounter_type,status,
    encounter_version,source_kind,started_at_utc,source_evidence_sha256
  ) VALUES ('tenant-a','encounter-er-101',101,'patient-link-101','emergency','in_progress',1,
    'runtime','2026-07-28T08:00:00.000Z',?)`).run('4'.repeat(64));
  sqlite.prepare(`INSERT INTO patients(id,tenant_id) VALUES (101,'tenant-a'),(202,'tenant-a')`).run();
  sqlite.prepare(`INSERT INTO visits(id,tenant_id) VALUES (501,'tenant-a'),(502,'tenant-a')`).run();
  sqlite.prepare(`INSERT INTO er_patients (
    id,tenant_id,er_patient_number,patient_id,visit_id,visit_datetime,first_name,last_name,contact_no,
    condition_on_arrival,brought_by,relation_with_patient,er_status,triage_code,triaged_by,triaged_on,
    is_active,finalized_status,finalized_remarks,finalized_by,finalized_on,created_by,created_at,updated_at
  ) VALUES (1,'tenant-a','ER-001',101,501,'2026-07-28 08:00:00','Private','Patient','01700000001',
    'critical','ambulance','relative','finalized','red',10,'2026-07-28 08:05:00',1,
    'discharged','Private discharge note',11,'2026-07-28T11:10:00.000Z',11,
    '2026-07-28T08:01:00.000Z','2026-07-28T11:10:00.000Z')`).run();
  sqlite.prepare(`INSERT INTO er_patients (
    id,tenant_id,er_patient_number,patient_id,visit_id,visit_datetime,first_name,last_name,contact_no,
    condition_on_arrival,er_status,is_active,created_by,created_at,updated_at
  ) VALUES (2,'tenant-a','ER-002',202,502,'2026-07-28 09:00:00','Unmapped','Patient','01700000002',
    'stable','new',1,11,'2026-07-28 09:01:00','2026-07-28 09:01:00')`).run();

  sqlite.prepare(`INSERT INTO canonical_emergency_cases (
    tenant_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    emergency_number_namespace,emergency_number_value,current_status,status_version,
    actor_system_key,idempotency_key,request_fingerprint_sha256,source_evidence_sha256,
    created_at_utc,updated_at_utc
  ) VALUES ('tenant-a','emergency-case-101','patient-link-101','encounter-er-101',
    'legacy_er','ER-001','arrived',1,'provider.test','case-101',?,?,
    '2026-07-28T08:00:00.000Z','2026-07-28T08:00:00.000Z')`).run('5'.repeat(64), '5'.repeat(64));
  sqlite.prepare(`INSERT INTO canonical_emergency_arrival_assessments (
    tenant_id,arrival_assessment_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    version_number,version_kind,arrival_at_utc,mode_of_arrival_code,condition_on_arrival_code,
    brought_by_category,police_case_indicator,actor_system_key,observed_at_utc,recorded_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','arrival-101-v1','emergency-case-101','patient-link-101','encounter-er-101',
    1,'initial','2026-07-28T08:00:00.000Z','ambulance','critical','ambulance',0,
    'provider.test','2026-07-28T08:00:00.000Z','2026-07-28T08:01:00.000Z',?,
    '2026-07-28T08:01:00.000Z')`).run('6'.repeat(64));
  statusEvent(sqlite, 1, null, 'arrived', 'registered', '2026-07-28T08:00:00.000Z', null);
  sqlite.prepare(`UPDATE canonical_emergency_cases SET current_arrival_assessment_public_id='arrival-101-v1',
    current_status_event_public_id='case-101-event-1',updated_at_utc='2026-07-28T08:01:00.000Z'
    WHERE emergency_case_public_id='emergency-case-101'`).run();
  sqlite.prepare(`INSERT INTO canonical_emergency_triage_assessments (
    tenant_id,triage_assessment_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    version_number,version_kind,acuity_code,triage_practitioner_public_id,observed_at_utc,recorded_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','triage-101-v1','emergency-case-101','patient-link-101','encounter-er-101',
    1,'initial','red','practitioner-triage','2026-07-28T08:05:00.000Z','2026-07-28T08:05:00.000Z',?,
    '2026-07-28T08:05:00.000Z')`).run('7'.repeat(64));
  statusEvent(sqlite, 2, 'arrived', 'triaged', 'triaged', '2026-07-28T08:05:00.000Z', 'practitioner-triage');
  sqlite.prepare(`UPDATE canonical_emergency_cases SET current_triage_assessment_public_id='triage-101-v1',
    current_status='triaged',status_version=2,current_status_event_public_id='case-101-event-2',
    updated_at_utc='2026-07-28T08:05:00.000Z' WHERE emergency_case_public_id='emergency-case-101'`).run();
  sqlite.prepare(`INSERT INTO canonical_emergency_case_classifications (
    tenant_id,classification_public_id,classification_family_public_id,emergency_case_public_id,
    patient_link_public_id,encounter_public_id,version_number,version_kind,classification_namespace,
    classification_code,category_code,subcategory_code,actor_system_key,occurred_at_utc,recorded_at_utc,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','classification-101-v1','classification-101','emergency-case-101',
    'patient-link-101','encounter-er-101',1,'initial','legacy_er_case','medical','medical','acute',
    'provider.test','2026-07-28T08:10:00.000Z','2026-07-28T08:10:00.000Z',?,
    '2026-07-28T08:10:00.000Z')`).run('8'.repeat(64));
  statusEvent(sqlite, 3, 'triaged', 'care_in_progress', 'care_started', '2026-07-28T08:20:00.000Z', 'practitioner-emergency');
  sqlite.prepare(`UPDATE canonical_emergency_cases SET current_status='care_in_progress',status_version=3,
    current_status_event_public_id='case-101-event-3',updated_at_utc='2026-07-28T08:20:00.000Z'
    WHERE emergency_case_public_id='emergency-case-101'`).run();
  statusEvent(sqlite, 4, 'care_in_progress', 'disposition_pending', 'disposition_pending', '2026-07-28T09:00:00.000Z', 'practitioner-emergency');
  sqlite.prepare(`UPDATE canonical_emergency_cases SET current_status='disposition_pending',status_version=4,
    current_status_event_public_id='case-101-event-4',updated_at_utc='2026-07-28T09:00:00.000Z'
    WHERE emergency_case_public_id='emergency-case-101'`).run();
  sqlite.prepare(`INSERT INTO canonical_emergency_disposition_events (
    tenant_id,disposition_event_public_id,emergency_case_public_id,patient_link_public_id,encounter_public_id,
    disposition_version,disposition_code,actor_practitioner_public_id,occurred_at_utc,recorded_at_utc,
    reason_code,source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a','disposition-101-v1','emergency-case-101','patient-link-101','encounter-er-101',
    1,'discharged','practitioner-emergency','2026-07-28T11:10:00.000Z','2026-07-28T11:10:00.000Z',
    'discharged',?,'2026-07-28T11:10:00.000Z')`).run('9'.repeat(64));
  statusEvent(sqlite, 5, 'disposition_pending', 'discharged', 'discharged', '2026-07-28T11:10:00.000Z', 'practitioner-emergency');
  sqlite.prepare(`UPDATE canonical_emergency_cases SET current_status='discharged',status_version=5,
    current_status_event_public_id='case-101-event-5',current_disposition_event_public_id='disposition-101-v1',
    updated_at_utc='2026-07-28T11:10:00.000Z' WHERE emergency_case_public_id='emergency-case-101'`).run();
  sqlite.prepare(`INSERT INTO canonical_source_mappings (
    tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
    mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
  ) VALUES ('tenant-a','emergency_case','emergency-case-101','legacy_er_patient','1','er_patients',
    'mapped',1,?,'2026-07-28T11:10:00.000Z','2026-07-28T11:10:00.000Z')`).run('a'.repeat(64));
}

function statusEvent(
  sqlite: DatabaseSync,
  version: number,
  fromStatus: string | null,
  toStatus: string,
  eventType: string,
  time: string,
  practitioner: string | null,
): void {
  sqlite.prepare(`INSERT INTO canonical_emergency_case_status_events (
    tenant_id,event_public_id,emergency_case_public_id,from_status,to_status,event_version,event_type,
    actor_practitioner_public_id,actor_system_key,occurred_at_utc,recorded_at_utc,reason_code,
    source_evidence_sha256,created_at_utc
  ) VALUES ('tenant-a',?,'emergency-case-101',?,?,?,?,?,'provider.test',?,?,?, ?,?)`).run(
      `case-101-event-${version}`,
      fromStatus,
      toStatus,
      version,
      eventType,
      practitioner,
      time,
      time,
      eventType,
      'b'.repeat(64),
      time,
    );
}

function setMode(sqlite: DatabaseSync, mode: 'legacy' | 'shadow' | 'canonical' | 'disabled', enabled: boolean): void {
  sqlite.prepare(`DELETE FROM canonical_feature_flags WHERE tenant_id='tenant-a'
    AND flag_key='canonical_emergency_case_triage_provider_v1'`).run();
  sqlite.prepare(`INSERT INTO canonical_feature_flags (
    tenant_id,flag_key,domain,mode,is_enabled,version,created_at_utc,updated_at_utc
  ) VALUES ('tenant-a','canonical_emergency_case_triage_provider_v1','emergency_case_triage',?,?,1,
    '2026-07-28T12:00:00.000Z','2026-07-28T12:00:00.000Z')`).run(mode, enabled ? 1 : 0);
}

const providerInput = { tenantId: 'tenant-a', sourceType: 'legacy_er_patient' as const, legacyId: 1 };
const evidence = {
  observedAtUtc: '2026-07-28T12:05:00.000Z',
  elapsedMs: 12,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [],
};

describe('canonical emergency case/triage provider', () => {
  it('defaults to legacy and honours only enabled shadow/canonical modes', async () => {
    const { sqlite, db } = harness();
    try {
      expect(await resolveEmergencyCaseTriageProviderMode(db, 'tenant-a')).toBe('legacy');
      setMode(sqlite, 'disabled', false);
      expect(await resolveEmergencyCaseTriageProviderMode(db, 'tenant-a')).toBe('legacy');
      setMode(sqlite, 'shadow', true);
      expect(await resolveEmergencyCaseTriageProviderMode(db, 'tenant-a')).toBe('shadow');
      setMode(sqlite, 'canonical', true);
      expect(await resolveEmergencyCaseTriageProviderMode(db, 'tenant-a')).toBe('canonical');
    } finally { sqlite.close(); }
  });

  it('legacy mode preserves unmapped output while identity-sensitive reads fail without exact mapping', async () => {
    const { sqlite, db } = harness();
    try {
      const legacy = await resolveEmergencyCaseTriageProjection(db, { ...providerInput, legacyId: 2 });
      expect(legacy).toMatchObject({
        mode: 'legacy', canonicalPublicId: null, status: 'arrived', historyVisible: false,
        arrivalHistory: [], lifecycleHistory: [], triageHistory: [], classificationHistory: [], dispositionHistory: [],
      });
      await expect(readEmergencyPatientTimelineAdapter(db, { ...providerInput, legacyId: 2 }, evidence))
        .rejects.toThrow(/exact canonical emergency case mapping is required/i);
    } finally { sqlite.close(); }
  });

  it('shadow board adapter preserves legacy-facing state and emits aggregate PHI-minimised parity only', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'shadow', true);
      const result = await readEmergencyBoardAdapter(db, providerInput, evidence);
      expect(result.projection).toMatchObject({
        mode: 'shadow', canonicalPublicId: 'emergency-case-101', status: 'discharged',
        statusVersion: 5, currentAcuityCode: 'red', currentDispositionCode: 'discharged', historyVisible: true,
      });
      expect(result.projection.parity?.ok).toBe(true);
      expect(result.shadowEvidence).toMatchObject({
        provider: 'emergency_case_triage', consumerId: 'cdb127e_emergency_board_worklist',
        mode: 'shadow', mismatchCount: 0, criticalMismatchCount: 0, latencyWithinBudget: true,
      });
      const persistedEvidence = JSON.stringify(result.shadowEvidence);
      for (const forbidden of [
        'Private Patient', '01700000001', 'Private discharge note', 'patient-link-101',
        'encounter-er-101', 'emergency-case-101', 'triage-101-v1', 'disposition-101-v1',
        'ambulance', 'er_patients',
      ]) expect(persistedEvidence).not.toContain(forbidden);
      expect(result.shadowEvidence?.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    } finally { sqlite.close(); }
  });

  it('canonical timeline and disposition adapters expose complete immutable emergency history', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical', true);
      const timeline = await readEmergencyPatientTimelineAdapter(db, providerInput, evidence);
      expect(timeline.shadowEvidence).toBeNull();
      expect(timeline.projection).toMatchObject({
        mode: 'canonical', canonicalPublicId: 'emergency-case-101', patientLinkPublicId: 'patient-link-101',
        encounterPublicId: 'encounter-er-101', status: 'discharged', statusVersion: 5,
        currentAcuityCode: 'red', currentDispositionCode: 'discharged', effectiveAtUtc: '2026-07-28T11:10:00.000Z',
      });
      expect(timeline.projection.arrivalHistory).toHaveLength(1);
      expect(timeline.projection.lifecycleHistory.map((item) => item.toStatus)).toEqual([
        'arrived', 'triaged', 'care_in_progress', 'disposition_pending', 'discharged',
      ]);
      expect(timeline.projection.triageHistory).toHaveLength(1);
      expect(timeline.projection.classificationHistory).toHaveLength(1);
      expect(timeline.projection.dispositionHistory).toEqual([
        expect.objectContaining({ dispositionVersion: 1, dispositionCode: 'discharged', practitionerPublicId: 'practitioner-emergency' }),
      ]);
      const handoff = await readEmergencyDispositionHandoffAdapter(db, providerInput, evidence);
      expect(handoff.projection.dispositionHistory.at(-1)?.reasonCode).toBe('discharged');
      expect(handoff.rollbackMode).toBe('legacy');
    } finally { sqlite.close(); }
  });

  it('canonical and shadow modes fail closed when exact mapping or canonical root is absent', async () => {
    const { sqlite, db } = harness();
    try {
      setMode(sqlite, 'canonical', true);
      await expect(resolveEmergencyCaseTriageProjection(db, { ...providerInput, legacyId: 2 }))
        .rejects.toThrow(/exact canonical emergency case mapping is required/i);
      sqlite.prepare(`UPDATE canonical_source_mappings SET canonical_public_id='missing-case'
        WHERE tenant_id='tenant-a' AND entity_type='emergency_case' AND source_public_id='1'`).run();
      await expect(resolveEmergencyCaseTriageProjection(db, providerInput))
        .rejects.toThrow(/exact canonical emergency case mapping does not resolve/i);
      setMode(sqlite, 'shadow', true);
      await expect(resolveEmergencyCaseTriageProjection(db, providerInput))
        .rejects.toThrow(/exact canonical emergency case mapping does not resolve/i);
    } finally { sqlite.close(); }
  });
});
