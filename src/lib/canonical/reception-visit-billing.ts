import type { BillCategoryTotals } from '../billing-category-totals';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';
import { prepareCanonicalBillingServiceMapping } from './live-service-catalog-recovery';

export interface ReceptionVisitBillingStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): ReceptionVisitBillingStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface ReceptionVisitBillingDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): ReceptionVisitBillingStatement;
  batch(statements: CanonicalPreparedStatement[]): Promise<unknown[]>;
}

export interface ReceptionVisitBillingServiceInput {
  id: number;
  patientId: number;
  visitId: number;
  serviceType: string;
  description: string;
  serviceItemId: number | null;
  doctorId: number | null;
  amount: number;
  discountAmount: number;
  quantity: number;
  totalAmount: number;
  referenceType: string | null;
  referenceId: number | null;
}

export interface ReceptionVisitBillingDiscountAllocationInput {
  allocationType: string;
  reason: string;
  doctorId: number | null;
  amount: number;
  referenceName: string | null;
  note: string | null;
  metadataJson: string;
}

export interface ReceptionVisitBillingDependencies {
  assertAccountingPeriodOpen(): Promise<void>;
  nextInvoiceNo(): Promise<string>;
}

export interface ReceptionVisitBillingPreparationInput {
  tenantId: string;
  userId: number;
  visitId: number;
  patientId: number;
  visitDoctorId: number | null;
  businessDate: string;
  issuedAtUtc: string;
  subtotal: number;
  discount: number;
  discountByName: string | null;
  total: number;
  categoryTotals: BillCategoryTotals;
  discountAllocations: readonly ReceptionVisitBillingDiscountAllocationInput[];
  services: readonly ReceptionVisitBillingServiceInput[];
  dependencies: ReceptionVisitBillingDependencies;
}

export interface ReceptionVisitBillingContextService extends ReceptionVisitBillingServiceInput {
  labOrderId: number | null;
  serviceDepartmentId: number | null;
  catalogItemCode: string | null;
  catalogItemName: string | null;
  catalogPrice: number | null;
  catalogDepartmentCode: string | null;
  catalogDepartmentName: string | null;
}

export interface ReceptionVisitBillingContext extends Omit<ReceptionVisitBillingPreparationInput, 'dependencies' | 'services'> {
  invoiceNo: string;
  services: readonly ReceptionVisitBillingContextService[];
}

export interface ReceptionVisitBillingLegacyResult {
  results: readonly unknown[];
  context: ReceptionVisitBillingContext;
  billId: number;
}

export class ReceptionVisitBillingError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = 'ReceptionVisitBillingError';
  }
}

type BatchMutationResult = {
  meta?: {
    last_row_id?: number | string | bigint | null;
  };
};

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

function buildContext(
  input: ReceptionVisitBillingPreparationInput,
  invoiceNo: string,
): ReceptionVisitBillingContext {
  return {
    tenantId: exact(input.tenantId, 'tenantId'),
    userId: positive(input.userId, 'userId'),
    visitId: positive(input.visitId, 'visitId'),
    patientId: positive(input.patientId, 'patientId'),
    visitDoctorId: input.visitDoctorId,
    businessDate: exact(input.businessDate, 'businessDate'),
    issuedAtUtc: exact(input.issuedAtUtc, 'issuedAtUtc'),
    subtotal: input.subtotal,
    discount: input.discount,
    discountByName: input.discountByName,
    total: input.total,
    categoryTotals: input.categoryTotals,
    discountAllocations: input.discountAllocations,
    services: input.services.map((service) => ({
      ...service,
      labOrderId: null,
      serviceDepartmentId: null,
      catalogItemCode: null,
      catalogItemName: null,
      catalogPrice: null,
      catalogDepartmentCode: null,
      catalogDepartmentName: null,
    })),
    invoiceNo: exact(invoiceNo, 'invoiceNo'),
  };
}

