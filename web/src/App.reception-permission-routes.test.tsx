import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Navigate, Outlet } from 'react-router';
import App from './App';
import { useAuth } from './hooks/useAuth';
import { useCurrentUserAccess } from './hooks/useCurrentUserAccess';

vi.mock('./hooks/useAuth', () => ({
  useAuth: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('./hooks/useCurrentUserAccess', () => ({
  useCurrentUserAccess: vi.fn(),
}));
vi.mock('./hooks/useAnalytics', () => ({ useAnalytics: vi.fn() }));
vi.mock('./components/PWAUpdatePrompt', () => ({ PWAUpdatePrompt: () => null }));
vi.mock('./components/AppIconSync', () => ({ AppIconSync: () => null }));
vi.mock('./components/ImpersonationBanner', () => ({ default: () => null }));
vi.mock('./components/ProtectedRoute', () => ({
  ProtectedRoute: ({
    allowedRoles,
    requiredAnyPermissions,
  }: {
    allowedRoles?: string[];
    requiredAnyPermissions?: string[];
  }) => {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" replace />;
    if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
    if (requiredAnyPermissions?.length) {
      const permissions = user.permissions ?? [];
      const allowed = permissions.includes('*') || requiredAnyPermissions.some((permission) => permissions.includes(permission));
      if (!allowed) return <Navigate to="/unauthorized" replace />;
    }
    return <Outlet />;
  },
}));
vi.mock('./pages/BillingCounterPage', () => ({ default: () => <div data-testid="billing-counter-page" /> }));
vi.mock('./pages/ReceptionDashboard', () => ({ default: () => <div data-testid="reception-dashboard-page" /> }));
vi.mock('./pages/PatientList', () => ({ default: () => <div data-testid="patient-list-page" /> }));
vi.mock('./pages/Login', () => ({ default: () => <div data-testid="login-page" /> }));
vi.mock('./pages/AdminLogin', () => ({ default: () => <div data-testid="admin-login-page" /> }));
vi.mock('./pages/HospitalSignup', () => ({ default: () => <div data-testid="signup-page" /> }));
vi.mock('./pages/AcceptInvite', () => ({ default: () => <div data-testid="accept-invite-page" /> }));
vi.mock('./pages/QueueDisplay', () => ({ default: () => <div data-testid="queue-display-page" /> }));
vi.mock('./components/LoadingFallback', () => ({ default: () => <div data-testid="loading-fallback" /> }));
vi.mock('./components/DashboardLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('./lib/hostRouting', () => ({
  getTenantSlugFromHost: () => 'demo',
  isAdminHost: () => false,
  isPatientAppHost: () => false,
  isStaffAuthHost: () => false,
}));
vi.mock('./lib/pwaLaunch', () => ({ getStoredPwaLaunchPath: () => '/h/demo/dashboard' }));
vi.mock('./lib/patientPortalHandoff', () => ({
  buildPatientPortalHandoffTarget: () => '/patient/login',
  shouldUnregisterServiceWorkerScope: () => false,
}));
vi.mock('react-hot-toast', () => ({ Toaster: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function setupAuth(permissions: string[]) {
  (useAuth as any).mockReturnValue({
    isAuthenticated: true,
    user: { userId: 'manager-1', role: 'manager', permissions },
    token: 'test-token',
  });
  (useCurrentUserAccess as any).mockReturnValue({
    data: {
      user: { id: 1, role: 'manager' },
      effective_permissions: permissions,
      workspaces: [],
    },
    isLoading: false,
    isError: false,
  });
}

afterEach(() => cleanup());

describe('reception permission route gates', () => {
  it('routes manager dashboard entry to the dedicated manager dashboard', async () => {
    setupAuth(['manager.dashboard.read', 'dashboard:read', 'patients:read', 'appointments:read', 'billing:read', 'tests:read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('manager-dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('accessDenied')).not.toBeInTheDocument();
  });

  it('falls back to reception when manager dashboard permission is revoked but counter access remains', async () => {
    setupAuth(['billing.counter.read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('reception-dashboard-page')).toBeInTheDocument();
    expect(screen.queryByTestId('manager-dashboard-page')).not.toBeInTheDocument();
  });

  it('does not allow patient-only access to the billing counter route', async () => {
    setupAuth(['patients:read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/reception/billing-counter']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('accessDenied')).toBeInTheDocument();
    expect(screen.queryByTestId('billing-counter-page')).not.toBeInTheDocument();
  });

  it('allows granular counter read access to the billing counter route', async () => {
    setupAuth(['billing.counter.read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/reception/billing-counter']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('billing-counter-page')).toBeInTheDocument();
  });

  it('allows legacy billing access to the billing counter route', async () => {
    setupAuth(['billing:read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/reception/billing-counter']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('billing-counter-page')).toBeInTheDocument();
  });
});
