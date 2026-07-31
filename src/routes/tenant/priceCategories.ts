import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getTodayGMT6 } from '../../lib/date-utils';
import {
  applyBillingServiceCategoryPriceMutation,
  billingPriceMapCanonicalSourceKey,
} from '../../lib/canonical/service-catalog-route-integration';

const priceCategories = new Hono<{ Bindings: Env; Variables: Variables }>();

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

function priceRouteIdempotencyKey(
  request: { header(name: string): string | undefined },
  operation: string,
  fallback: string,
): string {
  const supplied = request.header('Idempotency-Key')?.trim();
  return `route:service-price:${operation}:${supplied || fallback}`;
}

// GET /api/price-categories
priceCategories.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    `SELECT id, category_name, category_code, description, is_default, is_active, created_at
     FROM price_categories
     WHERE tenant_id = ? AND is_active = 1
     ORDER BY category_name`
  ).bind(tenantId).all();
  return c.json({ data: results });
});

// POST /api/price-categories
priceCategories.post('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const body = await c.req.json();
  const { categoryName, categoryCode, description, isDefault } = body;

  if (!categoryName || typeof categoryName !== 'string') {
    throw new HTTPException(400, { message: 'categoryName is required' });
  }

  if (isDefault) {
    await db.$client.prepare(
      `UPDATE price_categories SET is_default = 0 WHERE tenant_id = ?`
    ).bind(tenantId).run();
  }

  const result = await db.$client.prepare(`
    INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).bind(tenantId, categoryName, categoryCode ?? null, description ?? null, isDefault ? 1 : 0).run();

  return c.json({ id: result.meta.last_row_id, message: 'Price category created' }, 201);
});

// PUT /api/price-categories/:id
priceCategories.put('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const body = await c.req.json();
  const { categoryName, categoryCode, description, isDefault } = body;

  const existing = await db.$client.prepare(
    `SELECT id FROM price_categories WHERE id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Price category not found' });

  if (isDefault) {
    await db.$client.prepare(
      `UPDATE price_categories SET is_default = 0 WHERE tenant_id = ? AND id != ?`
    ).bind(tenantId, id).run();
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (categoryName !== undefined) { updates.push('category_name = ?'); params.push(categoryName); }
  if (categoryCode !== undefined) { updates.push('category_code = ?'); params.push(categoryCode ?? null); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description ?? null); }
  if (isDefault !== undefined) { updates.push('is_default = ?'); params.push(isDefault ? 1 : 0); }

  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });

  params.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE price_categories SET ${updates.join(', ')}, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();

  return c.json({ message: 'Price category updated' });
});

// DELETE /api/price-categories/:id
priceCategories.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const result = await db.$client.prepare(
    `UPDATE price_categories SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ? AND is_active = 1`
  ).bind(id, tenantId).run();

  if (!result.meta.changes) throw new HTTPException(404, { message: 'Price category not found' });
  return c.json({ message: 'Price category deactivated' });
});

// GET /api/price-categories/:id/items
priceCategories.get('/:id/items', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const { results } = await db.$client.prepare(`
    SELECT
      si.id,
      si.item_name,
      si.item_code,
      si.service_department_id,
      sd.department_name,
      si.price as base_price,
      m.price as category_price,
      m.is_discount_applicable,
      CASE WHEN m.id IS NOT NULL THEN 1 ELSE 0 END as has_mapping
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON si.service_department_id = sd.id
     AND sd.tenant_id = si.tenant_id
    LEFT JOIN billing_item_price_category_maps m
      ON m.service_item_id = si.id
      AND m.price_category_id = ?
      AND m.tenant_id = ?
      AND m.is_active = 1
    WHERE si.tenant_id = ? AND si.is_active = 1
      AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))
    ORDER BY sd.department_name, si.display_order, si.item_name
  `).bind(id, tenantId, tenantId).all();

  return c.json({ data: results });
});

