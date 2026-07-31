type PatientIdentityRow = {
  id: number | string;
  tenant_id?: string | number | null;
  uhid?: string | null;
  patient_code?: string | null;
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadPatientRows(
  database: D1Database,
  tenantId: string,
  column: 'id' | 'uhid' | 'patient_code',
  values: Array<string | number>,
  tenantScoped = true,
): Promise<PatientIdentityRow[]> {
  const rows: PatientIdentityRow[] = [];
  for (const group of chunks([...new Set(values)], 100)) {
    if (group.length === 0) continue;
    const placeholders = group.map(() => '?').join(', ');
    const tenantWhere = tenantScoped ? 'tenant_id = ? AND ' : '';
    const { results } = await database.prepare(`
      SELECT id, tenant_id, uhid, patient_code
      FROM patients
      WHERE ${tenantWhere}${column} IN (${placeholders})
    `).bind(...(tenantScoped ? [tenantId, ...group] : group)).all<PatientIdentityRow>();
    rows.push(...(results ?? []));
  }
  return rows;
}

export async function assertPatientSnapshotIdentitySafe(
  database: D1Database,
  tenantId: string,
  incomingRows: Array<Record<string, unknown>>,
): Promise<void> {
  const incoming = incomingRows.filter((row) =>
    row.id !== null
    && row.id !== undefined
    && String(row.tenant_id ?? '') === tenantId,
  );
  if (incoming.length === 0) return;

  const ids = incoming.map((row) => String(row.id));
  const uhids = incoming.map((row) => text(row.uhid)).filter((value): value is string => Boolean(value));
  const patientCodes = incoming.map((row) => text(row.patient_code)).filter((value): value is string => Boolean(value));

  const [byIdRows, byUhidRows, byCodeRows] = await Promise.all([
    loadPatientRows(database, tenantId, 'id', ids, false),
    loadPatientRows(database, tenantId, 'uhid', uhids),
    loadPatientRows(database, tenantId, 'patient_code', patientCodes),
  ]);

  const byId = new Map(byIdRows.map((row) => [String(row.id), row]));
  const byUhid = new Map(byUhidRows.flatMap((row) => {
    const value = text(row.uhid);
    return value ? [[value, row] as const] : [];
  }));
  const byCode = new Map(byCodeRows.flatMap((row) => {
    const value = text(row.patient_code);
    return value ? [[value, row] as const] : [];
  }));

  for (const row of incoming) {
    const incomingId = String(row.id);
    const incomingUhid = text(row.uhid);
    const incomingCode = text(row.patient_code);
    const localById = byId.get(incomingId);

    if (localById) {
      if (String(localById.tenant_id ?? '') !== tenantId) {
        throw new Error(`Cloud patient ${incomingId} ID belongs to another local tenant; stable entity mapping is required`);
      }
      const localUhid = text(localById.uhid);
      const localCode = text(localById.patient_code);
      if (incomingUhid && localUhid && incomingUhid !== localUhid) {
        throw new Error(`Cloud patient ${incomingId} UHID conflicts with the local patient record`);
      }
      if (incomingCode && localCode && incomingCode !== localCode) {
        throw new Error(`Cloud patient ${incomingId} patient code conflicts with the local patient record`);
      }
    }

    const naturalMatch = (incomingUhid ? byUhid.get(incomingUhid) : null)
      ?? (incomingCode ? byCode.get(incomingCode) : null);
    if (naturalMatch && String(naturalMatch.id) !== incomingId) {
      throw new Error(
        `Cloud patient ${incomingId} identity already belongs to local patient ${naturalMatch.id}; stable entity mapping is required`,
      );
    }
  }
}
