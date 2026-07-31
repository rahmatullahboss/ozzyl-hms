import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth } from '../hooks/useAuth';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';
import { getAdminSession, isAdminAuthenticated } from '../lib/adminSessionStore';
import { ProtectedRoute } from './ProtectedRoute';

vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../hooks/useCurrentUserAccess', () => ({
  useCurrentUserAccess: vi.fn(),
}));

vi.mock('../lib/adminSessionStore', () => ({
  getAdminSession: vi.fn(),
  isAdminAuthenticated: vi.fn(),
}));

type MockUser = {
  role: string;
  permissions: string[];
  isImpersonation?: boolean;
};

function mockTenantUser(user: MockUser | null) {
  vi.mocked(useAuth).mockReturnValue({
    isAuthenticated: !!user,
    user: user
      ? {
          userId: '42',
          tenantId: '1',
          role: user.role,
          permissions: user.permissions,
          isImpersonation: user.isImpersonation,
        }
      : null,
    token: user ? 'test-token' : null,
  });
}

function renderProtectedRoute(
  routeProps: React.ComponentProps<typeof ProtectedRoute>,
  initialPath = '/h/demo/reception/billing-counter',
) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute {...routeProps} />}>
          <Route path="/h/:slug/reception/billing-counter" element={<div>Billing Counter Allowed</div>} />
          <Route path="/h/:slug/permissions" element={<div>Permissions Allowed</div>} />
          <Route path="/h/:slug/inventory/gr/new" element={<div>Inventory GR New Allowed</div>} />
          <Route path="/h/:slug/inventory/transfers" element={<div>Inventory Transfers Allowed</div>} />
          <Route path="/h/:slug/inventory/stock/adjust" element={<div>Inventory Stock Adjust Allowed</div>} />
          <Route path="/h/:slug/inventory/adjustments" element={<div>Inventory Stock Adjust Allowed</div>} />
          <Route path="/h/:slug/inventory/write-off" element={<div>Inventory Write Off Allowed</div>} />
          <Route path="/h/:slug/inventory/adjustment-requests" element={<div>Inventory Adjustment Requests Allowed</div>} />
          <Route path="/h/:slug/reagent-control" element={<div>Reagent Control Allowed</div>} />
          <Route path="/h/:slug/pharmacy/dashboard" element={<div>Pharmacy Dashboard Allowed</div>} />
          <Route path="/super-admin/dashboard" element={<div>Platform Admin Allowed</div>} />
        </Route>
        <Route path="/unauthorized" element={<div>Unauthorized Page</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/admin/login" element={<div>Platform Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute permission-driven access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminSession).mockReturnValue(null);
    vi.mocked(isAdminAuthenticated).mockReturnValue(false);
    vi.mocked(useCurrentUserAccess).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof useCurrentUserAccess>);
  });

  it('allows a manager with the required permission to open a reception route', () => {
    mockTenantUser({ role: 'manager', permissions: ['billing:read'] });

    renderProtectedRoute({ requiredAnyPermissions: ['billing:read'] });

    expect(screen.getByText('Billing Counter Allowed')).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized Page')).not.toBeInTheDocument();
  });

  it('blocks a manager without the required permission', () => {
    mockTenantUser({ role: 'manager', permissions: ['patients:read'] });

    renderProtectedRoute({ requiredAnyPermissions: ['billing:read'] });

    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    expect(screen.queryByText('Billing Counter Allowed')).not.toBeInTheDocument();
  });

  it('uses live effective permissions when a newly granted permission is missing from the token', () => {
    mockTenantUser({ role: 'manager', permissions: ['patients:read'] });
    vi.mocked(useCurrentUserAccess).mockReturnValue({
      data: { effective_permissions: ['patients:read', 'billing:read'], workspaces: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCurrentUserAccess>);

    renderProtectedRoute({ requiredAnyPermissions: ['billing:read'] });

    expect(screen.getByText('Billing Counter Allowed')).toBeInTheDocument();
  });

  it('uses live effective permissions to block a permission that was revoked after login', () => {
    mockTenantUser({ role: 'manager', permissions: ['patients:read', 'billing:read'] });
    vi.mocked(useCurrentUserAccess).mockReturnValue({
      data: { effective_permissions: ['patients:read'], workspaces: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCurrentUserAccess>);

    renderProtectedRoute({ requiredAnyPermissions: ['billing:read'] });

    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
  });

  it('requires every requiredAllPermissions entry when configured', () => {
    mockTenantUser({ role: 'manager', permissions: ['billing:read'] });

    renderProtectedRoute({ requiredAllPermissions: ['billing:read', 'billing:pay'] });

    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
  });

  it('allows hospital admins to open access control even when token permissions are stale', () => {
    mockTenantUser({ role: 'hospital_admin', permissions: ['dashboard:read'] });

    renderProtectedRoute({ requiredAnyPermissions: ['roles:manage'] }, '/h/demo/permissions');

    expect(screen.getByText('Permissions Allowed')).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized Page')).not.toBeInTheDocument();
  });

  it('keeps platform-admin routes role-only even when a tenant user has wildcard permissions', () => {
    mockTenantUser({ role: 'hospital_admin', permissions: ['*'] });

    renderProtectedRoute({ allowedRoles: ['super_admin'] }, '/super-admin/dashboard');

    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    expect(screen.queryByText('Platform Admin Allowed')).not.toBeInTheDocument();
  });

  it.each([
    ['/h/demo/inventory/gr/new', 'inventory:write', 'Inventory GR New Allowed'],
    ['/h/demo/inventory/transfers', 'inventory:transfer', 'Inventory Transfers Allowed'],
    ['/h/demo/inventory/stock/adjust', 'inventory:adjust', 'Inventory Stock Adjust Allowed'],
    ['/h/demo/inventory/write-off', 'inventory:write', 'Inventory Write Off Allowed'],
    ['/h/demo/inventory/write-off', 'inventory:approve', 'Inventory Write Off Allowed'],
    ['/h/demo/inventory/adjustment-requests', 'inventory:write', 'Inventory Adjustment Requests Allowed'],
    ['/h/demo/inventory/adjustment-requests', 'inventory:approve', 'Inventory Adjustment Requests Allowed'],
    ['/h/demo/inventory/adjustments', 'inventory:adjust', 'Inventory Stock Adjust Allowed'],
  ])('allows %s when staff has %s', (path, permission, allowedText) => {
    mockTenantUser({ role: 'manager', permissions: [permission] });

    renderProtectedRoute({}, path);

    expect(screen.getByText(allowedText)).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized Page')).not.toBeInTheDocument();
  });

  it.each([
    ['/h/demo/inventory/gr/new', 'Inventory GR New Allowed'],
    ['/h/demo/inventory/transfers', 'Inventory Transfers Allowed'],
    ['/h/demo/inventory/stock/adjust', 'Inventory Stock Adjust Allowed'],
    ['/h/demo/inventory/adjustments', 'Inventory Stock Adjust Allowed'],
    ['/h/demo/inventory/write-off', 'Inventory Write Off Allowed'],
    ['/h/demo/inventory/adjustment-requests', 'Inventory Adjustment Requests Allowed'],
  ])('blocks manual access to %s when staff lacks the sensitive inventory permission', (path, allowedText) => {
    mockTenantUser({ role: 'manager', permissions: ['inventory:read'] });

    renderProtectedRoute({}, path);

    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    expect(screen.queryByText(allowedText)).not.toBeInTheDocument();
  });

  it.each([
    'settings:write',
    'tests:write',
    'tests:verify',
    'lab_machines:write',
    'inventory:write',
    'inventory:consume',
  ])('allows reagent-control direct URL when staff has %s', (permission) => {
    mockTenantUser({ role: 'manager', permissions: [permission] });

    renderProtectedRoute({}, '/h/demo/reagent-control');

    expect(screen.getByText('Reagent Control Allowed')).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized Page')).not.toBeInTheDocument();
  });

  it('allows hospital admin to open reagent-control even when token permissions are stale', () => {
    mockTenantUser({ role: 'hospital_admin', permissions: ['dashboard:read'] });

    renderProtectedRoute({}, '/h/demo/reagent-control');

    expect(screen.getByText('Reagent Control Allowed')).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized Page')).not.toBeInTheDocument();
  });

  it('allows platform support impersonation to use role default permissions', () => {
    mockTenantUser({ role: 'pharmacist', permissions: [], isImpersonation: true });

    renderProtectedRoute({ requiredAnyPermissions: ['pharmacy:read', 'pharmacy:write'] }, '/h/demo/pharmacy/dashboard');

    expect(screen.getByText('Pharmacy Dashboard Allowed')).toBeInTheDocument();
    expect(screen.queryByText('Unauthorized Page')).not.toBeInTheDocument();
  });

  it('blocks receptionist-style billing permissions from reagent-control setup', () => {
    mockTenantUser({ role: 'manager', permissions: ['billing:read', 'appointments:read'] });

    renderProtectedRoute({}, '/h/demo/reagent-control');

    expect(screen.getByText('Unauthorized Page')).toBeInTheDocument();
    expect(screen.queryByText('Reagent Control Allowed')).not.toBeInTheDocument();
  });
});
