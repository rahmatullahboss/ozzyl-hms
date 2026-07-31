export const DEFAULT_WEBSITE_THEME = 'arogyaseva';
export const DEFAULT_WEBSITE_PRIMARY_COLOR = '#0891b2';
export const DEFAULT_WEBSITE_SECONDARY_COLOR = '#059669';

export function buildDefaultWebsiteConfig(hospitalName?: string | null): Record<string, unknown> {
  const name = hospitalName?.trim() || 'Hospital';
  return {
    is_enabled: 1,
    theme: DEFAULT_WEBSITE_THEME,
    seo_title: name,
    seo_description: `${name} — Your trusted healthcare partner`,
    primary_color: DEFAULT_WEBSITE_PRIMARY_COLOR,
    secondary_color: DEFAULT_WEBSITE_SECONDARY_COLOR,
  };
}

export async function seedWebsiteDefaults(
  db: D1Database,
  tenantId: number,
  hospitalName?: string | null,
): Promise<void> {
  const defaults = buildDefaultWebsiteConfig(hospitalName);

  await db.prepare(
    `INSERT OR IGNORE INTO website_config (
       tenant_id, is_enabled, theme, seo_title, seo_description,
       primary_color, secondary_color, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    tenantId,
    defaults.is_enabled,
    defaults.theme,
    defaults.seo_title,
    defaults.seo_description,
    defaults.primary_color,
    defaults.secondary_color,
  ).run();
}
