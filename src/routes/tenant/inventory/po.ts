import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import * as schemas from "../../../schemas/inventory";
import type { Env } from '../../../types';
import { generateSequenceNo } from "../../../utils/sequence";
import { getDb } from '../../../db';
import { getActiveFiscalYear } from '../../../lib/fiscal-year';


const po = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /po - List POs
po.get("/", zValidator("query", schemas.listPurchaseOrdersSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, VendorId, StoreId, POStatus, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["P.tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (VendorId) { conditions.push("P.VendorId = ?"); params.push(VendorId); }
  if (StoreId) { conditions.push("P.StoreId = ?"); params.push(StoreId); }
  if (POStatus) { conditions.push("P.POStatus = ?"); params.push(POStatus); }
  if (FromDate) { conditions.push("P.PODate >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("P.PODate <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryPurchaseOrder P WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(`
    SELECT P.*, V.VendorName
    FROM InventoryPurchaseOrder P
    JOIN InventoryVendor V ON P.VendorId = V.VendorId
    WHERE ${whereClause}
    ORDER BY P.PurchaseOrderId DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /po - Create PO
po.post("/", zValidator("json", schemas.createPurchaseOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');

  // Calculate totals
  let subTotal = 0;
  let totalVAT = 0;
  body.Items.forEach(item => {
    const itemTotal = item.Quantity * item.StandardRate;
    subTotal += itemTotal;
    if (item.VATPercent > 0) {
      totalVAT += itemTotal * (item.VATPercent / 100);
    }
  });
  const totalAmount = subTotal + totalVAT;

  const today = new Date().toISOString().slice(0, 10);
  const nextPONo = await generateSequenceNo(c.env.DB, 'PO', 'InventoryPurchaseOrder', 'PONumber', tenantId);

  // Insert PO header
  const result = await db.$client.prepare(`
    INSERT INTO InventoryPurchaseOrder (tenant_id, PONumber, PODate, VendorId, StoreId, POStatus, SubTotal, TotalAmount, VATAmount, DeliveryAddress, DeliveryDays, ExpectedDeliveryDate, TermsConditions, Remarks, ReferenceNo, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    nextPONo, body.PODate || today, body.VendorId, body.StoreId || null, "pending",
    subTotal, totalAmount, totalVAT, body.DeliveryAddress || null, body.DeliveryDays,
    body.ExpectedDeliveryDate || null, body.TermsConditions || null, body.Remarks || null, body.ReferenceNo || null,
    userId ?? null, new Date().toISOString(),
  ).run();

  const poId = result.meta.last_row_id;

  // Insert PO Items
  const batchOps: D1PreparedStatement[] = [];
  body.Items.forEach(item => {
    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryPurchaseOrderItem (PurchaseOrderId, ItemId, Quantity, StandardRate, TotalAmount, VATPercent, VATAmount, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      poId, item.ItemId, item.Quantity, item.StandardRate,
      item.Quantity * item.StandardRate, item.VATPercent,
      (item.Quantity * item.StandardRate) * (item.VATPercent / 100),
      item.Remarks || null, userId ?? null, new Date().toISOString(),
    ));
  });

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  return c.json({ message: "Purchase Order created", PurchaseOrderId: poId, PONumber: nextPONo }, 201);
});

// GET /po/drafts
po.get("/drafts", zValidator("query", schemas.listPODraftsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, Status } = c.req.valid("query");
  const offset = (page - 1) * limit;
  const tenantId = c.get("tenantId");

  const conditions: string[] = ["tenant_id = ?"];
  const params: any[] = [tenantId];

  if (Status) { conditions.push("Status = ?"); params.push(Status); }

  const whereClause = conditions.join(" AND ");
  const results = await db.$client.prepare(
    `SELECT * FROM InventoryPurchaseOrderDraft WHERE ${whereClause} LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results });
});

// POST /po/drafts
po.post("/drafts", zValidator("json", schemas.createPODraftSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');

  let subTotal = 0;
  body.Items.forEach(item => {
    if (item.ItemRate && item.Quantity) subTotal += item.Quantity * item.ItemRate;
  });

  const nextDraftNo = await generateSequenceNo(c.env.DB, 'POD', 'InventoryPurchaseOrderDraft', 'DraftPurchaseOrderNo', tenantId);

  const today = new Date().toISOString().slice(0, 10);
  const activeFy = await getActiveFiscalYear(c.env.DB, tenantId!, today);

  const result = await db.$client.prepare(`
    INSERT INTO InventoryPurchaseOrderDraft (tenant_id, DraftPurchaseOrderNo, FiscalYearId, VendorId, DeliveryDate, Remarks, SubTotal, TotalAmount, Status, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    nextDraftNo, activeFy?.id || 1, body.VendorId || null, body.DeliveryDate || null, body.Remarks || null,
    subTotal, subTotal, "active", userId ?? null, new Date().toISOString(),
  ).run();

  const draftId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];

  body.Items.forEach(item => {
    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryPurchaseOrderDraftItem (DraftPurchaseOrderId, ItemId, Quantity, ItemRate, VATPercentage, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(draftId, item.ItemId, item.Quantity || 0, item.ItemRate || 0, item.VATPercentage, item.Remarks || null, userId ?? null, new Date().toISOString()));
  });

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  return c.json({ message: "Draft PO created", DraftId: draftId, DraftNo: nextDraftNo }, 201);
});

// PUT /po/:id/approve
po.put("/:id/approve", zValidator("json", schemas.approvePurchaseOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const poId = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  const today = new Date().toISOString();

  const po = await db.$client.prepare(
    "SELECT * FROM InventoryPurchaseOrder WHERE PurchaseOrderId = ? AND tenant_id = ?"
  ).bind(poId, tenantId).first<any>();
  if (!po) return c.json({ error: "Purchase Order not found" }, 404);
  if (po.POStatus !== 'pending') return c.json({ error: "Only pending Purchase Orders can be approved" }, 400);

  const remarks = body.Remarks
    ? (po.Remarks ? `${po.Remarks}\n[APPROVED] ${body.Remarks}` : `[APPROVED] ${body.Remarks}`)
    : (po.Remarks ? `${po.Remarks}\n[APPROVED]` : `[APPROVED]`);

  await db.$client.prepare(
    "UPDATE InventoryPurchaseOrder SET POStatus = 'approved', VerifiedBy = ?, VerifiedOn = ?, Remarks = ?, ModifiedBy = ?, ModifiedOn = ? WHERE PurchaseOrderId = ? AND tenant_id = ?"
  ).bind(userId, today, remarks, userId, today, poId, tenantId).run();

  return c.json({ message: "Purchase Order approved" });
});

// PUT /po/:id/reject
po.put("/:id/reject", zValidator("json", schemas.rejectPurchaseOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const poId = c.req.param("id");
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  if (!tenantId || !userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  const today = new Date().toISOString();

  const po = await db.$client.prepare(
    "SELECT * FROM InventoryPurchaseOrder WHERE PurchaseOrderId = ? AND tenant_id = ?"
  ).bind(poId, tenantId).first<any>();
  if (!po) return c.json({ error: "Purchase Order not found" }, 404);
  if (po.POStatus !== 'pending') return c.json({ error: "Only pending Purchase Orders can be rejected" }, 400);

  const remarks = body.Remarks
    ? (po.Remarks ? `${po.Remarks}\n[REJECTED] ${body.Remarks}` : `[REJECTED] ${body.Remarks}`)
    : (po.Remarks ? `${po.Remarks}\n[REJECTED]` : `[REJECTED]`);

  await db.$client.prepare(
    "UPDATE InventoryPurchaseOrder SET POStatus = 'rejected', IsCancelled = 1, CancelledBy = ?, CancelledOn = ?, CancelRemarks = ?, Remarks = ?, ModifiedBy = ?, ModifiedOn = ? WHERE PurchaseOrderId = ? AND tenant_id = ?"
  ).bind(userId, today, body.Remarks || 'Rejected', remarks, userId, today, poId, tenantId).run();

  return c.json({ message: "Purchase Order rejected" });
});

export default po;
