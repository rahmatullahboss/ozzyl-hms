import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { isRoleAllowed } from '@shared/authz';

interface ProtectedRouteProps {
  /** If provided, only users with one of these roles can access the route */
  allowedRoles?: string[];
  /** If provided, user must have all listed permissions or wildcard access */
  requiredPermission?: string | string[];
  /** Where to redirect if not authenticated */
  redirectTo?: string;
}

function hasRequiredPermissions(userPermissions: readonly string[], requiredPermission?: string | string[]): boolean {
  if (!requiredPermission) return true;
  if (userPermissions.includes('*')) return true;
  const required = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  return required.every((permission) => userPermissions.includes(permission));
}

/**
 * ProtectedRoute — wraps routes that require authentication.
 *
 * Usage:
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 *
 *   <Route element={<ProtectedRoute allowedRoles={['hospital_admin']} requiredPermission="settings:read" />}>
 *     <Route path="/settings" element={<Settings />} />
 *   </Route>
 */
export function ProtectedRoute({ allowedRoles, requiredPermission, redirectTo = '/login' }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  if (allowedRoles && user && !isRoleAllowed(user.role, allowedRoles)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (!user || !hasRequiredPermissions(user.permissions, requiredPermission)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
