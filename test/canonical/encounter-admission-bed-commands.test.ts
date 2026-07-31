import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  admitPatientAndClaimBed,
  dischargeOrCancelAdmission,
  transferAdmissionBed,
  type AdmitPatientAndClaimBedInput,
  type DischargeOrCancelAdmissionInput,
  type TransferAdmissionBedInput,
} from '../../src/lib/canonical/commands/manage-admission-bed-stay';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
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
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_admission_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    );
  `);
  seedFoundation(sqlite);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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
  return { sqlite, db };
}

function seedFoundation(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES
      ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
       '${'1'.repeat(64)}','2026-07-27T00:00:00.000Z',1),
      ('tenant-a','ptl-102',102,'unlinked','unverified','no_link_placeholder',
       '${'2'.repeat(64)}','2026-07-27T00:00:00.000Z',1),
      ('tenant-b','ptl-b-101',101,'unlinked','unverified','no_link_placeholder',
       '${'3'.repeat(64)}','2026-07-27T00:00:00.000Z',1);

    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('tenant-a','practitioner-101','internal','Synthetic Doctor A','active'),
      ('tenant-b','practitioner-b-101','internal','Synthetic Doctor B','active');

    INSERT INTO canonical_care_locations (
      tenant_id,location_public_id,parent_location_public_id,location_kind,
      location_code,display_name,operational_status,timezone,version,source_evidence_sha256
    ) VALUES
      ('tenant-a','location-ward-a',NULL,'ward','WARD-A','Ward A','active','Asia/Dhaka',1,'${'4'.repeat(64)}'),
      ('tenant-a','location-ward-b',NULL,'ward','WARD-B','Ward B','active','Asia/Dhaka',1,'${'5'.repeat(64)}'),
      ('tenant-b','location-ward-b-tenant',NULL,'ward','WARD-B','Ward B','active','Asia/Dhaka',1,'${'6'.repeat(64)}');

    INSERT INTO canonical_beds (
      tenant_id,bed_public_id,location_public_id,bed_code,bed_class,
      operational_status,version,source_evidence_sha256
    ) VALUES
      ('tenant-a','bed-a-01','location-ward-a','A-01','general','active',1,'${'7'.repeat(64)}'),
      ('tenant-a','bed-b-01','location-ward-b','B-01','general','active',1,'${'8'.repeat(64)}'),
      ('tenant-a','bed-maintenance','location-ward-b','B-02','general','maintenance',1,'${'9'.repeat(64)}'),
      ('tenant-b','bed-b-tenant','location-ward-b-tenant','B-01','general','active',1,'${'a'.repeat(64)}');

    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,care_location_public_id,source_kind,
      source_command_key,started_at_utc,source_evidence_sha256
    ) VALUES
      ('tenant-a','encounter-ipd-101',101,'ptl-101','inpatient','in_progress',1,
       'location-ward-a','runtime','encounter-command-101','2026-07-27T08:00:00.000Z','${'b'.repeat(64)}'),
      ('tenant-a','encounter-ipd-102',102,'ptl-102','inpatient','in_progress',1,
       'location-ward-a','runtime','encounter-command-102','2026-07-27T08:10:00.000Z','${'c'.repeat(64)}'),
      ('tenant-a','encounter-opd-101',101,'ptl-101','outpatient','in_progress',1,
       'location-ward-a','runtime','encounter-command-opd','2026-07-27T08:20:00.000Z','${'d'.repeat(64)}');
  `);
}

function admitInput(overrides: Partial<AdmitPatientAndClaimBedInput> = {}): AdmitPatientAndClaimBedInput {
  return {
    tenantId: 'tenant-a',
    admissionPublicId: 'admission-101',
    bedStayPublicId: 'stay-101-a',
    patientLinkPublicId: 'ptl-101',
    encounterPublicId: 'encounter-ipd-101',
    admittingPractitionerPublicId: 'practitioner-101',
    admissionNumber: 'ADM-000101',
    admissionType: 'inpatient',
    admissionSource: 'planned',
    admittedAtUtc: '2026-07-27T08:30:00.000Z',
    reasonCode: 'planned_admission',
    bedPublicId: 'bed-a-01',
    expectedBedVersion: 1,
    sourceType: 'legacy_admission',
    sourcePublicId: '101',
    sourceTable: 'admissions',
    sourceEvidenceSha256: 'e'.repeat(64),
    actorSystemKey: 'canonical.admission.test',
    idempotencyKey: 'admit-101',
    eventPublicId: 'event-admit-101',
    occurredAtUtc: '2026-07-27T08:30:00.000Z',
    businessDate: '2026-07-27',
    ...overrides,
  };
}

