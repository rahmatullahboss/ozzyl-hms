/**
 * Recursive parent-visit chain utility.
 *
 * Walks the visit chain to find the root visit (original visit that started
 * the follow-up chain). Used for follow-up eligibility checking.
 *
 * DanpheEMR pattern: ParentVisitId → recursive traversal → root visit.
 */

export interface VisitChainEntry {
  id: number;
  parent_visit_id: number | null;
  visit_date: string;
}

/**
 * Find the root visit in a follow-up chain.
 * Walks up the parent_visit_id chain until no parent is found.
 * Includes cycle detection.
 */
export function findRootVisit(
  visitId: number,
  visitMap: Map<number, VisitChainEntry>,
): VisitChainEntry | null {
  const visited = new Set<number>();
  let current = visitMap.get(visitId) ?? null;

  while (current?.parent_visit_id) {
    if (visited.has(current.id)) break; // cycle detection
    visited.add(current.id);
    current = visitMap.get(current.parent_visit_id) ?? null;
  }

  return current;
}

/**
 * Get the depth of a follow-up chain (0 = root visit, 1 = first follow-up, etc.).
 */
export function getChainDepth(
  visitId: number,
  visitMap: Map<number, VisitChainEntry>,
): number {
  let depth = 0;
  const visited = new Set<number>();
  let current = visitMap.get(visitId) ?? null;

  while (current?.parent_visit_id) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    depth++;
    current = visitMap.get(current.parent_visit_id) ?? null;
  }

  return depth;
}

/**
 * Get the full chain from root to the given visit.
 * Returns array ordered from root to current.
 */
export function getFullChain(
  visitId: number,
  visitMap: Map<number, VisitChainEntry>,
): VisitChainEntry[] {
  const chain: VisitChainEntry[] = [];
  const visited = new Set<number>();
  let current = visitMap.get(visitId) ?? null;

  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    chain.push(current);
    current = current.parent_visit_id ? (visitMap.get(current.parent_visit_id) ?? null) : null;
  }

  return chain.reverse(); // root first
}

/**
 * Check if a patient is eligible for a follow-up based on the root visit date.
 * Uses the recursive chain to find the original visit.
 */
export async function isEligibleForFollowUp(
  db: D1Database,
  tenantId: string,
  patientId: number,
  doctorId: number,
  eligibilityDays: number,
): Promise<{ eligible: boolean; rootVisitDate: string | null; chainDepth: number; reason: string | null }> {
  // Find the most recent visit for this patient+doctor
  const lastVisit = await db.prepare(`
    SELECT id, parent_visit_id, COALESCE(visit_date, date(created_at)) as visit_date
    FROM visits
    WHERE tenant_id = ? AND patient_id = ? AND doctor_id = ?
      AND COALESCE(status, '') IN ('completed', 'concluded', 'closed')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(tenantId, patientId, doctorId).first<VisitChainEntry>();

  if (!lastVisit) {
    return { eligible: false, rootVisitDate: null, chainDepth: 0, reason: 'No previous visit found with this doctor' };
  }

  // Build visit map for chain traversal (load all visits for this patient+doctor)
  const { results } = await db.prepare(`
    SELECT id, parent_visit_id, COALESCE(visit_date, date(created_at)) as visit_date
    FROM visits
    WHERE tenant_id = ? AND patient_id = ? AND doctor_id = ?
  `).bind(tenantId, patientId, doctorId).all<VisitChainEntry>();

  const visitMap = new Map(results.map(v => [v.id, v]));

  // Find root visit
  const rootVisit = findRootVisit(lastVisit.id, visitMap);
  const chainDepth = getChainDepth(lastVisit.id, visitMap);

  if (!rootVisit) {
    return { eligible: false, rootVisitDate: null, chainDepth, reason: 'Could not determine root visit' };
  }

  // Check eligibility based on root visit date
  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - eligibilityDays);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  const eligible = rootVisit.visit_date >= cutoff;

  return {
    eligible,
    rootVisitDate: rootVisit.visit_date,
    chainDepth,
    reason: eligible
      ? null
      : `Root visit (${rootVisit.visit_date}) is outside the ${eligibilityDays}-day follow-up window`,
  };
}
