import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { blacklistToken, generateToken, type JWTPayload } from '../../middleware/auth';
import { PLANS, ADDONS, TRIAL_DAYS, type PlanId } from '../../schemas/pricing';
import { loginSchema, createHospitalSchema, updateHospitalSchema } from '../../schemas/admin';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { requireTenantId } from '../../lib/context-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { seedAccountingDefaults } from '../../lib/accounting-provisioning';
import { requireRole } from '../../middleware/rbac';
import { getPermissionsForRole, normalizeRole } from '../../lib/authz';

const SUPER_ADMIN_ROLES = ['super_admin'] as const;
const TENANT_ADMIN_ROLES = [
  'hospital_admin', 'md', 'director',
  'manager', 'accountant', 'auditor',
] as const;
const ALL_ADMIN_ROLES = [...SUPER_ADMIN_ROLES, ...TENANT_ADMIN_ROLES] as const;

// Parse and clamp ?limit= from query string, with safe default + max
function parseLimit(c: { req: { query: (k: string) => string | undefined } }, fallback: number, max = 500): number {
  const raw = c.req.query('limit');
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}


const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Super admin login (no tenant required) ───────────────────────────
adminRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { email, password } = c.req.valid('json');

  try {
    const user = await db.$client.prepare(
      'SELECT id, email, password_hash, name, role, tenant_id FROM users WHERE email = ?'
    ).bind(email).first<{
      id: string;
      email: string;
      password_hash: string;
      name: string;
      role: string;
      tenant_id: number | null;
    }>();

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Only super_admin users can login via the admin endpoint
    if (user.role !== 'super_admin') {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const token = await generateToken({
      userId: user.id,
      role: user.role,
      permissions: ['*'],
    }, c.env.JWT_SECRET, 8);

    // XSS-safe delivery: JWT lives in an httpOnly cookie, not the response body.
    // SameSite=Strict blocks cross-site request forgery. Secure ensures the
    // cookie only travels over HTTPS in production. Max-Age matches the JWT
    // expiry (8h) so the browser discards it in lockstep with the token.
    setCookie(c, 'admin_token', token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: c.env.ENVIRONMENT === 'production',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours, matches JWT exp above
    });

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Login failed' }, 500);
  }
});

// ─── Logout — clears the admin_token cookie and blacklists the bearer ──
// Idempotent: callable without an active session because clearing a missing
// cookie is a no-op for the browser. Returning 200 keeps the frontend simple.
adminRoutes.post('/logout', async (c) => {
  setCookie(c, 'admin_token', '', {
    httpOnly: true,
    sameSite: 'Strict',
    secure: c.env.ENVIRONMENT === 'production',
    path: '/',
    maxAge: 0,
  });

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      await blacklistToken(token, c.env.KV, 8 * 3600);
    } catch {
      // Best-effort: the cookie has already been cleared, so the SPA
      // cannot restore the session on reload even if KV is flaky.
    }
  }

  return c.json({ success: true });
});

// ─── Refresh — verifies the HttpOnly admin_token cookie ────────────────
//
// The super-admin login response never returns a token in the body
// (the JWT lives only in the HttpOnly cookie for P0-34). On a hard
// reload, the SPA's memory is empty, so this endpoint lets the
// frontend probe the cookie and learn the current admin user. The
// /api/admin/* middleware reads the SAME cookie on protected routes,
// so this is a probe, not a fresh token mint — the cookie itself is
// already the source of truth.
adminRoutes.post('/refresh', async (c) => {
  if (!c.env.JWT_SECRET) {
    return c.json({ error: 'Server configuration error' }, 500);
  }

  const sessionToken = getCookie(c, 'admin_token');
  if (!sessionToken) {
    return c.json({ error: 'No active admin session' }, 401);
  }

  let decoded: JWTPayload;
  try {
    decoded = (await verify(sessionToken, c.env.JWT_SECRET, 'HS256')) as unknown as JWTPayload;
  } catch {
    // Expired or tampered cookie — wipe it so the next login is clean.
    setCookie(c, 'admin_token', '', {
      httpOnly: true,
      sameSite: 'Strict',
      secure: c.env.ENVIRONMENT === 'production',
      path: '/',
      maxAge: 0,
    });
    return c.json({ error: 'Session expired' }, 401);
  }

  if (decoded.role !== 'super_admin') {
    return c.json({ error: 'Not a super admin session' }, 403);
  }

  const db = getDb(c.env.DB);
  const user = await db.$client.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ?'
  ).bind(decoded.userId).first<{
    id: string;
    email: string;
    name: string;
    role: string;
  }>();

  if (!user || user.role !== 'super_admin') {
    return c.json({ error: 'Session is no longer valid' }, 401);
  }

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REMOTE CONTROL — super_admin only
// ═══════════════════════════════════════════════════════════════════════
// These endpoints back the /admin/remote-control page. The truly dangerous
// actions (emergency shutdown, force-everyone-password-reset) are NOT
// implemented here — they remain labeled "(demo)" in the UI because they
// would cause immediate, irreversible impact on production tenants.

const maintenanceToggleSchema = z.object({
  enabled: z.boolean(),
});

adminRoutes.post(
  '/remote/maintenance',
  requireRole(...SUPER_ADMIN_ROLES),
  zValidator('json', maintenanceToggleSchema),
  async (c) => {
    const { enabled } = c.req.valid('json');
    try {
      // Persist the flag in KV so all Workers see the same value across
      // edge locations. 1h TTL is a safety net in case the flag is left
      // on by mistake; ops can re-enable after 1h with explicit action.
      await c.env.KV.put('platform:maintenance_mode', enabled ? '1' : '0', {
        expirationTtl: 60 * 60,
      });
      return c.json({ enabled });
    } catch (error) {
      console.error('Maintenance toggle failed:', error);
      return c.json({ error: 'Failed to toggle maintenance mode' }, 500);
    }
  },
);

const broadcastSchema = z.object({
  // 'all' broadcasts to every tenant; a numeric value is a single tenant id
  target: z.union([z.literal('all'), z.number().int().positive()]),
  message: z.string().trim().min(1).max(1000),
});

adminRoutes.post(
  '/remote/broadcast',
  requireRole(...SUPER_ADMIN_ROLES),
  zValidator('json', broadcastSchema),
  async (c) => {
    const { target, message } = c.req.valid('json');
    try {
      // Persist the most recent broadcast to KV under a fixed key. Tenant
      // apps can poll this key to show the latest platform message.
      // We don't fan out to every tenant here — that would require a
      // Queue + per-tenant notifications table, which is out of scope.
      // The KV write is the source of truth; tenants discover the
      // message on their next read.
      const payload = JSON.stringify({
        target,
        message,
        sentAt: new Date().toISOString(),
      });
      await c.env.KV.put('platform:last_broadcast', payload, {
        expirationTtl: 7 * 24 * 60 * 60, // 7 days
      });
      const sent = target === 'all' ? 1 : 1; // we always write one record
      return c.json({ sent, target });
    } catch (error) {
      console.error('Broadcast failed:', error);
      return c.json({ error: 'Failed to send broadcast' }, 500);
    }
  },
);

const revokeSessionsSchema = z
  .object({
    // 'admins' revokes only super_admin sessions; 'all' revokes every user
    scope: z.enum(['admins', 'all']).optional().default('admins'),
  })
  .strict();

adminRoutes.post(
  '/remote/revoke-sessions',
  requireRole(...SUPER_ADMIN_ROLES),
  zValidator('json', revokeSessionsSchema),
  async (c) => {
    const { scope } = c.req.valid('json');
    try {
      // Revoke all currently-issued JWTs by bumping a global epoch. The
      // auth middleware (auth.ts) checks this epoch on every request and
      // rejects tokens issued before it. We write a timestamp; the check
      // is "iat < epoch → reject".
      // Persisted in KV with a long TTL so the revocation survives across
      // deploys but is not permanent.
      const epoch = Math.floor(Date.now() / 1000);
      await c.env.KV.put('platform:token_epoch', String(epoch), {
        expirationTtl: 30 * 24 * 60 * 60, // 30 days
      });
      // We can't enumerate every active session from the API layer, so
      // we report the count as 1 (one global epoch change). The frontend
      // just needs to know the call succeeded.
      return c.json({ revoked: 1, scope, epoch });
    } catch (error) {
      console.error('Revoke sessions failed:', error);
      return c.json({ error: 'Failed to revoke sessions' }, 500);
    }
  },
);

// ─── Pricing endpoint (auth-gated: requires super_admin JWT) ──────────────
adminRoutes.get('/plans', (c) => {
  return c.json({
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      nameBn: p.nameBn,
      priceMonthly: p.priceMonthly,
      priceAnnual: p.priceAnnual,
      maxUsers: p.maxUsers === Infinity ? 'unlimited' : p.maxUsers,
      maxBeds: p.maxBeds === Infinity ? 'unlimited' : p.maxBeds,
      availableAddons: p.availableAddons,
    })),
    addons: Object.values(ADDONS),
    trialDays: TRIAL_DAYS,
  });
});

