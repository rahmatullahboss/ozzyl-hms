import { calculateBillCategoryTotals } from '../billing-category-totals';
import type { ResolvedRadiologyBillingRow } from '../diagnostic-catalog';
import type { CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

export type RadiologyOrderUrgency = 'normal' | 'urgent' | 'stat';

interface RadiologyStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): RadiologyStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface RadiologyOrderDatabase {
  prepare(sql: string): RadiologyStatement;
  batch(statements: readonly CanonicalPreparedStatement[]): Promise<readonly unknown[]>;
}

export interface RadiologyOrderBillingDependencies {
  resolveBillingRow(imagingItemId: number): Promise<ResolvedRadiologyBillingRow | null>;
  nextAccessionNo(): Promise<string>;
  nextInvoiceNo(): Promise<string>;
  assertAccountingPeriodOpen(imagingDate: string): Promise<void>;
}

export interface RadiologyOrderBillingInput {
  tenantId: string;
  userId: number;
  patientId: number;
  visitId: number | null;
  admissionId: number | null;
  imagingTypeId: number | null;
  submittedImagingTypeName: string | null;
  imagingItemId: number | null;
  submittedImagingItemName: string | null;
  submittedProcedureCode: string | null;
  prescriberId: number | null;
  prescriberName: string | null;
  imagingDate: string;
  requestedAtUtc: string;
  requisitionRemarks: string | null;
  urgency: RadiologyOrderUrgency;
  wardName: string | null;
  hasInsurance: boolean;
  dependencies: RadiologyOrderBillingDependencies;
}

export interface RadiologyOrderBillingContext extends Omit<RadiologyOrderBillingInput, 'dependencies'> {
  accessionNo: string;
  invoiceNo: string;
  imagingItem: ResolvedRadiologyBillingRow | null;
  imagingTypeName: string | null;
  imagingItemName: string | null;
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

export class RadiologyOrderBillingError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = 'RadiologyOrderBillingError';
  }
}

type MutationResult = {
  meta?: {
    changes?: number;
    rows_written?: number;
    last_row_id?: number | string | bigint | null;
  };
};

function fail(status: 400 | 404 | 409, message: string): never {
  throw new RadiologyOrderBillingError(status, message);
}

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

function committedId(result: unknown, label: string): number {
  const id = Number((result as MutationResult | undefined)?.meta?.last_row_id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} did not return a committed id`);
  return id;
}

function categoryTotals(total: number): RadiologyOrderBillingContext['categoryTotals'] {
  const totals = calculateBillCategoryTotals([{ category: 'radiology', amount: total }]);
  return {
    testBill: totals.testBill,
    doctorVisitBill: totals.doctorVisitBill,
    admissionBill: totals.admissionBill,
    operationBill: totals.operationBill,
    medicineBill: totals.medicineBill,
  };
}

function displayName(context: RadiologyOrderBillingContext): string {
  return context.imagingItemName ?? context.imagingTypeName ?? 'Radiology service';
}

async function requireRow(
  db: RadiologyOrderDatabase,
  sql: string,
  params: readonly unknown[],
  status: 404,
  message: string,
): Promise<void> {
  const row = await db.prepare(sql).bind(...params).first();
  if (!row) fail(status, message);
}

async function validateLegacyReferences(
  db: RadiologyOrderDatabase,
  input: RadiologyOrderBillingInput,
): Promise<void> {
  await requireRow(
    db,
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
    [input.patientId, input.tenantId],
    404,
    `Patient #${input.patientId} not found`,
  );
  if (input.visitId != null) {
    await requireRow(
      db,
      'SELECT id FROM visits WHERE id = ? AND tenant_id = ?',
      [input.visitId, input.tenantId],
      404,
      'Visit not found',
    );
  }
  if (input.admissionId != null) {
    await requireRow(
      db,
      'SELECT id FROM admissions WHERE id = ? AND tenant_id = ?',
      [input.admissionId, input.tenantId],
      404,
      'Admission not found',
    );
  }
  if (input.prescriberId != null) {
    await requireRow(
      db,
      'SELECT id FROM doctors WHERE id = ? AND tenant_id = ? AND is_active = 1',
      [input.prescriberId, input.tenantId],
      404,
      'Prescriber not found',
    );
  }
  if (input.imagingTypeId != null) {
    await requireRow(
      db,
      'SELECT id FROM radiology_imaging_types WHERE id = ? AND tenant_id = ?',
      [input.imagingTypeId, input.tenantId],
      404,
      'Imaging type not found',
    );
  }
  if (input.imagingItemId != null) {
    await requireRow(
      db,
      'SELECT id FROM radiology_imaging_items WHERE id = ? AND tenant_id = ?',
      [input.imagingItemId, input.tenantId],
      404,
      'Imaging item not found',
    );
  }
}

