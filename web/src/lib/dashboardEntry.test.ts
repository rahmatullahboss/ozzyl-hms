import { describe, expect, it } from 'vitest';
import { resolveDashboardEntryWorkspace } from './dashboardEntry';

describe('dashboard entry workspace resolution', () => {
  it('uses the role-preferred workspace when the user still has access', () => {
    expect(resolveDashboardEntryWorkspace('manager', ['manager.dashboard.read', 'patients:read'])).toMatchObject({
      id: 'manager-dashboard',
      path: 'manager/dashboard',
    });
  });

  it('falls back to reception when manager dashboard access was revoked but front-desk access remains', () => {
    expect(resolveDashboardEntryWorkspace('manager', ['billing.counter.read'])).toMatchObject({
      id: 'reception-dashboard',
      path: 'reception/dashboard',
    });
  });

  it('falls back from MD dashboard to manager workspace when executive access was revoked', () => {
    expect(resolveDashboardEntryWorkspace('md', ['manager.dashboard.read', 'reports:read'])).toMatchObject({
      id: 'manager-dashboard',
      path: 'manager/dashboard',
    });
  });

  it('does not return a workspace whose permission is absent', () => {
    expect(resolveDashboardEntryWorkspace('accountant', ['patients:write'])).toBeNull();
  });

  it('allows wildcard hospital admins to keep the dedicated admin dashboard', () => {
    expect(resolveDashboardEntryWorkspace('hospital_admin', ['*'])).toBeNull();
  });
});
