import { HTTPException } from 'hono/http-exception';
import type { CreateGoodsReceiptInput } from '../schemas/inventory';
import { normalizeInventoryReceiptLot, type InventoryReceiptNormalizationResult } from './inventory-receipt-normalization';

export type GoodsReceiptItemPolicy = {
  ItemId: number;
  ItemType?: string | null;
  IsBatchRequired?: number | boolean | null;
  IsExpiryRequired?: number | boolean | null;
  UnitConversionFactor?: number | null;
  IssueUnit?: string | null;
};

export type PreparedGoodsReceiptLine = {
  item: CreateGoodsReceiptInput['Items'][number];
  policy?: GoodsReceiptItemPolicy;
  normalizedReceipt: InventoryReceiptNormalizationResult;
  operationLineKey: string;
  grItemId: number;
  stockId: number;
};

export type PreparedGoodsReceipt = {
  subTotal: number;
  totalVAT: number;
  totalAmount: number;
  lines: Array<Omit<PreparedGoodsReceiptLine, 'operationLineKey' | 'grItemId' | 'stockId'>>;
};

export type GoodsReceiptReplayRow = {
  GoodsReceiptId: number;
  GRNumber: string;
  RequestHash: string | null;
  OperationStatus: string | null;
};

export type GoodsReceiptCoreResult = {
  goodsReceiptId: number;
  grNumber: string;
  lines: PreparedGoodsReceiptLine[];
};

type PersistedReceiptLineIdentity = {
  OperationLineKey: string;
  GRItemId: number;
  StockId: number;
};

function receiptLineKey(operationKey: string, index: number): string {
  return `${operationKey}:line:${String(index + 1).padStart(4, '0')}`;
}

export async function loadGoodsReceiptItemPolicies(
  db: D1Database,
  tenantId: string,
  body: CreateGoodsReceiptInput,
): Promise<Map<number, GoodsReceiptItemPolicy>> {
  const policies = new Map<number, GoodsReceiptItemPolicy>();

  for (const item of body.Items) {
    if (policies.has(item.ItemId)) continue;
    const policy = await db.prepare(`
      SELECT ItemId, ItemType, IsBatchRequired, IsExpiryRequired, UnitConversionFactor, IssueUnit
      FROM InventoryItem
      WHERE tenant_id = ? AND ItemId = ?
      LIMIT 1
    `).bind(tenantId, item.ItemId).first<GoodsReceiptItemPolicy>();

    if (policy) policies.set(item.ItemId, policy);
  }

  return policies;
}

export function prepareGoodsReceipt(
  body: CreateGoodsReceiptInput,
  itemPolicies: Map<number, GoodsReceiptItemPolicy>,
): PreparedGoodsReceipt {
  let subTotal = 0;
  let totalVAT = 0;
  const itemValues = body.Items.map((item) => {
    const itemTotal = item.ReceivedQuantity * item.ItemRate;
    subTotal += itemTotal;
    totalVAT += itemTotal * (Number(item.VATPercent ?? 0) / 100);
    return itemTotal;
  });

  const taxableAmount = subTotal - body.DiscountAmount;
  const totalAdditionalCharges = body.FreightAmount + body.InsuranceAmount + body.OtherCharges;
  const totalAmount = taxableAmount + totalVAT + totalAdditionalCharges;
  const totalItemValue = itemValues.reduce((sum, value) => sum + value, 0);

  const lines = body.Items.map((item, index) => {
    const policy = itemPolicies.get(item.ItemId);
    const batchRequired = policy?.ItemType === 'lab_reagent'
      || policy?.IsBatchRequired === 1
      || policy?.IsBatchRequired === true;
    const expiryRequired = policy?.ItemType === 'lab_reagent'
      || policy?.IsExpiryRequired === 1
      || policy?.IsExpiryRequired === true;

    if (batchRequired && !String(item.BatchNo ?? '').trim()) {
      throw new HTTPException(400, { message: `Batch number is required for item ${item.ItemId}` });
    }
    if (expiryRequired && !String(item.ExpiryDate ?? '').trim()) {
      throw new HTTPException(400, { message: `Expiry date is required for item ${item.ItemId}` });
    }

    const chargeShare = totalItemValue > 0 ? (itemValues[index] / totalItemValue) * totalAdditionalCharges : 0;
    const landedCostPerPurchaseUnit = item.ReceivedQuantity > 0
      ? (itemValues[index] + chargeShare) / item.ReceivedQuantity
      : item.ItemRate;

    try {
      return {
        item,
        policy,
        normalizedReceipt: normalizeInventoryReceiptLot({
          receivedQuantity: item.ReceivedQuantity,
          rejectedQuantity: item.RejectedQuantity,
          freeQuantity: item.FreeQuantity,
          landedCostPerPurchaseUnit,
          unitConversionFactor: policy?.UnitConversionFactor,
          itemType: policy?.ItemType,
        }),
      };
    } catch (error) {
      throw new HTTPException(400, {
        message: `Item ${item.ItemId}: ${error instanceof Error ? error.message : 'Invalid receipt quantity or unit conversion'}`,
      });
    }
  });

  return { subTotal, totalVAT, totalAmount, lines };
}

