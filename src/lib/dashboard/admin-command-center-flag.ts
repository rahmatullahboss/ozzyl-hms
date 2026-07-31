export const ADMIN_COMMAND_CENTER_FLAG_KEY = 'admin_command_center_v2';
export const ADMIN_COMMAND_CENTER_PREVIEW_HOST = 'command-center.ozzyl.com';
export const ADMIN_COMMAND_CENTER_PREVIEW_MODE = 'dashboard-v2';

export function isAdminCommandCenterPreviewMode(value: string | undefined): boolean {
  return value === ADMIN_COMMAND_CENTER_PREVIEW_MODE;
}

export function isAdminCommandCenterPreviewHostname(hostname: string): boolean {
  return hostname.trim().toLowerCase().replace(/\.$/, '') === ADMIN_COMMAND_CENTER_PREVIEW_HOST;
}

export interface AdminCommandCenterFlagPreparedStatement {
  bind(...values: unknown[]): AdminCommandCenterFlagPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface AdminCommandCenterFlagDatabase {
  prepare(sql: string): AdminCommandCenterFlagPreparedStatement;
}

type AdminCommandCenterFlagRow = {
  mode: string;
  is_enabled: number | string;
};

export async function isAdminCommandCenterEnabled(
  db: AdminCommandCenterFlagDatabase,
  tenantId: string,
): Promise<boolean> {
  const exactTenantId = tenantId.trim();
  if (!exactTenantId || exactTenantId !== tenantId) {
    throw new TypeError('tenantId must be a non-empty exact value');
  }

  let row: AdminCommandCenterFlagRow | null;
  try {
    row = await db.prepare(`
      SELECT mode, is_enabled
      FROM canonical_feature_flags
      WHERE tenant_id = ? AND flag_key = ?
      LIMIT 1
    `).bind(exactTenantId, ADMIN_COMMAND_CENTER_FLAG_KEY).first<AdminCommandCenterFlagRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*canonical_feature_flags/i.test(message)) return false;
    throw error;
  }

  if (!row || Number(row.is_enabled) !== 1) return false;
  return row.mode !== 'disabled';
}
