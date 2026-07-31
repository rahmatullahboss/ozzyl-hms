import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  ensureAdmissionEncounter,
  type EnsureAdmissionEncounterInput,
} from '../../src/lib/canonical/commands/ensure-admission-encounter';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0507_canonical_encounters.sql', 'utf8'));
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
  return { sqlite, db };
}

function input(overrides: Partial<EnsureAdmissionEncounterInput> = {}): EnsureAdmissionEncounterInput {
  return {
    tenantId: '100',
    legacyAdmissionId: 701,
    admissionNo: 'ADM-701',
    legacyPatientId: 501,
    admissionType: 'planned',
    startedAtUtc: '2026-07-27T05:00:00.000Z',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

describe('ensureAdmissionEncounter', () => {
  it('creates deterministic inpatient authority for a planned admission and replays idempotently', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await ensureAdmissionEncounter(db, input());
      const replay = await ensureAdmissionEncounter(db, input());

      expect(first.status).toBe('applied');
      expect(replay).toEqual({ status: 'replayed', result: first.result });
      expect(first.result).toMatchObject({
        legacyAdmissionId: 701,
        encounterType: 'inpatient',
        encounterStatus: 'in_progress',
      });
      expect(sqlite.prepare(`
        SELECT legacy_patient_id,encounter_type,status,started_at_utc
        FROM canonical_encounters WHERE tenant_id='100'
      `).get()).toEqual({
        legacy_patient_id: 501,
        encounter_type: 'inpatient',
        status: 'in_progress',
        started_at_utc: '2026-07-27T05:00:00.000Z',
      });
      expect(sqlite.prepare(`
        SELECT legacy_admission_id,admission_no,link_status
        FROM canonical_encounter_admission_links WHERE tenant_id='100'
      `).get()).toEqual({ legacy_admission_id: 701, admission_no: 'ADM-701', link_status: 'active' });
      expect(sqlite.prepare(`
        SELECT entity_type,source_type,source_public_id,source_table,mapping_status
        FROM canonical_source_mappings WHERE tenant_id='100'
      `).get()).toEqual({
        entity_type: 'encounter',
        source_type: 'legacy_admission',
        source_public_id: '701',
        source_table: 'admissions',
        mapping_status: 'mapped',
      });
      expect(count(sqlite, 'canonical_encounters')).toBe(1);
      expect(count(sqlite, 'canonical_encounter_admission_links')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('creates an emergency encounter for an emergency-origin IPD admission', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await ensureAdmissionEncounter(db, input({
        legacyAdmissionId: 702,
        admissionNo: 'ADM-702',
        admissionType: 'emergency',
      }));

      expect(result.result.encounterType).toBe('emergency');
      expect(sqlite.prepare(`
        SELECT encounter_type FROM canonical_encounters WHERE tenant_id='100'
      `).get()).toEqual({ encounter_type: 'emergency' });
    } finally {
      sqlite.close();
    }
  });

  it('verifies and reuses an existing compatible admission link without adding an outbox event', async () => {
    const { sqlite, db } = harness();
    try {
      const expected = await ensureAdmissionEncounter(db, input());
      sqlite.prepare(`DELETE FROM canonical_outbox_events WHERE tenant_id='100'`).run();

      const reused = await ensureAdmissionEncounter(db, input());

      expect(reused).toEqual({ status: 'replayed', result: expected.result });
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
      expect(count(sqlite, 'canonical_encounters')).toBe(1);
      expect(count(sqlite, 'canonical_encounter_admission_links')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when the existing admission authority belongs to a different patient', async () => {
    const { sqlite, db } = harness();
    try {
      await ensureAdmissionEncounter(db, input());
      await expect(ensureAdmissionEncounter(db, input({ legacyPatientId: 999 })))
        .rejects.toThrow(/patient/i);
      expect(count(sqlite, 'canonical_encounters')).toBe(1);
      expect(count(sqlite, 'canonical_encounter_admission_links')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('rejects unsafe identifiers, invalid admission types and non-normalized timestamps', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(ensureAdmissionEncounter(db, input({ tenantId: ' 100' }))).rejects.toThrow(/tenant/i);
      await expect(ensureAdmissionEncounter(db, input({ legacyAdmissionId: 0 }))).rejects.toThrow(/admission/i);
      await expect(ensureAdmissionEncounter(db, input({ admissionType: 'outpatient' }))).rejects.toThrow(/admissionType/i);
      await expect(ensureAdmissionEncounter(db, input({ startedAtUtc: '2026-07-27 05:00:00' }))).rejects.toThrow(/startedAtUtc/i);
    } finally {
      sqlite.close();
    }
  });
});
