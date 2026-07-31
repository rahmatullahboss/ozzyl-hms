export interface RecordInventoryDemandInput {
  tenantId: string;
  itemId: number;
  demandDate: string;
  quantity: number;
  sourceScope: string;
  sourceType: string;
  sourceId: string;
}

export async function recordInventoryDemand(
  db: D1Database,
  input: RecordInventoryDemandInput,
): Promise<{ recorded: boolean }> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Inventory demand quantity must be greater than zero');
  }

  const eventInsert = await db.prepare(`
    INSERT OR IGNORE INTO inventory_demand_source_event
      (tenant_id, inventory_item_id, demand_date, source_scope, source_type, source_id, quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    input.itemId,
    input.demandDate.slice(0, 10),
    input.sourceScope,
    input.sourceType,
    input.sourceId,
    input.quantity,
  ).run();

  await db.prepare(`
    INSERT INTO inventory_demand_daily
      (tenant_id, inventory_item_id, demand_date, source_scope, consumed_qty, completed_event_count, updated_at)
    SELECT ?, ?, ?, ?,
      COALESCE(SUM(quantity), 0),
      COUNT(*),
      CURRENT_TIMESTAMP
    FROM inventory_demand_source_event
    WHERE tenant_id = ?
      AND inventory_item_id = ?
      AND demand_date = ?
      AND source_scope = ?
    ON CONFLICT(tenant_id, inventory_item_id, demand_date, source_scope) DO UPDATE SET
      consumed_qty = excluded.consumed_qty,
      completed_event_count = excluded.completed_event_count,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    input.tenantId,
    input.itemId,
    input.demandDate.slice(0, 10),
    input.sourceScope,
    input.tenantId,
    input.itemId,
    input.demandDate.slice(0, 10),
    input.sourceScope,
  ).run();

  return {
    recorded: Number((eventInsert.meta as { changes?: number } | undefined)?.changes ?? 0) > 0,
  };
}
