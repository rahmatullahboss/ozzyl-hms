import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getEffectivePermissionsForUser } from '../../lib/effectivePermissions';
import {
  getAvailableWorkspaces,
  type WorkspaceAccessDefinition,
} from '../../../packages/shared/src/workspaceAccess';

type AccessControlEnv = { Bindings: Env; Variables: Variables };

type WorkspaceResponse = Omit<WorkspaceAccessDefinition, 'requiredPermissions'> & {
  required_permissions: string[];
};

const accessControlRoutes = new Hono<AccessControlEnv>();

function serializeWorkspace(workspace: WorkspaceAccessDefinition): WorkspaceResponse {
  return {
    id: workspace.id,
    label: workspace.label,
    description: workspace.description,
    path: workspace.path,
    level: workspace.level,
    required_permissions: [...workspace.requiredPermissions],
  };
}

accessControlRoutes.get('/current-user/workspaces', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { user, effectivePermissions } = await getEffectivePermissionsForUser(
    c.env,
    String(tenantId),
    userId,
    { notFoundMessage: 'Current user not found' },
  );
  const workspaces = getAvailableWorkspaces(effectivePermissions, user.role).map(serializeWorkspace);

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    tenant_id: String(user.tenant_id),
    effective_permissions: effectivePermissions,
    workspaces,
  });
});

export default accessControlRoutes;
