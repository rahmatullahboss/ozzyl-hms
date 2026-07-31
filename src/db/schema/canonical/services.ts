import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const canonicalServiceCatalogItems = sqliteTable(
  'canonical_service_catalog_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    servicePublicId: text('service_public_id').notNull(),
    itemKind: text('item_kind').notNull(),
    canonicalCode: text('canonical_code'),
    displayName: text('display_name').notNull(),
    unitCode: text('unit_code').notNull(),
    status: text('status').notNull().default('active'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_service_catalog_public_id').on(table.tenantId, table.servicePublicId),
    uniqueIndex('uq_canonical_service_catalog_code').on(table.tenantId, table.canonicalCode),
    index('idx_canonical_service_catalog_kind_status').on(
      table.tenantId,
      table.itemKind,
      table.status,
      table.displayName,
    ),
    index('idx_canonical_service_catalog_name').on(table.tenantId, table.displayName, table.servicePublicId),
    check(
      'canonical_service_catalog_kind_check',
      sql`item_kind IN ('laboratory','radiology','consultation','bed','procedure','product','other')`,
    ),
    check('canonical_service_catalog_status_check', sql`status IN ('active','inactive','retired')`),
    check('canonical_service_catalog_name_check', sql`length(trim(display_name)) > 0`),
    check('canonical_service_catalog_unit_check', sql`length(trim(unit_code)) > 0`),
    check('canonical_service_catalog_evidence_check', sql`length(source_evidence_sha256) = 64`),
  ],
);

export const canonicalServicePrices = sqliteTable(
  'canonical_service_prices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tenantId: text('tenant_id').notNull(),
    pricePublicId: text('price_public_id').notNull(),
    servicePublicId: text('service_public_id').notNull(),
    priceContextType: text('price_context_type').notNull(),
    priceContextKey: text('price_context_key').notNull().default(''),
    amountMinor: integer('amount_minor').notNull(),
    currencyCode: text('currency_code').notNull(),
    validFromUtc: text('valid_from_utc').notNull(),
    validToUtc: text('valid_to_utc'),
    status: text('status').notNull().default('active'),
    sourceEvidenceSha256: text('source_evidence_sha256').notNull(),
    createdAtUtc: text('created_at_utc').notNull().default(utcNow),
    updatedAtUtc: text('updated_at_utc').notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex('uq_canonical_service_prices_public_id').on(table.tenantId, table.pricePublicId),
    index('idx_canonical_service_prices_effective').on(
      table.tenantId,
      table.servicePublicId,
      table.priceContextType,
      table.priceContextKey,
      table.status,
      table.validFromUtc,
      table.validToUtc,
    ),
    index('idx_canonical_service_prices_currency').on(
      table.tenantId,
      table.currencyCode,
      table.status,
      table.validFromUtc,
    ),
    foreignKey({
      name: 'fk_canonical_service_prices_catalog',
      columns: [table.tenantId, table.servicePublicId],
      foreignColumns: [canonicalServiceCatalogItems.tenantId, canonicalServiceCatalogItems.servicePublicId],
    }).onDelete('restrict'),
    check(
      'canonical_service_prices_context_check',
      sql`price_context_type IN ('base','price_category','appointment_type','bed_rate','sale')`,
    ),
    check('canonical_service_prices_amount_check', sql`amount_minor >= 0`),
    check(
      'canonical_service_prices_currency_check',
      sql`length(currency_code) = 3 AND currency_code = upper(currency_code)`,
    ),
    check('canonical_service_prices_from_check', sql`substr(valid_from_utc, -1) = 'Z'`),
    check(
      'canonical_service_prices_to_check',
      sql`valid_to_utc IS NULL OR substr(valid_to_utc, -1) = 'Z'`,
    ),
    check(
      'canonical_service_prices_interval_check',
      sql`valid_to_utc IS NULL OR valid_to_utc > valid_from_utc`,
    ),
    check('canonical_service_prices_status_check', sql`status IN ('active','inactive','retired')`),
    check('canonical_service_prices_evidence_check', sql`length(source_evidence_sha256) = 64`),
  ],
);