export async function findGoodsReceiptReplay(
  db: D1Database,
  input: { tenantId: string; operationKey: string },
): Promise<GoodsReceiptReplayRow | null> {
  return db.prepare(`
    SELECT GoodsReceiptId, GRNumber, RequestHash, OperationStatus
    FROM InventoryGoodsReceipt
    WHERE tenant_id = ? AND OperationKey = ?
    LIMIT 1
  `).bind(input.tenantId, input.operationKey).first<GoodsReceiptReplayRow>();
}

function buildPoGuardStatement(
  db: D1Database,
  input: {
    operationKey: string;
    tenantId: string;
    purchaseOrderId: number;
    itemId: number;
    requestedQuantity: number;
  },
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO inventory_gr_batch_guard (tenant_id, operation_key, item_id, assertion_value)
    VALUES (
      ?,
      ?,
      ?,
      CASE WHEN (
        COALESCE((
          SELECT SUM(GRI.ReceivedQuantity)
          FROM InventoryGoodsReceiptItem GRI
          JOIN InventoryGoodsReceipt GR ON GR.GoodsReceiptId = GRI.GoodsReceiptId
          WHERE GR.tenant_id = ?
            AND GR.PurchaseOrderId = ?
            AND GRI.ItemId = ?
            AND COALESCE(GR.IsCancelled, 0) = 0
            AND COALESCE(GR.OperationStatus, 'completed') IN ('core_completed', 'completed')
        ), 0) + ?
      ) <= COALESCE((
        SELECT SUM(POI.Quantity)
        FROM InventoryPurchaseOrderItem POI
        JOIN InventoryPurchaseOrder PO ON PO.PurchaseOrderId = POI.PurchaseOrderId
        WHERE PO.tenant_id = ?
          AND POI.PurchaseOrderId = ?
          AND POI.ItemId = ?
      ), -1) THEN 1 ELSE 0 END
    )
  `).bind(
    input.tenantId,
    input.operationKey,
    input.itemId,
    input.tenantId,
    input.purchaseOrderId,
    input.itemId,
    input.requestedQuantity,
    input.tenantId,
    input.purchaseOrderId,
    input.itemId,
  );
}

function isPoGuardFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('inventory_gr_batch_guard')
    || message.includes('assertion_value = 1')
    || message.includes('CHECK constraint failed');
}

function buildHeaderInsertStatement(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    operationKey: string;
    requestHash: string;
    grNumber: string;
    today: string;
    body: CreateGoodsReceiptInput;
    prepared: PreparedGoodsReceipt;
    createdOn: string;
  },
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO InventoryGoodsReceipt
      (tenant_id, GRNumber, GRDate, PurchaseOrderId, VendorId, StoreId,
       VendorBillNo, VendorBillDate, SubTotal, DiscountAmount, VATAmount, FreightAmount,
       InsuranceAmount, OtherCharges, TotalAmount, PaymentMode, CreditPeriod, IsDonation,
       Remarks, CreatedBy, CreatedOn, OperationKey, RequestHash, OperationStatus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'core_completed')
  `).bind(
    input.tenantId,
    input.grNumber,
    input.body.GRDate || input.today,
    input.body.PurchaseOrderId ?? null,
    input.body.VendorId,
    input.body.StoreId,
    input.body.VendorBillNo ?? null,
    input.body.VendorBillDate ?? null,
    input.prepared.subTotal,
    input.body.DiscountAmount,
    input.prepared.totalVAT,
    input.body.FreightAmount,
    input.body.InsuranceAmount,
    input.body.OtherCharges,
    input.prepared.totalAmount,
    input.body.PaymentMode,
    input.body.CreditPeriod,
    input.body.IsDonation ? 1 : 0,
    input.body.Remarks ?? null,
    input.userId,
    input.createdOn,
    input.operationKey,
    input.requestHash,
  );
}

