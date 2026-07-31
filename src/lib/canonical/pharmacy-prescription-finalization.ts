import type { CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';
import {
  PharmacyFinalizationError,
  type PharmacyProvisionalDatabase,
} from './pharmacy-provisional-finalization';
import { hydratePharmacySaleCanonicalAuthority } from './pharmacy-sale-authority';
import {
  pharmacyMinorSettlement,
  positivePharmacyQuantity,
  type PharmacyPaymentMode,
  type PharmacySaleContext,
  type PharmacySaleItemContext,
} from './pharmacy-sale-types';

export interface PharmacyStockSelection {
  itemId: number;
  stockId: number;
  quantity: number;
}

export interface PharmacyPrescriptionFinalizationDependencies {
  nextInvoiceNo(): Promise<string>;
  hydrateCanonicalAuthority?(context: PharmacySaleContext): Promise<PharmacySaleContext>;
}

export interface PharmacyPrescriptionFinalizationInput {
  tenantId: string;
  userId: number;
  prescriptionId: number;
  businessDate: string;
  occurredAtUtc: string;
  paymentMode: PharmacyPaymentMode;
  externalTransactionId: string | null;
  paidAmount: number;
  creditAmount: number;
  depositDeductAmount: number;
  tender: number;
  discountAmount: number;
  remarks: string | null;
  stockSelections: readonly PharmacyStockSelection[] | null;
  dependencies: PharmacyPrescriptionFinalizationDependencies;
}

interface PrescriptionRow {
  id: number;
  patient_id: number;
  patient_visit_id: number | null;
  prescriber_id: number | null;
  status: string;
}

interface PrescriptionItemRow {
  id: number;
  item_id: number;
  quantity: number;
  item_name: string | null;
}

interface StockRow {
  id: number;
  item_id?: number;
  batch_no: string;
  mrp: number;
  sale_price: number;
  cost_price: number | null;
  available_qty: number;
  expiry_date?: string | null;
}

interface MutationResult {
  meta?: {
    rows_written?: number;
    changes?: number;
    last_row_id?: number | string | bigint | null;
  };
}

function fail(status: number, message: string): never {
  throw new PharmacyFinalizationError(status, message);
}

function rowsWritten(result: unknown): number {
  const meta = (result as MutationResult | undefined)?.meta;
  return Number(meta?.rows_written ?? meta?.changes ?? 0);
}

function committedId(result: unknown, label: string): number {
  const id = Number((result as MutationResult | undefined)?.meta?.last_row_id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} did not return a committed id`);
  return id;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function invoiceStatus(context: PharmacySaleContext): 'paid' | 'credit' {
  return context.creditAmount > 0 ? 'credit' : 'paid';
}

async function loadPrescription(
  db: PharmacyProvisionalDatabase,
  input: PharmacyPrescriptionFinalizationInput,
): Promise<PrescriptionRow> {
  const row = await db.prepare(`
    SELECT * FROM pharmacy_prescriptions WHERE id = ? AND tenant_id = ?
  `).bind(input.prescriptionId, input.tenantId).first<PrescriptionRow>();
  if (!row) fail(404, 'Prescription not found');
  if (row.status === 'dispensed') fail(400, 'Prescription already dispensed');
  if (row.status === 'cancelled') fail(400, 'Cannot dispense a cancelled prescription');
  return row;
}

async function loadPrescriptionItems(
  db: PharmacyProvisionalDatabase,
  input: PharmacyPrescriptionFinalizationInput,
): Promise<PrescriptionItemRow[]> {
  const { results } = await db.prepare(`
    SELECT * FROM pharmacy_prescription_items WHERE prescription_id = ? AND tenant_id = ?
  `).bind(input.prescriptionId, input.tenantId).all<PrescriptionItemRow>();
  if (!results.length) fail(400, 'No items in prescription');
  return results;
}

async function legacyDepositBalance(
  db: PharmacyProvisionalDatabase,
  tenantId: string,
  patientId: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN transaction_type='deposit' THEN amount
        WHEN transaction_type='refund' THEN -amount
        WHEN transaction_type='adjustment' THEN -amount
        ELSE 0
      END
    ),0) AS balance
    FROM billing_deposits WHERE patient_id=? AND tenant_id=?
  `).bind(patientId, tenantId).first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function resolveStockRows(
  db: PharmacyProvisionalDatabase,
  input: PharmacyPrescriptionFinalizationInput,
  rows: readonly PrescriptionItemRow[],
  strict: boolean,
): Promise<Array<{ source: PrescriptionItemRow; stock: StockRow; quantity: number }>> {
  const selections = new Map<number, PharmacyStockSelection>();
  for (const selection of input.stockSelections ?? []) {
    selections.set(selection.itemId, selection);
  }
  const resolved: Array<{ source: PrescriptionItemRow; stock: StockRow; quantity: number }> = [];
  for (const row of rows) {
    if (strict) positivePharmacyQuantity(row.quantity, `Prescription item ${row.item_id} quantity`);
    const selection = selections.get(row.item_id);
    if (selection) {
      if (selection.quantity !== row.quantity) {
        fail(400, `Selection quantity (${selection.quantity}) must match prescribed quantity (${row.quantity}) for item ${row.item_id}`);
      }
      if (strict) positivePharmacyQuantity(selection.quantity, `Stock selection ${row.item_id} quantity`);
      const stock = await db.prepare(`
        SELECT id,item_id,batch_no,mrp,sale_price,cost_price,available_qty,expiry_date
        FROM pharmacy_stock
        WHERE id=? AND tenant_id=? AND is_active=1
      `).bind(selection.stockId, input.tenantId).first<StockRow>();
      if (!stock) fail(400, `Stock ${selection.stockId} not found`);
      if (strict && Number(stock.item_id) !== row.item_id) {
        throw new Error(`Strict pharmacy stock ${selection.stockId} does not belong to item ${row.item_id}`);
      }
      if (stock.available_qty < selection.quantity) {
        fail(400, `Insufficient stock ${selection.stockId}. Available: ${stock.available_qty}`);
      }
      if (strict && stock.expiry_date && stock.expiry_date <= input.businessDate) {
        throw new Error(`Strict pharmacy stock ${selection.stockId} is expired`);
      }
      resolved.push({ source: row, stock, quantity: selection.quantity });
      continue;
    }

    const { results } = await db.prepare(`
      SELECT id,item_id,batch_no,mrp,sale_price,cost_price,available_qty,expiry_date
      FROM pharmacy_stock
      WHERE item_id=? AND tenant_id=? AND is_active=1 AND available_qty>=?
        AND (expiry_date IS NULL OR expiry_date>date('now','+6 hours'))
      ORDER BY expiry_date ASC,id ASC LIMIT 1
    `).bind(row.item_id, input.tenantId, row.quantity).all<StockRow>();
    if (!results.length) {
      fail(400, `No stock available for item ${row.item_id} (${row.item_name})`);
    }
    const stock = results[0];
    if (strict && stock.expiry_date && stock.expiry_date <= input.businessDate) {
      throw new Error(`Strict pharmacy stock ${stock.id} is expired`);
    }
    resolved.push({ source: row, stock, quantity: row.quantity });
  }
  return resolved;
}

function buildItems(
  resolved: readonly { source: PrescriptionItemRow; stock: StockRow; quantity: number }[],
  strict: boolean,
): PharmacySaleItemContext[] {
  const balances = new Map<number, number>();
  const duplicates = new Map<string, number>();
  return resolved.map(({ source, stock, quantity }, index) => {
    const before = balances.get(stock.id) ?? Number(stock.available_qty);
    if (strict && before < quantity) {
      throw new Error(`Strict pharmacy stock ${stock.id} is insufficient for cumulative prescription quantity`);
    }
    balances.set(stock.id, before - quantity);
    const duplicateKey = `${source.item_id}:${stock.id}`;
    const duplicateOrdinal = duplicates.get(duplicateKey) ?? 0;
    duplicates.set(duplicateKey, duplicateOrdinal + 1);
    const total = quantity * Number(stock.sale_price);
    return {
      lineNumber: index + 1,
      duplicateOrdinal,
      sourceItemId: source.id,
      pharmacyItemId: source.item_id,
      stockId: stock.id,
      itemName: source.item_name?.trim() || `Pharmacy item ${source.item_id}`,
      batchNo: stock.batch_no,
      expiryDate: stock.expiry_date ?? null,
      sourceUnitCode: null,
      quantity,
      mrp: Number(stock.mrp),
      price: Number(stock.sale_price),
      salePrice: Number(stock.sale_price),
      discountPct: 0,
      vatPct: 0,
      subtotal: total,
      total,
      costPrice: Number(stock.cost_price ?? 0),
      legacyAvailableBefore: before,
      canonical: null,
    };
  });
}

function baseContext(
  input: PharmacyPrescriptionFinalizationInput,
  prescription: PrescriptionRow,
  items: readonly PharmacySaleItemContext[],
  invoiceNo: string,
): PharmacySaleContext {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
  const total = roundMoney(subtotal - input.discountAmount);
  const covered = roundMoney(input.paidAmount + input.creditAmount + input.depositDeductAmount);
  if (covered !== total) {
    fail(400, 'Payment split (paid + credit + deposit) must equal total amount');
  }
  if (input.paymentMode === 'cash' && input.paidAmount > 0 && input.tender < input.paidAmount) {
    fail(400, `Cash tender (${input.tender}) must be >= cash paid amount (${input.paidAmount})`);
  }
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    patientId: prescription.patient_id,
    patientVisitId: prescription.patient_visit_id ?? null,
    prescriberId: prescription.prescriber_id,
    counterId: null,
    sourceKind: 'prescription_dispense',
    sourceDocumentId: input.prescriptionId,
    invoiceNo,
    businessDate: input.businessDate,
    occurredAtUtc: input.occurredAtUtc,
    paymentMode: input.paymentMode,
    externalTransactionId: input.externalTransactionId,
    tender: input.tender,
    subtotal,
    sourceDiscountPct: 0,
    discountAmount: input.discountAmount,
    total,
    paidAmount: input.paidAmount,
    creditAmount: input.creditAmount,
    depositDeductAmount: input.depositDeductAmount,
    remarks: input.remarks,
    items,
  };
}

