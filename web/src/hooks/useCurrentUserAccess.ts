import { useApiQuery } from './useApiQuery';

export interface CurrentUserWorkspace {
  id: string;
  label: string;
  description: string;
  path: string;
  level: string;
  required_permissions?: string[];
  requiredPermissions?: readonly string[];
}

export interface CurrentUserAccessResponse {
  user?: {
    id: number;
    name: string;
    email: string;
    role: string;
  };
  tenant_id?: string;
  effective_permissions: string[];
  workspaces: CurrentUserWorkspace[];
}

const CURRENT_USER_ACCESS_QUERY_KEY = ['access-control', 'current-user', 'workspaces'] as const;

/**
 * Server-resolved access profile for the signed-in tenant user.
 *
 * JWT permissions are only a login-time snapshot. This query is the live source
 * of truth used by route guards and navigation so role/permission changes take
 * effect without requiring the user to sign in again.
 */
export function useCurrentUserAccess(enabled = true) {
  return useApiQuery<CurrentUserAccessResponse>(
    CURRENT_USER_ACCESS_QUERY_KEY,
    '/api/access-control/current-user/workspaces',
    {
      enabled,
      // Permissions are still enforced server-side on every request. Keep the
      // navigation profile reasonably fresh without polling every open tab
      // twice per minute, which caused significant D1 read amplification.
      staleTime: 60_000,
      refetchInterval: 5 * 60_000,
      retry: 1,
      placeholderData: undefined,
    },
  );
}
