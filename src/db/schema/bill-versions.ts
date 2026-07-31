import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const billVersions = sqliteTable('bill_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  billId: integer('bill_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  editedBy: integer('edited_by').notNull(),
  editReason: text('edit_reason'),
  total: real('total').notNull(),
  discount: real('discount').notNull().default(0),
  discountReason: text('discount_reason'),
  discountByName: text('discount_by_name'),
  taxTotal: real('tax_total').default(0),
  due: real('due').default(0),
  testBill: real('test_bill').default(0),
  admissionBill: real('admission_bill').default(0),
  doctorVisitBill: real('doctor_visit_bill').default(0),
  operationBill: real('operation_bill').default(0),
  medicineBill: real('medicine_bill').default(0),
  itemsSnapshot: text('items_snapshot').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now', '+6 hours'))`),
}, (table) => [
  index('idx_bill_versions_bill').on(table.tenantId, table.billId),
  index('idx_bill_versions_bill_version').on(table.tenantId, table.billId, table.versionNumber),
]);
