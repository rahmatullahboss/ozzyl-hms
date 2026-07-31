export async function resolveHospitalLogoDisplayUrl(db: D1Database, tenantId: string): Promise<string> {
  const tenant = await db.prepare(
    'SELECT subdomain FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ subdomain: string | null }>();

  if (tenant?.subdomain) {
    return `/site/${encodeURIComponent(tenant.subdomain)}/logo`;
  }

  return '/api/settings/logo';
}