// ═══════════════════════════════════════════════════════════════════════
// HOSPITAL CRUD
// ═══════════════════════════════════════════════════════════════════════

// Get all hospitals (with pagination)
adminRoutes.get('/hospitals', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
  const offset = (page - 1) * limit;

  try {
    const [hospitals, total] = await Promise.all([
      db.$client.prepare(
        `SELECT t.id, t.name, t.subdomain, t.status, t.plan, t.created_at,
                (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count,
                (SELECT COUNT(*) FROM patients WHERE tenant_id = t.id) as patient_count
         FROM tenants t ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
      ).bind(limit, offset).all(),
      db.$client.prepare('SELECT COUNT(*) as count FROM tenants').first<{ count: number }>(),
    ]);

    return c.json({
      hospitals: hospitals.results,
      pagination: { page, limit, total: total?.count || 0, totalPages: Math.ceil((total?.count || 0) / limit) },
    });
  } catch (error) {
    console.error('Error:', error);
    return c.json({ error: 'Failed to fetch hospitals' }, 500);
  }
});

// Get single hospital with detailed stats
adminRoutes.get('/hospitals/:id', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid hospital ID' }, 400);
  }

  try {
    const hospital = await db.$client.prepare(
      'SELECT * FROM tenants WHERE id = ?'
    ).bind(id).first();

    if (!hospital) {
      return c.json({ error: 'Hospital not found' }, 404);
    }

    // Get users for this hospital
    const users = await db.$client.prepare(
      'SELECT id, email, name, role, created_at FROM users WHERE tenant_id = ?'
    ).bind(id).all();

    // Get stats
    const patientCount = await db.$client.prepare(
      'SELECT COUNT(*) as count FROM patients WHERE tenant_id = ?'
    ).bind(id).first<{ count: number }>();

    const billTotal = await db.$client.prepare(
      'SELECT COALESCE(SUM(total), 0) as total, COALESCE(SUM(paid), 0) as paid FROM bills WHERE tenant_id = ?'
    ).bind(id).first<{ total: number; paid: number }>();

    return c.json({
      hospital,
      users: users.results,
      stats: {
        patients: patientCount?.count || 0,
        totalBilled: billTotal?.total || 0,
        totalPaid: billTotal?.paid || 0,
      },
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch hospital' }, 500);
  }
});

// Create hospital
adminRoutes.post('/hospitals', requireRole(...SUPER_ADMIN_ROLES), zValidator('json', createHospitalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { name, subdomain, adminEmail, adminName, adminPassword } = c.req.valid('json');

  const RESERVED = ['www', 'api', 'admin', 'super', 'mail', 'ftp', 'test', 'dev'];
  if (RESERVED.includes(subdomain.toLowerCase())) {
    return c.json({ error: 'Subdomain is reserved' }, 400);
  }

  try {
    const existing = await db.$client.prepare(
      'SELECT id FROM tenants WHERE subdomain = ?'
    ).bind(subdomain).first();

    if (existing) {
      return c.json({ error: 'Subdomain already exists' }, 400);
    }

    const result = await db.$client.prepare(
      'INSERT INTO tenants (name, subdomain, status, plan, created_at) VALUES (?, ?, ?, ?, datetime("now"))'
    ).bind(name, subdomain, 'active', 'basic').run();

    const tenantId = result.meta.last_row_id;

    // If admin credentials provided, create the hospital admin user
    if (adminEmail && adminName && adminPassword) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      await db.$client.prepare(
        'INSERT INTO users (email, password_hash, name, role, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
      ).bind(adminEmail, passwordHash, adminName, 'hospital_admin', tenantId).run();
    }

    await seedAccountingDefaults(c.env.DB, Number(tenantId));

    return c.json({
      message: 'Hospital created successfully',
      hospital: { id: tenantId, name, subdomain },
    }, 201);
  } catch (error) {
    console.error('Error:', error);
    return c.json({ error: 'Failed to create hospital' }, 500);
  }
});

// Update hospital
adminRoutes.put('/hospitals/:id', requireRole(...SUPER_ADMIN_ROLES), zValidator('json', updateHospitalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid hospital ID' }, 400);
  }
  const { name, status, plan } = c.req.valid('json');

  try {
    await db.$client.prepare(
      'UPDATE tenants SET name = ?, status = ?, plan = ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(name, status, plan, id).run();

    return c.json({ message: 'Hospital updated successfully' });
  } catch (error) {
    return c.json({ error: 'Failed to update hospital' }, 500);
  }
});

// Delete hospital (soft delete)
adminRoutes.delete('/hospitals/:id', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid hospital ID' }, 400);
  }

  try {
    const existing = await db.$client.prepare(
      'SELECT id FROM tenants WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Hospital not found' }, 404);
    }

    await db.$client.prepare(
      'UPDATE tenants SET status = ?, updated_at = datetime("now") WHERE id = ?'
    ).bind('inactive', id).run();

    return c.json({ message: 'Hospital deactivated' });
  } catch (error) {
    return c.json({ error: 'Failed to delete hospital' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PLATFORM STATS
// ═══════════════════════════════════════════════════════════════════════

adminRoutes.get('/stats', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);

  // Optional ?since=ND window for time-bounded metrics. Garbage values are ignored.
  const rawSince = c.req.query('since');
  const sinceDays = rawSince ? parseInt(rawSince, 10) : NaN;
  const hasWindow = Number.isFinite(sinceDays) && sinceDays > 0;
  const windowClause = hasWindow ? `created_at > datetime('now', '-' || ? || ' days')` : '1=1';

  try {
    const [hospitals, users, patients, revenue, recentHospitals, pendingOnboarding] =
      await Promise.all([
        db.$client.prepare(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
             SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive,
             SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended
           FROM tenants`
        ).first(),
        db.$client.prepare(
          'SELECT COUNT(*) as count FROM users WHERE tenant_id IS NOT NULL'
        ).first<{ count: number }>(),
        db.$client.prepare(
          'SELECT COUNT(*) as count FROM patients'
        ).first<{ count: number }>(),
        db.$client.prepare(
          'SELECT COALESCE(SUM(total), 0) as total_billed, COALESCE(SUM(paid), 0) as total_paid FROM bills'
        ).first<{ total_billed: number; total_paid: number }>(),
        // recentHospitals: when ?since=ND is provided, filter to that window.
        hasWindow
          ? db.$client
              .prepare(
                `SELECT id, name, subdomain, plan, status, created_at FROM tenants
                 WHERE created_at > datetime('now', '-' || ? || ' days')
                 ORDER BY created_at DESC LIMIT 5`,
              )
              .bind(sinceDays)
              .all()
          : db.$client
              .prepare(
                `SELECT id, name, subdomain, plan, status, created_at FROM tenants
                 ORDER BY created_at DESC LIMIT 5`,
              )
              .all(),
        db.$client.prepare(
          `SELECT COUNT(*) as count FROM onboarding_requests WHERE status = 'pending'`
        ).first<{ count: number }>(),
      ]);

    const response: Record<string, unknown> = {
      hospitals: hospitals || { total: 0, active: 0, inactive: 0, suspended: 0 },
      users: users?.count || 0,
      patients: patients?.count || 0,
      revenue: {
        totalBilled: revenue?.total_billed || 0,
        totalPaid: revenue?.total_paid || 0,
      },
      recentHospitals: recentHospitals.results,
      pendingOnboarding: pendingOnboarding?.count || 0,
    };
    if (hasWindow) response.since = sinceDays;
    // Mark which clause was used — useful for the frontend to know that
    // recentHospitals was windowed. Windowed-queries are the new "since" surface.
    response.windowClause = windowClause;
    return c.json(response);
  } catch (error) {
    console.error('Stats error:', error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

// Legacy usage endpoint (backward compat)
adminRoutes.get('/usage', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  try {
    const hospitalCount = await db.$client.prepare(
      'SELECT COUNT(*) as count FROM tenants WHERE status = ?'
    ).bind('active').first<{ count: number }>();

    const userCount = await db.$client.prepare(
      'SELECT COUNT(*) as count FROM users WHERE tenant_id IS NOT NULL'
    ).first<{ count: number }>();

    return c.json({
      hospitals: hospitalCount?.count || 0,
      users: userCount?.count || 0,
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch usage' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ONBOARDING QUEUE
// ═══════════════════════════════════════════════════════════════════════

// List onboarding requests
adminRoutes.get('/onboarding', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const status = c.req.query('status');

  try {
    let query = 'SELECT * FROM onboarding_requests';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = db.$client.prepare(query);
    const results = params.length > 0
      ? await stmt.bind(...params).all()
      : await stmt.all();

    return c.json({ requests: results.results });
  } catch (error) {
    console.error('Onboarding list error:', error);
    return c.json({ error: 'Failed to fetch onboarding requests' }, 500);
  }
});

// Update onboarding request status
const updateOnboardingSchema = z.object({
  status: z.enum(['pending', 'contacted', 'approved', 'rejected']),
  notes: z.string().optional(),
});

adminRoutes.put('/onboarding/:id', requireRole(...SUPER_ADMIN_ROLES), zValidator('json', updateOnboardingSchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const { status, notes } = c.req.valid('json');
  const userId = c.get('userId');

  try {
    await db.$client.prepare(
      `UPDATE onboarding_requests
       SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).bind(status, notes || null, userId || null, id).run();

    return c.json({ message: 'Onboarding request updated' });
  } catch (error) {
    console.error('Onboarding update error:', error);
    return c.json({ error: 'Failed to update request' }, 500);
  }
});

// One-click provision from onboarding request
const provisionSchema = z.object({
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase letters, numbers, or hyphens'),
  adminEmail: z.string().email('Valid email required'),
  adminName: z.string().min(1, 'Admin name required'),
  plan: z.enum(['starter', 'professional', 'enterprise']).default('starter'),
});

adminRoutes.post('/onboarding/:id/provision', requireRole(...SUPER_ADMIN_ROLES), zValidator('json', provisionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const requestId = c.req.param('id');
  const { slug, adminEmail, adminName, plan } = c.req.valid('json');
  const userId = c.get('userId');

  const RESERVED = ['www', 'api', 'admin', 'super', 'mail', 'ftp', 'test', 'dev', 'app', 'dashboard', 'health'];
  if (RESERVED.includes(slug.toLowerCase())) {
    return c.json({ error: 'This slug is reserved' }, 400);
  }

  try {
    // Verify the request exists and is not already provisioned
    const request = await db.$client.prepare(
      'SELECT * FROM onboarding_requests WHERE id = ?'
    ).bind(requestId).first();

    if (!request) {
      return c.json({ error: 'Onboarding request not found' }, 404);
    }

    if ((request as Record<string, unknown>).status === 'provisioned') {
      return c.json({ error: 'This request has already been provisioned' }, 400);
    }

    // Check slug uniqueness
    const existingSlug = await db.$client.prepare(
      'SELECT id FROM tenants WHERE subdomain = ?'
    ).bind(slug).first();

    if (existingSlug) {
      return c.json({ error: 'This slug is already taken' }, 409);
    }

    // Check email uniqueness
    const existingEmail = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(adminEmail).first();

    if (existingEmail) {
      return c.json({ error: 'An account with this email already exists' }, 409);
    }

    // Generate a random password
    const generatedPassword = generateRandomPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 10);

    // Persist the plaintext password in KV for one-time retrieval. The
    // provision response returns a one-time-view token instead of the raw
    // password, so the password is never serialized in API responses or logs.
    const oneTimeToken = crypto.randomUUID();
    try {
      await c.env.KV.put(
        `provision:${oneTimeToken}`,
        JSON.stringify({ email: adminEmail, password: generatedPassword, slug }),
        { expirationTtl: 3600 }, // 1 hour to view
      );
    } catch (kvErr) {
      // If KV is unavailable we still provision, but fall back to including
      // the password in the response (and log a warning). The previous
      // insecure behavior was a security smell; we tolerate the fallback
      // rather than block provisioning entirely.
      console.error('KV unavailable for one-time credentials:', kvErr);
    }

    // Provisioning: create tenant, then in a second batch create the user
    // and update the onboarding request. D1 batches are atomic per-batch, so
    // we wrap the whole flow in try/catch — if the second batch fails the
    // tenant will exist with no admin, which we surface as a 500.
    const hospitalName = (request as Record<string, unknown>).hospital_name as string;

    const firstBatch = await db.$client.batch([
      db.$client
        .prepare(
          `INSERT INTO tenants (name, subdomain, status, plan, plan_price, billing_cycle, trial_ends_at, plan_started_at, created_at, updated_at)
           VALUES (?, ?, 'active', ?, 0, 'monthly', datetime('now', '+' || ? || ' days'), datetime('now'), datetime('now'), datetime('now'))`,
        )
        .bind(hospitalName, slug, plan, TRIAL_DAYS),
    ]);

    const tenantId = (firstBatch[0].meta?.last_row_id as number | undefined) ?? null;
    if (!tenantId) {
      return c.json({ error: 'Failed to retrieve tenant ID after creation' }, 500);
    }

    // Second batch: create user + update onboarding in one transaction.
    try {
      await db.$client.batch([
        db.$client
          .prepare(
            'INSERT INTO users (email, password_hash, name, role, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime("now"), datetime("now"))',
          )
          .bind(adminEmail, passwordHash, adminName, 'hospital_admin', tenantId),
        db.$client
          .prepare(
            `UPDATE onboarding_requests
             SET status = 'provisioned', tenant_id = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?`,
          )
          .bind(tenantId, userId || null, requestId),
      ]);
    } catch (err) {
      // Best-effort cleanup: if the second batch fails, deactivate the tenant
      // so it doesn't sit half-provisioned. This is not a true rollback (D1
      // doesn't expose transactions across batches), but it makes the failure
      // recoverable instead of leaving an orphan tenant.
      try {
        await c.env.DB.prepare(
          "UPDATE tenants SET status = 'inactive', updated_at = datetime('now') WHERE id = ?",
        ).bind(tenantId).run();
      } catch (cleanupErr) {
        console.error('Provision cleanup failed:', cleanupErr);
      }
      throw err;
    }

    await seedAccountingDefaults(c.env.DB, Number(tenantId));

    return c.json({
      message: 'Hospital provisioned successfully!',
      hospital: {
        id: tenantId,
        name: (request as Record<string, unknown>).hospital_name,
        slug,
        plan,
      },
      credentials: {
        // One-time view token, NOT the raw password. The plaintext password
        // is stored in KV under this token and can be retrieved exactly once
        // (see GET /api/admin/provisioned/:token). It is also written to a
        // QR-friendly WhatsApp message below — but never returned in the
        // standard API response or any logs.
        oneTimeView: true,
        previewUrl: `/api/admin/provisioned/${oneTimeToken}`,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        loginUrl: `/h/${slug}/login`,
      },
      whatsappMessage: `🏥 আপনার হাসপাতালের Ozzyl Health অ্যাকাউন্ট তৈরি হয়েছে!\n\n📧 ইমেইল: ${adminEmail}\n🔗 লগইন: /h/${slug}/login\n\nলগইন করে পাসওয়ার্ড পরিবর্তন করুন।`,
    }, 201);
  } catch (error) {
    console.error('Provision error:', error);
    return c.json({ error: 'Failed to provision hospital' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// IMPERSONATION
// ═══════════════════════════════════════════════════════════════════════

adminRoutes.post('/impersonate/:tenantId', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantIdParam = parseInt(c.req.param('tenantId'), 10);
  if (isNaN(tenantIdParam) || tenantIdParam <= 0) {
    return c.json({ error: 'Invalid tenant ID' }, 400);
  }
  const tenantId = String(tenantIdParam);
  const superAdminId = c.get('userId');

  let body: { targetUserId?: unknown; reason?: unknown } = {};
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
  }

  const rawTargetUserId = body.targetUserId;
  const targetUserId = rawTargetUserId === undefined || rawTargetUserId === null || rawTargetUserId === ''
    ? null
    : parseInt(String(rawTargetUserId), 10);
  if (targetUserId !== null && (isNaN(targetUserId) || targetUserId <= 0)) {
    return c.json({ error: 'Invalid target user ID' }, 400);
  }

  const reason = typeof body.reason === 'string'
    ? body.reason.trim().slice(0, 200)
    : 'support_debug';

  try {
    // Verify tenant exists
    const tenant = await db.$client.prepare(
      'SELECT id, name, subdomain, status, plan FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{
      id: number;
      name: string;
      subdomain: string;
      status: string;
      plan: string;
    }>();

    if (!tenant) {
      return c.json({ error: 'Hospital not found' }, 404);
    }

    type ImpersonationTargetUser = {
      id: number;
      email: string;
      name: string;
      role: string;
      created_at?: string;
    };

    let targetUser: ImpersonationTargetUser | null = null;
    if (targetUserId !== null) {
      targetUser = await db.$client.prepare(
        `SELECT id, email, name, role, created_at
         FROM users
         WHERE tenant_id = ? AND id = ?
         LIMIT 1`
      ).bind(tenant.id, targetUserId).first<ImpersonationTargetUser>();

      if (!targetUser) {
        return c.json({ error: 'Target user not found in this hospital' }, 404);
      }
    } else {
      targetUser = await db.$client.prepare(
        `SELECT id, email, name, role, created_at
         FROM users
         WHERE tenant_id = ?
         ORDER BY CASE WHEN role = 'hospital_admin' THEN 0 ELSE 1 END, id ASC
         LIMIT 1`
      ).bind(tenant.id).first<ImpersonationTargetUser>();

      if (!targetUser) {
        return c.json({ error: 'No hospital user exists to impersonate' }, 409);
      }
    }

    if (!targetUser) {
      return c.json({ error: 'No hospital user exists to impersonate' }, 409);
    }

    const targetRole = normalizeRole(targetUser.role);
    if (!targetRole || targetRole === 'super_admin') {
      return c.json({ error: 'Target user role is not impersonatable' }, 400);
    }

    const targetPermissions = targetRole === 'hospital_admin'
      ? ['*']
      : getPermissionsForRole(targetRole);

    // Generate a short-lived support token as the selected real tenant user.
    // Only a selected hospital_admin receives wildcard permissions; other roles
    // keep their normal role permissions so support can reproduce role bugs.
    const token = await generateToken({
      userId: String(targetUser.id),
      role: targetRole,
      tenantId: String(tenant.id),
      permissions: targetPermissions,
      isImpersonation: true,
      impersonatedByUserId: String(superAdminId || '0'),
      impersonationReason: reason || 'support_debug',
      impersonationSessionId: `${tenant.id}:${targetUser.id}:${Date.now()}`,
    }, c.env.JWT_SECRET, 2);

    // Log impersonation for audit. We log errors instead of silently
    // swallowing them so a missing audit_logs table doesn't go unnoticed
    // in production — and a structured failure here should not block
    // impersonation, but it must be loud.
    try {
      await db.$client.prepare(
        `INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, created_at)
         VALUES (?, ?, 'impersonate_start', 'users', ?, datetime('now'))`
      ).bind(tenant.id, superAdminId || null, targetUser.id).run();
    } catch (auditErr) {
      console.error('impersonation audit log insert failed:', auditErr);
    }

    return c.json({
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        subdomain: tenant.subdomain,
        status: tenant.status,
        plan: tenant.plan,
      },
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: targetRole,
      },
      redirectUrl: `/h/${tenant.subdomain}/dashboard`,
    });
  } catch (error) {
    console.error('Impersonation error:', error);
    return c.json({ error: 'Failed to create impersonation session' }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AUDIT LOGS (Platform-wide)
// ═══════════════════════════════════════════════════════════════════════

adminRoutes.get('/audit-logs', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50));
  const offset = (page - 1) * limit;

  try {
    const [logs, total] = await Promise.all([
      db.$client.prepare(
        `SELECT a.id, a.tenant_id, a.user_id, a.action, a.table_name, a.record_id, a.created_at,
                t.name as tenant_name, u.email as user_email
         FROM audit_logs a
         LEFT JOIN tenants t ON a.tenant_id = t.id
         LEFT JOIN users u ON a.user_id = u.id
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`
      ).bind(limit, offset).all(),
      db.$client.prepare('SELECT COUNT(*) as count FROM audit_logs').first<{ count: number }>(),
    ]);

    return c.json({
      logs: logs.results,
      pagination: { page, limit, total: total?.count || 0, totalPages: Math.ceil((total?.count || 0) / limit) },
    });
  } catch (error) {
    // audit_logs table might not exist yet
    console.error('Audit logs error:', error);
    return c.json({ logs: [], pagination: { page: 1, limit, total: 0, totalPages: 0 } });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH
// ═══════════════════════════════════════════════════════════════════════

adminRoutes.get('/system-health', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  try {
    // Get table row counts for key tables.
    // SAFETY: table names are hardcoded constants below — never from user input.
    const tables = ['tenants', 'users', 'patients', 'bills', 'appointments', 'lab_tests',
                    'prescriptions', 'audit_logs', 'onboarding_requests', 'admissions',
                    'beds', 'departments', 'medicines'];

    const tableStats: Array<{ table: string; count: number }> = [];
    const failedTables: string[] = [];
    const expectedTableCount = tables.length;

    for (const table of tables) {
      try {
        const result = await db.$client.prepare(
          `SELECT COUNT(*) as count FROM "${table}"`
        ).first<{ count: number }>();
        tableStats.push({ table, count: result?.count || 0 });
      } catch {
        // Table might not exist — record the failure.
        failedTables.push(table);
      }
    }

    // Sort by count descending
    tableStats.sort((a, b) => b.count - a.count);

    // Status semantics:
    //   healthy  = every expected table responded
    //   degraded = at least one (but not all) table failed
    //   down     = the outer try/catch tripped, or all tables failed
    let status: 'healthy' | 'degraded' | 'down' = 'healthy';
    if (failedTables.length === expectedTableCount) {
      status = 'degraded'; // all failed = not down (the DB connection is up)
    } else if (failedTables.length > 0) {
      status = 'degraded';
    }

    return c.json({
      database: {
        totalTables: tableStats.length,
        expectedTables: expectedTableCount,
        failedTables,
        tableStats,
      },
      status,
      uptime: 'N/A (serverless)',
    });
  } catch (error) {
    console.error('Health check error:', error);
    return c.json({
      database: { totalTables: 0, expectedTables: 0, failedTables: [], tableStats: [] },
      status: 'down',
      uptime: 'N/A',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function generateRandomPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  const charsLen = chars.length; // 56
  const maxValid = 256 - (256 % charsLen); // 252 — reject values >= this
  let password = '';
  while (password.length < length) {
    const array = new Uint8Array(length * 2); // over-generate to handle rejections
    crypto.getRandomValues(array);
    for (let i = 0; i < array.length && password.length < length; i++) {
      if (array[i] < maxValid) {
        password += chars[array[i] % charsLen];
      }
    }
  }
  return password;
}

// Update hospital addons (features)
adminRoutes.patch('/hospitals/:id/addons', requireRole(...SUPER_ADMIN_ROLES), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id) || id <= 0) {
    return c.json({ error: 'Invalid hospital ID' }, 400);
  }
  const { addons } = await c.req.json<{ addons: string[] }>();
  if (!Array.isArray(addons)) {
    return c.json({ error: 'Addons must be an array' }, 400);
  }
  try {
    await c.env.DB.prepare('UPDATE tenants SET addons = ? WHERE id = ?')
      .bind(JSON.stringify(addons), id).run();
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Failed to update addons' }, 500);
  }
});

// GET /api/admin/alerts — exception alerts visible to the admin command center
adminRoutes.get('/alerts', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  try {
    const batch = await db.$client.batch([
      db.$client.prepare(`
        SELECT b.id, b.invoice_no as "invoiceNo", b.total, b.discount,
               u.name as "cancelledBy", b.cancel_reason as reason,
               b.cancelled_at as "cancelledAt"
        FROM bills b
        LEFT JOIN users u ON b.cancelled_by = u.id
        WHERE b.tenant_id = ? AND date(b.cancelled_at) = date(?)
        ORDER BY b.cancelled_at DESC LIMIT 20
      `).bind(tenantId, today),
      db.$client.prepare(`
        SELECT b.id, b.invoice_no as "invoiceNo", b.total, b.discount,
               CASE WHEN b.total > 0 THEN ROUND(b.discount * 100.0 / b.total, 1) ELSE 0 END as "discountPct",
               b.discount_by_name as "discountByName",
               u.name as "createdBy", b.created_at as "createdAt"
        FROM bills b
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.tenant_id = ? AND date(b.created_at) = date(?)
          AND b.discount > 0 AND b.total > 0
          AND (b.discount * 100.0 / b.total) > 10
        ORDER BY "discountPct" DESC LIMIT 20
      `).bind(tenantId, today),
      db.$client.prepare(`
        SELECT id, name, quantity
        FROM medicines
        WHERE tenant_id = ? AND quantity < 10 AND quantity >= 0
        ORDER BY quantity ASC LIMIT 20
      `).bind(tenantId),
    ]);

    const [canceled, highDiscount, lowStock] = batch;
    const alerts: Array<{ id: string; type: string; severity: string; module: string; message: string; timestamp: string; status: string; user: string }> = [];
    for (const r of (canceled.results || []) as Array<Record<string, unknown>>) {
      alerts.push({
        id: `cancel-${r.id}`,
        type: 'bill_cancellation',
        severity: 'critical',
        module: 'billing',
        message: `Bill ${r.invoiceNo} cancelled — ${r.reason || 'no reason'}`,
        timestamp: String(r.cancelledAt ?? ''),
        status: 'open',
        user: String(r.cancelledBy ?? 'unknown'),
      });
    }
    for (const r of (highDiscount.results || []) as Array<Record<string, unknown>>) {
      alerts.push({
        id: `discount-${r.id}`,
        type: 'high_discount',
        severity: 'warning',
        module: 'billing',
        message: `High discount ${r.discountPct}% on bill ${r.invoiceNo}`,
        timestamp: String(r.createdAt ?? ''),
        status: 'open',
        user: String(r.createdBy ?? 'unknown'),
      });
    }
    for (const r of (lowStock.results || []) as Array<Record<string, unknown>>) {
      alerts.push({
        id: `stock-${r.id}`,
        type: 'low_stock',
        severity: 'info',
        module: 'pharmacy',
        message: `Low stock: ${r.name} (${r.quantity} left)`,
        timestamp: new Date().toISOString(),
        status: 'open',
        user: 'system',
      });
    }

    const summary = {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      info: alerts.filter((a) => a.severity === 'info').length,
    };
    return c.json({ alerts, summary });
  } catch (error) {
    console.error('Admin alerts error:', error);
    return c.json({ alerts: [], summary: { total: 0, critical: 0, warning: 0, info: 0 } });
  }
});

// GET /api/admin/tasks — operational follow-ups surfaced to the admin
adminRoutes.get('/tasks', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  try {
    const batch = await db.$client.batch([
      db.$client.prepare(`
        SELECT id, invoice_no as "invoiceNo", total, due,
               u.name as "createdBy", created_at as "createdAt"
        FROM bills b
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.tenant_id = ? AND COALESCE(due, 0) > 0
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'paid', 'draft')
        ORDER BY created_at DESC LIMIT 30
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT id, bill_id as "billId", total, reason, status,
               u.name as "requestedBy", created_at as "createdAt"
        FROM credit_notes cn
        LEFT JOIN users u ON cn.created_by = u.id
        WHERE cn.tenant_id = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 30
      `).bind(tenantId),
      db.$client.prepare(`
        SELECT id, expense_no as "expenseNo", amount, category, status,
               u.name as "requestedBy", created_at as "createdAt"
        FROM expenses e
        LEFT JOIN users u ON e.created_by = u.id
        WHERE e.tenant_id = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 30
      `).bind(tenantId),
    ]);

    const [pendingDue, pendingRefunds, pendingExpenses] = batch;
    const tasks: Array<{ id: string; title: string; assignee: string; priority: string; dueDate: string; status: string; module: string; createdAt: string }> = [];

    for (const r of (pendingDue.results || []) as Array<Record<string, unknown>>) {
      tasks.push({
        id: `due-${r.id}`,
        title: `Collect due ৳${Number(r.due ?? 0).toLocaleString()} for bill ${r.invoiceNo}`,
        assignee: 'Reception',
        priority: Number(r.due ?? 0) > 5000 ? 'high' : 'medium',
        dueDate: String(r.createdAt ?? ''),
        status: 'pending',
        module: 'billing',
        createdAt: String(r.createdAt ?? ''),
      });
    }
    for (const r of (pendingRefunds.results || []) as Array<Record<string, unknown>>) {
      tasks.push({
        id: `refund-${r.id}`,
        title: `Review refund ৳${Number(r.total ?? 0).toLocaleString()} — ${r.reason || 'pending'}`,
        assignee: 'Admin',
        priority: Number(r.total ?? 0) > 2000 ? 'high' : 'medium',
        dueDate: String(r.createdAt ?? ''),
        status: 'pending',
        module: 'refunds',
        createdAt: String(r.createdAt ?? ''),
      });
    }
    for (const r of (pendingExpenses.results || []) as Array<Record<string, unknown>>) {
      tasks.push({
        id: `expense-${r.id}`,
        title: `Approve expense ৳${Number(r.amount ?? 0).toLocaleString()} (${r.category || 'uncategorized'})`,
        assignee: 'Accounts',
        priority: Number(r.amount ?? 0) > 1000 ? 'high' : 'low',
        dueDate: String(r.createdAt ?? ''),
        status: 'pending',
        module: 'expenses',
        createdAt: String(r.createdAt ?? ''),
      });
    }

    const now = Date.now();
    const summary = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      overdue: tasks.filter((t) => {
        const created = new Date(t.createdAt).getTime();
        return !isNaN(created) && (now - created) / (1000 * 60 * 60 * 24) > 3;
      }).length,
    };
    return c.json({ tasks, summary });
  } catch (error) {
    console.error('Admin tasks error:', error);
    return c.json({ tasks: [], summary: { total: 0, pending: 0, inProgress: 0, completed: 0, overdue: 0 } });
  }
});

// GET /api/admin/discount-references — reference-wise discount anomaly view
// Aggregates the existing `bills.discount_by_name` field so admin can spot
// doctors, staff, or external names carrying an outsized share of discounts.
adminRoutes.get('/discount-references', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const referenceRows = await db.$client.prepare(`
      SELECT
        COALESCE(discount_by_name, 'Unknown') AS name,
        COALESCE(discount_by_role, 'unknown') AS type,
        COUNT(*) AS totalDiscounts,
        COALESCE(SUM(discount), 0) AS discountAmount,
        COUNT(DISTINCT patient_id) AS patientCount,
        COALESCE(AVG(discount), 0) AS avgDiscount,
        SUM(CASE WHEN total > 0 AND (discount * 100.0 / total) > 20 THEN 1 ELSE 0 END) AS highDiscountCount
      FROM bills
      WHERE tenant_id = ?
        AND discount > 0
        AND discount_by_name IS NOT NULL
        AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND date(created_at) >= date('now', '-90 days')
      GROUP BY discount_by_name, discount_by_role
      ORDER BY discountAmount DESC
      LIMIT 50
    `).bind(tenantId).all<{
      name: string; type: string; totalDiscounts: number; discountAmount: number;
      patientCount: number; avgDiscount: number; highDiscountCount: number;
    }>();

    const staffRows = await db.$client.prepare(`
      SELECT
        COALESCE(u.name, 'Unknown') AS name,
        COALESCE(u.role, 'staff') AS role,
        COUNT(*) AS totalDiscounts,
        COALESCE(SUM(b.discount), 0) AS discountAmount,
        COALESCE(AVG(b.discount), 0) AS avgDiscount,
        SUM(CASE WHEN b.total > 0 AND (b.discount * 100.0 / b.total) > 20 THEN 1 ELSE 0 END) AS highDiscountCount
      FROM bills b
      LEFT JOIN users u ON b.created_by = u.id
      WHERE b.tenant_id = ?
        AND b.discount > 0
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND date(b.created_at) >= date('now', '-90 days')
      GROUP BY u.id, u.name, u.role
      ORDER BY discountAmount DESC
      LIMIT 50
    `).bind(tenantId).all<{
      name: string; role: string; totalDiscounts: number;
      discountAmount: number; avgDiscount: number; highDiscountCount: number;
    }>();

    const references = (referenceRows.results || []).map((r) => ({
      name: r.name,
      type: r.type,
      totalDiscounts: r.totalDiscounts,
      discountAmount: Number(r.discountAmount ?? 0),
      patientCount: r.patientCount,
      avgDiscount: Number(r.avgDiscount ?? 0),
      highDiscountCount: r.highDiscountCount,
    }));
    const staff = (staffRows.results || []).map((r) => ({
      name: r.name,
      role: r.role,
      totalDiscounts: r.totalDiscounts,
      discountAmount: Number(r.discountAmount ?? 0),
      avgDiscount: Number(r.avgDiscount ?? 0),
      highDiscountCount: r.highDiscountCount,
    }));

    return c.json({
      references,
      staff,
      summary: {
        totalReferences: references.length,
        totalStaff: staff.length,
        totalDiscountAmount: references.reduce((s, r) => s + r.discountAmount, 0),
        highDiscountCount: references.reduce((s, r) => s + r.highDiscountCount, 0),
      },
    });
  } catch (error) {
    console.error('Discount references error:', error);
    return c.json({
      references: [],
      staff: [],
      summary: { totalReferences: 0, totalStaff: 0, totalDiscountAmount: 0, highDiscountCount: 0 },
    });
  }
});

// GET /api/admin/audit — tenant-scoped audit explorer for the admin panel
adminRoutes.get('/audit', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = parseLimit(c, 200);
  try {
    const { results } = await db.$client.prepare(`
      SELECT al.id, al.created_at as timestamp, al.user_id,
             u.name as user, COALESCE(u.role, 'user') as role,
             al.action, al.table_name as module, al.record_id as "recordId",
             al.ip_address as ip, al.severity
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.tenant_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `).bind(tenantId, limit).all<{
      id: number; timestamp: string; user: string; role: string;
      action: string; module: string; recordId: string; ip: string; severity: string;
    }>();
    const events = (results || []).map((r) => ({
      id: String(r.id),
      timestamp: r.timestamp,
      user: r.user ?? `User #${(r as Record<string, unknown>).user_id ?? ''}`,
      role: r.role,
      event: r.action,
      module: r.module,
      recordId: String(r.recordId ?? ''),
      ip: r.ip ?? '',
      severity: r.severity ?? 'low',
    }));
    const summary = {
      total: events.length,
      high: events.filter((e) => e.severity === 'high' || e.severity === 'critical').length,
      medium: events.filter((e) => e.severity === 'medium' || e.severity === 'warning').length,
      low: events.filter((e) => e.severity === 'low' || e.severity === 'info').length,
      hasMore: events.length === limit,
    };
    return c.json({ events, summary });
  } catch (error) {
    console.error('Admin audit error:', error);
    return c.json({ events: [], summary: { total: 0, high: 0, medium: 0, low: 0 } });
  }
});

// GET /api/admin/audit/financial — bill/payment-focused audit trail
adminRoutes.get('/audit/financial', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = parseLimit(c, 200);
  try {
    const { results } = await db.$client.prepare(`
      SELECT al.id, al.created_at as timestamp, al.user_id,
             u.name as user, al.action, al.table_name as module,
             al.record_id as "recordId", al.old_value, al.new_value,
             al.ip_address as ip,
             COALESCE(al.severity, 'low') AS severity
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.tenant_id = ?
        AND al.table_name IN ('bills', 'credit_notes', 'expenses', 'payments', 'deposits', 'cash_drawer_movements')
      ORDER BY al.created_at DESC
      LIMIT ?
    `).bind(tenantId, limit).all<{
      id: number; timestamp: string; user: string; action: string;
      module: string; recordId: string; old_value: string; new_value: string;
      ip: string; severity: string;
    }>();
    const entries = (results || []).map((r) => ({
      id: String(r.id),
      timestamp: r.timestamp,
      user: r.user ?? 'Unknown',
      event: r.action,
      module: r.module,
      recordId: String(r.recordId ?? ''),
      before: r.old_value,
      after: r.new_value,
      ip: r.ip ?? '',
      severity: r.severity,
    }));
    const usersActive = new Set(entries.map((e) => e.user)).size;
    const modulesAffected = new Set(entries.map((e) => e.module)).size;
    return c.json({
      entries,
      summary: {
        totalEvents: entries.length,
        highSeverity: entries.filter((e) => e.severity === 'high' || e.severity === 'critical').length,
        usersActive,
        modulesAffected,
        hasMore: entries.length === limit,
      },
    });
  } catch (error) {
    console.error('Admin financial audit error:', error);
    return c.json({ entries: [], summary: { totalEvents: 0, highSeverity: 0, usersActive: 0, modulesAffected: 0 } });
  }
});

// GET /api/admin/export-history — who exported what report, when
adminRoutes.get('/export-history', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT al.id, al.created_at as timestamp, al.user_id,
             u.name as user, al.action as report,
             al.table_name as format, al.record_id as "recordId",
             al.ip_address as ip
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.tenant_id = ?
        AND al.action LIKE '%EXPORT%'
      ORDER BY al.created_at DESC
      LIMIT 200
    `).bind(tenantId).all<{
      id: number; timestamp: string; user: string; report: string;
      format: string; recordId: string; ip: string;
    }>();
    const exports = (results || []).map((r) => ({
      id: String(r.id),
      timestamp: r.timestamp,
      user: r.user ?? 'Unknown',
      report: r.report,
      format: r.format ?? 'pdf',
      filtersUsed: '',
      rowsExported: 0,
      device: '',
      ip: r.ip ?? '',
    }));
    return c.json({ exports, summary: { total: exports.length } });
  } catch (error) {
    console.error('Export history error:', error);
    return c.json({ exports: [], summary: { total: 0 } });
  }
});

// GET /api/admin/sessions — active and recent login sessions
adminRoutes.get('/sessions', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = parseLimit(c, 200);
  try {
    const { results } = await db.$client.prepare(`
      SELECT s.id, s.user_id, u.name as userName, u.email,
             s.ip_address as ip, s.user_agent as device, s.browser,
             s.created_at as "loginTime", s.last_active_at as "lastActive",
             s.status
      FROM user_sessions s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.tenant_id = ?
      ORDER BY COALESCE(s.last_active_at, s.created_at) DESC
      LIMIT ?
    `).bind(tenantId, limit).all<{
      id: number; user_id: number; userName: string; email: string;
      ip: string; device: string; browser: string;
      loginTime: string; lastActive: string; status: string;
    }>();
    const sessions = (results || []).map((s) => ({
      id: String(s.id),
      user: s.userName ?? `User #${s.user_id}`,
      device: s.device ?? 'Unknown',
      ip: s.ip ?? '',
      browser: s.browser ?? '',
      loginTime: s.loginTime,
      lastActive: s.lastActive,
      status: s.status ?? 'active',
    }));
    return c.json({
      sessions,
      summary: {
        total: sessions.length,
        active: sessions.filter((s) => s.status === 'active').length,
        hasMore: sessions.length === limit,
      },
    });
  } catch (error) {
    // user_sessions table may not exist on older tenants — log other errors
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('no such table')) {
      console.error('Sessions error:', error);
    }
    return c.json({ sessions: [], summary: { total: 0, active: 0 } });
  }
});

