/**
 * Unified Logo System Tests
 *
 * Tests the hospital logo fallback logic across:
 * - Website config API (GET /api/website/config)
 * - Public logo endpoint (GET /site/:slug/logo)
 * - Logo URL resolution logic
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../src/types';
import { createMockDB } from './integration/helpers/mock-db';

import websiteRoutes from '../src/routes/tenant/website';
import hospitalSiteRoutes from '../src/routes/public/hospitalSite';
import settingsRoutes from '../src/routes/tenant/settings';

// ─── Test helpers ──────────────────────────────────────────────────────────

function createWebsiteTestApp(opts?: {
  hasWebsiteConfig?: boolean;
  hasHospitalLogo?: boolean;
}) {
  const { hasWebsiteConfig = true, hasHospitalLogo = false } = opts ?? {};

  const mock = createMockDB({
    tables: {},
    queryOverride(sql, params) {
      const s = sql.toLowerCase();

      // Website config query
      if (s.includes('from website_config') && s.includes('where tenant_id = ?')) {
        if (hasWebsiteConfig) {
          return {
            first: {
              id: 1,
              tenant_id: 'tenant-1',
              is_enabled: 1,
              theme: 'arogyaseva',
              tagline: 'Your Health, Our Priority',
              tagline_bn: 'আপনার স্বাস্থ্য, আমাদের অগ্রাধিকার',
              about_text: 'We provide quality healthcare.',
              primary_color: '#0891b2',
              secondary_color: '#6366f1',
              logo_key: null,
            },
          };
        }
        return { first: null };
      }

      // Hospital logo from settings
      if (s.includes("from settings") && s.includes("hospital_logo")) {
        if (hasHospitalLogo) {
          return { first: { value: 'tenant-1/hospital-logo' } };
        }
        return { first: null };
      }

      if (s.includes('from tenants') && s.includes('where id = ?')) {
        return { first: { id: 'tenant-1', name: 'Test Hospital', subdomain: 'test-hospital' } };
      }

      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '1');
    c.set('role', 'hospital_admin');
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key',
      ENVIRONMENT: 'development',
      UPLOADS: {
        put: async () => ({}),
        get: async (key: string) => {
          if (key === 'tenant-1/hospital-logo') {
            return {
              body: new ReadableStream(),
              httpMetadata: { contentType: 'image/png' },
              size: 1024,
            };
          }
          return null;
        },
        delete: async () => {},
      } as any,
    } as any;
    await next();
  });
  app.route('/api/website', websiteRoutes);

  return { app, mock };
}

function createSettingsTestApp(opts?: {
  hasHospitalLogo?: boolean;
}) {
  const { hasHospitalLogo = true } = opts ?? {};

  const mock = createMockDB({
    tables: {
      settings: hasHospitalLogo
        ? [{ id: 1, key: 'hospital_logo', value: 'tenant-1/hospital-logo', tenant_id: 'tenant-1' }]
        : [],
    },
    queryOverride(sql) {
      const s = sql.toLowerCase();

      if (s.includes('from tenants') && s.includes('where id = ?')) {
        return { first: { id: 'tenant-1', name: 'Test Hospital', subdomain: 'test-hospital' } };
      }

      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '1');
    c.set('role', 'hospital_admin');
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key',
      ENVIRONMENT: 'development',
      UPLOADS: {
        put: async () => ({}),
        get: async () => null,
        delete: async () => {},
      } as any,
    } as any;
    await next();
  });
  app.route('/api/settings', settingsRoutes);

  return { app, mock };
}

function createPublicSiteTestApp(opts?: {
  tenantExists?: boolean;
  hasHospitalLogo?: boolean;
  r2HasObject?: boolean;
}) {
  const { tenantExists = true, hasHospitalLogo = true, r2HasObject = true } = opts ?? {};

  const mock = createMockDB({
    tables: {},
    queryOverride(sql, params) {
      const s = sql.toLowerCase();

      // Tenant lookup by subdomain
      if (s.includes('from tenants') && s.includes('where subdomain = ?')) {
        if (tenantExists) {
          return { first: { id: 1, name: 'Test Hospital', subdomain: 'test-hospital' } };
        }
        return { first: null };
      }

      // Hospital logo from settings
      if (s.includes("from settings") && s.includes("hospital_logo")) {
        if (hasHospitalLogo) {
          return { first: { value: '1/hospital-logo' } };
        }
        return { first: null };
      }

      // Website config for directory listing
      if (s.includes('from website_config') && s.includes('join tenants')) {
        return {
          results: [{ name: 'Test Hospital', subdomain: 'test-hospital' }],
        };
      }

      return null;
    },
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: mock.db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key',
      ENVIRONMENT: 'development',
      UPLOADS: {
        put: async () => ({}),
        get: async (key: string) => {
          if (r2HasObject && key === '1/hospital-logo') {
            return {
              body: new ReadableStream(),
              httpMetadata: { contentType: 'image/png' },
              size: 1024,
            };
          }
          return null;
        },
        delete: async () => {},
      } as any,
    } as any;
    await next();
  });
  app.route('/site', hospitalSiteRoutes);

  return { app, mock };
}

// ════════════════════════════════════════════════════════════════════════════
// WEBSITE CONFIG API — hospital_logo_url in response
// ════════════════════════════════════════════════════════════════════════════

describe('Website Config API — hospital_logo_url', () => {

  it('returns hospital_logo_url when hospital logo exists in settings', async () => {
    const { app } = createWebsiteTestApp({ hasWebsiteConfig: true, hasHospitalLogo: true });
    const res = await app.request('/api/website/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toBeDefined();
    expect(body.data.hospital_logo_url).toBe('/site/test-hospital/logo');
  });

  it('returns hospital_logo_url as null when no hospital logo in settings', async () => {
    const { app } = createWebsiteTestApp({ hasWebsiteConfig: true, hasHospitalLogo: false });
    const res = await app.request('/api/website/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toBeDefined();
    expect(body.data.hospital_logo_url).toBeNull();
  });

  it('returns null data when no website config exists', async () => {
    const { app } = createWebsiteTestApp({ hasWebsiteConfig: false, hasHospitalLogo: true });
    const res = await app.request('/api/website/config');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown; message: string };
    expect(body.data).toBeNull();
    expect(body.message).toBe('No website config found');
  });

  it('returns both website config fields and hospital_logo_url together', async () => {
    const { app } = createWebsiteTestApp({ hasWebsiteConfig: true, hasHospitalLogo: true });
    const res = await app.request('/api/website/config');
    const body = await res.json() as { data: Record<string, unknown> };
    // Website config fields should be present
    expect(body.data.theme).toBe('arogyaseva');
    expect(body.data.tagline).toBe('Your Health, Our Priority');
    // Hospital logo URL should also be present
    expect(body.data.hospital_logo_url).toBe('/site/test-hospital/logo');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS API — hospital_logo_url in response
// ════════════════════════════════════════════════════════════════════════════

describe('Settings API — hospital logo display URL', () => {
  it('returns a browser-loadable public logo URL when a hospital logo exists', async () => {
    const { app } = createSettingsTestApp({ hasHospitalLogo: true });
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: Record<string, unknown> };
    expect(body.settings.hospital_logo_url).toBe('/site/test-hospital/logo');
  });

  it('returns a browser-loadable public logo URL after upload', async () => {
    const { app } = createSettingsTestApp({ hasHospitalLogo: false });
    const body = new FormData();
    body.append('logo', new File(['logo'], 'logo.png', { type: 'image/png' }));

    const res = await app.request('/api/settings/logo', {
      method: 'POST',
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { logo_url: string };
    expect(json.logo_url).toBe('/site/test-hospital/logo');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC LOGO ENDPOINT — GET /site/:slug/logo
// ════════════════════════════════════════════════════════════════════════════

describe('Public Logo Endpoint — GET /site/:slug/logo', () => {

  it('returns 404 when tenant does not exist', async () => {
    const { app } = createPublicSiteTestApp({ tenantExists: false });
    const res = await app.request('/site/nonexistent/logo');
    expect(res.status).toBe(404);
  });

  it('returns 404 when no hospital logo in settings', async () => {
    const { app } = createPublicSiteTestApp({ tenantExists: true, hasHospitalLogo: false });
    const res = await app.request('/site/test-hospital/logo');
    expect(res.status).toBe(404);
  });

  it('returns 404 when R2 object not found', async () => {
    const { app } = createPublicSiteTestApp({ tenantExists: true, hasHospitalLogo: true, r2HasObject: false });
    const res = await app.request('/site/test-hospital/logo');
    expect(res.status).toBe(404);
  });

  it('returns logo image when everything exists', async () => {
    const { app } = createPublicSiteTestApp({ tenantExists: true, hasHospitalLogo: true, r2HasObject: true });
    const res = await app.request('/site/test-hospital/logo');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('returns 404 when logo key belongs to another tenant', async () => {
    const mock = createMockDB({
      tables: {},
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from tenants') && s.includes('where subdomain = ?')) {
          return { first: { id: 1, name: 'Test Hospital', subdomain: 'test-hospital' } };
        }
        if (s.includes('from settings') && s.includes('hospital_logo')) {
          return { first: { value: '999/other-tenant-logo' } };
        }
        return null;
      },
    });

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: mock.db,
        KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
        JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key',
        ENVIRONMENT: 'development',
        UPLOADS: {
          put: async () => ({}),
          get: async () => ({ body: new ReadableStream(), httpMetadata: { contentType: 'image/png' }, size: 1024 }),
          delete: async () => {},
        } as any,
      } as any;
      await next();
    });
    app.route('/site', hospitalSiteRoutes);

    const res = await app.request('/site/test-hospital/logo');
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOGIC TESTS — Logo URL fallback resolution
// ════════════════════════════════════════════════════════════════════════════

describe('Logo URL Fallback Logic', () => {

  /**
   * Mirrors the fallback logic in prerender.tsx:
   * - website logo (logo_key) takes priority
   * - hospital logo from settings is fallback
   * - undefined if neither exists
   */
  function resolveLogoUrl(opts: {
    websiteLogoKey?: string | null;
    hospitalLogoExists?: boolean;
    subdomain?: string;
  }): string | undefined {
    const { websiteLogoKey, hospitalLogoExists, subdomain = 'test-hospital' } = opts;

    if (websiteLogoKey) {
      return `/api/uploads/${websiteLogoKey}`;
    }
    if (hospitalLogoExists) {
      return `/site/${subdomain}/logo`;
    }
    return undefined;
  }

  it('uses website logo_key when available (priority over hospital logo)', () => {
    const url = resolveLogoUrl({ websiteLogoKey: 'tenant-1/website/logo/123.png', hospitalLogoExists: true });
    expect(url).toBe('/api/uploads/tenant-1/website/logo/123.png');
  });

  it('falls back to hospital logo when no website logo_key', () => {
    const url = resolveLogoUrl({ websiteLogoKey: null, hospitalLogoExists: true });
    expect(url).toBe('/site/test-hospital/logo');
  });

  it('falls back to hospital logo when website logo_key is undefined', () => {
    const url = resolveLogoUrl({ websiteLogoKey: undefined, hospitalLogoExists: true });
    expect(url).toBe('/site/test-hospital/logo');
  });

  it('returns undefined when neither logo exists', () => {
    const url = resolveLogoUrl({ websiteLogoKey: null, hospitalLogoExists: false });
    expect(url).toBeUndefined();
  });

  it('returns undefined when both are undefined', () => {
    const url = resolveLogoUrl({});
    expect(url).toBeUndefined();
  });

  it('website logo_key empty string is treated as falsy', () => {
    const url = resolveLogoUrl({ websiteLogoKey: '', hospitalLogoExists: true });
    // Empty string is falsy, so should fall back to hospital logo
    expect(url).toBe('/site/test-hospital/logo');
  });
});