export async function executePharmacyPrescriptionOriginalLegacy(
  db: PharmacyProvisionalDatabase,
  input: PharmacyPrescriptionFinalizationInput,
): Promise<{ context: PharmacySaleContext; invoiceId: number }> {
  const prescription = await loadPrescription(db, input);
  const sourceItems = await loadPrescriptionItems(db, input);
  const resolved = await resolveStockRows(db, input, sourceItems, false);
  const items = buildItems(resolved, false);
  const preview = baseContext(input, prescription, items, 'PENDING');
  if (input.depositDeductAmount > 0) {
    const balance = await legacyDepositBalance(db, input.tenantId, prescription.patient_id);
    if (balance < input.depositDeductAmount) {
      fail(400, `Insufficient deposit balance. Available: ${balance}, Requested: ${input.depositDeductAmount}`);
    }
  }

  const deducted: Array<{ stockId: number; quantity: number }> = [];
  let invoiceId: number | null = null;
  let depositReceiptNo: string | null = null;
  try {
    for (const item of items) {
      const result = await db.prepare(
        `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND available_qty >= ?`,
      ).bind(item.quantity, item.stockId, input.tenantId, item.quantity).run();
      if (rowsWritten(result) === 0) {
        fail(409, `Stock depleted for item ${item.pharmacyItemId} (concurrent sale). Please retry.`);
      }
      deducted.push({ stockId: item.stockId!, quantity: item.quantity });
    }

    const invoiceNo = await input.dependencies.nextInvoiceNo();
    const context = { ...preview, invoiceNo };
    const result = await db.prepare(`
      INSERT INTO pharmacy_invoices
        (invoice_no,patient_id,prescriber_id,subtotal,discount_amount,total_amount,
         paid_amount,credit_amount,tender,change_amount,payment_mode,deposit_deduct_amount,
         status,paid_date,remarks,tenant_id,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      context.invoiceNo,
      context.patientId,
      context.prescriberId,
      context.subtotal,
      context.discountAmount,
      context.total,
      context.paidAmount,
      context.creditAmount,
      context.tender,
      Math.max(0, context.tender - context.paidAmount),
      context.paymentMode,
      context.depositDeductAmount,
      invoiceStatus(context),
      context.paidAmount > 0 || context.depositDeductAmount > 0 ? context.businessDate : null,
      context.remarks,
      context.tenantId,
      context.userId,
    ).run();
    invoiceId = committedId(result, 'Pharmacy invoice');

    const batch: CanonicalPreparedStatement[] = [];
    for (const item of items) {
      batch.push(
        db.prepare(`
          INSERT INTO pharmacy_invoice_items
            (invoice_id,item_id,stock_id,batch_no,quantity,mrp,price,subtotal,total_amount,tenant_id,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          invoiceId,
          item.pharmacyItemId,
          item.stockId,
          item.batchNo,
          item.quantity,
          item.mrp,
          item.price,
          item.subtotal,
          item.total,
          context.tenantId,
          context.userId,
        ),
        db.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (item_id,stock_id,transaction_type,reference_type,reference_id,batch_no,
             out_qty,price,tenant_id,created_by)
          VALUES (?,?,'sale_out','invoice',?,?,?,?,?,?)
        `).bind(
          item.pharmacyItemId,
          item.stockId,
          invoiceId,
          item.batchNo,
          item.quantity,
          item.price,
          context.tenantId,
          context.userId,
        ),
      );
    }

    if (context.depositDeductAmount > 0) {
      depositReceiptNo = `${context.invoiceNo}-DEP`;
      const deposit = await db.prepare(`
        INSERT INTO billing_deposits
          (tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,
           reference_bill_id,remarks,created_by,counter_id,counter_session_id)
        SELECT ?,?,?,?,'adjustment',?,'Pharmacy dispense deposit deduction',?,NULL,NULL
        WHERE (
          SELECT COALESCE(SUM(
            CASE
              WHEN transaction_type='deposit' THEN amount
              WHEN transaction_type='refund' THEN -amount
              WHEN transaction_type='adjustment' THEN -amount
              ELSE 0
            END
          ),0)
          FROM billing_deposits WHERE patient_id=? AND tenant_id=?
        )>=?
      `).bind(
        context.tenantId,
        context.patientId,
        depositReceiptNo,
        context.depositDeductAmount,
        invoiceId,
        context.userId,
        context.patientId,
        context.tenantId,
        context.depositDeductAmount,
      ).run();
      if (rowsWritten(deposit) === 0) {
        fail(409, 'Insufficient deposit balance (concurrent deduction). Please retry.');
      }
    }

    batch.push(db.prepare(`
      UPDATE pharmacy_prescriptions
      SET status='dispensed',updated_at=datetime('now','+6 hours')
      WHERE id=? AND tenant_id=?
    `).bind(input.prescriptionId, input.tenantId));
    await db.batch(batch);
    return { context, invoiceId };
  } catch (error) {
    for (const stock of deducted) {
      await db.prepare(
        `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
      ).bind(stock.quantity, stock.stockId, input.tenantId).run();
    }
    if (depositReceiptNo != null) {
      await db.prepare(`
        DELETE FROM billing_deposits
        WHERE tenant_id=? AND patient_id=? AND deposit_receipt_no=?
          AND transaction_type='adjustment'
      `).bind(input.tenantId, prescription.patient_id, depositReceiptNo).run();
    }
    if (invoiceId != null) {
      await db.prepare(`DELETE FROM pharmacy_invoices WHERE id=? AND tenant_id=?`)
        .bind(invoiceId, input.tenantId).run();
    }
    throw error;
  }
}

