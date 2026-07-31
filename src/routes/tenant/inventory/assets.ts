import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import { getDb } from "../../../db";
import { logApproval, makeInventoryQrCode, upsertQrTag } from "./helpers";

type Variables = { tenantId?: string; userId?: string; role?: string };

const assets = new Hono<{ Bindings: Env; Variables: Variables }>();

const assetInsuranceSchema = z.object({
  policy_number: z.string().min(1).max(100),
  insurer_name: z.string().min(1).max(200),
  insured_value: z.number().min(0).default(0),
  premium_amount: z.number().min(0).optional(),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  file_key: z.string().max(500).optional(),
  file_name: z.string().max(255).optional(),
  remarks: z.string().max(1000).optional(),
  status: z.enum(["active", "expired", "cancelled"]).default("active"),
});

const updateAssetInsuranceSchema = assetInsuranceSchema.partial();

const assetContractDocumentSchema = z.object({
  amc_contract_id: z.number().int().positive().optional(),
  contract_type: z.string().min(1).max(100),
  contract_number: z.string().max(100).optional(),
  vendor_name: z.string().max(200).optional(),
  file_key: z.string().min(1).max(500),
  file_name: z.string().max(255).optional(),
  file_size: z.number().int().min(0).optional(),
  mime_type: z.string().max(100).optional(),
  effective_from: z.string().optional(),
  effective_to: z.string().optional(),
});

async function assertAssetExists(db: ReturnType<typeof getDb>, tenantId: string, assetId: number) {
  const asset = await db.$client.prepare(
    "SELECT FixedAssetStockId FROM InventoryFixedAssetStock WHERE FixedAssetStockId = ? AND tenant_id = ?"
  ).bind(assetId, tenantId).first();
  if (!asset) throw new HTTPException(404, { message: "Asset not found" });
}

