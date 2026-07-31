export type DoctorAnalyticsProviderMode = 'legacy' | 'shadow' | 'canonical';

export interface DoctorAnalyticsProviderPreparedStatement {
  bind(...values: unknown[]): DoctorAnalyticsProviderPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface DoctorAnalyticsProviderDatabase {
  prepare(sql: string): DoctorAnalyticsProviderPreparedStatement;
}

type DoctorAnalyticsProviderFlagRow = {
  mode: string;
  is_enabled: number | string;
};

const FLAG_KEY = 'canonical_doctor_analytics_v1';

export async function resolveDoctorAnalyticsProviderMode(
  db: DoctorAnalyticsProviderDatabase,
  tenantId: string,
): Promise<DoctorAnalyticsProviderMode> {
  const exactTenantId = tenantId.trim();
  if (!exactTenantId || exactTenantId !== tenantId) {
    throw new TypeError('tenantId must be a non-empty exact value');
  }
  let row: DoctorAnalyticsProviderFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode,is_enabled
      FROM canonical_feature_flags
      WHERE tenant_id=? AND flag_key=?
      LIMIT 1
    `).bind(exactTenantId, FLAG_KEY).first<DoctorAnalyticsProviderFlagRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) return 'legacy';
    throw error;
  }
  if (!row || Number(row.is_enabled) !== 1) return 'legacy';
  if (row.mode === 'canonical') return 'canonical';
  if (row.mode === 'shadow') return 'shadow';
  return 'legacy';
}
