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

export interface ProvisionalBillingLegacyFinalizationItem {
  id: number;
  patientId: number;
  admissionId: number | null;
  visitId: number | null;
  itemCategory: string;
  description: string;
  department: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  doctorId: number | null;
  doctorName: string | null;
  referenceId: number | null;
}

export interface ProvisionalBillingLegacySchemeAllocation {
  allocationType: string;
  amount: number;
  referenceName: string | null;
  note: string;
  metadataJson: string;
}

export interface ProvisionalBillingLegacyFinalizationInput {
  tenantId: string;
  userId: string;
  patientId: number;
  visitId: number | null;
  invoiceNo: string;
  categoryTotals: BillCategoryTotals;
  subtotal: number;
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
  depositAdjustmentReceiptNo: string | null;
  depositDeducted: number;
  businessDate: string;
  items: readonly ProvisionalBillingLegacyFinalizationItem[];
  schemeAllocation?: ProvisionalBillingLegacySchemeAllocation | null;
  accountingExtraPayload?: Record<string, unknown>;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function sourceText(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} cannot be empty`);
  return value;
}

function optionalSourceText(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return sourceText(value, label);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function optionalPositiveInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positiveInteger(value, label);
}

function nonNegativeMoney(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

export function prepareProvisionalBillingOriginalLegacyStatements(
  db: D1Database,
  input: ProvisionalBillingLegacyFinalizationInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const billIdLookup = '(SELECT id FROM bills WHERE invoice_no = ? AND tenant_id = ? LIMIT 1)';

  statements.push(db.prepare(`
    INSERT INTO bills
      (patient_id, visit_id, invoice_no, test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill,
       discount, discount_by_name, total, paid, due, status, payment_method, remarks, tenant_id, created_by,
       counter_id, counter_session_id, created_at)
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

