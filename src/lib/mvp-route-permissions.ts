import { HTTPException } from 'hono/http-exception';
import { getPermissionsForRole } from './authz';
import { resolveUserPermissions, resolveUserPermissionsCached } from '../middleware/rbac';

export type MvpRoutePermissionContext = {
  db: D1Database;
  kv?: KVNamespace;
  tenantId?: string;
  userId?: string;
  role?: string;
  path: string;
  method: string;
};

type PermissionRule = {
  prefix: string;
  permission: (method: string, path: string) => string | null;
};

const LAB_RESULT_WORKFLOW_ROLES = ['laboratory', 'lab', 'lab_tech', 'hospital_admin', 'super_admin'] as const;

function isPathUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function readWrite(read: string, write: string, deletePermission?: string) {
  return (method: string): string | null => {
    if (method === 'GET' || method === 'HEAD') return read;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') return write;
    if (method === 'DELETE') return deletePermission ?? write;
    return null;
  };
}

function isLabResultWorkflowPath(path: string): boolean {
  return /^\/api\/lab\/items\/[^/]+\/(result|sample-status|verify|reject-sample|recollect-sample|cancel)\/?$/.test(path);
}

export function canUseLabResultWorkflow(role?: string): boolean {
  return Boolean(role && LAB_RESULT_WORKFLOW_ROLES.includes(role as typeof LAB_RESULT_WORKFLOW_ROLES[number]));
}

const MVP_ROUTE_PERMISSION_RULES: PermissionRule[] = [
  {
    prefix: '/api/patients',
    permission: readWrite('patients:read', 'patients:write', 'patients:delete'),
  },
  {
    prefix: '/api/visits',
    permission: (method, path) => {
      if (method === 'GET' || method === 'HEAD') return 'appointments:read';
      if (method === 'POST' && /\/discharge\/?$/.test(path)) return 'admissions:discharge';
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'appointments:write';
      if (method === 'DELETE') return 'appointments:delete';
      return null;
    },
  },
  {
    prefix: '/api/billing',
    permission: readWrite('billing:read', 'billing:write', 'billing:cancel'),
  },
  {
    prefix: '/api/lab',
    permission: (method, path) => {
      if (method === 'GET' || method === 'HEAD') return 'tests:read';
      if (/\/verify\/?$/.test(path)) return 'tests:verify';
      if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return 'tests:write';
      return null;
    },
  },
  {
    prefix: '/api/pharmacy',
    permission: readWrite('pharmacy:read', 'pharmacy:write'),
  },
  {
    prefix: '/api/prescriptions',
    permission: readWrite('prescriptions:read', 'prescriptions:write'),
  },
];

export function getRequiredMvpPermission(path: string, method: string): string | null {
  const normalizedMethod = method.toUpperCase();
  const rule = MVP_ROUTE_PERMISSION_RULES.find((item) => isPathUnder(path, item.prefix));
  return rule?.permission(normalizedMethod, path) ?? null;
}

async function resolveEffectivePermissions(ctx: MvpRoutePermissionContext): Promise<string[]> {
  if (!ctx.role) return [];

  if (ctx.role === 'hospital_admin' || ctx.role === 'super_admin') {
    return ['*'];
  }

  if (ctx.tenantId && ctx.userId && ctx.kv) {
    return resolveUserPermissionsCached(ctx.db, ctx.kv, ctx.tenantId, ctx.role, ctx.userId);
  }

  if (ctx.tenantId && ctx.userId) {
    return resolveUserPermissions(ctx.db, ctx.tenantId, ctx.role, ctx.userId);
  }

  return getPermissionsForRole(ctx.role);
}

export async function enforceMvpRoutePermission(ctx: MvpRoutePermissionContext): Promise<void> {
  const requiredPermission = getRequiredMvpPermission(ctx.path, ctx.method);
  if (!requiredPermission) return;

  if (!ctx.role) {
    throw new HTTPException(403, { message: 'No role assigned' });
  }

  if (isLabResultWorkflowPath(ctx.path) && !canUseLabResultWorkflow(ctx.role)) {
    throw new HTTPException(403, {
      message: 'Lab result workflow is restricted to laboratory roles',
    });
  }

  const permissions = await resolveEffectivePermissions(ctx);

  if (!permissions.includes(requiredPermission) && !permissions.includes('*')) {
    throw new HTTPException(403, {
      message: `Missing permission: ${requiredPermission}`,
    });
  }
}
