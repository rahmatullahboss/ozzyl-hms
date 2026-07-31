/**
 * Generate a simple sequence number for inventory documents.
 * Uses a MAX()+1 approach from the database.
 * Format: PREFIX-YYYY-NNNNN (e.g., PO-2025-00001, GRN-2025-00001)
 *
 * SECURITY: Only whitelisted table/column pairs are allowed to prevent SQL injection.
 * Defense-in-depth: table names are validated against regex pattern.
 */

/** Whitelisted table→column pairs for sequence generation */
const SEQUENCE_WHITELIST: Record<string, string | string[]> = {
  InventoryPurchaseOrder: 'PONumber',
  InventoryGoodsReceipt: ['GRNumber', 'GoodsReceiptNo'],
  InventoryRequisition: 'RequisitionNo',
  InventoryDispatch: 'DispatchNo',
  InventoryReturnToVendor: 'ReturnNo',
  InventoryWriteOff: 'WriteOffNo',
  InventoryConsumption: 'ConsumptionNo',
  InventoryTransfer: 'TransferNo',
  InventoryDepartmentReturn: 'ReturnNo',
  InventoryStockCountSession: 'CountNo',
  InventoryAdjustmentRequest: 'AdjustmentNo',
  InventoryRFQ: 'RFQNo',
  InventoryRequestForQuotation: 'RFQNo', // Alias for RFQ route
  InventoryQuotation: 'QuotationNo',
  InventoryPurchaseOrderDraft: 'DraftPurchaseOrderNo',
};

/** Defense-in-depth: table name must match this pattern */
const SAFE_TABLE_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
/** Defense-in-depth: column name must match this pattern */
const SAFE_COLUMN_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

export async function generateSequenceNo(
  db: D1Database,
  prefix: string,
  tableName: string,
  columnName: string,
  tenantId?: string,
): Promise<string> {
  // Validate against whitelist to prevent SQL injection
  const allowedColumns = SEQUENCE_WHITELIST[tableName];
  const isAllowed = Array.isArray(allowedColumns)
    ? allowedColumns.includes(columnName)
    : allowedColumns === columnName;
  if (!allowedColumns || !isAllowed) {
    throw new Error(
      `Invalid sequence target: ${tableName}.${columnName}. Not whitelisted.`,
    );
  }

  // Defense-in-depth: validate table/column names match safe pattern
  if (!SAFE_TABLE_NAME.test(tableName)) {
    throw new Error(`Invalid table name format: ${tableName}`);
  }
  if (!SAFE_COLUMN_NAME.test(columnName)) {
    throw new Error(`Invalid column name format: ${columnName}`);
  }

  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;

  // Build tenant-scoped query
  const tenantClause = tenantId ? ' AND tenant_id = ?' : '';
  const params: unknown[] = [pattern];
  if (tenantId) params.push(tenantId);

  const result = await db
    .prepare(
      `SELECT ${columnName} FROM ${tableName} WHERE ${columnName} LIKE ?${tenantClause} ORDER BY ROWID DESC LIMIT 1`,
    )
    .bind(...params)
    .first<Record<string, string>>();

  let nextNum = 1;
  if (result) {
    // D1 returns columns as-is; mock-db normalizes to lowercase — try both
    const lastCode = result[columnName] ?? result[columnName.toLowerCase()];
    if (lastCode) {
      const parts = lastCode.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
  }

  return `${prefix}-${year}-${String(nextNum).padStart(5, '0')}`;
}
