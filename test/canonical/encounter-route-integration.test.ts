import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  completeRouteEncounter,
  createEncounterVisitSourceKey,
  prepareRouteEncounterCompletionBatch,
  prepareStartRouteEncounterBatch,
  replaceRouteEncounterParticipant,
  resolveEncounterRouteContext,
  startRouteEncounter,
  type EncounterVisitSnapshot,
} from '../../src/lib/canonical/encounter-route-integration';

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
      values.map((value) => value === undefined ? null : value) as SqlValue[],
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
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      name TEXT NOT NULL
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      visit_type TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      visit_no TEXT,
      status TEXT NOT NULL DEFAULT 'initiated',
      appointment_id INTEGER,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    );
  `);
  sqlite.exec(readFileSync('migrations/0567_encounter_visit_route_identity.sql', 'utf8'));
  const db: CanonicalBatchDatabase = {
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
  seed(sqlite);
  return { sqlite, db };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO doctors(id,tenant_id,canonical_source_key,name)
    VALUES
      (1,'tenant-a','doctor-source-1','Doctor One'),
      (2,'tenant-a','doctor-source-2','Doctor Two');
    INSERT INTO canonical_practitioners(
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('tenant-a','practitioner-1','internal','Doctor One','active'),
      ('tenant-a','practitioner-2','internal','Doctor Two','active');
  `);
  for (const [source, practitioner] of [
    ['doctor-source-1', 'practitioner-1'],
    ['doctor-source-2', 'practitioner-2'],
  ]) {
    sqlite.prepare(`
      INSERT INTO canonical_source_mappings(
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES ('tenant-a','practitioner',?,'legacy_doctor',?,'doctors','mapped',1,?)
    `).run(practitioner, source, 'a'.repeat(64));
  }
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links(
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
      ?,'2026-07-29T00:00:00.000Z',1)
  `).run('b'.repeat(64));
}

function snapshot(overrides: Partial<EncounterVisitSnapshot> = {}): EncounterVisitSnapshot {
  return {
    visitId: 10,
    patientId: 101,
    doctorId: 1,
    visitType: 'opd',
    visitDate: '2026-07-29',
    status: 'initiated',
    appointmentId: null,
    canonicalSourceKey: null,
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('encounter route integration', () => {
  it('creates the legacy visit, audit, encounter, participant, mapping and outbox atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const sourceKey = await createEncounterVisitSourceKey('tenant-a', 'visit-create-10');
      await expect(startRouteEncounter(db, {
        tenantId: 'tenant-a',
        visitId: 10,
        patientId: 101,
        doctorId: 1,
        visitType: 'opd',
        startedAtUtc: '2026-07-29T01:00:00.000Z',
        sourceEvidence: { sourceKey, visitId: 10, patientId: 101, doctorId: 1 },
        idempotencyKey: 'route:visit-create:10',
        businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO visits(
              id,tenant_id,patient_id,doctor_id,visit_type,visit_date,visit_no,
              status,canonical_source_key,created_at
            ) VALUES (10,'tenant-a',101,1,'opd','2026-07-29','V-10','initiated',?,?)
          `).bind(sourceKey, '2026-07-29 07:00:00'),
          db.prepare(`INSERT INTO audit_logs(marker) VALUES ('visit-create-10')`),
        ],
      })).resolves.toMatchObject({
        status: 'applied',
        result: { status: 'in_progress', version: 1 },
      });
      expect(sqlite.prepare(`
        SELECT canonical_source_key FROM visits WHERE id=10
      `).get()).toEqual({ canonical_source_key: sourceKey });
      expect(count(sqlite, 'canonical_encounters')).toBe(1);
      expect(count(sqlite, 'canonical_encounter_participants')).toBe(1);
      expect(count(sqlite, 'audit_logs')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
      const context = await resolveEncounterRouteContext(db, {
        tenantId: 'tenant-a',
        visit: snapshot({ canonicalSourceKey: sourceKey }),
      });
      expect(context).toMatchObject({
        patientLinkPublicId: 'ptl-101',
        practitionerPublicId: 'practitioner-1',
        encounterVersion: 1,
        encounterStatus: 'in_progress',
      });
    } finally {
      sqlite.close();
    }
  });

  it('prepares route encounter start for composition without executing it', async () => {
    const { sqlite, db } = harness();
    try {
      const sourceKey = await createEncounterVisitSourceKey('tenant-a', 'visit-15');
      const prepared = await prepareStartRouteEncounterBatch(db, {
        tenantId: 'tenant-a',
        visitId: 15,
        patientId: 101,
        doctorId: 1,
        visitType: 'opd',
        startedAtUtc: '2026-07-29T01:00:00.000Z',
        sourceEvidence: { sourceKey, visitId: 15 },
        idempotencyKey: 'route:visit-create:15',
        businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO visits(id,tenant_id,patient_id,doctor_id,visit_type,visit_date,visit_no,status,canonical_source_key)
            VALUES (15,'tenant-a',101,1,'opd','2026-07-29','V-15','initiated',?)
          `).bind(sourceKey),
        ],
      });
      expect(prepared.status).toBe('prepared');
      expect(count(sqlite, 'visits')).toBe(0);
      expect(count(sqlite, 'canonical_encounters')).toBe(0);
      await db.batch([...prepared.statements]);
      expect(count(sqlite, 'visits')).toBe(1);
      expect(count(sqlite, 'canonical_encounters')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('replaces the treating participant then completes the encounter with replay/conflict guards', async () => {
    const { sqlite, db } = harness();
    try {
      const sourceKey = await createEncounterVisitSourceKey('tenant-a', 'visit-20');
      await startRouteEncounter(db, {
        tenantId: 'tenant-a', visitId: 20, patientId: 101, doctorId: 1, visitType: 'opd',
        startedAtUtc: '2026-07-29T01:00:00.000Z',
        sourceEvidence: { sourceKey, visitId: 20 },
        idempotencyKey: 'route:visit-create:20', businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO visits(id,tenant_id,patient_id,doctor_id,visit_type,visit_date,visit_no,status,canonical_source_key)
            VALUES (20,'tenant-a',101,1,'opd','2026-07-29','V-20','initiated',?)
          `).bind(sourceKey),
        ],
      });
      const first = await resolveEncounterRouteContext(db, {
        tenantId: 'tenant-a', visit: snapshot({ visitId: 20, canonicalSourceKey: sourceKey }),
      });
      await replaceRouteEncounterParticipant(db, first, {
        doctorId: 2,
        changedAtUtc: '2026-07-29T01:15:00.000Z',
        sourceEvidence: { visitId: 20, from: 1, to: 2 },
        idempotencyKey: 'route:visit-doctor:20:2',
        businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`UPDATE visits SET doctor_id=2 WHERE id=20 AND tenant_id='tenant-a'`),
        ],
      });
      expect(sqlite.prepare(`
        SELECT practitioner_public_id,active_to_utc
        FROM canonical_encounter_participants
        WHERE encounter_public_id=? ORDER BY id DESC LIMIT 1
      `).get(first.encounterPublicId)).toEqual({ practitioner_public_id: 'practitioner-2', active_to_utc: null });
      const second = await resolveEncounterRouteContext(db, {
        tenantId: 'tenant-a', visit: snapshot({ visitId: 20, doctorId: 2, canonicalSourceKey: sourceKey }),
      });
      const input = {
        completedAtUtc: '2026-07-29T02:00:00.000Z',
        sourceEvidence: { visitId: 20, discharge: true },
        idempotencyKey: 'route:visit-complete:20',
        businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`UPDATE visits SET status='completed' WHERE id=20 AND tenant_id='tenant-a'`),
        ],
      };
      await expect(completeRouteEncounter(db, second, input)).resolves.toMatchObject({ status: 'applied' });
      await expect(completeRouteEncounter(db, { ...second, encounterVersion: 3 }, {
        ...input,
        completedAtUtc: '2026-07-29T02:05:00.000Z',
        authoritativeStatements: [],
      })).resolves.toMatchObject({ status: 'replayed' });
      await expect(completeRouteEncounter(db, second, {
        ...input,
        sourceEvidence: { visitId: 20, discharge: false },
        authoritativeStatements: [],
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('prepares composite completion and rolls back every compatibility and Canonical statement', async () => {
    const { sqlite, db } = harness();
    try {
      const sourceKey = await createEncounterVisitSourceKey('tenant-a', 'visit-30');
      await startRouteEncounter(db, {
        tenantId: 'tenant-a', visitId: 30, patientId: 101, doctorId: null, visitType: 'ipd',
        startedAtUtc: '2026-07-29T01:00:00.000Z',
        sourceEvidence: { sourceKey, visitId: 30 },
        idempotencyKey: 'route:visit-create:30', businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO visits(id,tenant_id,patient_id,doctor_id,visit_type,visit_date,visit_no,status,canonical_source_key)
            VALUES (30,'tenant-a',101,NULL,'ipd','2026-07-29','V-30','initiated',?)
          `).bind(sourceKey),
        ],
      });
      const context = await resolveEncounterRouteContext(db, {
        tenantId: 'tenant-a',
        visit: snapshot({ visitId: 30, doctorId: null, visitType: 'ipd', canonicalSourceKey: sourceKey }),
      });
      sqlite.exec(`CREATE TABLE compatibility_guard(id INTEGER PRIMARY KEY, marker TEXT UNIQUE NOT NULL);`);
      sqlite.prepare(`INSERT INTO compatibility_guard(id,marker) VALUES (1,'duplicate')`).run();
      const prepared = await prepareRouteEncounterCompletionBatch(db, context, {
        completedAtUtc: '2026-07-29T03:00:00.000Z',
        sourceEvidence: { visitId: 30, completion: true },
        idempotencyKey: 'route:visit-complete:30',
        businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`UPDATE visits SET status='completed' WHERE id=30`),
          db.prepare(`INSERT INTO compatibility_guard(id,marker) VALUES (2,'duplicate')`),
        ],
      });
      expect(prepared.status).toBe('prepared');
      await expect(db.batch([...prepared.statements])).rejects.toThrow();
      expect(sqlite.prepare(`SELECT status FROM visits WHERE id=30`).get()).toEqual({ status: 'initiated' });
      expect(sqlite.prepare(`SELECT status,encounter_version FROM canonical_encounters`).get())
        .toEqual({ status: 'in_progress', encounter_version: 1 });
      expect(Number((sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_outbox_events
        WHERE event_type='canonical.encounter.completed'
      `).get() as { count: number }).count)).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
