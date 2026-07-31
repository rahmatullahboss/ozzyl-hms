import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = () => readFileSync(resolve(__dirname, './DashboardLayout.tsx'), 'utf8');

describe('DashboardLayout workspace context', () => {
  it('derives effective workspace role from the current route', () => {
    const src = source();
    expect(src).toContain('workspaceRoleFromPath');
    expect(src).toContain("return 'reception'");
    expect(src).toContain("return 'md'");
    expect(src).toContain("return 'director'");
    expect(src).toContain("return 'accountant'");
  });

  it('passes both actual role and effective route role to Header and Sidebar', () => {
    const src = source();
    expect(src).toContain('actualRole');
    expect(src).toContain('effectiveRole');
    expect(src).toContain('userPermissions={dashboardPermissions}');
    expect(src).toContain('actualUserRole={actualRole}');
    expect(src).toContain('userRole={effectiveRole}');
  });

  it('uses server-resolved effective permissions for every navigation surface', () => {
    const src = source();
    expect(src).toContain('useCurrentUserAccess');
    expect(src).toContain('currentUserAccess.data?.effective_permissions');
    expect(src).toContain('permissions={dashboardPermissions}');
  });

  it('does not reserve blank top spacing when sync and offline indicators are hidden', () => {
    const src = source();
    expect(src).toContain('empty:hidden');
    expect(src).toContain('empty:mb-0');
  });
});
