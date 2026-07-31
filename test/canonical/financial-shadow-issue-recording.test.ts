import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { executeStrictFinancialMutation } from '../../src/lib/canonical/strict-financial-mutation';

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SqlValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run(): Promise<unknown> {
    return this.sqlite.prepare(this.sql).run(...this.params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { db: CanonicalBatchDatabase; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_financial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      boundary TEXT NOT NULL
    );

    INSERT INTO canonical_feature_flags (
      tenant_id, flag_key, domain, mode, is_enabled, version, config_json, effective_at_utc
    ) VALUES (
      '102', 'canonical_financial_dual_write_v1', 'financial', 'shadow', 1, 1,
      '{"tenantScope":["102"],"writePolicy":"shadow"}', '2026-07-20T00:00:00.000Z'
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results: unknown[] = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };

  return { db, sqlite };
}

describe('canonical financial shadow issue recording', () => {
  it('upserts a PHI-safe issue while repeated canonical failures never roll back legacy writes', async () => {
    const { db, sqlite } = harness();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const canonicalFailure = Object.assign(
      new Error('patient 01712345678 canonical unavailable'),
      { code: 'D1_CANONICAL_WRITE_FAILED' },
    );

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await executeStrictFinancialMutation({
          db,
          tenantId: '102',
          boundary: 'billing.payment.collect',
          legacyStatements: [
            db.prepare('INSERT INTO legacy_financial (tenant_id, boundary) VALUES (?, ?)')
              .bind('102', 'billing.payment.collect'),
          ],
          canonical: async () => {
            throw canonicalFailure;
          },
        });

        expect(result).toMatchObject({
          mode: 'shadow',
          canonicalSucceeded: false,
          canonicalErrorCode: 'CANONICAL_SHADOW_WRITE_FAILED',
        });
      }

      const legacy = sqlite.prepare('SELECT COUNT(*) AS count FROM legacy_financial').get() as { count: number };
      expect(Number(legacy.count)).toBe(2);

      const issues = sqlite.prepare(`
        SELECT issue_type, issue_code, entity_public_id, source_public_id,
               occurrence_count, status, details_json
        FROM canonical_processing_issues
      `).all() as Array<{
        issue_type: string;
        issue_code: string;
        entity_public_id: string;
        source_public_id: string;
        occurrence_count: number;
        status: string;
        details_json: string;
      }>;

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        issue_type: 'financial_shadow_write',
        issue_code: 'CANONICAL_SHADOW_WRITE_FAILED',
        entity_public_id: 'billing.payment.collect',
        source_public_id: 'billing.payment.collect',
        occurrence_count: 2,
        status: 'open',
      });
      expect(issues[0].details_json).toContain('D1_CANONICAL_WRITE_FAILED');
      expect(issues[0].details_json).toContain('legacyAuthorityCommitted');
      expect(issues[0].details_json).not.toContain('01712345678');
      expect(issues[0].details_json).not.toContain('patient 01712345678 canonical unavailable');
    } finally {
      errorSpy.mockRestore();
      sqlite.close();
    }
  });
});
