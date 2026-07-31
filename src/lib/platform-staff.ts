import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../types';
import { getPermissionsForRole, normalizeRole, PLATFORM_ROLES, type PlatformRole } from './authz';

export type PlatformCapability =
  | 'platform:hospitals:read'
  | 'platform:hospitals:write'
  | 'platform:hospitals:delete'
  | 'platform:staff:manage'
  | 'platform:support:impersonate'
  | 'platform:audit:read';

export const PLATFORM_STAFF_SUBJECT_PREFIX = 'staff:';

export function platformStaffSubjectId(staffId: number | string): string {
  return `${PLATFORM_STAFF_SUBJECT_PREFIX}${staffId}`;
}

export function parsePlatformStaffSubjectId(subject: string | null | undefined): number | null {
  if (!subject?.startsWith(PLATFORM_STAFF_SUBJECT_PREFIX)) return null;
  const raw = subject.slice(PLATFORM_STAFF_SUBJECT_PREFIX.length);
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isPlatformRole(role: string | null | undefined): role is PlatformRole {
  const normalized = normalizeRole(role) || role || '';
  return (PLATFORM_ROLES as readonly string[]).includes(normalized);
}

export function hasPlatformCapability(
  role: string | null | undefined,
  capability: PlatformCapability,
): boolean {
  const normalized = normalizeRole(role) || role || '';
  if (normalized === 'super_admin') return true;
  const permissions = getPermissionsForRole(normalized);
  return permissions.includes('*') || permissions.includes(capability);
}

export function requirePlatformCapability(
  capability: PlatformCapability,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const role = c.get('role');
    if (!hasPlatformCapability(role, capability)) {
      throw new HTTPException(403, { message: `Missing platform capability: ${capability}` });
    }
    await next();
  };
}

export function isPrivilegedPlatformOperator(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role) || role || '';
  return normalized === 'super_admin' || normalized === 'platform_admin';
}

export function canManagePlatformRole(actorRole: string | null | undefined, targetRole: string): boolean {
  const normalizedActor = normalizeRole(actorRole) || actorRole || '';
  const normalizedTarget = normalizeRole(targetRole) || targetRole || '';
  if (normalizedActor === 'super_admin') return isPlatformRole(normalizedTarget);
  if (normalizedActor === 'platform_admin') {
    return isPlatformRole(normalizedTarget) && normalizedTarget !== 'platform_admin';
  }
  return false;
}