async function validateStrictReferences(
  db: RadiologyOrderDatabase,
  input: RadiologyOrderBillingInput,
): Promise<void> {
  await requireRow(
    db,
    'SELECT id FROM patients WHERE id = ? AND CAST(tenant_id AS TEXT) = ?',
    [input.patientId, input.tenantId],
    404,
    `Patient #${input.patientId} not found`,
  );
  if (input.visitId != null) {
    await requireRow(
      db,
      'SELECT id FROM visits WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND patient_id = ?',
      [input.visitId, input.tenantId, input.patientId],
      404,
      'Visit not found for patient',
    );
  }
  if (input.admissionId != null) {
    await requireRow(
      db,
      'SELECT id FROM admissions WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND patient_id = ?',
      [input.admissionId, input.tenantId, input.patientId],
      404,
      'Admission not found for patient',
    );
  }
  if (input.prescriberId != null) {
    await requireRow(
      db,
      'SELECT id FROM doctors WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND is_active = 1',
      [input.prescriberId, input.tenantId],
      404,
      'Prescriber not found',
    );
  }
  if (input.imagingTypeId != null) {
    await requireRow(
      db,
      'SELECT id FROM radiology_imaging_types WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND COALESCE(is_active,1) = 1',
      [input.imagingTypeId, input.tenantId],
      404,
      'Imaging type not found',
    );
  }
  if (input.imagingItemId == null) {
    throw new Error('Strict radiology billing requires an imaging item');
  }
  await requireRow(
    db,
    'SELECT id FROM radiology_imaging_items WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND COALESCE(is_active,1) = 1',
    [input.imagingItemId, input.tenantId],
    404,
    'Imaging item not found',
  );
}

async function enrichContext(
  db: RadiologyOrderDatabase,
  input: RadiologyOrderBillingInput,
  strict: boolean,
): Promise<{
  item: ResolvedRadiologyBillingRow | null;
  imagingTypeName: string | null;
  imagingItemName: string | null;
  procedureCode: string | null;
}> {
  let imagingTypeName = input.submittedImagingTypeName;
  let imagingItemName = input.submittedImagingItemName;
  let procedureCode = input.submittedProcedureCode;

  if (input.imagingTypeId != null && !imagingTypeName) {
    const typeNameSql = strict
      ? `SELECT name FROM radiology_imaging_types
         WHERE id = ? AND CAST(tenant_id AS TEXT) = ? AND COALESCE(is_active,1) = 1`
      : 'SELECT name FROM radiology_imaging_types WHERE id = ? AND tenant_id = ?';
    const row = await db.prepare(typeNameSql)
      .bind(input.imagingTypeId, input.tenantId)
      .first<{ name: string }>();
    imagingTypeName = row?.name ?? null;
  }

  const item = input.imagingItemId == null
    ? null
    : await input.dependencies.resolveBillingRow(input.imagingItemId);
  if (item) {
    imagingItemName = imagingItemName ?? item.name;
    procedureCode = procedureCode ?? item.procedureCode;
    imagingTypeName = imagingTypeName ?? item.imagingTypeName;
  }
  return { item, imagingTypeName, imagingItemName, procedureCode };
}

