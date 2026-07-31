/**
 * Pharmacy barcode auto-generation utility.
 *
 * Generates unique, scannable barcodes for pharmacy items and stock batches.
 * Format: PH-{TENANT_CODE}-{PADDED_ID}
 * Example: PH-DEM-000042
 */

/**
 * Generate a barcode for a pharmacy item.
 */
export function generatePharmacyItemBarcode(tenantCode: string, itemId: number): string {
  return `PH-${tenantCode.toUpperCase()}-${String(itemId).padStart(6, '0')}`;
}

/**
 * Generate a barcode for a stock batch (GRN item).
 * Format: PH-{TENANT}-{ITEM_ID}-{BATCH_SEQ}
 * Example: PH-DEM-0042-001
 */
export function generateStockBatchBarcode(tenantCode: string, itemId: number, batchSequence: number): string {
  return `PH-${tenantCode.toUpperCase()}-${String(itemId).padStart(4, '0')}-${String(batchSequence).padStart(3, '0')}`;
}

/**
 * Auto-generate and assign barcode to a pharmacy item if not already set.
 * Returns the barcode (existing or newly generated).
 */
export async function ensurePharmacyItemBarcode(
  db: D1Database,
  tenantId: string,
  itemId: number,
  tenantCode: string,
): Promise<string> {
  // Check if item already has a barcode
  const existing = await db.prepare(
    'SELECT barcode FROM pharmacy_items WHERE id = ? AND tenant_id = ?'
  ).bind(itemId, tenantId).first<{ barcode: string | null }>();

  if (existing?.barcode) {
    return existing.barcode;
  }

  // Generate new barcode
  const barcode = generatePharmacyItemBarcode(tenantCode, itemId);

  // Check for collision (unlikely but safe)
  const collision = await db.prepare(
    'SELECT id FROM pharmacy_items WHERE barcode = ? AND tenant_id = ? AND id != ?'
  ).bind(barcode, tenantId, itemId).first();

  if (collision) {
    // Fallback: append timestamp
    const fallback = `${barcode}-${Date.now().toString(36).slice(-4)}`.toUpperCase();
    await db.prepare(
      'UPDATE pharmacy_items SET barcode = ?, updated_at = datetime(\'now\', \'+6 hours\') WHERE id = ? AND tenant_id = ?'
    ).bind(fallback, itemId, tenantId).run();
    return fallback;
  }

  await db.prepare(
    'UPDATE pharmacy_items SET barcode = ?, updated_at = datetime(\'now\', \'+6 hours\') WHERE id = ? AND tenant_id = ?'
  ).bind(barcode, itemId, tenantId).run();

  return barcode;
}

/**
 * Generate barcodes for all items in a GRN that don't have barcodes yet.
 */
export async function ensureGrnItemBarcodes(
  db: D1Database,
  tenantId: string,
  grnItems: Array<{ item_id: number; batch_no: string }>,
  tenantCode: string,
): Promise<Array<{ item_id: number; barcode: string }>> {
  const results: Array<{ item_id: number; barcode: string }> = [];
  const batchCounters = new Map<number, number>();

  for (const item of grnItems) {
    const seq = (batchCounters.get(item.item_id) ?? 0) + 1;
    batchCounters.set(item.item_id, seq);

    const barcode = generateStockBatchBarcode(tenantCode, item.item_id, seq);
    results.push({ item_id: item.item_id, barcode });
  }

  return results;
}
