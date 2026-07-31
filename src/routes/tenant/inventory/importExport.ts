import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";
import { createInventoryAuditLog } from "./helpers";
import { mirrorInventoryLabReagentReceipt } from "../../../lib/lab-inventory-bridge";

type Variables = { tenantId?: string; userId?: string; role?: string };

const importExport = new Hono<{ Bindings: Env; Variables: Variables }>();

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
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(",")),
  ].join("\n");
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

// ─── Export Items ──────────────────────────────────────────────────────
importExport.get("/export/items", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const result = await db.$client.prepare(`
    SELECT I.ItemCode, I.ItemName, I.ItemType, I.GenericName, I.BrandName,
           C.CategoryName, U.UOMName, I.StandardRate, I.PurchasePrice, I.SalePrice,
           I.ReOrderLevel, I.MinStockQuantity, I.MaxStockQuantity,
           I.IsBatchRequired, I.IsExpiryRequired, I.IsActive
    FROM InventoryItem I
    LEFT JOIN InventoryItemCategory C ON C.ItemCategoryId = I.ItemCategoryId AND C.tenant_id = I.tenant_id
    LEFT JOIN InventoryUnitOfMeasurement U ON U.UOMId = I.UOMId AND U.tenant_id = I.tenant_id
    WHERE I.tenant_id = ?
    ORDER BY I.ItemName
  `).bind(tenantId).all<Record<string, unknown>>();

  return new Response(toCsv(result.results || []), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inventory-items-export.csv"',
    },
  });
});

// ─── Export Stock ──────────────────────────────────────────────────────
importExport.get("/export/stock", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const result = await db.$client.prepare(`
    SELECT I.ItemCode, I.ItemName, ST.StoreName, S.BatchNo, S.ExpiryDate,
           S.AvailableQuantity, S.CostPrice, S.MRP,
           COALESCE(S.ReservedQuantity, 0) AS ReservedQuantity,
           COALESCE(S.DamagedQuantity, 0) AS DamagedQuantity
    FROM InventoryStock S
    JOIN InventoryItem I ON I.ItemId = S.ItemId AND I.tenant_id = S.tenant_id
    LEFT JOIN InventoryStore ST ON ST.StoreId = S.StoreId AND ST.tenant_id = S.tenant_id
    WHERE S.tenant_id = ?
    ORDER BY I.ItemName, ST.StoreName, S.BatchNo
  `).bind(tenantId).all<Record<string, unknown>>();

  return new Response(toCsv(result.results || []), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inventory-stock-export.csv"',
    },
  });
});

// ─── Export Vendors ────────────────────────────────────────────────────
importExport.get("/export/vendors", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const result = await db.$client.prepare(`
    SELECT VendorCode, VendorName, ContactPerson, ContactPhone, ContactEmail,
           ContactAddress, City, Country, PANNo, CreditPeriod, IsActive
    FROM InventoryVendor
    WHERE tenant_id = ?
    ORDER BY VendorName
  `).bind(tenantId).all<Record<string, unknown>>();

  return new Response(toCsv(result.results || []), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="inventory-vendors-export.csv"',
    },
  });
});

// ─── Import Items ──────────────────────────────────────────────────────
const importItemsBodySchema = z.object({
  csv: z.string().min(1),
});

