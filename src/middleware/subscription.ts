/**
 * Subscription check middleware.
 *
 * Validates that the current tenant has an active subscription or is
 * within their 30-day trial window. Sets plan info on context variables
 * for downstream route handlers.
 *
 * Usage:
 *   import { subscriptionGuard } from '../middleware/subscription';
 *   app.use('/api/*', subscriptionGuard);
 */

import { createMiddleware } from 'hono/factory';
import type { Env, Variables } from '../types';
import { isTrialExpired, PLANS, type PlanId } from '../schemas/pricing';

interface TenantSubscription {
  plan: string;
  trial_ends_at: string | null;
  plan_price: number | null;
  billing_cycle: string | null;
  addons: string | null;
  status: string;
}

/**
 * Middleware that checks subscription status.
 *
 * - If trial is active (trial_ends_at in the future) → allow
 * - If plan_price > 0 → paid subscription, allow
 * - Otherwise → 402 Payment Required
 *
 * Skips check for super_admin users.
 */
export const subscriptionGuard = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const role = c.get('role');
  const tenantId = c.get('tenantId');

  // Super admins bypass subscription checks
  if (role === 'super_admin') {
    return next();
  }

  // No tenant context (e.g., public routes) — skip
  if (!tenantId) {
    return next();
  }

  try {
    const tenant = await c.env.DB.prepare(
      'SELECT plan, trial_ends_at, plan_price, billing_cycle, addons, status FROM tenants WHERE id = ?',
    ).bind(tenantId).first<TenantSubscription>();

    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404);
    }

    // Suspended tenants are blocked regardless
    if (tenant.status === 'suspended') {
      return c.json({
        error: 'Account suspended',
        message: 'আপনার অ্যাকাউন্ট স্থগিত করা হয়েছে। সাপোর্টে যোগাযোগ করুন।',
      }, 403);
    }

    // Check if trial is still active
    const trialActive = tenant.trial_ends_at && !isTrialExpired(tenant.trial_ends_at);

    // Check if paid subscription is active
    const paidActive = (tenant.plan_price || 0) > 0;

    if (!trialActive && !paidActive) {
      return c.json({
        error: 'Subscription required',
        message: 'আপনার ট্রায়াল শেষ হয়ে গেছে। সাবস্ক্রিপশন শুরু করুন।',
        trialExpired: true,
        plans: Object.values(PLANS).map((p) => ({
          id: p.id,
          name: p.name,
          nameBn: p.nameBn,
          priceMonthly: p.priceMonthly,
        })),
      }, 402);
    }

    // Parse active add-ons
    let activeAddons: string[] = [];
    try {
      activeAddons = JSON.parse(tenant.addons || '[]');
    } catch {
      activeAddons = [];
    }

    // Set plan info on context for downstream routes
    c.set('tenantId', tenantId);
    // Note: We use header-based plan info to avoid adding new Variables type fields
    // Downstream routes can read tenant plan from DB if needed

    return next();
  } catch (error) {
    console.error('Subscription check error:', error);
    // Fail closed: if we can't verify subscription, deny access
    // Better to block a valid tenant than allow an expired/suspended one
    return c.json({
      error: 'Subscription service unavailable',
      message: 'সাবস্ক্রিপশন সেবা সাময়িকভাবে অনুপলব্ধ। অনুগ্রহ করে আবার চেষ্টা করুন।',
    }, 503);
  }
});

/**
 * Lightweight plan info lookup.
 * Call this from routes that need to check feature access.
 */
export async function getTenantPlan(db: D1Database, tenantId: string): Promise<{
  plan: PlanId;
  addons: string[];
  trialActive: boolean;
  paidActive: boolean;
}> {
  const tenant = await db.prepare(
    'SELECT plan, trial_ends_at, plan_price, addons FROM tenants WHERE id = ?',
  ).bind(tenantId).first<TenantSubscription>();

  if (!tenant) {
    return { plan: 'starter', addons: [], trialActive: false, paidActive: false };
  }

  let addons: string[] = [];
  try {
    addons = JSON.parse(tenant.addons || '[]');
  } catch {
    addons = [];
  }

  return {
    plan: (tenant.plan || 'starter') as PlanId,
    addons,
    trialActive: !!tenant.trial_ends_at && !isTrialExpired(tenant.trial_ends_at),
    paidActive: (tenant.plan_price || 0) > 0,
  };
}