// POST /api/price-categories/:id/items/:itemId
priceCategories.post('/:id/items/:itemId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  const body = await c.req.json();
  const { price, isDiscountApplicable } = body;

  if (price === undefined || price === null || Number.isNaN(Number(price))) {
    throw new HTTPException(400, { message: 'price is required' });
  }

  const existing = await db.$client.prepare(
    `SELECT id FROM billing_item_price_category_maps
     WHERE tenant_id = ? AND service_item_id = ? AND price_category_id = ? AND is_active = 1`
  ).bind(tenantId, itemId, id).first();

  if (existing) throw new HTTPException(409, { message: 'Price mapping already exists. Use PUT to update.' });

  const sourceKey = billingPriceMapCanonicalSourceKey(itemId, id);
  const occurredAtUtc = new Date().toISOString();
  const authoritative = c.env.DB.prepare(`
    INSERT INTO billing_item_price_category_maps (
      tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
      canonical_source_key,created_at,updated_at
    ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
  `).bind(tenantId, itemId, id, price, isDiscountApplicable !== false ? 1 : 0, sourceKey);
  await applyBillingServiceCategoryPriceMutation(c.env.DB, {
    tenantId,
    serviceItemId: itemId,
    priceCategoryId: id,
    price,
    isActive: true,
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: priceRouteIdempotencyKey(
      c.req,
      `create:${itemId}:${id}`,
      `${sourceKey}:${price}`,
    ),
  }, { authoritativeStatements: [authoritative] });
  const created = await c.env.DB.prepare(`
    SELECT id FROM billing_item_price_category_maps
    WHERE tenant_id=? AND service_item_id=? AND price_category_id=?
    LIMIT 1
  `).bind(tenantId, itemId, id).first<{ id: number }>();

  return c.json({ id: Number(created?.id ?? 0), message: 'Price mapping created' }, 201);
});

// PUT /api/price-categories/:id/items/:itemId
priceCategories.put('/:id/items/:itemId', async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  const body = await c.req.json();
  const { price, isDiscountApplicable } = body;
  if (price === undefined && isDiscountApplicable === undefined) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  const current = await c.env.DB.prepare(`
    SELECT id,price,is_discount_applicable
    FROM billing_item_price_category_maps
    WHERE tenant_id=? AND service_item_id=? AND price_category_id=? AND is_active=1
    LIMIT 1
  `).bind(tenantId, itemId, id).first<{
    id: number;
    price: number;
    is_discount_applicable: number;
  }>();
  if (!current) throw new HTTPException(404, { message: 'Price mapping not found' });

  const nextPrice = price !== undefined ? price : Number(current.price);
  const nextDiscountApplicable = isDiscountApplicable !== undefined
    ? (isDiscountApplicable ? 1 : 0)
    : Number(current.is_discount_applicable ?? 1);
  const sourceKey = billingPriceMapCanonicalSourceKey(itemId, id);
  const occurredAtUtc = new Date().toISOString();
  const authoritative = c.env.DB.prepare(`
    UPDATE billing_item_price_category_maps
    SET price=?,is_discount_applicable=?,canonical_source_key=COALESCE(canonical_source_key,?),
        updated_at=datetime('now', '+6 hours')
    WHERE tenant_id=? AND service_item_id=? AND price_category_id=? AND is_active=1
  `).bind(nextPrice, nextDiscountApplicable, sourceKey, tenantId, itemId, id);
  await applyBillingServiceCategoryPriceMutation(c.env.DB, {
    tenantId,
    serviceItemId: itemId,
    priceCategoryId: id,
    price: nextPrice,
    isActive: true,
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: priceRouteIdempotencyKey(
      c.req,
      `update:${itemId}:${id}`,
      `${sourceKey}:${nextPrice}:${nextDiscountApplicable}`,
    ),
  }, { authoritativeStatements: [authoritative] });
  return c.json({ message: 'Price mapping updated' });
});

// DELETE /api/price-categories/:id/items/:itemId
priceCategories.delete('/:id/items/:itemId', async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const itemId = parseId(c.req.param('itemId'));
  const current = await c.env.DB.prepare(`
    SELECT id,price
    FROM billing_item_price_category_maps
    WHERE tenant_id=? AND service_item_id=? AND price_category_id=? AND is_active=1
    LIMIT 1
  `).bind(tenantId, itemId, id).first<{ id: number; price: number }>();
  if (!current) throw new HTTPException(404, { message: 'Price mapping not found' });

  const sourceKey = billingPriceMapCanonicalSourceKey(itemId, id);
  const occurredAtUtc = new Date().toISOString();
  const authoritative = c.env.DB.prepare(`
    UPDATE billing_item_price_category_maps
    SET is_active=0,canonical_source_key=COALESCE(canonical_source_key,?),
        updated_at=datetime('now', '+6 hours')
    WHERE tenant_id=? AND service_item_id=? AND price_category_id=? AND is_active=1
  `).bind(sourceKey, tenantId, itemId, id);
  await applyBillingServiceCategoryPriceMutation(c.env.DB, {
    tenantId,
    serviceItemId: itemId,
    priceCategoryId: id,
    price: Number(current.price),
    isActive: false,
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: priceRouteIdempotencyKey(
      c.req,
      `delete:${itemId}:${id}`,
      `${sourceKey}:${occurredAtUtc}`,
    ),
  }, { authoritativeStatements: [authoritative] });
  return c.json({ message: 'Price mapping removed' });
});

export default priceCategories;