importExport.post("/import/items", zValidator("json", importItemsBodySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const { csv } = c.req.valid("json");

  const rows = parseCsv(csv);
  if (rows.length === 0) throw new HTTPException(400, { message: "No data rows found in CSV" });

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Pre-fetch categories and UOMs for name→id resolution
  const categories = await db.$client.prepare("SELECT ItemCategoryId, CategoryName FROM InventoryItemCategory WHERE tenant_id = ?")
    .bind(tenantId).all<{ ItemCategoryId: number; CategoryName: string }>();
  const uoms = await db.$client.prepare("SELECT UOMId, UOMName FROM InventoryUnitOfMeasurement WHERE tenant_id = ?")
    .bind(tenantId).all<{ UOMId: number; UOMName: string }>();
  const catMap = new Map((categories.results || []).map(c => [c.CategoryName.toLowerCase(), c.ItemCategoryId]));
  const uomMap = new Map((uoms.results || []).map(u => [u.UOMName.toLowerCase(), u.UOMId]));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const itemName = row.ItemName?.trim();
    if (!itemName) { skipped++; errors.push(`Row ${i + 2}: Missing ItemName`); continue; }

    // Check duplicate by ItemCode or ItemName
    const itemCode = row.ItemCode?.trim() || null;
    if (itemCode) {
      const existing = await db.$client.prepare("SELECT ItemId FROM InventoryItem WHERE tenant_id = ? AND ItemCode = ?")
        .bind(tenantId, itemCode).first();
      if (existing) { skipped++; continue; }
    }

    const categoryId = row.CategoryName ? catMap.get(row.CategoryName.toLowerCase()) ?? null : null;
    const uomId = row.UOMName ? uomMap.get(row.UOMName.toLowerCase()) ?? null : null;

    await db.$client.prepare(`
      INSERT INTO InventoryItem (
        tenant_id, ItemName, ItemCode, ItemType, GenericName, BrandName,
        ItemCategoryId, UOMId, StandardRate, PurchasePrice, SalePrice,
        ReOrderLevel, MinStockQuantity, MaxStockQuantity,
        IsBatchRequired, IsExpiryRequired, IsActive, CreatedBy, CreatedOn
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      itemName,
      itemCode,
      row.ItemType?.trim() || "consumable",
      row.GenericName?.trim() || null,
      row.BrandName?.trim() || null,
      categoryId,
      uomId,
      Number(row.StandardRate || 0),
      Number(row.PurchasePrice || 0),
      Number(row.SalePrice || 0),
      Number(row.ReOrderLevel || 10),
      Number(row.MinStockQuantity || 5),
      Number(row.MaxStockQuantity || 0),
      row.IsBatchRequired?.toLowerCase() === "yes" ? 1 : 0,
      row.IsExpiryRequired?.toLowerCase() === "yes" ? 1 : 0,
      row.IsActive?.toLowerCase() === "no" ? 0 : 1,
      userId,
      new Date().toISOString(),
    ).run();
    created++;
  }

  return c.json({ message: "Import completed", created, skipped, total: rows.length, errors: errors.slice(0, 20) });
});

// ─── Import Vendors ────────────────────────────────────────────────────
importExport.post("/import/vendors", zValidator("json", importItemsBodySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const { csv } = c.req.valid("json");

  const rows = parseCsv(csv);
  if (rows.length === 0) throw new HTTPException(400, { message: "No data rows found in CSV" });

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vendorName = row.VendorName?.trim();
    if (!vendorName) { skipped++; errors.push(`Row ${i + 2}: Missing VendorName`); continue; }

    const vendorCode = row.VendorCode?.trim() || null;
    if (vendorCode) {
      const existing = await db.$client.prepare("SELECT VendorId FROM InventoryVendor WHERE tenant_id = ? AND VendorCode = ?")
        .bind(tenantId, vendorCode).first();
      if (existing) { skipped++; continue; }
    }

    await db.$client.prepare(`
      INSERT INTO InventoryVendor (
        tenant_id, VendorName, VendorCode, ContactPerson, ContactPhone, ContactEmail,
        ContactAddress, City, Country, PANNo, CreditPeriod, IsActive, CreatedBy, CreatedOn
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      vendorName,
      vendorCode,
      row.ContactPerson?.trim() || null,
      row.ContactPhone?.trim() || null,
      row.ContactEmail?.trim() || null,
      row.ContactAddress?.trim() || null,
      row.City?.trim() || null,
      row.Country?.trim() || null,
      row.PANNo?.trim() || null,
      Number(row.CreditPeriod || 30),
      row.IsActive?.toLowerCase() === "no" ? 0 : 1,
      userId,
      new Date().toISOString(),
    ).run();
    created++;
  }

  return c.json({ message: "Import completed", created, skipped, total: rows.length, errors: errors.slice(0, 20) });
});

// ─── Import Opening Stock ───────────────────────────────────────────────
const openingStockImportBodySchema = z.object({
  csv: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
});

const OPENING_STOCK_REQUIRED_FIELDS = [
  "item_code",
  "store_code",
  "lot_number",
  "batch_number",
  "expiry_date",
  "quantity",
  "unit_cost",
  "supplier_code",
] as const;

