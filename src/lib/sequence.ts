/**
 * Sequence counter utility for HMS.
 * Generates unique, tenant-scoped sequential numbers for:
 * - patient codes:  P-000001
 * - invoices:       INV-000001
 * - receipts:       RCP-000001
 * - lab orders:     LO-000001
 * - visits:         V-000001
 * - purchases:      PUR-000001
 *
 * Workstation-local nodes add their stable short node code to prefixed
 * sequences (for example INV-A-2026-WS-A1B2C3D4-000001). This prevents two
 * isolated PCs that started from the same cloned sequence counter from
 * producing the same externally-visible number. Cloud/normal deployments do
 * not have a workstation identity row and preserve the legacy format.
 */
import { formatScopedSequence, readWorkstationSequenceCode } from './workstation-sequence';

export async function getNextSequence(
  db: D1Database,
  tenantId: string,
  counterType: string,
  prefix = '',
): Promise<string> {
  // Atomically upsert and increment – works correctly with D1's SQLite engine.
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
  // Only workstation nodes have this singleton row. Production D1 keeps the
  // existing number shape and therefore requires no migration/cutover.
  const workstationCode = prefix ? await readWorkstationSequenceCode(db) : null;
  return formatScopedSequence(prefix, value, workstationCode);
}

/**
 * Returns the next numeric sequence value (no prefix formatting).
 * Useful when a pre-generated numeric ID is needed before an atomic batch.
 * Numeric internal IDs are intentionally NOT workstation-decorated; sync
 * entity mappings use the immutable workstation UUID to disambiguate them.
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
