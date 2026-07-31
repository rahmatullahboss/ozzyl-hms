import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const shiftClosings = sqliteTable('shift_closings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  userId: integer('user_id').notNull(),
  counterId: integer('counter_id'),
  shiftDate: text('shift_date').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time').notNull(),
  expectedCash: real('expected_cash').notNull().default(0),
  expectedBkash: real('expected_bkash').default(0),
  expectedNagad: real('expected_nagad').default(0),
  expectedCard: real('expected_card').default(0),
  expectedBank: real('expected_bank').default(0),
  submittedCash: real('submitted_cash').notNull().default(0),
  submittedBkash: real('submitted_bkash').default(0),
  submittedNagad: real('submitted_nagad').default(0),
  submittedCard: real('submitted_card').default(0),
  submittedBank: real('submitted_bank').default(0),
  cashShortExcess: real('cash_short_excess').notNull().default(0),
  status: text('status').notNull().default('pending'),
  approvedBy: integer('approved_by'),
  approvedAt: text('approved_at'),
  notes: text('notes'),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_shift_closings_tenant_date').on(table.tenantId, table.shiftDate),
  index('idx_shift_closings_user').on(table.tenantId, table.userId),
]);
