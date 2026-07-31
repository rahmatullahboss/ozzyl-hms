import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db';
import { generateSequenceNo } from '../utils/sequence';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from './accounting-posting';
import { commitAtomicInventoryIssue, type AtomicInventoryIssueAllocation } from './inventory-issue-atomic';
import {
  completeInventoryIssueOperation,
  failInventoryIssueOperation,
  markInventoryIssueOperationProcessing,
  reserveInventoryIssueOperation,
} from './inventory-issue-operation';
import { getStockIssueBlockReason, selectFefoStockAllocations } from './inventory-core';
import { scheduleInventoryIntelligenceRecompute } from './inventory-intelligence/triggers';
import { createIdempotencyRequestHash } from './request-idempotency';

export type InventoryIssueType =
  | 'department_issue'
  | 'patient_issue'
  | 'ot_consumption'
  | 'emergency_issue'
  | 'lab_consumption'
  | 'pharmacy_sale'
  | 'asset_issue';

export type CreateInventoryIssueItem = {
  ItemId: number;
  StockId?: number;
  BatchNo?: string;
  Quantity: number;
  Chargeable?: boolean;
  ChargeAmount?: number;
  Remarks?: string;
};

export type CreateInventoryIssuePayload = {
  IssueType: InventoryIssueType;
  FromStoreId: number;
  ToDepartment?: string;
  DepartmentId?: number;
  PatientId?: number;
  AdmissionId?: number;
  VisitId?: number;
  SurgeryId?: number;
  LabOrderId?: number;
  BillingReferenceId?: number;
  RequestedBy?: string;
  ApprovedBy?: string;
  Chargeable?: boolean;
  Remarks?: string;
  IdempotencyKey?: string;
  Items: CreateInventoryIssueItem[];
};

export type InventoryIssueResult = {
  message: string;
  ConsumptionId: number;
  IssueNo: string;
  OperationKey: string;
  totalCost: number;
  totalCharge: number;
  billedLines: number;
  replayed: boolean;
};

export const INVENTORY_ISSUE_MAX_INPUT_ITEMS = 50;
export const INVENTORY_ISSUE_MAX_ALLOCATIONS = 75;

export type CreateInventoryIssueContext = {
  db: D1Database;
  tenantId: string;
  userId: string;
  idempotencyKey?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type ResolvedStockAllocation = {
  stock: any;
  quantity: number;
};

function todayIso(): string {
  return new Date().toISOString();
}

function todayDate(): string {
  return todayIso().slice(0, 10);
}

function chargeFor(itemCharge: number | undefined, item: any): number {
  const fallback = Number(item?.SalePrice ?? item?.MRP ?? item?.StandardRate ?? 0);
  return Number(itemCharge ?? fallback ?? 0);
}

function validateOperationKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 128) {
    throw new HTTPException(400, { message: 'Inventory issue idempotency key must be between 8 and 128 characters.' });
  }
  return normalized;
}

async function getItemMaster(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  itemId: number,
): Promise<any> {
  return db.$client.prepare('SELECT * FROM InventoryItem WHERE tenant_id = ? AND ItemId = ?')
    .bind(tenantId, itemId)
    .first<any>();
}

async function getItemCategory(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  itemMaster: any,
): Promise<string> {
  if (!itemMaster?.ItemCategoryId) return 'other';
  const category = await db.$client.prepare(`
    SELECT CategoryName
    FROM InventoryItemCategory
    WHERE ItemCategoryId = ? AND tenant_id = ?
    LIMIT 1
  `).bind(itemMaster.ItemCategoryId, tenantId).first<{ CategoryName?: string | null }>();
  return category?.CategoryName || 'other';
}

