import type { CanonicalPreparedStatement } from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';
import { hydratePharmacySaleCanonicalAuthority } from './pharmacy-sale-authority';
import {
  pharmacyMinorSettlement,
  positivePharmacyQuantity,
  type PharmacyPaymentMode,
  type PharmacySaleContext,
  type PharmacySaleItemContext,
} from './pharmacy-sale-types';

interface LegacyStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): LegacyStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PharmacyProvisionalDatabase {
  prepare(sql: string): LegacyStatement;
  batch(statements: readonly CanonicalPreparedStatement[]): Promise<readonly unknown[]>;
}

export class PharmacyFinalizationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PharmacyFinalizationError';
  }
}

export interface PharmacyProvisionalFinalizationDependencies {
  nextInvoiceNo(): Promise<string>;
  hydrateCanonicalAuthority?(context: PharmacySaleContext): Promise<PharmacySaleContext>;
}

export interface PharmacyProvisionalFinalizationInput {
  tenantId: string;
  userId: number;
  provisionalId: number;
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
  dependencies: PharmacyProvisionalFinalizationDependencies;
}

interface ProvisionalRow {
  id: number;
  patient_id: number;
  patient_visit_id: number | null;
  prescriber_id: number | null;
  total_amount: number;
  discount_pct: number;
  counter_id: number | null;
}

interface ProvisionalItemRow {
  id: number;
  item_id: number;
  stock_id: number | null;
  batch_no: string | null;
  expiry_date: string | null;
  quantity: number;
  price: number;
  sale_price: number;
  discount_pct: number;
  vat_pct: number;
  total_amount: number;
}