/* ------------------------------------------------------------------ */
/*  GET /  — List all fixed assets with pagination                    */
/* ------------------------------------------------------------------ */
assets.get(
  "/",
  zValidator(
    "query",
    z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      category: z.string().optional(),
      department: z.string().optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const { search, status, category, department, page, limit } = c.req.valid("query");
    const offset = (page - 1) * limit;
    const db = getDb(c.env.DB);

    const conditions: string[] = ["A.tenant_id = ?"];
    const params: any[] = [tenantId];

    if (search) {
      conditions.push("(I.ItemName LIKE ? OR A.BarCodeNumber LIKE ? OR A.serial_number LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      conditions.push("A.asset_status = ?");
      params.push(status);
    }
    if (category) {
      conditions.push("A.asset_category = ?");
      params.push(category);
    }
    if (department) {
      conditions.push("A.department = ?");
      params.push(department);
    }

    const where = conditions.join(" AND ");

    const countResult = await db.$client
      .prepare(
        `SELECT COUNT(*) as total
         FROM InventoryFixedAssetStock A
         LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
         WHERE ${where}`
      )
      .bind(...params)
      .first<{ total: number }>();

    const results = await db.$client
      .prepare(
        `SELECT A.*, I.ItemName, I.ItemCode
         FROM InventoryFixedAssetStock A
         LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
         WHERE ${where}
         ORDER BY A.FixedAssetStockId DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all();

    return c.json({
      data: results.results,
      pagination: { page, limit, total: countResult?.total || 0 },
    });
  }
);

/* ------------------------------------------------------------------ */
/*  GET /stats — Summary KPIs                                         */
/* ------------------------------------------------------------------ */
assets.get("/stats", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const totals = await db.$client
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN asset_status = 'active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN asset_status = 'under_repair' THEN 1 ELSE 0 END) as under_repair,
         SUM(CASE WHEN asset_status = 'disposed' THEN 1 ELSE 0 END) as disposed,
         SUM(CASE WHEN asset_status = 'condemned' THEN 1 ELSE 0 END) as condemned,
         SUM(CASE WHEN asset_status = 'in_storage' THEN 1 ELSE 0 END) as in_storage
       FROM InventoryFixedAssetStock
       WHERE tenant_id = ?`
    )
    .bind(tenantId)
    .first();

  const expiringAmc = await db.$client
    .prepare(
      `SELECT COUNT(*) as count
       FROM asset_amc_contracts
       WHERE tenant_id = ? AND end_date >= ? AND end_date <= ?`
    )
    .bind(tenantId, today, in30Days)
    .first<{ count: number }>();

  const overdueMaintenance = await db.$client
    .prepare(
      `SELECT COUNT(*) as count
       FROM asset_maintenance_log
       WHERE tenant_id = ? AND next_due_date < ? AND next_due_date IS NOT NULL`
    )
    .bind(tenantId, today)
    .first<{ count: number }>();

  return c.json({
    total: (totals as any)?.total || 0,
    active: (totals as any)?.active || 0,
    under_repair: (totals as any)?.under_repair || 0,
    disposed: (totals as any)?.disposed || 0,
    condemned: (totals as any)?.condemned || 0,
    in_storage: (totals as any)?.in_storage || 0,
    expiring_amc: expiringAmc?.count || 0,
    overdue_maintenance: overdueMaintenance?.count || 0,
  });
});

/* ------------------------------------------------------------------ */
/*  GET /amc — List AMC contracts                                     */
/* ------------------------------------------------------------------ */
assets.get(
  "/amc",
  zValidator(
    "query",
    z.object({
      asset_id: z.coerce.number().optional(),
      expiring_soon: z.string().optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const { asset_id, expiring_soon, page, limit } = c.req.valid("query");
    const offset = (page - 1) * limit;
    const db = getDb(c.env.DB);
    const today = new Date().toISOString().slice(0, 10);
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const conditions: string[] = ["C.tenant_id = ?"];
    const params: any[] = [tenantId];

    if (asset_id) {
      conditions.push("C.asset_stock_id = ?");
      params.push(asset_id);
    }
    if (expiring_soon === "true") {
      conditions.push("C.end_date >= ? AND C.end_date <= ?");
      params.push(today, in30Days);
    }

    const where = conditions.join(" AND ");

    const countResult = await db.$client
      .prepare(
        `SELECT COUNT(*) as total
         FROM asset_amc_contracts C
         WHERE ${where}`
      )
      .bind(...params)
      .first<{ total: number }>();

    const results = await db.$client
      .prepare(
        `SELECT C.*, A.BarCodeNumber, I.ItemName
         FROM asset_amc_contracts C
         LEFT JOIN InventoryFixedAssetStock A ON C.asset_stock_id = A.FixedAssetStockId AND A.tenant_id = C.tenant_id
         LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
         WHERE ${where}
         ORDER BY C.end_date ASC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all();

    return c.json({
      data: results.results,
      pagination: { page, limit, total: countResult?.total || 0 },
    });
  }
);

/* ------------------------------------------------------------------ */
/*  GET /maintenance — List maintenance log                           */
/* ------------------------------------------------------------------ */
assets.get(
  "/maintenance",
  zValidator(
    "query",
    z.object({
      asset_id: z.coerce.number().optional(),
      type: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const { asset_id, type, from, to, page, limit } = c.req.valid("query");
    const offset = (page - 1) * limit;
    const db = getDb(c.env.DB);

    const conditions: string[] = ["M.tenant_id = ?"];
    const params: any[] = [tenantId];

    if (asset_id) {
      conditions.push("M.asset_stock_id = ?");
      params.push(asset_id);
    }
    if (type) {
      conditions.push("M.maintenance_type = ?");
      params.push(type);
    }
    if (from) {
      conditions.push("M.performed_date >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("M.performed_date <= ?");
      params.push(to);
    }

    const where = conditions.join(" AND ");

    const countResult = await db.$client
      .prepare(
        `SELECT COUNT(*) as total FROM asset_maintenance_log M WHERE ${where}`
      )
      .bind(...params)
      .first<{ total: number }>();

    const results = await db.$client
      .prepare(
        `SELECT M.*, A.BarCodeNumber, I.ItemName, AC.contract_number as amc_contract_number
         FROM asset_maintenance_log M
         LEFT JOIN InventoryFixedAssetStock A ON M.asset_stock_id = A.FixedAssetStockId AND A.tenant_id = M.tenant_id
         LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
         LEFT JOIN asset_amc_contracts AC ON M.amc_contract_id = AC.id AND AC.tenant_id = M.tenant_id
         WHERE ${where}
         ORDER BY M.performed_date DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, limit, offset)
      .all();

    return c.json({
      data: results.results,
      pagination: { page, limit, total: countResult?.total || 0 },
    });
  }
);

/* ------------------------------------------------------------------ */
/*  GET /allocate — List allocations                                  */
/* ------------------------------------------------------------------ */
assets.get("/allocate", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const assetId = c.req.query("asset_id");

  const conditions: string[] = ["AL.tenant_id = ?"];
  const params: any[] = [tenantId];
  if (assetId) { conditions.push("AL.asset_stock_id = ?"); params.push(Number(assetId)); }
  const where = conditions.join(" AND ");

  const { results } = await db.$client
    .prepare(
      `SELECT AL.*, I.ItemName as asset_name
       FROM asset_allocations AL
       LEFT JOIN InventoryFixedAssetStock A ON AL.asset_stock_id = A.FixedAssetStockId AND A.tenant_id = AL.tenant_id
       LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
       WHERE ${where}
       ORDER BY AL.allocated_date DESC LIMIT 100`
    )
    .bind(...params)
    .all();

  return c.json({ data: results });
});

/* ------------------------------------------------------------------ */
/*  GET /scan/:code — Resolve fixed asset by barcode/QR               */
/* ------------------------------------------------------------------ */
assets.get("/scan/:code", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const code = c.req.param("code").trim();

  const asset = await db.$client
    .prepare(
      `SELECT A.*, I.ItemName, I.ItemCode
       FROM InventoryFixedAssetStock A
       LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
       WHERE A.tenant_id = ? AND (A.BarCodeNumber = ? OR A.SerialNumber = ? OR A.serial_number = ?)`
    )
    .bind(tenantId, code, code, code)
    .first();

  if (!asset) throw new HTTPException(404, { message: "Asset not found" });
  return c.json(asset);
});

/* ------------------------------------------------------------------ */
/*  GET /:id/qr — Fixed asset QR payload                              */
/* ------------------------------------------------------------------ */
assets.get("/:id/qr", async (c) => {
  const tenantId = requireTenantId(c);
  const userId = c.get("userId") || null;
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
  const db = getDb(c.env.DB);

  const asset = await db.$client
    .prepare(
      `SELECT A.*, I.ItemName, I.ItemCode
       FROM InventoryFixedAssetStock A
       LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
       WHERE A.FixedAssetStockId = ? AND A.tenant_id = ?`
    )
    .bind(id, tenantId)
    .first<any>();
  if (!asset) throw new HTTPException(404, { message: "Asset not found" });

  const tagCode = asset.BarCodeNumber || makeInventoryQrCode(tenantId, "fixed_asset", id, asset.SerialNumber || asset.serial_number || null);
  await upsertQrTag(db, {
    tenantId,
    tagCode,
    entityType: "fixed_asset",
    entityId: id,
    humanLabel: asset.ItemName || `Asset #${id}`,
    createdBy: userId,
    payload: {
      system: "hms",
      entityType: "fixed_asset",
      entityId: id,
      tagCode,
      udi: {
        deviceIdentifier: asset.ItemCode || null,
        productionIdentifier: asset.SerialNumber || asset.serial_number || asset.BatchNo || null,
      },
      asset,
    },
  });
  return c.json({ tagCode, entityType: "fixed_asset", entityId: id });
});

/* ------------------------------------------------------------------ */
/*  GET /:id/insurance — Asset insurance policies                     */
/* ------------------------------------------------------------------ */
assets.get("/:id/insurance", async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
  const db = getDb(c.env.DB);
  await assertAssetExists(db, tenantId, id);

  const { results } = await db.$client.prepare(`
    SELECT * FROM asset_insurance_policies
    WHERE tenant_id = ? AND asset_stock_id = ?
    ORDER BY end_date DESC, id DESC
  `).bind(tenantId, id).all();

  return c.json({ data: results });
});

