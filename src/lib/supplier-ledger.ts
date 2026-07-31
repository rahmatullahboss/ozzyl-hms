/**
 * Supplier Ledger — double-entry style payables tracking.
 *
 * Entry types:
 * - grn: Credit (supplier owes us goods, we owe money)
 * - payment: Debit (we pay supplier, reduces balance)
 * - credit_note: Debit (supplier issues credit for returns)
 * - adjustment: Debit/Credit (manual adjustment)
 *
 * Running balance = SUM(credits) - SUM(debits) = amount we owe supplier
 */

export type SupplierLedgerEntryType = 'grn' | 'payment' | 'credit_note' | 'adjustment';

export interface SupplierLedgerEntry {
  tenant_id: string;
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
  reference_no: string;
  reference_id?: number;
  payment_method?: string;
  notes?: string;
  created_by: number;
}

/**
 * Get current outstanding balance for a supplier.
 * Balance = SUM(credits) - SUM(debits)
 */
export async function getSupplierBalance(
  db: D1Database,
  tenantId: string,
  supplierId: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(credit_amount), 0) - COALESCE(SUM(debit_amount), 0) as balance
    FROM supplier_ledger
    WHERE supplier_id = ? AND tenant_id = ?
  `).bind(supplierId, tenantId).first<{ balance: number }>();

  return row?.balance ?? 0;
}

/**
 * Record a GRN entry (credit — increases amount we owe supplier).
 */
export async function recordSupplierGrnEntry(
  db: D1Database,
  entry: Omit<SupplierLedgerEntry, 'running_balance' | 'debit_amount' | 'entry_type'> & { credit_amount: number },
): Promise<void> {
  const balance = await getSupplierBalance(db, entry.tenant_id, entry.supplier_id);
  const newBalance = balance + entry.credit_amount;

  await db.prepare(`
    INSERT INTO supplier_ledger
      (tenant_id, supplier_id, entry_type, debit_amount, credit_amount, running_balance, reference_no, reference_id, payment_method, notes, created_by)
    VALUES (?, ?, 'grn', 0, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.tenant_id,
    entry.supplier_id,
    entry.credit_amount,
    newBalance,
    entry.reference_no,
    entry.reference_id ?? null,
    entry.payment_method ?? null,
    entry.notes ?? null,
    entry.created_by,
  ).run();
}

/**
 * Record a payment entry (debit — reduces amount we owe supplier).
 * Validates that payment does not exceed outstanding balance.
 */
export async function recordSupplierPayment(
  db: D1Database,
  entry: Omit<SupplierLedgerEntry, 'running_balance' | 'credit_amount' | 'entry_type'> & { debit_amount: number },
): Promise<{ newBalance: number }> {
  const balance = await getSupplierBalance(db, entry.tenant_id, entry.supplier_id);

  if (entry.debit_amount > balance) {
    throw new Error(`Payment amount (${entry.debit_amount}) exceeds outstanding balance (${balance})`);
  }

  const newBalance = balance - entry.debit_amount;

  await db.prepare(`
    INSERT INTO supplier_ledger
      (tenant_id, supplier_id, entry_type, debit_amount, credit_amount, running_balance, reference_no, reference_id, payment_method, notes, created_by)
    VALUES (?, ?, 'payment', ?, 0, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.tenant_id,
    entry.supplier_id,
    entry.debit_amount,
    newBalance,
    entry.reference_no,
    entry.reference_id ?? null,
    entry.payment_method ?? null,
    entry.notes ?? null,
    entry.created_by,
  ).run();

  return { newBalance };
}

/**
 * Record a credit note entry (debit — reduces amount we owe supplier).
 */
export async function recordSupplierCreditNote(
  db: D1Database,
  entry: Omit<SupplierLedgerEntry, 'running_balance' | 'credit_amount' | 'entry_type'> & { debit_amount: number },
): Promise<{ newBalance: number }> {
  const balance = await getSupplierBalance(db, entry.tenant_id, entry.supplier_id);
  const newBalance = balance - entry.debit_amount;

  await db.prepare(`
    INSERT INTO supplier_ledger
      (tenant_id, supplier_id, entry_type, debit_amount, credit_amount, running_balance, reference_no, reference_id, payment_method, notes, created_by)
    VALUES (?, ?, 'credit_note', ?, 0, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.tenant_id,
    entry.supplier_id,
    entry.debit_amount,
    newBalance,
    entry.reference_no,
    entry.reference_id ?? null,
    entry.payment_method ?? null,
    entry.notes ?? null,
    entry.created_by,
  ).run();

  return { newBalance };
}

/**
 * Get supplier ledger statement with running balance.
 */
export async function getSupplierLedgerStatement(
  db: D1Database,
  tenantId: string,
  supplierId: number,
  options?: { fromDate?: string; toDate?: string; page?: number; limit?: number },
): Promise<{ entries: Array<Record<string, unknown>>; total: number; balance: number }> {
  const limit = options?.limit ?? 30;
  const page = options?.page ?? 1;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE supplier_id = ? AND tenant_id = ?';
  const params: (string | number)[] = [supplierId, tenantId];

  if (options?.fromDate) {
    whereClause += ' AND date(created_at) >= ?';
    params.push(options.fromDate);
  }
  if (options?.toDate) {
    whereClause += ' AND date(created_at) <= ?';
    params.push(options.toDate);
  }

  const [entries, totalRow, balanceRow] = await Promise.all([
    db.prepare(`
      SELECT * FROM supplier_ledger ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all(),
    db.prepare(`SELECT COUNT(*) as total FROM supplier_ledger ${whereClause}`).bind(...params).first<{ total: number }>(),
    db.prepare(`
      SELECT COALESCE(SUM(credit_amount), 0) - COALESCE(SUM(debit_amount), 0) as balance
      FROM supplier_ledger ${whereClause}
    `).bind(...params).first<{ balance: number }>(),
  ]);

  return {
    entries: (entries.results ?? []) as Array<Record<string, unknown>>,
    total: totalRow?.total ?? 0,
    balance: balanceRow?.balance ?? 0,
  };
}
