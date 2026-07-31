import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

/**
 * Context helpers for extracting and validating common request context values.
 *
 * These replace the `c.get('tenantId')!` non-null assertion pattern
 * used across all 36 route files. Throwing HTTPException early gives
 * cleaner stack traces and consistent error messages.
 */

/**
 * Get tenantId from context or throw 403.
 * Use this instead of `c.get('tenantId')!` in route handlers.
 */
export function requireTenantId(c: Context): string {
  const id = c.get('tenantId');
  if (!id) {
    throw new HTTPException(403, { message: 'Tenant context required' });
  }
  return id;
}

/**
 * Get userId from context or throw 401.
 * Use this instead of `c.get('userId')!` in route handlers.
 */
export function requireUserId(c: Context): string {
  const id = c.get('userId');
  if (!id) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  return id;
}

/**
 * Get role from context or throw 401.
 */
export function requireRole(c: Context): string {
  const role = c.get('role');
  if (!role) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  return role;
}

/**
 * Require a specific role, throw 403 if mismatch.
 */
export function requireSpecificRole(c: Context, ...roles: string[]): string {
  const role = requireRole(c);
  if (!roles.includes(role)) {
    throw new HTTPException(403, {
      message: `Forbidden: ${roles.join(' or ')} access required`,
    });
  }
  return role;
}

/**
 * Parse a route param as a positive integer or throw 400.
 * Centralised version — replaces inline copies across route files.
 */
export function parseId(v: string, label = 'ID'): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) {
    throw new HTTPException(400, { message: `Invalid ${label}` });
  }
  return n;
}
