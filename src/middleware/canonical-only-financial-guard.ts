import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';
import type { ResolvedFinancialPolicy } from '../lib/canonical/strict-financial-policy';

/**
 * Historical compatibility shim.
 *
 * Canonical-only financial mode was withdrawn in favor of the original
 * strict dual-write migration sequence. The application no longer mounts
 * this middleware. Keeping a no-op export avoids breaking stale imports in
 * old tests or dated operational material while ensuring it cannot block or
 * reroute any financial mutation.
 */
export type CanonicalOnlyFinancialGuardDecision = { allowed: true };

export function evaluateCanonicalOnlyFinancialRequest(_input: {
  tenantId: string | undefined;
  method: string;
  path: string;
  policy: ResolvedFinancialPolicy;
}): CanonicalOnlyFinancialGuardDecision {
  return { allowed: true };
}

export const canonicalOnlyFinancialGuard: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (_c, next) => {
  await next();
};