function buildLineInsertStatement(
  db: D1Database,
  input: {
    tenantId: string;
    operationKey: string;
    operationLineKey: string;
    userId: string;
    createdOn: string;
    line: PreparedGoodsReceipt['lines'][number];
  },
): D1PreparedStatement {
  const itemTotal = input.line.item.ReceivedQuantity * input.line.item.ItemRate;
  const vatAmount = itemTotal * (Number(input.line.item.VATPercent ?? 0) / 100);
  const discountAmount = itemTotal * (Number(input.line.item.DiscountPercent ?? 0) / 100);

  return db.prepare(`
    INSERT INTO InventoryGoodsReceiptItem
      (GoodsReceiptId, ItemId, POItemId, BatchNo, ExpiryDate, ManufactureDate,
       ReceivedQuantity, FreeQuantity, RejectedQuantity, ItemRate, MRP, VATPercent, VATAmount,
       DiscountPercent, DiscountAmount, SubTotal, TotalAmount, Remarks, CreatedBy, CreatedOn,
       OperationLineKey)
    SELECT
      GR.GoodsReceiptId, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM InventoryGoodsReceipt GR
    WHERE GR.tenant_id = ? AND GR.OperationKey = ?
  `).bind(
    input.line.item.ItemId,
    input.line.item.POItemId ?? null,
    input.line.item.BatchNo ?? null,
    input.line.item.ExpiryDate ?? null,
    input.line.item.ManufactureDate ?? null,
    input.line.item.ReceivedQuantity,
    input.line.item.FreeQuantity,
    input.line.item.RejectedQuantity,
    input.line.item.ItemRate,
    input.line.item.MRP ?? input.line.item.ItemRate,
    input.line.item.VATPercent,
    vatAmount,
    input.line.item.DiscountPercent,
    discountAmount,
    itemTotal,
    itemTotal + vatAmount - discountAmount,
    input.line.item.Remarks ?? null,
    input.userId,
    input.createdOn,
    input.operationLineKey,
    input.tenantId,
    input.operationKey,
  );
}

function buildStockInsertStatement(
  db: D1Database,
  input: {
    tenantId: string;
    operationKey: string;
    operationLineKey: string;
    storeId: number;
    userId: string;
    createdOn: string;
    line: PreparedGoodsReceipt['lines'][number];
  },
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO InventoryStock
      (tenant_id, ItemId, StoreId, GRItemId, BatchNo, ExpiryDate, CostPrice, MRP,
       AvailableQuantity, QCStatus, StockStatus, CreatedBy, CreatedOn, ReceiptOperationLineKey)
    SELECT
      ?, GRI.ItemId, ?, GRI.GRItemId, GRI.BatchNo, GRI.ExpiryDate, ?, ?, ?, ?, ?, ?, ?, ?
    FROM InventoryGoodsReceipt GR
    JOIN InventoryGoodsReceiptItem GRI
      ON GRI.GoodsReceiptId = GR.GoodsReceiptId
     AND GRI.OperationLineKey = ?
    WHERE GR.tenant_id = ? AND GR.OperationKey = ?
  `).bind(
    input.tenantId,
    input.storeId,
    input.line.normalizedReceipt.costPerIssueUnit,
    (input.line.item.MRP ?? input.line.item.ItemRate) / Number(input.line.policy?.UnitConversionFactor || 1),
    input.line.normalizedReceipt.stockQuantity,
    input.line.normalizedReceipt.qcStatus,
    input.line.normalizedReceipt.stockStatus,
    input.userId,
    input.createdOn,
    input.operationLineKey,
    input.operationLineKey,
    input.tenantId,
    input.operationKey,
  );
}

function buildStockTransactionInsertStatement(
  db: D1Database,
  input: {
    tenantId: string;
    operationKey: string;
    operationLineKey: string;
    grNumber: string;
    storeId: number;
    userId: string;
    createdOn: string;
    remarks: string | null;
    quantity: number;
  },
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO InventoryStockTransaction
      (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
       InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
    SELECT
      ?, S.StockId, S.ItemId, ?, 'goods-receipt', ?, GR.GoodsReceiptId,
      ?, 0, ?, ?, ?, ?, ?
    FROM InventoryGoodsReceipt GR
    JOIN InventoryStock S
      ON S.tenant_id = GR.tenant_id
     AND S.ReceiptOperationLineKey = ?
    WHERE GR.tenant_id = ? AND GR.OperationKey = ?
  `).bind(
    input.tenantId,
    input.storeId,
    input.grNumber,
    input.quantity,
    input.quantity,
    input.createdOn,
    input.remarks,
    input.userId,
    input.createdOn,
    input.operationLineKey,
    input.tenantId,
    input.operationKey,
  );
}

