/**
 * Build a tenant URL from a subdomain slug and an optional base domain.
 * Falls back to the production base domain when no env override is set.
 */
export function buildTenantUrl(subdomain: string, baseDomain?: string): string {
  const cleanSub = subdomain.trim().toLowerCase();
  const domain = baseDomain ?? import.meta.env.VITE_APP_BASE_DOMAIN ?? 'hms.ozzyl.com';
  return `https://${cleanSub}.${domain}`;
}