function transferInput(overrides: Partial<TransferAdmissionBedInput> = {}): TransferAdmissionBedInput {
  return {
    tenantId: 'tenant-a',
    admissionPublicId: 'admission-101',
    expectedAdmissionVersion: 1,
    currentStayPublicId: 'stay-101-a',
    expectedCurrentStayVersion: 1,
    destinationBedPublicId: 'bed-b-01',
    expectedDestinationBedVersion: 1,
    destinationStayPublicId: 'stay-101-b',
    effectiveAtUtc: '2026-07-27T10:00:00.000Z',
    movementReason: 'transfer',
    reasonCode: 'clinical_transfer',
    sourceEvidenceSha256: 'f'.repeat(64),
    actorSystemKey: 'canonical.admission.test',
    idempotencyKey: 'transfer-101-b',
    eventPublicId: 'event-transfer-101-b',
    occurredAtUtc: '2026-07-27T10:00:00.000Z',
    businessDate: '2026-07-27',
    ...overrides,
  };
}

function closeInput(overrides: Partial<DischargeOrCancelAdmissionInput> = {}): DischargeOrCancelAdmissionInput {
  return {
    tenantId: 'tenant-a',
    admissionPublicId: 'admission-101',
    expectedAdmissionVersion: 2,
    targetStatus: 'discharged',
    reasonCode: 'normal_discharge',
    expectedActiveStayPublicId: 'stay-101-b',
    expectedActiveStayVersion: 1,
    sourceEvidenceSha256: '0'.repeat(64),
    actorSystemKey: 'canonical.admission.test',
    idempotencyKey: 'discharge-101',
    eventPublicId: 'event-discharge-101',
    occurredAtUtc: '2026-07-27T12:00:00.000Z',
    businessDate: '2026-07-27',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function admitAndTransfer(db: CanonicalBatchDatabase): Promise<void> {
  await admitPatientAndClaimBed(db, admitInput());
  await transferAdmissionBed(db, transferInput());
}

describe('canonical admission and bed-stay commands', () => {
  it('atomically admits the exact encounter patient, records practitioner evidence, and claims a bed', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES (?)`).bind('legacy-admission-101');
      await expect(admitPatientAndClaimBed(db, admitInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          admissionPublicId: 'admission-101',
          currentStatus: 'admitted',
          statusVersion: 1,
          bedStayPublicId: 'stay-101-a',
        },
      });
      expect(sqlite.prepare(`
        SELECT encounter_public_id,patient_link_public_id,current_status,status_version
        FROM canonical_admissions WHERE admission_public_id='admission-101'
      `).get()).toEqual({
        encounter_public_id: 'encounter-ipd-101',
        patient_link_public_id: 'ptl-101',
        current_status: 'admitted',
        status_version: 1,
      });
      expect(sqlite.prepare(`
        SELECT admission_public_id,bed_public_id,status,stay_version,movement_reason
        FROM canonical_bed_stays WHERE bed_stay_public_id='stay-101-a'
      `).get()).toEqual({
        admission_public_id: 'admission-101',
        bed_public_id: 'bed-a-01',
        status: 'active',
        stay_version: 1,
        movement_reason: 'admission',
      });
      expect(sqlite.prepare(`
        SELECT event_type,from_status,to_status,sequence
        FROM canonical_admission_status_events WHERE admission_public_id='admission-101'
      `).get()).toEqual({
        event_type: 'admitted',
        from_status: null,
        to_status: 'admitted',
        sequence: 1,
      });
      expect(count(sqlite, 'legacy_admission_compat')).toBe(1);
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_source_mappings
        WHERE entity_type IN ('admission','bed_stay')
      `).get()).toEqual({ count: 2 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_encounter_participants
        WHERE encounter_public_id='encounter-ipd-101' AND participant_role='admitting'
      `).get()).toEqual({ count: 1 });
      const outbox = sqlite.prepare(`
        SELECT payload_json FROM canonical_outbox_events WHERE idempotency_key='admit-101'
      `).get() as { payload_json: string };
      for (const forbidden of [
        'Synthetic Doctor A', 'planned_admission', 'legacy_admission', 'ptl-101',
        'Ward A', 'A-01', 'admissions', 'eeeeeeee',
      ]) expect(outbox.payload_json).not.toContain(forbidden);
    } finally {
      sqlite.close();
    }
  });

  it('replays exactly and rejects conflicting replay, stale bed versions, mismatched patients, and duplicate active admissions', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await admitPatientAndClaimBed(db, admitInput());
      await expect(admitPatientAndClaimBed(db, admitInput())).resolves.toEqual({
        status: 'replayed',
        result: first.result,
      });
      await expect(admitPatientAndClaimBed(db, admitInput({
        admissionNumber: 'ADM-CHANGED',
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      await expect(admitPatientAndClaimBed(db, admitInput({
        admissionPublicId: 'admission-stale-bed',
        bedStayPublicId: 'stay-stale-bed',
        admissionNumber: 'ADM-STALE',
        encounterPublicId: 'encounter-ipd-102',
        patientLinkPublicId: 'ptl-102',
        expectedBedVersion: 2,
        sourcePublicId: '102',
        idempotencyKey: 'admit-stale-bed',
        eventPublicId: 'event-admit-stale-bed',
      }))).rejects.toThrow(/bed.*version|expectedBedVersion/i);

      await expect(admitPatientAndClaimBed(db, admitInput({
        admissionPublicId: 'admission-patient-mismatch',
        bedStayPublicId: 'stay-patient-mismatch',
        admissionNumber: 'ADM-MISMATCH',
        patientLinkPublicId: 'ptl-102',
        bedPublicId: 'bed-b-01',
        sourcePublicId: '103',
        idempotencyKey: 'admit-patient-mismatch',
        eventPublicId: 'event-admit-patient-mismatch',
      }))).rejects.toThrow(/patient.*encounter|encounter.*patient/i);

      await expect(admitPatientAndClaimBed(db, admitInput({
        admissionPublicId: 'admission-duplicate',
        bedStayPublicId: undefined,
        admissionNumber: 'ADM-DUPLICATE',
        bedPublicId: null,
        expectedBedVersion: null,
        sourcePublicId: '104',
        idempotencyKey: 'admit-duplicate',
        eventPublicId: 'event-admit-duplicate',
      }))).rejects.toThrow(/active admission/i);
      expect(count(sqlite, 'canonical_admissions')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rejects outpatient encounters, inactive beds, and atomically rolls back compatibility failure', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(admitPatientAndClaimBed(db, admitInput({
        admissionPublicId: 'admission-opd',
        bedStayPublicId: 'stay-opd',
        admissionNumber: 'ADM-OPD',
        encounterPublicId: 'encounter-opd-101',
        sourcePublicId: 'opd-101',
        idempotencyKey: 'admit-opd',
        eventPublicId: 'event-admit-opd',
      }))).rejects.toThrow(/inpatient encounter/i);
      await expect(admitPatientAndClaimBed(db, admitInput({
        admissionPublicId: 'admission-maintenance-bed',
        bedStayPublicId: 'stay-maintenance-bed',
        admissionNumber: 'ADM-MAINT',
        encounterPublicId: 'encounter-ipd-102',
        patientLinkPublicId: 'ptl-102',
        bedPublicId: 'bed-maintenance',
        sourcePublicId: 'maintenance-102',
        idempotencyKey: 'admit-maintenance-bed',
        eventPublicId: 'event-admit-maintenance-bed',
      }))).rejects.toThrow(/active bed/i);

      sqlite.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES ('duplicate')`);
      await expect(admitPatientAndClaimBed(db, admitInput(), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      expect(count(sqlite, 'canonical_admissions')).toBe(0);
      expect(count(sqlite, 'canonical_bed_stays')).toBe(0);
      expect(count(sqlite, 'canonical_admission_status_events')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('atomically closes the current stay, opens the destination stay, versions admission history, and replays once', async () => {
    const { sqlite, db } = harness();
    try {
      await admitPatientAndClaimBed(db, admitInput());
      const compatibility = db.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES (?)`).bind('legacy-transfer-101');
      const transferred = await transferAdmissionBed(db, transferInput(), {
        authoritativeStatements: [compatibility],
      });
      expect(transferred).toEqual({
        status: 'applied',
        result: {
          admissionPublicId: 'admission-101',
          currentStatus: 'admitted',
          statusVersion: 2,
          previousStayPublicId: 'stay-101-a',
          activeStayPublicId: 'stay-101-b',
        },
      });
      expect(sqlite.prepare(`
        SELECT status,stay_version,ended_at_utc,close_reason
        FROM canonical_bed_stays WHERE bed_stay_public_id='stay-101-a'
      `).get()).toEqual({
        status: 'completed',
        stay_version: 2,
        ended_at_utc: '2026-07-27T10:00:00.000Z',
        close_reason: 'transfer',
      });
      expect(sqlite.prepare(`
        SELECT bed_public_id,status,stay_version,movement_reason
        FROM canonical_bed_stays WHERE bed_stay_public_id='stay-101-b'
      `).get()).toEqual({
        bed_public_id: 'bed-b-01',
        status: 'active',
        stay_version: 1,
        movement_reason: 'transfer',
      });
      expect(sqlite.prepare(`
        SELECT event_type,from_status,to_status,sequence
        FROM canonical_admission_status_events
        WHERE admission_public_id='admission-101' AND sequence=2
      `).get()).toEqual({
        event_type: 'transfer_received',
        from_status: 'admitted',
        to_status: 'admitted',
        sequence: 2,
      });
      await expect(transferAdmissionBed(db, transferInput())).resolves.toEqual({
        status: 'replayed',
        result: transferred.result,
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_bed_stays
        WHERE admission_public_id='admission-101'
      `).get()).toEqual({ count: 2 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects stale transfer state, occupied destinations, and rolls the entire transfer back on compatibility failure', async () => {
    const { sqlite, db } = harness();
    try {
      await admitPatientAndClaimBed(db, admitInput());
      await expect(transferAdmissionBed(db, transferInput({
        expectedCurrentStayVersion: 2,
      }))).rejects.toThrow(/stay.*version|expectedCurrentStayVersion/i);

      await admitPatientAndClaimBed(db, admitInput({
        admissionPublicId: 'admission-102',
        bedStayPublicId: 'stay-102-b',
        patientLinkPublicId: 'ptl-102',
        encounterPublicId: 'encounter-ipd-102',
        admissionNumber: 'ADM-000102',
        bedPublicId: 'bed-b-01',
        sourcePublicId: '102',
        idempotencyKey: 'admit-102',
        eventPublicId: 'event-admit-102',
      }));
      await expect(transferAdmissionBed(db, transferInput())).rejects.toThrow(/destination.*open stay|occupied/i);

      sqlite.prepare(`UPDATE canonical_bed_stays SET status='completed',ended_at_utc=?,close_reason='test' WHERE bed_stay_public_id='stay-102-b'`)
        .run('2026-07-27T09:30:00.000Z');
      sqlite.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES ('duplicate')`);
      await expect(transferAdmissionBed(db, transferInput(), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      expect(sqlite.prepare(`
        SELECT status,stay_version,ended_at_utc FROM canonical_bed_stays
        WHERE bed_stay_public_id='stay-101-a'
      `).get()).toEqual({ status: 'active', stay_version: 1, ended_at_utc: null });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_bed_stays
        WHERE bed_stay_public_id='stay-101-b'
      `).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT status_version FROM canonical_admissions WHERE admission_public_id='admission-101'
      `).get()).toEqual({ status_version: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('discharges once, closes the exact active stay, appends terminal history, and rejects stale competing transitions', async () => {
    const { sqlite, db } = harness();
    try {
      await admitAndTransfer(db);
      const discharged = await dischargeOrCancelAdmission(db, closeInput());
      expect(discharged).toEqual({
        status: 'applied',
        result: {
          admissionPublicId: 'admission-101',
          currentStatus: 'discharged',
          statusVersion: 3,
          closedStayPublicId: 'stay-101-b',
        },
      });
      expect(sqlite.prepare(`
        SELECT current_status,status_version,discharged_at_utc
        FROM canonical_admissions WHERE admission_public_id='admission-101'
      `).get()).toEqual({
        current_status: 'discharged',
        status_version: 3,
        discharged_at_utc: '2026-07-27T12:00:00.000Z',
      });
      expect(sqlite.prepare(`
        SELECT status,stay_version,ended_at_utc,close_reason
        FROM canonical_bed_stays WHERE bed_stay_public_id='stay-101-b'
      `).get()).toEqual({
        status: 'completed',
        stay_version: 2,
        ended_at_utc: '2026-07-27T12:00:00.000Z',
        close_reason: 'discharge',
      });
      await expect(dischargeOrCancelAdmission(db, closeInput())).resolves.toEqual({
        status: 'replayed',
        result: discharged.result,
      });
      await expect(dischargeOrCancelAdmission(db, closeInput({
        targetStatus: 'cancelled',
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      await expect(dischargeOrCancelAdmission(db, closeInput({
        idempotencyKey: 'stale-terminal-101',
        eventPublicId: 'event-stale-terminal-101',
      }))).rejects.toThrow(/version|terminal|status/i);
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_admission_status_events
        WHERE admission_public_id='admission-101' AND to_status='discharged'
      `).get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('supports cancellation without a bed and rolls back terminal clinical state when compatibility fails', async () => {
    const { sqlite, db } = harness();
    try {
      await admitPatientAndClaimBed(db, admitInput({
        bedStayPublicId: undefined,
        bedPublicId: null,
        expectedBedVersion: null,
      }));
      sqlite.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_admission_compat(marker) VALUES ('duplicate')`);
      await expect(dischargeOrCancelAdmission(db, closeInput({
        expectedAdmissionVersion: 1,
        targetStatus: 'cancelled',
        reasonCode: 'admission_cancelled',
        expectedActiveStayPublicId: null,
        expectedActiveStayVersion: null,
        idempotencyKey: 'cancel-admission-101',
        eventPublicId: 'event-cancel-admission-101',
      }), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_admissions
        WHERE admission_public_id='admission-101'
      `).get()).toEqual({ current_status: 'admitted', status_version: 1 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_admission_status_events
        WHERE admission_public_id='admission-101'
      `).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_outbox_events
        WHERE idempotency_key='cancel-admission-101'
      `).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