interface StockRow {
  item_id?: number;
  available_qty: number;
  cost_price: number | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  item_name?: string | null;
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

async function loadActiveProvisional(
  db: PharmacyProvisionalDatabase,
  input: PharmacyProvisionalFinalizationInput,
): Promise<ProvisionalRow> {
  const row = await db.prepare(`
    SELECT * FROM pharmacy_provisional_invoices
    WHERE id = ? AND tenant_id = ? AND status = 'active' AND is_active = 1
  `).bind(input.provisionalId, input.tenantId).first<ProvisionalRow>();
  if (!row) fail(404, 'Active provisional invoice not found');
  return row;
}

async function loadProvisionalItems(
  db: PharmacyProvisionalDatabase,
  input: PharmacyProvisionalFinalizationInput,
): Promise<ProvisionalItemRow[]> {
  const { results } = await db.prepare(`
    SELECT * FROM pharmacy_provisional_items WHERE provisional_id = ? AND tenant_id = ?
  `).bind(input.provisionalId, input.tenantId).all<ProvisionalItemRow>();
  if (!results.length) fail(400, 'No items in provisional invoice');
  return results;
}

async function loadStock(
  db: PharmacyProvisionalDatabase,
  tenantId: string,
  item: ProvisionalItemRow,
): Promise<StockRow | null> {
  if (item.stock_id == null) return null;
  return db.prepare(`
    SELECT item_id, available_qty, cost_price, batch_no, expiry_date
    FROM pharmacy_stock
    WHERE id = ? AND tenant_id = ? AND is_active = 1
  `).bind(item.stock_id, tenantId).first<StockRow>();
}

async function legacyDepositBalance(
  db: PharmacyProvisionalDatabase,
  tenantId: string,
  patientId: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN transaction_type = 'deposit' THEN amount
        WHEN transaction_type = 'refund' THEN -amount
        WHEN transaction_type = 'adjustment' THEN -amount
        ELSE 0
      END
    ), 0) AS balance
    FROM billing_deposits WHERE patient_id = ? AND tenant_id = ?
  `).bind(patientId, tenantId).first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

function validatePayment(
  input: PharmacyProvisionalFinalizationInput,
  total: number,
): void {
  const covered = roundMoney(input.paidAmount + input.creditAmount + input.depositDeductAmount);
  if (covered !== total) {
    fail(400, 'Payment split (paid + credit + deposit) must equal total amount');
  }
  if (input.paymentMode === 'cash' && input.paidAmount > 0 && input.tender < input.paidAmount) {
    fail(400, `Cash tender (${input.tender}) must be >= cash paid amount (${input.paidAmount})`);
  }
}

function buildItems(
  rows: readonly ProvisionalItemRow[],
  stocks: ReadonlyMap<number, StockRow>,
  strict: boolean,
): PharmacySaleItemContext[] {
  const balances = new Map<number, number>();
  const duplicateCounts = new Map<string, number>();
  return rows.map((item, index) => {
    if (strict) positivePharmacyQuantity(item.quantity, `Provisional item ${item.item_id} quantity`);
    const stockId = item.stock_id;
    if (strict && stockId == null) {
      throw new Error(`Strict pharmacy finalization requires stock identity for item ${item.item_id}`);
    }
    const stock = stockId == null ? null : stocks.get(stockId) ?? null;
    if (stockId != null && !stock) {
      fail(400, `Stock record ${stockId} not found for item ${item.item_id}`);
    }
    const currentBefore = stockId == null
      ? 0
      : balances.get(stockId) ?? Number(stock?.available_qty ?? 0);
    if (strict && stockId != null && currentBefore < item.quantity) {
      fail(400, `Insufficient stock for item ${item.item_id}. Available: ${currentBefore}, Required: ${item.quantity}`);
    }
    if (stockId != null) balances.set(stockId, currentBefore - item.quantity);
    const duplicateKey = `${item.item_id}:${stockId ?? 'none'}`;
    const duplicateOrdinal = duplicateCounts.get(duplicateKey) ?? 0;
    duplicateCounts.set(duplicateKey, duplicateOrdinal + 1);
    return {
      lineNumber: index + 1,
      duplicateOrdinal,
      sourceItemId: item.id,
      pharmacyItemId: item.item_id,
      stockId,
      itemName: stock?.item_name?.trim() || `Pharmacy item ${item.item_id}`,
      batchNo: item.batch_no ?? stock?.batch_no ?? null,
      expiryDate: item.expiry_date ?? stock?.expiry_date ?? null,
      sourceUnitCode: null,
      quantity: item.quantity,
      mrp: item.sale_price,
      price: item.price,
      salePrice: item.sale_price,
      discountPct: item.discount_pct,
      vatPct: item.vat_pct,
      subtotal: item.quantity * item.price,
      total: item.total_amount,
      costPrice: Number(stock?.cost_price ?? 0),
      legacyAvailableBefore: currentBefore,
      canonical: null,
    };
  });
}

function baseContext(
  input: PharmacyProvisionalFinalizationInput,
  provisional: ProvisionalRow,
  items: readonly PharmacySaleItemContext[],
  invoiceNo: string,
): PharmacySaleContext {
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
  const total = roundMoney(subtotal - input.discountAmount);
  validatePayment(input, total);
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    patientId: provisional.patient_id,
    patientVisitId: provisional.patient_visit_id,
    prescriberId: provisional.prescriber_id,
    counterId: provisional.counter_id,
    sourceKind: 'provisional_conversion',
    sourceDocumentId: input.provisionalId,
    invoiceNo,
    businessDate: input.businessDate,
    occurredAtUtc: input.occurredAtUtc,
    paymentMode: input.paymentMode,
    externalTransactionId: input.externalTransactionId,
    tender: input.tender,
    subtotal,
    sourceDiscountPct: provisional.discount_pct ?? 0,
    discountAmount: input.discountAmount,
    total,
    paidAmount: input.paidAmount,
    creditAmount: input.creditAmount,
    depositDeductAmount: input.depositDeductAmount,
    remarks: input.remarks,
    items,
  };
}

export async function executePharmacyProvisionalOriginalLegacy(
  db: PharmacyProvisionalDatabase,
  input: PharmacyProvisionalFinalizationInput,
): Promise<{ context: PharmacySaleContext; invoiceId: number }> {
  const provisional = await loadActiveProvisional(db, input);
  const claim = await db.prepare(`
    UPDATE pharmacy_provisional_invoices
    SET status = 'converting', updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND status = 'active'
  `).bind(input.provisionalId, input.tenantId).run();
  if (rowsWritten(claim) === 0) {
    fail(409, 'Provisional invoice already being converted. Please retry.');
  }

  try {
    const sourceItems = await loadProvisionalItems(db, input);
    const stocks = new Map<number, StockRow>();
    for (const item of sourceItems) {
      const stock = await loadStock(db, input.tenantId, item);
      if (item.stock_id != null) {
        if (!stock) fail(400, `Stock record ${item.stock_id} not found for item ${item.item_id}`);
        if (Number(stock.available_qty) < item.quantity) {
          fail(400, `Insufficient stock for item ${item.item_id}. Available: ${stock.available_qty}, Required: ${item.quantity}`);
        }
        stocks.set(item.stock_id, stock);
      }
    }
    const items = buildItems(sourceItems, stocks, false);
    const preview = baseContext(input, provisional, items, 'PENDING');
    if (input.depositDeductAmount > 0) {
      const balance = await legacyDepositBalance(db, input.tenantId, provisional.patient_id);
      if (balance < input.depositDeductAmount) {
        fail(400, `Insufficient deposit balance. Available: ${balance}, Requested: ${input.depositDeductAmount}`);
      }
    }

    const deducted: Array<{ stockId: number; quantity: number }> = [];
    let invoiceId: number | null = null;
    let depositReceiptNo: string | null = null;
    try {
      for (const item of sourceItems) {
        if (item.stock_id == null) continue;
        const result = await db.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND available_qty >= ?`,
        ).bind(item.quantity, item.stock_id, input.tenantId, item.quantity).run();
        if (rowsWritten(result) === 0) {
          fail(409, `Stock depleted for item ${item.item_id} (concurrent sale). Please retry.`);
        }
        deducted.push({ stockId: item.stock_id, quantity: item.quantity });
      }

      const invoiceNo = await input.dependencies.nextInvoiceNo();
      const context = { ...preview, invoiceNo };
      const result = await db.prepare(`
        INSERT INTO pharmacy_invoices
          (invoice_no, patient_id, patient_visit_id, counter_id, is_outdoor_patient, visit_type,
           prescriber_id, subtotal, discount_amount, discount_pct, vat_amount, total_amount,
           paid_amount, credit_amount, tender, change_amount, payment_mode, deposit_deduct_amount,
           status, paid_date, remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        context.invoiceNo,
        context.patientId,
        context.patientVisitId,
        context.counterId,
        0,
        'ipd',
        context.prescriberId,
        context.subtotal,
        context.discountAmount,
        provisional.discount_pct ?? 0,
        0,
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
        batch.push(db.prepare(`
          INSERT INTO pharmacy_invoice_items
            (invoice_id, item_id, stock_id, batch_no, expiry_date, quantity, mrp, price,
             subtotal, discount_pct, discount_amount, vat_pct, vat_amount, total_amount, tenant_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          invoiceId,
          item.pharmacyItemId,
          item.stockId,
          item.batchNo,
          item.expiryDate,
          item.quantity,
          item.mrp,
          item.price,
          item.subtotal,
          item.discountPct,
          0,
          item.vatPct,
          0,
          item.total,
          context.tenantId,
          context.userId,
        ));
        if (item.stockId != null) {
          batch.push(db.prepare(`
            INSERT INTO pharmacy_stock_transactions
              (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no,
               out_qty, price, tenant_id, created_by)
            VALUES (?, ?, 'sale_out', 'invoice', ?, ?, ?, ?, ?, ?)
          `).bind(
            item.pharmacyItemId,
            item.stockId,
            invoiceId,
            item.batchNo,
            item.quantity,
            item.price,
            context.tenantId,
            context.userId,
          ));
        }
      }

      if (context.depositDeductAmount > 0) {
        depositReceiptNo = `${context.invoiceNo}-DEP`;
        const depositResult = await db.prepare(`
          INSERT INTO billing_deposits
            (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type,
             reference_bill_id, remarks, created_by, counter_id, counter_session_id)
          SELECT ?, ?, ?, ?, 'adjustment', ?, 'Pharmacy invoice deposit deduction', ?, ?, ?
          WHERE (
            SELECT COALESCE(SUM(
              CASE
                WHEN transaction_type='deposit' THEN amount
                WHEN transaction_type='refund' THEN -amount
                WHEN transaction_type='adjustment' THEN -amount
                ELSE 0
              END
            ), 0)
            FROM billing_deposits WHERE patient_id=? AND tenant_id=?
          ) >= ?
        `).bind(
          context.tenantId,
          context.patientId,
          depositReceiptNo,
          context.depositDeductAmount,
          invoiceId,
          context.userId,
          context.counterId,
          null,
          context.patientId,
          context.tenantId,
          context.depositDeductAmount,
        ).run();
        if (rowsWritten(depositResult) === 0) {
          fail(409, 'Insufficient deposit balance (concurrent deduction). Please retry.');
        }
      }

      batch.push(db.prepare(`
        UPDATE pharmacy_provisional_invoices
        SET status = 'converted', updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND status = 'converting'
      `).bind(input.provisionalId, input.tenantId));
      await db.batch(batch);
      return { context, invoiceId };
    } catch (error) {
      for (const stock of deducted) {
        await db.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`,
        ).bind(stock.quantity, stock.stockId, input.tenantId).run().catch(() => undefined);
      }
      if (depositReceiptNo != null) {
        await db.prepare(`
          DELETE FROM billing_deposits
          WHERE tenant_id = ? AND patient_id = ? AND deposit_receipt_no = ?
            AND transaction_type = 'adjustment'
        `).bind(input.tenantId, provisional.patient_id, depositReceiptNo).run().catch(() => undefined);
      }
      await db.prepare(`
        UPDATE pharmacy_provisional_invoices
        SET status = 'active', updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND status = 'converting'
      `).bind(input.provisionalId, input.tenantId).run().catch(() => undefined);
      if (invoiceId != null) {
        await db.prepare(`DELETE FROM pharmacy_invoices WHERE id = ? AND tenant_id = ?`)
          .bind(invoiceId, input.tenantId).run();
      }
      throw error;
    }
  } catch (error) {
    await db.prepare(`
      UPDATE pharmacy_provisional_invoices
      SET status = 'active', updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'converting'
    `).bind(input.provisionalId, input.tenantId).run().catch(() => undefined);
    throw error;
  }
}

export async function preparePharmacyProvisionalStrictContext(
  db: PharmacyProvisionalDatabase,
  input: PharmacyProvisionalFinalizationInput,
): Promise<PharmacySaleContext> {
  const provisional = await loadActiveProvisional(db, input);
  const sourceItems = await loadProvisionalItems(db, input);
  const stocks = new Map<number, StockRow>();
  for (const item of sourceItems) {
    if (item.stock_id == null) {
      throw new Error(`Strict pharmacy finalization requires stock identity for item ${item.item_id}`);
    }
    positivePharmacyQuantity(item.quantity, `Provisional item ${item.item_id} quantity`);
    const stock = await loadStock(db, input.tenantId, item);
    if (!stock) throw new Error(`Strict pharmacy stock ${item.stock_id} is unavailable`);
    if (Number(stock.item_id) !== item.item_id) {
      throw new Error(`Strict pharmacy stock ${item.stock_id} does not belong to item ${item.item_id}`);
    }
    if (Number(stock.available_qty) < item.quantity) {
      throw new Error(`Strict pharmacy stock ${item.stock_id} is insufficient`);
    }
    const expiry = item.expiry_date ?? stock.expiry_date ?? null;
    if (expiry && expiry < input.businessDate) {
      throw new Error(`Strict pharmacy stock ${item.stock_id} is expired`);
    }
    stocks.set(item.stock_id, stock);
  }
  const items = buildItems(sourceItems, stocks, true);
  let context = baseContext(input, provisional, items, 'PENDING');
  pharmacyMinorSettlement(context);
  if (context.paidAmount > 0 && context.paymentMode !== 'cash' && !context.externalTransactionId) {
    throw new Error('Strict non-cash pharmacy payment requires external transaction authority');
  }
  if (context.depositDeductAmount > 0) {
    const balance = await legacyDepositBalance(db, input.tenantId, provisional.patient_id);
    if (balance < context.depositDeductAmount) {
      throw new Error('Strict legacy pharmacy deposit balance is insufficient');
    }
    const canonical = await db.prepare(`
      SELECT COALESCE(SUM(available_minor),0) AS balance
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND currency_code='BDT'
        AND status='posted' AND available_minor>0
    `).bind(input.tenantId, provisional.patient_id).first<{ balance: number }>();
    if (Number(canonical?.balance ?? 0) < Number(pharmacyMinorSettlement(context).depositMinor)) {
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

export function preparePharmacyProvisionalStrictStatements(
  db: Pick<PharmacyProvisionalDatabase, 'prepare'>,
  context: PharmacySaleContext,
): readonly CanonicalPreparedStatement[] {
  if (context.sourceKind !== 'provisional_conversion') {
    throw new Error('Provisional strict statements require a provisional conversion context');
  }
  const operationKey = `pharmacy-provisional:${context.sourceDocumentId}:${context.invoiceNo}`;
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
    UPDATE pharmacy_provisional_invoices
    SET status='converting',updated_at=datetime('now','+6 hours')
    WHERE id=? AND tenant_id=? AND status='active' AND is_active=1
  `).bind(context.sourceDocumentId, context.tenantId), 'claim');

  for (const item of context.items) {
    if (item.stockId == null) throw new Error('Strict provisional item requires stock identity');
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
      (invoice_no,patient_id,patient_visit_id,counter_id,is_outdoor_patient,visit_type,
       prescriber_id,subtotal,discount_amount,discount_pct,vat_amount,total_amount,
       paid_amount,credit_amount,tender,change_amount,payment_mode,deposit_deduct_amount,
       status,paid_date,remarks,tenant_id,created_by)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    FROM pharmacy_provisional_invoices p
    WHERE p.id=? AND p.tenant_id=? AND p.status='converting' AND p.is_active=1
      AND NOT EXISTS (
        SELECT 1 FROM pharmacy_invoices i WHERE i.tenant_id=? AND i.invoice_no=?
      )
  `).bind(
    context.invoiceNo,
    context.patientId,
    context.patientVisitId,
    context.counterId,
    0,
    'ipd',
    context.prescriberId,
    context.subtotal,
    context.discountAmount,
    context.sourceDiscountPct,
    0,
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
        (invoice_id,item_id,stock_id,batch_no,expiry_date,quantity,mrp,price,
         subtotal,discount_pct,discount_amount,vat_pct,vat_amount,total_amount,tenant_id,created_by)
      SELECT i.id,?,?,?,?,?,?,?,?,?,0,?,0,?,?,?
      FROM pharmacy_invoices i
      WHERE i.tenant_id=? AND i.invoice_no=?
    `).bind(
      item.pharmacyItemId,
      item.stockId,
      item.batchNo,
      item.expiryDate,
      item.quantity,
      item.mrp,
      item.price,
      item.subtotal,
      item.discountPct,
      item.vatPct,
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
      FROM pharmacy_invoices i
      WHERE i.tenant_id=? AND i.invoice_no=?
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
      SELECT ?,?,?,?,'adjustment',i.id,'Pharmacy invoice deposit deduction',?,?,NULL
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
      context.counterId,
      context.tenantId,
      context.invoiceNo,
      context.patientId,
      context.tenantId,
      context.depositDeductAmount,
    ), 'deposit');
  }

  critical(db.prepare(`
    UPDATE pharmacy_provisional_invoices
    SET status='converted',updated_at=datetime('now','+6 hours')
    WHERE id=? AND tenant_id=? AND status='converting'
  `).bind(context.sourceDocumentId, context.tenantId), 'converted');
  statements.push(prepareClearFinancialBatchAssertions(db, context.tenantId, operationKey));
  return statements;
}
