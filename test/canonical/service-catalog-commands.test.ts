import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  prepareRetireCanonicalServicePrice,
  prepareSetCanonicalServicePrice,
  prepareUpsertCanonicalServiceCatalogItem,
  retireCanonicalServicePrice,
  setCanonicalServicePrice,
  upsertCanonicalServiceCatalogItem,
} from '../../src/lib/canonical/contracts/manage-service-catalog';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

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

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0508_canonical_service_catalog.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_service_projection (
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      amount_minor INTEGER,
      PRIMARY KEY (tenant_id, source_key)
    );
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

function serviceInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    servicePublicId: 'svc-a',
    itemKind: 'consultation' as const,
    canonicalCode: 'CONSULT-A',
    displayName: 'General Consultation',
    unitCode: 'service',
    status: 'active' as const,
    sourceType: 'legacy_billing_service_item_key',
    sourcePublicId: 'service-key-a',
    sourceTable: 'billing_service_items',
    sourceEvidenceSha256: HASH_A,
    occurredAtUtc: '2026-07-29T10:00:00.000Z',
    businessDate: '2026-07-29',
    idempotencyKey: 'service-upsert-a',
    outboxEventPublicId: 'outbox-service-a',
    ...overrides,
  };
}

function priceInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    pricePublicId: 'price-a',
    servicePublicId: 'svc-a',
    priceContextType: 'base' as const,
    priceContextKey: '',
    amountMinor: 150000,
    currencyCode: 'BDT',
    validFromUtc: '2026-07-29T10:00:00.000Z',
    validToUtc: null,
    status: 'active' as const,
    sourceType: 'legacy_service_price_key',
    sourcePublicId: 'price-key-a',
    sourceTable: 'billing_item_price_category_maps',
    sourceEvidenceSha256: HASH_B,
    occurredAtUtc: '2026-07-29T10:00:00.000Z',
    businessDate: '2026-07-29',
    idempotencyKey: 'service-price-a',
    outboxEventPublicId: 'outbox-price-a',
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('canonical service catalog commands', () => {
  it('commits caller-owned compatibility, catalog authority, mapping and outbox atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await upsertCanonicalServiceCatalogItem(db, serviceInput(), {
        authoritativeStatements: [db.prepare(`
          INSERT INTO legacy_service_projection(tenant_id,source_key,amount_minor)
          VALUES ('tenant-a','service-key-a',150000)
        `)],
      });
      expect(result).toMatchObject({ status: 'applied', result: { servicePublicId: 'svc-a', status: 'active' } });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_service_projection')).toBe(1);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_catalog_items')).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='service_catalog_item'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.service-catalog.created'")).toBe(1);
    } finally { sqlite.close(); }
  });

  it('replays identical service evidence and rejects changed replay', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await upsertCanonicalServiceCatalogItem(db, serviceInput());
      const replay = await upsertCanonicalServiceCatalogItem(db, serviceInput());
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      await expect(upsertCanonicalServiceCatalogItem(db, serviceInput({
        displayName: 'Changed Consultation',
      }))).rejects.toThrow(/idempotency|fingerprint|conflict/i);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_catalog_items')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('updates the exact catalog identity with optimistic evidence and rolls back on compatibility failure', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, serviceInput());
      const prepared = await prepareUpsertCanonicalServiceCatalogItem(db, serviceInput({
        displayName: 'Updated Consultation',
        sourceEvidenceSha256: HASH_B,
        expectedSourceEvidenceSha256: HASH_A,
        idempotencyKey: 'service-upsert-a-2',
        outboxEventPublicId: 'outbox-service-a-2',
      }), {
        authoritativeStatements: [db.prepare(`
          INSERT INTO missing_service_projection(tenant_id,source_key,amount_minor)
          VALUES ('tenant-a','service-key-a',175000)
        `)],
      });
      await expect(db.batch([...prepared.statements])).rejects.toThrow();
      expect(sqlite.prepare(`
        SELECT display_name,source_evidence_sha256 FROM canonical_service_catalog_items
        WHERE tenant_id='tenant-a' AND service_public_id='svc-a'
      `).get()).toEqual({ display_name: 'General Consultation', source_evidence_sha256: HASH_A });
    } finally { sqlite.close(); }
  });

  it('sets an effective price and rejects overlapping active intervals', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, serviceInput());
      const result = await setCanonicalServicePrice(db, priceInput());
      expect(result).toMatchObject({ status: 'applied', result: { pricePublicId: 'price-a', status: 'active' } });
      await expect(setCanonicalServicePrice(db, priceInput({
        pricePublicId: 'price-overlap',
        sourcePublicId: 'price-key-overlap',
        sourceEvidenceSha256: HASH_C,
        idempotencyKey: 'service-price-overlap',
        outboxEventPublicId: 'outbox-price-overlap',
        validFromUtc: '2026-07-30T10:00:00.000Z',
      }))).rejects.toThrow(/overlap/i);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_prices')).toBe(1);
    } finally { sqlite.close(); }
  });

  it('replaces an exact price version and keeps immutable history', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, serviceInput());
      await setCanonicalServicePrice(db, priceInput());
      const next = await setCanonicalServicePrice(db, priceInput({
        pricePublicId: 'price-b',
        amountMinor: 175000,
        validFromUtc: '2026-08-01T00:00:00.000Z',
        sourcePublicId: 'price-key-b',
        sourceEvidenceSha256: HASH_C,
        idempotencyKey: 'service-price-b',
        outboxEventPublicId: 'outbox-price-b',
        replacePricePublicId: 'price-a',
        expectedReplacedEvidenceSha256: HASH_B,
      }));
      expect(next.status).toBe('applied');
      expect(sqlite.prepare(`
        SELECT price_public_id,status,valid_to_utc,amount_minor
        FROM canonical_service_prices WHERE tenant_id='tenant-a'
        ORDER BY price_public_id
      `).all()).toEqual([
        { price_public_id: 'price-a', status: 'retired', valid_to_utc: '2026-08-01T00:00:00.000Z', amount_minor: 150000 },
        { price_public_id: 'price-b', status: 'active', valid_to_utc: null, amount_minor: 175000 },
      ]);
    } finally { sqlite.close(); }
  });

  it('retires the exact price with replay safety and stale evidence rejection', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, serviceInput());
      await setCanonicalServicePrice(db, priceInput());
      const retireInput = {
        tenantId: 'tenant-a',
        servicePublicId: 'svc-a',
        pricePublicId: 'price-a',
        retiredAtUtc: '2026-08-02T00:00:00.000Z',
        reasonCode: 'legacy_price_removed',
        expectedSourceEvidenceSha256: HASH_B,
        sourceEvidenceSha256: HASH_C,
        occurredAtUtc: '2026-08-02T00:00:00.000Z',
        businessDate: '2026-08-02',
        idempotencyKey: 'service-price-retire-a',
        outboxEventPublicId: 'outbox-price-retire-a',
      };
      const first = await retireCanonicalServicePrice(db, retireInput);
      const replay = await retireCanonicalServicePrice(db, retireInput);
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      await expect(prepareRetireCanonicalServicePrice(db, {
        ...retireInput,
        pricePublicId: 'missing-price',
        idempotencyKey: 'service-price-retire-missing',
        outboxEventPublicId: 'outbox-price-retire-missing',
      })).rejects.toThrow(/does not exist/i);
    } finally { sqlite.close(); }
  });

  it('keeps service and price authority tenant isolated', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, serviceInput());
      await upsertCanonicalServiceCatalogItem(db, serviceInput({
        tenantId: 'tenant-b',
        idempotencyKey: 'service-upsert-b',
        outboxEventPublicId: 'outbox-service-b',
      }));
      await setCanonicalServicePrice(db, priceInput());
      await setCanonicalServicePrice(db, priceInput({
        tenantId: 'tenant-b',
        idempotencyKey: 'service-price-b-tenant',
        outboxEventPublicId: 'outbox-price-b-tenant',
      }));
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_catalog_items')).toBe(2);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_prices')).toBe(2);
    } finally { sqlite.close(); }
  });
});
