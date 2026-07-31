import { calculateBillCategoryTotals } from '../billing-category-totals';
import type { CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

export type PatientChartRadiologyUrgency = 'normal' | 'urgent' | 'stat';

export interface PatientChartResolvedRadiologyItem {
  id: number;
  imagingTypeId: number | null;
  imagingTypeName: string | null;
  name: string;
  procedureCode: string | null;
  price: number;
  pricePaisa: number;
  billingServiceItemId: number | null;
}

export interface PatientChartRadiologyBillingDependencies {
  resolveImagingItemByName(name: string): Promise<PatientChartResolvedRadiologyItem | null>;
  nextAccessionNo(): Promise<string>;
  nextInvoiceNo(): Promise<string>;
}

export interface PatientChartRadiologyBillingPreparationInput {
  tenantId: string;
  userId: number;
  patientId: number;
  orderDate: string;
  requestedAtUtc: string;
  submittedImagingTypeName: string;
  submittedImagingItemName: string;
  urgency: PatientChartRadiologyUrgency;
  requisitionRemarks: string | null;
  dependencies: PatientChartRadiologyBillingDependencies;
}

export interface PatientChartRadiologyBillingContext {
  tenantId: string;
  userId: number;
  patientId: number;
  orderDate: string;
  requestedAtUtc: string;
  submittedImagingTypeName: string;
  submittedImagingItemName: string;
  urgency: PatientChartRadiologyUrgency;
  requisitionRemarks: string | null;
  accessionNo: string;
  invoiceNo: string;
  imagingItem: PatientChartResolvedRadiologyItem | null;
  imagingTypeName: string;
  imagingItemName: string;
  procedureCode: string | null;
  total: number;
  categoryTotals: {
    testBill: number;
    doctorVisitBill: number;
    admissionBill: number;
    operationBill: number;
    medicineBill: number;
  };
}

type StatementFactory = { prepare(sql: string): CanonicalPreparedStatement };
type LegacyDatabase = StatementFactory;
type MutationResult = { meta?: { last_row_id?: number | string | bigint | null } };

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

function committedId(result: unknown, label: string): number {
  const id = Number((result as MutationResult | undefined)?.meta?.last_row_id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} insert did not return a committed id`);
  return id;
}

function categoryTotals(total: number): PatientChartRadiologyBillingContext['categoryTotals'] {
  const totals = calculateBillCategoryTotals([{ category: 'radiology', amount: total }]);
  return {
    testBill: totals.testBill,
    doctorVisitBill: totals.doctorVisitBill,
    admissionBill: totals.admissionBill,
    operationBill: totals.operationBill,
    medicineBill: totals.medicineBill,
  };
}

function baseContext(
  input: PatientChartRadiologyBillingPreparationInput,
  imagingItem: PatientChartResolvedRadiologyItem | null,
  accessionNo: string,
  invoiceNo: string,
): PatientChartRadiologyBillingContext {
  const total = Math.max(0, Number(imagingItem?.price ?? 0));
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    userId: positive(input.userId, 'userId'),
    patientId: positive(input.patientId, 'patientId'),
    orderDate: exact(input.orderDate, 'orderDate'),
    requestedAtUtc: exact(input.requestedAtUtc, 'requestedAtUtc'),
    submittedImagingTypeName: exact(input.submittedImagingTypeName, 'submittedImagingTypeName'),
    submittedImagingItemName: exact(input.submittedImagingItemName, 'submittedImagingItemName'),
    urgency: input.urgency,
    requisitionRemarks: input.requisitionRemarks,
    accessionNo: exact(accessionNo, 'accessionNo'),
    invoiceNo: exact(invoiceNo, 'invoiceNo'),
    imagingItem,
    imagingTypeName: imagingItem?.imagingTypeName ?? input.submittedImagingTypeName,
    imagingItemName: imagingItem?.name ?? input.submittedImagingItemName,
    procedureCode: imagingItem?.procedureCode ?? null,
    total,
    categoryTotals: categoryTotals(total),
  };
}

export async function executePatientChartRadiologyOriginalLegacy(
  db: LegacyDatabase,
  input: PatientChartRadiologyBillingPreparationInput,
): Promise<{ results: unknown[]; context: PatientChartRadiologyBillingContext }> {
  const imagingItem = await input.dependencies.resolveImagingItemByName(input.submittedImagingItemName);
  const accessionNo = await input.dependencies.nextAccessionNo();
  const imagingTypeName = imagingItem?.imagingTypeName ?? input.submittedImagingTypeName;
  const requisitionResult = await db.prepare(`
    INSERT INTO radiology_requisitions (
      tenant_id, patient_id, imaging_type_id, imaging_type_name, imaging_item_id, imaging_item_name,
      procedure_code, imaging_date, accession_no, requisition_remarks, urgency, order_status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(
    input.tenantId,
    input.patientId,
    imagingItem?.imagingTypeId ?? null,
    imagingTypeName,
    imagingItem?.id ?? null,
    imagingItem?.name ?? input.submittedImagingItemName,
    imagingItem?.procedureCode ?? null,
    input.orderDate,
    accessionNo,
    input.requisitionRemarks,
    input.urgency,
    input.userId,
  ).run();
  const requisitionId = committedId(requisitionResult, 'Radiology requisition');

  const invoiceNo = await input.dependencies.nextInvoiceNo();
  const context = baseContext(input, imagingItem, accessionNo, invoiceNo);
  const billResult = await db.prepare(`
    INSERT INTO bills (
      patient_id, invoice_no, test_bill, doctor_visit_bill, admission_bill, operation_bill,
      medicine_bill, discount, total, paid, due, status, tenant_id, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    context.patientId,
    context.invoiceNo,
    context.categoryTotals.testBill,
    context.categoryTotals.doctorVisitBill,
    context.categoryTotals.admissionBill,
    context.categoryTotals.operationBill,
    context.categoryTotals.medicineBill,
    context.total,
    context.total,
    context.total <= 0 ? 'paid' : 'open',
    context.tenantId,
    context.userId,
  ).run();
  const billId = committedId(billResult, 'Radiology bill');

  await db.prepare(`
    INSERT INTO invoice_items (
      bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id, created_at
    ) VALUES (?, 'test', ?, 1, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    billId,
    context.imagingItemName,
    context.total,
    context.total,
    requisitionId,
    context.tenantId,
  ).run();

  await db.prepare(`
    UPDATE radiology_requisitions
    SET bill_id = ?, billing_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'unpaid' END,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(billId, context.total, requisitionId, context.tenantId).run();

  return { results: [requisitionResult, billResult], context };
}

export async function preparePatientChartRadiologyStrictContext(
  input: PatientChartRadiologyBillingPreparationInput,
): Promise<PatientChartRadiologyBillingContext> {
  const imagingItem = await input.dependencies.resolveImagingItemByName(input.submittedImagingItemName);
  if (!imagingItem) throw new Error('Strict radiology billing requires an active imaging item');
  if (!imagingItem.billingServiceItemId) {
    throw new Error('Canonical billing service mapping is unavailable for the radiology imaging item');
  }
  if (!Number.isSafeInteger(imagingItem.pricePaisa) || imagingItem.pricePaisa <= 0 || imagingItem.price <= 0) {
    throw new Error('Strict radiology billing requires a positive price');
  }
  if (Math.round(imagingItem.price * 100) !== imagingItem.pricePaisa) {
    throw new Error('Radiology imaging price and minor-unit price do not match');
  }
  const accessionNo = await input.dependencies.nextAccessionNo();
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  return baseContext(input, imagingItem, accessionNo, invoiceNo);
}

function catalogGuardSql(): string {
  return `EXISTS (
    SELECT 1
    FROM radiology_imaging_items i
    JOIN billing_service_items si
      ON si.id=? AND CAST(si.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(si.is_active,1)=1 AND si.price=?
    LEFT JOIN billing_service_departments sd
      ON sd.id=si.service_department_id AND CAST(sd.tenant_id AS TEXT)=CAST(si.tenant_id AS TEXT)
    WHERE i.id=? AND CAST(i.tenant_id AS TEXT)=?
      AND COALESCE(i.is_active,1)=1 AND LOWER(i.name)=LOWER(?)
      AND (
        i.billing_service_item_id=si.id
        OR (COALESCE(sd.is_active,1)=1 AND sd.department_code='RAD' AND si.item_code=i.procedure_code)
      )
  )`;
}

export function preparePatientChartRadiologyStrictStatements(
  db: StatementFactory,
  context: PatientChartRadiologyBillingContext,
): readonly CanonicalPreparedStatement[] {
  const tenantId = exact(context.tenantId, 'tenantId');
  const userId = positive(context.userId, 'userId');
  const patientId = positive(context.patientId, 'patientId');
  const item = context.imagingItem;
  if (!item?.billingServiceItemId) throw new Error('Strict radiology context requires billing service mapping');
  if (context.total <= 0) throw new Error('Strict radiology context requires positive total');
  const operationKey = `patient-chart-radiology:${context.accessionNo}:${context.invoiceNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const pushCritical = (statement: CanonicalPreparedStatement, stepKey: string) => {
    statements.push(statement, prepareFinancialBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey,
      expectedChanges: 1,
    }));
  };

  pushCritical(db.prepare(`
    INSERT INTO radiology_requisitions (
      tenant_id,patient_id,imaging_type_id,imaging_type_name,imaging_item_id,imaging_item_name,
      procedure_code,imaging_date,accession_no,requisition_remarks,urgency,order_status,created_by
    )
    SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending',?
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND ${catalogGuardSql()}
      AND NOT EXISTS (
        SELECT 1 FROM radiology_requisitions r
        WHERE CAST(r.tenant_id AS TEXT)=? AND r.accession_no=?
      )
  `).bind(
    tenantId,
    patientId,
    item.imagingTypeId,
    context.imagingTypeName,
    item.id,
    context.imagingItemName,
    context.procedureCode,
    context.orderDate,
    context.accessionNo,
    context.requisitionRemarks,
    context.urgency,
    userId,
    patientId,
    tenantId,
    item.billingServiceItemId,
    context.total,
    item.id,
    tenantId,
    context.submittedImagingItemName,
    tenantId,
    context.accessionNo,
  ), 'requisition-insert');

  pushCritical(db.prepare(`
    INSERT INTO bills (
      patient_id,invoice_no,test_bill,doctor_visit_bill,admission_bill,operation_bill,medicine_bill,
      discount,total,paid,due,status,tenant_id,created_by,created_at,updated_at
    )
    SELECT ?,?,?,?,?,?,?,0,?,0,?,'open',?,?,datetime('now','+6 hours'),datetime('now','+6 hours')
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND EXISTS (
        SELECT 1 FROM radiology_requisitions r
        WHERE CAST(r.tenant_id AS TEXT)=? AND r.accession_no=?
      )
      AND NOT EXISTS (
        SELECT 1 FROM bills b WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
      )
  `).bind(
    patientId,
    context.invoiceNo,
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
    tenantId,
    context.accessionNo,
    tenantId,
    context.invoiceNo,
  ), 'bill-insert');

  pushCritical(db.prepare(`
    INSERT INTO invoice_items (
      bill_id,item_category,description,quantity,unit_price,line_total,reference_id,tenant_id,created_at
    )
    SELECT b.id,'test',?,1,?,?,r.id,?,datetime('now','+6 hours')
    FROM bills b
    JOIN radiology_requisitions r
      ON CAST(r.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND r.accession_no=?
    WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
  `).bind(
    context.imagingItemName,
    context.total,
    context.total,
    tenantId,
    context.accessionNo,
    tenantId,
    context.invoiceNo,
  ), 'invoice-item-insert');

  pushCritical(db.prepare(`
    UPDATE radiology_requisitions
    SET bill_id=(
          SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
          ORDER BY id DESC LIMIT 1
        ),
        billing_status='unpaid',
        updated_at=datetime('now','+6 hours')
    WHERE CAST(tenant_id AS TEXT)=? AND accession_no=? AND bill_id IS NULL
  `).bind(
    tenantId,
    context.invoiceNo,
    tenantId,
    context.accessionNo,
  ), 'requisition-bill-link');

  statements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
  return statements;
}
