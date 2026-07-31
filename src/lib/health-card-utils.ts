// Utility for health card lifecycle management

/**
 * Mark all active health cards for a patient as 'stale'.
 * Call this when critical patient data changes (blood group, allergies, etc.).
 */
export async function markCardsStale(db: D1Database, tenantId: string, patientId: number): Promise<number> {
  const result = await db.prepare(`
    UPDATE health_cards
    SET status = 'stale'
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
  `).bind(tenantId, patientId).run();

  return result.meta?.changes ?? 0;
}