function originalLegacyStatements(
  db: ReceptionVisitBillingDatabase,
  context: ReceptionVisitBillingContext,
): { statements: CanonicalPreparedStatement[]; billInsertBatchIndex: number } {
  const serviceIds = context.services.map((service) => Number(service.id));
  const serviceIdPlaceholders = serviceIds.map(() => '?').join(', ');
  const billLookupSql = '(SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1)';
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      UPDATE visit_services
      SET status = 'billing'
      WHERE tenant_id = ? AND visit_id = ? AND status = 'pending' AND bill_id IS NULL
        AND id IN (${serviceIdPlaceholders})
    `).bind(context.tenantId, context.visitId, ...serviceIds),
    db.prepare(`
      INSERT INTO bills (
        patient_id, visit_id, invoice_no, test_bill, admission_bill, doctor_visit_bill,
        operation_bill, medicine_bill, discount, discount_by_name, total, paid, due,
        status, tenant_id, created_by, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'open', ?, ?, datetime('now', '+6 hours')
      WHERE (
        SELECT COUNT(*) FROM visit_services
        WHERE tenant_id = ? AND visit_id = ? AND status = 'billing' AND bill_id IS NULL
          AND id IN (${serviceIdPlaceholders})
      ) = ?
    `).bind(
      context.patientId,
      context.visitId,
      context.invoiceNo,
      context.categoryTotals.testBill,
      context.categoryTotals.admissionBill,
      context.categoryTotals.doctorVisitBill,
      context.categoryTotals.operationBill,
      context.categoryTotals.medicineBill,
      context.discount,
      context.discountByName?.trim() || null,
      context.total,
      context.total,
      context.tenantId,
      context.userId,
      context.tenantId,
      context.visitId,
      ...serviceIds,
      serviceIds.length,
    ),
  ];
  const billInsertBatchIndex = 1;

  for (const allocation of context.discountAllocations) {
    statements.push(db.prepare(`
      INSERT INTO bill_discount_allocations
        (tenant_id, bill_id, allocation_type, discount_reason, doctor_id, amount, reference_name, note, metadata_json, created_by)
      SELECT ?, b.id, ?, ?, ?, ?, ?, ?, ?, ?
      FROM bills b WHERE b.tenant_id = ? AND b.invoice_no = ?
    `).bind(
      context.tenantId,
      allocation.allocationType,
      allocation.reason,
      allocation.doctorId,
      allocation.amount,
      allocation.referenceName,
      allocation.note,
      allocation.metadataJson,
      context.userId,
      context.tenantId,
      context.invoiceNo,
    ));
  }

  for (const service of context.services) {
    const referenceId = service.referenceType === 'lab_order_item'
      ? service.referenceId ?? null
      : service.serviceItemId ?? service.referenceId ?? null;

    statements.push(
      db.prepare(`
        INSERT INTO invoice_items
          (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id)
        SELECT b.id, ?, ?, ?, ?, ?, ?, ?
        FROM bills b WHERE b.tenant_id = ? AND b.invoice_no = ?
      `).bind(
        service.serviceType,
        service.description,
        service.quantity ?? 1,
        service.amount ?? 0,
        service.totalAmount ?? 0,
        referenceId,
        context.tenantId,
        context.tenantId,
        context.invoiceNo,
      ),
      db.prepare(`
        UPDATE visit_services
        SET status = 'billed', bill_id = ${billLookupSql}
        WHERE tenant_id = ? AND id = ? AND status = 'billing' AND bill_id IS NULL
          AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
      `).bind(
        context.tenantId,
        context.invoiceNo,
        context.tenantId,
        service.id,
        context.tenantId,
        context.invoiceNo,
      ),
    );

    if (service.referenceType === 'lab_order_item' && service.referenceId) {
      statements.push(
        db.prepare(`
          UPDATE doctor_commission_accruals
          SET bill_id = ${billLookupSql}, updated_at = datetime('now', '+6 hours')
          WHERE tenant_id = ? AND lab_order_item_id = ? AND bill_id IS NULL
            AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
        `).bind(
          context.tenantId,
          context.invoiceNo,
          context.tenantId,
          service.referenceId,
          context.tenantId,
          context.invoiceNo,
        ),
        db.prepare(`
          UPDATE lab_orders
          SET bill_id = ${billLookupSql},
              billing_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'unpaid' END,
              updated_at = datetime('now', '+6 hours')
          WHERE tenant_id = ?
            AND id = (
              SELECT lab_order_id FROM lab_order_items
              WHERE id = ? AND tenant_id = ?
            )
            AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
        `).bind(
          context.tenantId,
          context.invoiceNo,
          context.total,
          context.tenantId,
          service.referenceId,
          context.tenantId,
          context.tenantId,
          context.invoiceNo,
        ),
      );
    }
  }

  statements.push(db.prepare(`
    UPDATE visit_services
    SET status = 'pending'
    WHERE tenant_id = ? AND visit_id = ? AND status = 'billing' AND bill_id IS NULL
      AND id IN (${serviceIdPlaceholders})
      AND NOT EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
  `).bind(
    context.tenantId,
    context.visitId,
    ...serviceIds,
    context.tenantId,
    context.invoiceNo,
  ));

  return { statements, billInsertBatchIndex };
}

export async function executeReceptionVisitBillingOriginalLegacy(
  db: ReceptionVisitBillingDatabase,
  input: ReceptionVisitBillingPreparationInput,
): Promise<ReceptionVisitBillingLegacyResult> {
  if (input.services.length === 0) {
    throw new ReceptionVisitBillingError(400, 'No pending services to bill');
  }
  await input.dependencies.assertAccountingPeriodOpen();
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  const context = buildContext(input, invoiceNo);
  const prepared = originalLegacyStatements(db, context);
  const results = await db.batch(prepared.statements);
  let billId = Number(
    (results[prepared.billInsertBatchIndex] as BatchMutationResult | undefined)?.meta?.last_row_id ?? 0,
  );
  if (!billId) {
    const createdBill = await db.prepare(
      'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1',
    ).bind(context.tenantId, context.invoiceNo).first<{ id: number }>();
    billId = Number(createdBill?.id ?? 0);
  }
  if (!billId) {
    throw new ReceptionVisitBillingError(
      409,
      'Services were already billed by another request. Please refresh and try again.',
    );
  }
  return { results, context, billId };
}

type StrictEncounterMappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type StrictEncounterRow = {
  legacy_patient_id: number;
  status: string;
};

type StrictLabReferenceRow = {
  lab_order_id: number;
};

type StrictServiceAuthorityRow = {
  id: number;
  service_department_id: number;
  item_code: string | null;
  item_name: string;
  price: number;
  department_code: string;
  department_name: string;
};

function optionalPositive(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positive(value, label);
}

function sourceText(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} cannot be empty`);
  return value;
}

