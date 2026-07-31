import type { BillCategoryTotals } from '../billing-category-totals';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  recordAccountingPostingEvent,
} from '../accounting-posting';
import { buildBillCreatedAccountingPayload } from '../billing-finalization';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './command-batch';
import {
  prepareAcceptedServiceRouteBatch,
  prepareProtectedConsultationService,
} from './service-delivery-route-integration';
import { resolveAppointmentRoutePractitioner } from './appointment-route-integration';

export interface AppointmentLegacyFinalizationItem {
  id: number;
  itemCategory: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  referenceId: number | null;
  doctorId: number | null;
  canonicalSourceKey: string;
}

export interface AppointmentLegacySchemeAllocation {
  allocationType: string;
  amount: number;
  referenceName: string | null;
  note: string;
  metadataJson: string;
}

export interface AppointmentLegacyFinalizationInput {
  tenantId: string;
  userId: string;
  appointmentId: number;
  expectedBillingStatus: string;
  billingStatus: 'paid' | 'due_approved';
  patientId: number;
  visitId: number | null;
  invoiceNo: string;
  categoryTotals: BillCategoryTotals;
  discount: number;
  discountByName: string | null;
  total: number;
  paid: number;
  due: number;
  billStatus: 'paid' | 'open';
  paymentMethod: string;
  remarks: string | null;
  counterId: number;
  counterSessionId: number;
  paymentReceiptNo: string | null;
  externalTransactionId: string | null;
  businessDate: string;
  occurredAtUtc: string;
  items: readonly AppointmentLegacyFinalizationItem[];
  schemeDiscount?: {
    amount: number;
    finalFee: number;
    reason: string;
  } | null;
  schemeAllocation?: AppointmentLegacySchemeAllocation | null;
  accountingExtraPayload?: Record<string, unknown>;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function nonNegativeMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

export function prepareAppointmentBillingOriginalLegacyStatements(
  db: D1Database,
  input: AppointmentLegacyFinalizationInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const billIdLookup = '(SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1)';

  statements.push(db.prepare(`
    INSERT INTO bills
      (patient_id, visit_id, invoice_no, test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill,
       discount, discount_by_name, total, paid, due, status, payment_method, remarks, tenant_id, created_by, counter_id, counter_session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    input.patientId,
    input.visitId,
    input.invoiceNo,
    input.categoryTotals.testBill,
    input.categoryTotals.doctorVisitBill,
    input.categoryTotals.admissionBill,
    input.categoryTotals.operationBill,
    input.categoryTotals.medicineBill,
    input.discount,
    input.discountByName,
    input.total,
    input.paid,
    input.due,
    input.billStatus,
    input.paymentMethod,
    input.remarks,
    input.tenantId,
    input.userId,
    input.counterId,
    input.counterSessionId,
  ));

  for (const item of input.items) {
    statements.push(db.prepare(`
      INSERT INTO invoice_items
        (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id, created_at)
      SELECT ${billIdLookup}, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      input.tenantId,
      input.invoiceNo,
      item.itemCategory,
      item.description,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
      item.referenceId,
      input.tenantId,
      input.tenantId,
      input.invoiceNo,
    ));

    statements.push(db.prepare(`
      UPDATE billing_provisional_items
      SET bill_status = 'finalized',
          billed_bill_id = ${billIdLookup},
          canonical_source_key = COALESCE(canonical_source_key, ?)
      WHERE id = ? AND tenant_id = ?
        AND bill_status = 'provisional'
        AND COALESCE(is_active, 1) = 1
        AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      input.tenantId,
      input.invoiceNo,
      exact(item.canonicalSourceKey, 'item.canonicalSourceKey'),
      item.id,
      input.tenantId,
      input.tenantId,
      input.invoiceNo,
    ));
  }

  if (input.paymentReceiptNo) {
    statements.push(db.prepare(`
      INSERT INTO payments
        (bill_id, amount, payment_type, receipt_no, received_by, payment_method, external_transaction_id,
         counter_id, counter_session_id, tenant_id, date)
      SELECT ${billIdLookup}, ?, 'current', ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      input.tenantId,
      input.invoiceNo,
      input.paid,
      input.paymentReceiptNo,
      input.userId,
      input.paymentMethod,
      input.externalTransactionId,
      input.counterId,
      input.counterSessionId,
      input.tenantId,
      input.tenantId,
      input.invoiceNo,
    ));

    statements.push(db.prepare(`
      INSERT INTO emp_cash_transactions
        (tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount, reference_id, reference_type, payment_method, description)
      SELECT ?, ?, ?, ?, 'CashSales', ?, ${billIdLookup}, 'bill', ?, ?
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      input.tenantId,
      input.userId,
      input.counterId,
      input.counterSessionId,
      input.paid,
      input.tenantId,
      input.invoiceNo,
      input.paymentMethod,
      `Appointment consultation payment ${input.paymentReceiptNo}`,
      input.tenantId,
      input.invoiceNo,
    ));
  }

  statements.push(db.prepare(`
    UPDATE appointments
    SET billing_status = ?,
        discount_by_name = COALESCE(NULLIF(TRIM(discount_by_name), ''), ?),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
      AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
  `).bind(
    input.billingStatus,
    input.discountByName,
    input.appointmentId,
    input.tenantId,
    input.tenantId,
    input.invoiceNo,
  ));

  if (input.schemeAllocation) {
    statements.push(db.prepare(`
      INSERT INTO bill_discount_allocations
        (tenant_id, bill_id, allocation_type, discount_reason, amount, reference_name, note, metadata_json, created_by)
      SELECT ?, b.id, ?, ?, ?, ?, ?, ?, ?
      FROM bills b
      WHERE b.tenant_id = ? AND b.invoice_no = ?
    `).bind(
      input.tenantId,
      input.schemeAllocation.allocationType,
      input.schemeAllocation.allocationType,
      input.schemeAllocation.amount,
      input.schemeAllocation.referenceName,
      input.schemeAllocation.note,
      input.schemeAllocation.metadataJson,
      input.userId,
      input.tenantId,
      input.invoiceNo,
    ));
  }

  return statements;
}

export function prepareAppointmentBillingStrictStatements(
  db: D1Database,
  input: AppointmentLegacyFinalizationInput,
): D1PreparedStatement[] {
  const tenantId = exact(input.tenantId, 'tenantId');
  const userId = exact(input.userId, 'userId');
  const appointmentId = positiveInteger(input.appointmentId, 'appointmentId');
  const patientId = positiveInteger(input.patientId, 'patientId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const operationKey = `appointment-billing:${appointmentId}:${invoiceNo}`;
  const statements: D1PreparedStatement[] = [];
  const billIdLookup = '(SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1)';

  const pushAsserted = (statement: D1PreparedStatement, stepKey: string): void => {
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

  pushAsserted(db.prepare(`
    INSERT INTO bills
      (patient_id, visit_id, invoice_no, test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill,
       discount, discount_by_name, total, paid, due, status, payment_method, remarks, tenant_id, created_by,
       counter_id, counter_session_id, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
    WHERE NOT EXISTS (
      SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?
    )
  `).bind(
    patientId,
    input.visitId,
    invoiceNo,
    input.categoryTotals.testBill,
    input.categoryTotals.doctorVisitBill,
    input.categoryTotals.admissionBill,
    input.categoryTotals.operationBill,
    input.categoryTotals.medicineBill,
    nonNegativeMoney(input.discount, 'discount'),
    input.discountByName,
    nonNegativeMoney(input.total, 'total'),
    nonNegativeMoney(input.paid, 'paid'),
    nonNegativeMoney(input.due, 'due'),
    input.billStatus,
    exact(input.paymentMethod, 'paymentMethod'),
    input.remarks,
    tenantId,
    userId,
    positiveInteger(input.counterId, 'counterId'),
    positiveInteger(input.counterSessionId, 'counterSessionId'),
    tenantId,
    invoiceNo,
  ), 'bill_insert');

  for (const item of input.items) {
    positiveInteger(item.id, 'item.id');
    pushAsserted(db.prepare(`
      INSERT INTO invoice_items
        (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id, created_at)
      SELECT ${billIdLookup}, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      tenantId,
      invoiceNo,
      exact(item.itemCategory, 'item.itemCategory'),
      exact(item.description, 'item.description'),
      positiveInteger(item.quantity, 'item.quantity'),
      nonNegativeMoney(item.unitPrice, 'item.unitPrice'),
      nonNegativeMoney(item.lineTotal, 'item.lineTotal'),
      item.referenceId,
      tenantId,
      tenantId,
      invoiceNo,
    ), `invoice_item_${item.id}`);

    pushAsserted(db.prepare(`
      UPDATE billing_provisional_items
      SET bill_status = 'finalized',
          billed_bill_id = ${billIdLookup},
          canonical_source_key = COALESCE(canonical_source_key, ?)
      WHERE id = ? AND tenant_id = ?
        AND patient_id = ? AND appointment_id = ?
        AND unit_price = ? AND quantity = ?
        AND COALESCE(discount_amount, 0) = ? AND total_amount = ?
        AND bill_status = 'provisional'
        AND COALESCE(is_active, 1) = 1
        AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      tenantId,
      invoiceNo,
      exact(item.canonicalSourceKey, 'item.canonicalSourceKey'),
      item.id,
      tenantId,
      patientId,
      appointmentId,
      nonNegativeMoney(item.unitPrice, 'item.unitPrice'),
      positiveInteger(item.quantity, 'item.quantity'),
      nonNegativeMoney(item.discountAmount, 'item.discountAmount'),
      nonNegativeMoney(item.lineTotal, 'item.lineTotal'),
      tenantId,
      invoiceNo,
    ), `provisional_item_${item.id}`);
  }

  if (input.paymentReceiptNo) {
    const receiptNo = exact(input.paymentReceiptNo, 'paymentReceiptNo');
    pushAsserted(db.prepare(`
      INSERT INTO payments
        (bill_id, amount, payment_type, receipt_no, received_by, payment_method, external_transaction_id,
         counter_id, counter_session_id, tenant_id, date)
      SELECT ${billIdLookup}, ?, 'current', ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
        AND NOT EXISTS (SELECT 1 FROM payments WHERE tenant_id = ? AND receipt_no = ?)
    `).bind(
      tenantId,
      invoiceNo,
      input.paid,
      receiptNo,
      userId,
      input.paymentMethod,
      input.externalTransactionId,
      input.counterId,
      input.counterSessionId,
      tenantId,
      tenantId,
      invoiceNo,
      tenantId,
      receiptNo,
    ), 'payment_insert');

    pushAsserted(db.prepare(`
      INSERT INTO emp_cash_transactions
        (tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount,
         reference_id, reference_type, payment_method, description)
      SELECT ?, ?, ?, ?, 'CashSales', ?, ${billIdLookup}, 'bill', ?, ?
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      tenantId,
      userId,
      input.counterId,
      input.counterSessionId,
      input.paid,
      tenantId,
      invoiceNo,
      input.paymentMethod,
      `Appointment consultation payment ${receiptNo}`,
      tenantId,
      invoiceNo,
    ), 'cash_transaction');
  }

  pushAsserted(db.prepare(`
    UPDATE appointments
    SET billing_status = ?,
        discount_by_name = COALESCE(NULLIF(TRIM(discount_by_name), ''), ?),
        discount_amount = CASE WHEN ? IS NULL THEN discount_amount ELSE ? END,
        final_fee = CASE WHEN ? IS NULL THEN final_fee ELSE ? END,
        discount_reason = CASE
          WHEN ? IS NULL THEN discount_reason
          ELSE COALESCE(NULLIF(TRIM(discount_reason), ''), ?)
        END,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
      AND COALESCE(billing_status, 'unpaid') = ?
      AND EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
  `).bind(
    input.billingStatus,
    input.discountByName,
    input.schemeDiscount?.amount ?? null,
    input.schemeDiscount?.amount ?? null,
    input.schemeDiscount?.finalFee ?? null,
    input.schemeDiscount?.finalFee ?? null,
    input.schemeDiscount?.reason ?? null,
    input.schemeDiscount?.reason ?? null,
    appointmentId,
    tenantId,
    exact(input.expectedBillingStatus, 'expectedBillingStatus'),
    tenantId,
    invoiceNo,
  ), 'appointment_status');

  if (input.schemeAllocation) {
    pushAsserted(db.prepare(`
      INSERT INTO bill_discount_allocations
        (tenant_id, bill_id, allocation_type, discount_reason, amount, reference_name, note, metadata_json, created_by)
      SELECT ?, b.id, ?, ?, ?, ?, ?, ?, ?
      FROM bills b
      WHERE b.tenant_id = ? AND b.invoice_no = ?
    `).bind(
      tenantId,
      exact(input.schemeAllocation.allocationType, 'schemeAllocation.allocationType'),
      input.schemeAllocation.allocationType,
      nonNegativeMoney(input.schemeAllocation.amount, 'schemeAllocation.amount'),
      input.schemeAllocation.referenceName,
      exact(input.schemeAllocation.note, 'schemeAllocation.note'),
      exact(input.schemeAllocation.metadataJson, 'schemeAllocation.metadataJson'),
      userId,
      tenantId,
      invoiceNo,
    ), 'scheme_discount_allocation');
  }

  const billPayload = buildBillCreatedAccountingPayload({
    tenantId,
    userId,
    patientId,
    visitId: input.visitId,
    billId: 0,
    invoiceNo,
    billDate: input.businessDate,
    subtotal: input.total,
    discount: input.discount,
    total: input.total,
    categoryTotals: input.categoryTotals,
    counterId: input.counterId,
    counterSessionId: input.counterSessionId,
    extraPayload: input.accountingExtraPayload,
    items: [],
  });
  const billCreatedEventType = ACCOUNTING_EVENT_TYPES.billCreated;
  pushAsserted(db.prepare(`
    INSERT INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    SELECT ?, 'billing:' || CAST(b.id AS TEXT) || ':' || ?, 'billing', b.id, ?, ?,
           json_set(?, '$.billId', b.id), ?
    FROM bills b
    WHERE b.tenant_id = ? AND b.invoice_no = ?
    ON CONFLICT(tenant_id, source_event_key) DO UPDATE SET
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      event_type = excluded.event_type,
      event_date = excluded.event_date,
      payload_json = excluded.payload_json,
      created_by = excluded.created_by
  `).bind(
    tenantId,
    billCreatedEventType,
    billCreatedEventType,
    input.businessDate,
    JSON.stringify(billPayload),
    userId,
    tenantId,
    invoiceNo,
  ), 'bill_created_accounting_event');

  if (input.paymentReceiptNo) {
    const receiptNo = input.paymentReceiptNo;
    const paymentPayload = {
      billId: 0,
      receiptNo,
      patientId,
      amount: input.paid,
      paymentMethod: input.paymentMethod,
      paymentType: 'current',
      externalTransactionId: input.externalTransactionId,
      counterId: input.counterId,
      counterSessionId: input.counterSessionId,
    };
    pushAsserted(db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      SELECT ?, ?, 'payment', ?, ?, ?, json_set(?, '$.billId', b.id), ?
      FROM bills b
      WHERE b.tenant_id = ? AND b.invoice_no = ?
    `).bind(
      tenantId,
      createPostingEventKey('payment', receiptNo, ACCOUNTING_EVENT_TYPES.paymentReceived),
      receiptNo,
      ACCOUNTING_EVENT_TYPES.paymentReceived,
      input.businessDate,
      JSON.stringify(paymentPayload),
      userId,
      tenantId,
      invoiceNo,
    ), 'payment_accounting_event');
  }

  statements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
  return statements;
}

async function recordAppointmentLegacyPostCommitAccounting(
  db: D1Database,
  input: AppointmentLegacyFinalizationInput,
): Promise<void> {
  const bill = await db.prepare(
    'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1',
  ).bind(input.tenantId, input.invoiceNo).first<{ id?: number | string | null }>();
  const billId = Number(bill?.id ?? 0);
  if (!Number.isSafeInteger(billId) || billId <= 0) return;

  const sideEffects: Promise<unknown>[] = [];
  if (input.total > 0 || input.discount > 0) {
    sideEffects.push(recordAccountingPostingEvent(db, {
      tenantId: input.tenantId,
      sourceType: 'billing',
      sourceId: billId,
      eventType: ACCOUNTING_EVENT_TYPES.billCreated,
      eventDate: input.businessDate,
      createdBy: input.userId,
      payload: buildBillCreatedAccountingPayload({
        tenantId: input.tenantId,
        userId: input.userId,
        patientId: input.patientId,
        visitId: input.visitId,
        billId,
        invoiceNo: input.invoiceNo,
        billDate: input.businessDate,
        subtotal: input.total,
        discount: input.discount,
        total: input.total,
        categoryTotals: input.categoryTotals,
        counterId: input.counterId,
        counterSessionId: input.counterSessionId,
        extraPayload: input.accountingExtraPayload,
        items: input.items.map((item) => ({
          itemCategory: item.itemCategory,
          description: item.description,
          lineTotal: item.lineTotal,
          referenceId: item.referenceId,
        })),
      }),
    }));
  }

  if (input.paymentReceiptNo && input.paid > 0) {
    sideEffects.push(recordAccountingPostingEvent(db, {
      tenantId: input.tenantId,
      sourceType: 'payment',
      sourceId: input.paymentReceiptNo,
      eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
      eventDate: input.businessDate,
      createdBy: input.userId,
      payload: {
        billId,
        receiptNo: input.paymentReceiptNo,
        patientId: input.patientId,
        amount: input.paid,
        paymentMethod: input.paymentMethod,
        paymentType: 'current',
        externalTransactionId: input.externalTransactionId,
        counterId: input.counterId,
        counterSessionId: input.counterSessionId,
      },
    }));
  }

  await Promise.all(sideEffects);
}

interface AppointmentBillingEncounterMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface AppointmentBillingEncounterRow {
  legacy_patient_id: number;
  status: string;
}

async function resolveAppointmentBillingEncounter(
  db: CanonicalBatchDatabase,
  input: AppointmentLegacyFinalizationInput,
): Promise<string | null> {
  if (!input.visitId) return null;
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, String(input.visitId)).first<AppointmentBillingEncounterMappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('appointment billing visit requires one exact canonical encounter mapping');
  }
  const encounter = await db.prepare(`
    SELECT legacy_patient_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(input.tenantId, mapping.canonical_public_id).first<AppointmentBillingEncounterRow>();
  if (!encounter || Number(encounter.legacy_patient_id) !== input.patientId) {
    throw new Error('appointment billing encounter does not match the appointment patient');
  }
  if (['cancelled', 'entered_in_error'].includes(encounter.status)) {
    throw new Error('appointment billing encounter is not eligible for service acceptance');
  }
  return mapping.canonical_public_id;
}

async function prepareAppointmentBillingServiceStrictStatements(
  db: CanonicalBatchDatabase,
  input: AppointmentLegacyFinalizationInput,
): Promise<readonly CanonicalPreparedStatement[]> {
  const financialStatements = prepareAppointmentBillingStrictStatements(
    db as unknown as D1Database,
    input,
  ) as unknown as readonly CanonicalPreparedStatement[];
  const encounterPublicId = await resolveAppointmentBillingEncounter(db, input);
  const consultationService = await prepareProtectedConsultationService(db, input.tenantId);
  const preparedStatements: CanonicalPreparedStatement[] = [];
  let embeddedFinancial = false;
  let observedStatus: 'prepared' | 'replayed' | null = null;

  for (const item of input.items) {
    if (!item.doctorId) {
      throw new Error('appointment consultation service requires one exact doctor identity');
    }
    const practitionerPublicId = await resolveAppointmentRoutePractitioner(
      db,
      input.tenantId,
      item.doctorId,
    );
    if (!practitionerPublicId) {
      throw new Error('appointment consultation service requires one exact practitioner mapping');
    }
    const prepared = await prepareAcceptedServiceRouteBatch(db, {
      tenantId: input.tenantId,
      legacyPatientId: input.patientId,
      encounterPublicId,
      servicePublicId: consultationService.servicePublicId,
      sourceType: 'legacy_billing_provisional_item_key',
      sourcePublicId: exact(item.canonicalSourceKey, 'item.canonicalSourceKey'),
      sourceTable: 'billing_provisional_items',
      quantity: positiveInteger(item.quantity, 'item.quantity'),
      occurredAtUtc: exact(input.occurredAtUtc, 'occurredAtUtc'),
      sourceEvidence: {
        boundary: 'appointment_billing_service_acceptance',
        provisionalItemId: item.id,
        appointmentId: input.appointmentId,
        visitId: input.visitId,
        patientId: input.patientId,
        doctorId: item.doctorId,
        sourcePublicId: item.canonicalSourceKey,
        quantity: item.quantity,
        unitAmountMinor: Math.round(item.unitPrice * 100),
        discountAmountMinor: Math.round(item.discountAmount * 100),
        lineAmountMinor: Math.round(item.lineTotal * 100),
        status: 'finalized',
      },
      participant: {
        practitionerPublicId,
        role: 'performing',
        evidenceType: 'legacy_consultation_doctor',
      },
      idempotencyKey: `appointment-billing-service:${input.appointmentId}:${item.id}`,
      businessDate: exact(input.businessDate, 'businessDate'),
      preparedService: consultationService.statements.length > 0 && !embeddedFinancial
        ? {
            servicePublicId: consultationService.servicePublicId,
            sourceEvidenceSha256: consultationService.sourceEvidenceSha256,
          }
        : null,
      authoritativeStatements: [
        ...(!embeddedFinancial ? financialStatements : []),
        ...(!embeddedFinancial ? consultationService.statements : []),
      ],
    });
    if (observedStatus && observedStatus !== prepared.status) {
      throw new Error('appointment service command receipts are partially committed');
    }
    observedStatus = prepared.status;
    if (prepared.status === 'prepared') {
      preparedStatements.push(...prepared.statements);
      embeddedFinancial = true;
    }
  }

  if (observedStatus === 'replayed') return [];
  return preparedStatements.length > 0 ? preparedStatements : financialStatements;
}

export function prepareAppointmentBillingLegacyStatements(
  db: D1Database,
  input: AppointmentLegacyFinalizationInput,
): D1PreparedStatement[] {
  const originalLegacyStatements = prepareAppointmentBillingOriginalLegacyStatements(db, input);
  Object.defineProperties(originalLegacyStatements, {
    strictAuthoritativeStatements: {
      value: () => prepareAppointmentBillingServiceStrictStatements(
        db as unknown as CanonicalBatchDatabase,
        input,
      ),
      enumerable: false,
      configurable: false,
      writable: false,
    },
    legacyPostCommit: {
      value: () => recordAppointmentLegacyPostCommitAccounting(db, input),
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
  return originalLegacyStatements;
}
