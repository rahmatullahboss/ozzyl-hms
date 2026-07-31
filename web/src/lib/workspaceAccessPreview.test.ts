import { describe, expect, it } from 'vitest';

import { getWorkspaceAccessPreview } from './workspaceAccessPreview';

describe('workspaceAccessPreview', () => {
  it('shows combined reception and management pages from effective permissions', () => {
    const preview = getWorkspaceAccessPreview([
      'dashboard:read',
      'patients:read',
      'appointments:read',
      'billing:read',
      'staff:read',
      'accounting:read',
      'reports:read',
    ]);

    const pageLabels = preview.flatMap((group) => group.pages.map((page) => page.label));

    expect(pageLabels).toEqual(expect.arrayContaining([
      'Dashboard',
      'Reception Patients',
      'OPD Serial / Appointments',
      'Billing Counter',
      'Cash Operations',
      'Staff',
      'Accounting',
      'Reports',
    ]));
    expect(pageLabels).not.toContain('System Preferences');
    expect(pageLabels).not.toContain('Role Management');
  });

  it('returns an empty preview when no page permissions are granted', () => {
    expect(getWorkspaceAccessPreview([])).toEqual([]);
  });
});