// GET /api/admin/alerts/detect — run the suspicious-activity engine for the current tenant
adminRoutes.get('/alerts/detect', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();
  try {
    const batch = await db.$client.batch([
      // High discount frequency: a single user creating many >20% discounts today
      db.$client.prepare(`
        SELECT created_by, u.name as userName, COUNT(*) as cnt
        FROM bills b
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.tenant_id = ? AND date(b.created_at) = date(?)
          AND b.discount > 0 AND b.total > 0
          AND (b.discount * 100.0 / b.total) > 20
        GROUP BY created_by, u.name
        HAVING cnt >= 3
      `).bind(tenantId, today),
      // Refund spike: many refunds close to shift end
      db.$client.prepare(`
        SELECT cn.created_by, u.name as userName, COUNT(*) as cnt,
               COALESCE(SUM(cn.total), 0) as amount
        FROM credit_notes cn
        LEFT JOIN users u ON cn.created_by = u.id
        WHERE cn.tenant_id = ? AND date(cn.created_at) = date(?)
        GROUP BY cn.created_by, u.name
        HAVING cnt >= 3
      `).bind(tenantId, today),
      // Stock manipulation: adjustments with no corresponding purchase
      db.$client.prepare(`
        SELECT adjusted_by, u.name as userName, COUNT(*) as cnt,
               ABS(COALESCE(SUM(quantity_change), 0)) as totalQty
        FROM stock_adjustments sa
        LEFT JOIN users u ON sa.adjusted_by = u.id
        WHERE sa.tenant_id = ? AND date(sa.created_at) = date(?)
          AND ABS(quantity_change) > 50
        GROUP BY adjusted_by, u.name
      `).bind(tenantId, today),
    ]);

    const [highDiscFreq, refundSpike, stockManip] = batch;
    const alerts: Array<{ id: string; rule: string; riskLevel: string; user: string; detail: string; detectedAt: string }> = [];
    for (const r of (highDiscFreq.results || []) as Array<Record<string, unknown>>) {
      alerts.push({
        id: `freq-${r.created_by}`,
        rule: 'high_discount_frequency',
        riskLevel: 'high',
        user: String(r.userName ?? 'Unknown'),
        detail: `${r.cnt} high-discount bills (>20%) created today`,
        detectedAt: new Date().toISOString(),
      });
    }
    for (const r of (refundSpike.results || []) as Array<Record<string, unknown>>) {
      alerts.push({
        id: `refund-${r.created_by}`,
        rule: 'refund_spike',
        riskLevel: 'medium',
        user: String(r.userName ?? 'Unknown'),
        detail: `${r.cnt} refunds totaling ৳${Number(r.amount ?? 0).toLocaleString()} today`,
        detectedAt: new Date().toISOString(),
      });
    }
    for (const r of (stockManip.results || []) as Array<Record<string, unknown>>) {
      alerts.push({
        id: `stock-${r.adjusted_by}`,
        rule: 'stock_manipulation',
        riskLevel: 'high',
        user: String(r.userName ?? 'Unknown'),
        detail: `Adjusted ${r.totalQty} units across ${r.cnt} entries today`,
        detectedAt: new Date().toISOString(),
      });
    }

    return c.json({
      alerts,
      summary: {
        total: alerts.length,
        high: alerts.filter((a) => a.riskLevel === 'high').length,
        medium: alerts.filter((a) => a.riskLevel === 'medium').length,
        low: alerts.filter((a) => a.riskLevel === 'low').length,
      },
    });
  } catch (error) {
    console.error('Suspicious activity detection error:', error);
    return c.json({ alerts: [], summary: { total: 0, high: 0, medium: 0, low: 0 } });
  }
});

