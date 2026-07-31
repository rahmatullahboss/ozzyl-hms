import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

export interface PatientChartLabRequestItem {
  labTestId: number;
  instructions: string | null;
}

export interface PatientChartResolvedLabItem {
  lineNumber: number;
  duplicateOrdinal: number;
  labTestId: number;
  billingServiceItemId: number | null;
  name: string;
  category: string | null;
  price: number;
  instructions: string | null;
}

export interface PatientChartLabBillingContext {
  tenantId: string;
  userId: number;
  patientId: number;
  visitId: number | null;
  orderingClinicianDoctorId: number | null;
  orderNo: string;
  invoiceNo: string;
  orderDate: string;
  orderedAtUtc: string;
  notes: string | null;
  total: number;
  categoryTotals: {
    testBill: number;
    doctorVisitBill: number;
    admissionBill: number;
    operationBill: number;
    medicineBill: number;
  };
  items: readonly PatientChartResolvedLabItem[];
}

export interface PatientChartLabBillingDependencies {
  nextOrderNo(): Promise<string>;
  nextInvoiceNo(): Promise<string>;
  resolveLabTest(labTestId: number): Promise<{
    id: number;
    name: string;
    category: string | null;
    price: number;
    billingServiceItemId: number | null;
  } | null>;
}

export interface PatientChartLabBillingPreparationInput {
  tenantId: string;
  userId: number;
  patientId: number;
  visitId: number | null;
  orderingClinicianDoctorId: number | null;
  orderDate: string;
  orderedAtUtc: string;
  notes: string | null;
  requestItems: readonly PatientChartLabRequestItem[];
  dependencies: PatientChartLabBillingDependencies;
}

type MutationResult = {
  meta?: {
    last_row_id?: number | string | bigint | null;
  };
};

type StatementFactory = Pick<CanonicalBatchDatabase, 'prepare'>;

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function optionalPositive(value: number | null, label: string): number | null {
  return value == null ? null : positive(value, label);
}

function exactMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(minor / 100 - value) > 1e-9) {
    throw new RangeError(`${label} must use at most two decimal places and remain safe`);
  }
  return value;
}