function optionalSourceText(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return sourceText(value, label);
}

function moneyMinor(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw new RangeError(`${label} must use exact cent precision`);
  }
  return rounded;
}

function assertStrictArithmetic(input: ReceptionVisitBillingPreparationInput): void {
  if (input.services.length === 0) throw new ReceptionVisitBillingError(400, 'No pending services to bill');
  const serviceIds = new Set<number>();
  let subtotalMinor = 0;
  for (const service of input.services) {
    const serviceId = positive(service.id, 'service.id');
    if (serviceIds.has(serviceId)) throw new RangeError('duplicate reception visit service');
    serviceIds.add(serviceId);
    if (positive(service.patientId, 'service.patientId') !== positive(input.patientId, 'patientId')) {
      throw new Error('Reception visit service patient mismatch');
    }
    if (positive(service.visitId, 'service.visitId') !== positive(input.visitId, 'visitId')) {
      throw new Error('Reception visit service visit mismatch');
    }
    positive(Number(service.serviceItemId ?? 0), 'service.serviceItemId');
    positive(service.quantity, 'service.quantity');
    sourceText(service.serviceType, 'service.serviceType');
    sourceText(service.description, 'service.description');
    optionalPositive(service.doctorId, 'service.doctorId');
    optionalSourceText(service.referenceType, 'service.referenceType');
    optionalPositive(service.referenceId, 'service.referenceId');
    const amountMinor = moneyMinor(service.amount, 'service.amount');
    const discountMinor = moneyMinor(service.discountAmount, 'service.discountAmount');
    const totalMinor = moneyMinor(service.totalAmount, 'service.totalAmount');
    const expectedMinor = amountMinor * service.quantity - discountMinor;
    if (!Number.isSafeInteger(expectedMinor) || expectedMinor !== totalMinor) {
      throw new RangeError('Reception visit service arithmetic does not reconcile');
    }
    subtotalMinor += totalMinor;
    if (!Number.isSafeInteger(subtotalMinor)) throw new RangeError('Reception visit subtotal exceeds safe range');
  }
  if (subtotalMinor !== moneyMinor(input.subtotal, 'subtotal')) {
    throw new RangeError('Reception visit subtotal does not match selected services');
  }
  const discountMinor = moneyMinor(input.discount, 'discount');
  const totalMinor = moneyMinor(input.total, 'total');
  if (discountMinor > subtotalMinor || subtotalMinor - discountMinor !== totalMinor) {
    throw new RangeError('Reception visit bill arithmetic does not reconcile');
  }
  const allocationMinor = input.discountAllocations.reduce(
    (sum, allocation) => sum + moneyMinor(allocation.amount, 'discountAllocation.amount'),
    0,
  );
  if (!Number.isSafeInteger(allocationMinor) || allocationMinor !== discountMinor) {
    throw new RangeError('Reception visit discount allocation arithmetic does not reconcile');
  }
}

