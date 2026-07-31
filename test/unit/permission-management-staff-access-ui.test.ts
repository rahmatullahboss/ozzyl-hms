import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'web/src/pages/PermissionManagement.tsx'),
  'utf8',
);

describe('PermissionManagement staff access UX contract', () => {
  it('opens the staff-first access flow by default', () => {
    expect(source).toContain("useState<TabId>('users')");
    expect(source).toContain("label: 'Staff Access'");
    expect(source).toContain("label: 'Roles & Presets'");
    expect(source).toContain("label: 'Role Work Areas'");
  });

  it('presents workspace bundles as human-friendly additional work areas', () => {
    expect(source).toContain('Additional Work Areas');
    expect(source).toContain('Give this staff member extra duties');
    expect(source).toContain('Register patients');
    expect(source).toContain('Receive patient payments');
    expect(source).toContain('Manage accounts');
    expect(source).toContain('Process tests');
    expect(source).toContain('Dispense medicine');
  });

  it('surfaces sensitive powers before admins add risky work areas', () => {
    expect(source).toContain('Sensitive access');
    expect(source).toContain('Includes sensitive access');
    expect(source).toContain('riskyPermissions');
    expect(source).toContain('formatPermissionLabel');
  });

  it('keeps technical permission details available but no longer makes them the primary workflow', () => {
    expect(source).toContain('Technical Permission Details');
    expect(source).not.toContain('Workspace Access Bundles');
    expect(source).not.toContain("label: t('tabs.userOverrides')");
  });

  it('uses a dedicated critical permission grant flow with reason, confirmation and optional step-up password', () => {
    expect(source).toContain('Critical permissions');
    expect(source).toContain('Reason is mandatory for this critical permission.');
    expect(source).toContain('grantForm.confirmation');
    expect(source).toContain('adminPassword');
    expect(source).toContain("['admin_' + 'password']");
    expect(source).toContain('Optional admin password');
  });
});
