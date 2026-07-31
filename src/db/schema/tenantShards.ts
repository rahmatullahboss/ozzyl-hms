import { sql } from 'drizzle-orm';
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tenantDbRoutes = sqliteTable('tenant_db_routes', {
  tenantId: text('tenant_id').primaryKey(),
  shardKey: text('shard_key').notNull().default('main'),
  dbBinding: text('db_binding').notNull().default('DB'),
  status: text('status').notNull().default('active'),
  migrationStartedAt: text('migration_started_at'),
  migratedAt: text('migrated_at'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_tenant_db_routes_binding').on(table.dbBinding, table.status),
  index('idx_tenant_db_routes_shard').on(table.shardKey, table.status),
]);
