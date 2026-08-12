const WORKSTATION_CODE_RE = /^WS-[A-Z0-9]{6,12}$/;

let cachedWorkstationCode: string | null | undefined;

export function normalizeWorkstationCode(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return WORKSTATION_CODE_RE.test(normalized) ? normalized : null;
}

export function formatScopedSequence(
  prefix: string,
  value: number,
  workstationCode?: string | null,
): string {
  const paddedValue = String(value).padStart(6, '0');
  if (!prefix) return paddedValue;

  const code = normalizeWorkstationCode(workstationCode);
  return code
    ? `${prefix}-${code}-${paddedValue}`
    : `${prefix}-${paddedValue}`;
}

export async function readWorkstationSequenceCode(db: D1Database): Promise<string | null> {
  if (cachedWorkstationCode !== undefined) return cachedWorkstationCode;

  try {
    const row = await db.prepare(`
      SELECT node_code
      FROM workstation_node_identity
      WHERE singleton_id = 1
      LIMIT 1
    `).first<{ node_code: string | null }>();
    cachedWorkstationCode = normalizeWorkstationCode(row?.node_code);
    return cachedWorkstationCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*workstation_node_identity/i.test(message)) {
      // Normal cloud deployments intentionally have no workstation identity.
      // Cache that fact for the lifetime of the Worker isolate so sequence
      // generation does not repeatedly pay for a failed metadata lookup.
      cachedWorkstationCode = null;
      return null;
    }
    throw error;
  }
}

/** Test-only reset for deterministic unit coverage. */
export function resetWorkstationSequenceCodeCache(): void {
  cachedWorkstationCode = undefined;
}