async function loadCommittedGoodsReceiptCore(
  db: D1Database,
  input: {
    tenantId: string;
    operationKey: string;
    grNumber: string;
    prepared: PreparedGoodsReceipt;
  },
): Promise<GoodsReceiptCoreResult> {
  const header = await findGoodsReceiptReplay(db, input);
  if (!header) {
    throw new Error('Goods receipt core committed but the header could not be reconstructed');
  }

  const { results } = await db.prepare(`
    SELECT GRI.OperationLineKey, GRI.GRItemId, S.StockId
    FROM InventoryGoodsReceipt GR
    JOIN InventoryGoodsReceiptItem GRI ON GRI.GoodsReceiptId = GR.GoodsReceiptId
    JOIN InventoryStock S
      ON S.tenant_id = GR.tenant_id
     AND S.ReceiptOperationLineKey = GRI.OperationLineKey
    WHERE GR.tenant_id = ? AND GR.OperationKey = ?
    ORDER BY GRI.OperationLineKey
  `).bind(input.tenantId, input.operationKey).all<PersistedReceiptLineIdentity>();

  const identities = new Map((results ?? []).map((row) => [row.OperationLineKey, row]));
  const lines = input.prepared.lines.map((line, index) => {
    const operationLineKey = receiptLineKey(input.operationKey, index);
    const identity = identities.get(operationLineKey);
    if (!identity) throw new Error(`Goods receipt line ${operationLineKey} could not be reconstructed`);
    return {
      ...line,
      operationLineKey,
      grItemId: Number(identity.GRItemId),
      stockId: Number(identity.StockId),
    };
  });

  return {
    goodsReceiptId: Number(header.GoodsReceiptId),
    grNumber: header.GRNumber || input.grNumber,
    lines,
  };
}

export async function commitGoodsReceiptCore(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    operationKey: string;
    requestHash: string;
    grNumber: string;
    today: string;
    body: CreateGoodsReceiptInput;
    prepared: PreparedGoodsReceipt;
  },
): Promise<GoodsReceiptCoreResult> {
  const createdOn = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const poQuantities = new Map<number, number>();

  if (input.body.PurchaseOrderId) {
    for (const line of input.prepared.lines) {
      poQuantities.set(
        line.item.ItemId,
        (poQuantities.get(line.item.ItemId) ?? 0) + line.item.ReceivedQuantity,
      );
    }
    for (const [itemId, requestedQuantity] of poQuantities) {
      statements.push(db.prepare(`
        DELETE FROM inventory_gr_batch_guard
        WHERE tenant_id = ? AND operation_key = ? AND item_id = ?
      `).bind(input.tenantId, input.operationKey, itemId));
      statements.push(buildPoGuardStatement(db, {
        operationKey: input.operationKey,
        tenantId: input.tenantId,
        purchaseOrderId: input.body.PurchaseOrderId,
        itemId,
        requestedQuantity,
      }));
    }
  }

  const headerStatementIndex = statements.length;
  statements.push(buildHeaderInsertStatement(db, { ...input, createdOn }));

  const lineStatementIndexes: Array<{
    operationLineKey: string;
    lineIndex: number;
    stockIndex: number;
  }> = [];
  input.prepared.lines.forEach((line, index) => {
    const operationLineKey = receiptLineKey(input.operationKey, index);
    const lineIndex = statements.length;
    statements.push(buildLineInsertStatement(db, {
      tenantId: input.tenantId,
      operationKey: input.operationKey,
      operationLineKey,
      userId: input.userId,
      createdOn,
      line,
    }));
    const stockIndex = statements.length;
    statements.push(buildStockInsertStatement(db, {
      tenantId: input.tenantId,
      operationKey: input.operationKey,
      operationLineKey,
      storeId: input.body.StoreId,
      userId: input.userId,
      createdOn,
      line,
    }));
    statements.push(buildStockTransactionInsertStatement(db, {
      tenantId: input.tenantId,
      operationKey: input.operationKey,
      operationLineKey,
      grNumber: input.grNumber,
      storeId: input.body.StoreId,
      userId: input.userId,
      createdOn,
      remarks: line.item.Remarks ?? input.body.Remarks ?? null,
      quantity: line.normalizedReceipt.stockQuantity,
    }));
    lineStatementIndexes.push({ operationLineKey, lineIndex, stockIndex });
  });

  if (input.body.PurchaseOrderId) {
    statements.push(db.prepare(`
      UPDATE InventoryPurchaseOrder
      SET POStatus = CASE
        WHEN COALESCE((
          SELECT SUM(POI.Quantity)
          FROM InventoryPurchaseOrderItem POI
          WHERE POI.PurchaseOrderId = InventoryPurchaseOrder.PurchaseOrderId
        ), 0) <= COALESCE((
          SELECT SUM(GRI.ReceivedQuantity)
          FROM InventoryGoodsReceiptItem GRI
          JOIN InventoryGoodsReceipt GR ON GR.GoodsReceiptId = GRI.GoodsReceiptId
          WHERE GR.PurchaseOrderId = InventoryPurchaseOrder.PurchaseOrderId
            AND GR.tenant_id = InventoryPurchaseOrder.tenant_id
            AND COALESCE(GR.IsCancelled, 0) = 0
            AND COALESCE(GR.OperationStatus, 'completed') IN ('core_completed', 'completed')
        ), 0)
        THEN 'complete' ELSE 'partial' END
      WHERE PurchaseOrderId = ? AND tenant_id = ?
    `).bind(input.body.PurchaseOrderId, input.tenantId));

    for (const itemId of poQuantities.keys()) {
      statements.push(db.prepare(`
        DELETE FROM inventory_gr_batch_guard
        WHERE tenant_id = ? AND operation_key = ? AND item_id = ?
      `).bind(input.tenantId, input.operationKey, itemId));
    }
  }

  let batchResults: D1Result<unknown>[];
  try {
    batchResults = await db.batch(statements);
  } catch (error) {
    if (isPoGuardFailure(error)) {
      throw new HTTPException(409, {
        message: 'Goods receipt quantity would exceed the remaining purchase-order quantity. Refresh and retry.',
      });
    }
    throw error;
  }

  const goodsReceiptId = Number(batchResults[headerStatementIndex]?.meta?.last_row_id ?? 0);
  const persistedLines = lineStatementIndexes.map((indexes, index) => ({
    ...input.prepared.lines[index],
    operationLineKey: indexes.operationLineKey,
    grItemId: Number(batchResults[indexes.lineIndex]?.meta?.last_row_id ?? 0),
    stockId: Number(batchResults[indexes.stockIndex]?.meta?.last_row_id ?? 0),
  }));
  if (goodsReceiptId > 0 && persistedLines.every((line) => line.grItemId > 0 && line.stockId > 0)) {
    return {
      goodsReceiptId,
      grNumber: input.grNumber,
      lines: persistedLines,
    };
  }

  return loadCommittedGoodsReceiptCore(db, input);
}