const OPENING_STOCK_FIELD_ALIASES: Record<string, string[]> = {
  item_code: ["item_code", "ItemCode", "itemCode", "ItemName"],
  store_code: ["store_code", "StoreCode", "storeCode", "StoreName"],
  lot_number: ["lot_number", "LotNumber", "LotNo", "LotNo."],
  batch_number: ["batch_number", "BatchNo", "BatchNumber", "batch_no"],
  expiry_date: ["expiry_date", "ExpiryDate", "expiry"],
  quantity: ["quantity", "Quantity", "AvailableQuantity", "available_quantity"],
  unit_cost: ["unit_cost", "CostPrice", "PurchasePrice", "ItemRate", "cost_price"],
  supplier_code: ["supplier_code", "SupplierCode", "VendorCode", "SupplierName", "VendorName"],
  mrp: ["mrp", "MRP", "SalePrice", "sale_price"],
  remarks: ["remarks", "Remarks", "notes", "Notes"],
};

type OpeningStockRow = {
  rowNumber: number;
  itemKey: string;
  storeKey: string;
  lotNumber: string | null;
  batchNo: string;
  expiryDate: string | null;
  quantity: number;
  unitCost: number;
  mrp: number;
  supplierKey: string | null;
  rawBatchNo: string;
  remarks: string;
};

function normalizeCsvKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readCsvValue(row: Record<string, string>, aliases: string[]): string {
  for (const key of aliases) {
    const direct = row[key];
    if (direct !== undefined && String(direct).trim() !== "") return String(direct).trim();
  }

  const normalized = new Map(Object.keys(row).map(key => [normalizeCsvKey(key), row[key]]));
  for (const key of aliases) {
    const value = normalized.get(normalizeCsvKey(key));
    if (value !== undefined && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function parsePositiveCsvNumber(value: string | undefined, field: string, rowNumber: number): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Row ${rowNumber}: ${field} must be greater than zero`);
  }
  return parsed;
}

function parseNonNegativeCsvNumber(value: string | undefined, field: string, rowNumber: number, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Row ${rowNumber}: ${field} must be zero or positive`);
  }
  return parsed;
}