function committedId(result: unknown, label: string): number {
  const id = Number((result as MutationResult | undefined)?.meta?.last_row_id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} insert did not return a committed id`);
  }
  return id;
}

function categoryTotals(total: number): PatientChartLabBillingContext['categoryTotals'] {
  return {
    testBill: total,
    doctorVisitBill: 0,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
  };
}

function validatePreparationInput(input: PatientChartLabBillingPreparationInput): void {
  exact(input.tenantId, 'tenantId');
  positive(input.userId, 'userId');
  positive(input.patientId, 'patientId');
  optionalPositive(input.visitId, 'visitId');
  optionalPositive(input.orderingClinicianDoctorId, 'orderingClinicianDoctorId');
  exact(input.orderDate, 'orderDate');
  exact(input.orderedAtUtc, 'orderedAtUtc');
  if (input.requestItems.length === 0) throw new RangeError('Patient-chart lab order requires at least one test');
  for (const item of input.requestItems) positive(item.labTestId, 'requestItem.labTestId');
}

function withDuplicateOrdinals(
  rows: readonly Omit<PatientChartResolvedLabItem, 'lineNumber' | 'duplicateOrdinal'>[],
): PatientChartResolvedLabItem[] {
  const duplicateCounts = new Map<number, number>();
  return rows.map((row, index) => {
    const duplicateOrdinal = duplicateCounts.get(row.labTestId) ?? 0;
    duplicateCounts.set(row.labTestId, duplicateOrdinal + 1);
    return {
      ...row,
      lineNumber: index + 1,
      duplicateOrdinal,
    };
  });
}

function buildContext(
  input: PatientChartLabBillingPreparationInput,
  orderNo: string,
  invoiceNo: string,
  items: readonly PatientChartResolvedLabItem[],
): PatientChartLabBillingContext {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    patientId: input.patientId,
    visitId: input.visitId,
    orderingClinicianDoctorId: input.orderingClinicianDoctorId,
    orderNo,
    invoiceNo,
    orderDate: input.orderDate,
    orderedAtUtc: input.orderedAtUtc,
    notes: input.notes,
    total,
    categoryTotals: categoryTotals(total),
    items,
  };
}

export async function executePatientChartLabOrderOriginalLegacy(
  db: CanonicalBatchDatabase,
  input: PatientChartLabBillingPreparationInput,
): Promise<{ results: unknown[]; context: PatientChartLabBillingContext }> {
  validatePreparationInput(input);
  const orderNo = await input.dependencies.nextOrderNo();
  const orderResult = await db.prepare(`
    INSERT INTO lab_orders (order_no, patient_id, visit_id, order_date, notes, ordered_by, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    orderNo,
    input.patientId,
    input.visitId,
    input.orderDate,
    input.notes,
    input.userId,
    input.tenantId,
  ).run();
  const labOrderId = committedId(orderResult, 'Patient-chart lab order');

  const resolvedRows: Array<Omit<PatientChartResolvedLabItem, 'lineNumber' | 'duplicateOrdinal'>> = [];
  const committedOrderItemIds: number[] = [];
  for (const requestItem of input.requestItems) {
    const catalogItem = await input.dependencies.resolveLabTest(requestItem.labTestId);
    if (!catalogItem) throw new Error(`Lab test ${requestItem.labTestId} not found`);
    const price = Number(catalogItem.price ?? 0);
    const itemResult = await db.prepare(`
      INSERT INTO lab_order_items (
        lab_order_id, lab_test_id, unit_price, discount, line_total, status,
        instructions, notes, tenant_id, source
      ) VALUES (?, ?, ?, 0, ?, 'pending', ?, ?, ?, 'lab')
    `).bind(
      labOrderId,
      requestItem.labTestId,
      price,
      price,
      requestItem.instructions,
      requestItem.instructions,
      input.tenantId,
    ).run();
    committedOrderItemIds.push(committedId(itemResult, 'Patient-chart lab order item'));
    resolvedRows.push({
      labTestId: requestItem.labTestId,
      billingServiceItemId: catalogItem.billingServiceItemId,
      name: catalogItem.name,
      category: catalogItem.category ?? null,
      price,
      instructions: requestItem.instructions,
    });
  }

  const items = withDuplicateOrdinals(resolvedRows);
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  const totals = categoryTotals(total);
  const billResult = await db.prepare(`
    INSERT INTO bills (
      patient_id, invoice_no, test_bill, doctor_visit_bill, admission_bill,
      operation_bill, medicine_bill, discount, total, paid, due, status,
      tenant_id, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?,
      datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    input.patientId,
    invoiceNo,
    totals.testBill,
    totals.doctorVisitBill,
    totals.admissionBill,
    totals.operationBill,
    totals.medicineBill,
    total,
    total,
    total <= 0 ? 'paid' : 'open',
    input.tenantId,
    input.userId,
  ).run();
  const billId = committedId(billResult, 'Patient-chart lab bill');

  for (const [index, item] of items.entries()) {
    await db.prepare(`
      INSERT INTO invoice_items (
        bill_id, item_category, description, quantity, unit_price,
        line_total, reference_id, tenant_id, created_at
      ) VALUES (?, 'test', ?, 1, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      billId,
      item.name,
      item.price,
      item.price,
      committedOrderItemIds[index],
      input.tenantId,
    ).run();
  }

  await db.prepare(`
    UPDATE lab_orders
    SET bill_id = ?,
        billing_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'unpaid' END,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(billId, total, labOrderId, input.tenantId).run();

  return {
    results: [orderResult, billResult],
    context: buildContext(input, orderNo, invoiceNo, items),
  };
}

export async function preparePatientChartLabOrderStrictContext(
  input: PatientChartLabBillingPreparationInput,
): Promise<PatientChartLabBillingContext> {
  validatePreparationInput(input);
  const resolvedRows: Array<Omit<PatientChartResolvedLabItem, 'lineNumber' | 'duplicateOrdinal'>> = [];
  let total = 0;
  for (const requestItem of input.requestItems) {
    const catalogItem = await input.dependencies.resolveLabTest(requestItem.labTestId);
    if (!catalogItem) throw new Error(`Lab test ${requestItem.labTestId} not found`);
    const price = exactMoney(Number(catalogItem.price), `Lab test ${requestItem.labTestId} price`);
    const billingServiceItemId = catalogItem.billingServiceItemId;
    if (!Number.isSafeInteger(billingServiceItemId) || Number(billingServiceItemId) <= 0) {
      throw new Error(`Canonical billing service mapping is unavailable for lab test ${requestItem.labTestId}`);
    }
    total += price;
    resolvedRows.push({
      labTestId: requestItem.labTestId,
      billingServiceItemId: Number(billingServiceItemId),
      name: exact(catalogItem.name, `Lab test ${requestItem.labTestId} name`),
      category: catalogItem.category ?? null,
      price,
      instructions: requestItem.instructions,
    });
  }
  if (!(total > 0)) throw new RangeError('Patient-chart strict lab billing requires a positive total');
  exactMoney(total, 'Patient-chart lab order total');

  const orderNo = exact(await input.dependencies.nextOrderNo(), 'orderNo');
  const invoiceNo = exact(await input.dependencies.nextInvoiceNo(), 'invoiceNo');
  return buildContext(input, orderNo, invoiceNo, withDuplicateOrdinals(resolvedRows));
}

function resolvedCatalogGuardSql(): string {
  return `EXISTS (
    SELECT 1
    FROM lab_test_catalog ltc
    JOIN billing_service_items si
      ON si.id=?
     AND CAST(si.tenant_id AS TEXT)=CAST(ltc.tenant_id AS TEXT)
     AND (si.is_active IS NULL OR si.is_active=1)
     AND si.price=?
    LEFT JOIN billing_service_departments sd
      ON sd.id=si.service_department_id
     AND CAST(sd.tenant_id AS TEXT)=CAST(si.tenant_id AS TEXT)
    WHERE ltc.id=?
      AND CAST(ltc.tenant_id AS TEXT)=?
      AND (ltc.is_active IS NULL OR ltc.is_active=1)
      AND (
        ltc.billing_service_item_id=si.id
        OR (
          (sd.is_active IS NULL OR sd.is_active=1)
          AND sd.department_code='LAB'
          AND si.item_code=ltc.code
        )
      )
  )`;
}

export function preparePatientChartLabOrderStrictStatements(
  db: StatementFactory,
  context: PatientChartLabBillingContext,
): readonly CanonicalPreparedStatement[] {
  const tenantId = exact(context.tenantId, 'tenantId');
  const userId = positive(context.userId, 'userId');
  const patientId = positive(context.patientId, 'patientId');
  const visitId = optionalPositive(context.visitId, 'visitId');
  const orderNo = exact(context.orderNo, 'orderNo');
  const invoiceNo = exact(context.invoiceNo, 'invoiceNo');
  exact(context.orderDate, 'orderDate');
  exact(context.orderedAtUtc, 'orderedAtUtc');
  exactMoney(context.total, 'total');
  if (!(context.total > 0)) throw new RangeError('Patient-chart strict lab billing requires a positive total');
  if (context.items.length === 0) throw new RangeError('Patient-chart strict lab billing requires items');

  const operationKey = `patient-chart-lab:${orderNo}:${invoiceNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const pushCritical = (
    statement: CanonicalPreparedStatement,
    stepKey: string,
    expectedChanges = 1,
  ) => {
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
      order_no,patient_id,visit_id,order_date,notes,ordered_by,tenant_id
    )
    SELECT ?,?,?,?,?,?,?
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM visits v
        WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=? AND v.patient_id=?
      ))
      AND NOT EXISTS (
        SELECT 1 FROM lab_orders lo
        WHERE CAST(lo.tenant_id AS TEXT)=? AND lo.order_no=?
      )
  `).bind(
    orderNo,
    patientId,
    visitId,
    context.orderDate,
    context.notes,
    userId,
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

  for (const item of context.items) {
    positive(item.lineNumber, 'item.lineNumber');
    if (!Number.isSafeInteger(item.duplicateOrdinal) || item.duplicateOrdinal < 0) {
      throw new RangeError('item.duplicateOrdinal must be a non-negative safe integer');
    }
    positive(item.labTestId, 'item.labTestId');
    const billingServiceItemId = positive(Number(item.billingServiceItemId), 'item.billingServiceItemId');
    exact(item.name, 'item.name');
    exactMoney(item.price, 'item.price');

    pushCritical(db.prepare(`
      INSERT INTO lab_order_items (
        lab_order_id,lab_test_id,unit_price,discount,line_total,status,
        instructions,notes,tenant_id,source
      )
      SELECT lo.id,?,?,0,?,'pending',?,?,?,'lab'
      FROM lab_orders lo
      WHERE CAST(lo.tenant_id AS TEXT)=? AND lo.order_no=?
        AND ${resolvedCatalogGuardSql()}
    `).bind(
      item.labTestId,
      item.price,
      item.price,
      item.instructions,
      item.instructions,
      tenantId,
      tenantId,
      orderNo,
      billingServiceItemId,
      item.price,
      item.labTestId,
      tenantId,
    ), `lab-order-item-${item.lineNumber}`);
  }

  pushCritical(db.prepare(`
    INSERT INTO bills (
      patient_id,invoice_no,test_bill,doctor_visit_bill,admission_bill,
      operation_bill,medicine_bill,discount,total,paid,due,status,
      tenant_id,created_by,created_at,updated_at
    )
    SELECT ?,?,?,?,?,?,?,0,?,0,?,'open',?,?,
      datetime('now','+6 hours'),datetime('now','+6 hours')
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM visits v
        WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=? AND v.patient_id=?
      ))
      AND NOT EXISTS (
        SELECT 1 FROM bills b
        WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
      )
  `).bind(
    patientId,
    invoiceNo,
    context.categoryTotals.testBill,
    context.categoryTotals.doctorVisitBill,
    context.categoryTotals.admissionBill,
    context.categoryTotals.operationBill,
    context.categoryTotals.medicineBill,
    context.total,
    context.total,
    tenantId,
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

  for (const item of context.items) {
    pushCritical(db.prepare(`
      INSERT INTO invoice_items (
        bill_id,item_category,description,quantity,unit_price,line_total,
        reference_id,tenant_id,created_at
      )
      SELECT b.id,'test',?,1,?,?,li.id,?,datetime('now','+6 hours')
      FROM bills b
      JOIN lab_orders lo
        ON CAST(lo.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND lo.order_no=?
      JOIN lab_order_items li
        ON li.lab_order_id=lo.id
       AND li.lab_test_id=?
       AND CAST(li.tenant_id AS TEXT)=?
       AND li.source='lab'
      WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
      ORDER BY li.id
      LIMIT 1 OFFSET ?
    `).bind(
      item.name,
      item.price,
      item.price,
      tenantId,
      orderNo,
      item.labTestId,
      tenantId,
      tenantId,
      invoiceNo,
      item.duplicateOrdinal,
    ), `invoice-item-${item.lineNumber}`);
  }

  pushCritical(db.prepare(`
    UPDATE lab_orders
    SET bill_id=(
          SELECT id FROM bills
          WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
          ORDER BY id DESC LIMIT 1
        ),
        billing_status='unpaid',
        updated_at=datetime('now','+6 hours')
    WHERE CAST(tenant_id AS TEXT)=? AND order_no=? AND bill_id IS NULL
  `).bind(
    tenantId,
    invoiceNo,
    tenantId,
    orderNo,
  ), 'lab-order-bill-link');

  statements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
  return statements;
}
