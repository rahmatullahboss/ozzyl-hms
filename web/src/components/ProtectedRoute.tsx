import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';
import { getAdminSession, isAdminAuthenticated } from '../lib/adminSessionStore';
import { getPermissionsForRole, isRoleAllowed } from '@shared/authz';

interface ProtectedRouteProps {
  /** If provided, only users with one of these roles can access the route */
  allowedRoles?: string[];
  /** Require every permission in this list. */
  requiredAllPermissions?: string[];
  /** Require at least one permission in this list. */
  requiredAnyPermissions?: string[];
  /** Where to redirect if not authenticated */
  redirectTo?: string;
}

const REAGENT_CONTROL_PERMISSIONS = ['settings:write', 'tests:write', 'tests:verify', 'lab_machines:write', 'inventory:write', 'inventory:consume'];
const PLATFORM_ROUTE_ROLES = new Set(['super_admin', 'platform_admin', 'platform_setup', 'platform_support', 'platform_auditor']);

const SENSITIVE_ROUTE_PERMISSIONS: Array<{ pattern: RegExp; permissions: string[] }> = [
  { pattern: /^\/h\/[^/]+\/cash\/drawers(?:\/|$)/, permissions: ['billing:read', 'accounting:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/handover(?:\/|$)/, permissions: ['billing:read', 'accounting:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/collections(?:\/|$)/, permissions: ['reports:read', 'billing:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/discounts(?:\/|$)/, permissions: ['billing:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/refunds(?:\/|$)/, permissions: ['billing:refund', 'billing:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/expenses(?:\/|$)/, permissions: ['expenses:read', 'accounting:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/commissions(?:\/|$)/, permissions: ['accounting:read', 'billing:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/dues(?:\/|$)/, permissions: ['billing:read', 'reports:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/followups(?:\/|$)/, permissions: ['billing:read'] },
  { pattern: /^\/h\/[^/]+\/cash\/deposits(?:\/|$)/, permissions: ['billing:read'] },
  { pattern: /^\/h\/[^/]+\/audit(?:\/|$)/, permissions: ['audit:read'] },
  { pattern: /^\/h\/[^/]+\/system-audit(?:\/|$)/, permissions: ['audit:read'] },
  { pattern: /^\/h\/[^/]+\/activity-log(?:\/|$)/, permissions: ['audit:read'] },
  { pattern: /^\/h\/[^/]+\/sessions(?:\/|$)/, permissions: ['audit:read', 'settings:read'] },
  { pattern: /^\/h\/[^/]+\/permissions(?:\/|$)/, permissions: ['roles:manage'] },
  { pattern: /^\/h\/[^/]+\/settings(?:\/|$)/, permissions: ['settings:read'] },
  { pattern: /^\/h\/[^/]+\/billing-master(?:\/|$)/, permissions: ['billing:read', 'settings:read'] },
  { pattern: /^\/h\/[^/]+\/print-templates(?:\/|$)/, permissions: ['settings:read'] },
  { pattern: /^\/h\/[^/]+\/inventory\/gr\/new(?:\/|$)/, permissions: ['inventory:write'] },
  { pattern: /^\/h\/[^/]+\/inventory\/transfers(?:\/|$)/, permissions: ['inventory:transfer'] },
  { pattern: /^\/h\/[^/]+\/inventory\/stock\/adjust(?:\/|$)/, permissions: ['inventory:adjust'] },
  { pattern: /^\/h\/[^/]+\/inventory\/write-off(?:\/|$)/, permissions: ['inventory:write', 'inventory:approve'] },
  { pattern: /^\/h\/[^/]+\/inventory\/adjustment-requests(?:\/|$)/, permissions: ['inventory:write', 'inventory:approve'] },
  { pattern: /^\/h\/[^/]+\/inventory\/adjustments(?:\/|$)/, permissions: ['inventory:adjust'] },
  { pattern: /^\/h\/[^/]+\/reagent-control(?:\/|$)/, permissions: REAGENT_CONTROL_PERMISSIONS },
];

function requiredPermissionsForPath(pathname: string): string[] {
  return SENSITIVE_ROUTE_PERMISSIONS.find((entry) => entry.pattern.test(pathname))?.permissions ?? [];
}

function hasAnyPermission(userPermissions: string[], requiredPermissions: string[]): boolean {
  if (requiredPermissions.length === 0) return true;
  if (userPermissions.includes('*')) return true;
  return requiredPermissions.some((permission) => userPermissions.includes(permission));
}

function hasAllPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
  if (requiredPermissions.length === 0) return true;
  if (userPermissions.includes('*')) return true;
  for (const permission of requiredPermissions) {
    if (!userPermissions.includes(permission)) return false;
  }
  return true;
}

/**
 * ProtectedRoute — wraps routes that require authentication.
 *
 * Usage:
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 *
 *   <Route element={<ProtectedRoute allowedRoles={['hospital_admin']} />}>
 *     <Route path="/settings" element={<SettingsPage />} />
 *   </Route>
 *
 * Super-admin routes pass `allowedRoles={['super_admin']}`. The staff
 * `useAuth()` hook reports null for super admins (the JWT is in the
 * HttpOnly cookie, not in JS memory), so we fall back to the admin
 * session indicator for that role.
 */
export function ProtectedRoute({
  allowedRoles,
  requiredAllPermissions = [],
  requiredAnyPermissions = [],
  redirectTo = '/login',
}: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  const isPlatformProtectedRoute = !!allowedRoles && allowedRoles.some((role) => PLATFORM_ROUTE_ROLES.has(role));
  const adminSession = isPlatformProtectedRoute ? getAdminSession() : null;
  const isAdminSessionActive = isPlatformProtectedRoute ? isAdminAuthenticated() && adminSession !== null : false;
  const isTenantRoute = location.pathname.startsWith('/h/');
  const liveAccess = useCurrentUserAccess(Boolean(user && isTenantRoute && !isPlatformProtectedRoute));

  const effectiveAuthed = isAuthenticated || isAdminSessionActive;
  const effectiveRole = liveAccess.data?.user?.role ?? user?.role ?? adminSession?.role ?? null;

  if (!effectiveAuthed) {
    return <Navigate to={isPlatformProtectedRoute ? '/admin/login' : redirectTo} replace />;
  }

  const hasExplicitPermissionGate = requiredAllPermissions.length > 0 || requiredAnyPermissions.length > 0;
  const isTenantAdminRole = effectiveRole === 'hospital_admin' || effectiveRole === 'super_admin';
  const roleDefaults = effectiveRole ? getPermissionsForRole(effectiveRole) : [];
  const tokenPermissions = user?.permissions ?? [];
  const fallbackPermissions = isTenantAdminRole
    ? ['*']
    : user?.isImpersonation || tokenPermissions.length === 0
      ? Array.from(new Set([...roleDefaults, ...tokenPermissions]))
      : tokenPermissions;
  const livePermissions = liveAccess.data?.effective_permissions;
  const permissions = livePermissions ?? fallbackPermissions;
  const requiresPermissionEvaluation = hasExplicitPermissionGate || requiredPermissionsForPath(location.pathname).length > 0;

  if (requiresPermissionEvaluation && isTenantRoute && liveAccess.isLoading && !liveAccess.data) {
    return <div role="status" aria-live="polite">Checking access…</div>;
  }

  if (hasExplicitPermissionGate) {
    if (!hasAllPermissions(permissions, requiredAllPermissions)) {
      return <Navigate to="/unauthorized" replace />;
    }
    if (!hasAnyPermission(permissions, requiredAnyPermissions)) {
      return <Navigate to="/unauthorized" replace />;
    }
    return <Outlet />;
  }

  if (allowedRoles && effectiveRole && !isRoleAllowed(effectiveRole, allowedRoles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  const requiredPermissions = requiredPermissionsForPath(location.pathname);
  if (requiredPermissions.length > 0 && effectiveRole && effectiveRole !== 'super_admin') {
    if (!hasAnyPermission(permissions, requiredPermissions)) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return <Outlet />;
}
