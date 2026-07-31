import { Hono } from "hono";
import type { Env } from '../../../types';
import { zValidator } from "@hono/zod-validator";
import * as schemas from "../../../schemas/inventory";
import { generateSequenceNo } from "../../../utils/sequence";
import { getDb } from '../../../db';


const rfq = new Hono<{ Bindings: Env; Variables: { tenantId?: string; userId?: string; role?: string } }>();

// GET /rfq
rfq.get("/", zValidator("query", schemas.listRFQSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, Status, FromDate, ToDate } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (Status) { conditions.push("Status = ?"); params.push(Status); }
  if (FromDate) { conditions.push("CreatedOn >= ?"); params.push(FromDate); }
  if (ToDate) { conditions.push("CreatedOn <= ?"); params.push(ToDate); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryRequestForQuotation WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryRequestForQuotation WHERE ${whereClause} ORDER BY RFQId DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /rfq
rfq.post("/", zValidator("json", schemas.createRFQSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  const nextRFQNo = await generateSequenceNo(c.env.DB, 'RFQ', 'InventoryRequestForQuotation', 'RFQNo', tenantId);

  const result = await db.$client.prepare(`
    INSERT INTO InventoryRequestForQuotation (tenant_id, RFQNo, Subject, Description, RequestedCloseDate, Status, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, nextRFQNo, body.Subject, body.Description || null, body.RequestedCloseDate || null, 'active', userId ?? null, new Date().toISOString()).run();

  const rfqId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];

  // Items
  for (const item of body.Items) {
    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryRequestForQuotationItem (RFQId, ItemId, Quantity, Description, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(rfqId, item.ItemId, item.Quantity, item.Description || null, userId ?? null, new Date().toISOString()));
  }

  // Vendors (Invited)
  if (body.VendorIds) {
    for (const vid of body.VendorIds) {
      batchOps.push(db.$client.prepare(`
        INSERT INTO InventoryRequestForQuotationVendor (RFQId, VendorId, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?)
      `).bind(rfqId, vid, userId ?? null, new Date().toISOString()));
    }
  }

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  return c.json({ message: "RFQ created", RFQId: rfqId, RFQNo: nextRFQNo }, 201);
});

// GET /quotation
rfq.get("/quotation", zValidator("query", schemas.listQuotationsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { page, limit, RFQId, VendorId, Status } = c.req.valid("query");
  const offset = (page - 1) * limit;

  const conditions: string[] = ["tenant_id = ?"];
  const tenantId = c.get("tenantId");
  const params: any[] = [tenantId];

  if (RFQId) { conditions.push("RFQId = ?"); params.push(RFQId); }
  if (VendorId) { conditions.push("VendorId = ?"); params.push(VendorId); }
  if (Status) { conditions.push("Status = ?"); params.push(Status); }

  const whereClause = conditions.join(" AND ");
  const count = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM InventoryQuotation WHERE ${whereClause}`
  ).bind(...params).first<{ total: number }>();

  const results = await db.$client.prepare(
    `SELECT * FROM InventoryQuotation WHERE ${whereClause} ORDER BY QuotationId DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all();

  return c.json({ data: results.results, pagination: { page, limit, total: count?.total || 0 } });
});

// POST /quotation
rfq.post("/quotation", zValidator("json", schemas.createQuotationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const body = c.req.valid("json");
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const today = new Date().toISOString().slice(0, 10);

  // Check RFQ (tenant-scoped)
  const rfqExists = await db.$client.prepare(
    "SELECT * FROM InventoryRequestForQuotation WHERE RFQId = ? AND tenant_id = ?"
  ).bind(body.RFQId, tenantId).first();
  if (!rfqExists) return c.json({ error: "RFQ not found" }, 404);

  const nextQTNo = await generateSequenceNo(c.env.DB, 'QT', 'InventoryQuotation', 'QuotationNo', tenantId);

  const result = await db.$client.prepare(`
    INSERT INTO InventoryQuotation (tenant_id, RFQId, VendorId, QuotationNo, QuotationDate, ReferenceNo, Remarks, Status, CreatedBy, CreatedOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, body.RFQId, body.VendorId, nextQTNo, body.QuotationDate || today,
    body.RefrenceNo || null, body.Remarks || null, 'pending',
    userId ?? null, new Date().toISOString(),
  ).run();

  const quoteId = result.meta.last_row_id;
  const batchOps: D1PreparedStatement[] = [];

  for (const item of body.Items) {
    batchOps.push(db.$client.prepare(`
      INSERT INTO InventoryQuotationItem (QuotationId, ItemId, QuotedQuantity, QuotedRate, Description, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(quoteId, item.ItemId, item.QuotedQuantity || 0, item.QuotedRate, item.Description || null, userId ?? null, new Date().toISOString()));
  }

  if (batchOps.length > 0) await db.$client.batch(batchOps);

  return c.json({ message: "Quotation created", QuotationId: quoteId, QuotationNo: nextQTNo }, 201);
});

export default rfq;
