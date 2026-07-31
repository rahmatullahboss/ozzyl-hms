import { HTTPException } from 'hono/http-exception';
import { normalizeInventoryMovementType } from './inventory-core';

export interface CommitInventoryIssueAllocationInput {
  db: D1Database;
  tenantId: string;
  userId: string;
  consumptionId: number;
  issueNo: string;
  issueType: string;
  storeId: number;
  itemId: number;
  itemUnit?: string | null;
  stock: {
    StockId: number;
    AvailableQuantity?: number | null;
    ReservedQuantity?: number | null;
    DamagedQuantity?: number | null;
    BlockedQuantity?: number | null;
    BatchNo?: string | null;
    ExpiryDate?: string | null;
  };
  quantity: number;
  costPrice: number;
  lineCharge: number;
  isChargeable: boolean;
  remarks?: string | null;
  transactionDate: string;
}

export async function commitInventoryIssueAllocation(
  input: CommitInventoryIssueAllocationInput,
): Promise<{ consumptionItemId: number; balanceAfterIssue: number }> {
  const availableBefore = Number(input.stock.AvailableQuantity ?? 0);
  const reservedBefore = Number(input.stock.ReservedQuantity ?? 0);
  const damagedBefore = Number(input.stock.DamagedQuantity ?? 0);
  const blockedBefore = Number(input.stock.BlockedQuantity ?? 0);
  const balanceAfterIssue = availableBefore - input.quantity;

  const stockUpdate = input.db.prepare(`
    UPDATE InventoryStock
    SET AvailableQuantity = AvailableQuantity - ?, ModifiedBy = ?, ModifiedOn = ?
    WHERE StockId = ?
      AND tenant_id = ?
      AND AvailableQuantity = ?
      AND COALESCE(ReservedQuantity, 0) = ?
      AND COALESCE(DamagedQuantity, 0) = ?
      AND COALESCE(BlockedQuantity, 0) = ?
      AND AvailableQuantity - COALESCE(ReservedQuantity, 0) - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0) >= ?
      AND COALESCE(IsActive, 1) = 1
      AND COALESCE(StockStatus, 'available') = 'available'
      AND COALESCE(QCStatus, 'accepted') IN ('accepted', 'passed', 'not_required')
      AND (AfterOpenExpiryDate IS NULL OR date(AfterOpenExpiryDate) > CURRENT_DATE)
      AND (ExpiryDate IS NULL OR ExpiryDate = '' OR date(ExpiryDate) > CURRENT_DATE)
  `).bind(
    input.quantity,
    input.userId,
    input.transactionDate,
    input.stock.StockId,
    input.tenantId,
    availableBefore,
    reservedBefore,
    damagedBefore,
    blockedBefore,
    input.quantity,
  );

  const consumptionItemInsert = input.db.prepare(`
    INSERT INTO InventoryConsumptionItem
      (ConsumptionId, ItemId, StockId, BatchNo, ExpiryDate, Quantity, Unit, CostPrice,
       ChargeAmount, IsChargeable, Remarks, CreatedBy, CreatedOn)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    input.consumptionId,
    input.itemId,
    input.stock.StockId,
    input.stock.BatchNo ?? null,
    input.stock.ExpiryDate ?? null,
    input.quantity,
    input.itemUnit ?? null,
    input.costPrice,
    input.lineCharge,
    input.isChargeable ? 1 : 0,
    input.remarks ?? null,
    input.userId,
    input.transactionDate,
  );

  const transactionInsert = input.db.prepare(`
    INSERT INTO InventoryStockTransaction
      (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
       InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
    SELECT ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    input.tenantId,
    input.stock.StockId,
    input.itemId,
    input.storeId,
    normalizeInventoryMovementType(input.issueType),
    input.issueNo,
    input.consumptionId,
    input.quantity,
    balanceAfterIssue,
    input.transactionDate,
    input.remarks ?? null,
    input.userId,
    input.transactionDate,
  );

  const auditInsert = input.db.prepare(`
    INSERT INTO InventoryAuditLog
      (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
       ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
    SELECT ?, 'stock_issue', 'InventoryConsumption', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    input.tenantId,
    input.consumptionId,
    input.itemId,
    input.stock.StockId,
    input.stock.BatchNo ?? null,
    input.storeId,
    input.issueType,
    input.consumptionId,
    JSON.stringify({
      AvailableQuantity: availableBefore,
      ReservedQuantity: reservedBefore,
      DamagedQuantity: damagedBefore,
      BlockedQuantity: blockedBefore,
    }),
    JSON.stringify({ AvailableQuantity: balanceAfterIssue, issuedQuantity: input.quantity }),
    input.userId,
    input.transactionDate,
  );

  const results = await input.db.batch([
    stockUpdate,
    consumptionItemInsert,
    transactionInsert,
    auditInsert,
  ]);

  const stockChanges = (results[0]?.meta as { changes?: number } | undefined)?.changes;
  if (stockChanges !== undefined && Number(stockChanges) !== 1) {
    throw new HTTPException(409, {
      message: `Stock changed while issuing item ${input.itemId}. Please retry after refreshing inventory.`,
    });
  }

  const itemChanges = (results[1]?.meta as { changes?: number } | undefined)?.changes;
  if (itemChanges !== undefined && Number(itemChanges) !== 1) {
    throw new HTTPException(409, {
      message: `Inventory issue line could not be committed for item ${input.itemId}. Please retry.`,
    });
  }

  const consumptionItemId = Number((results[1]?.meta as { last_row_id?: number } | undefined)?.last_row_id ?? 0);
  if (!consumptionItemId) {
    throw new HTTPException(500, { message: `Inventory issue line id was not returned for item ${input.itemId}` });
  }

  return { consumptionItemId, balanceAfterIssue };
}