export async function preparePharmacyPrescriptionStrictContext(
  db: PharmacyProvisionalDatabase,
  input: PharmacyPrescriptionFinalizationInput,
): Promise<PharmacySaleContext> {
  const prescription = await loadPrescription(db, input);
  const sourceItems = await loadPrescriptionItems(db, input);
  for (const item of sourceItems) {
    positivePharmacyQuantity(item.quantity, `Prescription item ${item.item_id} quantity`);
  }
  const resolved = await resolveStockRows(db, input, sourceItems, true);
  const items = buildItems(resolved, true);
  let context = baseContext(input, prescription, items, 'PENDING');
  pharmacyMinorSettlement(context);
  if (context.paidAmount > 0 && context.paymentMode !== 'cash' && !context.externalTransactionId) {
    throw new Error('Strict non-cash pharmacy payment requires external transaction authority');
  }
  if (context.depositDeductAmount > 0) {
    const legacy = await legacyDepositBalance(db, input.tenantId, prescription.patient_id);
    if (legacy < context.depositDeductAmount) {
      throw new Error('Strict legacy pharmacy deposit balance is insufficient');
    }
    const canonical = await db.prepare(`
      SELECT COALESCE(SUM(available_minor),0) AS balance
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND currency_code='BDT'
        AND status='posted' AND available_minor>0
    `).bind(input.tenantId, prescription.patient_id).first<{ balance: number }>();
    if (Number(canonical?.balance ?? 0) < pharmacyMinorSettlement(context).depositMinor) {
      throw new Error('Strict canonical pharmacy deposit balance is insufficient');
    }
  }
  context = input.dependencies.hydrateCanonicalAuthority
    ? await input.dependencies.hydrateCanonicalAuthority(context)
    : await hydratePharmacySaleCanonicalAuthority(db, context);
  for (const item of context.items) {
    if (!item.canonical || !item.sourceUnitCode || item.stockId == null) {
      throw new Error(`Strict canonical pharmacy authority is incomplete for item ${item.pharmacyItemId}`);
    }
  }
  const invoiceNo = await input.dependencies.nextInvoiceNo();
  return { ...context, invoiceNo };
}

