import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { buildSiteCacheKey, shouldTriggerPublicSiteRender } from './siteCacheKey';
import { getUploadObjectForResponse } from '../../lib/upload-objects';

/**
 * Escapes HTML characters in a string to prevent XSS.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/**
 * Public hospital website routes — serves pre-rendered HTML from KV + CF Cache API.
 *
 * URL pattern: /site/{slug}, /site/{slug}/doctors, etc.
 * Slug = tenant subdomain (e.g. "demo-hospital")
 *
 * Cache strategy (3 layers):
 *  1. CF Cache API (caches.default) — CDN edge, no Worker invocation on HIT
 *  2. KV — pre-rendered HTML, Worker reads (fast, no D1)
 *  3. D1 fallback — only if KV miss (rare, triggers re-render)
 */
const hospitalSite = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Valid public pages that can be served */
const VALID_PAGES = new Set(['', 'doctors', 'services', 'about', 'contact', 'book', 'blog', 'departments']);

/**
 * Root /site — list available hospital websites (directory page)
 */
hospitalSite.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const { results } = await db.$client.prepare(
    `SELECT t.name, t.subdomain FROM tenants t
     JOIN website_config wc ON wc.tenant_id = t.id
     WHERE wc.is_enabled = 1
     ORDER BY t.name`
  ).all();

  const hospitals = (results || []).map((h: Record<string, unknown>) =>
    `<li><a href="/site/${escapeHtml(String(h.subdomain))}">${escapeHtml(String(h.name))}</a></li>`
  ).join('');

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hospital Directory — Ozzyl Health</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:600px;margin:4rem auto;padding:0 1rem;color:#1a1a2e}
  h1{font-size:1.5rem} ul{list-style:none;padding:0}
  li{padding:0.75rem 0;border-bottom:1px solid #eee}
  a{color:#2563eb;text-decoration:none;font-weight:500} a:hover{text-decoration:underline}
</style></head>
<body>
  <h1>🏥 Hospital Directory</h1>
  ${hospitals.length > 0
    ? `<ul>${hospitals}</ul>`
    : '<p>No hospital websites available yet.</p>'}
</body></html>`);
});

/**
 * Sitemap.xml generation — MUST be before the catch-all /:slug/:page?
 */
hospitalSite.get('/:slug/sitemap.xml', async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param('slug');
  const host = c.req.header('host') || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;

  const pages = ['', '/doctors', '/services', '/about', '/contact', '/book', '/blog', '/departments'];
  const urls = pages.map(p => `
    <url>
      <loc>${baseUrl}/site/${slug}${p}</loc>
      <changefreq>weekly</changefreq>
      <priority>${p === '' ? '1.0' : '0.8'}</priority>
    </url>`
  ).join('');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, s-maxage=86400',
    },
  });
});

/**
 * Robots.txt — MUST be before the catch-all /:slug/:page?
 */
hospitalSite.get('/:slug/robots.txt', async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param('slug');
  const host = c.req.header('host') || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const robots = `User-agent: *
Allow: /site/${slug}/
Disallow: /api/
Disallow: /dashboard/
Disallow: /login
Sitemap: ${protocol}://${host}/site/${slug}/sitemap.xml
`;
  return new Response(robots, {
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, s-maxage=86400' },
  });
});

/**
 * GET /site/:slug/logo — Public hospital logo (no auth required)
 * Must be before the catch-all /:slug/:page? route
 */
hospitalSite.get('/:slug/logo', async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param('slug');

  const tenant = await db.$client.prepare(
    'SELECT id FROM tenants WHERE subdomain = ?'
  ).bind(slug).first<{ id: number }>();
  if (!tenant) return c.notFound();

  const row = await db.$client.prepare(
    "SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?"
  ).bind(String(tenant.id)).first<{ value: string }>();
  if (!row?.value) return c.notFound();

  // Prevent cross-tenant R2 key injection: key must belong to this tenant
  const tenantPrefix = `${tenant.id}/`;
  if (!row.value.startsWith(tenantPrefix)) {
    console.error(`[hospitalSite/logo] Cross-tenant R2 key blocked: tenant=${tenant.id}, key=${row.value}`);
    return c.notFound();
  }

  const obj = await getUploadObjectForResponse(c.env, row.value);
  if (!obj) return c.notFound();

  const headers = new Headers();
  headers.set('Content-Type', obj.contentType ?? 'image/png');
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(obj.body, { headers });
});

/**
 * GET /site/:slug/blog/:postSlug — Individual blog post (dynamically rendered)
 * Must be before the catch-all /:slug/:page? route
 */
hospitalSite.get('/:slug/blog/:postSlug', async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param('slug');
  const postSlug = c.req.param('postSlug');
  const lang = c.req.query('lang') === 'bn' ? 'bn' : 'en';

  // Resolve tenant + config
  const tenant = await db.$client.prepare(
    'SELECT * FROM tenants WHERE subdomain = ?'
  ).bind(slug).first<Record<string, any>>();
  if (!tenant) return c.notFound();

  const config = await db.$client.prepare(
    'SELECT * FROM website_config WHERE tenant_id = ?'
  ).bind(tenant.id).first<Record<string, any>>();
  if (!config?.is_enabled) return c.notFound();

  const hospitalLogoRow = await db.$client.prepare(
    "SELECT value FROM settings WHERE key = 'hospital_logo' AND tenant_id = ?"
  ).bind(tenant.id).first<{ value: string }>();
  const hospitalLogoUrl = hospitalLogoRow?.value ? `/site/${slug}/logo` : undefined;

  // Fetch blog post
  const post = await db.$client.prepare(
    'SELECT * FROM website_blog_posts WHERE tenant_id = ? AND slug = ? AND is_published = 1'
  ).bind(tenant.id, postSlug).first<Record<string, any>>();
  if (!post) return c.notFound();

  // Dynamically render blog post page using JSX helper
  const { renderBlogPost } = await import('./renderBlogPost');
  const html = await renderBlogPost({ tenant, config, post, slug, lang, hospitalLogoUrl });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  });
});

/**
 * GET /site/:slug — Hospital home page
 * GET /site/:slug/:page — Hospital subpage (doctors, services, about, contact)
 */
hospitalSite.get('/:slug/:page?', async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param('slug');
  const page = c.req.param('page') || '';

  // Only serve known pages
  if (!VALID_PAGES.has(page)) {
    return c.notFound();
  }

  const pagePath = page ? `/site/${slug}/${page}` : `/site/${slug}`;

  // Detect language preference from query param
  const lang = c.req.query('lang') === 'bn' ? 'bn' : 'en';
  const cacheKey = buildSiteCacheKey(slug, pagePath, lang);

  // ── Layer 1: CF Cache API (CDN edge) ──
  // Serves directly from edge without Worker invocation after first cache
  const cache = caches.default;
  const cacheRequest = new Request(c.req.url);
  const cachedResponse = await cache.match(cacheRequest);
  if (cachedResponse) {
    return cachedResponse;
  }

  // ── Layer 2: KV pre-rendered HTML ──
  const html = await c.env.KV.get(cacheKey);

  if (!html) {
    // KV miss — check if website is enabled, maybe trigger re-render
    const config = await db.$client.prepare(
      'SELECT wc.is_enabled, t.id as tenant_id FROM website_config wc JOIN tenants t ON wc.tenant_id = t.id WHERE t.subdomain = ?'
    ).bind(slug).first<{ is_enabled: number; tenant_id: number }>();

    if (!config || !config.is_enabled) {
      return c.html(
        '<!DOCTYPE html><html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui"><h1>Website coming soon</h1></body></html>',
        404
      );
    }

    // Trigger async re-render so KV is populated for next request
    try {
      if (await shouldTriggerPublicSiteRender(c.env.KV, slug)) {
        const { preRenderTenantSite } = await import('./prerender');
        c.executionCtx.waitUntil(
          preRenderTenantSite(c.env.DB, c.env.KV, config.tenant_id, slug, c.env)
        );
      }
    } catch {
      // prerender not available — non-fatal
    }

    // Return a "loading" state — this should be very rare (only first visit ever)
    return c.html(
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="3"></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui"><p>Loading website... please wait.</p></body></html>',
      200
    );
  }

  // Build response with cache headers
  const response = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });

  // Store in CF Cache API (non-blocking)
  c.executionCtx.waitUntil(cache.put(cacheRequest, response.clone()));

  // ── Track pageview (non-blocking) ──
  // Resolve tenant_id from slug for pageview tracking
  const tenantForPageview = await db.$client.prepare(
    'SELECT id FROM tenants WHERE subdomain = ?'
  ).bind(slug).first<{ id: number }>();
  if (tenantForPageview) {
    c.executionCtx.waitUntil(
      db.$client.prepare(
        `INSERT INTO website_pageviews (tenant_id, subdomain, page, referrer, user_agent, viewed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        String(tenantForPageview.id),
        slug,
        pagePath,
        c.req.header('referer') || null,
        (c.req.header('user-agent') || '').slice(0, 200)
      ).run().catch(() => { /* pageview tracking failure is non-fatal */ })
    );
  }

  return response;
});

export default hospitalSite;