async function assertStrictEncounterAuthority(
  db: ReceptionVisitBillingDatabase,
  input: ReceptionVisitBillingPreparationInput,
): Promise<void> {
  const visit = await db.prepare(`
    SELECT id
    FROM visits
    WHERE id=? AND CAST(tenant_id AS TEXT)=? AND patient_id=?
      AND COALESCE(doctor_id,0)=COALESCE(?,0)
    LIMIT 1
  `).bind(
    input.visitId,
    input.tenantId,
    input.patientId,
    input.visitDoctorId,
  ).first<{ id: number }>();
  if (!visit) throw new ReceptionVisitBillingError(404, 'Visit not found');

  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    String(input.visitId),
  ).first<StrictEncounterMappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('Canonical encounter mapping is unavailable for the reception visit');
  }
  const encounter = await db.prepare(`
    SELECT legacy_patient_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    mapping.canonical_public_id,
  ).first<StrictEncounterRow>();
  if (!encounter || encounter.legacy_patient_id !== input.patientId) {
    throw new Error('Canonical encounter mapping does not match the reception visit patient');
  }
  if (!['planned', 'in_progress'].includes(encounter.status)) {
    throw new Error('Canonical encounter mapping is not active for reception billing');
  }
}

async function prepareStrictServices(
  db: ReceptionVisitBillingDatabase,
  input: ReceptionVisitBillingPreparationInput,
): Promise<ReceptionVisitBillingContextService[]> {
  const prepared: ReceptionVisitBillingContextService[] = [];
  for (const service of input.services) {
    const serviceItemId = positive(Number(service.serviceItemId ?? 0), 'service.serviceItemId');
    const row = await db.prepare(`
      SELECT
        vs.id,
        si.service_department_id,
        si.item_code,
        si.item_name,
        si.price,
        sd.department_code,
        sd.department_name
      FROM visit_services vs
      JOIN billing_service_items si
        ON si.id=vs.service_item_id
       AND CAST(si.tenant_id AS TEXT)=CAST(vs.tenant_id AS TEXT)
       AND COALESCE(si.is_active,1)=1
      JOIN billing_service_departments sd
        ON sd.id=si.service_department_id
       AND CAST(sd.tenant_id AS TEXT)=CAST(vs.tenant_id AS TEXT)
       AND COALESCE(sd.is_active,1)=1
      WHERE vs.id=? AND CAST(vs.tenant_id AS TEXT)=?
        AND vs.visit_id=? AND vs.patient_id=?
        AND vs.service_type=? AND vs.description=? AND vs.service_item_id=?
        AND COALESCE(vs.doctor_id,0)=COALESCE(?,0)
        AND vs.amount=? AND COALESCE(vs.discount_amount,0)=?
        AND vs.quantity=? AND vs.total_amount=?
        AND COALESCE(vs.reference_type,'')=COALESCE(?,'')
        AND COALESCE(vs.reference_id,0)=COALESCE(?,0)
        AND vs.status='pending' AND vs.bill_id IS NULL
      LIMIT 1
    `).bind(
      service.id,
      input.tenantId,
      input.visitId,
      input.patientId,
      service.serviceType,
      service.description,
      serviceItemId,
      service.doctorId,
      service.amount,
      service.discountAmount,
      service.quantity,
      service.totalAmount,
      service.referenceType,
      service.referenceId,
    ).first<StrictServiceAuthorityRow>();
    if (!row) throw new Error(`Reception visit service #${service.id} changed before invoice allocation`);

    const mapping = await prepareCanonicalBillingServiceMapping(db, {
      tenantId: input.tenantId,
      billingServiceItemId: serviceItemId,
    });
    if (mapping.status !== 'active') {
      throw new Error('Reception visit billing requires an active canonical service');
    }

    let labOrderId: number | null = null;
    if (service.referenceType === 'lab_order_item') {
      if (!service.referenceId) throw new Error('Lab visit service requires a lab order item reference');
      const lab = await db.prepare(`
        SELECT lo.id AS lab_order_id
        FROM lab_order_items loi
        JOIN lab_orders lo
          ON lo.id=loi.lab_order_id
         AND CAST(lo.tenant_id AS TEXT)=CAST(loi.tenant_id AS TEXT)
        WHERE loi.id=? AND CAST(loi.tenant_id AS TEXT)=?
          AND lo.patient_id=? AND lo.visit_id=? AND lo.bill_id IS NULL
        LIMIT 1
      `).bind(
        service.referenceId,
        input.tenantId,
        input.patientId,
        input.visitId,
      ).first<StrictLabReferenceRow>();
      if (!lab?.lab_order_id) throw new Error('Lab order reference changed before invoice allocation');
      labOrderId = positive(lab.lab_order_id, 'labOrderId');
    }
    const catalogPrice = Number(row.price);
    if (!Number.isFinite(catalogPrice) || catalogPrice < 0) {
      throw new Error('Reception billing service price authority is invalid');
    }
    prepared.push({
      ...service,
      serviceItemId,
      labOrderId,
      serviceDepartmentId: positive(row.service_department_id, 'serviceDepartmentId'),
      catalogItemCode: row.item_code == null ? null : sourceText(row.item_code, 'catalogItemCode'),
      catalogItemName: sourceText(row.item_name, 'catalogItemName'),
      catalogPrice,
      catalogDepartmentCode: sourceText(row.department_code, 'catalogDepartmentCode'),
      catalogDepartmentName: sourceText(row.department_name, 'catalogDepartmentName'),
    });
  }
  return prepared;
}

