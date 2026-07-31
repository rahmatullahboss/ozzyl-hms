import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";

type Variables = { tenantId?: string; userId?: string; role?: string };
type ReportDefinition = {
  title: string;
  sql: (where: string) => string;
  baseConditions?: string[];
};

const reports = new Hono<{ Bindings: Env; Variables: Variables }>();

const reportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  StoreId: z.coerce.number().int().positive().optional(),
  ItemId: z.coerce.number().int().positive().optional(),
  PatientId: z.coerce.number().int().positive().optional(),
  Department: z.string().optional(),
  FromDate: z.string().optional(),
  ToDate: z.string().optional(),
  limit: z.coerce.number().int().positive().max(5000).default(500),
});

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(",")),
  ].join("\n");
}

const REPORTS: Record<string, ReportDefinition> = {
  current_stock: {
    title: "Current stock report",
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, I.ItemType, C.CategoryName, ST.StoreName, S.BatchNo, S.ExpiryDate,
             S.AvailableQuantity, COALESCE(S.ReservedQuantity, 0) AS ReservedQuantity,
             COALESCE(S.DamagedQuantity, 0) AS DamagedQuantity, S.CostPrice,
             (S.AvailableQuantity * S.CostPrice) AS StockValue, COALESCE(S.RackShelf, I.RackShelf) AS RackShelf
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
      ORDER BY I.ItemName, ST.StoreName, S.ExpiryDate
    `,
  },
  stock_valuation: {
    title: "Stock valuation report",
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, ST.StoreName,
             SUM(S.AvailableQuantity) AS Quantity,
             SUM(S.AvailableQuantity * S.CostPrice) AS StockValue
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
      GROUP BY I.ItemCode, I.ItemName, ST.StoreName
      ORDER BY StockValue DESC
    `,
  },
  low_stock: {
    title: "Low stock report",
    baseConditions: ["S.AvailableQuantity > 0", "S.AvailableQuantity <= I.ReOrderLevel"],
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, ST.StoreName, S.BatchNo, S.AvailableQuantity, I.ReOrderLevel
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
      ORDER BY S.AvailableQuantity ASC, I.ItemName
    `,
  },
  out_of_stock: {
    title: "Out of stock report",
    baseConditions: ["S.AvailableQuantity <= 0"],
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, ST.StoreName, S.BatchNo, S.AvailableQuantity
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
      ORDER BY I.ItemName
    `,
  },
  expiry: {
    title: "Expiry report",
    baseConditions: ["S.ExpiryDate IS NOT NULL"],
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, ST.StoreName, S.BatchNo, S.ExpiryDate, S.AvailableQuantity
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
      ORDER BY S.ExpiryDate ASC
    `,
  },
  expired_stock: {
    title: "Expired stock report",
    baseConditions: ["S.ExpiryDate IS NOT NULL", "S.ExpiryDate <= date('now')"],
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, ST.StoreName, S.BatchNo, S.ExpiryDate, S.AvailableQuantity, S.CostPrice
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
      ORDER BY S.ExpiryDate ASC
    `,
  },
  item_movement_ledger: {
    title: "Item movement ledger",
    sql: (where) => `
      SELECT T.TransactionDate, I.ItemCode, I.ItemName, ST.StoreName, T.TransactionType,
             T.ReferenceNo, T.InQuantity, T.OutQuantity, T.BalanceQuantity, T.Remarks
      FROM InventoryStockTransaction T
      JOIN InventoryItem I ON I.ItemId = T.ItemId AND I.tenant_id = T.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = T.StoreId AND ST.tenant_id = T.tenant_id
      WHERE ${where}
      ORDER BY T.TransactionDate DESC, T.TransactionId DESC
    `,
  },
  department_consumption: {
    title: "Department wise consumption",
    sql: (where) => `
      SELECT C.ConsumptionDate, C.Department, C.IssueType, I.ItemCode, I.ItemName,
             CI.BatchNo, CI.Quantity, CI.CostPrice, CI.ChargeAmount, C.TotalCost, C.TotalCharge
      FROM InventoryConsumption C
      JOIN InventoryConsumptionItem CI ON CI.ConsumptionId = C.ConsumptionId
      JOIN InventoryItem I ON I.ItemId = CI.ItemId AND I.tenant_id = C.tenant_id
      WHERE ${where}
      ORDER BY C.ConsumptionDate DESC, C.ConsumptionId DESC
    `,
  },
  patient_consumption: {
    title: "Patient wise consumption",
    sql: (where) => `
      SELECT C.ConsumptionDate, C.PatientId, C.AdmissionId, C.VisitId, C.Department, I.ItemCode, I.ItemName,
             CI.BatchNo, CI.Quantity, CI.ChargeAmount, C.BillingStatus
      FROM InventoryConsumption C
      JOIN InventoryConsumptionItem CI ON CI.ConsumptionId = C.ConsumptionId
      JOIN InventoryItem I ON I.ItemId = CI.ItemId AND I.tenant_id = C.tenant_id
      WHERE ${where}
      ORDER BY C.ConsumptionDate DESC, C.ConsumptionId DESC
    `,
  },
  stock_adjustment: {
    title: "Stock adjustment report",
    baseConditions: ["T.TransactionType IN ('adjustment-in','adjustment-out','adjustment_plus','adjustment_minus')"],
    sql: (where) => `
      SELECT T.TransactionDate, I.ItemCode, I.ItemName, ST.StoreName, T.TransactionType,
             T.InQuantity, T.OutQuantity, T.BalanceQuantity, T.Remarks, T.CreatedBy
      FROM InventoryStockTransaction T
      JOIN InventoryItem I ON I.ItemId = T.ItemId AND I.tenant_id = T.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = T.StoreId AND ST.tenant_id = T.tenant_id
      WHERE ${where}
      ORDER BY T.TransactionDate DESC
    `,
  },
  stock_count_variance: {
    title: "Stock count variance report",
    sql: (where) => `
      SELECT CS.CountNo, CS.CountDate, ST.StoreName, I.ItemCode, I.ItemName, CI.BatchNo,
             CI.SystemQuantity, CI.CountedQuantity, CI.DifferenceQuantity, CS.Status
      FROM InventoryStockCountSession CS
      JOIN InventoryStockCountItem CI ON CI.CountSessionId = CS.CountSessionId
      LEFT JOIN InventoryItem I ON I.ItemId = CI.ItemId AND I.tenant_id = CS.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = CS.StoreId AND ST.tenant_id = CS.tenant_id
      WHERE ${where}
      ORDER BY CS.CountDate DESC, CS.CountSessionId DESC
    `,
  },
  asset_register: {
    title: "Asset register",
    sql: (where) => `
      SELECT A.AssetCode, A.AssetName, A.SerialNo, A.AssetCategory, A.Department, A.Location,
             A.ResponsiblePerson, A.AssetStatus, A.PurchaseDate, A.PurchaseCost, A.WarrantyEndDate
      FROM InventoryFixedAssetStock A
      WHERE ${where}
      ORDER BY A.AssetName
    `,
  },
  asset_maintenance: {
    title: "Asset maintenance report",
    sql: (where) => `
      SELECT A.AssetCode, A.AssetName, A.Department, A.Location, A.LastMaintenanceDate,
             A.NextMaintenanceDate, A.AssetStatus
      FROM InventoryFixedAssetStock A
      WHERE ${where}
      ORDER BY A.NextMaintenanceDate ASC
    `,
  },
  fast_moving_items: {
    title: "Fast moving item report",
    baseConditions: ["T.OutQuantity > 0"],
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, SUM(T.OutQuantity) AS IssuedQuantity, COUNT(*) AS MovementCount
      FROM InventoryStockTransaction T
      JOIN InventoryItem I ON I.ItemId = T.ItemId AND I.tenant_id = T.tenant_id
      WHERE ${where}
      GROUP BY I.ItemCode, I.ItemName
      ORDER BY IssuedQuantity DESC
    `,
  },
  dead_stock: {
    title: "Dead stock report",
    sql: (where) => `
      SELECT I.ItemCode, I.ItemName, ST.StoreName, S.BatchNo, S.AvailableQuantity, S.CostPrice, S.CreatedOn
      FROM InventoryStock S
      JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
      LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
      WHERE ${where}
        AND NOT EXISTS (
          SELECT 1 FROM InventoryStockTransaction T
          WHERE T.tenant_id = S.tenant_id AND T.StockId = S.StockId AND T.OutQuantity > 0
        )
      ORDER BY S.CreatedOn ASC
    `,
  },
};

function tableAlias(reportType: string): string {
  if (["item_movement_ledger", "stock_adjustment", "fast_moving_items"].includes(reportType)) return "T";
  if (["department_consumption", "patient_consumption"].includes(reportType)) return "C";
  if (["stock_count_variance"].includes(reportType)) return "CS";
  if (["asset_register", "asset_maintenance"].includes(reportType)) return "A";
  return "S";
}

reports.get("/:reportType", zValidator("query", reportQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const reportType = c.req.param("reportType");
  const query = c.req.valid("query");
  const definition = REPORTS[reportType];
  if (!definition) {
    throw new HTTPException(400, { message: `Unsupported inventory report: ${reportType}` });
  }

  const alias = tableAlias(reportType);
  const conditions = [`${alias}.tenant_id = ?`, ...(definition.baseConditions || [])];
  const params: unknown[] = [tenantId];

  if (query.StoreId && !["department_consumption", "patient_consumption", "asset_register", "asset_maintenance"].includes(reportType)) {
    conditions.push(`${alias}.StoreId = ?`);
    params.push(query.StoreId);
  }
  if (query.ItemId && ["department_consumption", "patient_consumption"].includes(reportType)) {
    conditions.push("CI.ItemId = ?");
    params.push(query.ItemId);
  } else if (query.ItemId && reportType === "stock_count_variance") {
    conditions.push("CI.ItemId = ?");
    params.push(query.ItemId);
  } else if (query.ItemId && !["asset_register", "asset_maintenance"].includes(reportType)) {
    conditions.push(`${alias}.ItemId = ?`);
    params.push(query.ItemId);
  }
  if (query.PatientId && ["patient_consumption", "department_consumption"].includes(reportType)) {
    conditions.push("C.PatientId = ?");
    params.push(query.PatientId);
  }
  if (query.Department && ["department_consumption", "patient_consumption"].includes(reportType)) {
    conditions.push("C.Department = ?");
    params.push(query.Department);
  }

  const dateColumn = alias === "S" ? "S.CreatedOn"
    : alias === "T" ? "T.TransactionDate"
    : alias === "C" ? "C.ConsumptionDate"
    : alias === "CS" ? "CS.CountDate"
    : "A.CreatedOn";
  if (query.FromDate) { conditions.push(`${dateColumn} >= ?`); params.push(query.FromDate); }
  if (query.ToDate) { conditions.push(`${dateColumn} <= ?`); params.push(query.ToDate); }

  const sql = `${definition.sql(conditions.join(" AND "))} LIMIT ?`;
  const db = getDb(c.env.DB);
  const result = await db.$client.prepare(sql).bind(...params, query.limit).all<Record<string, unknown>>();
  const rows = result.results || [];

  if (query.format === "csv") {
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inventory-${reportType}.csv"`,
      },
    });
  }

  return c.json({
    reportType,
    title: definition.title,
    generatedAt: new Date().toISOString(),
    data: rows,
  });
});

export default reports;
