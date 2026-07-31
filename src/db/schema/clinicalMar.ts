/**
 * Drizzle schema definitions for clinical MAR tables (migration 0050).
 * These are manually defined since the auto-generated schema.ts won't
 * include them until `npx wrangler types` is run post-migration.
 */
import { sqliteTable, integer, text, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Clinical Medication Orders (CPOE) ─────────────────────────────────────
export const clnMedicationOrders = sqliteTable('cln_medication_orders', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  patientId: integer('patient_id').notNull(),
  visitId: integer('visit_id').notNull(),

  formularyItemId: integer('formulary_item_id'),
  medicationName: text('medication_name').notNull(),
  genericName: text('generic_name'),
  strength: text(),
  dosageForm: text('dosage_form'),

  dose: text().notNull(),
  route: text().notNull().default('Oral'),
  frequency: text().notNull(),
  duration: text(),
  instructions: text(),
  priority: text().notNull().default('routine'),

  startDatetime: text('start_datetime').default(sql`(datetime('now', '+6 hours'))`),
  endDatetime: text('end_datetime'),

  status: text().notNull().default('active'),
  statusReason: text('status_reason'),
  idempotencyKey: text('idempotency_key'),

  orderedBy: integer('ordered_by').notNull(),
  verifiedBy: integer('verified_by'),
  verifiedAt: text('verified_at'),
  isActive: integer('is_active').default(1),
  createdBy: integer('created_by'),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at'),
  updatedBy: integer('updated_by'),
}, (table) => [
  index('idx_cln_med_orders_tenant').on(table.tenantId),
  index('idx_cln_med_orders_patient').on(table.tenantId, table.patientId),
  index('idx_cln_med_orders_visit').on(table.tenantId, table.visitId),
  index('idx_cln_med_orders_status').on(table.tenantId, table.status),
  index('idx_cln_med_orders_formulary').on(table.tenantId, table.formularyItemId),
  uniqueIndex('idx_cln_med_orders_tenant_idempotency').on(table.tenantId, table.idempotencyKey),
]);

// ─── Medication Reconciliation ──────────────────────────────────────────────
export const clnMedicationReconciliation = sqliteTable('cln_medication_reconciliation', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  patientId: integer('patient_id').notNull(),
  visitId: integer('visit_id').notNull(),

  reconciliationType: text('reconciliation_type').notNull(),
  status: text().notNull().default('in_progress'),

  performedBy: integer('performed_by').notNull(),
  completedAt: text('completed_at'),
  notes: text(),

  isActive: integer('is_active').default(1),
  createdBy: integer('created_by'),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
  updatedAt: text('updated_at'),
  updatedBy: integer('updated_by'),
}, (table) => [
  index('idx_cln_recon_tenant').on(table.tenantId),
  index('idx_cln_recon_patient').on(table.tenantId, table.patientId),
  index('idx_cln_recon_visit').on(table.tenantId, table.visitId),
]);

// ─── Medication Reconciliation Items ────────────────────────────────────────
export const clnMedicationReconciliationItems = sqliteTable('cln_medication_reconciliation_items', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  reconciliationId: integer('reconciliation_id').notNull(),

  medicationName: text('medication_name').notNull(),
  genericName: text('generic_name'),
  dose: text(),
  route: text(),
  frequency: text(),
  source: text().default('home'),
  action: text().notNull().default('continue'),
  actionReason: text('action_reason'),

  newDose: text('new_dose'),
  newRoute: text('new_route'),
  newFrequency: text('new_frequency'),

  isActive: integer('is_active').default(1),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
  updatedBy: integer('updated_by'),
}, (table) => [
  index('idx_cln_recon_items_recon').on(table.reconciliationId),
]);

// ─── Prescription Versions (medico-legal audit trail) ───────────────────────
export const prescriptionVersions = sqliteTable('prescription_versions', {
  id: integer().primaryKey({ autoIncrement: true }),
  prescriptionId: integer('prescription_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  snapshot: text().notNull(),       // JSON of full prescription at time of save
  editedBy: text('edited_by').notNull(),
  editReason: text('edit_reason'),
  tenantId: text('tenant_id').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_prescription_versions_rx').on(table.prescriptionId),
  index('idx_prescription_versions_tenant_rx').on(table.tenantId, table.prescriptionId),
  uniqueIndex('idx_prescription_versions_rx_version').on(table.prescriptionId, table.versionNumber),
]);

// ─── Prescription Overrides (allergy/interaction override audit) ─────────────
export const prescriptionOverrides = sqliteTable('prescription_overrides', {
  id: integer().primaryKey({ autoIncrement: true }),
  prescriptionId: integer('prescription_id').notNull(),
  patientId: integer('patient_id').notNull(),
  doctorId: integer('doctor_id').notNull(),
  overrideType: text('override_type').notNull(), // allergy, interaction, duplicate
  allergen: text('allergen').notNull(),
  severity: text('severity'),
  reason: text('reason').notNull(),
  tenantId: text('tenant_id').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_prescription_overrides_rx').on(table.prescriptionId),
  index('idx_prescription_overrides_patient').on(table.patientId),
  index('idx_prescription_overrides_tenant').on(table.tenantId),
]);
