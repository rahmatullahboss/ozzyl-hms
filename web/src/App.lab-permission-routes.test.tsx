import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Navigate, Outlet } from 'react-router';
import App from './App';
import { useAuth } from './hooks/useAuth';

vi.mock('./hooks/useAuth', () => ({
  useAuth: vi.fn(),
  logout: vi.fn(),
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
vi.mock('./pages/LaboratoryDashboard', () => ({ default: () => <div data-testid="lab-dashboard-page" /> }));
vi.mock('./pages/pharmacy/InvoiceList', () => ({ default: () => <div data-testid="pharmacy-invoice-list-page" /> }));
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
}

afterEach(() => cleanup());

describe('laboratory permission route gates', () => {
  it('allows test-read access to the existing lab dashboard route', async () => {
    setupAuth(['tests:read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/lab/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('lab-dashboard-page')).toBeInTheDocument();
  });

  it('does not allow unrelated patient access to the lab dashboard route', async () => {
    setupAuth(['patients:read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/lab/dashboard']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('accessDenied')).toBeInTheDocument();
    expect(screen.queryByTestId('lab-dashboard-page')).not.toBeInTheDocument();
  });

  it('allows permission-granted staff to open pharmacy invoice routes', async () => {
    setupAuth(['pharmacy:read']);

    render(
      <MemoryRouter initialEntries={['/h/demo/pharmacy/invoices']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('pharmacy-invoice-list-page')).toBeInTheDocument();
    expect(screen.queryByText('accessDenied')).not.toBeInTheDocument();
  });
});
