import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  cancelEncounter,
  completeEncounter,
  prepareCompleteEncounterBatch,
  prepareStartEncounterBatch,
  replaceEncounterParticipant,
  startEncounter,
} from '../../src/lib/canonical/commands/start-encounter';

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
      meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) },
    };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0507_canonical_encounters.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0508_canonical_service_catalog.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0509_canonical_service_requests_events.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0544_canonical_tenant_patient_links.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0548_canonical_encounter_admission_bed_convergence.sql', 'utf8'));
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id, practitioner_public_id, practitioner_kind, display_name, status
    ) VALUES
      ('tenant-a', 'prc_01', 'internal', 'Synthetic Practitioner', 'active'),
      ('tenant-a', 'prc_02', 'internal', 'Replacement Practitioner', 'active');
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES (
      'tenant-a','ptl_101',101,'unlinked','unverified','no_link_placeholder',
      '${'b'.repeat(64)}','2026-07-14T01:00:00.000Z',1
    );
  `);
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

function input(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    encounterPublicId: 'enc_01',
    legacyPatientId: 101,
    patientLinkPublicId: 'ptl_101',
    encounterType: 'outpatient' as const,
    startedAtUtc: '2026-07-14T02:00:00.000Z',
    practitionerPublicId: 'prc_01',
    participantRole: 'treating' as const,
    sourceType: 'runtime_visit',
    sourcePublicId: 'visit-101',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'a'.repeat(64),
    idempotencyKey: 'start-encounter-101',
    eventPublicId: 'evt_start_encounter_101',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function cancelInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    encounterPublicId: 'enc_01',
    expectedVersion: 1,
    cancelledAtUtc: '2026-07-14T02:30:00.000Z',
    sourceEvidenceSha256: 'c'.repeat(64),
    idempotencyKey: 'cancel-encounter-101',
    eventPublicId: 'evt_cancel_encounter_101',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function completeInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    encounterPublicId: 'enc_01',
    expectedVersion: 1,
    completedAtUtc: '2026-07-14T02:45:00.000Z',
    sourceEvidenceSha256: 'd'.repeat(64),
    idempotencyKey: 'complete-encounter-101',
    eventPublicId: 'evt_complete_encounter_101',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function participantInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    encounterPublicId: 'enc_01',
    expectedVersion: 1,
    practitionerPublicId: 'prc_02',
    participantRole: 'treating' as const,
    changedAtUtc: '2026-07-14T02:20:00.000Z',
    sourceEvidenceSha256: 'e'.repeat(64),
    idempotencyKey: 'replace-participant-101',
    eventPublicId: 'evt_replace_participant_101',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

describe('start canonical encounter command', () => {
  it('atomically creates encounter, participant, source mapping, and PHI-free outbox event', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await startEncounter(db, input());
      expect(result).toEqual({
        status: 'applied',
        result: { encounterPublicId: 'enc_01', status: 'in_progress', version: 1 },
      });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounters').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounter_participants').get()).toEqual({ count: 1 });
      expect(
        sqlite.prepare("SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='encounter'").get(),
      ).toEqual({ count: 1 });
      const outbox = sqlite.prepare('SELECT payload_json FROM canonical_outbox_events').get() as { payload_json: string };
      const envelope = JSON.parse(outbox.payload_json) as Record<string, unknown>;
      expect(JSON.stringify(Object.keys(envelope))).not.toContain('legacyPatientId');
      expect(JSON.stringify(envelope)).not.toContain('legacyPatientId');
      expect((envelope as { event: unknown }).event).toEqual({
        encounterPublicId: 'enc_01',
        encounterType: 'outpatient',
        status: 'in_progress',
        version: 1,
        careLocationPublicId: null,
      });
    } finally {
      sqlite.close();
    }
  });

  it('prepares encounter start for one outer atomic batch and rolls back compatibility failure', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`CREATE TABLE compatibility_guard (id INTEGER PRIMARY KEY, marker TEXT UNIQUE NOT NULL);`);
      sqlite.prepare(`INSERT INTO compatibility_guard(id,marker) VALUES (1,'duplicate')`).run();
      const prepared = await prepareStartEncounterBatch(db, input(), [
        db.prepare(`INSERT INTO compatibility_guard(id,marker) VALUES (2,'duplicate')`),
      ]);
      expect(prepared.status).toBe('prepared');
      await expect(db.batch([...prepared.statements])).rejects.toThrow();
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounters').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_source_mappings').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_outbox_events').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('replays the prior result and rejects a changed semantic request', async () => {
    const { sqlite, db } = harness();
    try {
      await startEncounter(db, input());
      expect(await startEncounter(db, input())).toEqual({
        status: 'replayed',
        result: { encounterPublicId: 'enc_01', status: 'in_progress', version: 1 },
      });
      await expect(
        startEncounter(db, input({ encounterType: 'emergency' })),
      ).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounters').get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back encounter, mapping, and outbox when the practitioner link is invalid', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(
        startEncounter(db, input({ practitionerPublicId: 'prc_missing' })),
      ).rejects.toThrow(/active practitioner|FOREIGN KEY constraint failed/i);
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounters').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_source_mappings').get()).toEqual({ count: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_outbox_events').get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('cancels an in-progress encounter, closes participants, and replays exactly', async () => {
    const { sqlite, db } = harness();
    try {
      await startEncounter(db, input());
      expect(await cancelEncounter(db, cancelInput())).toEqual({
        status: 'applied',
        result: { encounterPublicId: 'enc_01', status: 'cancelled', version: 2 },
      });
      expect(sqlite.prepare(`
        SELECT status,ended_at_utc FROM canonical_encounters
        WHERE tenant_id='tenant-a' AND encounter_public_id='enc_01'
      `).get()).toEqual({ status: 'cancelled', ended_at_utc: '2026-07-14T02:30:00.000Z' });
      expect(sqlite.prepare(`
        SELECT active_to_utc FROM canonical_encounter_participants
        WHERE tenant_id='tenant-a' AND encounter_public_id='enc_01'
      `).get()).toEqual({ active_to_utc: '2026-07-14T02:30:00.000Z' });
      expect(sqlite.prepare(`
        SELECT event_type,aggregate_public_id,payload_json
        FROM canonical_outbox_events WHERE idempotency_key='cancel-encounter-101'
      `).get()).toMatchObject({
        event_type: 'canonical.encounter.cancelled',
        aggregate_public_id: 'enc_01',
      });
      expect(await cancelEncounter(db, cancelInput())).toEqual({
        status: 'replayed',
        result: { encounterPublicId: 'enc_01', status: 'cancelled', version: 2 },
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_outbox_events
        WHERE event_type='canonical.encounter.cancelled'
      `).get()).toEqual({ count: 1 });
      await expect(cancelEncounter(db, cancelInput({ cancelledAtUtc: '2026-07-14T02:31:00.000Z' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('blocks encounter cancellation before start or while a dependent request remains active', async () => {
    const { sqlite, db } = harness();
    try {
      await startEncounter(db, input());
      await expect(cancelEncounter(db, cancelInput({ cancelledAtUtc: '2026-07-14T01:59:00.000Z' })))
        .rejects.toThrow(/before encounter start/i);
      sqlite.prepare(`
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,
          unit_code,status,source_evidence_sha256
        ) VALUES ('tenant-a','svc-x','laboratory','SVC-X','Synthetic Service',
          'service','active',?)
      `).run('c'.repeat(64));
      sqlite.prepare(`
        INSERT INTO canonical_service_requests (
          tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
          service_public_id,requested_quantity,fulfilled_quantity,status,
          requested_at_utc,source_evidence_sha256
        ) VALUES ('tenant-a','req-active',101,'enc_01','svc-x',1,0,'active',
          '2026-07-14T02:10:00.000Z',?)
      `).run('b'.repeat(64));
      await expect(cancelEncounter(db, cancelInput())).rejects.toThrow(/active service request/i);
      expect(sqlite.prepare(`SELECT status,ended_at_utc FROM canonical_encounters`).get())
        .toEqual({ status: 'in_progress', ended_at_utc: null });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.encounter.cancelled'`).get())
        .toEqual({ count: 0 });
      sqlite.prepare(`UPDATE canonical_service_requests SET status='cancelled',cancelled_at_utc=?`).run(
        '2026-07-14T02:20:00.000Z',
      );
      await expect(cancelEncounter(db, cancelInput())).resolves.toMatchObject({ status: 'applied' });
    } finally {
      sqlite.close();
    }
  });

  it('starts an encounter without a practitioner and adds an exact treating participant later', async () => {
    const { sqlite, db } = harness();
    try {
      await startEncounter(db, input({ practitionerPublicId: null, participantRole: null }));
      expect(sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounter_participants').get())
        .toEqual({ count: 0 });
      await expect(replaceEncounterParticipant(db, participantInput())).resolves.toEqual({
        status: 'applied',
        result: {
          encounterPublicId: 'enc_01',
          practitionerPublicId: 'prc_02',
          participantRole: 'treating',
          version: 2,
        },
      });
      expect(sqlite.prepare(`
        SELECT practitioner_public_id,participant_role,active_to_utc
        FROM canonical_encounter_participants
      `).get()).toEqual({
        practitioner_public_id: 'prc_02',
        participant_role: 'treating',
        active_to_utc: null,
      });
      expect(await replaceEncounterParticipant(db, participantInput())).toMatchObject({ status: 'replayed' });
      await expect(replaceEncounterParticipant(db, participantInput({ practitionerPublicId: 'prc_01' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('completes and signs an encounter with exact replay despite transport-time drift', async () => {
    const { sqlite, db } = harness();
    try {
      await startEncounter(db, input());
      const signed = completeInput({
        signedSnapshotSha256: 'f'.repeat(64),
        signedAtUtc: '2026-07-14T02:40:00.000Z',
      });
      await expect(completeEncounter(db, signed)).resolves.toEqual({
        status: 'applied',
        result: { encounterPublicId: 'enc_01', status: 'completed', version: 2, signed: true },
      });
      expect(sqlite.prepare(`
        SELECT status,encounter_version,ended_at_utc,signed_snapshot_sha256,signed_at_utc
        FROM canonical_encounters WHERE encounter_public_id='enc_01'
      `).get()).toEqual({
        status: 'completed',
        encounter_version: 2,
        ended_at_utc: '2026-07-14T02:45:00.000Z',
        signed_snapshot_sha256: 'f'.repeat(64),
        signed_at_utc: '2026-07-14T02:40:00.000Z',
      });
      await expect(completeEncounter(db, {
        ...signed,
        expectedVersion: 2,
        completedAtUtc: '2026-07-14T02:50:00.000Z',
      })).resolves.toMatchObject({ status: 'replayed' });
      await expect(completeEncounter(db, {
        ...signed,
        sourceEvidenceSha256: '9'.repeat(64),
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('prepares encounter completion for one outer atomic batch and rolls back with compatibility failure', async () => {
    const { sqlite, db } = harness();
    try {
      await startEncounter(db, input());
      sqlite.exec(`CREATE TABLE compatibility_guard (id INTEGER PRIMARY KEY, marker TEXT UNIQUE NOT NULL);`);
      sqlite.prepare(`INSERT INTO compatibility_guard(id,marker) VALUES (1,'duplicate')`).run();
      const prepared = await prepareCompleteEncounterBatch(db, completeInput(), [
        db.prepare(`INSERT INTO compatibility_guard(id,marker) VALUES (2,'duplicate')`),
      ]);
      expect(prepared.status).toBe('prepared');
      await expect(db.batch([...prepared.statements])).rejects.toThrow();
      expect(sqlite.prepare(`SELECT status,encounter_version FROM canonical_encounters`).get())
        .toEqual({ status: 'in_progress', encounter_version: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.encounter.completed'`).get())
        .toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