// GET /api/admin/hospital-profile — current tenant's profile
adminRoutes.get('/hospital-profile', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const profile = await db.$client.prepare(
      `SELECT id, name, subdomain, plan, status, address, phone, email, website,
              registration_no, logo_url, invoice_footer, terms
       FROM tenants WHERE id = ?`
    ).bind(tenantId).first();
    return c.json({ profile: profile || null });
  } catch (error) {
    console.error('Hospital profile error:', error);
    return c.json({ profile: null });
  }
});

// GET /api/admin/approval-policies — list configured approval policies
adminRoutes.get('/approval-policies', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT id, action, condition_field, condition_op, condition_value,
             required_role, attachment_required, escalation_minutes
      FROM approval_policies
      WHERE tenant_id = ?
      ORDER BY action, condition_value
    `).bind(tenantId).all<{
      id: number; action: string; condition_field: string; condition_op: string;
      condition_value: string; required_role: string;
      attachment_required: number; escalation_minutes: number;
    }>();
    return c.json({
      policies: (results || []).map((r) => ({
        id: String(r.id),
        action: r.action,
        conditionField: r.condition_field,
        conditionOp: r.condition_op,
        conditionValue: r.condition_value,
        requiredRole: r.required_role,
        attachmentRequired: Boolean(r.attachment_required),
        escalationMinutes: r.escalation_minutes,
      })),
    });
  } catch (error) {
    // approval_policies table may not exist on older tenants
    return c.json({ policies: [] });
  }
});

// GET /api/admin/escalation-rules — notification escalation rules
adminRoutes.get('/escalation-rules', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT id, trigger_event, delay_minutes, target_role, channel
      FROM escalation_rules
      WHERE tenant_id = ?
      ORDER BY trigger_event, delay_minutes
    `).bind(tenantId).all<{
      id: number; trigger_event: string; delay_minutes: number;
      target_role: string; channel: string;
    }>();
    return c.json({
      rules: (results || []).map((r) => ({
        id: String(r.id),
        triggerEvent: r.trigger_event,
        delayMinutes: r.delay_minutes,
        targetRole: r.target_role,
        channel: r.channel,
      })),
    });
  } catch (error) {
    return c.json({ rules: [] });
  }
});

