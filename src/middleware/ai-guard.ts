import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types';

/**
 * AI Feature Guard Middleware
 * 
 * Checks if the current tenant has AI addon enabled.
 * Super admins bypass this check.
 */
export const aiFeatureGuard = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const role = c.get('role');
  const tenantId = c.get('tenantId');

  // Super admins bypass feature checks
  if (role === 'super_admin') {
    return next();
  }

  // No tenant context (e.g., public routes) — block
  if (!tenantId) {
    return c.json({ error: 'Tenant context required' }, 400);
  }

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT addons, ai_enabled FROM tenants WHERE id = ?',
    ).bind(tenantId).first<{ addons: string; ai_enabled: number }>();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Check if AI is enabled via addons or ai_enabled flag
    let addons: string[] = [];
    try {
      addons = JSON.parse(tenant.addons || '[]');
    } catch {
      addons = [];
    }

    const hasAiAddon = addons.includes('ai-summary') || tenant.ai_enabled === 1;

    if (!hasAiAddon) {
      return c.json({
        error: 'AI feature not enabled',
        message: 'AI features are not enabled for this hospital. Contact admin to enable.',
        upgradeUrl: '/api/subscribe/ai-summary'
      }, 402);
    }

    return next();
  } catch (error) {
    console.error('AI feature check error:', error);
    return c.json({ error: 'Feature check failed' }, 500);
  }
});
