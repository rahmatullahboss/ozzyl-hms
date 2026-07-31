export type LabTestCommissionEligibilityRow = {
  id: number;
  is_commissionable: number | null;
};

function normalizeLabTestIds(labTestIds: Array<number | null | undefined>): number[] {
  return Array.from(new Set(
    labTestIds
      .map((value) => Number(value ?? 0))
      .filter((value) => Number.isInteger(value) && value > 0),
  ));
}

export async function loadLabTestCommissionEligibility(
  db: D1Database,
  tenantId: string | number,
  labTestIds: Array<number | null | undefined>,
): Promise<Map<number, boolean>> {
  const ids = normalizeLabTestIds(labTestIds);
  const eligibility = new Map<number, boolean>(ids.map((id) => [id, true]));
  if (ids.length === 0) return eligibility;

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(`
    SELECT id, COALESCE(is_commissionable, 1) AS is_commissionable
    FROM lab_test_catalog
    WHERE tenant_id = ? AND id IN (${placeholders})
  `).bind(tenantId, ...ids).all<LabTestCommissionEligibilityRow>();

  for (const row of results ?? []) {
    const id = Number(row.id);
    if (eligibility.has(id)) eligibility.set(id, Number(row.is_commissionable ?? 1) !== 0);
  }
  return eligibility;
}

export async function isLabTestCommissionEligible(
  db: D1Database,
  tenantId: string | number,
  labTestId: number | null | undefined,
): Promise<boolean> {
  const id = Number(labTestId ?? 0);
  if (!Number.isInteger(id) || id <= 0) return true;
  const eligibility = await loadLabTestCommissionEligibility(db, tenantId, [id]);
  return eligibility.get(id) ?? true;
}