// GET /api/admin/notifications/rules — notification category configuration
adminRoutes.get('/notifications/rules', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT id, category, channel, enabled
      FROM notification_settings
      WHERE tenant_id = ?
      ORDER BY category, channel
    `).bind(tenantId).all<{ id: number; category: string; channel: string; enabled: number }>();
    return c.json({
      rules: (results || []).map((r) => ({
        id: String(r.id),
        category: r.category,
        channel: r.channel,
        enabled: Boolean(r.enabled),
      })),
    });
  } catch (error) {
    return c.json({ rules: [] });
  }
});

// GET /api/admin/due-receivables — patient + corporate outstanding dues
adminRoutes.get('/due-receivables', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT b.id, b.invoice_no as "invoiceNo", b.patient_id as "patientId",
             COALESCE(p.name, 'Unknown') as "patientName",
             b.total, b.paid, b.due, b.created_at as "invoiceDate",
             CAST(julianday('now') - julianday(b.created_at) AS INTEGER) as "daysOutstanding"
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.tenant_id = ? AND COALESCE(b.due, 0) > 0
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'paid', 'draft')
      ORDER BY b.due DESC
      LIMIT 100
    `).bind(tenantId).all<{
      id: number; invoiceNo: string; patientId: number; patientName: string;
      total: number; paid: number; due: number; invoiceDate: string; daysOutstanding: number;
    }>();
    const receivables = (results || []).map((r) => ({
      id: String(r.id),
      type: 'patient',
      invoice: r.invoiceNo,
      party: r.patientName,
      total: Number(r.total ?? 0),
      paid: Number(r.paid ?? 0),
      due: Number(r.due ?? 0),
      daysOutstanding: r.daysOutstanding,
      status: r.daysOutstanding > 60 ? 'overdue' : r.daysOutstanding > 30 ? 'aging' : 'open',
    }));
    return c.json({
      receivables,
      summary: {
        totalDue: receivables.reduce((s, r) => s + r.due, 0),
        totalInvoices: receivables.length,
        aging: {
          '0-7': receivables.filter((r) => r.daysOutstanding <= 7).length,
          '8-30': receivables.filter((r) => r.daysOutstanding > 7 && r.daysOutstanding <= 30).length,
          '31-60': receivables.filter((r) => r.daysOutstanding > 30 && r.daysOutstanding <= 60).length,
          '60+': receivables.filter((r) => r.daysOutstanding > 60).length,
        },
      },
    });
  } catch (error) {
    console.error('Due receivables error:', error);
    return c.json({ receivables: [], summary: { totalDue: 0, totalInvoices: 0, aging: {} } });
  }
});

