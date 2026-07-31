import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = () => readFileSync('web/src/components/dashboard/Header.tsx', 'utf8');
const accessHookSource = () => readFileSync('web/src/hooks/useCurrentUserAccess.ts', 'utf8');

describe('dashboard header workspace switcher access model', () => {
  it('uses current-user workspace API with permission fallback instead of manager role early return', () => {
    const src = source();

    expect(src).toContain('useCurrentUserAccess(true)');
    expect(accessHookSource()).toContain("/api/access-control/current-user/workspaces");
    expect(src).toContain('getFallbackWorkspaceOptions(actualUserRole, userPermissions)');
    expect(src).toContain('getFallbackWorkspaces(permissions, role)');
    expect(src).not.toContain("if (normalizedRole === 'manager')");
    expect(src).not.toContain('return options;');
  });

  it('hides the workspace switcher when only one workspace is available and highlights active workspace', () => {
    const src = source();

    expect(src).toContain('workspaceOptions.length > 1');
    expect(src).toContain('getActiveWorkspaceKey(workspaceOptions, currentWorkspacePath)');
    expect(src).toContain("aria-current={isCurrent ? 'page' : undefined}");
    expect(src).toContain("isCurrent ? 'bg-[var(--color-primary-light)]");
  });
});
