import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createCategorySchema, updateCategorySchema, createGenericSchema, updateGenericSchema,
  createPharmacySupplierSchema, updatePharmacySupplierSchema,
  createUOMSchema, createPackingTypeSchema, createRackSchema,
  createPharmacyItemSchema, updatePharmacyItemSchema,
} from '../../../schemas/pharmacy';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../../lib/pagination';
import { getDb } from '../../../db';
import { requireRole } from '../../../middleware/rbac';

const PHARM_READ  = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;
const PHARM_WRITE = ['hospital_admin', 'pharmacist'] as const;

const masterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

masterRoutes.get('/categories', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(
      `SELECT * FROM pharmacy_categories WHERE tenant_id = ? AND is_active = 1 ORDER BY name`,
    ).bind(tenantId).all();
    return c.json({ categories: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch categories' }); }
});

masterRoutes.post('/categories', requireRole(...PHARM_WRITE), zValidator('json', createCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(
      `INSERT INTO pharmacy_categories (name, description, tenant_id, created_by) VALUES (?, ?, ?, ?)`,
    ).bind(data.name, data.description ?? null, tenantId, userId).run();
    return c.json({ message: 'Category created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create category' }); }
});

masterRoutes.put('/categories/:id', requireRole(...PHARM_WRITE), zValidator('json', updateCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  try {
    const existing = await db.$client.prepare(
      `SELECT * FROM pharmacy_categories WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Category not found' });
    await db.$client.prepare(
      `UPDATE pharmacy_categories SET name = ?, description = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(data.name ?? existing['name'], data.description ?? existing['description'], id, tenantId).run();
    return c.json({ message: 'Category updated' });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to update category' }); }
});

// ─── GENERICS ────────────────────────────────────────────────────────────────

masterRoutes.get('/generics', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const categoryId = c.req.query('categoryId');
  try {
    let sql = `SELECT g.*, c.name as category_name FROM pharmacy_generics g
               LEFT JOIN pharmacy_categories c ON g.category_id = c.id
               WHERE g.tenant_id = ? AND g.is_active = 1`;
    const params: (string | number)[] = [tenantId];
    if (categoryId) { sql += ' AND g.category_id = ?'; params.push(categoryId); }
    sql += ' ORDER BY g.name';
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ generics: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch generics' }); }
});

masterRoutes.post('/generics', requireRole(...PHARM_WRITE), zValidator('json', createGenericSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(
      `INSERT INTO pharmacy_generics (name, category_id, description, tenant_id, created_by) VALUES (?, ?, ?, ?, ?)`,
    ).bind(data.name, data.categoryId ?? null, data.description ?? null, tenantId, userId).run();
    return c.json({ message: 'Generic created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create generic' }); }
});

masterRoutes.put('/generics/:id', requireRole(...PHARM_WRITE), zValidator('json', updateGenericSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  try {
    const existing = await db.$client.prepare(
      `SELECT * FROM pharmacy_generics WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Generic not found' });
    await db.$client.prepare(
      `UPDATE pharmacy_generics SET name = ?, category_id = ?, description = ? WHERE id = ? AND tenant_id = ?`,
    ).bind(data.name ?? existing['name'], data.categoryId ?? existing['category_id'], data.description ?? existing['description'], id, tenantId).run();
    return c.json({ message: 'Generic updated' });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to update generic' }); }
});

// ─── ENHANCED PHARMACY SUPPLIERS ─────────────────────────────────────────────

masterRoutes.get('/pharmacy-suppliers', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(
      `SELECT * FROM pharmacy_suppliers WHERE tenant_id = ? AND is_active = 1 ORDER BY name`,
    ).bind(tenantId).all();
    return c.json({ suppliers: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch pharmacy suppliers' }); }
});

masterRoutes.post('/pharmacy-suppliers', requireRole(...PHARM_WRITE), zValidator('json', createPharmacySupplierSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(
      `INSERT INTO pharmacy_suppliers (name, contact_no, address, city, email, pan_no, credit_period, notes, tenant_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(data.name, data.contactNo ?? null, data.address ?? null, data.city ?? null, data.email ?? null, data.panNo ?? null, data.creditPeriod ?? 0, data.notes ?? null, tenantId, userId).run();
    return c.json({ message: 'Supplier created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create pharmacy supplier' }); }
});

masterRoutes.put('/pharmacy-suppliers/:id', requireRole(...PHARM_WRITE), zValidator('json', updatePharmacySupplierSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  try {
    const existing = await db.$client.prepare(
      `SELECT * FROM pharmacy_suppliers WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Supplier not found' });
    await db.$client.prepare(
      `UPDATE pharmacy_suppliers SET name=?, contact_no=?, address=?, city=?, email=?, pan_no=?, credit_period=?, notes=?, updated_at=datetime('now', '+6 hours')
       WHERE id=? AND tenant_id=?`,
    ).bind(
      data.name ?? existing['name'], data.contactNo ?? existing['contact_no'],
      data.address ?? existing['address'], data.city ?? existing['city'],
      data.email ?? existing['email'], data.panNo ?? existing['pan_no'],
      data.creditPeriod ?? existing['credit_period'], data.notes ?? existing['notes'],
      id, tenantId,
    ).run();
    return c.json({ message: 'Supplier updated' });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to update supplier' }); }
});

// ─── UOM ─────────────────────────────────────────────────────────────────────

masterRoutes.get('/uom', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(
      `SELECT * FROM pharmacy_uom WHERE tenant_id = ? AND is_active = 1 ORDER BY name`,
    ).bind(tenantId).all();
    return c.json({ uom: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch UOM' }); }
});

masterRoutes.post('/uom', requireRole(...PHARM_WRITE), zValidator('json', createUOMSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(
      `INSERT INTO pharmacy_uom (name, description, tenant_id, created_by) VALUES (?, ?, ?, ?)`,
    ).bind(data.name, data.description ?? null, tenantId, userId).run();
    return c.json({ message: 'UOM created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create UOM' }); }
});

// ─── PACKING TYPES ───────────────────────────────────────────────────────────

masterRoutes.get('/packing-types', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(
      `SELECT * FROM pharmacy_packing_types WHERE tenant_id = ? AND is_active = 1 ORDER BY name`,
    ).bind(tenantId).all();
    return c.json({ packingTypes: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch packing types' }); }
});

masterRoutes.post('/packing-types', requireRole(...PHARM_WRITE), zValidator('json', createPackingTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(
      `INSERT INTO pharmacy_packing_types (name, quantity, tenant_id, created_by) VALUES (?, ?, ?, ?)`,
    ).bind(data.name, data.quantity ?? 1, tenantId, userId).run();
    return c.json({ message: 'Packing type created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create packing type' }); }
});

// ─── RACKS ────────────────────────────────────────────────────────────────────

masterRoutes.get('/racks', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(
      `SELECT r.*, p.rack_no as parent_rack_no FROM pharmacy_racks r
       LEFT JOIN pharmacy_racks p ON r.parent_id = p.id
       WHERE r.tenant_id = ? AND r.is_active = 1 ORDER BY r.rack_no`,
    ).bind(tenantId).all();
    return c.json({ racks: results });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch racks' }); }
});

masterRoutes.post('/racks', requireRole(...PHARM_WRITE), zValidator('json', createRackSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(
      `INSERT INTO pharmacy_racks (rack_no, description, parent_id, tenant_id, created_by) VALUES (?, ?, ?, ?, ?)`,
    ).bind(data.rackNo, data.description ?? null, data.parentId ?? null, tenantId, userId).run();
    return c.json({ message: 'Rack created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create rack' }); }
});

// ─── PHARMACY ITEMS (Enhanced medicine master) ────────────────────────────────

masterRoutes.get('/items', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { search, genericId, categoryId } = c.req.query();
  const { page, limit, offset } = getPagination(c);
  try {
    let where = 'WHERE i.tenant_id = ? AND i.is_active = 1';
    const params: (string | number)[] = [tenantId];
    if (search)     { where += ' AND i.name LIKE ?';       params.push(`%${search}%`); }
    if (genericId)  { where += ' AND i.generic_id = ?';    params.push(genericId); }
    if (categoryId) { where += ' AND i.category_id = ?';   params.push(categoryId); }

    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM pharmacy_items i ${where}`,
    ).bind(...params).first<{ total: number }>();

    const { results } = await db.$client.prepare(`
      SELECT i.*, g.name as generic_name, cat.name as category_name,
             u.name as uom_name, pt.name as packing_name,
             COALESCE(SUM(s.available_qty), 0) as stock_qty
      FROM pharmacy_items i
      LEFT JOIN pharmacy_generics g ON i.generic_id = g.id
      LEFT JOIN pharmacy_categories cat ON i.category_id = cat.id
      LEFT JOIN pharmacy_uom u ON i.uom_id = u.id
      LEFT JOIN pharmacy_packing_types pt ON i.packing_type_id = pt.id
      LEFT JOIN pharmacy_stock s ON i.id = s.item_id AND s.tenant_id = i.tenant_id AND s.is_active = 1
      ${where}
      GROUP BY i.id ORDER BY i.name LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({
      items: results,
      meta: paginationMeta(page, limit, countResult?.total ?? 0),
    });
  } catch { throw new HTTPException(500, { message: 'Failed to fetch pharmacy items' }); }
});

masterRoutes.get('/items/:id', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  try {
    const item = await db.$client.prepare(`
      SELECT i.*, g.name as generic_name, cat.name as category_name
      FROM pharmacy_items i
      LEFT JOIN pharmacy_generics g ON i.generic_id = g.id
      LEFT JOIN pharmacy_categories cat ON i.category_id = cat.id
      WHERE i.id = ? AND i.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!item) throw new HTTPException(404, { message: 'Item not found' });

    const { results: stock } = await db.$client.prepare(
      `SELECT * FROM pharmacy_stock WHERE item_id = ? AND tenant_id = ? AND is_active = 1 ORDER BY expiry_date ASC`,
    ).bind(id, tenantId).all();

    return c.json({ item, stock });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to fetch item' }); }
});

masterRoutes.post('/items', requireRole(...PHARM_WRITE), zValidator('json', createPharmacyItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  try {
    const result = await db.$client.prepare(`
      INSERT INTO pharmacy_items
        (name, item_code, generic_id, category_id, uom_id, packing_type_id,
         reorder_level, min_stock_qty, purchase_vat_pct, sales_vat_pct,
         is_vat_applicable, is_narcotic, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.name, data.itemCode ?? null, data.genericId ?? null, data.categoryId ?? null,
      data.uomId ?? null, data.packingTypeId ?? null,
      data.reorderLevel ?? 0, data.minStockQty ?? 0,
      data.purchaseVatPct ?? 0, data.salesVatPct ?? 0,
      data.isVatApplicable ? 1 : 0, data.isNarcotic ? 1 : 0,
      tenantId, userId,
    ).run();
    return c.json({ message: 'Item created', id: result.meta.last_row_id }, 201);
  } catch { throw new HTTPException(500, { message: 'Failed to create pharmacy item' }); }
});

masterRoutes.put('/items/:id', requireRole(...PHARM_WRITE), zValidator('json', updatePharmacyItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');
  try {
    const existing = await db.$client.prepare(
      `SELECT * FROM pharmacy_items WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Item not found' });
    await db.$client.prepare(`
      UPDATE pharmacy_items SET name=?, item_code=?, generic_id=?, category_id=?,
        uom_id=?, packing_type_id=?, reorder_level=?, min_stock_qty=?,
        purchase_vat_pct=?, sales_vat_pct=?, is_vat_applicable=?, is_narcotic=?,
        updated_at=datetime('now', '+6 hours')
      WHERE id=? AND tenant_id=?
    `).bind(
      data.name ?? existing['name'], data.itemCode ?? existing['item_code'],
      data.genericId ?? existing['generic_id'], data.categoryId ?? existing['category_id'],
      data.uomId ?? existing['uom_id'], data.packingTypeId ?? existing['packing_type_id'],
      data.reorderLevel ?? existing['reorder_level'], data.minStockQty ?? existing['min_stock_qty'],
      data.purchaseVatPct ?? existing['purchase_vat_pct'], data.salesVatPct ?? existing['sales_vat_pct'],
      data.isVatApplicable !== undefined ? (data.isVatApplicable ? 1 : 0) : existing['is_vat_applicable'],
      data.isNarcotic !== undefined ? (data.isNarcotic ? 1 : 0) : existing['is_narcotic'],
      id, tenantId,
    ).run();
    return c.json({ message: 'Item updated' });
  } catch (e) { if (e instanceof HTTPException) throw e; throw new HTTPException(500, { message: 'Failed to update item' }); }
});


export default masterRoutes;