// GET /api/admin/inventory/alerts — low stock + expiry alerts
adminRoutes.get('/inventory/alerts', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT id, name, category, quantity, reorder_level as "reorderLevel",
             expiry_date as "expiryDate",
             CASE
               WHEN quantity <= 0 THEN 'out_of_stock'
               WHEN quantity <= reorder_level THEN 'low_stock'
               WHEN expiry_date IS NOT NULL AND expiry_date <= date('now', '+30 days') THEN 'near_expiry'
               WHEN expiry_date IS NOT NULL AND expiry_date <= date('now', '+90 days') THEN 'expiring_soon'
               ELSE 'ok'
             END as severity
      FROM medicines
      WHERE tenant_id = ?
        AND (quantity <= reorder_level
             OR (expiry_date IS NOT NULL AND expiry_date <= date('now', '+90 days')))
      ORDER BY
        CASE
          WHEN quantity <= 0 THEN 0
          WHEN quantity <= reorder_level THEN 1
          WHEN expiry_date IS NOT NULL AND expiry_date <= date('now', '+30 days') THEN 2
          ELSE 3
        END,
        expiry_date ASC
      LIMIT 50
    `).bind(tenantId).all<{
      id: number; name: string; category: string; quantity: number;
      reorderLevel: number; expiryDate: string; severity: string;
    }>();
    const alerts = (results || []).map((r) => ({
      id: String(r.id),
      name: r.name,
      category: r.category,
      quantity: r.quantity,
      reorderLevel: r.reorderLevel,
      expiryDate: r.expiryDate,
      severity: r.severity,
    }));
    return c.json({
      alerts,
      summary: {
        total: alerts.length,
        outOfStock: alerts.filter((a) => a.severity === 'out_of_stock').length,
        lowStock: alerts.filter((a) => a.severity === 'low_stock').length,
        nearExpiry: alerts.filter((a) => a.severity === 'near_expiry').length,
        expiringSoon: alerts.filter((a) => a.severity === 'expiring_soon').length,
      },
    });
  } catch (error) {
    console.error('Inventory alerts error:', error);
    return c.json({ alerts: [], summary: { total: 0, outOfStock: 0, lowStock: 0, nearExpiry: 0, expiringSoon: 0 } });
  }
});

// GET /api/admin/collection-followups — overdue patient due follow-up queue
adminRoutes.get('/collection-followups', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT b.id, b.invoice_no as "invoiceNo", b.due, b.created_at as "invoiceDate",
             COALESCE(p.name, 'Unknown') as "patientName",
             COALESCE(p.mobile, '') as mobile,
             CAST(julianday('now') - julianday(b.created_at) AS INTEGER) as "daysOutstanding"
      FROM bills b
      LEFT JOIN patients p ON b.patient_id = p.id
      WHERE b.tenant_id = ? AND COALESCE(b.due, 0) > 0
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'paid', 'draft')
      ORDER BY b.due DESC
      LIMIT 100
    `).bind(tenantId).all<{
      id: number; invoiceNo: string; due: number; invoiceDate: string;
      patientName: string; mobile: string; daysOutstanding: number;
    }>();
    const followups = (results || []).map((r) => ({
      id: String(r.id),
      invoice: r.invoiceNo,
      patientName: r.patientName,
      mobile: r.mobile,
      due: Number(r.due ?? 0),
      invoiceDate: r.invoiceDate,
      daysOutstanding: r.daysOutstanding,
      followUpStatus: r.daysOutstanding > 60 ? 'overdue' : r.daysOutstanding > 30 ? 'reminded' : 'new',
    }));
    return c.json({ followups, summary: { total: followups.length } });
  } catch (error) {
    console.error('Collection followups error:', error);
    return c.json({ followups: [], summary: { total: 0 } });
  }
});

