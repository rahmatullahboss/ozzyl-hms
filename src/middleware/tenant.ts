import type { MiddlewareHandler } from 'hono';

const RESERVED_SUBDOMAINS = ['www', 'api', 'admin', 'auth', 'app', 'hms', 'super', 'mail', 'ftp', 'blog', 'shop', 'dev', 'test'];
const RESERVED_HOST_ROOTS_WITH_HEADER_TENANT = ['ozzyl.com'];

export const tenantMiddleware: MiddlewareHandler<{
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    ENVIRONMENT?: string;
    LOCAL_TENANT_ID?: string;
    LOCAL_TENANT_SUBDOMAIN?: string;
  };
  Variables: {
    tenantId?: string;
  };
}> = async (c, next) => {
  const url = new URL(c.req.url);
  const hostname = url.hostname;

  const resolveConfiguredLocalTenant = async (): Promise<Response | null> => {
    if (c.env.ENVIRONMENT !== 'local_server') return null;

    const configuredTenantId = c.env.LOCAL_TENANT_ID?.trim();
    const configuredSubdomain = c.env.LOCAL_TENANT_SUBDOMAIN?.trim();
    if (!configuredTenantId && !configuredSubdomain) return null;

    const result = configuredTenantId
      ? await c.env.DB.prepare(
          'SELECT id, name, status FROM tenants WHERE id = ?'
        ).bind(configuredTenantId).first<{ id: string; name: string; status: string }>()
      : await c.env.DB.prepare(
          'SELECT id, name, status FROM tenants WHERE subdomain = ?'
        ).bind(configuredSubdomain).first<{ id: string; name: string; status: string }>();

    if (!result) {
      return c.json({ error: 'Configured local tenant not found' }, 503);
    }
    if (result.status !== 'active') {
      return c.json({ error: 'Configured local tenant is inactive or suspended' }, 503);
    }

    c.set('tenantId', result.id);
    await next();
    return c.res;
  };
  
  // Check if it's the main domain (no subdomain)
  const parts = hostname.split('.');
  
  // For development (localhost)
  if (hostname === 'localhost' || hostname.includes('localhost')) {
    // Check for tenant query param, header, or subdomain header
    const tenantId = c.req.query('tenant') || c.req.header('X-Tenant-ID');
    const tenantSubdomain = c.req.header('X-Tenant-Subdomain') || c.req.header('X-Tenant-Slug');
    
    if (tenantSubdomain) {
      // Look up tenant by subdomain
      const result = await c.env.DB.prepare(
        'SELECT id, name, status FROM tenants WHERE subdomain = ?'
      ).bind(tenantSubdomain).first<{ id: string; name: string; status: string }>();
      
      if (result) {
        c.set('tenantId', result.id);
      }
    } else if (tenantId) {
      // SECURITY FIX: Validate header/query tenantId against DB
      const result = await c.env.DB.prepare(
        'SELECT id, name, status FROM tenants WHERE id = ?'
      ).bind(tenantId).first<{ id: string; name: string; status: string }>();
      
      if (!result) {
        return c.json({ error: 'Tenant not found' }, 403);
      }
      if (result.status !== 'active') {
        return c.json({ error: 'Tenant is inactive or suspended' }, 403);
      }
      c.set('tenantId', result.id);
    }
    if (!c.get('tenantId')) {
      const configured = await resolveConfiguredLocalTenant();
      if (configured) return configured;
    }
    await next();
    return;
  }

  const isWorkersOrPagesHost = hostname.endsWith('.workers.dev') || hostname.endsWith('.pages.dev');
  const reservedSubdomain = (parts[0] || '').toLowerCase();
  const isReservedHostRootAllowed = RESERVED_HOST_ROOTS_WITH_HEADER_TENANT.some((root) => hostname.endsWith(`.${root}`));

  if (
    parts.length > 2 &&
    !isWorkersOrPagesHost &&
    RESERVED_SUBDOMAINS.includes(reservedSubdomain) &&
    !isReservedHostRootAllowed
  ) {
    return c.json({ error: 'Invalid subdomain' }, 400);
  }
  
  // Main domain access (super admin) or workers.dev / pages.dev deployment
  // workers.dev hostnames like hms-saas-production.rahmatullahzisan.workers.dev
  // have 4+ parts but are NOT tenant subdomains — use header-based resolution
  if (
    parts.length <= 2 ||
    isWorkersOrPagesHost ||
    RESERVED_SUBDOMAINS.includes(reservedSubdomain)
  ) {
    // First: check if this is a verified custom domain
    if (parts.length <= 2 && !hostname.endsWith('.workers.dev') && !hostname.endsWith('.pages.dev')) {
      try {
        const domainResult = await c.env.DB.prepare(
          'SELECT id, name, status FROM tenants WHERE custom_domain = ? AND custom_domain_verified = 1'
        ).bind(hostname).first<{ id: string; name: string; status: string }>();
        if (domainResult && domainResult.status === 'active') {
          c.set('tenantId', domainResult.id);
          await next();
          return;
        }
      } catch { /* fall through to header-based resolution */ }
    }

    const tenantId = c.req.query('tenant') || c.req.header('X-Tenant-ID');
    const tenantSubdomain = c.req.header('X-Tenant-Subdomain') || c.req.header('X-Tenant-Slug');

    if (tenantSubdomain) {
      // Look up tenant by subdomain header
      const result = await c.env.DB.prepare(
        'SELECT id, name, status FROM tenants WHERE subdomain = ?'
      ).bind(tenantSubdomain).first<{ id: string; name: string; status: string }>();

      if (!result) {
        return c.json({ error: 'Tenant not found' }, 403);
      }
      if (result.status !== 'active') {
        return c.json({ error: 'Tenant is inactive or suspended' }, 403);
      }
      c.set('tenantId', result.id);
    } else if (tenantId) {
      // SECURITY FIX: Validate header/query tenantId against DB
      const result = await c.env.DB.prepare(
        'SELECT id, name, status FROM tenants WHERE id = ?'
      ).bind(tenantId).first<{ id: string; name: string; status: string }>();

      if (!result) {
        return c.json({ error: 'Tenant not found' }, 403);
      }
      if (result.status !== 'active') {
        return c.json({ error: 'Tenant is inactive or suspended' }, 403);
      }
      c.set('tenantId', result.id);
    }
    if (!c.get('tenantId')) {
      const configured = await resolveConfiguredLocalTenant();
      if (configured) return configured;
    }
    await next();
    return;
  }
  
  // Extract subdomain
  const subdomain = parts[0];
  
  // Check reserved names
  if (RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
    return c.json({ error: 'Invalid subdomain' }, 400);
  }
  
  // Validate subdomain format (3-63 chars, lowercase, numbers, hyphens)
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(subdomain)) {
    return c.json({ error: 'Invalid subdomain format' }, 400);
  }
  
  // Look up tenant in database
  try {
    const result = await c.env.DB.prepare(
      'SELECT id, name, status FROM tenants WHERE subdomain = ?'
    ).bind(subdomain).first<{ id: string; name: string; status: string }>();
    
    if (!result) {
      const configured = await resolveConfiguredLocalTenant();
      if (configured) return configured;
      return c.json({ error: 'Hospital not found' }, 404);
    }
    
    if (result.status === 'inactive') {
      return c.json({ error: 'Hospital account is inactive' }, 403);
    }
    
    if (result.status === 'suspended') {
      return c.json({ error: 'Hospital account is suspended' }, 403);
    }
    
    c.set('tenantId', result.id);
  } catch (error) {
    console.error('Tenant lookup error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
  // Route handler runs OUTSIDE the try-catch so its errors propagate to global onError
  await next();
};
