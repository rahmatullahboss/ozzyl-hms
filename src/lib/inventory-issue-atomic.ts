import { HTTPException } from 'hono/http-exception';
import { normalizeInventoryMovementType } from './inventory-core';

export type InventoryIssueStockSnapshot = {
  StockId: number;
  AvailableQuantity?: number | null;
  ReservedQuantity?: number | null;
  DamagedQuantity?: number | null;
  BlockedQuantity?: number | null;
  BatchNo?: string | null;
  ExpiryDate?: string | null;
};

export type AtomicInventoryIssueAllocation = {
  allocationKey: string;
  itemId: number;
  itemName: string;
  itemCategory: string;
  itemUnit: string | null;
  stock: InventoryIssueStockSnapshot;
  quantity: number;
  costPrice: number;
  unitCharge: number;
  lineCharge: number;
  isChargeable: boolean;
  remarks: string | null;
};

export type AtomicInventoryIssueInput = {
  db: D1Database;
  tenantId: string;
  userId: string;
  operationKey: string;
  issueNo: string;
  issueDate: string;
  transactionDate: string;
  issueType: string;
  fromStoreId: number;
  departmentId?: number | null;
  department?: string | null;
  patientId?: number | null;
  admissionId?: number | null;
  visitId?: number | null;
  surgeryId?: number | null;
  labOrderId?: number | null;
  billingReferenceId?: number | null;
  chargeable: boolean;
  remarks?: string | null;
  allocations: AtomicInventoryIssueAllocation[];
};

export type AtomicInventoryIssueCommit = {
  consumptionId: number;
  issueNo: string;
  totalCost: number;
  totalCharge: number;
  billedLines: number;
};

type CommittedHeaderRow = {
  ConsumptionId: number;
  ConsumptionNo: string;
  TotalCost: number | string | null;
  TotalCharge: number | string | null;
};

function headerIdSubquery(): string {
  return `(
    SELECT ConsumptionId
    FROM InventoryConsumption
    WHERE tenant_id = ? AND OperationKey = ?
    LIMIT 1
  )`;
}

function itemIdSubquery(): string {
  return `(
    SELECT ICI.ConsumptionItemId
    FROM InventoryConsumptionItem ICI
    JOIN InventoryConsumption IC ON IC.ConsumptionId = ICI.ConsumptionId
    WHERE IC.tenant_id = ?
      AND IC.OperationKey = ?
      AND ICI.OperationAllocationKey = ?
    LIMIT 1
  )`;
}

function usableSnapshot(stock: InventoryIssueStockSnapshot) {
  return {
    available: Number(stock.AvailableQuantity ?? 0),
    reserved: Number(stock.ReservedQuantity ?? 0),
    damaged: Number(stock.DamagedQuantity ?? 0),
    blocked: Number(stock.BlockedQuantity ?? 0),
  };
}

