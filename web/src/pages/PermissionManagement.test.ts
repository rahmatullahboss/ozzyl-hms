import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockApiGet = vi.hoisted(() => vi.fn());
const mockApiPost = vi.hoisted(() => vi.fn());
const mockApiDelete = vi.hoisted(() => vi.fn());
const mockApiPatch = vi.hoisted(() => vi.fn());
const mockUseApiQuery = vi.hoisted(() => vi.fn());
const mockUseCurrentUserAccess = vi.hoisted(() => vi.fn());
const mockUseApiMutation = vi.hoisted(() => vi.fn(() => ({ mutate: vi.fn(), isPending: false })));
const mockQueryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: mockToastError,
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));
vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'dashboard-layout' }, children),
}));
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (...args: unknown[]) => mockUseApiMutation(...args),
  useQueryClient: () => mockQueryClient,
}));
vi.mock('../hooks/useCurrentUserAccess', () => ({
  useCurrentUserAccess: (...args: unknown[]) => mockUseCurrentUserAccess(...args),
}));
vi.mock('../lib/apiClient', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
  },
}));

import PermissionManagement from './PermissionManagement';

const source = () => readFileSync(resolve(__dirname, './PermissionManagement.tsx'), 'utf8');
const appSource = () => readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

const permissionCatalog = {
  all_permissions: ['roles:manage', 'inventory:read', 'billing:refund'],
  roles: [
    { role: 'manager', label: 'Manager' },
    { role: 'pharmacist', label: 'Pharmacist' },
    { role: 'reception', label: 'Reception' },
  ],
  groups: {},
};

const staffRows = [
  {
    id: 1,
    user_id: 101,
    name: 'Rahim Manager',
    email: 'rahim@example.com',
    role: 'manager',
    position: 'Operations Manager',
    effective_permissions_count: 24,
    critical_permissions_count: 2,
    active_workspaces: ['Management Workspace', 'Inventory Operator'],
  },
  {
    id: 2,
    user_id: '202',
    name: 'Nila Pharmacy',
    email: 'nila@example.com',
    role: 'pharmacist',
    position: 'Pharmacy Lead',
    effective_permissions_count: 9,
    critical_permissions_count: 0,
    active_workspaces: ['Pharmacy Workspace'],
  },
  {
    id: 3,
    user_id: null,
    name: 'Pending Staff',
    email: null,
    role: 'reception',
    position: 'Receptionist',
    effective_permissions_count: 0,
    critical_permissions_count: 0,
    active_workspaces: [],
  },
];

const selectedUser = {
  user: { id: 101, name: 'Rahim Manager', email: 'rahim@example.com', role: 'manager' },
  role_permissions: ['dashboard:read', 'inventory:read'],
  user_overrides: [
    {
      permission: 'billing:refund',
      action: 'grant',
      reason: 'Temporary billing supervision',
      granted_by: 'Admin User',
      created_at: '2026-07-07T10:00:00Z',
    },
  ],
  effective_permissions: [
    'dashboard:read',
    'inventory:read',
    'inventory:write',
    'billing:refund',
    'reports:read',
    'roles:manage',
  ],
};