function buildContext(
  input: RadiologyOrderBillingInput,
  enriched: Awaited<ReturnType<typeof enrichContext>>,
  accessionNo: string,
  invoiceNo: string,
): RadiologyOrderBillingContext {
  const total = Math.max(0, Number(enriched.item?.price ?? 0));
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    userId: positive(input.userId, 'userId'),
    patientId: positive(input.patientId, 'patientId'),
    visitId: input.visitId,
    admissionId: input.admissionId,
    imagingTypeId: input.imagingTypeId,
    submittedImagingTypeName: input.submittedImagingTypeName,
    imagingItemId: input.imagingItemId,
    submittedImagingItemName: input.submittedImagingItemName,
    submittedProcedureCode: input.submittedProcedureCode,
    prescriberId: input.prescriberId,
    prescriberName: input.prescriberName,
    imagingDate: exact(input.imagingDate, 'imagingDate'),
    requestedAtUtc: exact(input.requestedAtUtc, 'requestedAtUtc'),
    requisitionRemarks: input.requisitionRemarks,
    urgency: input.urgency,
    wardName: input.wardName,
    hasInsurance: input.hasInsurance,
    accessionNo: exact(accessionNo, 'accessionNo'),
    invoiceNo: exact(invoiceNo, 'invoiceNo'),
    imagingItem: enriched.item,
    imagingTypeName: enriched.imagingTypeName,
    imagingItemName: enriched.imagingItemName,
    procedureCode: enriched.procedureCode,
    total,
    categoryTotals: categoryTotals(total),
  };
}

