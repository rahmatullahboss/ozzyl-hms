import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { ensureLiveAdmissionContinuity } from '../../src/lib/canonical/live-admission-continuity';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values as SqlValue[]);
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
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

const input = {
  tenantId: '100',
  legacyAdmissionId: 701,
  admissionNo: 'ADM-SENSITIVE-701',
  legacyPatientId: 501,
  admissionType: 'planned' as const,
  startedAtUtc: '2026-07-27T05:00:00.000Z',
};

function enableShadow(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,version,config_json,effective_at_utc
    ) VALUES ('100','canonical_financial_dual_write_v1','financial','shadow',1,1,
      '{"tenantScope":["100"],"writePolicy":"shadow"}','2026-07-20T00:00:00.000Z')
  `).run();
}

describe('ensureLiveAdmissionContinuity', () => {
  it('is a no-op when canonical shadow policy is absent', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(ensureLiveAdmissionContinuity(db, input)).resolves.toEqual({ status: 'skipped' });
      expect((sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounters').get() as { count: number }).count).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('projects admission continuity under an exact tenant-scoped shadow flag', async () => {
    const { sqlite, db } = harness();
    try {
      enableShadow(sqlite);
      const result = await ensureLiveAdmissionContinuity(db, input);
      expect(result.status).toBe('applied');
      expect((sqlite.prepare('SELECT COUNT(*) count FROM canonical_encounter_admission_links').get() as { count: number }).count).toBe(1);
      expect((sqlite.prepare('SELECT COUNT(*) count FROM canonical_processing_issues').get() as { count: number }).count).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('records a sanitized repeatable issue and preserves legacy success when shadow projection fails', async () => {
    const { sqlite, db } = harness();
    try {
      enableShadow(sqlite);
      await ensureLiveAdmissionContinuity(db, input);
      const failed = await ensureLiveAdmissionContinuity(db, { ...input, legacyPatientId: 999 });
      const repeated = await ensureLiveAdmissionContinuity(db, { ...input, legacyPatientId: 999 });

      expect(failed).toEqual({ status: 'failed', errorCode: 'CANONICAL_ADMISSION_CONTINUITY_FAILED' });
      expect(repeated).toEqual(failed);
      const issue = sqlite.prepare(`
        SELECT issue_type,issue_code,entity_type,entity_public_id,source_type,
               source_public_id,severity,status,occurrence_count,summary,details_json
        FROM canonical_processing_issues
      `).get() as Record<string, unknown>;
      expect(issue).toMatchObject({
        issue_type: 'admission_continuity',
        issue_code: 'CANONICAL_ADMISSION_CONTINUITY_FAILED',
        entity_type: 'canonical_encounter',
        entity_public_id: '701',
        source_type: 'runtime_shadow_write',
        source_public_id: '701',
        severity: 'error',
        status: 'open',
        occurrence_count: 2,
        summary: 'Canonical admission continuity projection failed after legacy admission committed.',
      });
      expect(String(issue.details_json)).not.toContain(input.admissionNo);
      expect(String(issue.details_json)).not.toContain('999');
      expect(String(issue.details_json)).not.toContain('patient mismatch');
      expect(JSON.parse(String(issue.details_json))).toMatchObject({
        schemaVersion: 1,
        legacyAuthorityCommitted: true,
      });
    } finally {
      sqlite.close();
    }
  });
});
