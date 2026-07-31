import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  ensureCanonicalBillingServiceMapping,
  prepareCanonicalBillingServiceMapping,
} from '../../src/lib/canonical/live-service-catalog-recovery';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0508_canonical_service_catalog.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      department_code TEXT,
      department_name TEXT,
      is_active INTEGER
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service_department_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL
    );
    INSERT INTO billing_service_departments VALUES (10,'100','LAB','Laboratory',1);
    INSERT INTO billing_service_items VALUES (20,'100',10,'CBC','Complete Blood Count',500,1);
  `);
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

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('canonical live service catalog recovery preparation', () => {
  it('prepares a new mapping without mutating until statements execute', async () => {
    const { sqlite, db } = harness();
    try {
      const prepared = await prepareCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      });
      expect(prepared.servicePublicId).toMatch(/^svc_/);
      expect(prepared.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(prepared.statements.length).toBeGreaterThan(0);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);

      await db.batch([...prepared.statements, ...prepared.reconciliationStatements]);
      expect(sqlite.prepare(`
        SELECT item_kind,canonical_code,display_name,status FROM canonical_service_catalog_items
      `).get()).toEqual({
        item_kind: 'laboratory', canonical_code: 'CBC', display_name: 'Complete Blood Count', status: 'active',
      });
      expect(sqlite.prepare(`
        SELECT entity_type,canonical_public_id,source_type,source_public_id,mapping_status
        FROM canonical_source_mappings
      `).get()).toEqual({
        entity_type: 'service_catalog_item',
        canonical_public_id: prepared.servicePublicId,
        source_type: 'legacy_billing_service_item',
        source_public_id: '20',
        mapping_status: 'mapped',
      });
    } finally { sqlite.close(); }
  });

  it('returns no creation statements for an exact existing mapping', async () => {
    const { sqlite, db } = harness();
    try {
      const servicePublicId = await ensureCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      });
      const prepared = await prepareCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      });
      expect(prepared.servicePublicId).toBe(servicePublicId);
      expect(prepared.statements).toEqual([]);
      expect(prepared.reconciliationStatements).toEqual([]);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('keeps the ensure wrapper operational for existing callers', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await ensureCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      });
      const second = await ensureCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      });
      expect(second).toBe(first);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('fails closed for conflicting mapping evidence or canonical code ownership', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
        ) VALUES ('100','svc_conflict','laboratory','CBC','Other CBC','service','active','${'f'.repeat(64)}');
      `);
      await expect(prepareCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      })).rejects.toThrow(/code conflicts/i);

      sqlite.exec(`DELETE FROM canonical_service_catalog_items`);
      sqlite.exec(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('100','service_catalog_item','svc_wrong','legacy_billing_service_item','20',
          'billing_service_items','mapped',1,'${'e'.repeat(64)}');
      `);
      await expect(prepareCanonicalBillingServiceMapping(db, {
        tenantId: '100', billingServiceItemId: 20,
      })).rejects.toThrow(/mapping conflicts/i);
    } finally { sqlite.close(); }
  });
});
