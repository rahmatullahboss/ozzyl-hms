import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const doctorShifts = sqliteTable('doctor_shifts', {
  id: integer().primaryKey({ autoIncrement: true }),
  doctorId: integer('doctor_id').notNull(),
  dayOfWeek: integer('day_of_week').notNull(), // 0=Sunday, 6=Saturday
  shiftName: text('shift_name').notNull(), // Morning, Evening, Night
  startTime: text('start_time').notNull(), // HH:MM
  endTime: text('end_time').notNull(), // HH:MM
  isActive: integer('is_active').default(1),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
});

export const doctorAvailability = sqliteTable('doctor_availability', {
  id: integer().primaryKey({ autoIncrement: true }),
  doctorId: integer('doctor_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  isAvailable: integer('is_available').default(0),
  reason: text(),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
});

export const doctorVisits = sqliteTable('doctor_visits', {
  id: integer().primaryKey({ autoIncrement: true }),
  doctorId: integer('doctor_id').notNull(),
  patientId: integer('patient_id').notNull(),
  visitDate: text('visit_date').notNull(),
  visitType: text('visit_type').notNull(), // OPD, IP, EMERGENCY
  diagnosis: text(),
  notes: text(),
  tenantId: text('tenant_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(CURRENT_TIMESTAMP)`),
});