/* ------------------------------------------------------------------ */
/*  POST /:id/insurance — Store insurance metadata                    */
/* ------------------------------------------------------------------ */
assets.post(
  "/:id/insurance",
  zValidator("json", assetInsuranceSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await assertAssetExists(db, tenantId, id);

    const result = await db.$client.prepare(`
      INSERT INTO asset_insurance_policies (
        tenant_id, asset_stock_id, policy_number, insurer_name, insured_value,
        premium_amount, start_date, end_date, file_key, file_name, remarks,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      id,
      body.policy_number,
      body.insurer_name,
      body.insured_value,
      body.premium_amount || 0,
      body.start_date,
      body.end_date,
      body.file_key || null,
      body.file_name || null,
      body.remarks || null,
      body.status,
      userId,
      new Date().toISOString(),
      new Date().toISOString(),
    ).run();

    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'insurance', 'asset_insurance_policy', ?, ?, ?, ?)
    `).bind(tenantId, id, result.meta.last_row_id, userId, `Insurance ${body.policy_number} recorded`, new Date().toISOString()).run();

    return c.json({ message: "Asset insurance policy created", id: result.meta.last_row_id }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  PUT /insurance/:id — Update insurance metadata                    */
/* ------------------------------------------------------------------ */
assets.put(
  "/insurance/:id",
  zValidator("json", updateAssetInsuranceSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid insurance ID" });
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);

    const updates: string[] = [];
    const params: any[] = [];
    const fields = [
      "policy_number", "insurer_name", "insured_value", "premium_amount",
      "start_date", "end_date", "file_key", "file_name", "remarks", "status",
    ];
    for (const field of fields) {
      if ((body as any)[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push((body as any)[field]);
      }
    }
    if (updates.length === 0) throw new HTTPException(400, { message: "No fields to update" });

    updates.push("updated_at = ?");
    params.push(new Date().toISOString(), id, tenantId);
    await db.$client.prepare(`UPDATE asset_insurance_policies SET ${updates.join(", ")} WHERE id = ? AND tenant_id = ?`).bind(...params).run();

    return c.json({ message: "Asset insurance policy updated" });
  }
);

/* ------------------------------------------------------------------ */
/*  GET /:id/contracts — Asset contract document metadata             */
/* ------------------------------------------------------------------ */
assets.get("/:id/contracts", async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
  const db = getDb(c.env.DB);
  await assertAssetExists(db, tenantId, id);

  const { results } = await db.$client.prepare(`
    SELECT * FROM asset_contract_documents
    WHERE tenant_id = ? AND asset_stock_id = ? AND is_active = 1
    ORDER BY created_at DESC, id DESC
  `).bind(tenantId, id).all();

  return c.json({ data: results });
});

/* ------------------------------------------------------------------ */
/*  POST /:id/contracts/upload — Upload contract file to R2            */
/* ------------------------------------------------------------------ */
assets.post("/:id/contracts/upload", async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    throw new HTTPException(400, { message: "File is required" });
  }
  const uploadFile = file as unknown as File;

  const timestamp = Date.now();
  const sanitizedName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${tenantId}/asset-contracts/${id}/${timestamp}_${sanitizedName}`;

  await c.env.UPLOADS.put(key, uploadFile.stream(), {
    httpMetadata: { contentType: uploadFile.type },
  });

  return c.json({ file_key: key, file_name: uploadFile.name, file_size: uploadFile.size, mime_type: uploadFile.type }, 201);
});

/* ------------------------------------------------------------------ */
/*  POST /:id/contracts — Store R2-backed contract document metadata  */
/* ------------------------------------------------------------------ */
assets.post(
  "/:id/contracts",
  zValidator("json", assetContractDocumentSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);
    await assertAssetExists(db, tenantId, id);

    const result = await db.$client.prepare(`
      INSERT INTO asset_contract_documents (
        tenant_id, asset_stock_id, amc_contract_id, contract_type, contract_number,
        vendor_name, file_key, file_name, file_size, mime_type,
        effective_from, effective_to, uploaded_by, created_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      tenantId,
      id,
      body.amc_contract_id || null,
      body.contract_type,
      body.contract_number || null,
      body.vendor_name || null,
      body.file_key,
      body.file_name || null,
      body.file_size || null,
      body.mime_type || null,
      body.effective_from || null,
      body.effective_to || null,
      userId,
      new Date().toISOString(),
    ).run();

    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'contract_document', 'asset_contract_document', ?, ?, ?, ?)
    `).bind(tenantId, id, result.meta.last_row_id, userId, `Contract document ${body.file_name || body.file_key} registered`, new Date().toISOString()).run();

    return c.json({ message: "Asset contract document recorded", id: result.meta.last_row_id }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  GET /:id — Single asset detail with AMC, maintenance, allocations */
/* ------------------------------------------------------------------ */
assets.get("/:id", async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
  const db = getDb(c.env.DB);

  const asset = await db.$client
    .prepare(
      `SELECT A.*, I.ItemName, I.ItemCode
       FROM InventoryFixedAssetStock A
       LEFT JOIN InventoryItem I ON A.ItemId = I.ItemId AND I.tenant_id = A.tenant_id
       WHERE A.FixedAssetStockId = ? AND A.tenant_id = ?`
    )
    .bind(id, tenantId)
    .first();

  if (!asset) throw new HTTPException(404, { message: "Asset not found" });

  const amcContracts = await db.$client
    .prepare(
      `SELECT * FROM asset_amc_contracts
       WHERE asset_stock_id = ? AND tenant_id = ?
       ORDER BY end_date DESC`
    )
    .bind(id, tenantId)
    .all();

  const maintenanceLog = await db.$client
    .prepare(
      `SELECT * FROM asset_maintenance_log
       WHERE asset_stock_id = ? AND tenant_id = ?
       ORDER BY performed_date DESC
       LIMIT 50`
    )
    .bind(id, tenantId)
    .all();

  const allocations = await db.$client
    .prepare(
      `SELECT * FROM asset_allocations
       WHERE asset_stock_id = ? AND tenant_id = ?
       ORDER BY allocated_date DESC`
    )
    .bind(id, tenantId)
    .all();

  const insurancePolicies = await db.$client
    .prepare(
      `SELECT * FROM asset_insurance_policies
       WHERE asset_stock_id = ? AND tenant_id = ?
       ORDER BY end_date DESC`
    )
    .bind(id, tenantId)
    .all();

  const contractDocuments = await db.$client
    .prepare(
      `SELECT * FROM asset_contract_documents
       WHERE asset_stock_id = ? AND tenant_id = ? AND is_active = 1
       ORDER BY created_at DESC`
    )
    .bind(id, tenantId)
    .all();

  return c.json({
    ...asset,
    amc_contracts: amcContracts.results,
    maintenance_log: maintenanceLog.results,
    allocations: allocations.results,
    insurance_policies: insurancePolicies.results,
    contract_documents: contractDocuments.results,
  });
});

/* ------------------------------------------------------------------ */
/*  POST / — Register new asset                                       */
/* ------------------------------------------------------------------ */
assets.post(
  "/",
  zValidator(
    "json",
    z.object({
      ItemId: z.number().int().positive(),
      StoreId: z.number().int().positive().optional(),
      BarCodeNumber: z.string().min(1).optional(),
      asset_category: z.string().min(1),
      manufacturer: z.string().optional(),
      model_number: z.string().optional(),
      serial_number: z.string().optional(),
      purchase_date: z.string().optional(),
      purchase_cost: z.number().optional(),
      warranty_expiry: z.string().optional(),
      department: z.string().optional(),
      location: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);
    const count = await db.$client
      .prepare("SELECT COUNT(*) as cnt FROM InventoryFixedAssetStock WHERE tenant_id = ?")
      .bind(tenantId)
      .first<{ cnt: number }>();
    const barcode = body.BarCodeNumber || makeInventoryQrCode(tenantId, "fixed_asset", (count?.cnt || 0) + 1, body.serial_number || body.ItemId);

    const result = await db.$client
      .prepare(
        `INSERT INTO InventoryFixedAssetStock
         (tenant_id, ItemId, StoreId, BarCodeNumber, SerialNumber, Status, IsActive, CreatedBy, CreatedOn,
          asset_category, manufacturer, model_number, serial_number, purchase_date, purchase_cost,
          warranty_expiry, department, location, asset_status, current_value)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .bind(
        tenantId,
        body.ItemId,
        body.StoreId || null,
        barcode,
        body.serial_number || null,
        userId,
        now,
        body.asset_category,
        body.manufacturer || null,
        body.model_number || null,
        body.serial_number || null,
        body.purchase_date || null,
        body.purchase_cost || null,
        body.warranty_expiry || null,
        body.department || null,
        body.location || null,
        body.purchase_cost || null
      )
      .run();

    const assetId = Number(result.meta.last_row_id);
    await upsertQrTag(db, {
      tenantId,
      tagCode: barcode,
      entityType: "fixed_asset",
      entityId: assetId,
      humanLabel: `Asset #${assetId}`,
      createdBy: userId,
      payload: {
        system: "hms",
        entityType: "fixed_asset",
        entityId: assetId,
        tagCode: barcode,
        itemId: body.ItemId,
        serialNumber: body.serial_number || null,
      },
    });
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, to_department, to_location, value_after, performed_by, remarks, created_at)
      VALUES (?, ?, 'register', ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, assetId, body.department || null, body.location || null, body.purchase_cost || null, userId, "Asset registered", now).run();

    return c.json({ message: "Asset registered", id: assetId, BarCodeNumber: barcode }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  PUT /:id — Update asset                                           */
/* ------------------------------------------------------------------ */
const ASSET_UPDATABLE = [
  "status", "location", "department", "last_maintenance_date",
  "next_maintenance_due", "current_value", "manufacturer",
  "model_number", "serial_number", "warranty_expiry", "asset_category",
] as const;

assets.put(
  "/:id",
  zValidator(
    "json",
    z.object({
      status: z.string().optional(),
      location: z.string().optional(),
      department: z.string().optional(),
      last_maintenance_date: z.string().optional(),
      next_maintenance_due: z.string().optional(),
      current_value: z.number().optional(),
      manufacturer: z.string().optional(),
      model_number: z.string().optional(),
      serial_number: z.string().optional(),
      warranty_expiry: z.string().optional(),
      asset_category: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);

    const updates: string[] = [];
    const params: any[] = [];

    for (const col of ASSET_UPDATABLE) {
      if ((body as any)[col] !== undefined) {
        updates.push(`${col} = ?`);
        params.push((body as any)[col]);
      }
    }

    if (updates.length === 0) {
      throw new HTTPException(400, { message: "No fields to update" });
    }

    updates.push("ModifiedOn = ?");
    params.push(new Date().toISOString());
    params.push(id, tenantId);

    await db.$client
      .prepare(
        `UPDATE InventoryFixedAssetStock SET ${updates.join(", ")}
         WHERE FixedAssetStockId = ? AND tenant_id = ?`
      )
      .bind(...params)
      .run();

    return c.json({ message: "Asset updated" });
  }
);

/* ------------------------------------------------------------------ */
/*  PUT /:id/status — Change asset status                             */
/* ------------------------------------------------------------------ */
assets.put(
  "/:id/status",
  zValidator(
    "json",
    z.object({
      status: z.enum(["active", "under_repair", "disposed", "condemned", "in_storage"]),
      remarks: z.string().max(1000).optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
    const { status, remarks } = c.req.valid("json");
    const db = getDb(c.env.DB);
    const existing = await db.$client.prepare(
      `SELECT asset_status, department, location, current_value
       FROM InventoryFixedAssetStock WHERE FixedAssetStockId = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<any>();
    if (!existing) throw new HTTPException(404, { message: "Asset not found" });

    await db.$client
      .prepare(
        `UPDATE InventoryFixedAssetStock
         SET asset_status = ?, Status = ?, ModifiedOn = ?, ModifiedBy = ?
         WHERE FixedAssetStockId = ? AND tenant_id = ?`
      )
      .bind(status, status === "disposed" || status === "condemned" ? "disposed" : "active", new Date().toISOString(), userId, id, tenantId)
      .run();
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, from_department, from_location, to_department, to_location,
         value_before, value_after, performed_by, remarks, created_at)
      VALUES (?, ?, 'status_change', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      id,
      existing.department || null,
      existing.location || null,
      existing.department || null,
      existing.location || null,
      existing.current_value || null,
      existing.current_value || null,
      userId,
      remarks || `Status changed to ${status}`,
      new Date().toISOString(),
    ).run();
    await logApproval(db, {
      tenantId,
      entityType: "fixed_asset",
      entityId: id,
      action: "status_change",
      fromStatus: existing.asset_status || null,
      toStatus: status,
      remarks: remarks || null,
      performedBy: userId,
    });

    return c.json({ message: `Asset status changed to ${status}` });
  }
);

/* ------------------------------------------------------------------ */
/*  POST /amc — Create AMC contract                                   */
/* ------------------------------------------------------------------ */
assets.post(
  "/amc",
  zValidator(
    "json",
    z.object({
      asset_stock_id: z.number().int().positive(),
      contract_number: z.string().min(1),
      vendor_name: z.string().min(1),
      start_date: z.string().min(1),
      end_date: z.string().min(1),
      contract_amount: z.number(),
      payment_frequency: z.string().optional(),
      coverage_type: z.string().optional(),
      terms: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);

    const result = await db.$client
      .prepare(
        `INSERT INTO asset_amc_contracts
         (tenant_id, asset_stock_id, contract_number, vendor_name, start_date, end_date,
          contract_amount, payment_frequency, coverage_type, terms, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        body.asset_stock_id,
        body.contract_number,
        body.vendor_name,
        body.start_date,
        body.end_date,
        body.contract_amount,
        body.payment_frequency || null,
        body.coverage_type || null,
        body.terms || null,
        userId,
        now
      )
      .run();

    return c.json({ message: "AMC contract created", id: result.meta.last_row_id }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  PUT /amc/:id — Update AMC contract                                */
/* ------------------------------------------------------------------ */
const AMC_UPDATABLE = [
  "contract_number", "vendor_name", "start_date", "end_date",
  "contract_amount", "payment_frequency", "coverage_type", "terms",
] as const;

assets.put(
  "/amc/:id",
  zValidator(
    "json",
    z.object({
      contract_number: z.string().optional(),
      vendor_name: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      contract_amount: z.number().optional(),
      payment_frequency: z.string().optional(),
      coverage_type: z.string().optional(),
      terms: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid AMC contract ID" });
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);

    const updates: string[] = [];
    const params: any[] = [];

    for (const col of AMC_UPDATABLE) {
      if ((body as any)[col] !== undefined) {
        updates.push(`${col} = ?`);
        params.push((body as any)[col]);
      }
    }

    if (updates.length === 0) {
      throw new HTTPException(400, { message: "No fields to update" });
    }

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id, tenantId);

    await db.$client
      .prepare(
        `UPDATE asset_amc_contracts SET ${updates.join(", ")}
         WHERE id = ? AND tenant_id = ?`
      )
      .bind(...params)
      .run();

    return c.json({ message: "AMC contract updated" });
  }
);

/* ------------------------------------------------------------------ */
/*  POST /maintenance — Log maintenance                               */
/* ------------------------------------------------------------------ */
assets.post(
  "/maintenance",
  zValidator(
    "json",
    z.object({
      asset_stock_id: z.number().int().positive(),
      amc_contract_id: z.number().int().positive().optional(),
      maintenance_type: z.string().min(1),
      description: z.string().optional(),
      performed_by: z.string().optional(),
      performed_date: z.string().min(1),
      next_due_date: z.string().optional(),
      cost: z.number().optional(),
      covered_by_amc: z.boolean().optional(),
      parts_replaced: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);

    const result = await db.$client
      .prepare(
        `INSERT INTO asset_maintenance_log
         (tenant_id, asset_stock_id, amc_contract_id, maintenance_type, description,
          performed_by, performed_date, next_due_date, cost, covered_by_amc, parts_replaced,
          created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        body.asset_stock_id,
        body.amc_contract_id || null,
        body.maintenance_type,
        body.description || null,
        body.performed_by || null,
        body.performed_date,
        body.next_due_date || null,
        body.cost || null,
        body.covered_by_amc ? 1 : 0,
        body.parts_replaced || null,
        userId,
        now
      )
      .run();

    // Update asset's last/next maintenance dates
    const updateParts: string[] = ["last_maintenance_date = ?"];
    const updateParams: any[] = [body.performed_date];
    if (body.next_due_date) {
      updateParts.push("next_maintenance_due = ?");
      updateParams.push(body.next_due_date);
    }
    updateParams.push(body.asset_stock_id, tenantId);

    await db.$client
      .prepare(
        `UPDATE InventoryFixedAssetStock SET ${updateParts.join(", ")}
         WHERE FixedAssetStockId = ? AND tenant_id = ?`
      )
      .bind(...updateParams)
      .run();
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'maintenance', 'maintenance_log', ?, ?, ?, ?)
    `).bind(tenantId, body.asset_stock_id, result.meta.last_row_id, userId, body.description || "Maintenance logged", now).run();

    return c.json({ message: "Maintenance logged", id: result.meta.last_row_id }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  POST /allocate — Allocate asset                                   */
/* ------------------------------------------------------------------ */
assets.post(
  "/allocate",
  zValidator(
    "json",
    z.object({
      asset_stock_id: z.number().int().positive(),
      department: z.string().min(1),
      location: z.string().optional(),
      allocated_to: z.string().optional(),
      allocated_date: z.string().min(1),
      condition: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);
    const asset = await db.$client.prepare(
      `SELECT department, location, current_value FROM InventoryFixedAssetStock WHERE tenant_id = ? AND FixedAssetStockId = ?`
    ).bind(tenantId, body.asset_stock_id).first<any>();
    if (!asset) throw new HTTPException(404, { message: "Asset not found" });

    const result = await db.$client
      .prepare(
        `INSERT INTO asset_allocations
         (tenant_id, asset_stock_id, department, location, allocated_to,
          allocated_date, condition_on_allocate, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tenantId,
        body.asset_stock_id,
        body.department,
        body.location || null,
        body.allocated_to || null,
        body.allocated_date,
        body.condition || null,
        userId,
        now
      )
      .run();

    // Update asset department & location
    await db.$client
      .prepare(
        `UPDATE InventoryFixedAssetStock SET department = ?, location = ?, asset_status = 'active', ModifiedOn = ?, ModifiedBy = ?
         WHERE FixedAssetStockId = ? AND tenant_id = ?`
      )
      .bind(body.department, body.location || null, now, userId, body.asset_stock_id, tenantId)
      .run();
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, from_department, from_location, to_department, to_location,
         condition_after, value_before, value_after, reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'allocate', ?, ?, ?, ?, ?, ?, ?, 'asset_allocation', ?, ?, ?, ?)
    `).bind(
      tenantId,
      body.asset_stock_id,
      asset.department || null,
      asset.location || null,
      body.department,
      body.location || null,
      body.condition || null,
      asset.current_value || null,
      asset.current_value || null,
      result.meta.last_row_id,
      userId,
      "Asset allocated",
      now,
    ).run();

    return c.json({ message: "Asset allocated", id: result.meta.last_row_id }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  PUT /allocate/:id/return — Return asset                           */
/* ------------------------------------------------------------------ */
assets.put(
  "/allocate/:id/return",
  zValidator(
    "json",
    z.object({
      returned_date: z.string().min(1),
      condition_on_return: z.string().optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid allocation ID" });
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);
    const allocation = await db.$client.prepare(
      `SELECT * FROM asset_allocations WHERE id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first<any>();
    if (!allocation) throw new HTTPException(404, { message: "Allocation not found" });

    await db.$client
      .prepare(
        `UPDATE asset_allocations
         SET returned_date = ?, condition_on_return = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`
      )
      .bind(body.returned_date, body.condition_on_return || null, now, id, tenantId)
      .run();
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, from_department, from_location, condition_after,
         reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'return', ?, ?, ?, 'asset_allocation', ?, ?, ?, ?)
    `).bind(
      tenantId,
      allocation.asset_stock_id,
      allocation.department || null,
      allocation.location || null,
      body.condition_on_return || null,
      id,
      userId,
      "Asset returned",
      now,
    ).run();

    return c.json({ message: "Asset returned" });
  }
);

/* ------------------------------------------------------------------ */
/*  POST /:id/depreciation — Record asset depreciation                 */
/* ------------------------------------------------------------------ */
assets.post(
  "/:id/depreciation",
  zValidator(
    "json",
    z.object({
      depreciation_method: z.enum(["straight_line", "declining_balance", "manual"]).default("straight_line"),
      fiscal_year: z.string().optional(),
      depreciation_date: z.string().min(1),
      depreciation_rate: z.number().min(0).optional(),
      depreciation_amount: z.number().min(0),
      remarks: z.string().max(1000).optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);

    const asset = await db.$client.prepare(
      "SELECT current_value, purchase_cost FROM InventoryFixedAssetStock WHERE tenant_id = ? AND FixedAssetStockId = ?"
    ).bind(tenantId, id).first<{ current_value: number | null; purchase_cost: number | null }>();
    if (!asset) throw new HTTPException(404, { message: "Asset not found" });

    const openingValue = Number(asset.current_value ?? asset.purchase_cost ?? 0);
    const closingValue = Math.max(0, openingValue - body.depreciation_amount);
    const result = await db.$client.prepare(`
      INSERT INTO asset_depreciation_entries
        (tenant_id, asset_stock_id, depreciation_method, fiscal_year, depreciation_date, opening_value,
         depreciation_rate, depreciation_amount, closing_value, remarks, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      id,
      body.depreciation_method,
      body.fiscal_year || null,
      body.depreciation_date,
      openingValue,
      body.depreciation_rate || null,
      body.depreciation_amount,
      closingValue,
      body.remarks || null,
      userId,
      now,
    ).run();

    await db.$client.prepare(
      "UPDATE InventoryFixedAssetStock SET current_value = ?, ModifiedBy = ?, ModifiedOn = ? WHERE tenant_id = ? AND FixedAssetStockId = ?"
    ).bind(closingValue, userId, now, tenantId, id).run();
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, value_before, value_after, reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'depreciation', ?, ?, 'asset_depreciation', ?, ?, ?, ?)
    `).bind(tenantId, id, openingValue, closingValue, result.meta.last_row_id, userId, body.remarks || "Asset depreciation recorded", now).run();

    return c.json({ message: "Depreciation recorded", id: result.meta.last_row_id, current_value: closingValue }, 201);
  }
);

/* ------------------------------------------------------------------ */
/*  POST /:id/dispose — Dispose/scrap asset                           */
/* ------------------------------------------------------------------ */
assets.post(
  "/:id/dispose",
  zValidator(
    "json",
    z.object({
      disposal_date: z.string().min(1),
      disposal_type: z.enum(["scrap", "sold", "lost", "donated", "condemned"]),
      reason: z.string().min(1).max(1000),
      disposal_value: z.number().min(0).optional(),
      remarks: z.string().max(1000).optional(),
    })
  ),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: "Invalid asset ID" });
    const body = c.req.valid("json");
    const now = new Date().toISOString();
    const db = getDb(c.env.DB);

    const asset = await db.$client.prepare(
      "SELECT asset_status, department, location, current_value FROM InventoryFixedAssetStock WHERE tenant_id = ? AND FixedAssetStockId = ?"
    ).bind(tenantId, id).first<any>();
    if (!asset) throw new HTTPException(404, { message: "Asset not found" });
    if (asset.asset_status === "disposed" || asset.asset_status === "condemned") {
      throw new HTTPException(400, { message: "Asset is already finalized" });
    }

    const result = await db.$client.prepare(`
      INSERT INTO asset_disposal_records
        (tenant_id, asset_stock_id, disposal_date, disposal_type, reason, disposal_value,
         approved_by, approved_on, remarks, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      id,
      body.disposal_date,
      body.disposal_type,
      body.reason,
      body.disposal_value || 0,
      userId,
      now,
      body.remarks || null,
      userId,
      now,
    ).run();

    const status = body.disposal_type === "condemned" ? "condemned" : "disposed";
    await db.$client.prepare(`
      UPDATE InventoryFixedAssetStock
      SET asset_status = ?, Status = 'disposed', current_value = ?, IsActive = 0, ModifiedBy = ?, ModifiedOn = ?
      WHERE tenant_id = ? AND FixedAssetStockId = ?
    `).bind(status, body.disposal_value || 0, userId, now, tenantId, id).run();
    await db.$client.prepare(`
      INSERT INTO asset_movement_log
        (tenant_id, asset_stock_id, movement_type, from_department, from_location, value_before, value_after,
         reference_type, reference_id, performed_by, remarks, created_at)
      VALUES (?, ?, 'dispose', ?, ?, ?, ?, 'asset_disposal', ?, ?, ?, ?)
    `).bind(
      tenantId,
      id,
      asset.department || null,
      asset.location || null,
      asset.current_value || null,
      body.disposal_value || 0,
      result.meta.last_row_id,
      userId,
      body.reason,
      now,
    ).run();
    await logApproval(db, {
      tenantId,
      entityType: "fixed_asset",
      entityId: id,
      action: "dispose",
      fromStatus: asset.asset_status || null,
      toStatus: status,
      remarks: body.reason,
      performedBy: userId,
    });

    return c.json({ message: "Asset disposed", id: result.meta.last_row_id, status });
  }
);

export default assets;