export function buildAtomicInventoryIssueStatements(
  input: AtomicInventoryIssueInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const totalCost = input.allocations.reduce(
    (sum, allocation) => sum + allocation.costPrice * allocation.quantity,
    0,
  );
  const totalCharge = input.allocations.reduce((sum, allocation) => sum + allocation.lineCharge, 0);
  const billedLines = input.allocations.filter(
    (allocation) => allocation.isChargeable && Boolean(input.patientId) && allocation.lineCharge > 0,
  ).length;
  const billingStatus = billedLines > 0
    ? 'provisional_created'
    : input.chargeable ? 'pending' : 'not_chargeable';

  statements.push(input.db.prepare(`
    INSERT INTO InventoryConsumption
      (tenant_id, ConsumptionNo, ConsumptionDate, IssueType, FromStoreId, DepartmentId, Department,
       PatientId, AdmissionId, VisitId, SurgeryId, LabOrderId, BillingReferenceId, Chargeable,
       BillingStatus, TotalCost, TotalCharge, Remarks, CreatedBy, CreatedOn, OperationKey, OperationStatus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?, ?, ?, 'processing')
  `).bind(
    input.tenantId,
    input.issueNo,
    input.issueDate,
    input.issueType,
    input.fromStoreId,
    input.departmentId ?? null,
    input.department ?? null,
    input.patientId ?? null,
    input.admissionId ?? null,
    input.visitId ?? null,
    input.surgeryId ?? null,
    input.labOrderId ?? null,
    input.billingReferenceId ?? null,
    input.chargeable ? 1 : 0,
    input.remarks ?? null,
    input.userId,
    input.transactionDate,
    input.operationKey,
  ));

  for (const allocation of input.allocations) {
    const snapshot = usableSnapshot(allocation.stock);
    const balanceAfterIssue = snapshot.available - allocation.quantity;
    const demandSourceId = `${input.operationKey}:${allocation.allocationKey}`;

    statements.push(input.db.prepare(`
      UPDATE InventoryStock
      SET AvailableQuantity = AvailableQuantity - ?, ModifiedBy = ?, ModifiedOn = ?
      WHERE StockId = ?
        AND tenant_id = ?
        AND ItemId = ?
        AND StoreId = ?
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
      allocation.quantity,
      input.userId,
      input.transactionDate,
      allocation.stock.StockId,
      input.tenantId,
      allocation.itemId,
      input.fromStoreId,
      snapshot.available,
      snapshot.reserved,
      snapshot.damaged,
      snapshot.blocked,
      allocation.quantity,
    ));

    statements.push(input.db.prepare(`
      INSERT INTO inventory_issue_batch_guard
        (tenant_id, operation_key, step_key, assertion_value)
      VALUES (?, ?, ?, changes())
    `).bind(input.tenantId, input.operationKey, allocation.allocationKey));

    statements.push(input.db.prepare(`
      INSERT INTO InventoryConsumptionItem
        (ConsumptionId, ItemId, StockId, BatchNo, ExpiryDate, Quantity, Unit, CostPrice,
         ChargeAmount, IsChargeable, Remarks, CreatedBy, CreatedOn, OperationAllocationKey)
      VALUES (${headerIdSubquery()}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.operationKey,
      allocation.itemId,
      allocation.stock.StockId,
      allocation.stock.BatchNo ?? null,
      allocation.stock.ExpiryDate ?? null,
      allocation.quantity,
      allocation.itemUnit,
      allocation.costPrice,
      allocation.lineCharge,
      allocation.isChargeable ? 1 : 0,
      allocation.remarks,
      input.userId,
      input.transactionDate,
      allocation.allocationKey,
    ));

    statements.push(input.db.prepare(`
      INSERT INTO InventoryStockTransaction
        (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
         InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ${headerIdSubquery()}, 0, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      allocation.stock.StockId,
      allocation.itemId,
      input.fromStoreId,
      normalizeInventoryMovementType(input.issueType),
      input.issueNo,
      input.tenantId,
      input.operationKey,
      allocation.quantity,
      balanceAfterIssue,
      input.transactionDate,
      allocation.remarks,
      input.userId,
      input.transactionDate,
    ));

    statements.push(input.db.prepare(`
      INSERT INTO InventoryAuditLog
        (tenant_id, Action, EntityType, EntityId, ItemId, StockId, BatchNo, StoreId,
         ReferenceType, ReferenceId, OldValueJson, NewValueJson, UserId, CreatedOn)
      VALUES (?, 'stock_issue', 'InventoryConsumption', ${headerIdSubquery()}, ?, ?, ?, ?, ?,
        ${headerIdSubquery()}, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      input.tenantId,
      input.operationKey,
      allocation.itemId,
      allocation.stock.StockId,
      allocation.stock.BatchNo ?? null,
      input.fromStoreId,
      input.issueType,
      input.tenantId,
      input.operationKey,
      JSON.stringify({
        AvailableQuantity: snapshot.available,
        ReservedQuantity: snapshot.reserved,
        DamagedQuantity: snapshot.damaged,
        BlockedQuantity: snapshot.blocked,
      }),
      JSON.stringify({ AvailableQuantity: balanceAfterIssue, issuedQuantity: allocation.quantity }),
      input.userId,
      input.transactionDate,
    ));

    if (allocation.isChargeable && input.patientId && allocation.lineCharge > 0) {
      statements.push(input.db.prepare(`
        INSERT INTO billing_provisional_items
          (tenant_id, patient_id, admission_id, visit_id, item_category, item_name, department,
           unit_price, quantity, discount_percent, discount_amount, total_amount,
           reference_id, bill_status, is_insurance, is_active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ${itemIdSubquery()},
          'provisional', 0, 1, ?, datetime('now', '+6 hours'))
      `).bind(
        input.tenantId,
        input.patientId,
        input.admissionId ?? null,
        input.visitId ?? null,
        allocation.itemCategory,
        allocation.itemName,
        input.department ?? 'Inventory',
        allocation.unitCharge,
        allocation.quantity,
        allocation.lineCharge,
        input.tenantId,
        input.operationKey,
        allocation.allocationKey,
        input.userId,
      ));

      statements.push(input.db.prepare(`
        UPDATE InventoryConsumptionItem
        SET BillingReferenceId = last_insert_rowid()
        WHERE ConsumptionItemId = ${itemIdSubquery()}
      `).bind(input.tenantId, input.operationKey, allocation.allocationKey));
    }

    statements.push(input.db.prepare(`
      INSERT OR IGNORE INTO inventory_demand_source_event
        (tenant_id, inventory_item_id, demand_date, source_scope, source_type, source_id, quantity)
      VALUES (?, ?, ?, ?, 'inventory_issue_allocation', ?, ?)
    `).bind(
      input.tenantId,
      allocation.itemId,
      input.issueDate.slice(0, 10),
      input.issueType,
      demandSourceId,
      allocation.quantity,
    ));
  }

  const aggregateKeys = new Map<string, { itemId: number; demandDate: string; sourceScope: string }>();
  for (const allocation of input.allocations) {
    const demandDate = input.issueDate.slice(0, 10);
    const key = `${allocation.itemId}:${demandDate}:${input.issueType}`;
    aggregateKeys.set(key, { itemId: allocation.itemId, demandDate, sourceScope: input.issueType });
  }

  for (const aggregate of aggregateKeys.values()) {
    statements.push(input.db.prepare(`
      INSERT INTO inventory_demand_daily
        (tenant_id, inventory_item_id, demand_date, source_scope, consumed_qty, completed_event_count, updated_at)
      SELECT ?, ?, ?, ?, COALESCE(SUM(quantity), 0), COUNT(*), CURRENT_TIMESTAMP
      FROM inventory_demand_source_event
      WHERE tenant_id = ?
        AND inventory_item_id = ?
        AND demand_date = ?
        AND source_scope = ?
      ON CONFLICT(tenant_id, inventory_item_id, demand_date, source_scope) DO UPDATE SET
        consumed_qty = excluded.consumed_qty,
        completed_event_count = excluded.completed_event_count,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      input.tenantId,
      aggregate.itemId,
      aggregate.demandDate,
      aggregate.sourceScope,
      input.tenantId,
      aggregate.itemId,
      aggregate.demandDate,
      aggregate.sourceScope,
    ));
  }

  statements.push(input.db.prepare(`
    UPDATE InventoryConsumption
    SET TotalCost = ?,
        TotalCharge = ?,
        BillingStatus = ?,
        OperationStatus = 'completed'
    WHERE tenant_id = ? AND OperationKey = ? AND OperationStatus = 'processing'
  `).bind(totalCost, totalCharge, billingStatus, input.tenantId, input.operationKey));

  statements.push(input.db.prepare(`
    DELETE FROM inventory_issue_batch_guard
    WHERE tenant_id = ? AND operation_key = ?
  `).bind(input.tenantId, input.operationKey));

  return statements;
}

export async function commitAtomicInventoryIssue(
  input: AtomicInventoryIssueInput,
): Promise<AtomicInventoryIssueCommit> {
  if (input.allocations.length === 0) {
    throw new HTTPException(400, { message: 'Inventory issue requires at least one allocation.' });
  }

  const totalCost = input.allocations.reduce(
    (sum, allocation) => sum + allocation.costPrice * allocation.quantity,
    0,
  );
  const totalCharge = input.allocations.reduce((sum, allocation) => sum + allocation.lineCharge, 0);
  const billedLines = input.allocations.filter(
    (allocation) => allocation.isChargeable && Boolean(input.patientId) && allocation.lineCharge > 0,
  ).length;

  let batchResults: D1Result<unknown>[];
  try {
    batchResults = await input.db.batch(buildAtomicInventoryIssueStatements(input));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('assertion_value') || message.includes('inventory_issue_batch_guard')) {
      throw new HTTPException(409, {
        message: 'Stock changed while recording this inventory issue. Please refresh inventory and retry.',
      });
    }
    throw error;
  }

  const insertedConsumptionId = Number(
    (batchResults[0]?.meta as { last_row_id?: number } | undefined)?.last_row_id ?? 0,
  );
  if (insertedConsumptionId > 0) {
    return {
      consumptionId: insertedConsumptionId,
      issueNo: input.issueNo,
      totalCost,
      totalCharge,
      billedLines,
    };
  }

  const header = await input.db.prepare(`
    SELECT ConsumptionId, ConsumptionNo, TotalCost, TotalCharge
    FROM InventoryConsumption
    WHERE tenant_id = ? AND OperationKey = ? AND OperationStatus = 'completed'
    LIMIT 1
  `).bind(input.tenantId, input.operationKey).first<CommittedHeaderRow>();

  if (!header) {
    throw new HTTPException(500, { message: 'Atomic inventory issue committed but the header could not be loaded.' });
  }

  return {
    consumptionId: Number(header.ConsumptionId),
    issueNo: header.ConsumptionNo,
    totalCost: Number(header.TotalCost ?? totalCost),
    totalCharge: Number(header.TotalCharge ?? totalCharge),
    billedLines,
  };
}