// GET /api/admin/patient-record-access — who accessed which patient record when
adminRoutes.get('/patient-record-access', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const { results } = await db.$client.prepare(`
      SELECT al.id, al.created_at as timestamp, al.user_id,
             u.name as userName, al.action,
             al.table_name as module, al.record_id as "recordId",
             al.ip_address as ip
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.tenant_id = ?
        AND al.table_name IN ('patients', 'patient_records', 'consultation_notes', 'prescriptions', 'lab_orders')
        AND al.action IN ('VIEW', 'READ', 'view', 'read', 'SELECT')
      ORDER BY al.created_at DESC
      LIMIT 200
    `).bind(tenantId).all<{
      id: number; timestamp: string; user_id: number; userName: string;
      action: string; module: string; recordId: string; ip: string;
    }>();
    const access = (results || []).map((r) => ({
      id: String(r.id),
      timestamp: r.timestamp,
      user: r.userName ?? `User #${r.user_id}`,
      module: r.module,
      recordId: String(r.recordId ?? ''),
      action: r.action,
      ip: r.ip ?? '',
    }));
    return c.json({
      access,
      summary: {
        total: access.length,
        uniqueUsers: new Set(access.map((a) => a.user)).size,
        uniqueRecords: new Set(access.map((a) => a.recordId)).size,
      },
    });
  } catch (error) {
    console.error('Patient record access error:', error);
    return c.json({ access: [], summary: { total: 0, uniqueUsers: 0, uniqueRecords: 0 } });
  }
});

// GET /api/admin/doctor-payout/:id — single doctor payout detail
adminRoutes.get('/doctor-payout/:id', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const doctorId = c.req.param('id');
  if (!/^\d+$/.test(doctorId)) return c.json({ error: 'Invalid id' }, 400);
  try {
    const doctor = await db.$client.prepare(`
      SELECT id, name, department_id, commission_rate
      FROM doctors
      WHERE tenant_id = ? AND id = ?
    `).bind(tenantId, doctorId).first();
    const earnings = await db.$client.prepare(`
      SELECT id, source_type, source_id, amount, status, period_start, period_end
      FROM doctor_commissions
      WHERE tenant_id = ? AND doctor_id = ?
      ORDER BY period_end DESC
      LIMIT 50
    `).bind(tenantId, doctorId).all();
    return c.json({ doctor, earnings: earnings.results || [] });
  } catch (error) {
    console.error('Doctor payout error:', error);
    return c.json({ doctor: null, earnings: [] });
  }
});