async function resolveIssueStock(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  item: CreateInventoryIssueItem,
  fromStoreId: number,
): Promise<ResolvedStockAllocation[]> {
  if (item.StockId) {
    const stock = await db.$client.prepare(
      'SELECT * FROM InventoryStock WHERE StockId = ? AND tenant_id = ?',
    ).bind(item.StockId, tenantId).first<any>();
    if (!stock) throw new HTTPException(400, { message: `Stock not found for item ${item.ItemId}` });
    if (Number(stock.ItemId) !== item.ItemId) {
      throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to item ${item.ItemId}` });
    }
    if (Number(stock.StoreId) !== fromStoreId) {
      throw new HTTPException(400, { message: `Stock ${item.StockId} does not belong to source store ${fromStoreId}` });
    }
    const reason = getStockIssueBlockReason(stock, item.Quantity);
    if (reason) throw new HTTPException(400, { message: `${reason} for item ${item.ItemId}` });
    return [{ stock, quantity: item.Quantity }];
  }

  const rows = await db.$client.prepare(`
    SELECT *
    FROM InventoryStock
    WHERE tenant_id = ? AND ItemId = ? AND StoreId = ?
      AND COALESCE(IsActive, 1) = 1
      AND AvailableQuantity > 0
      AND (? IS NULL OR BatchNo = ?)
    ORDER BY CASE WHEN ExpiryDate IS NULL OR ExpiryDate = '' THEN 1 ELSE 0 END, ExpiryDate ASC, StockId ASC
  `).bind(tenantId, item.ItemId, fromStoreId, item.BatchNo || null, item.BatchNo || null).all<any>();

  const allocations = selectFefoStockAllocations(rows.results || [], item.Quantity);
  return allocations.map((allocation) => {
    const stock = (rows.results || []).find((row: any) => Number(row.StockId) === allocation.stockId);
    return { stock, quantity: allocation.quantity };
  }).filter((entry) => entry.stock);
}

async function runPostCommitProjections(
  context: CreateInventoryIssueContext,
  result: InventoryIssueResult,
  body: CreateInventoryIssuePayload,
  issueDate: string,
): Promise<void> {
  try {
    await recordAccountingPostingEvent(context.db, {
      tenantId: context.tenantId,
      sourceType: 'inventory_consumption',
      sourceId: String(result.ConsumptionId),
      eventType: ACCOUNTING_EVENT_TYPES.inventoryConsumption,
      eventDate: issueDate,
      createdBy: context.userId,
      payload: {
        totalCost: result.totalCost,
        departmentId: body.DepartmentId ?? null,
      },
    });
  } catch (error) {
    console.error('Failed to record inventory consumption accounting event:', error);
  }

  const posting = postPendingAccountingEvents(context.db, context.tenantId, 20).catch((error) => {
    console.error('Failed to post inventory consumption accounting event:', error);
  });
  if (context.waitUntil) {
    try {
      context.waitUntil(posting);
    } catch {
      void posting;
    }
  } else {
    void posting;
  }

  const db = getDb(context.db);
  scheduleInventoryIntelligenceRecompute({
    dbClient: db.$client,
    tenantId: context.tenantId,
    waitUntil: context.waitUntil,
  });
}

export async function createInventoryIssue(
  context: CreateInventoryIssueContext,
  body: CreateInventoryIssuePayload,
): Promise<InventoryIssueResult> {
  if (!Array.isArray(body.Items) || body.Items.length === 0) {
    throw new HTTPException(400, { message: 'Inventory issue requires at least one item.' });
  }
  if (body.Items.length > INVENTORY_ISSUE_MAX_INPUT_ITEMS) {
    throw new HTTPException(400, {
      message: `Inventory issue cannot contain more than ${INVENTORY_ISSUE_MAX_INPUT_ITEMS} items.`,
    });
  }

  const suppliedOperationKey = context.idempotencyKey ?? body.IdempotencyKey;
  const operationKey = suppliedOperationKey
    ? validateOperationKey(suppliedOperationKey)
    : crypto.randomUUID();
  const { IdempotencyKey: _ignoredIdempotencyKey, ...hashBody } = body;
  const requestHash = await createIdempotencyRequestHash({ tenantId: context.tenantId, body: hashBody });

  const reservation = await reserveInventoryIssueOperation(context.db, {
    tenantId: context.tenantId,
    idempotencyKey: operationKey,
    requestHash,
    createdBy: context.userId,
  });
  if (reservation.state === 'replay') {
    return reservation.responseBody as InventoryIssueResult;
  }

  let coreCommitted = false;
  try {
    await markInventoryIssueOperationProcessing(context.db, {
      tenantId: context.tenantId,
      idempotencyKey: operationKey,
      requestHash,
    });

    const tenantId = context.tenantId;
    const userId = context.userId;
    const db = getDb(context.db);
    const issueDate = todayDate();
    const transactionDate = todayIso();
    const issueNo = await generateSequenceNo(context.db, 'ISS', 'InventoryConsumption', 'ConsumptionNo', tenantId);
    const headerChargeable = Boolean(body.Chargeable || body.IssueType === 'patient_issue');
    const atomicAllocations: AtomicInventoryIssueAllocation[] = [];

    for (let lineIndex = 0; lineIndex < body.Items.length; lineIndex += 1) {
      const item = body.Items[lineIndex];
      const itemMaster = await getItemMaster(db, tenantId, item.ItemId);
      if (!itemMaster) throw new HTTPException(404, { message: `Item not found: ${item.ItemId}` });

      const allocations = await resolveIssueStock(db, tenantId, item, body.FromStoreId);
      const isChargeable = item.Chargeable ?? headerChargeable;
      const unitCharge = chargeFor(item.ChargeAmount, itemMaster);
      const itemCategory = await getItemCategory(db, tenantId, itemMaster);

      for (let allocationIndex = 0; allocationIndex < allocations.length; allocationIndex += 1) {
        const allocation = allocations[allocationIndex];
        const costPrice = Number(
          allocation.stock.CostPrice ?? itemMaster.PurchasePrice ?? itemMaster.StandardRate ?? 0,
        );
        atomicAllocations.push({
          allocationKey: `line-${lineIndex}-allocation-${allocationIndex}-stock-${allocation.stock.StockId}`,
          itemId: item.ItemId,
          itemName: itemMaster.ItemName ?? `Inventory item ${item.ItemId}`,
          itemCategory,
          itemUnit: itemMaster.IssueUnit ?? itemMaster.PurchaseUnit ?? null,
          stock: allocation.stock,
          quantity: allocation.quantity,
          costPrice,
          unitCharge,
          lineCharge: isChargeable ? unitCharge * allocation.quantity : 0,
          isChargeable,
          remarks: item.Remarks ?? body.Remarks ?? null,
        });
      }
    }

    if (atomicAllocations.length > INVENTORY_ISSUE_MAX_ALLOCATIONS) {
      throw new HTTPException(400, {
        message: `Inventory issue resolved to more than ${INVENTORY_ISSUE_MAX_ALLOCATIONS} stock allocations. Split it into smaller requests.`,
      });
    }

    const committed = await commitAtomicInventoryIssue({
      db: context.db,
      tenantId,
      userId,
      operationKey,
      issueNo,
      issueDate,
      transactionDate,
      issueType: body.IssueType,
      fromStoreId: body.FromStoreId,
      departmentId: body.DepartmentId ?? null,
      department: body.ToDepartment ?? null,
      patientId: body.PatientId ?? null,
      admissionId: body.AdmissionId ?? null,
      visitId: body.VisitId ?? null,
      surgeryId: body.SurgeryId ?? null,
      labOrderId: body.LabOrderId ?? null,
      billingReferenceId: body.BillingReferenceId ?? null,
      chargeable: headerChargeable,
      remarks: body.Remarks ?? null,
      allocations: atomicAllocations,
    });
    coreCommitted = true;

    const result: InventoryIssueResult = {
      message: 'Inventory issue recorded',
      ConsumptionId: committed.consumptionId,
      IssueNo: committed.issueNo,
      OperationKey: operationKey,
      totalCost: committed.totalCost,
      totalCharge: committed.totalCharge,
      billedLines: committed.billedLines,
      replayed: false,
    };

    try {
      await completeInventoryIssueOperation(context.db, {
        tenantId,
        idempotencyKey: operationKey,
        requestHash,
        consumptionId: result.ConsumptionId,
        issueNo: result.IssueNo,
        responseBody: result,
      });
    } catch (error) {
      console.error('Inventory issue committed but operation journal completion failed:', error);
    }

    await runPostCommitProjections(context, result, body, issueDate);
    return result;
  } catch (error) {
    if (!coreCommitted) {
      const message = error instanceof Error ? error.message : 'Inventory issue failed';
      try {
        await failInventoryIssueOperation(context.db, {
          tenantId: context.tenantId,
          idempotencyKey: operationKey,
          requestHash,
          error: message,
        });
      } catch (journalError) {
        console.error('Failed to mark inventory issue operation failed:', journalError);
      }
    }
    throw error;
  }
}