export async function prepareReceptionVisitBillingStrictContext(
  db: ReceptionVisitBillingDatabase,
  input: ReceptionVisitBillingPreparationInput,
): Promise<ReceptionVisitBillingContext> {
  assertStrictArithmetic(input);
  await assertStrictEncounterAuthority(db, input);
  const services = await prepareStrictServices(db, input);
  await input.dependencies.assertAccountingPeriodOpen();
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  return {
    ...buildContext(input, invoiceNo),
    services,
  };
}

function strictServiceClaim(
  db: Pick<ReceptionVisitBillingDatabase, 'prepare'>,
  context: ReceptionVisitBillingContext,
  service: ReceptionVisitBillingContextService,
): CanonicalPreparedStatement {
  const serviceItemId = positive(Number(service.serviceItemId ?? 0), 'service.serviceItemId');
  const serviceDepartmentId = positive(
    Number(service.serviceDepartmentId ?? 0),
    'service.serviceDepartmentId',
  );
  const catalogItemName = sourceText(service.catalogItemName ?? '', 'service.catalogItemName');
  const catalogDepartmentCode = sourceText(
    service.catalogDepartmentCode ?? '',
    'service.catalogDepartmentCode',
  );
  const catalogDepartmentName = sourceText(
    service.catalogDepartmentName ?? '',
    'service.catalogDepartmentName',
  );
  const catalogPrice = Number(service.catalogPrice);
  if (!Number.isFinite(catalogPrice) || catalogPrice < 0) {
    throw new Error('Reception billing service price authority is invalid');
  }
  return db.prepare(`
    UPDATE visit_services
    SET status='billing'
    WHERE id=? AND CAST(tenant_id AS TEXT)=?
      AND visit_id=? AND patient_id=?
      AND service_type=? AND description=? AND service_item_id=?
      AND COALESCE(doctor_id,0)=COALESCE(?,0)
      AND amount=? AND COALESCE(discount_amount,0)=?
      AND quantity=? AND total_amount=?
      AND COALESCE(reference_type,'')=COALESCE(?,'')
      AND COALESCE(reference_id,0)=COALESCE(?,0)
      AND status='pending' AND bill_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM visits v
        WHERE v.id=visit_services.visit_id
          AND CAST(v.tenant_id AS TEXT)=CAST(visit_services.tenant_id AS TEXT)
          AND v.patient_id=visit_services.patient_id
          AND COALESCE(v.doctor_id,0)=COALESCE(?,0)
      )
      AND EXISTS (
        SELECT 1
        FROM billing_service_items si
        JOIN billing_service_departments sd
          ON sd.id=si.service_department_id
         AND CAST(sd.tenant_id AS TEXT)=CAST(si.tenant_id AS TEXT)
         AND COALESCE(sd.is_active,1)=1
        WHERE si.id=visit_services.service_item_id
          AND CAST(si.tenant_id AS TEXT)=CAST(visit_services.tenant_id AS TEXT)
          AND COALESCE(si.is_active,1)=1
          AND si.service_department_id=?
          AND COALESCE(si.item_code,'')=COALESCE(?,'')
          AND si.item_name=?
          AND si.price=?
          AND sd.department_code=?
          AND sd.department_name=?
      )
      AND (
        NOT EXISTS (
          SELECT 1
          FROM canonical_source_mappings sm
          WHERE CAST(sm.tenant_id AS TEXT)=CAST(visit_services.tenant_id AS TEXT)
            AND sm.entity_type='service_catalog_item'
            AND sm.source_type='legacy_billing_service_item'
            AND sm.source_public_id=CAST(visit_services.service_item_id AS TEXT)
        )
        OR EXISTS (
          SELECT 1
          FROM canonical_source_mappings sm
          JOIN canonical_service_catalog_items ci
            ON ci.tenant_id=sm.tenant_id
           AND ci.service_public_id=sm.canonical_public_id
           AND ci.status='active'
          WHERE CAST(sm.tenant_id AS TEXT)=CAST(visit_services.tenant_id AS TEXT)
            AND sm.entity_type='service_catalog_item'
            AND sm.source_type='legacy_billing_service_item'
            AND sm.source_public_id=CAST(visit_services.service_item_id AS TEXT)
            AND sm.mapping_status='mapped'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM canonical_source_mappings m
        JOIN canonical_encounters e
          ON e.tenant_id=m.tenant_id
         AND e.encounter_public_id=m.canonical_public_id
        WHERE CAST(m.tenant_id AS TEXT)=CAST(visit_services.tenant_id AS TEXT)
          AND m.entity_type='encounter'
          AND m.source_type='legacy_visit'
          AND m.source_public_id=CAST(visit_services.visit_id AS TEXT)
          AND m.mapping_status='mapped'
          AND e.legacy_patient_id=visit_services.patient_id
          AND e.status IN ('planned','in_progress')
      )
  `).bind(
    service.id,
    context.tenantId,
    context.visitId,
    context.patientId,
    service.serviceType,
    service.description,
    serviceItemId,
    service.doctorId,
    service.amount,
    service.discountAmount,
    service.quantity,
    service.totalAmount,
    service.referenceType,
    service.referenceId,
    context.visitDoctorId,
    serviceDepartmentId,
    service.catalogItemCode,
    catalogItemName,
    catalogPrice,
    catalogDepartmentCode,
    catalogDepartmentName,
  );
}