export async function markGoodsReceiptProjectionCompleted(
  db: D1Database,
  input: { tenantId: string; goodsReceiptId: number },
): Promise<void> {
  await db.prepare(`
    UPDATE InventoryGoodsReceipt
    SET OperationStatus = 'completed', ModifiedOn = CURRENT_TIMESTAMP
    WHERE GoodsReceiptId = ? AND tenant_id = ?
  `).bind(input.goodsReceiptId, input.tenantId).run();
}

export async function loadGoodsReceiptProjectionLines(
  db: D1Database,
  input: { tenantId: string; goodsReceiptId: number },
): Promise<Array<{
  grItemId: number;
  stockId: number;
  itemId: number;
  batchNo: string | null;
  expiryDate: string | null;
  quantity: number;
  costPrice: number;
  remarks: string | null;
}>> {
  const { results } = await db.prepare(`
    SELECT
      GRI.GRItemId AS grItemId,
      S.StockId AS stockId,
      GRI.ItemId AS itemId,
      GRI.BatchNo AS batchNo,
      GRI.ExpiryDate AS expiryDate,
      COALESCE((
        SELECT ST.InQuantity
        FROM InventoryStockTransaction ST
        WHERE ST.tenant_id = S.tenant_id
          AND ST.StockId = S.StockId
          AND ST.TransactionType = 'goods-receipt'
          AND ST.ReferenceId = GRI.GoodsReceiptId
        ORDER BY ST.TransactionId ASC
        LIMIT 1
      ), S.AvailableQuantity) AS quantity,
      S.CostPrice AS costPrice,
      GRI.Remarks AS remarks
    FROM InventoryGoodsReceiptItem GRI
    JOIN InventoryStock S ON S.GRItemId = GRI.GRItemId AND S.tenant_id = ?
    WHERE GRI.GoodsReceiptId = ?
    ORDER BY GRI.OperationLineKey, GRI.GRItemId
  `).bind(input.tenantId, input.goodsReceiptId).all<{
    grItemId: number;
    stockId: number;
    itemId: number;
    batchNo: string | null;
    expiryDate: string | null;
    quantity: number;
    costPrice: number;
    remarks: string | null;
  }>();
  return results ?? [];
}