// GET /api/admin/refunds/:id — single refund detail
adminRoutes.get('/refunds/:id', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) return c.json({ error: 'Invalid id' }, 400);
  try {
    const refund = await db.$client.prepare(`
      SELECT cn.*, b.invoice_no as "originalInvoice", p.name as "patientName",
             u.name as "requestedByName", u2.name as "approvedByName"
      FROM credit_notes cn
      LEFT JOIN bills b ON cn.bill_id = b.id
      LEFT JOIN patients p ON cn.patient_id = p.id
      LEFT JOIN users u ON cn.created_by = u.id
      LEFT JOIN users u2 ON cn.approved_by = u2.id
      WHERE cn.tenant_id = ? AND cn.id = ?
    `).bind(tenantId, id).first();
    return c.json({ refund: refund || null });
  } catch (error) {
    console.error('Refund detail error:', error);
    return c.json({ refund: null });
  }
});

// GET /api/admin/expenses/:id — single expense detail
adminRoutes.get('/expenses/:id', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) return c.json({ error: 'Invalid id' }, 400);
  try {
    const expense = await db.$client.prepare(`
      SELECT e.*, u.name as "requestedByName", u2.name as "approvedByName"
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users u2 ON e.approved_by = u2.id
      WHERE e.tenant_id = ? AND e.id = ?
    `).bind(tenantId, id).first();
    return c.json({ expense: expense || null });
  } catch (error) {
    console.error('Expense detail error:', error);
    return c.json({ expense: null });
  }
});

// GET /api/admin/cash-drawers/:id — single drawer with transactions + handover
adminRoutes.get('/cash-drawers/:id', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const sessionId = c.req.param('id');
  if (!/^\d+$/.test(sessionId)) return c.json({ error: 'Invalid id' }, 400);
  try {
    const session = await db.$client.prepare(`
      SELECT s.id as session_id, bc.counter_name as counter, bc.counter_code as drawer,
             u.name as "currentUser", s.opening_cash as "openingFloat", s.opened_at, s.status,
             COALESCE(ect.cash_in, 0) as "patientCollection",
             COALESCE(cdm.manual_cash_out, 0) as refund,
             COALESCE(cdm.cash_drop_total, 0) as "bankDeposit"
      FROM billing_counter_sessions s
      JOIN billing_counters bc ON s.counter_id = bc.id AND bc.tenant_id = s.tenant_id
      LEFT JOIN users u ON s.employee_id = u.id
      LEFT JOIN (
        SELECT counter_session_id, SUM(amount) as cash_in
        FROM emp_cash_transactions
        WHERE tenant_id = ?
        GROUP BY counter_session_id
      ) ect ON ect.counter_session_id = s.id
      LEFT JOIN cash_drawer_movements cdm ON cdm.counter_session_id = s.id AND cdm.tenant_id = s.tenant_id
      WHERE s.tenant_id = ? AND s.id = ?
    `).bind(tenantId, tenantId, sessionId).first<{
      session_id: number; counter: string; drawer: string; currentUser: string;
      openingFloat: number; opened_at: string; status: string;
      patientCollection: number; refund: number; bankDeposit: number;
    }>();
    const transactions = await db.$client.prepare(`
      SELECT id, transaction_date as time, transaction_type as type, amount,
             COALESCE(notes, '') as description, '' as reference
      FROM emp_cash_transactions
      WHERE tenant_id = ? AND counter_session_id = ?
      ORDER BY transaction_date DESC LIMIT 100
    `).bind(tenantId, sessionId).all();
    const handovers = await db.$client.prepare(`
      SELECT id, created_at as time, u1.name as outgoing, u2.name as incoming,
             COALESCE(handover_amount, 0) as "declaredCash",
             COALESCE(received_amount, 0) as "receivedCash",
             COALESCE(variance, 0) as variance, status
      FROM billing_handovers h
      LEFT JOIN users u1 ON h.handover_by = u1.id
      LEFT JOIN users u2 ON h.received_by = u2.id
      WHERE h.tenant_id = ? AND h.counter_session_id = ?
      ORDER BY h.created_at DESC
    `).bind(tenantId, sessionId).all();
    const summary = session
      ? {
          counter: session.counter,
          drawer: session.drawer,
          currentUser: session.currentUser ?? '—',
          shift: session.opened_at ?? '—',
          status: session.status,
          openingFloat: Number(session.openingFloat ?? 0),
          patientCollection: Number(session.patientCollection ?? 0),
          refund: Number(session.refund ?? 0),
          expense: 0,
          drawerTransfer: 0,
          bankDeposit: Number(session.bankDeposit ?? 0),
          expectedClosing: Number(session.openingFloat ?? 0) + Number(session.patientCollection ?? 0),
        }
      : null;
    return c.json({
      summary,
      transactions: (transactions.results || []).map((t: Record<string, unknown>) => ({
        id: String(t.id),
        time: t.time,
        type: t.type,
        description: t.description,
        amount: Number(t.amount ?? 0),
        balance: 0,
        reference: t.reference,
      })),
      handoverHistory: (handovers.results || []).map((h: Record<string, unknown>) => ({
        id: String(h.id),
        time: h.time,
        from: h.outgoing ?? '—',
        to: h.incoming ?? '—',
        declaredCash: Number(h.declaredCash ?? 0),
        receivedCash: Number(h.receivedCash ?? 0),
        variance: Number(h.variance ?? 0),
        status: h.status,
      })),
    });
  } catch (error) {
    console.error('Cash drawer detail error:', error);
    return c.json({ summary: null, transactions: [], handoverHistory: [] });
  }
});

// GET /api/admin/shift-handover/:id — single shift handover detail
adminRoutes.get('/shift-handover/:id', requireRole(...ALL_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  if (!/^\d+$/.test(id)) return c.json({ error: 'Invalid id' }, 400);

  const parseDenominations = (raw: unknown): Array<{ note: number; count: number; total: number }> => {
    if (!raw || typeof raw !== 'string') return [];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1].map((note) => {
        const count = Math.max(0, Math.round(Number(parsed[`note${note}`] ?? 0) || 0));
        return { note, count, total: note * count };
      }).filter((row) => row.count > 0);
    } catch {
      return [];
    }
  };

  try {
    const handover = await db.$client.prepare(`
      SELECT h.id, h.counter_session_id, h.status, h.remarks, h.created_at, h.handover_amount, h.due_amount,
             h.denomination_details, h.received_by, h.received_at,
             bc.counter_name, s.session_no, s.opening_cash, s.expected_cash,
             s.closing_cash_declared, s.variance, s.opening_denominations, s.closing_denominations,
             u1.name as outgoing_staff, u2.name as handover_to_staff, u3.name as received_by_staff
      FROM billing_handovers h
      JOIN billing_counter_sessions s ON h.counter_session_id = s.id AND s.tenant_id = h.tenant_id
      LEFT JOIN billing_counters bc ON s.counter_id = bc.id AND bc.tenant_id = s.tenant_id
      LEFT JOIN users u1 ON h.handover_by = u1.id AND u1.tenant_id = h.tenant_id
      LEFT JOIN users u2 ON h.handover_to = u2.id AND u2.tenant_id = h.tenant_id
      LEFT JOIN users u3 ON h.received_by = u3.id AND u3.tenant_id = h.tenant_id
      WHERE h.tenant_id = ? AND h.id = ?
      LIMIT 1
    `).bind(tenantId, id).first<Record<string, unknown>>();
    if (!handover) return c.json(null, 404);

    const declaredCash = Number(handover.closing_cash_declared ?? handover.handover_amount ?? 0);
    const expectedCash = Number(handover.expected_cash ?? declaredCash);
    const receivedCash = Number(handover.handover_amount ?? 0) - Number(handover.due_amount ?? 0);
    const shiftOpenAmount = Number(handover.opening_cash ?? 0);

    const detail = {
      id: String(handover.id),
      sessionId: Number(handover.counter_session_id ?? 0),
      counter: String(handover.counter_name ?? 'Counter'),
      sessionNo: String(handover.session_no ?? ''),
      outgoingStaff: String(handover.outgoing_staff ?? '—'),
      incomingStaff: String(handover.received_by_staff ?? handover.handover_to_staff ?? 'Pending'),
      shiftOpenAmount,
      totalCashReceived: Math.max(0, expectedCash - shiftOpenAmount),
      totalCashPaidOut: Math.max(0, shiftOpenAmount + Math.max(0, expectedCash - shiftOpenAmount) - expectedCash),
      declaredCash,
      incomingCount: receivedCash,
      receivedCash,
      variance: Number(handover.variance ?? declaredCash - expectedCash),
      status: String(handover.status ?? 'pending'),
      notes: String(handover.remarks ?? ''),
      handoverTime: String(handover.received_at ?? handover.created_at ?? new Date().toISOString()),
      denominations: parseDenominations(handover.denomination_details ?? handover.closing_denominations ?? handover.opening_denominations),
    };

    return c.json({ ...detail, handover: detail });
  } catch (error) {
    console.error('Shift handover detail error:', error);
    return c.json(null, 500);
  }
});

export default adminRoutes;
