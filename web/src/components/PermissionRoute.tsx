import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { normalizeRole } from '@shared/authz';

interface PermissionRouteProps {
  children: ReactNode;
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
}

/**
 * PermissionRoute protects sensitive admin pages at the route level.
 *
 * ProtectedRoute still checks authentication and coarse role access. This
 * component adds a UI-level permission guard so a hidden sidebar item cannot be
 * opened directly by pasting the URL. Backend authorization must remain the
 * source of truth for data mutations and reads.
 */
export default function PermissionRoute({
  children,
  permission,
  permissions = [],
  requireAll = false,
}: PermissionRouteProps) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  const role = normalizeRole(user.role) || user.role;
  if (role === 'hospital_admin' || role === 'super_admin') {
    return <>{children}</>;
  }

  const required = permission ? [permission, ...permissions] : permissions;
  if (required.length === 0) {
    return <>{children}</>;
  }

  const userPermissions = user.permissions ?? [];
  if (userPermissions.includes('*')) {
    return <>{children}</>;
  }

  const allowed = requireAll
    ? required.every((perm) => userPermissions.includes(perm))
    : required.some((perm) => userPermissions.includes(perm));

  return allowed ? <>{children}</> : <Navigate to="/unauthorized" replace />;
}
