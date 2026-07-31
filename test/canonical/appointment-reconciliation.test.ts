import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillAppointments,
  type AppointmentBackfillDatabase,
  type AppointmentBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-appointments';
import {
  reconcileAppointmentAuthority,
  type AppointmentAuthorityReconciliationDatabase,
  type AppointmentAuthorityReconciliationPreparedStatement,
} from '../../scripts/canonical/reconcile-appointment-authority';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements AppointmentBackfillPreparedStatement, AppointmentAuthorityReconciliationPreparedStatement {
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

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function database(sqlite: DatabaseSync): AppointmentBackfillDatabase & AppointmentAuthorityReconciliationDatabase {
  return {
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
}

function fixture(): {
  sqlite: DatabaseSync;
  db: AppointmentBackfillDatabase & AppointmentAuthorityReconciliationDatabase;
} {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0546_canonical_appointment_authority.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      appt_date TEXT NOT NULL,
      appt_time TEXT,
      appointment_type TEXT,
      visit_type TEXT,
      source TEXT,
      token_no INTEGER,
      token_assignment_type TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE consultations (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      appointment_id INTEGER,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      status TEXT NOT NULL
    );
  `);
  return { sqlite, db: database(sqlite) };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES
      ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
       '${'1'.repeat(64)}','2026-07-26T00:00:00.000Z',1),
      ('tenant-a','ptl-102',102,'unlinked','unverified','no_link_placeholder',
       '${'2'.repeat(64)}','2026-07-26T00:00:00.000Z',1);

    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,version,source_evidence_sha256
    ) VALUES
      ('tenant-a','practitioner-201','internal','Doctor One','active',1,'${'3'.repeat(64)}'),
      ('tenant-a','practitioner-202','internal','Doctor Two','active',1,'${'4'.repeat(64)}');

    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES
      ('tenant-a','practitioner','practitioner-201','legacy_doctor','201','doctors','mapped',1,'${'3'.repeat(64)}'),
      ('tenant-a','practitioner','practitioner-202','legacy_doctor','202','doctors','mapped',1,'${'4'.repeat(64)}');

    INSERT INTO appointments (
      id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
      visit_type,source,token_no,token_assignment_type,status
    ) VALUES
      (9001,'tenant-a',101,201,'2026-07-26','09:00','new_patient','opd','reception',1,'auto','scheduled');

    INSERT INTO consultations (
      id,tenant_id,patient_id,doctor_id,scheduled_at,duration_min,status
    ) VALUES
      (7001,'tenant-a',102,202,'2026-07-27T04:00:00.000Z',30,'scheduled');
  `);
}

async function backfill(sqlite: DatabaseSync, db: AppointmentBackfillDatabase): Promise<void> {
  seed(sqlite);
  await backfillAppointments(db, {
    tenantId: 'tenant-a',
    runPublicId: 'appointment-backfill-reconcile',
    timezone: 'Asia/Dhaka',
    nowUtc: '2026-07-26T00:00:00.000Z',
  });
}

describe('canonical appointment authority reconciliation', () => {
  it('persists a passing aggregate receipt for all fifteen fail-closed checks', async () => {
    const { sqlite, db } = fixture();
    try {
      await backfill(sqlite, db);
      const result = await reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-pass',
        migrationRunPublicId: 'appointment-backfill-reconcile',
        nowUtc: '2026-07-26T00:05:00.000Z',
      });
      expect(result).toEqual({
        status: 'passed',
        scannedChecks: 15,
        matchedChecks: 15,
        mismatchChecks: 0,
        checks: {
          appointmentMappingMismatchCount: 0,
          consultationMappingMismatchCount: 0,
          patientLinkReferenceMismatchCount: 0,
          practitionerReferenceMismatchCount: 0,
          headerLatestEventMismatchCount: 0,
          eventSequenceMismatchCount: 0,
          invalidTransitionHistoryCount: 0,
          rescheduleLineageMismatchCount: 0,
          activeTokenDuplicateCount: 0,
          appointmentActiveLinkCardinalityMismatchCount: 0,
          encounterOriginCardinalityMismatchCount: 0,
          appointmentEncounterPatientMismatchCount: 0,
          forbiddenTerminalFulfilmentLinkCount: 0,
          crossTenantReferenceMismatchCount: 0,
          unresolvedAppointmentIssueCount: 0,
        },
        evidenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      const receipt = sqlite.prepare(`
        SELECT domain,reconciliation_type,status,scanned_count,matched_count,mismatch_count,
               exception_count,evidence_sha256,result_summary_json,migration_run_id
        FROM canonical_reconciliation_runs WHERE run_public_id='appointment-reconcile-pass'
      `).get() as Record<string, unknown>;
      expect(receipt).toMatchObject({
        domain: 'scheduling',
        reconciliation_type: 'backfill',
        status: 'passed',
        scanned_count: 15,
        matched_count: 15,
        mismatch_count: 0,
        exception_count: 0,
        evidence_sha256: result.evidenceSha256,
        migration_run_id: expect.any(Number),
      });
      expect(String(receipt.result_summary_json)).toContain('appointment_authority');
      for (const forbidden of ['Doctor One', 'Doctor Two', '09:00', 'patient_id', 'doctor_id']) {
        expect(String(receipt.result_summary_json)).not.toContain(forbidden);
      }
    } finally {
      sqlite.close();
    }
  });

  it('accepts a completed source without encounter only when its checked-in disposition issue remains exact', async () => {
    const { sqlite, db } = fixture();
    try {
      seed(sqlite);
      sqlite.prepare(`
        UPDATE appointments SET status='completed'
        WHERE tenant_id='tenant-a' AND id=9001
      `).run();
      await backfillAppointments(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-backfill-missing-encounter',
        timezone: 'Asia/Dhaka',
        nowUtc: '2026-07-26T00:00:00.000Z',
      });

      expect(sqlite.prepare(`
        SELECT a.current_status,i.issue_code,i.status
        FROM canonical_appointments a
        JOIN canonical_source_mappings m
          ON m.tenant_id=a.tenant_id AND m.entity_type='appointment'
         AND m.canonical_public_id=a.appointment_public_id
         AND m.source_type='legacy_appointment' AND m.source_public_id='9001'
        JOIN canonical_processing_issues i
          ON i.tenant_id=m.tenant_id AND i.entity_type='appointment'
         AND i.source_type=m.source_type AND i.source_public_id=m.source_public_id
      `).get()).toEqual({
        current_status: 'checked_in',
        issue_code: 'APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING',
        status: 'open',
      });

      const accepted = await reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-missing-encounter-disposition',
        migrationRunPublicId: 'appointment-backfill-missing-encounter',
        nowUtc: '2026-07-26T00:05:00.000Z',
      });
      expect(accepted).toMatchObject({
        status: 'passed',
        mismatchChecks: 0,
        checks: { unresolvedAppointmentIssueCount: 0 },
      });

      sqlite.prepare(`
        DELETE FROM canonical_processing_issues
        WHERE tenant_id='tenant-a'
          AND issue_code='APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING'
          AND source_public_id='9001'
      `).run();
      const missingDisposition = await reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-missing-disposition',
        nowUtc: '2026-07-26T00:06:00.000Z',
      });
      expect(missingDisposition.status).toBe('failed');
      expect(missingDisposition.checks.unresolvedAppointmentIssueCount).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('persists failed status and exact mismatch counts instead of accepting corrupt authority', async () => {
    const { sqlite, db } = fixture();
    try {
      await backfill(sqlite, db);
      sqlite.exec(`
        INSERT INTO appointments (
          id,tenant_id,patient_id,doctor_id,appt_date,appt_time,appointment_type,
          visit_type,source,token_no,token_assignment_type,status
        ) VALUES
          (9002,'tenant-a',101,201,'2026-07-28','10:00','new_patient','opd','reception',2,'auto','scheduled');

        UPDATE canonical_appointments
        SET current_status='confirmed'
        WHERE appointment_public_id=(
          SELECT canonical_public_id FROM canonical_source_mappings
          WHERE entity_type='appointment' AND source_type='legacy_appointment' AND source_public_id='9001'
        );

        INSERT INTO canonical_processing_issues (
          tenant_id,issue_public_id,issue_type,issue_code,entity_type,source_type,
          source_public_id,fingerprint,severity,status,occurrence_count,summary,
          first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
        ) VALUES (
          'tenant-a','issue-open-appointment','appointment_backfill','APPOINTMENT_TIMESTAMP_INVALID',
          'appointment','legacy_appointment','9001','fingerprint-open','error','open',1,
          'Appointment timestamp requires review.','2026-07-26T00:00:00.000Z',
          '2026-07-26T00:00:00.000Z','2026-07-26T00:00:00.000Z','2026-07-26T00:00:00.000Z'
        );
      `);
      const result = await reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-fail',
        migrationRunPublicId: 'appointment-backfill-reconcile',
        nowUtc: '2026-07-26T00:06:00.000Z',
      });
      expect(result.status).toBe('failed');
      expect(result.mismatchChecks).toBeGreaterThanOrEqual(3);
      expect(result.checks).toMatchObject({
        appointmentMappingMismatchCount: 1,
        headerLatestEventMismatchCount: 1,
        unresolvedAppointmentIssueCount: 1,
      });
      expect(sqlite.prepare(`
        SELECT status,mismatch_count,exception_count
        FROM canonical_reconciliation_runs WHERE run_public_id='appointment-reconcile-fail'
      `).get()).toMatchObject({
        status: 'failed',
        mismatch_count: result.mismatchChecks,
        exception_count: result.mismatchChecks,
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects a missing referenced migration run and generates deterministic evidence across reruns', async () => {
    const { sqlite, db } = fixture();
    try {
      await backfill(sqlite, db);
      await expect(reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-missing-run',
        migrationRunPublicId: 'missing-run',
        nowUtc: '2026-07-26T00:07:00.000Z',
      })).rejects.toThrow(/Referenced appointment migration run was not found/);

      const first = await reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-deterministic-1',
        migrationRunPublicId: 'appointment-backfill-reconcile',
        nowUtc: '2026-07-26T00:08:00.000Z',
      });
      const second = await reconcileAppointmentAuthority(db, {
        tenantId: 'tenant-a',
        runPublicId: 'appointment-reconcile-deterministic-2',
        migrationRunPublicId: 'appointment-backfill-reconcile',
        nowUtc: '2026-07-26T00:09:00.000Z',
      });
      expect(second.checks).toEqual(first.checks);
      expect(second.evidenceSha256).toBe(first.evidenceSha256);
    } finally {
      sqlite.close();
    }
  });
});