function normalizeDateOrNull(value: string, field: string, rowNumber: number): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Row ${rowNumber}: ${field} must use YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Row ${rowNumber}: ${field} is not a valid calendar date`);
  }
  return value;
}

function makeCsvFingerprint(csv: string): string {
  let hash = 2166136261;
  for (let i = 0; i < csv.length; i++) {
    hash ^= csv.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function parseCsvHeaders(text: string): string[] {
  const firstLine = text.split(/\r?\n/).find(line => line.trim());
  return firstLine ? parseCsvLine(firstLine) : [];
}

function validateOpeningStockHeaders(headers: string[]): string[] {
  const warnings: string[] = [];
  const normalizedHeaders = new Set(headers.map(normalizeCsvKey));
  for (const field of OPENING_STOCK_REQUIRED_FIELDS) {
    const hasField = OPENING_STOCK_FIELD_ALIASES[field].some(alias => normalizedHeaders.has(normalizeCsvKey(alias)));
    if (!hasField) warnings.push(`CSV is missing recommended opening stock column: ${field}`);
  }
  return warnings;
}

function normalizeOpeningStockRow(row: Record<string, string>, rowNumber: number): OpeningStockRow {
  const itemKey = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.item_code);
  const storeKey = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.store_code);
  const lotNumber = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.lot_number) || null;
  const rawBatchNo = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.batch_number);
  const batchNo = rawBatchNo || lotNumber || "OPENING";
  const rawExpiryDate = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.expiry_date);
  const quantity = parsePositiveCsvNumber(readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.quantity), "quantity", rowNumber);
  const unitCost = parsePositiveCsvNumber(readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.unit_cost), "unit_cost", rowNumber);
  const mrp = parseNonNegativeCsvNumber(readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.mrp), "mrp", rowNumber, unitCost);
  const supplierKey = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.supplier_code) || null;
  const remarks = readCsvValue(row, OPENING_STOCK_FIELD_ALIASES.remarks) || "Opening stock import";

  if (!itemKey) throw new Error(`Row ${rowNumber}: item_code is required`);
  if (!storeKey) throw new Error(`Row ${rowNumber}: store_code is required`);
  if (!batchNo) throw new Error(`Row ${rowNumber}: batch_number or lot_number is required`);

  return {
    rowNumber,
    itemKey,
    storeKey,
    lotNumber,
    batchNo,
    expiryDate: normalizeDateOrNull(rawExpiryDate, "expiry_date", rowNumber),
    quantity,
    unitCost,
    mrp,
    supplierKey,
    rawBatchNo,
    remarks,
  };
}

importExport.post("/import/opening-stock/validate", zValidator("json", openingStockImportBodySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const { csv } = c.req.valid("json");
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new HTTPException(400, { message: "No data rows found in CSV" });

  const errors: string[] = [];
  const warnings = validateOpeningStockHeaders(parseCsvHeaders(csv));
  let totalStockValue = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    try {
      const row = normalizeOpeningStockRow(rows[i], rowNumber);
      totalStockValue += row.quantity * row.unitCost;

      const item = await db.$client.prepare(`
        SELECT ItemId
        FROM InventoryItem
        WHERE tenant_id = ? AND (ItemCode = ? OR LOWER(ItemName) = LOWER(?)) AND COALESCE(IsActive, 1) = 1
        LIMIT 1
      `).bind(tenantId, row.itemKey, row.itemKey).first<{ ItemId: number }>();
      if (!item?.ItemId) errors.push(`Row ${rowNumber}: inventory item not found or inactive (${row.itemKey})`);

      const store = await db.$client.prepare(`
        SELECT StoreId
        FROM InventoryStore
        WHERE tenant_id = ? AND (StoreCode = ? OR LOWER(StoreName) = LOWER(?)) AND COALESCE(IsActive, 1) = 1
        LIMIT 1
      `).bind(tenantId, row.storeKey, row.storeKey).first<{ StoreId: number }>();
      if (!store?.StoreId) errors.push(`Row ${rowNumber}: inventory store not found or inactive (${row.storeKey})`);

      if (item?.ItemId && store?.StoreId) {
        const duplicate = await db.$client.prepare(`
          SELECT StockId
          FROM InventoryStock
          WHERE tenant_id = ? AND ItemId = ? AND StoreId = ?
            AND COALESCE(LotNumber, '') = ?
            AND COALESCE(BatchNo, '') = ?
            AND COALESCE(ExpiryDate, '') = ?
          LIMIT 1
        `).bind(tenantId, item.ItemId, store.StoreId, row.lotNumber ?? "", row.batchNo, row.expiryDate ?? "").first<{ StockId: number }>();
        if (duplicate?.StockId) {
          errors.push(`Row ${rowNumber}: duplicate stock lot already exists for ${row.itemKey}/${row.storeKey}/${row.lotNumber ?? "NO-LOT"}/${row.batchNo}`);
        }
      }

      if (row.supplierKey) {
        const supplier = await db.$client.prepare(`
          SELECT VendorId
          FROM InventoryVendor
          WHERE tenant_id = ? AND (VendorCode = ? OR LOWER(VendorName) = LOWER(?)) AND COALESCE(IsActive, 1) = 1
          LIMIT 1
        `).bind(tenantId, row.supplierKey, row.supplierKey).first<{ VendorId: number }>();
        if (!supplier?.VendorId) errors.push(`Row ${rowNumber}: supplier not found or inactive (${row.supplierKey})`);
      } else {
        warnings.push(`Row ${rowNumber}: supplier_code is recommended for opening stock audit trail`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Row ${rowNumber}: validation failed`);
    }
  }

  return c.json({
    message: errors.length === 0 ? "Opening stock CSV validation passed" : "Opening stock CSV validation failed",
    valid: errors.length === 0,
    total: rows.length,
    totalStockValue,
    fileHash: makeCsvFingerprint(csv),
    errors: errors.slice(0, 50),
    warnings: warnings.slice(0, 50),
  });
});

