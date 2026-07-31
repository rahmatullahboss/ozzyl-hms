import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'apps/ozzyl-lifestyle/src/App.tsx'), 'utf8');
const sidebarSource = readFileSync(resolve(process.cwd(), 'apps/ozzyl-lifestyle/src/components/dashboard/Sidebar.tsx'), 'utf8');
const protectedRouteSource = readFileSync(resolve(process.cwd(), 'apps/ozzyl-lifestyle/src/components/ProtectedRoute.tsx'), 'utf8');
const accessControlSource = readFileSync(resolve(process.cwd(), 'apps/ozzyl-lifestyle/src/pages/AccessControlPage.tsx'), 'utf8');
const loginDirectSource = readFileSync(resolve(process.cwd(), 'src/routes/login-direct.ts'), 'utf8');
const permissionsRouteSource = readFileSync(resolve(process.cwd(), 'src/routes/tenant/permissions.ts'), 'utf8');

describe('hospital portal access-control RBAC contract', () => {
  it('mounts access-control under the hospital slug namespace, not the patient portal', () => {
    expect(appSource).toContain('path="/h/:slug"');
    expect(appSource).toContain('path="access-control"');
    expect(appSource).toContain('component={AccessControlPage}');
    expect(appSource).not.toContain('path="/patient/access-control"');
  });

  it('guards the route and sidebar with roles:manage', () => {
    expect(appSource).toContain('requiredPermission="roles:manage"');
    expect(sidebarSource).toContain("path: 'access-control'");
    expect(sidebarSource).toContain("requiredPermission: 'roles:manage'");
    expect(protectedRouteSource).toContain('requiredPermission?: string | string[]');
    expect(protectedRouteSource).toContain('hasRequiredPermissions');
  });

  it('keeps the access-control page staff-first and backed by the tenant RBAC APIs', () => {
    expect(accessControlSource).toContain('RBAC Control Room');
    expect(accessControlSource).toContain('/api/permissions/catalog');
    expect(accessControlSource).toContain('/api/permissions/users/access-summary');
    expect(accessControlSource).toContain('/api/permissions/user/override');
    expect(accessControlSource).toContain('/api/permissions/user/workspace-bundle');
    expect(accessControlSource).toContain('/api/permissions/user/workspace-level');
  });

  it('keeps dynamic permission resolution consistent for direct login and the catalog API', () => {
    expect(loginDirectSource).toContain('resolveUserPermissions');
    expect(loginDirectSource).toContain('resolvedPermissions');
    expect(permissionsRouteSource).toContain('workspace_bundles: WORKSPACE_BUNDLES');
    expect(permissionsRouteSource).toContain("getWorkspaceLevelGroup('inventory')");
  });

  it('documents sidebar permission aliases for legacy frontend permission names', () => {
    expect(sidebarSource).toContain('SIDEBAR_PERMISSION_ALIASES');
    expect(sidebarSource).toContain("'medicalrecords:read': ['phr:read', 'patients:clinical']");
    expect(sidebarSource).toContain("'deposits:read': ['billing:deposit:read', 'billing:read']");
    expect(sidebarSource).toContain("'website:read': ['settings:read']");
  });
});
