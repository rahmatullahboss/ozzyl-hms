import type { CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

export interface LabBillingCategoryTotals {
  testBill: number;
  admissionBill: number;
  doctorVisitBill: number;
  operationBill: number;
  medicineBill: number;
}

export interface LabBillingLegacyItemInput {
  lineNumber: number;
  duplicateOrdinal: number;
  testId: number;
  name: string;
  price: number;
  discount: number;
  lineTotal: number;
  billingServiceItemId: number | null;
}

export interface PrepareLabBillingLegacyStatementsInput {
  tenantId: string;
  operationKey: string;
  userId: number;
  patientId: number;
  visitId: number | null;
  orderNo: string;
  orderDate: string;
  orderingClinicianDoctorId: number | null;
  invoiceNo: string;
  fiscalYearId: number | null;
  invoiceCode: string;
  orderTotal: number;
  categoryTotals: LabBillingCategoryTotals;
  hasItemSource: boolean;
  hasLabOrderUpdatedAt: boolean;
  items: readonly LabBillingLegacyItemInput[];
}

export interface PreparedLabBillingLegacyStatements {
  statements: CanonicalPreparedStatement[];
}

type StatementFactory = {
  prepare(sql: string): CanonicalPreparedStatement;
};

type LegacyLabBillingDatabase = StatementFactory & {
  batch(statements: readonly CanonicalPreparedStatement[]): Promise<unknown[]>;
};

type LegacyMutationResult = {
  meta?: { last_row_id?: number | string | bigint | null };
};

function committedId(result: unknown, label: string): number {
  const id = Number((result as LegacyMutationResult | undefined)?.meta?.last_row_id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} insert did not return a committed id`);
  return id;
}

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

function resolvedCatalogGuardSql(hasBillingServiceItem: boolean): string {
  if (!hasBillingServiceItem) {
    return `EXISTS (
      SELECT 1 FROM lab_test_catalog ltc
      WHERE ltc.id=? AND CAST(ltc.tenant_id AS TEXT)=?
        AND (ltc.is_active IS NULL OR ltc.is_active=1)
        AND ltc.price=?
    )`;
  }
  return `EXISTS (
    SELECT 1
    FROM lab_test_catalog ltc
    JOIN billing_service_items si
      ON si.id=? AND CAST(si.tenant_id AS TEXT)=CAST(ltc.tenant_id AS TEXT)
     AND (si.is_active IS NULL OR si.is_active=1) AND si.price=?
    LEFT JOIN billing_service_departments sd
      ON sd.id=si.service_department_id AND CAST(sd.tenant_id AS TEXT)=CAST(si.tenant_id AS TEXT)
    WHERE ltc.id=? AND CAST(ltc.tenant_id AS TEXT)=?
      AND (ltc.is_active IS NULL OR ltc.is_active=1)
      AND (
        ltc.billing_service_item_id=si.id
        OR ((sd.is_active IS NULL OR sd.is_active=1) AND sd.department_code='LAB' AND si.item_code=ltc.code)
      )
  )`;
}

function actualItemJoin(hasItemSource: boolean): string {
  return `
    JOIN lab_order_items li
      ON li.lab_order_id=lo.id AND li.lab_test_id=? AND CAST(li.tenant_id AS TEXT)=?
      ${hasItemSource ? "AND li.source='lab'" : ''}
  `;
}

export async function executeLabBillingOriginalLegacy(
  db: LegacyLabBillingDatabase,
  input: PrepareLabBillingLegacyStatementsInput,
): Promise<unknown[]> {
  const orderResult = await db.prepare(`
    INSERT INTO lab_orders (
      order_no, patient_id, visit_id, ordered_by,
      ordering_clinician_doctor_id, order_date, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.orderNo,
    input.patientId,
    input.visitId,
    input.userId,
    input.orderingClinicianDoctorId,
    input.orderDate,
    input.tenantId,
  ).run();
  const orderId = committedId(orderResult, 'Lab order');

  const billResult = await db.prepare(`
    INSERT INTO bills (
      patient_id, visit_id, invoice_no, test_bill, admission_bill, doctor_visit_bill,
      operation_bill, medicine_bill, discount, total, paid, due, status, tenant_id,
      fiscal_year_id, invoice_code, is_insurance_billing, co_payment_amount, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, 0, ?)
  `).bind(
    input.patientId,
    input.visitId,
    input.invoiceNo,
    input.categoryTotals.testBill,
    input.categoryTotals.admissionBill,
    input.categoryTotals.doctorVisitBill,
    input.categoryTotals.operationBill,
    input.categoryTotals.medicineBill,
    0,
    input.orderTotal,
    0,
    input.orderTotal,
    input.tenantId,
    input.fiscalYearId,
    input.invoiceCode,
    input.userId,
  ).run();
  const billId = committedId(billResult, 'Lab bill');

  const writeStatements: CanonicalPreparedStatement[] = [];
  for (const item of input.items) {
    if (input.hasItemSource) {
      writeStatements.push(db.prepare(`
        INSERT INTO lab_order_items (
          lab_order_id, lab_test_id, unit_price, discount, line_total, status, tenant_id, source
        )
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `).bind(orderId, item.testId, item.price, item.discount, item.lineTotal, input.tenantId, 'lab'));
    } else {
      writeStatements.push(db.prepare(`
        INSERT INTO lab_order_items (
          lab_order_id, lab_test_id, unit_price, discount, line_total, status, tenant_id
        )
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).bind(orderId, item.testId, item.price, item.discount, item.lineTotal, input.tenantId));
    }
  }

  writeStatements.push(db.prepare(`
    UPDATE lab_orders
    SET bill_id = ?,
        billing_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'unpaid' END
        ${input.hasLabOrderUpdatedAt ? ", updated_at = datetime('now', '+6 hours')" : ''}
    WHERE id = ? AND tenant_id = ?
  `).bind(billId, input.orderTotal, orderId, input.tenantId));

  for (const item of input.items) {
    if (input.hasItemSource) {
      writeStatements.push(db.prepare(`
        INSERT INTO invoice_items (
          bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id
        )
        SELECT ?, 'test', ?, 1, ?, ?,
               (SELECT id FROM lab_order_items
                WHERE lab_order_id = ? AND lab_test_id = ? AND tenant_id = ? AND source = ?
                ORDER BY id DESC LIMIT 1),
               ?
      `).bind(
        billId,
        item.name,
        item.price,
        item.lineTotal,
        orderId,
        item.testId,
        input.tenantId,
        'lab',
        input.tenantId,
      ));
    } else {
      writeStatements.push(db.prepare(`
        INSERT INTO invoice_items (
          bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id
        )
        SELECT ?, 'test', ?, 1, ?, ?,
               (SELECT id FROM lab_order_items
                WHERE lab_order_id = ? AND lab_test_id = ? AND tenant_id = ?
                ORDER BY id DESC LIMIT 1),
               ?
      `).bind(
        billId,
        item.name,
        item.price,
        item.lineTotal,
        orderId,
        item.testId,
        input.tenantId,
        input.tenantId,
      ));
    }
  }

  if (input.visitId) {
    for (const item of input.items) {
      if (input.hasItemSource) {
        writeStatements.push(db.prepare(`
          INSERT INTO visit_services (
            tenant_id, visit_id, patient_id, service_type, description, service_item_id,
            amount, discount_amount, quantity, total_amount, reference_type, reference_id,
            status, bill_id, created_by
          )
          SELECT ?, ?, ?, 'test', ?, ?, ?, ?, 1, ?, 'lab_order_item',
                 (SELECT id FROM lab_order_items
                  WHERE lab_order_id = ? AND lab_test_id = ? AND tenant_id = ? AND source = ?
                  ORDER BY id DESC LIMIT 1),
                 'billed', ?, ?
        `).bind(
          input.tenantId,
          input.visitId,
          input.patientId,
          item.name,
          item.billingServiceItemId,
          item.price,
          item.discount,
          item.lineTotal,
          orderId,
          item.testId,
          input.tenantId,
          'lab',
          billId,
          input.userId,
        ));
      } else {
        writeStatements.push(db.prepare(`
          INSERT INTO visit_services (
            tenant_id, visit_id, patient_id, service_type, description, service_item_id,
            amount, discount_amount, quantity, total_amount, reference_type, reference_id,
            status, bill_id, created_by
          )
          SELECT ?, ?, ?, 'test', ?, ?, ?, ?, 1, ?, 'lab_order_item',
                 (SELECT id FROM lab_order_items
                  WHERE lab_order_id = ? AND lab_test_id = ? AND tenant_id = ?
                  ORDER BY id DESC LIMIT 1),
                 'billed', ?, ?
        `).bind(
          input.tenantId,
          input.visitId,
          input.patientId,
          item.name,
          item.billingServiceItemId,
          item.price,
          item.discount,
          item.lineTotal,
          orderId,
          item.testId,
          input.tenantId,
          billId,
          input.userId,
        ));
      }
    }
  }

  await db.batch(writeStatements);
  return [orderResult, billResult];
}

export function prepareLabBillingStrictStatements(
  db: StatementFactory,
  input: PrepareLabBillingLegacyStatementsInput,
): PreparedLabBillingLegacyStatements {
  const tenantId = exact(input.tenantId, 'tenantId');
  const operationKey = exact(input.operationKey, 'operationKey');
  const userId = positive(input.userId, 'userId');
  const patientId = positive(input.patientId, 'patientId');
  const visitId = input.visitId == null ? null : positive(input.visitId, 'visitId');
  const orderNo = exact(input.orderNo, 'orderNo');
  const orderDate = exact(input.orderDate, 'orderDate');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const invoiceCode = exact(input.invoiceCode, 'invoiceCode');
  nonNegative(input.orderTotal, 'orderTotal');
  if (input.items.length === 0) throw new RangeError('Lab billing requires at least one item');

  const statements: CanonicalPreparedStatement[] = [];
  const pushCritical = (statement: CanonicalPreparedStatement, stepKey: string, expectedChanges = 1) => {
    statements.push(statement);
    statements.push(prepareFinancialBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey,
      expectedChanges,
    }));
  };

  pushCritical(db.prepare(`
    INSERT INTO lab_orders (
      order_no,patient_id,visit_id,ordered_by,ordering_clinician_doctor_id,order_date,tenant_id
    )
    SELECT ?,?,?,?,?,?,?
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM visits v WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=? AND v.patient_id=?
      ))
      AND NOT EXISTS (
        SELECT 1 FROM lab_orders lo WHERE CAST(lo.tenant_id AS TEXT)=? AND lo.order_no=?
      )
  `).bind(
    orderNo,
    patientId,
    visitId,
    userId,
    input.orderingClinicianDoctorId,
    orderDate,
    tenantId,
    patientId,
    tenantId,
    visitId,
    visitId,
    tenantId,
    patientId,
    tenantId,
    orderNo,
  ), 'lab-order-insert');

  pushCritical(db.prepare(`
    INSERT INTO bills (
      patient_id,visit_id,invoice_no,test_bill,admission_bill,doctor_visit_bill,
      operation_bill,medicine_bill,discount,total,paid,due,status,tenant_id,
      fiscal_year_id,invoice_code,is_insurance_billing,co_payment_amount,created_by
    )
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?,0,0,?
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM visits v WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=? AND v.patient_id=?
      ))
      AND NOT EXISTS (
        SELECT 1 FROM bills b WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
      )
  `).bind(
    patientId,
    visitId,
    invoiceNo,
    input.categoryTotals.testBill,
    input.categoryTotals.admissionBill,
    input.categoryTotals.doctorVisitBill,
    input.categoryTotals.operationBill,
    input.categoryTotals.medicineBill,
    0,
    input.orderTotal,
    0,
    input.orderTotal,
    tenantId,
    input.fiscalYearId,
    invoiceCode,
    userId,
    patientId,
    tenantId,
    visitId,
    visitId,
    tenantId,
    patientId,
    tenantId,
    invoiceNo,
  ), 'bill-insert');

  for (const item of input.items) {
    positive(item.lineNumber, 'item.lineNumber');
    nonNegative(item.duplicateOrdinal, 'item.duplicateOrdinal');
    positive(item.testId, 'item.testId');
    const billingServiceItemId = item.billingServiceItemId == null
      ? null
      : positive(item.billingServiceItemId, 'item.billingServiceItemId');
    exact(item.name, 'item.name');
    nonNegative(item.price, 'item.price');
    nonNegative(item.discount, 'item.discount');
    nonNegative(item.lineTotal, 'item.lineTotal');
    if (Math.max(0, item.price - item.discount) !== item.lineTotal) {
      throw new RangeError('Lab item line total does not equal price less discount');
    }

    const sourceColumn = input.hasItemSource ? ',source' : '';
    const sourceValue = input.hasItemSource ? ",'lab'" : '';
    const catalogGuardParams = billingServiceItemId == null
      ? [item.testId, tenantId, item.price]
      : [billingServiceItemId, item.price, item.testId, tenantId];
    pushCritical(db.prepare(`
      INSERT INTO lab_order_items (
        lab_order_id,lab_test_id,unit_price,discount,line_total,status,tenant_id${sourceColumn}
      )
      SELECT lo.id,?,?,?,?, 'pending',?${sourceValue}
      FROM lab_orders lo
      WHERE CAST(lo.tenant_id AS TEXT)=? AND lo.order_no=?
        AND ${resolvedCatalogGuardSql(billingServiceItemId != null)}
    `).bind(
      item.testId,
      item.price,
      item.discount,
      item.lineTotal,
      tenantId,
      tenantId,
      orderNo,
      ...catalogGuardParams,
    ), `lab-order-item-${item.lineNumber}`);

    pushCritical(db.prepare(`
      INSERT INTO invoice_items (
        bill_id,item_category,description,quantity,unit_price,line_total,reference_id,tenant_id
      )
      SELECT b.id,'test',?,1,?,?,li.id,?
      FROM bills b
      JOIN lab_orders lo
        ON CAST(lo.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND lo.order_no=?
      ${actualItemJoin(input.hasItemSource)}
      WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
      ORDER BY li.id
      LIMIT 1 OFFSET ?
    `).bind(
      item.name,
      item.price,
      item.lineTotal,
      tenantId,
      orderNo,
      item.testId,
      tenantId,
      tenantId,
      invoiceNo,
      item.duplicateOrdinal,
    ), `invoice-item-${item.lineNumber}`);

    if (visitId != null) {
      pushCritical(db.prepare(`
        INSERT INTO visit_services (
          tenant_id,visit_id,patient_id,service_type,description,service_item_id,
          amount,discount_amount,quantity,total_amount,reference_type,reference_id,
          status,bill_id,created_by
        )
        SELECT ?,?,?,'test',?,?,?, ?,1,?,'lab_order_item',li.id,'billed',b.id,?
        FROM bills b
        JOIN lab_orders lo
          ON CAST(lo.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND lo.order_no=?
        ${actualItemJoin(input.hasItemSource)}
        WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
          AND EXISTS (
            SELECT 1 FROM visits v WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=? AND v.patient_id=?
          )
        ORDER BY li.id
        LIMIT 1 OFFSET ?
      `).bind(
        tenantId,
        visitId,
        patientId,
        item.name,
        billingServiceItemId,
        item.price,
        item.discount,
        item.lineTotal,
        userId,
        orderNo,
        item.testId,
        tenantId,
        tenantId,
        invoiceNo,
        visitId,
        tenantId,
        patientId,
        item.duplicateOrdinal,
      ), `visit-service-${item.lineNumber}`);
    }
  }

  pushCritical(db.prepare(`
    UPDATE lab_orders
    SET bill_id=(
          SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
          ORDER BY id DESC LIMIT 1
        ),
        billing_status=CASE WHEN ?<=0 THEN 'paid' ELSE 'unpaid' END
        ${input.hasLabOrderUpdatedAt ? ",updated_at=datetime('now','+6 hours')" : ''}
    WHERE CAST(tenant_id AS TEXT)=? AND order_no=? AND bill_id IS NULL
  `).bind(
    tenantId,
    invoiceNo,
    input.orderTotal,
    tenantId,
    orderNo,
  ), 'lab-order-bill-link');

  statements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
  return { statements };
}