  if (input.schemeAllocation) {
    statements.push(db.prepare(`
      INSERT INTO bill_discount_allocations
        (tenant_id, bill_id, allocation_type, discount_reason, amount, reference_name, note, metadata_json, created_by)
      VALUES (?, ${billIdLookup}, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.invoiceNo,
      input.tenantId,
      input.schemeAllocation.allocationType,
      input.schemeAllocation.allocationType,
      input.schemeAllocation.amount,
      input.schemeAllocation.referenceName,
      input.schemeAllocation.note,
      input.schemeAllocation.metadataJson,
      input.userId,
    ));
  }

  for (const item of input.items) {
    statements.push(db.prepare(`
      INSERT INTO invoice_items
        (bill_id, item_category, description, quantity, unit_price, line_total, reference_id, tenant_id)
      VALUES (${billIdLookup}, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.invoiceNo,
      input.tenantId,
      item.itemCategory,
      item.description,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
      item.referenceId,
      input.tenantId,
    ));

    statements.push(db.prepare(`
      UPDATE billing_provisional_items
      SET bill_status = 'finalized',
          billed_bill_id = ${billIdLookup}
      WHERE id = ? AND tenant_id = ?
    `).bind(
      input.invoiceNo,
      input.tenantId,
      item.id,
      input.tenantId,
    ));
  }

  if (input.paymentReceiptNo && input.paid > 0) {
    statements.push(db.prepare(`
      INSERT INTO payments
        (bill_id, amount, payment_type, receipt_no, received_by, payment_method,
         counter_id, counter_session_id, tenant_id, date)
      VALUES (${billIdLookup}, ?, 'current', ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      input.invoiceNo,
      input.tenantId,
      input.paid,
      input.paymentReceiptNo,
      input.userId,
      input.paymentMethod,
      input.counterId,
      input.counterSessionId,
      input.tenantId,
    ));

    statements.push(db.prepare(`
      INSERT INTO emp_cash_transactions
        (tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount,
         reference_id, reference_type, payment_method, description)
      VALUES (?, ?, ?, ?, 'CashSales', ?, ${billIdLookup}, 'bill', ?, ?)
    `).bind(
      input.tenantId,
      input.userId,
      input.counterId,
      input.counterSessionId,
      input.paid,
      input.invoiceNo,
      input.tenantId,
      input.paymentMethod,
      `Provisional invoice payment ${input.paymentReceiptNo}`,
    ));
  }

  if (input.depositDeducted > 0 && input.depositAdjustmentReceiptNo) {
    statements.push(db.prepare(`
      INSERT INTO billing_deposits
        (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type,
         reference_bill_id, remarks, created_by, counter_id, counter_session_id)
      VALUES (?, ?, ?, ?, 'adjustment', ${billIdLookup}, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.patientId,
      input.depositAdjustmentReceiptNo,
      input.depositDeducted,
      input.invoiceNo,
      input.tenantId,
      `Deposit used for provisional invoice ${input.invoiceNo}`,
      input.userId,
      input.counterId,
      input.counterSessionId,
    ));
  }

  return statements;
}

export function prepareProvisionalBillingStrictStatements(
  db: D1Database,
  input: ProvisionalBillingLegacyFinalizationInput,
): D1PreparedStatement[] {
  const tenantId = exact(input.tenantId, 'tenantId');
  const userId = exact(input.userId, 'userId');
  const patientId = positiveInteger(input.patientId, 'patientId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const paymentMethod = exact(input.paymentMethod, 'paymentMethod');
  const counterId = positiveInteger(input.counterId, 'counterId');
  const counterSessionId = positiveInteger(input.counterSessionId, 'counterSessionId');
  const subtotal = nonNegativeMoney(input.subtotal, 'subtotal');
  const discount = nonNegativeMoney(input.discount, 'discount');
  const total = nonNegativeMoney(input.total, 'total');
  const paid = nonNegativeMoney(input.paid, 'paid');
  const due = nonNegativeMoney(input.due, 'due');
  const depositDeducted = nonNegativeMoney(input.depositDeducted, 'depositDeducted');
  const paymentReceiptNo = optionalExact(input.paymentReceiptNo, 'paymentReceiptNo');
  const depositAdjustmentReceiptNo = optionalExact(
    input.depositAdjustmentReceiptNo,
    'depositAdjustmentReceiptNo',
  );
  if (paid > 0 && !paymentReceiptNo) throw new TypeError('paymentReceiptNo is required when paid is positive');
  if (paid === 0 && paymentReceiptNo) throw new TypeError('paymentReceiptNo requires a positive paid amount');
  if (depositDeducted > 0 && !depositAdjustmentReceiptNo) {
    throw new TypeError('depositAdjustmentReceiptNo is required when depositDeducted is positive');
  }
  if (depositDeducted === 0 && depositAdjustmentReceiptNo) {
    throw new TypeError('depositAdjustmentReceiptNo requires a positive depositDeducted amount');
  }
  if (Math.round((paid + depositDeducted + due - total) * 100) !== 0) {
    throw new RangeError('paid, depositDeducted, due, and total do not reconcile');
  }
  if (input.items.length === 0) throw new RangeError('items cannot be empty');

  const operationKey = `provisional-billing:${patientId}:${invoiceNo}`;
  const statements: D1PreparedStatement[] = [];
  const billIdLookup = '(SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1)';
  const seenItemIds = new Set<number>();

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
      (patient_id, visit_id, invoice_no, test_bill, doctor_visit_bill, admission_bill,
       operation_bill, medicine_bill, discount, discount_by_name, total, paid, due,
       status, payment_method, remarks, tenant_id, created_by, counter_id,
       counter_session_id, created_at)
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
    discount,
    input.discountByName,
    total,
    paid,
    due,
    input.billStatus,
    paymentMethod,
    input.remarks,
    tenantId,
    userId,
    counterId,
    counterSessionId,
    tenantId,
    invoiceNo,
  ), 'bill_insert');

  for (const item of input.items) {
    const itemId = positiveInteger(item.id, 'item.id');
    if (seenItemIds.has(itemId)) throw new RangeError('duplicate provisional finalization item');
    seenItemIds.add(itemId);
    if (positiveInteger(item.patientId, 'item.patientId') !== patientId) {
      throw new Error('Provisional item patient mismatch');
    }
    const itemCategory = sourceText(item.itemCategory, 'item.itemCategory');
    const description = sourceText(item.description, 'item.description');
    const department = optionalSourceText(item.department, 'item.department');
    const admissionId = optionalPositiveInteger(item.admissionId, 'item.admissionId');
    const visitId = optionalPositiveInteger(item.visitId, 'item.visitId');
    const quantity = positiveInteger(item.quantity, 'item.quantity');
    const unitPrice = nonNegativeMoney(item.unitPrice, 'item.unitPrice');
    const discountAmount = nonNegativeMoney(item.discountAmount, 'item.discountAmount');
    const lineTotal = nonNegativeMoney(item.lineTotal, 'item.lineTotal');
    const doctorId = optionalPositiveInteger(item.doctorId, 'item.doctorId');
    const doctorName = optionalSourceText(item.doctorName, 'item.doctorName');
    const referenceId = optionalPositiveInteger(item.referenceId, 'item.referenceId');

    pushAsserted(db.prepare(`
      INSERT INTO invoice_items
        (bill_id, item_category, description, quantity, unit_price, line_total,
         reference_id, tenant_id, created_at)
      SELECT ${billIdLookup}, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id = ? AND invoice_no = ?)
    `).bind(
      tenantId,
      invoiceNo,
      itemCategory,
      description,
      quantity,
      unitPrice,
      lineTotal,
      referenceId,
      tenantId,
      tenantId,
      invoiceNo,
    ), `invoice_item_${itemId}`);

    pushAsserted(db.prepare(`
      UPDATE billing_provisional_items
      SET bill_status='finalized',
          billed_bill_id=${billIdLookup}
      WHERE id=? AND tenant_id=? AND patient_id=?
        AND COALESCE(admission_id,0)=COALESCE(?,0)
        AND COALESCE(visit_id,0)=COALESCE(?,0)
        AND item_category=? AND item_name=?
        AND COALESCE(department,'')=COALESCE(?,'')
        AND unit_price=? AND quantity=?
        AND COALESCE(discount_amount,0)=? AND total_amount=?
        AND COALESCE(doctor_id,0)=COALESCE(?,0)
        AND COALESCE(doctor_name,'')=COALESCE(?,'')
        AND COALESCE(reference_id,0)=COALESCE(?,0)
        AND bill_status='provisional'
        AND COALESCE(is_active,1)=1
        AND EXISTS (SELECT 1 FROM bills WHERE tenant_id=? AND invoice_no=?)
    `).bind(
      tenantId,
      invoiceNo,
      itemId,
      tenantId,
      patientId,
      admissionId,
      visitId,
      itemCategory,
      description,
      department,
      unitPrice,
      quantity,
      discountAmount,
      lineTotal,
      doctorId,
      doctorName,
      referenceId,
      tenantId,
      invoiceNo,
    ), `provisional_item_${itemId}`);
  }

  if (input.schemeAllocation) {
    pushAsserted(db.prepare(`
      INSERT INTO bill_discount_allocations
        (tenant_id,bill_id,allocation_type,discount_reason,amount,reference_name,
         note,metadata_json,created_by)
      SELECT ?,b.id,?,?,?,?,?,?,?
      FROM bills b
      WHERE b.tenant_id=? AND b.invoice_no=?
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

  if (paymentReceiptNo) {
    pushAsserted(db.prepare(`
      INSERT INTO payments
        (bill_id,amount,payment_type,receipt_no,received_by,payment_method,
         counter_id,counter_session_id,tenant_id,date)
      SELECT ${billIdLookup},?,'current',?,?,?,?,?,?,datetime('now', '+6 hours')
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id=? AND invoice_no=?)
        AND NOT EXISTS (SELECT 1 FROM payments WHERE tenant_id=? AND receipt_no=?)
    `).bind(
      tenantId,
      invoiceNo,
      paid,
      paymentReceiptNo,
      userId,
      paymentMethod,
      counterId,
      counterSessionId,
      tenantId,
      tenantId,
      invoiceNo,
      tenantId,
      paymentReceiptNo,
    ), 'payment_insert');

    pushAsserted(db.prepare(`
      INSERT INTO emp_cash_transactions
        (tenant_id,employee_id,counter_id,counter_session_id,transaction_type,amount,
         reference_id,reference_type,payment_method,description)
      SELECT ?,?,?,?,'CashSales',?,${billIdLookup},'bill',?,?
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id=? AND invoice_no=?)
    `).bind(
      tenantId,
      userId,
      counterId,
      counterSessionId,
      paid,
      tenantId,
      invoiceNo,
      paymentMethod,
      `Provisional invoice payment ${paymentReceiptNo}`,
      tenantId,
      invoiceNo,
    ), 'cash_transaction');
  }

  if (depositAdjustmentReceiptNo) {
    pushAsserted(db.prepare(`
      INSERT INTO billing_deposits
        (tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,
         reference_bill_id,remarks,created_by,counter_id,counter_session_id)
      SELECT ?,?,?,?,'adjustment',${billIdLookup},?,?,?,?
      WHERE EXISTS (SELECT 1 FROM bills WHERE tenant_id=? AND invoice_no=?)
        AND NOT EXISTS (
          SELECT 1 FROM billing_deposits WHERE tenant_id=? AND deposit_receipt_no=?
        )
    `).bind(
      tenantId,
      patientId,
      depositAdjustmentReceiptNo,
      depositDeducted,
      tenantId,
      invoiceNo,
      `Deposit used for provisional invoice ${invoiceNo}`,
      userId,
      counterId,
      counterSessionId,
      tenantId,
      invoiceNo,
      tenantId,
      depositAdjustmentReceiptNo,
    ), 'deposit_adjustment_insert');
  }

  const billPayload = buildBillCreatedAccountingPayload({
    tenantId,
    userId,
    patientId,
    visitId: input.visitId,
    billId: 0,
    invoiceNo,
    billDate: input.businessDate,
    subtotal,
    discount,
    total,
    categoryTotals: input.categoryTotals,
    counterId,
    counterSessionId,
    extraPayload: input.accountingExtraPayload,
    items: [],
  });
  pushAsserted(db.prepare(`
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id,source_event_key,source_type,source_id,event_type,event_date,
       payload_json,created_by)
    SELECT ?,'billing:' || CAST(b.id AS TEXT) || ':' || ?,'billing',b.id,?,?,
           json_set(?,'$.billId',b.id),?
    FROM bills b
    WHERE b.tenant_id=? AND b.invoice_no=?
  `).bind(
    tenantId,
    ACCOUNTING_EVENT_TYPES.billCreated,
    ACCOUNTING_EVENT_TYPES.billCreated,
    input.businessDate,
    JSON.stringify(billPayload),
    userId,
    tenantId,
    invoiceNo,
  ), 'bill_created_accounting_event');

  if (paymentReceiptNo) {
    const paymentPayload = {
      billId: 0,
      receiptNo: paymentReceiptNo,
      patientId,
      amount: paid,
      paymentMethod,
      paymentType: 'current',
      counterId,
      counterSessionId,
    };
    pushAsserted(db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id,source_event_key,source_type,source_id,event_type,event_date,
         payload_json,created_by)
      SELECT ?,?,'payment',?,?,?,json_set(?,'$.billId',b.id),?
      FROM bills b
      WHERE b.tenant_id=? AND b.invoice_no=?
    `).bind(
      tenantId,
      createPostingEventKey('payment', paymentReceiptNo, ACCOUNTING_EVENT_TYPES.paymentReceived),
      paymentReceiptNo,
      ACCOUNTING_EVENT_TYPES.paymentReceived,
      input.businessDate,
      JSON.stringify(paymentPayload),
      userId,
      tenantId,
      invoiceNo,
    ), 'payment_accounting_event');
  }

  if (depositAdjustmentReceiptNo) {
    const depositPayload = {
      billId: 0,
      receiptNo: depositAdjustmentReceiptNo,
      patientId,
      amount: depositDeducted,
      counterId,
      counterSessionId,
    };
    pushAsserted(db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id,source_event_key,source_type,source_id,event_type,event_date,
         payload_json,created_by)
      SELECT ?,?,'patient_deposit_adjustment',?,?,?,json_set(?,'$.billId',b.id),?
      FROM bills b
      WHERE b.tenant_id=? AND b.invoice_no=?
    `).bind(
      tenantId,
      createPostingEventKey(
        'patient_deposit_adjustment',
        depositAdjustmentReceiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      ),
      depositAdjustmentReceiptNo,
      ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      input.businessDate,
      JSON.stringify(depositPayload),
      userId,
      tenantId,
      invoiceNo,
    ), 'deposit_accounting_event');
  }

  statements.push(prepareClearFinancialBatchAssertions(db, tenantId, operationKey));
  return statements;
}

async function recordProvisionalLegacyPostCommitAccounting(
  db: D1Database,
  input: ProvisionalBillingLegacyFinalizationInput,
): Promise<void> {
  const bill = await db.prepare(
    'SELECT id FROM bills WHERE invoice_no = ? AND tenant_id = ? LIMIT 1',
  ).bind(input.invoiceNo, input.tenantId).first<{ id?: number | string | null }>();
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
        subtotal: input.subtotal,
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
        counterId: input.counterId,
        counterSessionId: input.counterSessionId,
      },
    }));
  }

  if (input.depositAdjustmentReceiptNo && input.depositDeducted > 0) {
    sideEffects.push(recordAccountingPostingEvent(db, {
      tenantId: input.tenantId,
      sourceType: 'patient_deposit_adjustment',
      sourceId: input.depositAdjustmentReceiptNo,
      eventType: ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      eventDate: input.businessDate,
      createdBy: input.userId,
      payload: {
        billId,
        receiptNo: input.depositAdjustmentReceiptNo,
        patientId: input.patientId,
        amount: input.depositDeducted,
        counterId: input.counterId,
        counterSessionId: input.counterSessionId,
      },
    }));
  }

  await Promise.all(sideEffects);
}

export function prepareProvisionalBillingLegacyStatements(
  db: D1Database,
  input: ProvisionalBillingLegacyFinalizationInput,
): D1PreparedStatement[] {
  const originalLegacyStatements = prepareProvisionalBillingOriginalLegacyStatements(db, input);
  Object.defineProperties(originalLegacyStatements, {
    strictAuthoritativeStatements: {
      value: () => prepareProvisionalBillingStrictStatements(db, input),
      enumerable: false,
      configurable: false,
      writable: false,
    },
    legacyPostCommit: {
      value: () => recordProvisionalLegacyPostCommitAccounting(db, input),
      enumerable: false,
      configurable: false,
      writable: false,
    },
  });
  return originalLegacyStatements;
}
