import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  retireCanonicalServicePrice,
  setCanonicalServicePrice,
  upsertCanonicalServiceCatalogItem,
} from '../../src/lib/canonical/contracts/manage-service-catalog';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

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
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0508_canonical_service_catalog.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_service_projection (
      tenant_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      amount_major REAL NOT NULL,
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

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

function catalogInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    servicePublicId: 'svc-consultation',
    itemKind: 'consultation' as const,
    canonicalCode: 'CONSULT',
    displayName: 'Consultation',
    unitCode: 'service',
    status: 'active' as const,
    sourceType: 'billing_service_item',
    sourcePublicId: 'billing-service:10',
    sourceTable: 'billing_service_items',
    sourceEvidenceSha256: 'a'.repeat(64),
    occurredAtUtc: '2026-07-29T10:00:00.000Z',
    businessDate: '2026-07-29',
    idempotencyKey: 'service-upsert-1',
    outboxEventPublicId: 'outbox-service-upsert-1',
    prices: [{
      pricePublicId: 'price-consultation-base-v1',
      priceContextType: 'base' as const,
      priceContextKey: '',
      amountMinor: 50_000,
      currencyCode: 'BDT',
      validFromUtc: '2026-07-29T10:00:00.000Z',
      sourceType: 'billing_service_base_price',
      sourcePublicId: 'billing-service:10:base:v1',
      sourceTable: 'billing_service_items',
      sourceEvidenceSha256: 'b'.repeat(64),
    }],
    ...overrides,
  };
}

function categoryPriceInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    servicePublicId: 'svc-consultation',
    pricePublicId: 'price-consultation-vip-v1',
    priceContextType: 'price_category' as const,
    priceContextKey: 'price-category:7',
    amountMinor: 75_000,
    currencyCode: 'BDT',
    validFromUtc: '2026-07-29T11:00:00.000Z',
    sourceType: 'billing_price_category_map',
    sourcePublicId: 'billing-service:10:price-category:7:v1',
    sourceTable: 'billing_item_price_category_maps',
    sourceEvidenceSha256: 'c'.repeat(64),
    occurredAtUtc: '2026-07-29T11:00:00.000Z',
    businessDate: '2026-07-29',
    idempotencyKey: 'service-price-set-1',
    outboxEventPublicId: 'outbox-service-price-set-1',
    ...overrides,
  };
}

