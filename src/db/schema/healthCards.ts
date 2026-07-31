// Drizzle schema for health_cards table

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { patients } from './schema';

export const healthCards = sqliteTable('health_cards', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  patientId: integer('patient_id').notNull().references(() => patients.id),
  cardType: text('card_type').notNull().default('hospital'),
  version: integer().notNull().default(1),
  status: text().notNull().default('active'),
  tokenId: integer('token_id'),
  issuedBy: integer('issued_by').notNull(),
  issuedAt: text('issued_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
  revokedAt: text('revoked_at'),
  revokeReason: text('revoke_reason'),
  replacedById: integer('replaced_by_id'),
  metadata: text(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_health_cards_patient').on(table.tenantId, table.patientId),
  index('idx_health_cards_status').on(table.tenantId, table.status),
  index('idx_health_cards_token').on(table.tokenId),
]);