export function prepareReceptionVisitBillingStrictStatements(
  db: Pick<ReceptionVisitBillingDatabase, 'prepare'>,
  context: ReceptionVisitBillingContext,
): readonly CanonicalPreparedStatement[] {
  const tenantId = exact(context.tenantId, 'tenantId');
  const invoiceNo = exact(context.invoiceNo, 'invoiceNo');
  const operationKey = `reception-visit-billing:${context.visitId}:${invoiceNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const billLookupSql = '(SELECT id FROM bills WHERE tenant_id=? AND invoice_no=? LIMIT 1)';
  const asserted = (statement: CanonicalPreparedStatement, stepKey: string) => {
    statements.push(
      statement,
      prepareFinancialBatchAssertion(db, {
        tenantId,
        operationKey,
        stepKey,
        expectedChanges: 1,
      }),
    );
  };

  for (const service of context.services) {
    asserted(strictServiceClaim(db, context, service), `service-claim-${service.id}`);
  }

  asserted(db.prepare(`
    INSERT INTO bills (
      patient_id,visit_id,invoice_no,test_bill,admission_bill,doctor_visit_bill,
      operation_bill,medicine_bill,discount,discount_by_name,total,paid,due,
      status,tenant_id,created_by,created_at
    )
    SELECT ?,?,?,?,?,?,?,?,?,?,?,0,?,'open',?,?,datetime('now','+6 hours')
    WHERE NOT EXISTS (
      SELECT 1 FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
    )
  `).bind(
    context.patientId,
    context.visitId,
    invoiceNo,
    context.categoryTotals.testBill,
    context.categoryTotals.admissionBill,
    context.categoryTotals.doctorVisitBill,
    context.categoryTotals.operationBill,
    context.categoryTotals.medicineBill,
    context.discount,
    context.discountByName?.trim() || null,
    context.total,
    context.total,
    tenantId,
    context.userId,
    tenantId,
    invoiceNo,
  ), 'bill-insert');

  for (const [index, allocation] of context.discountAllocations.entries()) {
    asserted(db.prepare(`
      INSERT INTO bill_discount_allocations (
        tenant_id,bill_id,allocation_type,discount_reason,doctor_id,amount,
        reference_name,note,metadata_json,created_by
      )
      SELECT ?,b.id,?,?,?,?,?,?,?,?
      FROM bills b
      WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
    `).bind(
      tenantId,
      sourceText(allocation.allocationType, 'allocation.allocationType'),
      sourceText(allocation.reason, 'allocation.reason'),
      optionalPositive(allocation.doctorId, 'allocation.doctorId'),
      allocation.amount,
      allocation.referenceName,
      allocation.note,
      sourceText(allocation.metadataJson, 'allocation.metadataJson'),
      context.userId,
      tenantId,
      invoiceNo,
    ), `discount-allocation-${index + 1}`);
  }

  for (const service of context.services) {
    const serviceItemId = positive(Number(service.serviceItemId ?? 0), 'service.serviceItemId');
    asserted(db.prepare(`
      INSERT INTO invoice_items (
        bill_id,item_category,description,quantity,unit_price,line_total,reference_id,tenant_id
      )
      SELECT b.id,vs.service_type,vs.description,vs.quantity,vs.amount,vs.total_amount,
             CASE WHEN vs.reference_type='lab_order_item'
                  THEN vs.reference_id ELSE COALESCE(vs.service_item_id,vs.reference_id) END,
             ?
      FROM visit_services vs
      JOIN bills b ON CAST(b.tenant_id AS TEXT)=CAST(vs.tenant_id AS TEXT) AND b.invoice_no=?
      WHERE vs.id=? AND CAST(vs.tenant_id AS TEXT)=?
        AND vs.visit_id=? AND vs.patient_id=? AND vs.service_item_id=?
        AND vs.status='billing' AND vs.bill_id IS NULL
    `).bind(
      tenantId,
      invoiceNo,
      service.id,
      tenantId,
      context.visitId,
      context.patientId,
      serviceItemId,
    ), `invoice-item-${service.id}`);

    asserted(db.prepare(`
      UPDATE visit_services
      SET status='billed',bill_id=${billLookupSql}
      WHERE id=? AND CAST(tenant_id AS TEXT)=?
        AND visit_id=? AND patient_id=? AND service_item_id=?
        AND status='billing' AND bill_id IS NULL
        AND EXISTS (SELECT 1 FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?)
    `).bind(
      tenantId,
      invoiceNo,
      service.id,
      tenantId,
      context.visitId,
      context.patientId,
      serviceItemId,
      tenantId,
      invoiceNo,
    ), `service-link-${service.id}`);

    if (service.referenceType === 'lab_order_item' && service.referenceId && service.labOrderId) {
      statements.push(db.prepare(`
        UPDATE doctor_commission_accruals
        SET bill_id=${billLookupSql},updated_at=datetime('now','+6 hours')
        WHERE CAST(tenant_id AS TEXT)=? AND lab_order_item_id=? AND bill_id IS NULL
          AND EXISTS (SELECT 1 FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?)
      `).bind(
        tenantId,
        invoiceNo,
        tenantId,
        service.referenceId,
        tenantId,
        invoiceNo,
      ));

      asserted(db.prepare(`
        UPDATE lab_orders
        SET bill_id=${billLookupSql},
            billing_status=CASE WHEN ?<=0 THEN 'paid' ELSE 'unpaid' END,
            updated_at=datetime('now','+6 hours')
        WHERE id=? AND CAST(tenant_id AS TEXT)=?
          AND patient_id=? AND visit_id=? AND bill_id IS NULL
          AND EXISTS (
            SELECT 1 FROM lab_order_items loi
            WHERE loi.id=? AND CAST(loi.tenant_id AS TEXT)=?
              AND loi.lab_order_id=?
          )
          AND EXISTS (SELECT 1 FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?)
      `).bind(
        tenantId,
        invoiceNo,
        context.total,
        service.labOrderId,
        tenantId,
        context.patientId,
        context.visitId,
        service.referenceId,
        tenantId,
        service.labOrderId,
        tenantId,
        invoiceNo,
      ), `lab-order-link-${service.id}`);
    }
  }

  statements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
  return statements;
}
