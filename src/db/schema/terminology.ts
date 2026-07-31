// Drizzle schema definitions for Central Terminology Service tables
// These are global (no tenant_id) — shared across all tenants

import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── ICD-11 MMS Catalog ────────────────────────────────────────────────────
// Note: catalog_icd11_mms is also defined in schema.ts (auto-generated).
// This file is the canonical Drizzle definition for new terminology tables.

export const catalogLoinc = sqliteTable('catalog_loinc', {
  id: integer().primaryKey({ autoIncrement: true }),
  loincNum: text('loinc_num').notNull().unique(),
  component: text().notNull(),
  longCommonName: text('long_common_name').notNull(),
  shortName: text('short_name'),
  class: text('class'),
  property: text(),
  timeAspect: text('time_aspect'),
  systemType: text('system_type'),
  scaleType: text('scale_type'),
  units: text(),
  status: text().notNull().default('ACTIVE'),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_catalog_loinc_class').on(table.class),
  index('idx_catalog_loinc_component').on(table.component),
  index('idx_catalog_loinc_name').on(table.longCommonName),
]);

export const catalogSnomed = sqliteTable('catalog_snomed', {
  id: integer().primaryKey({ autoIncrement: true }),
  sctid: text().notNull().unique(),
  term: text().notNull(),
  semanticTag: text('semantic_tag'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_catalog_snomed_tag').on(table.semanticTag),
  index('idx_catalog_snomed_term').on(table.term),
]);

export const catalogVersions = sqliteTable('catalog_versions', {
  id: integer().primaryKey({ autoIncrement: true }),
  codeSystem: text('code_system').notNull(),
  version: text().notNull(),
  loadedAt: text('loaded_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
  recordCount: integer('record_count'),
  notes: text(),
}, (table) => [
  uniqueIndex('idx_catalog_versions_unique').on(table.codeSystem, table.version),
]);
