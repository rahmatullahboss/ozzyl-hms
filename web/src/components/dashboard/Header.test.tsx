import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockCurrentUserAccess = vi.hoisted(() => ({ data: undefined as { workspaces: unknown[] } | undefined }));

vi.mock('../../lib/apiClient', () => ({ apiFetch: mockApiFetch }));
vi.mock('../../hooks/useCurrentUserAccess', () => ({
  useCurrentUserAccess: () => mockCurrentUserAccess,
}));
vi.mock('../../hooks/useAuth', () => ({
  getTenant: () => ({ slug: 'demo-hospital', name: 'Demo Hospital' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ slug: 'demo-hospital' }),
  };
});
vi.mock('../GlobalSearch', () => ({ default: () => <div data-testid="global-search" /> }));
vi.mock('../PageHelpButton', () => ({ default: () => <button type="button">Help button</button> }));
vi.mock('../WhatsAppButton', () => ({ default: () => <button type="button">WhatsApp button</button> }));

import Header, { timeAgo } from './Header';

const source = () => readFileSync(resolve(__dirname, './Header.tsx'), 'utf8');

const managerWorkspace = {
  id: 'manager-dashboard',
  label: 'Manager Dashboard',
  description: 'Operations command center',
  path: 'manager/dashboard',
  level: 'management',
  required_permissions: ['manager.dashboard.read'],
};

const inventoryWorkspace = {
  id: 'inventory-dashboard',
  label: 'Inventory Dashboard',
  description: 'Inventory overview workspace',
  path: 'inventory',
  level: 'department',
  required_permissions: ['inventory:read'],
};

const inventoryEntryWorkspace = {
  id: 'inventory-entry',
  label: 'Inventory Entry',
  description: 'Receive, issue and transfer stock',
  path: 'inventory/stock',
  level: 'department',
  required_permissions: ['inventory:write'],
};

const reagentWorkspace = {
  id: 'reagent-control',
  label: 'Reagent Control',
  description: 'Lab reagent and auto-consumption control',
  path: 'inventory/consumption-rules',
  level: 'supervisor',
  required_permissions: ['inventory:consume'],
};

function mockWorkspaceApi(workspaces: unknown[]) {
  mockCurrentUserAccess.data = { workspaces };
  mockApiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/inbox/unread-count') return { count: 0 };
    if (path === '/api/settings') return { hospital_info: { name: 'Demo Hospital' } };
    if (path === '/api/inbox?limit=15') return { notifications: [] };
    return {};
  });
}

function mockWorkspaceApiFailure() {
  mockCurrentUserAccess.data = undefined;
  mockApiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/inbox/unread-count') return { count: 0 };
    if (path === '/api/settings') return { hospital_info: { name: 'Demo Hospital' } };
    return {};
  });
}

function renderHeader(
  initialPath = '/h/demo-hospital/manager/dashboard',
  props: Partial<ComponentProps<typeof Header>> = {},
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Header
        userName="Manager User"
        userEmail="manager@example.com"
        userRole="manager"
        actualUserRole="manager"
        userPermissions={[]}
        onLogout={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

async function openWorkspaceMenu() {
  const switchButton = await screen.findByRole('button', { name: 'Switch workspace' });
  fireEvent.click(switchButton);
  return switchButton;
}

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceApi([managerWorkspace, inventoryWorkspace]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports a valid React component', () => {
    expect(Header).toBeDefined();
    expect(typeof Header).toBe('function');
  });

  it('treats database timestamps without timezone as Bangladesh local time for relative notification age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-24T06:05:00.000Z')); // 12:05 PM in Bangladesh

    expect(timeAgo('2026-06-24 12:00:00')).toBe('5m ago');
  });

  it('loads manager workspaces from access-control API and shows inventory when returned', async () => {
    mockWorkspaceApi([managerWorkspace, inventoryWorkspace, reagentWorkspace]);

    renderHeader();
    await openWorkspaceMenu();

    expect(screen.getByRole('button', { name: /Manager Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Inventory Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reagent Control/i })).toBeInTheDocument();
  });

  it('hides workspace switcher when API returns only one workspace', async () => {
    mockWorkspaceApi([managerWorkspace]);

    renderHeader();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Switch workspace' })).not.toBeInTheDocument();
    });
  });

  it('highlights the deepest active workspace from the current route', async () => {
    mockWorkspaceApi([inventoryWorkspace, inventoryEntryWorkspace, reagentWorkspace]);

    renderHeader('/h/demo-hospital/inventory/stock');
    await openWorkspaceMenu();

    expect(screen.getByRole('button', { name: /Inventory Entry/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Inventory Dashboard/i })).not.toHaveAttribute('aria-current');
  });

  it('falls back to local permission-derived workspaces when API fails', async () => {
    mockWorkspaceApiFailure();

    renderHeader('/h/demo-hospital/inventory', {
      userPermissions: ['manager.dashboard.read', 'inventory:read', 'inventory:consume'],
    });
    await openWorkspaceMenu();

    expect(screen.getByRole('button', { name: /Manager Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Inventory Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reagent Control/i })).toBeInTheDocument();
  });

  it('uses the shared current-user access hook and falls back when no API workspace is available', () => {
    const src = source();
    expect(src).toContain('useCurrentUserAccess(true)');
    expect(src).toContain('(currentUserAccess?.workspaces ?? []).map(toWorkspaceOption)');
    expect(src).toContain('apiWorkspaceOptions.length > 0 ? apiWorkspaceOptions : fallbackWorkspaceOptions');
  });

  it('keeps the local shared workspace access helper as the fallback source', () => {
    const src = source();
    expect(src).toContain('getAvailableWorkspaces as getFallbackWorkspaces');
    expect(src).toContain('getFallbackWorkspaceOptions');
    expect(src).toContain('getFallbackWorkspaces(permissions, role)');
  });

  it('does not hard-bound managers to a role-specific early return', () => {
    const src = source();
    expect(src).not.toContain("if (normalizedRole === 'manager')");
    expect(src).not.toContain("key: 'manager'");
    expect(src).not.toContain('return options;');
  });
});
