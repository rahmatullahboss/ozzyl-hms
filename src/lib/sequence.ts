/**
 * Sequence counter utility for HMS.
 * Generates unique, tenant-scoped sequential numbers for:
 * - patient codes:  P-000001
 * - invoices:       INV-000001
 * - receipts:       RCP-000001
 * - lab orders:     LO-000001
 * - visits:         V-000001
 * - purchases:      PUR-000001
 */
export async function getNextSequence(
  db: D1Database,
  tenantId: string,
  counterType: string,
  prefix = '',
): Promise<string> {
  // Atomically upsert and increment – works correctly with D1's SQLite engine
  const row = await db
    .prepare(
      `INSERT INTO sequence_counters (counter_type, prefix, current_value, tenant_id)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(counter_type, tenant_id)
       DO UPDATE SET current_value = current_value + 1
       RETURNING current_value`,
    )
    .bind(counterType, prefix, tenantId)
    .first<{ current_value: number }>();

  const value = row?.current_value ?? 1;
  const paddedValue = String(value).padStart(6, '0');
  return prefix ? `${prefix}-${paddedValue}` : paddedValue;
}

/**
 * Returns the next numeric sequence value (no prefix formatting).
 * Useful when a pre-generated numeric ID is needed before an atomic batch.
 */
export async function getNextNumericSequence(
  db: D1Database,
  tenantId: string,
  counterType: string,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO sequence_counters (counter_type, prefix, current_value, tenant_id)
       VALUES (?, '', 1, ?)
       ON CONFLICT(counter_type, tenant_id)
       DO UPDATE SET current_value = current_value + 1
       RETURNING current_value`,
    )
    .bind(counterType, tenantId)
    .first<{ current_value: number }>();

  return row?.current_value ?? 1;
}