export async function executeRadiologyOrderOriginalLegacy(
  db: RadiologyOrderDatabase,
  input: RadiologyOrderBillingInput,
): Promise<{
  results: unknown[];
  context: RadiologyOrderBillingContext;
  requisitionId: number;
  billId: number;
}> {
  await validateLegacyReferences(db, input);
  const enriched = await enrichContext(db, input, false);
  await input.dependencies.assertAccountingPeriodOpen(input.imagingDate);
  const accessionNo = await input.dependencies.nextAccessionNo();
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  const context = buildContext(input, enriched, accessionNo, invoiceNo);

  const requisitionResult = await db.prepare(`
    INSERT INTO radiology_requisitions
    (tenant_id, patient_id, visit_id, admission_id, imaging_type_id, imaging_type_name,
     imaging_item_id, imaging_item_name, procedure_code, prescriber_id, prescriber_name,
     imaging_date, accession_no, requisition_remarks, urgency, ward_name, has_insurance, order_status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(
    context.tenantId,
    context.patientId,
    context.visitId,
    context.admissionId,
    context.imagingTypeId,
    context.imagingTypeName,
    context.imagingItemId,
    context.imagingItemName,
    context.procedureCode,
    context.prescriberId,
    context.prescriberName,
    context.imagingDate,
    context.accessionNo,
    context.requisitionRemarks,
    context.urgency,
    context.wardName,
    context.hasInsurance ? 1 : 0,
    context.userId,
  ).run();
  const requisitionId = committedId(requisitionResult, 'Radiology requisition');

  const billResult = await db.prepare(`
    INSERT INTO bills (patient_id, visit_id, invoice_no, test_bill, doctor_visit_bill, admission_bill,
      operation_bill, medicine_bill, discount, total, paid, due, status, tenant_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(
    context.patientId,
    context.visitId,
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

  const batchResults = await db.batch([
    db.prepare(`
      INSERT INTO invoice_items (bill_id, item_category, description, quantity, unit_price, line_total,
        reference_id, tenant_id, created_at)
      VALUES (?, 'test', ?, 1, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      billId,
      displayName(context),
      context.total,
      context.total,
      requisitionId,
      context.tenantId,
    ),
    db.prepare(`
      UPDATE radiology_requisitions
      SET bill_id = ?, billing_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'unpaid' END,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(billId, context.total, requisitionId, context.tenantId),
  ]);

  return {
    results: [requisitionResult, billResult, ...batchResults],
    context,
    requisitionId,
    billId,
  };
}

async function assertStrictCatalogAuthority(
  db: RadiologyOrderDatabase,
  input: RadiologyOrderBillingInput,
  item: ResolvedRadiologyBillingRow,
  imagingTypeName: string,
): Promise<void> {
  if (!item.billingServiceItemId || item.imagingTypeId == null) {
    throw new Error('Strict radiology catalog authority is incomplete');
  }
  const row = await db.prepare(`
    SELECT i.id
    FROM radiology_imaging_items i
    JOIN radiology_imaging_types t
      ON t.id=i.imaging_type_id AND CAST(t.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(t.is_active,1)=1
    JOIN billing_service_items si
      ON si.id=? AND CAST(si.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(si.is_active,1)=1 AND si.price=?
    JOIN billing_service_departments sd
      ON sd.id=si.service_department_id AND CAST(sd.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(sd.is_active,1)=1 AND sd.department_code='RAD'
    WHERE i.id=? AND CAST(i.tenant_id AS TEXT)=?
      AND COALESCE(i.is_active,1)=1
      AND i.imaging_type_id=?
      AND LOWER(t.name)=LOWER(?)
      AND LOWER(i.name)=LOWER(?)
      AND (i.billing_service_item_id=si.id OR si.item_code=i.procedure_code)
    LIMIT 1
  `).bind(
    item.billingServiceItemId,
    item.price,
    item.id,
    input.tenantId,
    item.imagingTypeId,
    imagingTypeName,
    item.name,
  ).first<{ id: number }>();
  if (!row) throw new Error('Strict radiology catalog authority changed before sequence allocation');
}

export async function prepareRadiologyOrderStrictContext(
  db: RadiologyOrderDatabase,
  input: RadiologyOrderBillingInput,
): Promise<RadiologyOrderBillingContext> {
  await validateStrictReferences(db, input);
  const enriched = await enrichContext(db, input, true);
  const item = enriched.item;
  if (!item || input.imagingItemId == null) {
    throw new Error('Strict radiology billing requires an active imaging item');
  }
  if (item.id !== input.imagingItemId) {
    throw new Error('Strict radiology imaging item identity does not match');
  }
  if (input.imagingTypeId != null && item.imagingTypeId !== input.imagingTypeId) {
    throw new Error('Strict radiology imaging type identity does not match');
  }
  if (!item.billingServiceItemId) {
    throw new Error('Canonical billing service mapping is unavailable for the radiology imaging item');
  }
  if (!Number.isSafeInteger(item.pricePaisa) || item.pricePaisa <= 0 || item.price <= 0) {
    throw new Error('Strict radiology billing requires a positive price');
  }
  if (Math.round(item.price * 100) !== item.pricePaisa) {
    throw new Error('Radiology imaging price and minor-unit price do not match');
  }
  const imagingTypeName = item.imagingTypeName ?? enriched.imagingTypeName;
  if (!imagingTypeName?.trim() || !item.name.trim()) {
    throw new Error('Strict radiology catalog names are unavailable');
  }
  await assertStrictCatalogAuthority(db, input, item, imagingTypeName);
  await input.dependencies.assertAccountingPeriodOpen(input.imagingDate);
  const accessionNo = await input.dependencies.nextAccessionNo();
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  return buildContext(input, {
    item,
    imagingTypeName,
    imagingItemName: item.name,
    procedureCode: item.procedureCode,
  }, accessionNo, invoiceNo);
}

function catalogGuardSql(): string {
  return `EXISTS (
    SELECT 1
    FROM radiology_imaging_items i
    JOIN radiology_imaging_types t
      ON t.id=i.imaging_type_id AND CAST(t.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(t.is_active,1)=1
    JOIN billing_service_items si
      ON si.id=? AND CAST(si.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(si.is_active,1)=1 AND si.price=?
    JOIN billing_service_departments sd
      ON sd.id=si.service_department_id AND CAST(sd.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
     AND COALESCE(sd.is_active,1)=1 AND sd.department_code='RAD'
    WHERE i.id=? AND CAST(i.tenant_id AS TEXT)=?
      AND COALESCE(i.is_active,1)=1
      AND i.imaging_type_id=?
      AND LOWER(t.name)=LOWER(?)
      AND LOWER(i.name)=LOWER(?)
      AND (i.billing_service_item_id=si.id OR si.item_code=i.procedure_code)
  )`;
}

export function prepareRadiologyOrderStrictStatements(
  db: Pick<RadiologyOrderDatabase, 'prepare'>,
  context: RadiologyOrderBillingContext,
): readonly CanonicalPreparedStatement[] {
  const tenantId = exact(context.tenantId, 'tenantId');
  const patientId = positive(context.patientId, 'patientId');
  const userId = positive(context.userId, 'userId');
  const item = context.imagingItem;
  if (!item?.billingServiceItemId || item.imagingTypeId == null) {
    throw new Error('Strict radiology context requires mapped item and type authority');
  }
  if (context.total <= 0) throw new Error('Strict radiology context requires positive total');
  const operationKey = `radiology-order:${context.accessionNo}:${context.invoiceNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const critical = (statement: CanonicalPreparedStatement, stepKey: string) => {
    statements.push(statement, prepareFinancialBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey,
      expectedChanges: 1,
    }));
  };

  critical(db.prepare(`
    INSERT INTO radiology_requisitions (
      tenant_id,patient_id,visit_id,admission_id,imaging_type_id,imaging_type_name,
      imaging_item_id,imaging_item_name,procedure_code,prescriber_id,prescriber_name,
      imaging_date,accession_no,requisition_remarks,urgency,ward_name,has_insurance,order_status,created_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
    FROM patients p
    WHERE p.id=? AND CAST(p.tenant_id AS TEXT)=?
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM visits v
        WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=? AND v.patient_id=p.id
      ))
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM admissions a
        WHERE a.id=? AND CAST(a.tenant_id AS TEXT)=? AND a.patient_id=p.id
      ))
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM doctors d
        WHERE d.id=? AND CAST(d.tenant_id AS TEXT)=? AND d.is_active=1
      ))
      AND ${catalogGuardSql()}
      AND NOT EXISTS (
        SELECT 1 FROM radiology_requisitions r
        WHERE CAST(r.tenant_id AS TEXT)=? AND r.accession_no=?
      )
  `).bind(
    tenantId,
    patientId,
    context.visitId,
    context.admissionId,
    item.imagingTypeId,
    context.imagingTypeName,
    item.id,
    context.imagingItemName,
    context.procedureCode,
    context.prescriberId,
    context.prescriberName,
    context.imagingDate,
    context.accessionNo,
    context.requisitionRemarks,
    context.urgency,
    context.wardName,
    context.hasInsurance ? 1 : 0,
    userId,
    patientId,
    tenantId,
    context.visitId,
    context.visitId,
    tenantId,
    context.admissionId,
    context.admissionId,
    tenantId,
    context.prescriberId,
    context.prescriberId,
    tenantId,
    item.billingServiceItemId,
    context.total,
    item.id,
    tenantId,
    item.imagingTypeId,
    context.imagingTypeName,
    context.imagingItemName,
    tenantId,
    context.accessionNo,
  ), 'requisition-insert');

  critical(db.prepare(`
    INSERT INTO bills (
      patient_id,visit_id,invoice_no,test_bill,doctor_visit_bill,admission_bill,operation_bill,
      medicine_bill,discount,total,paid,due,status,tenant_id,created_by,created_at,updated_at
    )
    SELECT ?,?,?,?,?,?,?,?,0,?,0,?,'open',?,?,datetime('now','+6 hours'),datetime('now','+6 hours')
    FROM radiology_requisitions r
    WHERE CAST(r.tenant_id AS TEXT)=? AND r.accession_no=?
      AND r.patient_id=? AND COALESCE(r.visit_id,-1)=COALESCE(?,-1)
      AND NOT EXISTS (
        SELECT 1 FROM bills b WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
      )
  `).bind(
    patientId,
    context.visitId,
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
    tenantId,
    context.accessionNo,
    patientId,
    context.visitId,
    tenantId,
    context.invoiceNo,
  ), 'bill-insert');

  critical(db.prepare(`
    INSERT INTO invoice_items (
      bill_id,item_category,description,quantity,unit_price,line_total,reference_id,tenant_id,created_at
    )
    SELECT b.id,'test',?,1,?,?,r.id,?,datetime('now','+6 hours')
    FROM bills b
    JOIN radiology_requisitions r
      ON CAST(r.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND r.accession_no=?
    WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
  `).bind(
    displayName(context),
    context.total,
    context.total,
    tenantId,
    context.accessionNo,
    tenantId,
    context.invoiceNo,
  ), 'invoice-item-insert');

  critical(db.prepare(`
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
