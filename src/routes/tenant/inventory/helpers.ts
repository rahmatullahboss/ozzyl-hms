import type { D1Database } from "@cloudflare/workers-types";
import type { Context } from "hono";
import { getDb } from "../../../db";
import type { Env } from "../../../types";
import { createAuditLog } from "../../../lib/accounting-helpers";

type StockTransactionInput = {
  tenantId: string;
  stockId: number;
  itemId: number;
  storeId: number;
  transactionType: string;
  referenceNo?: string | null;
  referenceId?: number | null;
  inQuantity?: number;
  outQuantity?: number;
  balanceQuantity: number;
  transactionDate?: string;
  remarks?: string | null;
  createdBy?: string | number | null;
};

type QrEntityType =
  | "item"
  | "stock"
  | "store"
  | "location"
  | "ward_stock"
  | "fixed_asset"
  | "purchase_order"
  | "goods_receipt";

export function stockTransactionStatement(db: ReturnType<typeof getDb>, input: StockTransactionInput): D1PreparedStatement {
  const transactionDate = input.transactionDate || new Date().toISOString();

  return db.$client.prepare(`
    INSERT INTO InventoryStockTransaction
      (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
       InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.stockId,
    input.itemId,
    input.storeId,
    input.transactionType,
    input.referenceNo || null,
    input.referenceId || null,
    input.inQuantity || 0,
    input.outQuantity || 0,
    input.balanceQuantity,
    transactionDate,
    input.remarks || null,
    input.createdBy ?? null,
    transactionDate,
  );
}

export async function getStockBalance(
  d1: D1Database,
  tenantId: string,
  stockId: number,
): Promise<number> {
  const row = await d1.prepare(
    "SELECT AvailableQuantity FROM InventoryStock WHERE StockId = ? AND tenant_id = ?"
  ).bind(stockId, tenantId).first<{ AvailableQuantity: number }>();

  return row?.AvailableQuantity ?? 0;
}

export function normalizeQrCode(code: string): string {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

export function makeInventoryQrCode(
  tenantId: string,
  entityType: QrEntityType,
  entityId: number,
  suffix?: string | number | null,
): string {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase() || "TENANT";
  const parts = ["HMS", safeTenant, entityType.replace("_", "").toUpperCase(), String(entityId)];
  if (suffix !== undefined && suffix !== null && String(suffix).length > 0) parts.push(String(suffix).replace(/[^a-zA-Z0-9]/g, "").toUpperCase());
  return normalizeQrCode(parts.join("-"));
}

export async function upsertQrTag(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string;
    tagCode: string;
    entityType: QrEntityType;
    entityId: number;
    humanLabel?: string | null;
    payload: Record<string, unknown>;
    createdBy?: string | number | null;
  },
): Promise<string> {
  const tagCode = normalizeQrCode(input.tagCode);
  const now = new Date().toISOString();

  await db.$client.prepare(`
    INSERT INTO InventoryQrTag
      (tenant_id, TagCode, EntityType, EntityId, HumanLabel, PayloadJson, Status, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    ON CONFLICT(tenant_id, TagCode) DO UPDATE SET
      EntityType = excluded.EntityType,
      EntityId = excluded.EntityId,
      HumanLabel = excluded.HumanLabel,
      PayloadJson = excluded.PayloadJson,
      Status = 'active',
      ModifiedBy = excluded.ModifiedBy,
      ModifiedOn = excluded.ModifiedOn
  `).bind(
    input.tenantId,
    tagCode,
    input.entityType,
    input.entityId,
    input.humanLabel || null,
    JSON.stringify(input.payload),
    input.createdBy ?? null,
    now,
    input.createdBy ?? null,
    now,
  ).run();

  return tagCode;
}

export async function logApproval(
  db: ReturnType<typeof getDb>,
  input: {
    tenantId: string;
    entityType: string;
    entityId: number;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    remarks?: string | null;
    performedBy?: string | number | null;
  },
): Promise<void> {
  await db.$client.prepare(`
    INSERT INTO InventoryApprovalLog
      (tenant_id, EntityType, EntityId, Action, FromStatus, ToStatus, Remarks, PerformedBy, PerformedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.entityId,
    input.action,
    input.fromStatus || null,
    input.toStatus || null,
    input.remarks || null,
    input.performedBy ?? null,
    new Date().toISOString(),
  ).run();
}

type InventoryAuditContext = Context<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>;

type InventoryAuditAction = "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "RECEIVE";

export async function createInventoryAuditLog(
  c: InventoryAuditContext,
  input: {
    tenantId: string;
    userId: string;
    action: InventoryAuditAction;
    eventType: string;
    tableName: string;
    recordId?: number;
    reason?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    whatChanged?: Record<string, unknown>;
  },
): Promise<void> {
  const ipAddress = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? undefined;
  const userAgent = c.req.header("user-agent") ?? undefined;
  const timestamp = new Date().toISOString();
  const device = {
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  };
  const before = input.before ? {
    auditEventType: input.eventType,
    timestamp,
    device,
    before: input.before,
    reason: input.reason ?? null,
  } : null;
  const after = input.after ? {
    auditEventType: input.eventType,
    whoChanged: input.userId,
    timestamp,
    device,
    whatChanged: input.whatChanged ?? {},
    ...(input.whatChanged ?? {}),
    before: input.before ?? null,
    after: input.after,
    reason: input.reason ?? null,
  } : null;

  try {
    await createAuditLog(
      c.env,
      input.tenantId,
      input.userId,
      input.action,
      input.tableName,
      input.recordId ?? 0,
      before,
      after,
      ipAddress,
      userAgent,
    );
  } catch (error) {
    console.warn('Inventory audit log write failed', {
      tenantId: input.tenantId,
      eventType: input.eventType,
      tableName: input.tableName,
      recordId: input.recordId ?? 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