describe('Canonical service catalog and pricing commands', () => {
  it('commits compatibility, catalog, price, mappings and outbox atomically with exact replay', async () => {
    const { sqlite, db } = harness();
    try {
      const input = catalogInput();
      const authoritativeStatement = db.prepare(`
        INSERT INTO legacy_service_projection (tenant_id,source_key,display_name,amount_major)
        VALUES (?,?,?,?)
      `).bind('tenant-a', 'billing-service:10', 'Consultation', 500);

      await expect(upsertCanonicalServiceCatalogItem(db, input, {
        authoritativeStatements: [authoritativeStatement],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          servicePublicId: 'svc-consultation',
          status: 'active',
          pricePublicIds: ['price-consultation-base-v1'],
        },
      });
      await expect(upsertCanonicalServiceCatalogItem(db, input, {
        authoritativeStatements: [authoritativeStatement],
      })).resolves.toEqual({
        status: 'replayed',
        result: {
          servicePublicId: 'svc-consultation',
          status: 'active',
          pricePublicIds: ['price-consultation-base-v1'],
        },
      });
      await expect(upsertCanonicalServiceCatalogItem(db, {
        ...input,
        displayName: 'Changed Consultation',
      })).rejects.toThrow(/idempotency/i);

      expect(scalar(sqlite, "SELECT COUNT(*) count FROM legacy_service_projection WHERE tenant_id='tenant-a'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_service_catalog_items WHERE service_public_id='svc-consultation'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_service_prices WHERE price_public_id='price-consultation-base-v1'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='service_catalog_item'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='service_price'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE aggregate_public_id='svc-consultation'")).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('replaces an effective price without overwriting history and rejects overlap or stale evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, catalogInput());
      await setCanonicalServicePrice(db, categoryPriceInput());
      await expect(setCanonicalServicePrice(db, categoryPriceInput({
        pricePublicId: 'price-consultation-vip-v2',
        amountMinor: 80_000,
        validFromUtc: '2026-07-29T12:00:00.000Z',
        replacePricePublicId: 'price-consultation-vip-v1',
        expectedReplacedEvidenceSha256: 'c'.repeat(64),
        sourcePublicId: 'billing-service:10:price-category:7:v2',
        sourceEvidenceSha256: 'd'.repeat(64),
        occurredAtUtc: '2026-07-29T12:00:00.000Z',
        idempotencyKey: 'service-price-set-2',
        outboxEventPublicId: 'outbox-service-price-set-2',
      }))).resolves.toEqual({
        status: 'applied',
        result: {
          servicePublicId: 'svc-consultation',
          pricePublicId: 'price-consultation-vip-v2',
          status: 'active',
        },
      });

      const prices = sqlite.prepare(`
        SELECT price_public_id,amount_minor,valid_from_utc,valid_to_utc,status
        FROM canonical_service_prices
        WHERE service_public_id='svc-consultation' AND price_context_type='price_category'
        ORDER BY valid_from_utc
      `).all() as Record<string, unknown>[];
      expect(prices).toEqual([
        expect.objectContaining({
          price_public_id: 'price-consultation-vip-v1',
          amount_minor: 75_000,
          valid_to_utc: '2026-07-29T12:00:00.000Z',
          status: 'retired',
        }),
        expect.objectContaining({
          price_public_id: 'price-consultation-vip-v2',
          amount_minor: 80_000,
          valid_to_utc: null,
          status: 'active',
        }),
      ]);

      await expect(setCanonicalServicePrice(db, categoryPriceInput({
        pricePublicId: 'price-overlap',
        validFromUtc: '2026-07-29T12:30:00.000Z',
        sourcePublicId: 'overlap',
        idempotencyKey: 'price-overlap',
        outboxEventPublicId: 'outbox-price-overlap',
      }))).rejects.toThrow(/overlap/i);
      await expect(setCanonicalServicePrice(db, categoryPriceInput({
        pricePublicId: 'price-stale',
        validFromUtc: '2026-07-29T13:00:00.000Z',
        replacePricePublicId: 'price-consultation-vip-v2',
        expectedReplacedEvidenceSha256: 'e'.repeat(64),
        sourcePublicId: 'stale',
        idempotencyKey: 'price-stale',
        outboxEventPublicId: 'outbox-price-stale',
      }))).rejects.toThrow(/evidence|stale/i);
    } finally {
      sqlite.close();
    }
  });

  it('retires a price with exact tenant and evidence scope', async () => {
    const { sqlite, db } = harness();
    try {
      await upsertCanonicalServiceCatalogItem(db, catalogInput());
      await setCanonicalServicePrice(db, categoryPriceInput());

      await expect(retireCanonicalServicePrice(db, {
        tenantId: 'tenant-b',
        servicePublicId: 'svc-consultation',
        pricePublicId: 'price-consultation-vip-v1',
        expectedSourceEvidenceSha256: 'c'.repeat(64),
        retiredAtUtc: '2026-07-29T12:00:00.000Z',
        reasonCode: 'tenant-test',
        sourceEvidenceSha256: 'f'.repeat(64),
        occurredAtUtc: '2026-07-29T12:00:00.000Z',
        businessDate: '2026-07-29',
        idempotencyKey: 'retire-wrong-tenant',
        outboxEventPublicId: 'outbox-retire-wrong-tenant',
      })).rejects.toThrow(/price|tenant/i);

      await expect(retireCanonicalServicePrice(db, {
        tenantId: 'tenant-a',
        servicePublicId: 'svc-consultation',
        pricePublicId: 'price-consultation-vip-v1',
        expectedSourceEvidenceSha256: 'c'.repeat(64),
        retiredAtUtc: '2026-07-29T12:00:00.000Z',
        reasonCode: 'category-price-removed',
        sourceEvidenceSha256: 'f'.repeat(64),
        occurredAtUtc: '2026-07-29T12:00:00.000Z',
        businessDate: '2026-07-29',
        idempotencyKey: 'retire-category-price',
        outboxEventPublicId: 'outbox-retire-category-price',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          servicePublicId: 'svc-consultation',
          pricePublicId: 'price-consultation-vip-v1',
          status: 'retired',
        },
      });

      const row = sqlite.prepare(`
        SELECT status,valid_to_utc,source_evidence_sha256
        FROM canonical_service_prices
        WHERE tenant_id='tenant-a' AND price_public_id='price-consultation-vip-v1'
      `).get() as Record<string, unknown>;
      expect(row).toMatchObject({
        status: 'retired',
        valid_to_utc: '2026-07-29T12:00:00.000Z',
        source_evidence_sha256: 'f'.repeat(64),
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back the legacy projection, canonical rows, mappings and outbox on any failed statement', async () => {
    const { sqlite, db } = harness();
    try {
      const legacy = db.prepare(`
        INSERT INTO legacy_service_projection (tenant_id,source_key,display_name,amount_major)
        VALUES (?,?,?,?)
      `).bind('tenant-a', 'billing-service:rollback', 'Rollback Service', 100);
      const failure = db.prepare(`
        INSERT INTO legacy_service_projection (tenant_id,source_key,display_name,amount_major)
        VALUES (?,?,?,?)
      `).bind('tenant-a', 'billing-service:rollback', 'Duplicate', 100);

      await expect(upsertCanonicalServiceCatalogItem(db, catalogInput({
        servicePublicId: 'svc-rollback',
        canonicalCode: 'ROLLBACK',
        sourcePublicId: 'billing-service:rollback',
        idempotencyKey: 'service-rollback',
        outboxEventPublicId: 'outbox-service-rollback',
        prices: [],
      }), {
        authoritativeStatements: [legacy, failure],
      })).rejects.toThrow();

      expect(scalar(sqlite, "SELECT COUNT(*) count FROM legacy_service_projection WHERE source_key='billing-service:rollback'")).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_service_catalog_items WHERE service_public_id='svc-rollback'")).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE canonical_public_id='svc-rollback'")).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE aggregate_public_id='svc-rollback'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
