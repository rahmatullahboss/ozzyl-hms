/**
 * Pharmacy multi-price category utility.
 *
 * Allows different sale prices for pharmacy items based on price categories
 * (e.g., General, SSF, Insurance, Government).
 *
 * Falls back to base sale_price when no category-specific price exists.
 */

/**
 * Get the effective sale price for a pharmacy item, considering price category.
 *
 * Resolution priority:
 * 1. Category-specific price (if > 0)
 * 2. Base sale_price from pharmacy_items
 */
export async function getPharmacyItemPrice(
  db: D1Database,
  tenantId: string,
  pharmacyItemId: number,
  priceCategoryId?: number | null,
): Promise<number> {
  // Get base price
  const item = await db.prepare(
    'SELECT sale_price FROM pharmacy_items WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(pharmacyItemId, tenantId).first<{ sale_price: number }>();

  if (!item) throw new Error(`Pharmacy item ${pharmacyItemId} not found`);
  const basePrice = item.sale_price;

  // If no category specified, return base price
  if (!priceCategoryId) return basePrice;

  // Try to get category-specific price
  const categoryPrice = await db.prepare(`
    SELECT sale_price FROM pharmacy_item_price_category_map
    WHERE pharmacy_item_id = ? AND price_category_id = ? AND tenant_id = ? AND is_active = 1
  `).bind(pharmacyItemId, priceCategoryId, tenantId).first<{ sale_price: number }>();

  return (categoryPrice?.sale_price && categoryPrice.sale_price > 0) ? categoryPrice.sale_price : basePrice;
}

/**
 * Get prices for multiple pharmacy items at once (batch).
 * Returns a map of pharmacy_item_id → effective price.
 */
export async function getPharmacyItemPricesBatch(
  db: D1Database,
  tenantId: string,
  pharmacyItemIds: number[],
  priceCategoryId?: number | null,
): Promise<Map<number, number>> {
  if (pharmacyItemIds.length === 0) return new Map();

  const placeholders = pharmacyItemIds.map(() => '?').join(',');

  // Get all base prices
  const { results } = await db.prepare(`
    SELECT id, sale_price FROM pharmacy_items
    WHERE id IN (${placeholders}) AND tenant_id = ? AND is_active = 1
  `).bind(...pharmacyItemIds, tenantId).all<{ id: number; sale_price: number }>();

  const priceMap = new Map<number, number>();
  for (const item of results) {
    priceMap.set(item.id, item.sale_price);
  }

  // If category specified, override with category prices
  if (priceCategoryId) {
    const { results: catPrices } = await db.prepare(`
      SELECT pharmacy_item_id, sale_price FROM pharmacy_item_price_category_map
      WHERE pharmacy_item_id IN (${placeholders}) AND price_category_id = ? AND tenant_id = ? AND is_active = 1
    `).bind(...pharmacyItemIds, priceCategoryId, tenantId).all<{ pharmacy_item_id: number; sale_price: number }>();

    for (const cp of catPrices) {
      if (cp.sale_price > 0) {
        priceMap.set(cp.pharmacy_item_id, cp.sale_price);
      }
    }
  }

  return priceMap;
}

/**
 * Set a category-specific price for a pharmacy item.
 */
export async function setPharmacyItemCategoryPrice(
  db: D1Database,
  tenantId: string,
  pharmacyItemId: number,
  priceCategoryId: number,
  salePrice: number,
  userId: number,
): Promise<void> {
  await db.prepare(`
    INSERT INTO pharmacy_item_price_category_map
      (tenant_id, pharmacy_item_id, price_category_id, sale_price, is_active, created_by, created_at)
    VALUES (?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
    ON CONFLICT(tenant_id, pharmacy_item_id, price_category_id)
    DO UPDATE SET sale_price = excluded.sale_price, is_active = 1, updated_at = datetime('now', '+6 hours')
  `).bind(tenantId, pharmacyItemId, priceCategoryId, salePrice, userId).run();
}