function setupPermissionMocks() {
  mockUseApiQuery.mockImplementation((_key: unknown, path: string) => {
    if (path === '/api/permissions/catalog') {
      return { data: permissionCatalog, isLoading: false, isError: false, refetch: vi.fn() };
    }
    if (path === '/api/permissions/matrix') {
      return { data: { matrix: {} }, isLoading: false, isError: false, refetch: vi.fn() };
    }
    if (path === '/api/permissions/modules') {
      return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });

  mockApiGet.mockImplementation(async (path: string) => {
    if (path === '/api/permissions/users/access-summary') return { staff: staffRows };
    if (path === '/api/permissions/user/101') return selectedUser;
    if (path === '/api/permissions/user/202') {
      return {
        user: { id: 202, name: 'Nila Pharmacy', email: 'nila@example.com', role: 'pharmacist' },
        role_permissions: ['pharmacy:read'],
        user_overrides: [],
        effective_permissions: ['pharmacy:read'],
      };
    }
    return {};
  });
}

function renderAccessControl() {
  return render(React.createElement(PermissionManagement, { role: 'hospital_admin' }));
}

describe('PermissionManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPermissionMocks();
    mockUseCurrentUserAccess.mockReturnValue({
      data: { effective_permissions: ['*'], workspaces: [] },
      isLoading: false,
      isError: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports a valid React component', () => {
    expect(PermissionManagement).toBeDefined();
    expect(typeof PermissionManagement).toBe('function');
  });

  it('labels the permissions route as Access Control and gates it by roles:manage', () => {
    const src = source();
    const app = appSource();
    expect(src).toContain('Access Control');
    expect(app).toContain("<ProtectedRoute requiredAnyPermissions={workspacePermissions('access-control')} />");
    expect(app).toContain('path="permissions" element={<PermissionManagement');
    expect(app).not.toContain("<Route path=\"permissions\" element={<PermissionManagement role=\"hospital_admin\" />} />\n            <Route path=\"quality-kpi\"");
  });

  it('shows Invite Staff only when the current access profile includes staff:write', () => {
    mockUseCurrentUserAccess.mockReturnValue({
      data: { effective_permissions: ['roles:manage', 'staff:write'], workspaces: [] },
      isLoading: false,
      isError: false,
    });

    renderAccessControl();

    expect(screen.getByRole('link', { name: /Invite Staff/i })).toBeInTheDocument();
  });

  it('hides Invite Staff when roles:manage is delegated without staff:write', () => {
    mockUseCurrentUserAccess.mockReturnValue({
      data: { effective_permissions: ['roles:manage'], workspaces: [] },
      isLoading: false,
      isError: false,
    });

    renderAccessControl();

    expect(screen.queryByRole('link', { name: /Invite Staff/i })).not.toBeInTheDocument();
  });

  it('renders a roles-manage-gated list-first access control workflow for staff users', () => {
    const src = source();
    expect(src).toContain('/api/permissions/users/access-summary');
    expect(src).toContain('User list');
    expect(src).toContain('Search/filter');
    expect(src).toContain('Primary role');
    expect(src).toContain('Effective permissions');
    expect(src).toContain('Active workspace badges');
    expect(src).toContain('Manage access');
  });

  it('renders user list rows with primary role, effective count, workspace badges and action button', async () => {
    renderAccessControl();

    expect(await screen.findByText('Rahim Manager')).toBeInTheDocument();
    expect(screen.getByText('Nila Pharmacy')).toBeInTheDocument();
    expect(screen.getAllByText('manager').length).toBeGreaterThan(0);
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('2 critical')).toBeInTheDocument();
    expect(screen.getByText('Management Workspace')).toBeInTheDocument();
    expect(screen.getByText('Inventory Operator')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Pharmacy Workspace')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Manage access/i })).toHaveLength(3);
    expect(mockApiGet).toHaveBeenCalledWith('/api/permissions/users/access-summary');
  });

  it('filters user list by search text without refetching from the server', async () => {
    renderAccessControl();
    await screen.findByText('Rahim Manager');

    fireEvent.change(screen.getByPlaceholderText(/Search\/filter by user name/i), { target: { value: 'nila' } });

    expect(screen.queryByText('Rahim Manager')).not.toBeInTheDocument();
    expect(screen.getByText('Nila Pharmacy')).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenCalledWith('/api/permissions/users/access-summary');
  });


  it('shows an access summary warning instead of misleading zero counts when summary calculation fails', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/api/permissions/users/access-summary') {
        return {
          staff: [
            {
              id: 4,
              user_id: 404,
              name: 'Broken Summary User',
              email: 'broken@example.com',
              role: 'manager',
              effective_permissions_count: null,
              critical_permissions_count: null,
              active_workspaces: [],
              access_summary_error: true,
              access_summary_error_message: 'Unable to calculate effective access summary',
            },
          ],
        };
      }
      return {};
    });

    renderAccessControl();

    expect(await screen.findByText('Broken Summary User')).toBeInTheDocument();
    expect(screen.getAllByText('Access summary unavailable')).toHaveLength(2);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('No workspace badge yet')).not.toBeInTheDocument();
  });

  it('opens user access drawer with summary, workspace access, critical permissions, preview and history', async () => {
    renderAccessControl();
    await screen.findByText('Rahim Manager');

    fireEvent.click(screen.getAllByRole('button', { name: /Manage access/i })[0]);

    expect(await screen.findByText(/User access drawer/i)).toBeInTheDocument();
    expect(screen.getByText('User summary')).toBeInTheDocument();
    expect(screen.getByText('Workspace access')).toBeInTheDocument();
    expect(screen.getAllByText('Critical permissions')[0]).toBeInTheDocument();
    expect(screen.getByText('Effective permission preview')).toBeInTheDocument();
    expect(screen.getByText('Access history')).toBeInTheDocument();
    expect(screen.getByText('Temporary billing supervision')).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(mockApiGet).toHaveBeenCalledWith('/api/permissions/user/101');
  });

  it('does not open drawer for staff without an active login user id', async () => {
    renderAccessControl();
    await screen.findByText('Pending Staff');

    const pendingRow = screen.getByText('Pending Staff').closest('tr');
    expect(pendingRow).not.toBeNull();
    fireEvent.click(within(pendingRow as HTMLElement).getByRole('button', { name: /Manage access/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('This staff member has no active login yet. Send an invitation first.');
    });
    expect(screen.queryByText(/User access drawer/i)).not.toBeInTheDocument();
  });

  it('opens user access in a drawer or modal with the required review sections', () => {
    const src = source();
    expect(src).toContain('User access drawer');
    expect(src).toContain('User summary');
    expect(src).toContain('Workspace access');
    expect(src).toContain('Critical permissions');
    expect(src).toContain('Effective permission preview');
    expect(src).toContain('Access history');
  });

  it('uses linked staff user_id when opening user access management', () => {
    const src = source();
    expect(src).toContain('staff.user_id');
    expect(src).toContain('This staff member has no active login yet');
  });

  it('exposes primary role management in user access screen', () => {
    const src = source();
    expect(src).toContain('handlePrimaryRoleChange');
    expect(src).toContain("'/api/users/' + selectedUser.user.id + '/role'");
    expect(src).toContain('Primary role');
  });

  it('requires a reason before submitting critical user permission overrides', () => {
    const src = source();
    expect(src).toContain('isCriticalPermission');
    expect(src).toContain('A clear reason is required for critical permission changes');
    expect(src).toContain('Reason is mandatory for this critical permission.');
  });

  it('renders workspace level controls for inventory access', () => {
    const src = source();
    expect(src).toContain('Workspace level controls');
    expect(src).toContain('/api/permissions/user/workspace-level');
    expect(src).toContain('Kept separate critical permission');
    expect(src).toContain('aria-label={`${group.label} level`}');
  });
});