importExport.post("/import/opening-stock", zValidator("json", openingStockImportBodySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const { csv, dryRun } = c.req.valid("json");
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new HTTPException(400, { message: "No data rows found in CSV" });

  let created = 0;
  let skipped = 0;
  let mirroredLabReagents = 0;
  let totalStockValue = 0;
  const createdStockIds: number[] = [];
  const errors: string[] = [];
  const warnings = validateOpeningStockHeaders(parseCsvHeaders(csv));
  const now = new Date().toISOString();
  const referenceNo = `OS-${now.slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`;
  const fileHash = makeCsvFingerprint(csv);

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;

    try {
      const row = normalizeOpeningStockRow(rows[i], rowNumber);
      totalStockValue += row.quantity * row.unitCost;

      const item = await db.$client.prepare(`
        SELECT ItemId, ItemName, ItemCode, ItemType, IsBatchRequired, IsExpiryRequired
        FROM InventoryItem
        WHERE tenant_id = ? AND (ItemCode = ? OR LOWER(ItemName) = LOWER(?)) AND COALESCE(IsActive, 1) = 1
        LIMIT 1
      `).bind(tenantId, row.itemKey, row.itemKey).first<{
        ItemId: number;
        ItemName: string;
        ItemCode?: string | null;
        ItemType?: string | null;
        IsBatchRequired?: number | null;
        IsExpiryRequired?: number | null;
      }>();
      if (!item?.ItemId) throw new Error(`Row ${rowNumber}: inventory item not found or inactive (${row.itemKey})`);

      if (Number(item.IsBatchRequired ?? 0) === 1 && !row.rawBatchNo) {
        throw new Error(`Row ${rowNumber}: batch_number is required for ${item.ItemCode ?? row.itemKey}`);
      }
      if (Number(item.IsExpiryRequired ?? 0) === 1 && !row.expiryDate) {
        throw new Error(`Row ${rowNumber}: expiry_date is required for ${item.ItemCode ?? row.itemKey}`);
      }

      const store = await db.$client.prepare(`
        SELECT StoreId, StoreName, StoreCode
        FROM InventoryStore
        WHERE tenant_id = ? AND (StoreCode = ? OR LOWER(StoreName) = LOWER(?)) AND COALESCE(IsActive, 1) = 1
        LIMIT 1
      `).bind(tenantId, row.storeKey, row.storeKey).first<{ StoreId: number; StoreName: string; StoreCode?: string | null }>();
      if (!store?.StoreId) throw new Error(`Row ${rowNumber}: inventory store not found or inactive (${row.storeKey})`);

      let supplier: { VendorId: number; VendorCode?: string | null; VendorName?: string | null } | null = null;
      if (row.supplierKey) {
        supplier = await db.$client.prepare(`
          SELECT VendorId, VendorCode, VendorName
          FROM InventoryVendor
          WHERE tenant_id = ? AND (VendorCode = ? OR LOWER(VendorName) = LOWER(?)) AND COALESCE(IsActive, 1) = 1
          LIMIT 1
        `).bind(tenantId, row.supplierKey, row.supplierKey).first<{ VendorId: number; VendorCode?: string | null; VendorName?: string | null }>();
        if (!supplier?.VendorId) throw new Error(`Row ${rowNumber}: supplier not found or inactive (${row.supplierKey})`);
      } else {
        warnings.push(`Row ${rowNumber}: supplier_code is recommended for opening stock audit trail`);
      }

      const duplicate = await db.$client.prepare(`
        SELECT StockId
        FROM InventoryStock
        WHERE tenant_id = ? AND ItemId = ? AND StoreId = ?
          AND COALESCE(LotNumber, '') = ?
          AND COALESCE(BatchNo, '') = ?
          AND COALESCE(ExpiryDate, '') = ?
        LIMIT 1
      `).bind(tenantId, item.ItemId, store.StoreId, row.lotNumber ?? "", row.batchNo, row.expiryDate ?? "").first<{ StockId: number }>();
      if (duplicate?.StockId) {
        skipped++;
        errors.push(`Row ${rowNumber}: duplicate stock lot already exists for ${row.itemKey}/${row.storeKey}/${row.lotNumber ?? "NO-LOT"}/${row.batchNo}`);
        continue;
      }

      if (dryRun) {
        created++;
        continue;
      }

      const auditRemarks = [
        row.remarks,
        row.lotNumber ? `Lot: ${row.lotNumber}` : null,
        row.supplierKey ? `Supplier: ${row.supplierKey}` : null,
        `Opening Ref: ${referenceNo}`,
      ].filter(Boolean).join(" | ");

      const stockInsert = db.$client.prepare(`
        INSERT INTO InventoryStock
          (tenant_id, ItemId, StoreId, LotNumber, BatchNo, ExpiryDate, CostPrice, MRP, AvailableQuantity, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        item.ItemId,
        store.StoreId,
        row.lotNumber,
        row.batchNo,
        row.expiryDate,
        row.unitCost,
        row.mrp > 0 ? row.mrp : row.unitCost,
        row.quantity,
        userId,
        now,
      );

      const ledgerInsert = db.$client.prepare(`
        INSERT INTO InventoryStockTransaction
          (tenant_id, StockId, ItemId, StoreId, TransactionType, ReferenceNo, ReferenceId,
           InQuantity, OutQuantity, BalanceQuantity, TransactionDate, Remarks, CreatedBy, CreatedOn)
        VALUES (?, last_insert_rowid(), ?, ?, ?, ?, last_insert_rowid(), ?, 0, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        item.ItemId,
        store.StoreId,
        'opening-stock',
        referenceNo,
        row.quantity,
        row.quantity,
        now,
        auditRemarks,
        userId,
        now,
      );

      const [stockResult] = await db.$client.batch([stockInsert, ledgerInsert]);
      const stockId = Number((stockResult as { meta?: { last_row_id?: number } })?.meta?.last_row_id ?? 0);
      if (!stockId) throw new Error(`Row ${rowNumber}: opening stock batch failed to return StockId`);
      createdStockIds.push(stockId);

      await createInventoryAuditLog(c, {
        tenantId,
        userId,
        action: "CREATE",
        eventType: "inventory.opening_stock_import.posted",
        tableName: "InventoryStock",
        recordId: stockId,
        reason: auditRemarks,
        after: {
          referenceNo,
          fileHash,
          rowNumber,
          itemCode: item.ItemCode ?? row.itemKey,
          storeCode: store.StoreCode ?? row.storeKey,
          lotNumber: row.lotNumber,
          batchNumber: row.batchNo,
          expiryDate: row.expiryDate,
          quantity: row.quantity,
          unitCost: row.unitCost,
          totalCost: row.quantity * row.unitCost,
          supplierCode: supplier?.VendorCode ?? row.supplierKey,
        },
        whatChanged: {
          stockLedgerPosted: true,
          openingBalanceLocked: true,
          requiresReversalForCorrection: true,
        },
      });

      try {
        const mirror = await mirrorInventoryLabReagentReceipt(db.$client, {
          tenantId,
          userId,
          itemId: item.ItemId,
          inventoryStockId: stockId,
          goodsReceiptItemId: null,
          sourceReferenceType: 'inventory_opening_stock',
          batchNo: row.batchNo,
          expiryDate: row.expiryDate,
          quantity: row.quantity,
          purchasePrice: row.unitCost,
          receivedDate: now.slice(0, 10),
          remarks: auditRemarks,
        });
        if (mirror.mirrored) mirroredLabReagents++;
      } catch (mirrorError) {
        warnings.push(`Row ${rowNumber}: lab reagent mirror failed; inventory stock and ledger were posted. ${mirrorError instanceof Error ? mirrorError.message : 'Review lab monitoring manually.'}`);
      }

      created++;
    } catch (error) {
      skipped++;
      errors.push(error instanceof Error ? error.message : `Row ${rowNumber}: import failed`);
    }
  }

  return c.json({
    message: dryRun ? "Opening stock dry-run completed" : "Opening stock import posted",
    status: dryRun ? "validated" : "posted",
    approvalStatus: dryRun ? "preview" : "posted",
    referenceNo,
    fileHash,
    created,
    skipped,
    total: rows.length,
    totalStockValue,
    mirroredLabReagents,
    createdStockIds,
    errors: errors.slice(0, 20),
    warnings: warnings.slice(0, 20),
    nextActions: [
      { id: "stock-overview", title: "Confirm quantities in Stock Overview", href: "/inventory/overview" },
      { id: "ledger", title: "Review opening stock ledger", href: "/inventory/ledger" },
      { id: "qr-labels", title: "Print QR labels for expensive/expiry lots", href: "/inventory/traceability" },
      { id: "lab-qc", title: "QC lab reagent lots before use", href: "/lab-monitoring" },
    ],
  });
});

export default importExport;