export function preparePharmacyPrescriptionStrictStatements(
  db: Pick<PharmacyProvisionalDatabase, 'prepare'>,
  context: PharmacySaleContext,
): readonly CanonicalPreparedStatement[] {
  if (context.sourceKind !== 'prescription_dispense') {
    throw new Error('Prescription strict statements require a prescription dispense context');
  }
  const operationKey = `pharmacy-prescription:${context.sourceDocumentId}:${context.invoiceNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const critical = (statement: CanonicalPreparedStatement, stepKey: string) => {
    statements.push(statement, prepareFinancialBatchAssertion(db, {
      tenantId: context.tenantId,
      operationKey,
      stepKey,
      expectedChanges: 1,
    }));
  };

  critical(db.prepare(`
    UPDATE pharmacy_prescriptions SET updated_at=updated_at
    WHERE id=? AND tenant_id=? AND status NOT IN ('dispensed','cancelled')
  `).bind(context.sourceDocumentId, context.tenantId), 'status-guard');

  for (const item of context.items) {
    if (item.stockId == null) throw new Error('Strict prescription item requires stock identity');
    critical(db.prepare(`
      UPDATE pharmacy_stock
      SET available_qty=available_qty-?,updated_at=datetime('now','+6 hours')
      WHERE id=? AND item_id=? AND tenant_id=? AND is_active=1
        AND available_qty=? AND available_qty>=?
    `).bind(
      item.quantity,
      item.stockId,
      item.pharmacyItemId,
      context.tenantId,
      item.legacyAvailableBefore,
      item.quantity,
    ), `stock-${item.lineNumber}`);
  }

  critical(db.prepare(`
    INSERT INTO pharmacy_invoices
      (invoice_no,patient_id,prescriber_id,subtotal,discount_amount,total_amount,
       paid_amount,credit_amount,tender,change_amount,payment_mode,deposit_deduct_amount,
       status,paid_date,remarks,tenant_id,created_by)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    FROM pharmacy_prescriptions p
    WHERE p.id=? AND p.tenant_id=? AND p.status NOT IN ('dispensed','cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM pharmacy_invoices i WHERE i.tenant_id=? AND i.invoice_no=?
      )
  `).bind(
    context.invoiceNo,
    context.patientId,
    context.prescriberId,
    context.subtotal,
    context.discountAmount,
    context.total,
    context.paidAmount,
    context.creditAmount,
    context.tender,
    Math.max(0, context.tender - context.paidAmount),
    context.paymentMode,
    context.depositDeductAmount,
    invoiceStatus(context),
    context.paidAmount > 0 || context.depositDeductAmount > 0 ? context.businessDate : null,
    context.remarks,
    context.tenantId,
    context.userId,
    context.sourceDocumentId,
    context.tenantId,
    context.tenantId,
    context.invoiceNo,
  ), 'invoice');

  for (const item of context.items) {
    critical(db.prepare(`
      INSERT INTO pharmacy_invoice_items
        (invoice_id,item_id,stock_id,batch_no,quantity,mrp,price,subtotal,total_amount,tenant_id,created_by)
      SELECT i.id,?,?,?,?,?,?,?,?,?,?
      FROM pharmacy_invoices i WHERE i.tenant_id=? AND i.invoice_no=?
    `).bind(
      item.pharmacyItemId,
      item.stockId,
      item.batchNo,
      item.quantity,
      item.mrp,
      item.price,
      item.subtotal,
      item.total,
      context.tenantId,
      context.userId,
      context.tenantId,
      context.invoiceNo,
    ), `invoice-item-${item.lineNumber}`);
    critical(db.prepare(`
      INSERT INTO pharmacy_stock_transactions
        (item_id,stock_id,transaction_type,reference_type,reference_id,batch_no,
         out_qty,price,tenant_id,created_by)
      SELECT ?,?,'sale_out','invoice',i.id,?,?,?,?,?
      FROM pharmacy_invoices i WHERE i.tenant_id=? AND i.invoice_no=?
    `).bind(
      item.pharmacyItemId,
      item.stockId,
      item.batchNo,
      item.quantity,
      item.price,
      context.tenantId,
      context.userId,
      context.tenantId,
      context.invoiceNo,
    ), `stock-transaction-${item.lineNumber}`);
  }

  if (context.depositDeductAmount > 0) {
    critical(db.prepare(`
      INSERT INTO billing_deposits
        (tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,
         reference_bill_id,remarks,created_by,counter_id,counter_session_id)
      SELECT ?,?,?,?,'adjustment',i.id,'Pharmacy dispense deposit deduction',?,NULL,NULL
      FROM pharmacy_invoices i
      WHERE i.tenant_id=? AND i.invoice_no=?
        AND (
          SELECT COALESCE(SUM(
            CASE
              WHEN transaction_type='deposit' THEN amount
              WHEN transaction_type='refund' THEN -amount
              WHEN transaction_type='adjustment' THEN -amount
              ELSE 0
            END
          ),0)
          FROM billing_deposits WHERE patient_id=? AND tenant_id=?
        )>=?
    `).bind(
      context.tenantId,
      context.patientId,
      `${context.invoiceNo}-DEP`,
      context.depositDeductAmount,
      context.userId,
      context.tenantId,
      context.invoiceNo,
      context.patientId,
      context.tenantId,
      context.depositDeductAmount,
    ), 'deposit');
  }

  critical(db.prepare(`
    UPDATE pharmacy_prescriptions
    SET status='dispensed',updated_at=datetime('now','+6 hours')
    WHERE id=? AND tenant_id=? AND status NOT IN ('dispensed','cancelled')
  `).bind(context.sourceDocumentId, context.tenantId), 'dispensed');
  statements.push(prepareClearFinancialBatchAssertions(db, context.tenantId, operationKey));
  return statements;
}
