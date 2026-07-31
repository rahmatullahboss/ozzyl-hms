type DoctorIdentityRow = {
  id: number | string;
};

export async function resolveOrderingClinicianDoctorId(
  db: D1Database,
  tenantId: string,
  input: {
    enteredByUserId: string | number | null;
    explicitDoctorId?: number | null;
    visitId?: number | null;
  },
): Promise<number | null> {
  const explicitDoctorId = Number(input.explicitDoctorId ?? 0);
  if (Number.isInteger(explicitDoctorId) && explicitDoctorId > 0) {
    const explicit = await db.prepare(`
      SELECT id
      FROM doctors
      WHERE tenant_id = ?
        AND id = ?
        AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(tenantId, explicitDoctorId).first<DoctorIdentityRow>();

    return explicit && Number(explicit.id) === explicitDoctorId ? explicitDoctorId : null;
  }

  const visitId = Number(input.visitId ?? 0);
  if (Number.isInteger(visitId) && visitId > 0) {
    const visitDoctor = await db.prepare(`
      SELECT d.id
      FROM visits v
      JOIN doctors d
        ON d.id = v.doctor_id
       AND d.tenant_id = v.tenant_id
       AND COALESCE(d.is_active, 1) = 1
      WHERE v.tenant_id = ?
        AND v.id = ?
      LIMIT 1
    `).bind(tenantId, visitId).first<DoctorIdentityRow>();

    if (visitDoctor) return Number(visitDoctor.id);
  }

  if (input.enteredByUserId === null || input.enteredByUserId === undefined) return null;
  const enteredByUserId = String(input.enteredByUserId).trim();
  if (!enteredByUserId) return null;

  const linked = await db.prepare(`
    SELECT id
    FROM doctors
    WHERE tenant_id = ?
      AND CAST(user_id AS TEXT) = ?
      AND COALESCE(is_active, 1) = 1
    ORDER BY id ASC
    LIMIT 2
  `).bind(tenantId, enteredByUserId).all<DoctorIdentityRow>();

  const rows = linked.results ?? [];
  return rows.length === 1 ? Number(rows[0].id) : null;
}
